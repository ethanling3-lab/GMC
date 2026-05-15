import type { Metadata } from "next";
import QRCode from "qrcode";
import { getServerLocale } from "@/lib/locale-server";
import { loadTicketByToken } from "@/lib/check-in/check-in-query";

export const metadata: Metadata = { title: "Check-in · 签到" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

function formatEventDates(
  startDate: string | null,
  endDate: string | null,
  locale: "en" | "zh",
): string {
  if (!startDate) return "—";
  const localeTag = locale === "zh" ? "zh-CN" : "en-SG";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(localeTag, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  if (!endDate || endDate === startDate) return fmt(startDate);
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

export default async function CheckInTicketPage({ params }: PageProps) {
  const [{ token }, locale] = await Promise.all([params, getServerLocale()]);
  const ticket = await loadTicketByToken(token);
  const isZh = locale === "zh";

  if (!ticket) {
    return (
      <div className="mx-auto max-w-[640px] px-6 md:px-10 py-24 md:py-32 text-center">
        <span className="eyebrow justify-center">
          {isZh ? "签到 · Check-in" : "Check-in · 签到"}
        </span>
        <h1 className="mt-5 font-display text-[var(--ink)] text-[32px] md:text-[40px] leading-[1.05] tracking-[-0.015em]">
          {isZh ? "二维码无效" : "Check-in code not recognised"}
        </h1>
        <p className="mt-5 text-[16px] leading-[1.75] text-[var(--ink-soft)] max-w-[520px] mx-auto">
          {isZh
            ? "此签到二维码无法在系统中找到。请检查您从邮件中打开的链接是否正确，或回复邮件联系 GMC 团队。"
            : "We couldn't find that check-in code. Please double-check the link from your email or reach out to the GMC team."}
        </p>
      </div>
    );
  }

  const title =
    (isZh ? ticket.event.title_cn : ticket.event.title_en) ||
    ticket.event.title_en ||
    ticket.event.title_cn ||
    ticket.event.slug;
  const name =
    (isZh ? ticket.participant.name_cn : ticket.participant.name_en) ||
    ticket.participant.name_en ||
    ticket.participant.name_cn ||
    "—";
  const altName =
    (isZh ? ticket.participant.name_en : ticket.participant.name_cn) ?? null;

  // Render the QR as an inline data URL so the page is self-contained for
  // offline viewing (saved screenshots, airplane mode, etc.). Token is
  // encoded as a relative-safe string; the scanner accepts both the bare
  // token and the full URL form.
  const dateLine = formatEventDates(ticket.event.start_date, ticket.event.end_date, locale as "en" | "zh");
  const qrDataUrl = await QRCode.toDataURL(token, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 10,
    color: { dark: "#0B2954", light: "#FBFCFF" },
  });
  const isCheckedIn = ticket.check_in !== null;

  return (
    <div className="mx-auto max-w-[640px] px-5 md:px-10 pt-12 md:pt-20 pb-20">
      <span className="eyebrow">
        {isZh ? "签到 · Check-in" : "Check-in · 签到"}
      </span>
      <h1 className="mt-4 font-display text-[var(--ink)] text-[28px] md:text-[34px] leading-[1.1] tracking-[-0.015em]">
        {title}
      </h1>
      <p className="mt-3 text-[13px] text-[var(--ink-soft)] tracking-[0.06em]">
        {dateLine}
        {ticket.event.venue ? ` · ${ticket.event.venue}` : ""}
        {ticket.event.city ? ` · ${ticket.event.city}` : ""}
      </p>

      {/* Ticket card */}
      <div className="mt-8 bg-[var(--paper-warm)] border border-[var(--paper-shadow)] rounded-[24px] shadow-[var(--shadow-paper-1)] overflow-hidden">
        <div className="p-6 md:p-8 flex flex-col items-center text-center">
          <div className="text-[10.5px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            {isZh ? "活动当天出示此二维码" : "Show this QR at the door"}
          </div>
          <div className="mt-4 p-3 bg-white rounded-[14px] border border-[var(--paper-shadow)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={isZh ? "签到二维码" : "Check-in QR"}
              width={260}
              height={260}
              style={{ display: "block", imageRendering: "pixelated" }}
            />
          </div>
          <div className="mt-5">
            <div className="font-display text-[28px] leading-[1.1] tracking-[-0.01em] text-[var(--ink)]">
              {name}
            </div>
            {altName ? (
              <div className="mt-1 text-[14px] text-[var(--ink-soft)] tracking-[0.04em]">
                {altName}
              </div>
            ) : null}
            {ticket.participant.region_id ? (
              <div className="mt-3 inline-flex items-center h-[26px] px-3 rounded-[var(--radius-pill)] bg-[var(--paper-deep)] text-[11.5px] tracking-[0.08em] font-medium text-[var(--ink-mute)] tabular-nums">
                {ticket.participant.region_id}
              </div>
            ) : null}
          </div>
        </div>

        {isCheckedIn ? (
          <div className="px-6 md:px-8 pb-6 md:pb-7">
            <div className="rounded-[14px] bg-[var(--cinnabar)]/10 border border-[var(--cinnabar)]/25 px-4 py-3 text-center text-[13.5px] text-[var(--cinnabar-deep,var(--cinnabar))]">
              {isZh ? "✓ 您已成功签到 · " : "✓ Checked in · "}
              {ticket.check_in
                ? new Date(ticket.check_in.checked_in_at).toLocaleString(
                    isZh ? "zh-CN" : "en-SG",
                    {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )
                : ""}
            </div>
          </div>
        ) : null}
      </div>

      <p className="mt-6 text-[12.5px] leading-[1.7] text-[var(--ink-soft)] text-center">
        {isZh
          ? "建议提前保存截图。在活动当天，请准时到场并出示此二维码完成签到。"
          : "Save a screenshot ahead of the event. Show this QR at the entrance to check in."}
      </p>
    </div>
  );
}
