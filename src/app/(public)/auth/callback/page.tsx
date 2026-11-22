import { redirect } from "next/navigation";

// Old invite links landed here and can no longer work. Send people to get a new one.
export default function AuthCallbackPage() {
  redirect("/forgot-password");
}
