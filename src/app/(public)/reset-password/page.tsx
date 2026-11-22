import { redirect } from "next/navigation";

// Old reset links landed here and can no longer work. Send people to get a new one.
export default function ResetPasswordPage() {
  redirect("/forgot-password");
}
