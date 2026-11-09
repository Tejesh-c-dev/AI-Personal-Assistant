import { redirect } from "next/navigation";

import { SignIn } from "@/components/auth/sign-in";
import { getCurrentUser } from "@/lib/auth";

export const instant = false;

export default async function SignInPage() {
  if (await getCurrentUser()) {
    redirect("/");
  }
  return <SignIn />;
}
