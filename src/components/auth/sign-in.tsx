"use client";

export function SignIn() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#1d5bd7] text-lg font-bold text-white">A</div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">Sign in to AI Personal</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Use your Google account to access your private assistant workspace.</p>
        <a
          className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1d5bd7]"
          href="/api/auth/google/start"
        >
          Continue with Google
        </a>
        <p className="mt-5 text-xs text-slate-400">Only your Google profile, email, and OpenID identity are requested.</p>
      </section>
    </main>
  );
}
