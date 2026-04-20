"use client";

import { useRef, useState } from "react";

type Props = {
  token: string;
  initialUploaded: boolean;
  locale: "zh" | "en";
};

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export function TransferSlipUploader({ token, initialUploaded, locale }: Props) {
  const [uploaded, setUploaded] = useState(initialUploaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pickAndUpload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(
        locale === "zh"
          ? "文件超过 5 MB 上限，请压缩后再试。"
          : "File exceeds 5 MB. Please compress and try again.",
      );
      return;
    }
    setFilename(file.name);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}/slip`, {
        method: "POST",
        body: form,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = payload?.error;
        if (code === "file_too_large") {
          throw new Error(
            locale === "zh" ? "文件过大。" : "File is too large.",
          );
        }
        if (code === "unsupported_type") {
          throw new Error(
            locale === "zh"
              ? "暂不支持的文件类型，请上传 JPG/PNG/WEBP/PDF。"
              : "Unsupported file type. Please upload a JPG, PNG, WEBP, or PDF.",
          );
        }
        if (code === "invalid_token") {
          throw new Error(
            locale === "zh"
              ? "上传链接已过期，请联系 GMC 客服重新发送。"
              : "This upload link is expired. Please ask GMC for a new one.",
          );
        }
        throw new Error(payload?.detail ?? `Upload failed (${res.status})`);
      }
      setUploaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (uploaded) {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--jade)]/30 bg-[var(--jade-wash)] px-4 py-3">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--jade)]/20 text-[var(--jade-deep)]"
          aria-hidden="true"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7.2l3 3 5-6" />
          </svg>
        </span>
        <div className="text-[13px] text-[var(--jade-deep)] leading-[1.55]">
          <div className="font-medium">
            {locale === "zh" ? "已收到您的转账凭证" : "Transfer slip received"}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--ink-mute)]">
            {locale === "zh"
              ? "团队会在工作日内核对，并通过邮件发送收据。"
              : "Our team will verify and email you a receipt within a working day."}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setUploaded(false);
            setFilename(null);
            setError(null);
          }}
          className="ml-auto text-[11.5px] tracking-[0.14em] uppercase text-[var(--ink-mute)] hover:text-[var(--cinnabar-deep)] transition-colors duration-[var(--dur-fast)]"
        >
          {locale === "zh" ? "重新上传" : "Re-upload"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--cinnabar)]/30 bg-[var(--cinnabar-wash)]/40 px-4 py-4">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickAndUpload(f);
          // Allow re-upload of the same file later.
          e.target.value = "";
        }}
        disabled={busy}
      />
      <div className="flex items-start gap-3">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar)]"
          aria-hidden="true"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 9.5V2.5M3.5 6L7 2.5l3.5 3.5" />
            <path d="M2.5 11h9" />
          </svg>
        </span>
        <div className="flex-1">
          <div className="text-[13px] text-[var(--ink)] font-medium leading-[1.5]">
            {locale === "zh"
              ? "上传银行转账凭证（可选）"
              : "Upload your transfer slip (optional)"}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--ink-mute)] leading-[1.6]">
            {locale === "zh"
              ? "上传后我们能更快为您核对。也可通过 WhatsApp 或邮件回复发送。支持 JPG / PNG / PDF，大小不超过 5 MB。"
              : "Upload helps us match your transfer faster. You can also reply on WhatsApp or email if easier. JPG / PNG / PDF, up to 5 MB."}
          </div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-[var(--radius-pill)]
                     border border-[var(--cinnabar)]/40 bg-[var(--paper)] text-[var(--cinnabar-deep)]
                     text-[12px] tracking-[0.04em] font-medium
                     hover:bg-[var(--cinnabar)] hover:text-[var(--paper-warm)] hover:border-[var(--cinnabar)]
                     transition-[background-color,color,border-color] duration-[var(--dur-fast)]
                     disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="animate-spin">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
              <path d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : null}
          {locale === "zh" ? "选择文件" : "Choose file"}
        </button>
      </div>
      {filename && busy ? (
        <div className="mt-2 text-[11.5px] text-[var(--ink-mute)] truncate">
          {locale === "zh" ? "正在上传：" : "Uploading: "}
          <span className="font-mono">{filename}</span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-2 text-[12px] text-[var(--cinnabar-deep)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}
