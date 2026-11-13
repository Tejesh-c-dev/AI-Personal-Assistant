
# AI Personal Assistant — Master Implementation Plan

**Version:** 1.0  
**Status:** Architecture Approved — Implementation Pending  
**Architecture:** TypeScript + Google ADK + Next.js  
**Deployment Target:** Free-tier hosting wherever feasible

---

# 1. Project Overview

Build a secure, multi-user AI Personal Assistant that allows users to connect multiple Google accounts and manage their productivity through natural language.

The assistant will support:

- Gmail
- Google Calendar
- Google Docs
- Multiple Google account connections
- AI-powered task orchestration
- Conversation history
- Persistent memory
- Human approval for sensitive operations
- Secure multi-user data isolation

The application must support multiple independent users. Each user must have access only to their own data and connected Google accounts.

## Core Principles

1. Security before functionality.
2. Preserve existing working infrastructure.
3. Avoid unnecessary architectural complexity.
4. Use TypeScript throughout.
5. Keep Google credentials outside the AI agent.
6. Enforce permissions on the backend.
7. Persist conversations and sessions in PostgreSQL.
8. Prefer free services and open-source technologies.
9. Avoid unnecessary feature expansion.
10. Test every feature before marking it complete.

---

# 2. Confirmed Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Frontend | Next.js | User interface |
| Language | TypeScript | Application and backend |
| UI | React | Frontend components |
| Styling | Tailwind CSS | UI styling |
| Agent Framework | Google ADK | Agent orchestration |
| Initial AI Model | Gemini | AI inference |
| Model Architecture | Provider abstraction | Future model flexibility |
| Database | Neon PostgreSQL | Persistent storage |
| ORM | Drizzle ORM | Database operations |
| Authentication | Google OAuth 2.0 / OIDC | Application login |
| Integrations | Google APIs | Gmail, Calendar, Docs |
| Hosting | Vercel | Application deployment |
| Version Control | GitHub | Source code management |

## Technology Decisions

- Use Google ADK TypeScript.
- Do not migrate the application to Python.
- Keep the existing Next.js application.
- Keep the existing Neon database.
- Preserve existing Drizzle migrations.
- Replace n8n with ADK.
- Use Gemini initially.
- Design a provider abstraction, but verify actual provider compatibility.
- Prefer free-tier services.

## Compatibility Verification

Before implementation:

- Verify ADK TypeScript compatibility.
- Verify Node.js requirements.
- Verify Vercel runtime compatibility.
- Verify model provider support.
- Verify streaming support.
- Verify serverless execution constraints.

Do not upgrade the entire project unnecessarily.

---

# 3. Product Architecture

## 3.1 Application Identity

Each user signs into the application using one Google account.

This account establishes their application identity.

Example:

User A:
- Login identity: login@gmail.com

User B:
- Login identity: userb@gmail.com

These identities must remain separate.

## 3.2 Multiple Google Account Connections

After signing in, users can connect additional Google accounts.

Example:

User A:
- Login identity: login@gmail.com
- Personal Gmail: personal@gmail.com
- Official Gmail: official@gmail.com
- Additional Gmail: another@gmail.com

Each connected Google account can independently authorize:

- Gmail
- Google Calendar
- Google Docs

The application must not assume that the login identity is the only Google account available.

## 3.3 Account Management

Users must be able to:

- Add Google accounts.
- Disconnect Google accounts.
- Rename connected accounts.
- View connection status.
- View granted permissions.
- Select a default account.
- Select an account for individual operations.
- Choose multiple accounts for permitted read operations.

Account labels are user-defined metadata, not security boundaries.

## 3.4 Account Selection

Support:

- Personal
- Official
- Other connected accounts
- All permitted accounts

For read operations, users may request information across multiple accounts.

For write operations, the application must identify and pin the exact target account.

If the account is ambiguous, ask the user instead of guessing.

---

# 4. High-Level System Architecture

```text
                       USER
                         |
                         v
                  NEXT.JS FRONTEND
                         |
                         v
                GOOGLE AUTHENTICATION
                         |
                         v
                 AUTHENTICATED USER
                         |
                         v
                    CHAT API
                         |
                         v
                REQUEST VALIDATION
                         |
                         v
                 GOOGLE ADK AGENT
                         |
                    ROOT AGENT
                         |
              +----------+----------+
              |          |          |
              v          v          v
            GMAIL     CALENDAR     DOCS
            TOOLS       TOOLS      TOOLS
              |          |          |
              +----------+----------+
                         |
                         v
                SECURE GOOGLE BROKER
                         |
                  AUTHORIZATION
                         |
                  ACCOUNT RESOLUTION
                         |
                  TOKEN RETRIEVAL
                         |
                         v
                    GOOGLE APIs
```

