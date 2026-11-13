# AI Personal Assistant --- High-Level Design (HLD)

**Document:** `hld.md`\
**Project:** AI Personal Assistant\
**Repository:** `Tejesh-c-dev/ai-personal-assistant`\
**Architecture direction:** Next.js + Google ADK TypeScript + existing
Google security broker + Neon PostgreSQL\
**Status:** Approved architecture direction; implementation pending\
**Scope:** Phase 3 --- replace n8n orchestration with in-process ADK
orchestration

------------------------------------------------------------------------

## 1. Purpose

This document defines the target architecture for replacing the current
n8n-based agent orchestration with Google ADK TypeScript inside the
existing Next.js application.

The goal is not to redesign the whole product. The goal is to introduce
an agent orchestration layer while preserving the security, identity,
Google account, approval, and persistence systems that already exist.

The architecture must support:

-   Multiple independent application users.
-   Multiple Google accounts per application user, with dynamic account
    labels.
-   Gmail, Google Calendar, and Google Docs operations.
-   Read operations through authorized tools.
-   Write proposals that require explicit user confirmation.
-   Deterministic backend execution of approved writes.
-   Persistent conversations and approvals in PostgreSQL.
-   Deployment through the existing Next.js/Vercel application.

## 2. Why this architecture was selected

### 2.1 Keep orchestration inside Next.js

**Decision:** Run Google ADK TypeScript inside the existing Next.js
Node.js backend.

**Reasoning:**

-   Authentication and conversation ownership are already handled by the
    application.
-   The application already owns the Google account records, encrypted
    refresh tokens, capability system, and write approvals.
-   In-process orchestration removes the n8n webhook from the request
    path.
-   A separate agent server would introduce another deployment,
    service-to-service authentication, network boundary, and operational
    dependency.
-   TypeScript keeps the orchestration layer aligned with the existing
    application stack.

This is the smallest architectural change that replaces the current
orchestration layer without rebuilding the product.

### 2.2 Retain the existing Google security and broker systems

**Decision:** ADK tools must use the existing Google authorization and
broker logic. Do not replace OAuth, token encryption, account ownership,
capability verification, or approval storage as part of this migration.

**Reasoning:**

These components already represent substantial security work. Rewriting
them while introducing an agent framework would increase the number of
moving parts and create avoidable regression risk.

ADK is an orchestration layer, not an identity provider, token vault, or
authorization authority.

The model must never receive Google refresh tokens, access tokens,
capability tokens, or other credentials.

### 2.3 Create request-scoped agents and tools

**Decision:** Construct the agent, Runner, session service, and
account-bound tools for each chat request. Do not use a global agent
instance containing user-specific state.

**Reasoning:**

The application is multi-tenant. A global mutable agent or tool registry
can accidentally retain user/account context between requests.

A request-scoped design makes the security boundary explicit:

-   The authenticated user ID comes from the server-side session.
-   The selected account label is validated by the backend.
-   The account ID is resolved from that user's connected accounts.
-   Tool closures capture those verified values.
-   Model-generated tool arguments cannot select another user or
    account.

This is a defence-in-depth measure. The broker and database
authorization checks remain mandatory.

### 2.4 Separate read operations, write proposals, and write execution

**Decision:** Use three distinct execution paths.

**Read path:** ADK tool → capability issuance → capability verification
and nonce consumption → authorized broker operation → Google API.

**Proposal path:** ADK proposal tool → proposal capability verification
→ pending approval stored in PostgreSQL → confirmation details returned
to the user.

**Execution path:** User confirmation → deterministic Next.js backend
validation → atomic approval consumption → payload-bound capability
verification → authorized broker operation using the exact stored
payload.

**Reasoning:**

An LLM is not a security boundary. It must not decide whether a user has
confirmed an action or modify the payload after approval.

The backend must independently verify the user, conversation, approval,
account, expiry, and exact approved payload. The confirmation path must
bypass the LLM entirely.

### 2.5 Keep PostgreSQL as the source of truth

**Decision:** Continue using the existing Neon PostgreSQL database and
Drizzle schema for users, accounts, conversations, messages,
capabilities, and approvals.

Use an in-memory ADK session service only as a per-request execution
context.

**Reasoning:**

-   Conversations and approvals must survive serverless instance
    termination.
-   The existing database already stores durable conversation history.
-   Adding another persistence service would create synchronization and
    operational complexity.
-   A fresh ADK session can be hydrated from the previous messages for
    each request.

