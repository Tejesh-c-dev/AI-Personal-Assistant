import { getConversation, listConversations } from "../src/lib/conversations";
import { findGoogleAccount } from "../src/lib/auth";
import { GoogleAuthorizationError, issueGoogleCapability, verifyGoogleCapability } from "../src/lib/google-api";
import { consumeGoogleWriteApproval } from "../src/lib/google-write-approvals";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for repository integration checks.`);
  return value;
}

async function main() {
  process.env.DATABASE_URL = required("TEST_DATABASE_URL_UNPOOLED");
  process.env.GOOGLE_CAPABILITY_SECRET = "synthetic_test_capability_secret_at_least_32_chars";
  const userA = required("DB_TEST_USER_A");
  const userB = required("DB_TEST_USER_B");
  const conversationA = required("DB_TEST_CONVERSATION_A");
  const conversationB = required("DB_TEST_CONVERSATION_B");
  const accountA = required("DB_TEST_ACCOUNT_A");
  const accountB = required("DB_TEST_ACCOUNT_B");
  const approval = required("DB_TEST_APPROVAL");
  const approvalPayload = JSON.parse(required("DB_TEST_APPROVAL_PAYLOAD")) as unknown;

  if (await getConversation(conversationB, userA) !== null) throw new Error("Repository returned User B conversation to User A.");
  if ((await listConversations(userA)).some((row) => row.id === conversationB)) throw new Error("Conversation list included User B data for User A.");
  if ((await getConversation(conversationA, userA)) === null) throw new Error("Repository failed to return User A's own conversation.");
  console.log("Repository conversation ownership: own conversation visible; other user's conversation hidden.");

  const aAccount = await findGoogleAccount(userA, "personal");
  const bAccountFromA = await findGoogleAccount(userA, "official");
  if (!aAccount || aAccount.id !== accountA || bAccountFromA !== null) throw new Error("Account repository did not enforce authenticated owner and account label scope.");
  const bAccount = await findGoogleAccount(userB, "official");
  if (!bAccount || bAccount.id !== accountB) throw new Error("Account repository failed to resolve User B's own label.");
  console.log("Repository account ownership: labels resolve only within the supplied authenticated user.");

  try {
    await issueGoogleCapability(userA, "official", ["gmail.search"]);
    throw new Error("User A issued a capability for User B's account label.");
  } catch (error) {
    if (!(error instanceof GoogleAuthorizationError) || error.code !== "RECONNECT_REQUIRED") throw error;
  }
  const ownCapability = await issueGoogleCapability(userA, "personal", ["gmail.search"], 60, {}, accountA);
  await verifyGoogleCapability(ownCapability, userA, "personal", "gmail.search");
  console.log("Capability authorization: cross-user label rejected; own account capability verified and nonce consumed.");

  const wrongOwner = await consumeGoogleWriteApproval({ id: approval, userId: userB, conversationId: conversationA });
  const wrongConversation = await consumeGoogleWriteApproval({ id: approval, userId: userA, conversationId: conversationB });
  if (wrongOwner !== null || wrongConversation !== null) throw new Error("Approval repository accepted wrong owner or conversation.");
  const consumed = await consumeGoogleWriteApproval({ id: approval, userId: userA, conversationId: conversationA });
  if (!consumed || consumed.accountId !== accountA || consumed.label !== "personal" || JSON.stringify(consumed.payload) !== JSON.stringify(approvalPayload)) throw new Error("Approval repository failed to consume the rightful owner's exact stored approval payload.");
  if (await consumeGoogleWriteApproval({ id: approval, userId: userA, conversationId: conversationA }) !== null) throw new Error("Approval repository accepted replay.");
  console.log("Approval repository: wrong owner/conversation rejected; exact stored payload consumed once; replay rejected.");
}

main().catch((error: unknown) => {
  console.error(`Database repository integration failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
