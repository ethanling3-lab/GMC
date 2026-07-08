import type { Metadata } from "next";
import Image from "next/image";
import { requireParticipant } from "@/lib/participant-guard";
import { loadSelfProfile } from "@/lib/participant-self";
import { ComingSoonButton } from "@/components/portal/ComingSoonButton";

export const metadata: Metadata = { title: "Profile · 资料 — GMC" };
export const dynamic = "force-dynamic";

export default async function MeProfilePage() {
  const participant = await requireParticipant();
  const profile = await loadSelfProfile(participant.id);
  if (!profile) {
    return <p className="text-[var(--ink-mute)]">Profile not found.</p>;
  }

  const langLabel = profile.language_fluency
    ? profile.language_fluency === "cn"
      ? "中文"
      : profile.language_fluency === "en"
        ? "English"
        : "Both · 双语"
    : null;

  return (
    <div>
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="text-[11px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            — Profile · 资料
          </div>
          <h1 className="mt-3 font-display text-[28px] md:text-[32px] leading-[1.1] tracking-[-0.015em] text-[var(--ink)]">
            Your details.
          </h1>
        </div>
        <ComingSoonButton />
      </div>

      <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--paper-shadow)] bg-[var(--paper-warm)] p-5 md:p-6 shadow-[var(--shadow-paper-1)]">
        <div className="flex items-start gap-5 flex-wrap">
          {profile.front_photo_url ? (
            <div className="relative w-24 h-32 rounded-[var(--radius-md)] overflow-hidden bg-[var(--paper-deep)]">
              <Image
                src={profile.front_photo_url}
                alt={profile.name_en ?? profile.name_cn ?? "Photo"}
                fill
                className="object-cover"
                sizes="96px"
                unoptimized
              />
            </div>
          ) : (
            <div className="w-24 h-32 rounded-[var(--radius-md)] bg-[var(--paper-deep)] inline-flex items-center justify-center text-[24px] font-display text-[var(--ink-mute)]">
              {(profile.name_cn?.[0] ?? profile.name_en?.[0] ?? "?").toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] tabular-nums">
              {profile.region_id ?? "—"}
            </div>
            <div className="mt-1 font-display text-[24px] leading-[1.15] text-[var(--ink)]">
              {profile.name_cn ?? "—"}
            </div>
            {profile.name_en ? (
              <div className="text-[13px] italic text-[var(--ink-soft)]">{profile.name_en}</div>
            ) : null}
            {profile.dharma_name ? (
              <div className="mt-1.5 text-[12px] tracking-[0.06em] text-[var(--cinnabar-deep)]">
                法名 · {profile.dharma_name}
              </div>
            ) : null}
            {profile.is_old_student ? (
              <span className="mt-2 inline-block px-2 h-[20px] leading-[20px] rounded-[var(--radius-pill)] border border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)] text-[10.5px] tracking-[0.18em] uppercase text-[var(--cinnabar-deep)]">
                旧学员 · Returning
              </span>
            ) : null}
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <Field label_en="Email" label_cn="邮箱" value={profile.email} />
          <Field label_en="Phone" label_cn="电话" value={profile.phone} />
          <Field label_en="Region" label_cn="区域" value={profile.region} />
          <Field label_en="Language" label_cn="语言" value={langLabel} />
          <Field label_en="Gender" label_cn="性别" value={profile.gender} />
          <Field label_en="Date of birth" label_cn="出生日期" value={profile.birth_date} />
          <Field label_en="Occupation" label_cn="职业" value={profile.occupation} />
          <Field label_en="Industry" label_cn="行业" value={profile.industry} />
          <Field label_en="Religion" label_cn="宗教" value={profile.religion} />
          <Field label_en="Training level" label_cn="训练等级" value={profile.training_level} />
        </dl>

        {profile.attended_courses.length > 0 ? (
          <div className="mt-7 pt-6 border-t border-[var(--paper-shadow)]">
            <div className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
              Course history · 课程记录
            </div>
            <ol className="mt-3 space-y-1.5">
              {profile.attended_courses.map((c, i) => (
                <li
                  key={`${c.course_name}-${i}`}
                  className="flex items-baseline gap-3 text-[12.5px]"
                >
                  <span className="font-mono text-[10.5px] text-[var(--ink-faint)] tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-[var(--ink)]">{c.course_name}</span>
                  {c.date ? (
                    <span className="text-[10.5px] tabular-nums text-[var(--ink-mute)]">
                      {c.date}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Field({
  label_en,
  label_cn,
  value,
}: {
  label_en: string;
  label_cn: string;
  value: string | null;
}) {
  return (
    <div>
      <dt className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)]">
        {label_en} · {label_cn}
      </dt>
      <dd className="mt-1 text-[13.5px] text-[var(--ink)]">{value || "—"}</dd>
    </div>
  );
}