The exact ADK TypeScript session API must be implemented using the
installed package's types and documentation. The same session-service
instance that is hydrated must be supplied to the Runner.

### 2.6 Migrate incrementally and retain n8n as rollback reference

**Decision:** Implement and verify ADK before decommissioning n8n.

**Reasoning:**

A complete cutover before testing would combine too many risks:
package/runtime compatibility, tool authorization, session hydration,
model integration, and route migration.

The staged approach proves the security path first and keeps the current
workflow available until the replacement passes end-to-end verification.

------------------------------------------------------------------------

## 3. Goals and non-goals

### 3.1 Goals

1.  Replace n8n orchestration with Google ADK TypeScript.
2.  Preserve the existing Next.js chat API contract.
3.  Preserve multi-user and multi-account isolation.
4.  Support Gmail, Calendar, and Docs read operations.
5.  Support approval-based Google write operations.
6.  Keep credentials and authorization decisions in the backend.
7.  Keep conversations and approvals durable in PostgreSQL.
8.  Avoid unnecessary infrastructure and schema changes.

### 3.2 Non-goals

This phase does not include:

-   Replacing Google OAuth or application authentication.
-   Replacing the existing token encryption system.
-   Replacing the Google broker.
-   Introducing Clerk or another authentication provider.
-   Introducing Redis, queues, or a separate agent microservice.
-   Replacing Drizzle or PostgreSQL.
-   Redesigning the chat UI.
-   Decommissioning n8n before ADK verification.
-   Deploying to production as part of local implementation.

------------------------------------------------------------------------

## 4. Target architecture

``` mermaid
flowchart TD
    Browser["Browser / Existing Chat UI"]
    Chat["Next.js POST /api/chat"]
    Auth["Authentication and Conversation Ownership"]
    Router{"Confirmation request?"}

    ADK["Request-scoped ADK Runner"]
    Agent["LlmAgent"]
    ReadTools["Account-bound Read FunctionTools"]
    ProposalTools["Account-bound Proposal FunctionTools"]

    Confirmation["Deterministic Confirmation Handler"]
    Approval["PostgreSQL Write Approval"]
    Capability["Capability Issuance and Verification"]
    Broker["Existing Authorized Google Broker"]
    Crypto["Existing OAuth and Token Crypto"]
    Google["Google Gmail / Calendar / Docs APIs"]
    DB[("Neon PostgreSQL / Drizzle")]
    Model["Configured Gemini Model"]

    Browser --> Chat
    Chat --> Auth
    Auth --> DB
    Auth --> Router

    Router -->|No| ADK
    ADK --> Agent
    Agent <--> Model
    Agent --> ReadTools
    Agent --> ProposalTools

    ReadTools --> Capability
    ProposalTools --> Capability
    ProposalTools --> Approval

    Router -->|Yes| Confirmation
    Confirmation --> Approval
    Confirmation --> Capability

    Capability --> DB
    Capability --> Broker
    Broker --> Crypto
    Crypto --> Google
    Google --> Broker
    Broker --> ReadTools
    Broker --> Confirmation

    Approval --> DB
    ADK --> DB
    Confirmation --> DB
    Chat --> Browser
```

### 4.1 Main components

  -----------------------------------------------------------------------
  Component                           Responsibility
  ----------------------------------- -----------------------------------
  Chat UI                             Sends chat messages and displays
                                      assistant responses and approval
                                      instructions.

  Next.js chat route                  Authenticates requests, checks
                                      conversation ownership, resolves
                                      account selection, routes
                                      confirmations, invokes ADK, and
                                      persists messages.

  ADK Runner                          Executes the request-scoped agent
                                      and its tools.

  LlmAgent                            Interprets user intent and chooses
                                      among the tools available for that
                                      request.

  Read FunctionTools                  Expose bounded, validated,
                                      read-only Google operations.

  Proposal FunctionTools              Create pending write approvals;
                                      never execute writes.

  Confirmation handler                Executes a previously approved
                                      write without invoking the LLM.

  Capability system                   Enforces operation, user, account,
                                      expiry, payload, and single-use
                                      nonce authorization.

  Google broker                       Performs authorized Google API
                                      operations.

  OAuth and token crypto              Owns Google identity, encrypted
                                      credentials, and token refresh.

  Neon PostgreSQL                     Durable source of truth for
                                      identity, accounts, conversations,
                                      messages, capabilities, and
                                      approvals.
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 5. Request and authorization model

