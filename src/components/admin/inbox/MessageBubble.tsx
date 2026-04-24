"use client";

import { useEffect, useState } from "react";
import type { ThreadMessageRow } from "@/lib/inbox/inbox-query";
import {
  DELIVERY_STATUS_LABEL,
  timestampFull,
} from "@/lib/inbox/format";

// A single message in the thread. Client component because attachments need
// signed-URL resolution and we want to show the day separator above it.
//
// Visual rhythm:
//   inbound  → left-aligned, warm paper bubble
//   outbound → right-aligned, cinnabar-washed bubble
//   system   → centered, italic meta row (enrollment events mirrored from notifications)

export function MessageBubble({
  message: m,
  showDaySeparator,
}: {
  message: ThreadMessageRow;
  showDaySeparator: boolean;
}) {
  const isOutbound = m.direction === "outbound";
  const isSystem = m.sender_type === "system";

  return (
    <>
      {showDaySeparator ? (
        <li aria-hidden="true" className="flex items-center gap-3 my-2">
          <span className="flex-1 h-px bg-[var(--paper-shadow)]" />
          <span className="text-[10px] tracking-[0.22em] uppercase text-[var(--ink-faint)] tabular-nums">
            {new Date(m.created_at).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </span>
          <span className="flex-1 h-px bg-[var(--paper-shadow)]" />
        </li>
      ) : null}

      {isSystem ? (
        <li className="flex justify-center">
          <div className="max-w-[70ch] text-center px-3 py-1.5 rounded-[var(--radius-pill)] border border-[var(--paper-shadow)] bg-[var(--paper)]/70 text-[11.5px] text-[var(--ink-mute)] italic leading-[1.5]">
            {m.body_text}
          </div>
        </li>
      ) : (
        <li className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[72%] min-w-[120px] ${isOutbound ? "items-end" : "items-start"} flex flex-col`}>
            {m.sender_type === "ai_agent" ? (
              <span className="mb-1 text-[9.5px] tracking-[0.22em] uppercase text-[var(--cinnabar)]">
                AI agent
              </span>
            ) : null}
            <div
              className={`rounded-[14px] px-4 py-2.5 text-[13.5px] leading-[1.55]
                          shadow-[0_1px_0_rgba(11,41,84,0.04),0_2px_6px_rgba(11,41,84,0.05)]
                          ${
                            isOutbound
                              ? "bg-[var(--cinnabar-wash)] border border-[var(--cinnabar)]/20 text-[var(--ink)] rounded-br-[6px]"
                              : "bg-[var(--paper)] border border-[var(--paper-shadow)] text-[var(--ink)] rounded-bl-[6px]"
                          }`}
            >
              {m.body_text ? (
                <p className="whitespace-pre-wrap break-words">{m.body_text}</p>
              ) : m.attachments.length === 0 ? (
                <p className="italic text-[var(--ink-faint)]">(empty message)</p>
              ) : null}

              {m.attachments.length > 0 ? (
                <div className="mt-2 flex flex-col gap-2">
                  {m.attachments.map((a, idx) => (
                    <AttachmentTile key={idx} attachment={a} />
                  ))}
                </div>
              ) : null}
            </div>

            <div className={`mt-1 flex items-center gap-2 text-[10.5px] tracking-[0.08em] text-[var(--ink-faint)] ${isOutbound ? "flex-row-reverse" : ""}`}>
              <span title={timestampFull(m.created_at)} className="tabular-nums">
                {new Date(m.created_at).toLocaleTimeString("en-GB", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </span>
              {isOutbound ? (
                <span
                  className={`uppercase tracking-[0.16em] ${
                    m.delivery_status === "failed"
                      ? "text-[var(--cinnabar-deep)]"
                      : ""
                  }`}
                >
                  {DELIVERY_STATUS_LABEL[m.delivery_status]?.en ?? m.delivery_status}
                </span>
              ) : null}
              {m.sender_admin?.name_en || m.sender_admin?.name_cn ? (
                <span>
                  · {m.sender_admin.name_en ?? m.sender_admin.name_cn}
                </span>
              ) : null}
            </div>
            {m.error_message ? (
              <div className="mt-1 text-[11px] text-[var(--cinnabar-deep)] italic max-w-full truncate">
                {m.error_message}
              </div>
            ) : null}
          </div>
        </li>
      )}
    </>
  );
}

function AttachmentTile({
  attachment,
}: {
  attachment: ThreadMessageRow["attachments"][number];
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!attachment.storage_path) return;
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/admin/inbox/attachments?paths=${encodeURIComponent(attachment.storage_path)}`,
    )
      .then((r) => r.json())
      .then((data: { urls?: Record<string, string> }) => {
        if (cancelled) return;
        setSignedUrl(data.urls?.[attachment.storage_path as string] ?? null);
      })
      .catch(() => {
        if (!cancelled) setSignedUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  const mime = attachment.mime_type ?? "application/octet-stream";
  const isImage = mime.startsWith("image/");
  const isAudio = mime.startsWith("audio/");
  const isPdf = mime === "application/pdf";

  if (attachment.error && !attachment.storage_path) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--cinnabar)]/25 bg-[var(--cinnabar-wash)] text-[11.5px] text-[var(--cinnabar-deep)]">
        <span>Attachment couldn&apos;t be downloaded · {attachment.error}</span>
      </div>
    );
  }

  if (isImage) {
    return (
      <a
        href={signedUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-deep)] max-w-[320px]"
      >
        {signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signedUrl}
            alt={attachment.caption ?? "Attachment"}
            className="block w-full h-auto"
          />
        ) : (
          <div className="w-full h-[140px] flex items-center justify-center text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            {loading ? "Loading…" : "Image"}
          </div>
        )}
      </a>
    );
  }

  if (isAudio) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-deep)] max-w-[320px]">
        {signedUrl ? (
          <audio controls src={signedUrl} className="w-full" />
        ) : (
          <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-faint)]">
            {loading ? "Loading…" : "Audio"}
          </span>
        )}
      </div>
    );
  }

  // PDF + generic file
  return (
    <a
      href={signedUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--paper-shadow)] bg-[var(--paper-deep)] text-[12px] text-[var(--ink)] hover:border-[var(--cinnabar)]/25 transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 1h5l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
        <path d="M8 1v3h3" />
      </svg>
      {attachment.filename ?? (isPdf ? "PDF" : "File")}
    </a>
  );
}