PostgreSQL provides persistent storage for:

- Users
- Authentication identities
- Google accounts
- Encrypted tokens
- Conversations
- Messages
- Agent sessions
- Approvals
- Tool execution logs
- User preferences
- User memories

## Critical Architectural Principle

ADK determines which action is required.

The backend determines whether the action is authorized.

The agent must never independently enforce user isolation or receive unrestricted Google credentials.

---

# 5. Database Architecture

Preserve the existing database and migrations wherever possible.

The following is the target logical schema.

| Table | Responsibility |
|---|---|
| users | Application users |
| auth_identities | Google login identities |
| google_accounts | Connected Google accounts |
| google_tokens | Encrypted OAuth tokens |
| oauth_transactions | OAuth state and transaction management |
| conversations | User conversations |
| messages | Conversation messages |
| agent_sessions | ADK session persistence |
| approvals | Pending and completed approvals |
| tool_execution_logs | Tool execution audit history |
| user_preferences | User settings |
| user_memories | Persistent assistant memory |

## Database Relationships

```text
users
  |
  +--- auth_identities
  |
  +--- google_accounts
  |       |
  |       +--- google_tokens
  |
  +--- conversations
  |       |
  |       +--- messages
  |       +--- agent_sessions
  |
  +--- approvals
  |
  +--- tool_execution_logs
  |
  +--- user_preferences
  |
  +--- user_memories
```

## Database Security Requirements

- Every user-owned resource must have an owner.
- Every connected Google account must belong to one application user.
- Every conversation must belong to one application user.
- Every approval must be associated with its owner.
- Every approval must reference the correct account and conversation.
- Every agent session must be isolated by user.
- Every tool execution must be associated with an authenticated user.
- Use composite foreign keys where appropriate.
- Enforce ownership at both application and database levels.

## Google Account Metadata

Each connected account should maintain:

- Google subject identifier (`sub`).
- Email address.
- Display name.
- User-defined account label.
- Encrypted refresh token.
- Granted OAuth scopes.
- Connection status.
- Creation timestamp.
- Last successful connection.
- Revocation status.

Use Google's stable subject identifier as the identity key rather than relying only on email addresses.

---

# 6. Authentication Architecture

## Application Login

Use Google OAuth 2.0 / OIDC.

Responsibilities:

1. Authenticate the user.
2. Verify the Google identity.
3. Find or create the application user.
4. Create a secure application session.
5. Set a secure HTTP-only cookie.

## Additional Google Account Connection

Implement a separate OAuth connection flow.

Responsibilities:

1. Verify the existing application session.
2. Create a secure account-linking transaction.
3. Redirect the user to Google OAuth.
4. Request required permissions.
5. Validate the callback.
6. Verify the Google account identity.
7. Encrypt and store tokens.
8. Associate the account with the authenticated application user.
9. Update account connection status.

## OAuth Security

- Random state parameters.
- One-time OAuth transactions.
- Expiration.
- CSRF protection.
- Correct callback validation.
- Separate login and account-linking purposes.
- Secure token storage.
- No tokens in frontend responses.
- Proper account revocation handling.

Use incremental authorization where appropriate.

Review Google's OAuth consent and verification requirements before public release.

---

# 7. Google ADK Agent Architecture

Start with one root assistant agent and logically separated tool groups.

Avoid unnecessary multi-agent complexity.

## Root Assistant Agent

Responsibilities:

- Understand user requests.
- Identify intent.
- Select relevant tools.
- Coordinate operations.
- Manage tool execution.
- Produce responses.
- Request clarification when necessary.

## Gmail Tool Group

Responsibilities:

- Search emails.
- Read emails.
- Summarize emails.
- Create drafts.
- Send emails.

## Calendar Tool Group

Responsibilities:

- List calendar events.
- Read event details.
- Find availability.
- Create events.
- Update events.
- Delete events.

## Google Docs Tool Group

Responsibilities:

- Read documents.
- Export documents.
- Create documents.
- Insert content.

Initially, these are tool groups, not necessarily independent agents.

## Agent Session Management

ADK session state must not depend on temporary in-memory storage.

Use PostgreSQL as the durable source of truth.

Requirements:

