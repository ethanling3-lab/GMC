import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { getServerLocale } from "@/lib/locale-server";
import { verifyPaymentAccessToken } from "@/lib/tokens";

export const metadata = { title: "Complete payment" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

type EnrollmentRow = {
  id: string;
  status: string;
  payment_status: string;
  payment_method: string | null;
  amount_paid: number | string | null;
  paid_at: string | null;
  participant: {
    id: string;
    region_id: string | null;
    name_en: string | null;
    name_cn: string | null;
  } | null;
  event: {
    id: string;
    slug: string;
    title_en: string | null;
    title_cn: string | null;
    poster_url: string | null;
    start_date: string | null;
    end_date: string | null;
    city: string | null;
    country: string | null;
    price: number | string | null;
    currency: string | null;
    payment_methods: string[] | null;
    bank_details?: { en?: string; zh?: string } | null;
  } | null;
};

async function loadEnrollment(token: string): Promise<EnrollmentRow | null> {
  const parsed = verifyPaymentAccessToken(token);
  if (!parsed) return null;

  try {
    const supabase = createSupabaseServiceClient();
    // Best effort: select including bank_details. If migration 010 hasn't
    // landed yet, fall back without it.
    const primary = await supabase
      .from("enrollments")
      .select(
        "id, status, payment_status, payment_method, amount_paid, paid_at, participant:participants(id, region_id, name_en, name_cn), event:events(id, slug, title_en, title_cn, poster_url, start_date, end_date, city, country, price, currency, payment_methods, bank_details)",
      )
      .eq("id", parsed.enrollmentId)
      .maybeSingle();
    if (primary.error) {
      const code = (primary.error as { code?: string }).code;
      if (code !== "42703") return null;
      const fb = await supabase
        .from("enrollments")
        .select(
          "id, status, payment_status, payment_method, amount_paid, paid_at, participant:participants(id, region_id, name_en, name_cn), event:events(id, slug, title_en, title_cn, poster_url, start_date, end_date, city, country, price, currency, payment_methods)",
        )
        .eq("id", parsed.enrollmentId)
        .maybeSingle();
      if (fb.error || !fb.data) return null;
      return fb.data as unknown as EnrollmentRow;
    }
    return (primary.data as unknown as EnrollmentRow) ?? null;
  } catch {
    return null;
  }
}

function fmtMoney(
  amount: number | string | null,
  currency: string | null,
  locale: "zh" | "en",
): string {
  if (amount === null || amount === undefined) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return locale === "zh" ? "免费" : "Complimentary";
  try {
    return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-SG", {
      style: "currency",
      currency: currency ?? "SGD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency ?? "SGD"} ${n.toLocaleString()}`;
  }
}

function fmtRange(
  start: string | null,
  end: string | null,
  locale: "zh" | "en",
): string | null {
  function f(iso: string | null): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const s = f(start);
  const e = f(end);
  if (s && e && s !== e) return `${s} → ${e}`;
  return s ?? e;
}

function paymentReference(enrollmentId: string, regionId: string | null): string {
  const tail = enrollmentId.replace(/-/g, "").slice(-4).toUpperCase();
  return `${regionId ?? "GMC"}-${tail}`;
}

export default async function PayPage({ params }: PageProps) {
  const [locale, { token }] = await Promise.all([
    getServerLocale(),
    params,
  ]);

  const enrollment = await loadEnrollment(token);
  if (!enrollment) {
    return (
      <ExpiredShell locale={locale} />
    );
  }

  const event = enrollment.event;
  const participant = enrollment.participant;
  if (!event || !participant) return notFound();

  const title =
    (locale === "zh" ? event.title_cn : event.title_en) ||
    event.title_en ||
    event.title_cn ||
    event.slug;
  const participantName =
    (locale === "zh" ? participant.name_cn : participant.name_en) ||
    participant.name_en ||
    participant.name_cn ||
    participant.region_id ||
    "";

  const when = fmtRange(event.start_date, event.end_date, locale);
  const where = [event.city, event.country].filter(Boolean).join(" · ");
  const price = fmtMoney(event.price, event.currency, locale);

  const alreadyPaid =
    enrollment.status === "paid" || enrollment.payment_status === "paid";
  const ref = paymentReference(enrollment.id, participant.region_id);
  const methods = new Set(event.payment_methods ?? []);
  const bank =
    (event.bank_details && typeof event.bank_details === "object"
      ? event.bank_details
      : null) ?? null;
  const bankText = bank
    ? (locale === "zh" ? bank.zh || bank.en : bank.en || bank.zh) || ""
    : "";

  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
        <div
          className="absolute -top-[10%] -right-[8%] w-[520px] h-[520px] rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, var(--cinnabar-wash), transparent 70%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-[860px] px-6 md:px-10 pt-16 md:pt-24 pb-24">
        <Link
          href={`/events/${event.slug}`}
          className="inline-flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors duration-[var(--dur-fast)]"
        >
          <span aria-hidden="true">←</span>
          {locale === "zh" ? "返回活动详情" : "Back to event"}
        </Link>

        <span className="mt-10 eyebrow">
          {locale === "zh" ? "付款" : "Payment"}
        </span>
        <h1 className="mt-5 font-display text-[var(--ink)]">
          {alreadyPaid
            ? locale === "zh"
              ? "已付款 · 收据已发送至您的邮箱"
              : "Paid · receipt in your inbox"
            : locale === "zh"
              ? "完成您的报名付款"
              : "Complete your registration payment"}
        </h1>
        <p className="mt-5 text-[15px] md:text-[16px] leading-[1.75] text-[var(--ink-soft)] max-w-[620px]">
          {alreadyPaid
            ? locale === "zh"
              ? "您的报名已全部确认。无需进一步操作；活动前一周我们会再次联系您。"
              : "Your registration is fully confirmed — no further action needed. We'll reach out a week before the event with logistics details."
            : locale === "zh"
              ? "请选择以下付款方式完成报名。如已通过银行转账付款，请忽略此页 — 团队确认到账后会发送收据邮件。"
              : "Pick any of the payment methods below to complete your registration. If you've already paid by bank transfer, you can ignore this page — the team will email a receipt once the transfer clears."}
        </p>

        {/* Event summary card */}
        <div className="mt-10 md:mt-14 grid md:grid-cols-[220px_1fr] gap-6 md:gap-8 items-start">
          <div className="relative aspect-[4/5] md:aspect-[3/4] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--paper-deep)] shadow-[var(--shadow-paper-2)]">
            {event.poster_url ? (
              <Image
                src={event.poster_url}
                alt={title}
                fill
                sizes="(min-width: 768px) 220px, 100vw"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, var(--paper) 0%, var(--paper-deep) 100%)",
                }}
              />
            )}
          </div>
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
              <span className="w-5 h-px bg-current" />
              {participantName} · {participant.region_id ?? "—"}
            </div>
            <h2 className="mt-3 font-display text-[22px] md:text-[26px] leading-[1.25] text-[var(--ink)]">
              {title}
            </h2>
            {when ? (
              <div className="mt-3 text-[13.5px] text-[var(--ink-soft)] tabular-nums">
                {when}
                {where ? <span className="text-[var(--ink-faint)]"> · {where}</span> : null}
              </div>
            ) : null}
            <div className="mt-6 pt-5 border-t border-[var(--paper-shadow)] flex items-baseline justify-between gap-6 flex-wrap">
              <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
                {locale === "zh" ? "应付金额" : "Amount due"}
              </span>
              <span className="font-display text-[28px] md:text-[34px] leading-[1] tracking-[-0.02em] text-[var(--ink)] tabular-nums">
                {price}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-6 flex-wrap">
              <span className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
                {locale === "zh" ? "付款编号" : "Payment reference"}
              </span>
              <span className="font-mono text-[14px] text-[var(--cinnabar-deep)]">
                {ref}
              </span>
            </div>
          </div>
        </div>

        {/* Method panels */}
        {!alreadyPaid ? (
          <div className="mt-12 md:mt-16 flex flex-col gap-5">
            {(methods.has("hitpay") || methods.has("stripe")) ? (
              <MethodCard
                label={locale === "zh" ? "线上付款" : "Pay online"}
                zh="HitPay / Stripe"
                tag={locale === "zh" ? "即将开放" : "Coming soon"}
                disabled
              >
                <p className="text-[14px] leading-[1.7] text-[var(--ink-soft)]">
                  {locale === "zh"
                    ? "网上付款功能即将上线。在此之前，请使用下方的银行转账方式。"
                    : "Online payment is coming soon. In the meantime, please use the bank transfer option below."}
                </p>
              </MethodCard>
            ) : null}

            {(methods.has("bank_transfer") || methods.has("tt")) && bankText ? (
              <MethodCard
                label={
                  methods.has("bank_transfer") && methods.has("tt")
                    ? locale === "zh"
                      ? "银行转账 / 电汇"
                      : "Bank transfer / TT"
                    : methods.has("bank_transfer")
                      ? locale === "zh"
                        ? "银行转账"
                        : "Bank transfer"
                      : locale === "zh"
                        ? "国际电汇"
                        : "Telegraphic transfer"
                }
                zh={methods.has("tt") ? "TT" : ""}
              >
                <pre className="whitespace-pre-wrap font-body text-[14px] leading-[1.75] text-[var(--ink)]">
                  {bankText}
                </pre>
                <div className="mt-5 pt-4 border-t border-dashed border-[var(--paper-shadow)]">
                  <div className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-mute)]">
                    {locale === "zh" ? "请在转账备注中填写" : "Include in your transfer reference"}
                  </div>
                  <div className="mt-1.5 font-mono text-[18px] text-[var(--cinnabar-deep)]">
                    {ref}
                  </div>
                  <p className="mt-4 text-[13px] leading-[1.7] text-[var(--ink-mute)]">
                    {locale === "zh"
                      ? "转账后无需再次通知我们。团队确认到账后，会发送收据邮件。"
                      : "No need to notify us after transferring — once we confirm the funds, we'll email you a receipt."}
                  </p>
                </div>
              </MethodCard>
            ) : null}

            {(methods.has("bank_transfer") || methods.has("tt")) && !bankText ? (
              <MethodCard
                label={locale === "zh" ? "银行转账" : "Bank transfer"}
                zh=""
              >
                <p className="text-[14px] leading-[1.7] text-[var(--ink-soft)]">
                  {locale === "zh"
                    ? "银行账户信息正在整理中。请稍后再试，或联系 GMC 客服获取详细信息。"
                    : "Bank account details are being prepared. Please check back shortly or contact the GMC team for details."}
                </p>
              </MethodCard>
            ) : null}

            {methods.size === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--paper-shadow)] bg-[var(--paper-warm)] px-6 py-8 text-center">
                <p className="text-[14px] text-[var(--ink-mute)]">
                  {locale === "zh"
                    ? "此次活动暂未开放任何付款方式。请联系 GMC 客服。"
                    : "No payment method is configured for this event yet. Please contact the GMC team."}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="mt-12 text-[11.5px] leading-[1.7] text-[var(--ink-faint)]">
          {locale === "zh"
            ? "此付款链接仅供您本人使用，请勿转发。链接将在活动结束后失效。"
            : "This link is personal to you — please don't forward it. It expires after the event completes."}
        </p>
      </div>
    </div>
  );
}

