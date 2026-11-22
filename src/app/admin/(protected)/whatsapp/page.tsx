import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { loadWhatsAppAutomations } from "@/lib/whatsapp/automations";
import { WhatsAppSetup } from "@/components/admin/whatsapp/WhatsAppSetup";
import { CrumbLabel } from "@/components/admin/BreadcrumbContext";

export const metadata: Metadata = { title: "WhatsApp setup" };
export const dynamic = "force-dynamic";

// What GMC's WhatsApp does on its own, in one list an admin can work through.

const VIEW_ROLES = new Set(["super_admin", "regional_lead", "customer_service"]);

export default async function WhatsAppSetupPage() {
  const admin = await requireAdmin();
  if (!VIEW_ROLES.has(admin.role)) redirect("/admin");

  const settings = await loadWhatsAppAutomations(createSupabaseServiceClient());
  if (!settings) throw new Error("whatsapp_automations has no settings row");

  return (
    <div className="max-w-[760px]">
      <CrumbLabel segment="whatsapp" label="WhatsApp setup" />
      <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
        <span className="w-5 h-px bg-current" />
        WhatsApp · 设置
      </div>
      <h1 className="mt-3 font-display text-[30px] md:text-[36px] leading-[1.05] tracking-[-0.015em] text-[var(--ink)]">
        What should WhatsApp do for you?
      </h1>
      <p className="mt-3 mb-7 text-[14px] leading-[1.7] text-[var(--ink-soft)]">
        Set these up once. Anything that needs a person still lands in your inbox.
      </p>
      <WhatsAppSetup
        settings={settings}
        canEdit={admin.role === "super_admin" || admin.role === "regional_lead"}
      />
    </div>
  );
}