### 5.1 Trust boundaries

The architecture has four important trust boundaries:

1.  **Browser to application:** The browser is untrusted. Authenticate
    the user and validate request data on the server.
2.  **Model to tools:** Model output is untrusted. Validate every tool
    argument and do not accept model-supplied identity, account,
    authorization, or confirmation claims.
3.  **Application to Google broker:** Every operation must pass the
    existing authorization checks.
4.  **Application to Google APIs:** Only the backend token/broker layer
    may access Google credentials and APIs.

### 5.2 Request-scoped identity

For each request:

1.  Resolve the authenticated application user from the existing
    session.
2.  Resolve the conversation and verify its owner.
3.  Validate the selected account selector.
4.  Resolve the selected account or accounts from records belonging to
    that user.
5.  Confirm account status and required granted scopes.
6.  Construct only the tools authorized for those resolved accounts.

The model may provide operation parameters such as a Gmail search query.
It may not provide the authenticated user ID, account ID, or capability
token.

### 5.3 Dynamic account labels

Account labels are user-defined and dynamic, for example `personal`,
`official`, `work`, or `college`.

`both` is a reserved read selector. It is not a real Google account
label.

-   A single-account selection exposes tools bound to that account.
-   `both` exposes independent read tools for each eligible connected
    account.
-   A `both` selection never enables write proposals.
-   A write proposal must target one explicit account.
-   A confirmation must match the exact account label and account ID
    stored in the approval.
-   Account replacement, disconnection, or version changes invalidate
    stale authorization.

------------------------------------------------------------------------

## 6. Tool design

### 6.1 Read tools

  --------------------------------------------------------------------------
  Operation               Example tool               Existing broker method
  ----------------------- -------------------------- -----------------------
  Gmail search            `personal_gmail_search`    `searchGmail`

  Gmail message retrieval `personal_gmail_get`       `getGmailMessage`

  Calendar listing        `personal_calendar_list`   `listCalendarEvents`

  Calendar event          `personal_calendar_get`    `getCalendarEvent`
  retrieval                                          

  Docs retrieval          `personal_docs_get`        `getDocument`

  Docs export             `personal_docs_export`     `exportDocument`
  --------------------------------------------------------------------------

Names are examples only; actual tool names are generated from validated
account labels.

Each read tool must:

1.  Validate arguments with a schema.
2.  Use a server-side closure bound to the authenticated user and
    resolved account.
3.  Issue a short-lived, operation-specific capability.
4.  Verify the capability through the existing complete authorization
    path.
5.  Consume the nonce exactly once.
6.  Execute the matching broker operation with the expected account ID.
7.  Return only the bounded data needed by the agent.

### 6.2 Proposal tools

  ------------------------------------------------------------------------------------
  Operation               Example proposal tool                Result
  ----------------------- ------------------------------------ -----------------------
  Gmail send              `personal_propose_send_email`        Pending approval

  Calendar creation       `personal_propose_calendar_event`    Pending approval

  Docs creation           `personal_propose_create_document`   Pending approval

  Docs insertion          `personal_propose_insert_text`       Pending approval
  ------------------------------------------------------------------------------------

Proposal tools do not call Google write APIs. They validate the
requested details and create a pending approval row.

The server retains the approval metadata so the final response can
reliably present the correct approval ID and confirmation details. The
model is not trusted to reproduce security-critical identifiers
correctly.

### 6.3 Tool output limits

Email bodies, document contents, and calendar results can contain
private or untrusted text. Tools should return only the fields needed
for the user's task and enforce reasonable output-size limits.

Content retrieved from Google must be treated as data, not as
instructions that can override system policy or tool authorization.

------------------------------------------------------------------------

## 7. Deterministic write confirmation

### 7.1 Confirmation sequence

``` mermaid
sequenceDiagram
    participant User
    participant Chat as Next.js /api/chat
    participant DB as PostgreSQL
    participant Cap as Capability System
    participant Broker as Google Broker
    participant Google as Google API

    User->>Chat: CONFIRM approvalId
    Chat->>DB: Authenticate and resolve owned conversation
    Chat->>DB: Read pending approval without consuming
    DB-->>Chat: Stored approval details
    Chat->>Chat: Check expiry, owner, conversation, account and selection
    Chat->>DB: Atomically consume matching approval
    DB-->>Chat: Consumed approval payload
    Chat->>Cap: Issue payload-bound capability
    Cap->>DB: Insert capability nonce
    Chat->>Cap: Verify capability and consume nonce
    Cap->>DB: Atomic nonce consumption
    Chat->>Broker: Execute exact stored payload
    Broker->>Google: Authorized write request
    Google-->>Broker: Result
    Broker-->>Chat: Result
    Chat->>DB: Persist deterministic assistant result
    Chat-->>User: Confirmation result
```

