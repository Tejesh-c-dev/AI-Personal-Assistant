import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { inspectTestContainer, validateTestUrl, verifyTestDatabase } from "./test-db-identity.mjs";

const { Client } = pg;

let failureReported = false;
function fail(message) { console.error(`test:db: ${message}`); process.exitCode = 1; failureReported = true; }
function sanitizedMessage(error) {
  return String(error?.message ?? error).replaceAll(raw, "[redacted connection URL]").replace(/(postgres(?:ql)?:\/\/)[^\s@]+@/gi, "$1[redacted]@");
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
try { target = validateTestUrl(raw); } catch (error) { fail(error.message); process.exit(1); }
let composeContainer;
try { composeContainer = inspectTestContainer(); } catch (error) { fail(error.message); process.exit(1); }
if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname || !target.pathname.slice(1)) { fail("TEST_DATABASE_URL_UNPOOLED must be a complete PostgreSQL URL."); process.exit(1); }
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
  const db = await verifyTestDatabase(client, raw, composeContainer);
  console.log(`PostgreSQL target: host=${db.host}, port=${db.port}, database=${db.database}, address=${db.address}, role=${db.role}, container=${db.containerId}, project=${db.project}`);
  targetVerified = true;

  await client.query("create table if not exists public._ai_personal_assistant_test_migrations (name text primary key, applied_at timestamptz not null default now())");
  // If drizzle-kit already applied all migrations, register each SQL file in our own tracker
  // so the loop below skips re-applying them (re-applying would fail with "already exists").
  const drizzleSchemaExists = (await client.query(
    "select 1 from information_schema.tables where table_schema='drizzle' and table_name='__drizzle_migrations' limit 1"
  )).rowCount > 0;
  if (drizzleSchemaExists) {
    const drizzleCount = (await client.query("select count(*) as c from drizzle.__drizzle_migrations")).rows[0].c;
    if (Number(drizzleCount) >= 9) {
      // All 9 migrations (0000-0008) are recorded in drizzle journal; mark them applied in our tracker.
      const files = await readdir(resolve("drizzle"));
      for (let n = 0; n <= 8; n++) {
        const prefixNumber = String(n).padStart(4, "0");
        const migration = files.find((f) => f.startsWith(`${prefixNumber}_`) && f.endsWith(".sql"));
        if (migration) await client.query("insert into public._ai_personal_assistant_test_migrations(name) values($1) on conflict do nothing", [migration]);
      }
    }
  }
  for (let n = 0; n <= 8; n++) {
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
  const aa = (await client.query("insert into google_accounts(user_id,identity_id,label,refresh_token_ciphertext,granted_scopes) values($1,$2,'personal','synthetic',ARRAY['https://www.googleapis.com/auth/gmail.modify']::text[]) returning id", [a, ia])).rows[0].id;
  synthetic.accounts.push(aa);
  const ab = (await client.query("insert into google_accounts(user_id,identity_id,label,refresh_token_ciphertext,granted_scopes) values($1,$2,'official','synthetic',ARRAY['https://www.googleapis.com/auth/gmail.modify']::text[]) returning id", [b, ib])).rows[0].id;
  synthetic.accounts.push(ab);
  executed.push("same-owner conversation, identity, account inserts: succeeded");

  await client.query("insert into messages(conversation_id,role,content) values($1,'assistant','synthetic private A'),($2,'assistant','synthetic private B')", [ca, cb]);
  const aMessages = await client.query("select m.content from messages m join conversations c on c.id=m.conversation_id where c.id=$1 and c.user_id=$2", [cb, a]);
  if (aMessages.rowCount !== 0) throw new Error("User A retrieved User B conversation messages.");
  const bAccount = await client.query("select id from google_accounts where user_id=$1 and id=$2", [a, ab]);
  if (bAccount.rowCount !== 0) throw new Error("User A retrieved User B Google account.");
  executed.push("tenant-scoped conversation message and account lookups: cross-user records returned no rows");
  await rejected("cross-owner identity/account association", () => client.query("insert into google_accounts(user_id,identity_id,label,refresh_token_ciphertext) values($1,$2,'official','synthetic')", [a, ib]));
  const approvalSql = "insert into google_write_approvals(user_id,conversation_id,account_label,google_account_id,operation,payload,expires_at) values($1,$2,'personal',$3,'gmail.send','{}',now()+interval '5 minutes')";
  const initialApproval = await client.query(approvalSql + " returning id", [a, ca, aa]);
  synthetic.approvals.push(initialApproval.rows[0].id);
  executed.push("same-owner approval insert: succeeded");
  const repositoryPayload = { to: "approved@example.test", subject: "Synthetic approved payload", body: "Synthetic only" };
  const repositoryApproval = await client.query(
    "insert into google_write_approvals(user_id,conversation_id,account_label,google_account_id,operation,payload,expires_at) values($1,$2,'personal',$3,'gmail.send',$4,now()+interval '5 minutes') returning id",
    [a, ca, aa, JSON.stringify(repositoryPayload)],
  );
  synthetic.approvals.push(repositoryApproval.rows[0].id);
  const repositoryCheck = spawnSync("node", ["--conditions=react-server", "--import", "tsx", "scripts/test-db-repositories.ts"], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      TEST_DATABASE_URL_UNPOOLED: raw,
      DB_TEST_USER_A: a,
      DB_TEST_USER_B: b,
      DB_TEST_CONVERSATION_A: ca,
      DB_TEST_CONVERSATION_B: cb,
      DB_TEST_ACCOUNT_A: aa,
      DB_TEST_ACCOUNT_B: ab,
      DB_TEST_APPROVAL: repositoryApproval.rows[0].id,
      DB_TEST_APPROVAL_PAYLOAD: JSON.stringify(repositoryPayload),
    },
  });
  if (repositoryCheck.error || repositoryCheck.status !== 0) {
    throw new Error(`Database repository integration failed: ${(repositoryCheck.stderr || repositoryCheck.stdout || repositoryCheck.error?.message || "unknown error").trim()}`);
  }
  console.log(repositoryCheck.stdout.trim());
  await rejected("cross-owner approval conversation", () => client.query(approvalSql, [a, cb, aa]));
  await rejected("cross-owner approval account", () => client.query(approvalSql, [a, ca, ab]));
  await rejected("cross-owner conversation reference", () => client.query("insert into google_write_approvals(user_id,conversation_id,account_label,google_account_id,operation,payload,expires_at) values($1,$2,'personal',$3,'gmail.send','{}',now()+interval '5 minutes')", [a, cb, aa]));
  const approval = await client.query(approvalSql + " returning id", [a, ca, aa]);
  synthetic.approvals.push(approval.rows[0].id);
  const competingClient = new Client({ connectionString: raw });
  await competingClient.connect();
  try {
    const consume = (dbClient, userId, conversationId) => dbClient.query(
      "update google_write_approvals set consumed_at=now() where id=$1 and user_id=$2 and conversation_id=$3 and consumed_at is null and expires_at>now() returning id",
      [approval.rows[0].id, userId, conversationId],
    );
    const wrongUser = await consume(competingClient, b, ca);
    const wrongConversation = await consume(competingClient, a, cb);
    if (wrongUser.rowCount !== 0 || wrongConversation.rowCount !== 0) throw new Error("Approval was consumed by a wrong user or conversation.");
    const [first, second] = await Promise.all([consume(client, a, ca), consume(competingClient, a, ca)]);
    if (first.rowCount + second.rowCount !== 1) throw new Error("Concurrent approval consumption did not have exactly one winner.");
    const replay = await consume(competingClient, a, ca);
    if (replay.rowCount !== 0) throw new Error("Approval replay was accepted.");
  } finally {
    await competingClient.end();
  }
  executed.push("approval atomicity: wrong user/conversation rejected; concurrent consume had exactly one winner; replay rejected");

  const expiredApproval = await client.query(
    "insert into google_write_approvals(user_id,conversation_id,account_label,google_account_id,operation,payload,expires_at) values($1,$2,'personal',$3,'gmail.send',$4,now()-interval '1 minute') returning id",
    [a, ca, aa, JSON.stringify({ to: "allowed@example.test" })],
  );
  synthetic.approvals.push(expiredApproval.rows[0].id);
  const expiredConsume = await client.query("update google_write_approvals set consumed_at=now() where id=$1 and user_id=$2 and conversation_id=$3 and consumed_at is null and expires_at>now() returning id", [expiredApproval.rows[0].id, a, ca]);
  if (expiredConsume.rowCount !== 0) throw new Error("Expired approval was consumed.");
  executed.push("approval expiry: expired row not consumable");
  // Capability rows use the same nonce/expiry/consumption constraints as the application verifier.
  const nonce = `${prefix}_cap`;
  await client.query("insert into google_capabilities(nonce,expires_at) values($1,now()+interval '5 minutes')", [nonce]);
  synthetic.capabilities.push(nonce);
  const consumed = await client.query("update google_capabilities set consumed_at=now() where nonce=$1 and consumed_at is null and expires_at>now() returning nonce", [nonce]);
  const replay = await client.query("update google_capabilities set consumed_at=now() where nonce=$1 and consumed_at is null and expires_at>now() returning nonce", [nonce]);
  if (consumed.rowCount !== 1 || replay.rowCount !== 0) throw new Error("Capability nonce replay was not rejected.");
  executed.push("capability nonce: consumed once; replay rejected");
  // ── 0008: Dynamic account label constraints ──────────────────────────────
  // Dynamic label creation: any compliant label is accepted
  const aDynAcct = (await client.query(
    "insert into google_accounts(user_id,identity_id,label,refresh_token_ciphertext) values($1,$2,'my-work-label','synthetic') returning id",
    [a, ia]
  )).rows[0].id;
  synthetic.accounts.push(aDynAcct);
  executed.push("dynamic label creation ('my-work-label'): succeeded");

  // Case-insensitive duplicate rejection (google_accounts_user_label_ci_unique)
  await rejected("duplicate label case-insensitive (MY-WORK-LABEL)", () =>
    client.query(
      "insert into google_accounts(user_id,identity_id,label,refresh_token_ciphertext) values($1,$2,'MY-WORK-LABEL','synthetic')",
      [a, ia]
    )
  );

  // 'both' is rejected on google_accounts (google_accounts_label_check)
  await rejected("label='both' rejected on google_accounts", () =>
    client.query(
      "insert into google_accounts(user_id,identity_id,label,refresh_token_ciphertext) values($1,$2,'both','synthetic')",
      [a, ia]
    )
  );

  // conversations.account accepts 'both' (sentinel) and dynamic labels
  const convBoth = (await client.query(
    "insert into conversations(user_id,session_id,title,account) values($1,gen_random_uuid(),'test','both') returning id",
    [a]
  )).rows[0].id;
  synthetic.conversations.push(convBoth);
  executed.push("conversations.account='both': accepted");

  const convDyn = (await client.query(
    "insert into conversations(user_id,session_id,title,account) values($1,gen_random_uuid(),'test','my-work-label') returning id",
    [a]
  )).rows[0].id;
  synthetic.conversations.push(convDyn);
  executed.push("conversations.account='my-work-label': accepted");

  // conversations.account rejects invalid format (uppercase not allowed)
  await rejected("conversations.account='INVALID CAPS': rejected", () =>
    client.query(
      "insert into conversations(user_id,session_id,title,account) values($1,gen_random_uuid(),'test','INVALID CAPS')",
      [a]
    )
  );

  // ON UPDATE CASCADE: rename label propagates to google_write_approvals
  const dynApprovalId = (await client.query(
    "insert into google_write_approvals(user_id,conversation_id,account_label,google_account_id,operation,payload,expires_at) values($1,$2,'my-work-label',$3,'gmail.send','{}',now()+interval '5 minutes') returning id",
    [a, ca, aDynAcct]
  )).rows[0].id;
  synthetic.approvals.push(dynApprovalId);
  executed.push("approval referencing dynamic label 'my-work-label': succeeded");

  await client.query("update google_accounts set label='renamed-label' where id=$1", [aDynAcct]);
  const cascaded = await client.query("select account_label from google_write_approvals where id=$1", [dynApprovalId]);
  if (cascaded.rows[0]?.account_label !== "renamed-label") {
    throw new Error("ON UPDATE CASCADE did not propagate label rename to google_write_approvals");
  }
  executed.push("ON UPDATE CASCADE label rename propagated to approvals: verified");
  // ── end 0008 ─────────────────────────────────────────────────────────────

  console.log(`Cases: ${executed.length}`); for (const line of executed) console.log(`- ${line}`);
} catch (error) {
  const code = error?.code ? ` (${error.code})` : "";
  fail(`${connected ? "Integration test failed" : "PostgreSQL connection failed"}${code}: ${sanitizedMessage(error)}`);
} finally {
  if (connected) {
    try {
      if (!targetVerified) throw new Error("Cleanup skipped because the approved test database identity was not verified.");
      await verifyTestDatabase(client, raw);

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