- Persistent session identifiers.
- User-bound sessions.
- Conversation mapping.
- Session reconstruction.
- Context management.
- Session expiration.
- Session deletion.

---

# 8. Secure Google API Broker

The existing Google broker must remain the central gateway for Google API access.

ADK must not receive unrestricted OAuth credentials.

## Execution Flow

```text
ADK Agent
    |
    v
Registered Google Tool
    |
    v
Authenticated User Context
    |
    v
Authorization Validation
    |
    v
Account Ownership Validation
    |
    v
Google Broker
    |
    v
Encrypted Token Retrieval
    |
    v
Google API
```

## Tool Requirements

Every tool must implement:

- Input validation.
- Authenticated user context.
- Account ownership validation.
- Permission validation.
- OAuth scope validation.
- Error handling.
- Execution timeout.
- Audit logging.

Never trust account IDs or user IDs supplied directly by the model.

The backend must establish the authenticated user context.

---

# 9. Google Integration Specifications

## 9.1 Gmail

| Tool | Operation | Approval |
|---|---|---|
| gmail_search | Search emails | No |
| gmail_get | Read email | No |
| gmail_draft | Create draft | No |
| gmail_send | Send email | Yes |

Requirements:

- Search across selected accounts.
- Read individual messages.
- Summarize conversations.
- Draft emails.
- Preview recipients and content.
- Require approval before sending.
- Record execution results.

## 9.2 Google Calendar

| Tool | Operation | Approval |
|---|---|---|
| calendar_list | List events | No |
| calendar_get | Read event | No |
| calendar_create | Create event | Yes |
| calendar_update | Update event | Yes |
| calendar_delete | Delete event | Yes |

Requirements:

- Read calendars.
- List upcoming events.
- Inspect event details.
- Find available time slots.
- Create events.
- Update events.
- Delete events with confirmation.

## 9.3 Google Docs

| Tool | Operation | Approval |
|---|---|---|
| docs_get | Read document | No |
| docs_export | Export document | No |
| docs_create | Create document | Yes |
| docs_insert | Insert content | Yes |

Requirements:

- Read document content.
- Export supported formats.
- Create documents.
- Insert content.
- Preview modifications.
- Require approval for write operations.

---

# 10. Human Approval System

Sensitive operations must require explicit approval.

## Approval Matrix

| Operation | Approval |
|---|---|
| Search emails | No |
| Read emails | No |
| Summarize emails | No |
| Read calendar | No |
| Read documents | No |
| Create email draft | No |
| Send email | Yes |
| Create calendar event | Yes |
| Update calendar event | Yes |
| Delete calendar event | Yes |
| Create document | Yes |
| Insert document content | Yes |

## Approval Requirements

Each approval must be bound to:

- Authenticated user.
- Conversation ID.
- Google account ID.
- Exact operation.
- Exact operation parameters.
- Creation timestamp.
- Expiration timestamp.
- Approval status.

## Approval Execution

```text
User Request
     |
     v
Prepare Operation
     |
     v
Show Operation Preview
     |
     v
Request User Approval
     |
     v
Validate Approval
     |
     v
Validate Account Ownership
     |
     v
Execute Operation
     |
     v
Record Execution
```

Reject approvals if:

- The parameters change.
- The account changes.
- The account is disconnected.
- The approval expires.
- The approval has already been consumed.
- The user does not own the approval.

Backend enforcement is mandatory. Prompt instructions alone are insufficient.

---

# 11. Conversation and Memory Architecture

Maintain two distinct types of memory.

## Short-Term Memory

Contains:

- Current conversation.
- Previous messages.
- Current task.
- Tool execution context.
- Pending approvals.

## Long-Term Memory

Contains:

- User preferences.
- User-provided information.
- Frequently used settings.
- Relevant personalization context.

## Isolation Requirements

```text
User A
  |
  +--- Conversation 1
  +--- Conversation 2
  +--- Personal Memory

User B
  |
  +--- Conversation 1
  +--- Conversation 2
  +--- Personal Memory
```

No shared conversation history or user memory.

## Required Features

- Conversation history.
- Create conversation.
- Rename conversation.
- Delete conversation.
- Persistent sessions.
- Context management.
- Memory management.
- User-specific preferences.
- Memory retention controls.

---

# 12. Frontend Architecture

Preserve the existing Next.js frontend.

Improve it without unnecessary rebuilding.

## Required Screens

### 12.1 Chat Dashboard

