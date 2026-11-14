This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local setup

Use Node.js 24.13.0 or newer and npm 11.8.0 or newer. The Vercel project's selected Node.js runtime still needs to be verified manually in the Vercel project settings; `.nvmrc` and `package.json` do not confirm the deployed runtime.

Copy `.env.example` to `.env.local` and set `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `DATABASE_URL` to the pooled Neon connection string, `DATABASE_URL_UNPOOLED` to the direct Neon connection string used for migrations, and the Google OAuth variables. In Google Cloud Console, register `GOOGLE_REDIRECT_URI` as an authorized redirect URI. Keep all values server-side and do not commit `.env.local`.

Google ADK uses Gemini by default. To route ADK inference through OpenRouter, set `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL` on the server. `OPENROUTER_TIMEOUT_MS` defaults to 120000. Only `gemini` and `openrouter` are accepted; provider failures do not trigger a fallback. ADK continues to manage agent turns and tool calls. OpenRouter mode uses non-streaming chat completions; ADK live connections are unsupported.

OpenRouter requests require `provider.zdr=true`, `provider.data_collection="deny"`, parameter-compatible routing, and disabled provider fallbacks. These controls constrain eligible inference endpoints and cause requests to fail when no eligible endpoint is available. `provider.zdr=true` follows the OpenRouter account and guardrail Safety Retention preference: if Safety Retention is allowed, requests may use endpoints that retain prompts and responses for abuse prevention, without training; with ZDR only, those endpoints are excluded. Check the OpenRouter account privacy settings and any applicable guardrails separately before activation, including the preference for the selected model group. ZDR means no routine post-processing storage; Safety Retention permits limited abuse-prevention storage; Retention and Training may permit storage and model training under the provider's policy. These controls do not prevent request data from transiting OpenRouter, replace review of endpoint policies, or govern this application's own logging and storage. Policies can change; review OpenRouter's and each inference provider's current terms before enabling the option for sensitive data.

Run the opt-in live OpenRouter smoke tests with a model available to your account that supports text and function calling. They make real API requests and are not part of `npm test`. Set the two required variables in PowerShell, then run the script:

```powershell
$env:OPENROUTER_API_KEY = "<your OpenRouter API key>"
$env:OPENROUTER_MODEL = "<provider/model>"
npm.cmd run smoke:openrouter
```

The script checks a text response, the required privacy routing fields, and a synthetic tool call through the actual ADK Runner. It uses no Google service tools or user data and prints only test status and safe error categories.

Generate `N8N_WEBHOOK_SECRET` with a cryptographically secure random generator, for example:

```bash
openssl rand -hex 32
```

In n8n, create or select a Header Auth credential with header name `X-N8N-Webhook-Secret` and the same secret value. Assign that credential to every production Webhook node called by this application. Use n8n's built-in Header Auth setting; do not replace it with an IF node that compares a request value.

To rotate the secret safely, create a new strong value, update the n8n Header Auth credential and the backend deployment configuration as one coordinated change, restart or redeploy the backend, and then verify an authenticated request succeeds while a request with the old value is rejected. Never put the secret in a request body, browser code, logs, or API responses.

The n8n request timeout defaults to 150 seconds. Set `N8N_WEBHOOK_TIMEOUT_MS` to a positive millisecond value only when a deployment needs a different limit.

After configuring both database variables, apply the checked-in Drizzle migrations with:

```bash
npm run db:migrate
```

### Isolated local chat integration test

The local chat integration test uses a dedicated PostgreSQL database and a local OpenAI-compatible stub. It creates synthetic users and sessions; it does not use Google OAuth or send prompts to OpenRouter. It runs the existing guarded database checks and migrations before starting the local app.

Start the test-only database with Docker Desktop running:

```powershell
docker compose -f compose.test.yaml up -d --wait
$env:TEST_DATABASE_URL_UNPOOLED = "postgresql://postgres:local_test_only_password@127.0.0.1:55432/ai_personal_assistant_test"
npm run test:local-chat
docker compose -f compose.test.yaml down
```

`TEST_DATABASE_URL_UNPOOLED` is required explicitly and is never loaded as an application or staging database fallback. The test script verifies the loopback database identity, and refuses a target that matches configured application or staging URLs. The app process receives a local `DATABASE_URL` override for the duration of the test. The Compose service binds only to `127.0.0.1`; its named volume keeps the isolated test schema between runs.

`OPENROUTER_BASE_URL` is an optional endpoint override intended for local test stubs. When set, the app accepts only an HTTP URL on `localhost`, `127.0.0.0/8`, or `::1`; the default remains the OpenRouter endpoint. The local test process also blocks non-loopback `fetch` requests, and the test checks the request's privacy routing fields at its stub.

The application returns a clear database-unavailable error for history and chat persistence operations when `DATABASE_URL` is empty. It does not run migrations automatically. Google is the only sign-in provider. Initial login requests only `openid`, `email`, and `profile`; Google API access for future Calendar, Gmail, or Docs features must use a separate incremental authorization flow. The session cookie is HttpOnly and SameSite=Lax, and becomes Secure in production. Google client secrets and tokens stay on the server; no Google refresh token is sent to n8n.

The ownership migration keeps existing single-user conversations and assigns any legacy rows without an owner to the first Google account that signs in. After that, all conversation reads and writes are scoped to the authenticated user.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
