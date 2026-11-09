import { connection } from "next/server";
import { Suspense } from "react";

import { getCurrentUser } from "@/lib/auth";

import ChatWorkspace from "@/components/chat/chat-workspace";
import { SignIn } from "@/components/auth/sign-in";

export const instant = false;

async function HomePage() {
  await connection();
  const user = await getCurrentUser();
  return user ? <ChatWorkspace user={user} /> : <SignIn />;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <HomePage />
    </Suspense>
  );
}