- Chat interface.
- Conversation sidebar.
- New conversation.
- Streaming AI responses.
- Tool execution indicators.
- Error notifications.

### 12.2 Connected Accounts

- Add Google account.
- Disconnect account.
- Rename account.
- View connection status.
- View granted permissions.
- Select default account.

### 12.3 Approval Center

- Pending approvals.
- Email previews.
- Calendar event previews.
- Document modification previews.
- Approve and reject actions.
- Execution status.

### 12.4 Settings

- Application profile.
- Default account preferences.
- Memory controls.
- Privacy settings.
- Session management.

## Chat Execution Indicators

Clearly distinguish:

- Thinking.
- Searching.
- Reading.
- Drafting.
- Waiting for approval.
- Executing.
- Completed.
- Failed.

## UI Requirements

- Responsive design.
- Accessible components.
- Clear error messages.
- Loading states.
- Streaming responses.
- Consistent visual design.

---

# 13. Security Requirements

Security is a mandatory release gate.

## Authentication Security

- Verified Google identity.
- Secure application sessions.
- HTTP-only cookies.
- Session expiration.
- Session revocation.

## Account Security

- Encrypted OAuth refresh tokens.
- Strict account ownership checks.
- Scope validation.
- Secure token refresh.
- Revocation handling.
- No frontend token exposure.

## Agent Security

- No direct Google credentials.
- Server-controlled tool context.
- Validated tool parameters.
- Limited tool permissions.
- Execution timeouts.
- Rate limits.

## Data Isolation Tests

| Test | Expected Result |
|---|---|
| User A accesses A's Gmail | Allowed |
| User B accesses B's Gmail | Allowed |
| User A accesses B's Gmail | Rejected |
| User B accesses A's Gmail | Rejected |
| User A accesses B's Calendar | Rejected |
| User A accesses B's Docs | Rejected |
| User A accesses B's conversation | Rejected |
| User A accesses B's approval | Rejected |
| User A accesses B's ADK session | Rejected |
| User A retrieves B's tokens | Rejected |

Additional tests:

- Expired sessions.
- Revoked sessions.
- Modified account IDs.
- Reused approvals.
- Expired approvals.
- Account disconnection during execution.
- Concurrent user requests.
- Concurrent conversations.

**Release requirement: Zero cross-user data-access vulnerabilities.**

---

# 14. Free Hosting and Cost Strategy

Prefer free-tier services wherever feasible.

| Service | Proposed Platform |
|---|---|
| Frontend | Vercel Hobby |
| Backend | Vercel Functions |
| Database | Neon Free |
| Agent Framework | Google ADK |
| AI Inference | Gemini API free quota, if eligible |
| Authentication | Google OAuth |
| Google Integrations | Google APIs |
| Version Control | GitHub |

## Cost Requirements

- No paid service without prior discussion.
- Track model usage.
- Implement request limits.
- Implement token limits.
- Limit tool iterations.
- Implement execution timeouts.
- Handle provider quota exhaustion.
- Avoid unnecessary infrastructure.

## Hosting Constraints

Verify:

- Vercel execution duration.
- Streaming support.
- Node.js compatibility.
- ADK dependencies.
- Database connection limits.
- Gemini API quotas.
- Google API quotas.
- OAuth verification requirements.

Do not assume free-tier services are suitable for unrestricted commercial usage.

---

# 15. Deployment Architecture

```text
                 GITHUB
                    |
                    v
                  VERCEL
                    |
                    v
             NEXT.JS APPLICATION
                    |
          +---------+---------+
          |         |         |
          v         v         v
        NEON     GOOGLE     GOOGLE
        DB       OAUTH      APIS
                    |
                    v
                GOOGLE ADK
                    |
                    v
             SECURE BROKER
```

## Deployment Requirements

- Production environment variables.
- OAuth callback configuration.
- Database migration verification.
- Production build.
- API error handling.
- Logging.
- Rate limiting.
- Security headers.
- Production smoke tests.

Initially retain the existing deployment URL:

https://ai-personal-assistant-orcin.vercel.app

Do not introduce unnecessary domain or hosting changes.

Validate ADK execution compatibility before finalizing the deployment architecture.

---

# 16. Testing Strategy

Testing must happen throughout development.

## Authentication Tests

- Successful login.
- Failed login.
- Invalid OAuth state.
- Expired OAuth transaction.
- Account linking.
- Account disconnection.
- Session expiration.

## Database Tests

