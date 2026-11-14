import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { writeFile } from "node:fs/promises";
import { Client } from "pg";
import nextEnv from "@next/env";
import { validateTestUrl, verifyTestDatabase } from "./test-db-identity.mjs";

const MODEL = "inclusionai/ling-3.2-flash:free";
const NETWORK_GUARD = "--import=./scripts/test-network-guard.mjs";
const nodeOptions = [process.env.NODE_OPTIONS, NETWORK_GUARD].filter(Boolean).join(" ");

nextEnv.loadEnvConfig(process.cwd());

class SafeTestError extends Error {}

function assert(condition, message) {
  if (!condition) throw new SafeTestError(message);
}

function safeErrorCategory(error) {
  if (error?.code && /^[A-Z0-9_]+$/.test(error.code)) return ` (${error.code})`;
  return "";
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function stopNext(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 10_000)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL_UNPOOLED;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  assert(databaseUrl, "TEST_DATABASE_URL_UNPOOLED is required; no application URL fallback is permitted.");
  validateTestUrl(databaseUrl);
  assert(apiKey, "OPENROUTER_API_KEY is required for the live integration test.");

  const migration = spawnSync(process.execPath, ["scripts/test-db.mjs"], {
    stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: nodeOptions, TEST_DATABASE_URL_UNPOOLED: databaseUrl },
    windowsHide: true,
  });
  assert(migration.status === 0, "The guarded test database setup failed.");

  const db = new Client({ connectionString: databaseUrl });
  const fixtures = { users: [], sessions: [], conversations: [] };
  const sessionTokens = [];
  const sessionIds = [randomUUID(), randomUUID()];
  const marker = `SYNTHETIC-${randomBytes(6).toString("hex").toUpperCase()}`;
  const firstPrompt = `This is a synthetic integration check. Remember this code for my next message: ${marker}. Reply with a brief acknowledgement.`;
  const followUpPrompt = "What synthetic code did I ask you to remember? Reply with the code only.";
  let dbConnected = false;
  let nextProcess;
  let responseText;
  let followUpText;
  let cleanupVerified = false;
  let appPort;

  try {
    await db.connect();
    dbConnected = true;
    const identity = await verifyTestDatabase(db, databaseUrl);
    console.log(`Live chat database guard passed: service=${identity.service}, host=${identity.host}, port=${identity.port}, database=${identity.database}, container=${identity.containerId}.`);

    for (let index = 0; index < 2; index++) {
      const subject = `live_chat_test_${randomUUID()}`;
      const token = randomBytes(32).toString("base64url");
      const user = (await db.query(
        "insert into users(google_subject,email,name) values($1,$2,$3) returning id",
        [subject, `${subject}@example.test`, `Live Chat Test ${index + 1}`],
      )).rows[0];
      fixtures.users.push(user.id);
      const tokenHash = createHash("sha256").update(token).digest("base64url");
      const session = (await db.query(
        "insert into sessions(token_hash,user_id,expires_at,last_used_at) values($1,$2,now()+interval '10 minutes',now()) returning id",
        [tokenHash, user.id],
      )).rows[0];
      fixtures.sessions.push(session.id);
      sessionTokens.push(token);
    }

    const accountCount = await db.query("select count(*)::int as count from google_accounts where user_id = any($1::uuid[])", [fixtures.users]);
    const identityCount = await db.query("select count(*)::int as count from google_identities where user_id = any($1::uuid[])", [fixtures.users]);
    assert(Number(accountCount.rows[0].count) === 0 && Number(identityCount.rows[0].count) === 0, "Synthetic users unexpectedly have Google accounts or identities.");

    appPort = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      });
    });

    nextProcess = spawn(process.execPath, ["--import", "./scripts/test-network-guard.mjs", "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: "development",
        NODE_OPTIONS: nodeOptions,
        DATABASE_URL: databaseUrl,
        DATABASE_URL_UNPOOLED: "",
        TEST_DATABASE_URL_UNPOOLED: "",
        USE_ADK: "true",
        LLM_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: apiKey,
        OPENROUTER_MODEL: MODEL,
        OPENROUTER_BASE_URL: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        GOOGLE_REDIRECT_URI: "",
        GOOGLE_TOKEN_ENCRYPTION_KEY: "",
        GOOGLE_CAPABILITY_SECRET: "",
        GOOGLE_GEMINI_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
        GOOGLE_GENAI_API_KEY: "",
        N8N_WEBHOOK_URL: "",
        N8N_WEBHOOK_SECRET: "",
        STAGING_DATABASE_URL: "",
        STAGING_DATABASE_URL_UNPOOLED: "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });

    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      if (nextProcess.exitCode !== null) throw new Error("The local Next.js server exited during startup.");
      try {
        await fetch(`http://127.0.0.1:${appPort}/api/auth/me`, { signal: AbortSignal.timeout(1000) });
        ready = true;
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    assert(ready, "The local Next.js server did not become ready.");

    async function sendChat(message, sessionId, token) {
      const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `assistant_session=${token}` },
        body: JSON.stringify({ message, sessionId, account: "personal" }),
        signal: AbortSignal.timeout(180_000),
      });
      let payload;
      try { payload = await response.json(); } catch { throw new Error("The chat route returned invalid JSON."); }
      assert(response.status === 200 && typeof payload.output === "string" && payload.output.trim().length > 0, `The authenticated chat route failed with HTTP ${response.status}.`);
      return payload.output;
    }

    responseText = await sendChat(firstPrompt, sessionIds[0], sessionTokens[0]);
    followUpText = await sendChat(followUpPrompt, sessionIds[0], sessionTokens[0]);
    assert(followUpText.toLowerCase().includes(marker.toLowerCase()), "The real OpenRouter follow-up response did not recall the synthetic session marker.");

    const conversation = (await db.query(
      "select id,user_id from conversations where user_id=$1 and session_id=$2",
      [fixtures.users[0], sessionIds[0]],
    )).rows[0];
    assert(conversation && conversation.user_id === fixtures.users[0], "Conversation ownership was not persisted for the synthetic user.");
    fixtures.conversations.push(conversation.id);
    const messages = (await db.query(
      "select role,content from messages where conversation_id=$1 order by created_at,id",
      [conversation.id],
    )).rows;
    assert(messages.length === 4, "The live chat did not persist exactly two user and two assistant messages.");
    const persistedMessages = new Set(messages.map((message) => `${message.role}\u0000${message.content}`));
    assert(persistedMessages.has(`user\u0000${firstPrompt}`), "The initial synthetic user message was not persisted.");
    assert(persistedMessages.has(`assistant\u0000${responseText}`), "The initial OpenRouter response was not persisted exactly.");
    assert(persistedMessages.has(`user\u0000${followUpPrompt}`), "The follow-up user message was not persisted.");
    assert(persistedMessages.has(`assistant\u0000${followUpText}`), "The follow-up OpenRouter response was not persisted exactly.");

    const unauthenticated = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "synthetic unauthenticated check", sessionId: randomUUID(), account: "personal" }),
    });
    assert(unauthenticated.status === 401, "An unauthenticated chat request was not rejected.");
  } finally {
    await stopNext(nextProcess);
    if (dbConnected) {
      try {
        await verifyTestDatabase(db, databaseUrl);
        const conversations = await db.query(
          "select id from conversations where user_id = any($1::uuid[]) or id = any($2::uuid[])",
          [fixtures.users, fixtures.conversations],
        );
        const conversationIds = [...new Set([...fixtures.conversations, ...conversations.rows.map((row) => row.id)])];
        await db.query("delete from messages where conversation_id = any($1::uuid[])", [conversationIds]);
        await db.query("delete from google_write_approvals where user_id = any($1::uuid[])", [fixtures.users]);
        await db.query("delete from conversations where id = any($1::uuid[])", [conversationIds]);
        await db.query("delete from google_accounts where user_id = any($1::uuid[])", [fixtures.users]);
        await db.query("delete from google_identities where user_id = any($1::uuid[])", [fixtures.users]);
        await db.query("delete from oauth_transactions where initiating_user_id = any($1::uuid[])", [fixtures.users]);
        await db.query("delete from sessions where id = any($1::uuid[])", [fixtures.sessions]);
        await db.query("delete from users where id = any($1::uuid[])", [fixtures.users]);

        const leftovers = await db.query(`
          select
            (select count(*) from users where id = any($1::uuid[])) +
            (select count(*) from sessions where id = any($2::uuid[])) +
            (select count(*) from conversations where id = any($3::uuid[])) +
            (select count(*) from messages where conversation_id = any($3::uuid[])) +
            (select count(*) from google_identities where user_id = any($1::uuid[])) +
            (select count(*) from google_accounts where user_id = any($1::uuid[])) +
            (select count(*) from google_write_approvals where user_id = any($1::uuid[])) +
            (select count(*) from oauth_transactions where initiating_user_id = any($1::uuid[])) as count
        `, [fixtures.users, fixtures.sessions, conversationIds]);
        assert(Number(leftovers.rows[0].count) === 0, "Synthetic live-chat records remain after cleanup.");
        cleanupVerified = true;
      } finally {
        await db.end();
      }
    }
  }

  assert(cleanupVerified, "Synthetic record cleanup could not be verified.");
  if (process.env.LIVE_CHAT_RESPONSE_REPORT_PATH) {
    await writeFile(process.env.LIVE_CHAT_RESPONSE_REPORT_PATH, JSON.stringify({ firstResponse: responseText, followUpResponse: followUpText }), { flag: "wx", mode: 0o600 });
  }
  console.log(`test:live-chat: actual Next.js /api/chat -> Google ADK Runner -> OpenRouter (${MODEL}) passed; synthetic session history and PostgreSQL persistence verified; Google accounts=0; live request body privacy fields verified; cleanup=0 remaining.`);
}

main().catch((error) => {
  const message = error instanceof SafeTestError ? error.message : "unexpected integration failure";
  console.error(`test:live-chat: failed${safeErrorCategory(error)}: ${message}`);
  process.exitCode = 1;
});
