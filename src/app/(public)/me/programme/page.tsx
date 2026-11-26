import type { Metadata } from "next";
import Link from "next/link";
import { requireParticipant } from "@/lib/participant-guard";
import { loadMemberProgramme, type MemberProgrammeCourse } from "@/lib/programmes/member-programme";

export const metadata: Metadata = { title: "My programme · 我的配套 — GMC" };
export const dynamic = "force-dynamic";

const fmt = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const registerBtn =
  "inline-flex items-center h-8 px-3.5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[12px] hover:bg-[var(--cinnabar-deep)] focus-visible:shadow-[var(--shadow-focus)] active:scale-[0.98] transition-[background-color,transform] duration-[var(--dur-fast)]";

function Status({ c }: { c: MemberProgrammeCourse }) {
  const s = c.state;
  switch (s.kind) {
    case "attended":
      return (
        <div className="text-right">
          <div className="text-[12.5px] text-[var(--jade-deep)]">✓ Attended · 已上课{s.date ? ` · ${fmt(s.date)}` : ""}</div>
          {c.again ? (
            <Link href={`/events/${c.again.slug}/register`} className="mt-1 inline-block text-[12px] text-[var(--cinnabar-deep)] underline decoration-dotted underline-offset-2 hover:text-[var(--cinnabar)]">
              Join again {fmt(c.again.date)} · 复训
            </Link>
          ) : null}
        </div>
      );
    case "registered":
      return (
        <Link href="/me/enrollments" className="text-[12.5px] text-[var(--cinnabar-deep)] underline decoration-dotted underline-offset-2 hover:text-[var(--cinnabar)]">
          Registered · 已报名{s.date ? ` · ${fmt(s.date)}` : ""}
        </Link>
      );
    case "open":
      return (
        <div className="flex items-center gap-2 justify-end flex-wrap">
          <span className="text-[12.5px] text-[var(--ink-soft)] tabular-nums">Next · {fmt(s.date)}</span>
          <Link href={`/events/${s.slug}/register`} className={registerBtn} style={{ color: "var(--paper-warm)" }}>
            Register · 报名
          </Link>
        </div>
      );
    case "planned":
      return (
        <div className="text-right text-[12.5px] text-[var(--ink-soft)] tabular-nums">
          Planned · 已排期 {fmt(s.date)}
          {s.tentative ? <span className="text-[var(--ink-mute)]"> (date TBC)</span> : null}
          <div className="text-[11.5px] text-[var(--ink-mute)]">Registration opens later</div>
        </div>
      );
    case "closed":
      return <div className="text-right text-[12.5px] text-[var(--ink-mute)] tabular-nums">{fmt(s.date)} · Registration closed</div>;
    default:
      return <div className="text-right text-[12.5px] text-[var(--ink-mute)]">Not scheduled yet · 待排期</div>;
  }
}

export default async function MyProgrammePage() {
  const participant = await requireParticipant();
  const prog = await loadMemberProgramme(participant.id);

  return (
    <div>
      <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">— My programme · 我的配套</div>

      {!prog ? (
        <>
          <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">No programme yet.</h1>
          <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.7] text-[var(--ink-soft)]">
            When you join a programme such as 丰盛 or 荣贵, its courses and your validity show here. Ask your CS about programmes · 如需了解配套，请联系客服。
          </p>
          <p className="mt-4 text-[13px]">
            <Link href="/me/courses" className="underline decoration-dotted underline-offset-4 text-[var(--ink-soft)] hover:text-[var(--cinnabar-deep)]">
              See my courses →
            </Link>
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-3 font-display text-[30px] md:text-[36px] leading-[1.05] tracking-[-0.03em] text-[var(--ink)]">{prog.name_cn}</h1>
          <div className="mt-1 text-[14px] text-[var(--ink-soft)]">{prog.name_en}</div>

          <div
            className={`mt-5 rounded-[var(--radius-lg)] border p-4 md:p-5 ${
              prog.expired ? "border-[var(--paper-shadow)] bg-[var(--paper-deep)]/50" : "border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)]"
            }`}
          >
            {prog.expired ? (
              <p className="text-[14px] leading-[1.7] text-[var(--ink)]">
                Your {prog.name_cn} ended on {fmt(prog.valid_until)}. You are now a <strong className="font-medium">经典永流传 · Classic member</strong>.
              </p>
            ) : (
              <p className="text-[14px] leading-[1.7] text-[var(--ink)]">
                {prog.valid_until ? (
                  <>
                    Valid until · 有效期至 <strong className="font-medium tabular-nums">{fmt(prog.valid_until)}</strong>
                    {prog.started ? <span className="text-[var(--ink-soft)]"> (from {fmt(prog.started)})</span> : null}
                  </>
                ) : (
                  "No expiry · 长期有效"
                )}
              </p>
            )}
            {prog.total > 0 ? (
              <p className="mt-1 text-[13px] text-[var(--ink-soft)] tabular-nums">
                Attended {prog.attended_count} of {prog.total} courses · 已上 {prog.attended_count}/{prog.total} 门课
              </p>
            ) : null}
          </div>

          {prog.sections.length === 0 ? (
            <p className="mt-8 text-[13px] text-[var(--ink-mute)]">The course list for this programme hasn&apos;t been added yet.</p>
          ) : (
            prog.sections.map((sec) => (
              <section key={sec.section_cn} className="mt-8">
                <h2 className="flex items-baseline gap-2">
                  <span className="font-display text-[18px] text-[var(--ink)]">{sec.section_cn}</span>
                  <span className="text-[12px] text-[var(--ink-mute)]">{sec.section_en}</span>
                </h2>
                <ul className="mt-2 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] divide-y divide-[var(--paper-shadow)]">
                  {sec.courses.map((c) => (
                    <li key={c.id} className="px-4 py-3.5 flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-[12rem] flex-1">
                        <div className="text-[14.5px] text-[var(--ink)]">{c.name_cn}</div>
                        {c.name_en ? <div className="text-[12.5px] text-[var(--ink-soft)]">{c.name_en}</div> : null}
                      </div>
                      <div className="shrink-0 ml-auto">
                        <Status c={c} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