### 7.2 Required invariants

-   Confirmation is recognized by deterministic backend parsing.
-   The LLM is not invoked for confirmation execution.
-   The pending approval is checked before it is consumed.
-   Wrong account selection is rejected without consuming a valid
    approval.
-   `both` is rejected for write confirmation.
-   Approval consumption is atomic and single-use.
-   The capability is bound to the exact database-stored payload and
    account.
-   The execution method is selected through an explicit typed mapping.
-   Model-generated arguments cannot change the approved payload.
-   If an external write fails after consumption, report the failure
    honestly; do not blindly retry an operation that may have completed.

------------------------------------------------------------------------

## 8. Conversation and session lifecycle

### 8.1 Persistence model

PostgreSQL remains the durable source of truth. ADK in-memory state
exists only for one request.

For each chat turn:

1.  Authenticate and resolve the conversation.
2.  Fetch prior messages from PostgreSQL.
3.  Create a fresh ADK in-memory session.
4.  Hydrate the session with bounded prior history using the installed
    ADK TypeScript API.
5.  Persist the new user message exactly once.
6.  Pass that message exactly once through `Runner.runAsync`.
7.  Collect the final user-facing response.
8.  Persist the assistant response.
9.  Return the existing `{ "output": "..." }` response.

The same `InMemorySessionService` instance must be used for hydration
and by the Runner.

### 8.2 Duplicate-message prevention

The current turn must not be both hydrated as a historical event and
supplied again as `newMessage`.

Fetch history before inserting the current message, hydrate only prior
turns, then pass the current turn once to `runAsync`.

### 8.3 Bounded context

Initially hydrate the last 10 exchanges, subject to message-size limits.
Expand or compact context only when measured usage demonstrates a need.
Do not add a new memory database in this phase.

------------------------------------------------------------------------

## 9. API and client compatibility

The existing chat client expects a non-streaming response shaped as:

``` json
{
  "output": "Assistant response"
}
```

The initial ADK integration will consume the Runner event stream
internally and return the existing JSON contract.

No chat UI redesign or streaming protocol change is required for this
migration.

The route must preserve existing authentication, conversation ownership,
request validation, error handling, and timeout protections. Request
cancellation should be forwarded only through APIs supported by the
installed ADK version.

------------------------------------------------------------------------

## 10. Model and runtime strategy

### 10.1 Initial model

Use one supported Gemini configuration for the initial ADK integration.
Keep the model identifier configurable, but do not implement an
unverified provider fallback.

Production processing of private Gmail, Calendar, and Docs data must use
a provider/service configuration whose data-handling terms are
appropriate for that use. Do not use a free-tier model endpoint for
production private-data processing without an explicit, informed
decision.

### 10.2 Runtime verification

Before installing ADK:

-   Check the exact published package version.
-   Inspect its package engine requirements and dependencies.
-   Verify local Node.js and npm compatibility.
-   Verify the actual Vercel Node runtime configuration.
-   Verify the Next.js Node runtime and production build.
-   Confirm the model API key variable expected by the installed
    package.

Use the installed package's TypeScript declarations as the
implementation authority. Documentation examples from a different
release must not be assumed compatible.

------------------------------------------------------------------------

## 11. Failure handling and observability

-   Return clear application errors when authentication, account
    validation, authorization, model invocation, or Google operations
    fail.
-   Never fall back silently to n8n.
-   Do not log access tokens, refresh tokens, capability JWTs, full
    private message bodies, or document contents.
-   Log safe operational metadata such as operation category, duration,
    success/failure category, and correlation ID.
-   Treat model output and Google content as untrusted.
-   Do not automatically retry non-idempotent Google writes after
    ambiguous failures.
-   Ensure aborted requests do not leave unnecessary work running when
    cancellation is supported.

------------------------------------------------------------------------

## 12. Implementation roadmap

### Phase 3A --- Architecture

This HLD defines the target design and security boundaries.

### Phase 3B --- Package and first read tool

-   Verify exact ADK package/runtime compatibility.
-   Install and pin the compatible package.
-   Construct the request-scoped ADK foundation.
-   Implement one Gmail search tool through the complete existing
    authorization path.
