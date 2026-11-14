import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { validateTestUrl, verifyTestDatabase } from "./test-db-identity.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function stopServer(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL_UNPOOLED;
  validateTestUrl(databaseUrl);
  const migration = spawnSync(process.execPath, ["scripts/test-db.mjs"], {
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL_UNPOOLED: databaseUrl },
  });
  if (migration.status !== 0) throw new Error("The guarded test database setup failed.");

  const db = new Client({ connectionString: databaseUrl });
  const fixtures = { users: [], sessions: [], conversations: [] };
  const tokens = [];
  const providerRequests = [];
  const providerServer = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const valid = request.method === "POST"
      && request.url === "/v1/chat/completions"
      && request.headers.authorization === "Bearer local-chat-test-key"
      && payload?.provider?.zdr === true
      && payload?.provider?.data_collection === "deny"
      && payload?.provider?.require_parameters === true
      && payload?.provider?.allow_fallbacks === false;
    providerRequests.push({ valid, payload });
    response.writeHead(valid ? 200 : 400, { "content-type": "application/json" });
    response.end(JSON.stringify(valid ? {
      id: "local-test-response",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Local test response" } }],
    } : { error: { message: "Invalid local test request" } }));
  });
  const providerPort = await listen(providerServer);

  let nextProcess;
  let dbConnected = false;
  let appPort;
  let resultSummary;
  try {
    await db.connect();
    dbConnected = true;
    const identity = await verifyTestDatabase(db, databaseUrl);
    console.log(`Chat test database: host=${identity.host}, port=${identity.port}, database=${identity.database}, role=${identity.role}, container=${identity.containerId}, project=${identity.project}, internal_ip=${identity.address}.`);

    for (let index = 0; index < 2; index++) {
      const subject = `local_chat_test_${randomUUID()}`;
      const token = randomBytes(32).toString("base64url");
      const user = (await db.query(
        "insert into users(google_subject,email,name) values($1,$2,$3) returning id",
        [subject, `${subject}@example.test`, `Local Chat Test ${index + 1}`],
      )).rows[0];
      fixtures.users.push(user.id);
      const tokenHash = createHash("sha256").update(token).digest("base64url");
      const session = (await db.query(
        "insert into sessions(token_hash,user_id,expires_at,last_used_at) values($1,$2,now()+interval '10 minutes',now()) returning id",
        [tokenHash, user.id],
      )).rows[0];
      fixtures.sessions.push(session.id);
      tokens.push(token);
    }

    appPort = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      });
    });

    nextProcess = spawn(process.execPath, ["--import", "./scripts/test-network-guard.mjs", "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        DATABASE_URL_UNPOOLED: "",
        USE_ADK: "true",
        LLM_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "local-chat-test-key",
        OPENROUTER_MODEL: "synthetic/local-test-model",
        OPENROUTER_BASE_URL: `http://127.0.0.1:${providerPort}/v1/chat/completions`,
        OPENROUTER_TIMEOUT_MS: "10000",
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
      } catch { await delay(500); }
    }
    if (!ready) throw new Error("The local Next.js server did not become ready.");

    const sessionIds = [randomUUID(), randomUUID()];
    const testMessages = ["First isolated local chat", "Second isolated local chat"];
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `assistant_session=${tokens[index]}` },
        body: JSON.stringify({ message: testMessages[index], sessionId: sessionIds[index], account: "personal" }),
      });
      const payload = await response.json();
      if (response.status !== 200 || payload.output !== "Local test response") {
        throw new Error(`Authenticated local chat request ${index + 1} failed with HTTP ${response.status}.`);
      }
      const conversation = (await db.query(
        "select id,user_id from conversations where user_id=$1 and session_id=$2",
        [fixtures.users[index], sessionIds[index]],
      )).rows[0];
      if (!conversation || conversation.user_id !== fixtures.users[index]) throw new Error("Chat persistence did not retain the authenticated owner.");
      fixtures.conversations.push(conversation.id);
      const messages = (await db.query(
        "select role,content from messages where conversation_id=$1 order by created_at,id",
        [conversation.id],
      )).rows;
      if (messages.length !== 2 || messages[0].role !== "user" || messages[0].content !== testMessages[index]
        || messages[1].role !== "assistant" || messages[1].content !== "Local test response") {
        throw new Error("Chat messages were not persisted as expected.");
      }
    }

    const followUp = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `assistant_session=${tokens[0]}` },
      body: JSON.stringify({ message: "Continue the first isolated local chat", sessionId: sessionIds[0], account: "personal" }),
    });
    const followUpPayload = await followUp.json();
    if (followUp.status !== 200 || followUpPayload.output !== "Local test response") {
      throw new Error(`Authenticated follow-up chat request failed with HTTP ${followUp.status}.`);
    }
    const hydratedMessages = (await db.query(
      "select role,content from messages where conversation_id=$1 order by created_at,id",
      [fixtures.conversations[0]],
    )).rows;
    if (hydratedMessages.length !== 4
      || hydratedMessages[2].role !== "user"
      || hydratedMessages[2].content !== "Continue the first isolated local chat"
      || hydratedMessages[3].role !== "assistant"
      || hydratedMessages[3].content !== "Local test response") {
      throw new Error("Follow-up chat messages were not persisted for session hydration.");
    }
    const hydratedProviderPayload = JSON.stringify(providerRequests[2]?.payload ?? {});
    if (!hydratedProviderPayload.includes(testMessages[0]) || !hydratedProviderPayload.includes("Local test response")) {
      throw new Error("The follow-up model request did not include the persisted conversation history.");
    }

    const unauthenticated = await fetch(`http://127.0.0.1:${appPort}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Must be rejected", sessionId: randomUUID(), account: "personal" }),
    });
    if (unauthenticated.status !== 401) throw new Error("An unauthenticated chat request was not rejected.");
    if (providerRequests.length !== 3 || providerRequests.some((request) => !request.valid)) {
      throw new Error("The local model stub did not receive the expected privacy-constrained requests.");
    }
    resultSummary = "Authenticated chat, unauthenticated rejection, ownership, persistence, session hydration, and local provider checks passed.";
  } finally {
    try {
      if (nextProcess && nextProcess.exitCode === null) {
        nextProcess.kill("SIGTERM");
        const stopped = await Promise.race([
          new Promise((resolve) => nextProcess.once("exit", () => resolve(true))),
          delay(10000).then(() => false),
        ]);
        if (!stopped && nextProcess.exitCode === null) nextProcess.kill("SIGKILL");
      }
      if (dbConnected) {
        try {
          await db.query("delete from messages where conversation_id = any($1::uuid[])", [fixtures.conversations]);
          await db.query("delete from conversations where id = any($1::uuid[])", [fixtures.conversations]);
          await db.query("delete from sessions where id = any($1::uuid[])", [fixtures.sessions]);
          await db.query("delete from users where id = any($1::uuid[])", [fixtures.users]);
          const leftovers = await db.query(
            "select (select count(*) from users where id=any($1::uuid[])) + (select count(*) from sessions where id=any($2::uuid[])) + (select count(*) from conversations where id=any($3::uuid[])) as count",
            [fixtures.users, fixtures.sessions, fixtures.conversations],
          );
          if (Number(leftovers.rows[0].count) !== 0) throw new Error("Synthetic chat-test rows remain after cleanup.");
        } finally {
          await db.end();
        }
      }
    } finally {
      await stopServer(providerServer);
    }
  }

  console.log(`test:local-chat: ${resultSummary}`);
}

main().catch((error) => {
  const code = error?.code && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : "";
  console.error(`test:local-chat: failed${code}: ${error?.message ?? "unexpected error"}`);
  process.exitCode = 1;
});
