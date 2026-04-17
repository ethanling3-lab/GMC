import { createSupabaseServiceClient } from "@/lib/supabase";
import { getServerLocale } from "@/lib/locale-server";
import { getDict, t } from "@/lib/i18n";
import { verifyToken } from "@/lib/tokens";
import { ConfirmForm } from "./ConfirmForm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

type ConfirmLoad =
  | { state: "expired" }
  | { state: "invalid" }
  | {
      state: "ready";
      token: string;
      participant: {
        region_id: string | null;
        name_cn: string | null;
        name_en: string | null;
        email: string | null;
        phone: string | null;
        region: string | null;
        occupation: string | null;
        industry: string | null;
      };
      event: { title_cn: string | null; title_en: string | null };
      alreadyConfirmed: boolean;
    };

type ReadyState = Extract<ConfirmLoad, { state: "ready" }>;

async function loadByToken(token: string): Promise<ConfirmLoad> {
  const supabase = createSupabaseServiceClient();
  const { data: enrollment, error } = await supabase
    .from("enrollments")
    .select(
      "id, participant_id, event_id, confirmation_token_expires_at, confirmed_at, " +
        "participants(region_id, name_cn, name_en, email, phone, region, occupation, industry), " +
        "events(title_cn, title_en)",
    )
    .eq("confirmation_token", token)
    .maybeSingle();

  if (error || !enrollment) return { state: "invalid" };

  const row = enrollment as unknown as {
    id: string;
    participant_id: string;
    event_id: string;
    confirmation_token_expires_at: string | null;
    confirmed_at: string | null;
    participants: ReadyState["participant"];
    events: ReadyState["event"];
  };

  if (
    !verifyToken(
      "confirm_registration",
      `${row.participant_id}:${row.event_id}`,
      token,
    )
  ) {
    return { state: "invalid" };
  }

  if (
    row.confirmation_token_expires_at &&
    new Date(row.confirmation_token_expires_at) < new Date()
  ) {
    return { state: "expired" };
  }

  return {
    state: "ready",
    token,
    participant: row.participants,
    event: row.events,
    alreadyConfirmed: Boolean(row.confirmed_at),
  };
}

export default async function ConfirmPage({ params }: PageProps) {
  const [locale, { token }] = await Promise.all([getServerLocale(), params]);
  const d = getDict(locale);
  const l = (p: string, f?: string) => t(d, p, f);

  const result = await loadByToken(token);

  if (result.state === "expired" || result.state === "invalid") {
    return (
      <div className="mx-auto max-w-[720px] px-6 md:px-10 py-24 md:py-32 text-center">
        <span className="eyebrow justify-center">{l("confirm.expiredTitle")}</span>
        <h1 className="mt-5 font-display text-[var(--ink)]">{l("confirm.expiredTitle")}</h1>
        <p className="mt-5 text-[16px] leading-[1.75] text-[var(--ink-soft)] max-w-[520px] mx-auto">
          {l("confirm.expiredBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[880px] px-6 md:px-10 pt-20 md:pt-28 pb-24">
      <span className="eyebrow">{l("confirm.title")}</span>
      <h1 className="mt-5 font-display text-[var(--ink)]">{l("confirm.title")}</h1>
      <p className="mt-5 text-[16px] leading-[1.75] text-[var(--ink-soft)] max-w-[640px]">
        {l("confirm.subtitle")}
      </p>

      {result.event ? (
        <div className="mt-8 inline-flex items-center gap-3 px-4 py-2 bg-[var(--paper-deep)] border border-[var(--paper-shadow)] text-[12px] tracking-[0.14em] uppercase text-[var(--ink-soft)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinnabar)]" />
          {(locale === "zh" ? result.event.title_cn : result.event.title_en) ?? result.event.title_en ?? result.event.title_cn}
        </div>
      ) : null}

      <div className="mt-10 bg-[var(--paper-warm)] border border-[var(--paper-shadow)] p-8 md:p-12 shadow-[var(--shadow-paper-1)]">
        <ConfirmForm
          token={result.token}
          initial={result.participant}
          regionId={result.participant.region_id}
          alreadyConfirmed={result.alreadyConfirmed}
        />
      </div>
    </div>
  );
}