- User ownership.
- Account ownership.
- Conversation ownership.
- Approval ownership.
- Composite foreign keys.
- Migration consistency.

## Google Integration Tests

- Gmail search.
- Gmail read.
- Gmail draft.
- Gmail send.
- Calendar list.
- Calendar read.
- Calendar create.
- Calendar update.
- Calendar delete.
- Docs read.
- Docs export.
- Docs create.
- Docs insert.

## Approval Tests

- Unauthorized execution.
- Successful approval.
- Modified parameters.
- Wrong account.
- Expired approval.
- Reused approval.
- Disconnected account.

## Agent Tests

- Intent identification.
- Tool selection.
- Invalid tool arguments.
- Tool execution failures.
- Model failures.
- Context handling.
- Multiple tool operations.

## Production Tests

- Concurrent users.
- Concurrent conversations.
- Application restart.
- Database failures.
- Google API failures.
- OAuth token expiration.
- Provider quota exhaustion.

---

# 17. Development Phases

Implementation must follow this exact sequence.

| Phase | Description | Completion Criteria |
|---|---|---|
| 0 | Existing repository audit | Existing architecture documented |
| 1 | Architecture and dependency validation | ADK TypeScript proof-of-concept |
| 2 | Security foundation | Isolation tests pass |
| 3 | ADK integration | Root agent works |
| 4 | Gmail integration | Gmail tools tested |
| 5 | Calendar integration | Calendar tools tested |
| 6 | Docs integration | Docs tools tested |
| 7 | Approval system | Write operations protected |
| 8 | Conversation and memory | Persistent isolated sessions |
| 9 | Frontend integration | Complete user experience |
| 10 | Production testing | Regression and security tests pass |
| 11 | Deployment and n8n removal | ADK-only deployment verified |

---

# 18. Existing Infrastructure Preservation

Do not rebuild working components without a technical reason.

| Existing Component | Decision |
|---|---|
| Next.js application | Preserve |
| Neon PostgreSQL | Preserve |
| Drizzle schema | Audit and extend |
| Google login | Preserve after audit |
| Google OAuth connection system | Preserve after audit |
| Encrypted token storage | Preserve |
| Google API broker | Preserve and adapt |
| Approval infrastructure | Preserve and adapt |
| Conversation infrastructure | Preserve and adapt |
| n8n webhook | Replace |
| Cloudflare tunnel | Remove after cutover |
| n8n workflows | Archive until parity is verified |

Before modifying anything, inspect the existing implementation.

Do not assume that an existing feature is broken merely because the architecture changes.

---

# 19. n8n Migration Strategy

Replace n8n with Google ADK.

However, do not remove n8n immediately.

Migration sequence:

1. Audit existing n8n workflows.
2. Document all existing operations.
3. Map operations to ADK tools.
4. Implement equivalent functionality.
5. Run integration tests.
6. Run security tests.
7. Compare results.
8. Verify all required functionality.
9. Switch production traffic.
10. Remove n8n webhook integration.
11. Remove obsolete environment variables.
12. Remove Cloudflare tunnel dependencies.
13. Archive old workflows.

Do not delete existing workflows until replacement functionality is verified.

---

# 20. Features Postponed Beyond Version 1

Avoid scope creep.

The following features are not part of the initial release:

- WhatsApp integration.
- Telegram integration.
- Voice assistant.
- Mobile application.
- Microsoft Outlook.
- Contacts management.
- Advanced Google Drive management.
- Autonomous background agents.
- Complex multi-agent collaboration.
- Advanced analytics dashboard.
- Paid hosting infrastructure.

These can be evaluated after the initial release is stable.

---

# 21. Phase 0 — Immediate Next Step

Before writing new implementation code, perform a read-only repository audit.

## Audit Tasks

1. Inspect the entire repository structure.
2. Inspect Next.js frontend architecture.
3. Inspect API routes.
4. Inspect Google authentication.
5. Inspect OAuth account linking.
6. Inspect encrypted token storage.
7. Inspect database schema.
8. Inspect migrations.
9. Inspect Google API broker.
10. Inspect approval implementation.
11. Inspect conversations and sessions.
12. Inspect existing tests.
13. Inspect n8n integration.
14. Identify obsolete code.
15. Identify security vulnerabilities.

## Required Audit Documents

Create these documents:

### ARCHITECTURE_AUDIT.md

Document:

- Existing architecture.
- Technologies.
- Main modules.
- Data flow.
- API routes.
- Database relationships.
- Existing functionality.