function MethodCard({
  label,
  zh,
  tag,
  disabled,
  children,
}: {
  label: string;
  zh: string;
  tag?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`relative rounded-[var(--radius-lg)] border bg-[var(--paper-warm)] p-7 md:p-8
                   shadow-[var(--shadow-paper-1)]
                   ${disabled ? "border-[var(--paper-shadow)] opacity-75" : "border-[var(--paper-shadow)]"}`}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="font-display text-[18px] md:text-[20px] text-[var(--ink)]">
            {label}
          </div>
          {zh ? (
            <div className="text-[12px] tracking-[0.14em] uppercase text-[var(--ink-mute)] mt-0.5">
              {zh}
            </div>
          ) : null}
        </div>
        {tag ? (
          <span className="inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[10.5px] tracking-[0.18em] uppercase text-[var(--ink-mute)]">
            {tag}
          </span>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ExpiredShell({ locale }: { locale: "zh" | "en" }) {
  return (
    <div className="relative overflow-hidden">
      <div className="relative mx-auto max-w-[680px] px-6 md:px-10 pt-24 pb-24 text-center">
        <span className="eyebrow justify-center">
          {locale === "zh" ? "付款" : "Payment"}
        </span>
        <h1 className="mt-6 font-display text-[var(--ink)]">
          {locale === "zh"
            ? "付款链接已过期或无效"
            : "This payment link is expired or invalid"}
        </h1>
        <p className="mt-6 text-[15px] leading-[1.75] text-[var(--ink-soft)] max-w-[500px] mx-auto">
          {locale === "zh"
            ? "请联系 GMC 客服以获取新的付款链接。"
            : "Please contact the GMC team and we'll issue a new payment link."}
        </p>
        <Link
          href="/events"
          className="mt-10 inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[var(--cinnabar)] text-[var(--paper-warm)] text-[13px] font-medium hover:bg-[var(--cinnabar-deep)] shadow-[0_4px_14px_rgba(37,99,235,0.28)] transition-[background-color] duration-[var(--dur-fast)]"
        >
          {locale === "zh" ? "浏览活动" : "Browse events"}
        </Link>
      </div>
    </div>
  );
}
