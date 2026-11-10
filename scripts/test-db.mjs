import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

let failureReported = false;
function fail(message) { console.error(`test:db: ${message}`); process.exitCode = 1; failureReported = true; }
function sanitizedMessage(error) {
  return String(error?.message ?? error).replaceAll(raw, "[redacted connection URL]").replace(/(postgres(?:ql)?:\/\/)[^\s@]+@/gi, "$1[redacted]@");
}
function parseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("TEST_DATABASE_URL_UNPOOLED must be a valid PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error("TEST_DATABASE_URL_UNPOOLED must be a complete PostgreSQL URL.");
  const host = url.hostname.toLowerCase();
  if (!(host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host))) throw new Error("The test database host must be loopback.");
  if (decodeURIComponent(url.pathname.slice(1)) !== "ai_personal_assistant_test") throw new Error("The test database name must be ai_personal_assistant_test.");
  return url;
}
async function configuredUrls() {
  const values = [];
  for (const file of [".env", ".env.local", ".env.staging", ".env.staging.local"]) {
    try {
      const body = await readFile(resolve(file), "utf8");
      for (const line of body.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?(?:DATABASE_URL|DATABASE_URL_UNPOOLED|STAGING_DATABASE_URL|STAGING_DATABASE_URL_UNPOOLED)\s*=\s*(.*?)\s*$/);
        if (match) values.push(match[1].replace(/^(['"])(.*)\1$/, "$2"));
      }
    } catch { /* optional env file */ }
  }
  return values;
}

const raw = process.env.TEST_DATABASE_URL_UNPOOLED;
if (!raw) { fail("TEST_DATABASE_URL_UNPOOLED is required; no application URL fallback is allowed."); process.exit(1); }
let target;
try { target = parseUrl(raw); } catch (error) { fail(error.message); process.exit(1); }
const targetKey = `${target.hostname.toLowerCase()}:${target.port || "5432"}/${decodeURIComponent(target.pathname.slice(1))}`;
for (const value of await configuredUrls()) {
  try { const url = new URL(value); const key = `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`; if (key === targetKey) { fail("The test database matches a configured application or staging database."); process.exit(1); } } catch { /* ignore unrelated malformed config */ }
}

const client = new Client({ connectionString: raw });
let connected = false;
let targetVerified = false;
const prefix = `dbtest_${process.pid}_${Date.now()}`;
const userSubjects = [`${prefix}_a`, `${prefix}_b`];
const synthetic = {
  users: [],
  identities: [],
  conversations: [],
  accounts: [],
  approvals: [],
  capabilities: [],
  oauthTransactions: [],
};
const executed = [];
async function rejected(label, query) {
  try { await query(); } catch (error) { if (error.code?.startsWith("23")) { executed.push(`${label}: constraint rejected (${error.code})`); return; } throw error; }
  throw new Error(`${label}: expected a PostgreSQL constraint failure`);
}
try {
  await client.connect();
  connected = true;
  const identity = await client.query("select current_database() as database, inet_server_addr()::text as address, current_user as role");
  const db = identity.rows[0];
  console.log(`PostgreSQL target: database=${db.database}, address=${db.address ?? "local socket"}, role=${db.role}`);
  if (db.database !== "ai_personal_assistant_test" || db.role !== "postgres" || !db.address || (!/^127(?:\.\d{1,3}){3}$/.test(db.address) && db.address !== "::1")) throw new Error("Connected server identity does not match the approved loopback test target.");
  targetVerified = true;

  await client.query("create table if not exists public._ai_personal_assistant_test_migrations (name text primary key, applied_at timestamptz not null default now())");
  for (let n = 0; n <= 7; n++) {
    const prefixNumber = String(n).padStart(4, "0");
    const migration = (await readdir(resolve("drizzle"))).find((file) => file.startsWith(`${prefixNumber}_`) && file.endsWith(".sql"));
    if (!migration) throw new Error(`Migration ${prefixNumber} is missing.`);
    const alreadyApplied = await client.query("select 1 from public._ai_personal_assistant_test_migrations where name=$1", [migration]);
    if (alreadyApplied.rowCount) continue;
    const sql = await readFile(resolve("drizzle", migration), "utf8");
    await client.query("begin");
    try {
      for (const statement of sql.split(/--> statement-breakpoint\s*/).map((part) => part.trim()).filter(Boolean)) await client.query(statement);
      await client.query("insert into public._ai_personal_assistant_test_migrations(name) values($1)", [migration]);
      await client.query("commit");
    } catch (error) { try { await client.query("rollback"); } catch { /* preserve the migration error */ } throw error; }
  }

  const userIds = [];
  for (let i = 0; i < userSubjects.length; i++) {
    const subject = userSubjects[i];
    const id = (await client.query("insert into users(google_subject,email,name) values($1,$2,$3) returning id", [subject, `${subject}@example.test`, `Integration ${i}`])).rows[0].id;
    synthetic.users.push(id);
    userIds.push(id);
  }
  const [a, b] = userIds;
  const ia = (await client.query("insert into google_identities(user_id,google_subject,email) values($1,$2,$3) returning id", [a, `${prefix}_ia`, `${prefix}_ia@example.test`])).rows[0].id;
  synthetic.identities.push(ia);
  const ib = (await client.query("insert into google_identities(user_id,google_subject,email) values($1,$2,$3) returning id", [b, `${prefix}_ib`, `${prefix}_ib@example.test`])).rows[0].id;
  synthetic.identities.push(ib);
  const ca = (await client.query("insert into conversations(user_id,session_id,title,account) values($1,gen_random_uuid(),'test','personal') returning id", [a])).rows[0].id;
  synthetic.conversations.push(ca);
  const cb = (await client.query("insert into conversations(user_id,session_id,title,account) values($1,gen_random_uuid(),'test','personal') returning id", [b])).rows[0].id;
  synthetic.conversations.push(cb);
  const aa = (await client.query("insert into google_accounts(user_id,identity_id,account_type,refresh_token_ciphertext) values($1,$2,'personal','synthetic') returning id", [a, ia])).rows[0].id;
  synthetic.accounts.push(aa);
  const ab = (await client.query("insert into google_accounts(user_id,identity_id,account_type,refresh_token_ciphertext) values($1,$2,'personal','synthetic') returning id", [b, ib])).rows[0].id;
  synthetic.accounts.push(ab);
  executed.push("same-owner conversation, identity, account inserts: succeeded");
  await rejected("cross-owner identity/account association", () => client.query("insert into google_accounts(user_id,identity_id,account_type,refresh_token_ciphertext) values($1,$2,'official','synthetic')", [a, ib]));
  const approvalSql = "insert into google_write_approvals(user_id,conversation_id,account_label,google_account_id,operation,payload,expires_at) values($1,$2,'personal',$3,'gmail.send','{}',now()+interval '5 minutes')";
  const initialApproval = await client.query(approvalSql + " returning id", [a, ca, aa]);
  synthetic.approvals.push(initialApproval.rows[0].id);
  executed.push("same-owner approval insert: succeeded");
  await rejected("cross-owner approval conversation", () => client.query(approvalSql, [a, cb, aa]));
  await rejected("cross-owner approval account", () => client.query(approvalSql, [a, ca, ab]));
  await rejected("cross-owner conversation reference", () => client.query("insert into google_write_approvals(user_id,conversation_id,account_label,google_account_id,operation,payload,expires_at) values($1,$2,'personal',$3,'gmail.send','{}',now()+interval '5 minutes')", [a, cb, aa]));
  const approval = await client.query(approvalSql + " returning id", [a, ca, aa]);
  synthetic.approvals.push(approval.rows[0].id);
  const used = await client.query("update google_write_approvals set consumed_at=now() where id=$1 and user_id=$2 and conversation_id=$3 and consumed_at is null and expires_at>now() returning id", [approval.rows[0].id, a, ca]);
  const twice = await client.query("update google_write_approvals set consumed_at=now() where id=$1 and user_id=$2 and conversation_id=$3 and consumed_at is null and expires_at>now() returning id", [approval.rows[0].id, a, ca]);
  if (used.rowCount !== 1 || twice.rowCount !== 0) throw new Error("Approval consumption did not enforce one-time use.");
  executed.push("approval consumption: succeeded once; second consume rejected");
  // Capability rows use the same nonce/expiry/consumption constraints as the application verifier.
  const nonce = `${prefix}_cap`;
  await client.query("insert into google_capabilities(nonce,expires_at) values($1,now()+interval '5 minutes')", [nonce]);
  synthetic.capabilities.push(nonce);
  const consumed = await client.query("update google_capabilities set consumed_at=now() where nonce=$1 and consumed_at is null and expires_at>now() returning nonce", [nonce]);
  const replay = await client.query("update google_capabilities set consumed_at=now() where nonce=$1 and consumed_at is null and expires_at>now() returning nonce", [nonce]);
  if (consumed.rowCount !== 1 || replay.rowCount !== 0) throw new Error("Capability nonce replay was not rejected.");
  executed.push("capability nonce: consumed once; replay rejected");
  console.log(`Cases: ${executed.length}`); for (const line of executed) console.log(`- ${line}`);
} catch (error) {
  const code = error?.code ? ` (${error.code})` : "";
  fail(`${connected ? "Integration test failed" : "PostgreSQL connection failed"}${code}: ${sanitizedMessage(error)}`);
} finally {
  if (connected) {
    try {
      if (!targetVerified) throw new Error("Cleanup skipped because the approved test database identity was not verified.");
      const identity = await client.query("select current_database() as database, inet_server_addr()::text as address, current_user as role");
      const db = identity.rows[0];
      if (db.database !== "ai_personal_assistant_test" || db.role !== "postgres" || !db.address || (!/^127(?:\.\d{1,3}){3}$/.test(db.address) && db.address !== "::1")) throw new Error("Cleanup stopped because the connected server no longer matches the approved loopback test target.");

      const cleanupErrors = [];
      async function cleanup(label, sql, values) {
        try { await client.query(sql, [values]); }
        catch (error) { cleanupErrors.push(`${label}: ${sanitizedMessage(error)}`); }
      }
      // Delete dependents before their owners. Each predicate is limited to primary keys
      // captured from this run; capabilities use this run's unique nonce.
      await cleanup("approvals", "delete from google_write_approvals where id = any($1::uuid[])", synthetic.approvals);
      await cleanup("messages", "delete from messages where conversation_id = any($1::uuid[])", synthetic.conversations);
      await cleanup("conversations", "delete from conversations where id = any($1::uuid[])", synthetic.conversations);
      await cleanup("accounts", "delete from google_accounts where id = any($1::uuid[])", synthetic.accounts);
      await cleanup("identities", "delete from google_identities where id = any($1::uuid[])", synthetic.identities);
      await cleanup("sessions", "delete from sessions where user_id = any($1::uuid[])", synthetic.users);
      await cleanup("OAuth transactions", "delete from oauth_transactions where state_hash = any($1::text[])", synthetic.oauthTransactions);
      await cleanup("capabilities", "delete from google_capabilities where nonce = any($1::text[])", synthetic.capabilities);
      await cleanup("users", "delete from users where id = any($1::uuid[])", synthetic.users);

      const remaining = await client.query(`
        select 'users' as table_name, count(*)::int as count from users where id = any($1::uuid[])
        union all select 'sessions', count(*)::int from sessions where user_id = any($1::uuid[])
        union all select 'identities', count(*)::int from google_identities where id = any($2::uuid[])
        union all select 'accounts', count(*)::int from google_accounts where id = any($3::uuid[])
        union all select 'conversations', count(*)::int from conversations where id = any($4::uuid[])
        union all select 'messages', count(*)::int from messages where conversation_id = any($4::uuid[])
        union all select 'approvals', count(*)::int from google_write_approvals where id = any($5::uuid[])
        union all select 'capabilities', count(*)::int from google_capabilities where nonce = any($6::text[])
        union all select 'oauth_transactions', count(*)::int from oauth_transactions where state_hash = any($7::text[])
      `, [synthetic.users, synthetic.identities, synthetic.accounts, synthetic.conversations, synthetic.approvals, synthetic.capabilities, synthetic.oauthTransactions]);
      const leftovers = remaining.rows.filter((row) => Number(row.count) !== 0);
      if (cleanupErrors.length || leftovers.length) {
        const details = [...cleanupErrors, ...leftovers.map((row) => `${row.table_name}: ${row.count} row(s) remain`)];
        fail(`Cleanup failed: ${details.join("; ")}`);
      } else {
        console.log("Cleanup: all current-run synthetic records removed; verification passed (0 remaining).");
      }
    } catch (error) {
      if (!failureReported) fail(`Cleanup failed: ${sanitizedMessage(error)}`);
      else console.error(`test:db: Cleanup also failed: ${sanitizedMessage(error)}`);
    } finally {
      try { await client.end(); } catch (error) { if (!failureReported) fail(`Connection close failed: ${sanitizedMessage(error)}`); else console.error(`test:db: Connection close failed: ${sanitizedMessage(error)}`); }
    }
  }
}
