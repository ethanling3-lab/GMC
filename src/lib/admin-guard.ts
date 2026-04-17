import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase";

export type AdminContext = {
  id: string;
  email: string;
  name_cn: string | null;
  name_en: string | null;
  role: "super_admin" | "regional_lead" | "customer_service" | "finance" | "instructor";
  region: string | null;
};

// Call from any /admin/(protected)/** Server Component. Redirects to login
// if the user is either unauthenticated OR authenticated but not in admins.
export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  const { data: admin, error } = await supabase
    .from("admins")
    .select("id, name_cn, name_en, role, region")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !admin) {
    await supabase.auth.signOut();
    redirect("/admin/login?reason=not_admin");
  }

  return {
    id: admin.id,
    email: user.email ?? "",
    name_cn: admin.name_cn,
    name_en: admin.name_en,
    role: admin.role,
    region: admin.region,
  };
}
