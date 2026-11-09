This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local setup

Copy `.env.example` to `.env.local` and set `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `DATABASE_URL` to the pooled Neon connection string, `DATABASE_URL_UNPOOLED` to the direct Neon connection string used for migrations, and the Google OAuth variables. In Google Cloud Console, register `GOOGLE_REDIRECT_URI` as an authorized redirect URI. Keep all values server-side and do not commit `.env.local`.

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
