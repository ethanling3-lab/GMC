import type { Metadata } from "next";
import { verifyUnsubscribeToken } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "Unsubscribe · 退订",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
};

// Shows no personal details: anyone holding a forwarded email can open this.
export default async function UnsubscribePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { done } = await searchParams;
  const valid = verifyUnsubscribeToken(token) !== null;

  return (
    <main className="min-h-[60vh] px-4 py-20 flex items-start justify-center">
      <div className="w-full max-w-[520px]">
        {!valid ? (
          <>
            <h1 className="font-display text-[30px] leading-[1.15] text-[var(--ink)]">
              This link isn&apos;t valid
            </h1>
            <p className="mt-1 text-[17px] text-[var(--ink-soft)]">此链接无效</p>
            <p className="mt-5 text-[15px] leading-[1.7] text-[var(--ink-soft)]">
              Use the unsubscribe link in your latest GMC email, or reply STOP to us on WhatsApp.
              <br />
              请使用最新 GMC 邮件中的退订链接，或在 WhatsApp 回复“退订”。
            </p>
          </>
        ) : done === "1" ? (
          <>
            <h1 className="font-display text-[30px] leading-[1.15] text-[var(--ink)]">
              You&apos;re unsubscribed
            </h1>
            <p className="mt-1 text-[17px] text-[var(--ink-soft)]">您已退订</p>
            <p className="mt-5 text-[15px] leading-[1.7] text-[var(--ink-soft)]">
              You won&apos;t receive GMC marketing messages. You&apos;ll still get important notices
              about events you&apos;ve registered for.
              <br />
              您将不再收到 GMC 的推广消息，但仍会收到已报名活动的重要通知。
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-[30px] leading-[1.15] text-[var(--ink)]">
              Unsubscribe from GMC marketing?
            </h1>
            <p className="mt-1 text-[17px] text-[var(--ink-soft)]">退订 GMC 推广消息？</p>
            <p className="mt-5 text-[15px] leading-[1.7] text-[var(--ink-soft)]">
              You&apos;ll still get important notices about events you&apos;ve registered for.
              <br />
              您仍会收到已报名活动的重要通知。
            </p>
            <form method="post" action={`/api/unsubscribe/${token}`} className="mt-7">
              <button
                type="submit"
                className="inline-flex items-center h-11 px-5 rounded-[var(--radius-md)] bg-[var(--cinnabar)] text-[14px] font-medium text-[var(--paper-warm)] hover:bg-[var(--cinnabar-deep)] active:translate-y-px focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] transition-[background-color,transform]"
              >
                Unsubscribe · 确认退订
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