-   Test account binding, tenant isolation, nonce replay, and account
    replacement.

**Exit condition:** A read-only Gmail search can execute through ADK
without bypassing the existing security boundary.

### Phase 3C --- Remaining read tools and sessions

-   Implement Gmail retrieval, Calendar listing/retrieval, and Docs
    retrieval/export.
-   Implement PostgreSQL-to-ADK session hydration.
-   Verify message de-duplication and final-response extraction.

**Exit condition:** All read tools and conversation history work under
automated tests.

### Phase 3D --- Proposals and chat route migration

-   Implement proposal-only write tools.
-   Implement deterministic confirmation execution in the backend.
-   Replace n8n invocation in `/api/chat` with ADK Runner execution.
-   Preserve the existing JSON response contract.

**Exit condition:** Read and approval-based write workflows work through
the application without n8n in the request path.

### Phase 3E --- End-to-end verification and n8n retirement

-   Verify multi-user and multi-account isolation.
-   Verify approval ownership, expiry, single-use behaviour, and exact
    payload binding.
-   Run regression tests, type checking, linting, and production build.
-   Perform controlled end-to-end tests.
-   Obtain explicit approval before deleting the n8n workflow or its
    environment variables.

**Exit condition:** ADK is verified as the production orchestration path
and n8n can be safely retired.

------------------------------------------------------------------------

## 13. Test and release gates

Required test coverage includes:

-   User A cannot access User B's account or conversation.
-   Tools remain bound to their originating request's user and account.
-   `both` exposes independent read scopes and cannot be used for
    writes.
-   Inactive or replaced accounts cannot use stale capabilities.
-   Capability nonces cannot be replayed.
-   Proposal creation never executes a Google write.
-   Invalid, expired, wrong-owner, wrong-conversation, or wrong-account
    approvals are rejected.
-   Concurrent confirmations produce at most one execution.
-   Approved payloads cannot be modified by model output.
-   Confirmation bypasses ADK.
-   Session hydration does not duplicate the current message.
-   Existing OAuth, encryption, account, capability, approval, database,
    and chat tests remain passing.

Do not weaken existing tests to make the migration pass.

------------------------------------------------------------------------

## 14. Explicit architecture decisions

  -----------------------------------------------------------------------
  Decision          Selected approach Rejected          Why
                                      alternative       
  ----------------- ----------------- ----------------- -----------------
  Agent runtime     ADK inside        Separate agent    Avoids another
                    Next.js           microservice      deployment and
                                                        service boundary.

  Language          TypeScript        New Python        Matches the
                                      backend           existing
                                                        application and
                                                        team workflow.

  Google access     Existing broker   Direct            Preserves the
                    and capability    model-to-Google   established
                    system            access            authorization
                                                        boundary.

  Agent scope       Per-request agent Global mutable    Reduces
                    and tools         user-scoped agent cross-request
                                                        context leakage
                                                        risk.

  Write security    Backend           LLM-controlled    Keeps
                    confirmation and  execution tool    authorization
                    execution                           decisions out of
                                                        model control.

  Conversation      Existing          New session       Reuses durable
  persistence       PostgreSQL        database          application
                                                        storage.

  Initial model     One verified      Unverified        Reduces
                    Gemini            multi-provider    integration
                    configuration     routing           complexity.

  Migration         Staged            Immediate n8n     Preserves
                    replacement       deletion          rollback until
                                                        parity is
                                                        demonstrated.

  UI contract       Existing JSON     Immediate         Avoids unrelated
                    response          streaming/UI      client changes.
                                      rewrite           
  -----------------------------------------------------------------------

## 15. Definition of done

Phase 3 is complete only when:

1.  ADK runs within the existing Next.js backend.
2.  All required read tools use the existing complete authorization
    path.
3.  Write proposals cannot execute writes.
4.  Confirmations are deterministic, atomic, and payload-bound.
5.  Conversation history is hydrated correctly without duplication.
6.  Multi-user and multi-account isolation tests pass.
7.  Existing regression tests, type checking, linting, and production
    build pass.
8.  The existing chat client remains compatible.
9.  n8n remains available until explicit retirement approval.
10. No production deployment or remote database mutation occurs without
    separate authorization.

**Architecture principle:** ADK decides which permitted tool to request.
The backend decides who may access which account and whether a write is
authorized. PostgreSQL records durable application state. Google
credentials never leave the trusted backend.