### PRESERVATION_PLAN.md

Document:

- Working components.
- Components to preserve.
- Components requiring modification.
- Components safe to remove.
- Reasons for every proposed replacement.

### MIGRATION_PLAN.md

Document:

- n8n to ADK migration.
- Existing broker integration.
- Session migration.
- Model integration.
- Deployment changes.

### SECURITY_AUDIT.md

Document:

- Authentication security.
- OAuth security.
- Account isolation.
- Token encryption.
- Approval enforcement.
- Cross-user access risks.
- Required security tests.

### IMPLEMENTATION_ROADMAP.md

Document:

- Phase order.
- Dependencies.
- Implementation tasks.
- Acceptance criteria.
- Testing requirements.

## Phase 0 Restrictions

- Read-only audit.
- No source-code modifications.
- No database schema changes.
- No migrations.
- No package upgrades.
- No deployment changes.
- No removal of existing functionality.

The audit must be based on actual repository contents, not assumptions.

---

# 22. Development Rules

These rules apply throughout the project.

1. No unnecessary architecture changes.
2. No feature expansion without approval.
3. No unnecessary dependency additions.
4. No replacing working authentication.
5. No replacing working database infrastructure.
6. No exposing Google credentials to agents.
7. No trusting AI prompts for authorization.
8. No skipping automated tests.
9. No declaring completion without verification.
10. No deleting existing infrastructure before migration.
11. No large, uncontrolled coding-agent prompts.
12. No proceeding past critical unresolved bugs.
13. Update documentation after each major phase.
14. Review every important code change.
15. Preserve backward compatibility where possible.

## Implementation Workflow

Every feature follows:

```text
Inspect
   |
   v
Plan
   |
   v
Implement
   |
   v
Test
   |
   v
Review
   |
   v
Regression Test
   |
   v
Document
   |
   v
Mark Complete
```

Use small, focused Codex or Claude Code tasks.

Each task must specify:

- Objective.
- Existing files to inspect.
- Expected modifications.
- Constraints.
- Security considerations.
- Tests to execute.
- Completion criteria.

---

# 23. Final Version 1.0 Definition of Done

## Authentication

- [ ] Google login works.
- [ ] Multiple users supported.
- [ ] Multiple Google accounts supported.
- [ ] Account linking works.
- [ ] Account disconnection works.
- [ ] OAuth security verified.

## Google Integrations

- [ ] Gmail search works.
- [ ] Gmail read works.
- [ ] Gmail draft works.
- [ ] Gmail send works with approval.
- [ ] Calendar read works.
- [ ] Calendar create works with approval.
- [ ] Calendar update works with approval.
- [ ] Calendar delete works with approval.
- [ ] Google Docs read works.
- [ ] Google Docs export works.
- [ ] Google Docs create works with approval.
- [ ] Google Docs insert works with approval.

## AI Functionality

- [ ] Google ADK TypeScript integrated.
- [ ] Root assistant operational.
- [ ] Gemini model operational.
- [ ] Model provider abstraction implemented.
- [ ] Tool orchestration works.
- [ ] Error handling works.

## Security

- [ ] User isolation verified.
- [ ] Account isolation verified.
- [ ] Encrypted token storage verified.
- [ ] No frontend token exposure.
- [ ] No direct Google credentials in ADK.
- [ ] Backend approval enforcement works.
- [ ] Audit logging works.

## Application

- [ ] Chat interface works.
- [ ] Conversation history works.
- [ ] Persistent sessions work.
- [ ] User memory is isolated.
- [ ] Connected accounts dashboard works.
- [ ] Approval center works.
- [ ] Responsive UI works.

## Deployment

- [ ] Production build succeeds.
- [ ] Production authentication works.
- [ ] Database migrations verified.
- [ ] Production Google integrations work.
- [ ] Security tests pass.
- [ ] Regression tests pass.
- [ ] n8n dependency removed after verified cutover.

---

# 24. Final Architectural Decision

The approved target architecture is:

**TypeScript + Next.js + Google ADK + Gemini + Neon PostgreSQL + Drizzle ORM + Google OAuth + Secure Google API Broker.**

The application will support one login identity per user and multiple separately connected Google accounts.

The existing infrastructure must be preserved wherever possible.

Development starts with Phase 0.

No implementation begins until the existing repository has been audited and the migration strategy has been validated.

**Primary objective: Build a secure, maintainable, multi-user AI Personal Assistant without unnecessary rebuilding, architectural changes, or scope creep.**
