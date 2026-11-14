"use client";

import { Icon } from "../ui/icons";

export function SignIn() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F7FB] px-6">
      <section className="w-full max-w-md rounded-2xl border border-[#DCE4ED] bg-[#FFFFFF] p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#172B4D] text-lg font-bold text-white shadow-xs">
          A
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-[#172B4D]">
          Sign in to AI Assistant
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
          Enterprise Google Workspace assistant for email, calendar, and documents.
        </p>
        <a
          className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#315F85] px-4 py-3 text-sm font-semibold text-white shadow-xs transition hover:bg-[#264D70] focus:outline-none focus:ring-2 focus:ring-[#315F85]/40"
          href="/api/auth/google/start"
        >
          <Icon className="size-4" name="google" />
          <span>Continue with Google</span>
        </a>
        <p className="mt-5 text-xs text-[#64748B]">
          Only your Google profile, email, and OpenID identity are requested.
        </p>
      </section>
    </main>
  );
}
