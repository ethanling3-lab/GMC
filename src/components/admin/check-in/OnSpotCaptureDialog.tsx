"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extractEmbeddingFromImage } from "@/lib/face-recognition/extract";
import { playError, playSuccess } from "@/lib/check-in/audio-cues";

// M7.1d — On-spot enrollment + check-in dialog. Triggered from a manual
// search row for a participant who's missing a photo / embedding /
// consent. Single chain:
//   consent modal → capture frame → preview → persist chain → check in
//
// Persist chain (sequential, with rollback on partial failure):
//   1. POST photo (multipart) → /api/admin/participants/[id]/photo
//   2. Extract embedding client-side via extractEmbeddingFromImage
//   3. PATCH participants → facial_recognition_consent = true
//   4. POST embedding → /api/admin/participants/[id]/face-embedding
//   5. POST check-in → /api/admin/events/[id]/check-in (method: "manual")
//
// Dialog is portal-mounted on document.body so canvas/scroll-lock works
// inside the scanner's GPU-promoted container (lesson from the floor-plan
// dialog gotcha — see feedback_dialog_portal memory).

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  eventId: string;
  participant: {
    enrollment_id: string;
    participant_id: string;
    region_id: string | null;
    name_cn: string | null;
    name_en: string | null;
  };
};

type Step =
  | "consent"
  | "capture"
  | "preview"
  | "persisting"
  | "done"
  | "error";

type PersistStage =
  | "uploading_photo"
  | "extracting_embedding"
  | "setting_consent"
  | "saving_embedding"
  | "checking_in";

const STAGE_LABEL: Record<PersistStage, string> = {
  uploading_photo: "Uploading photo · 上传照片",
  extracting_embedding: "Extracting face · 提取人脸",
  setting_consent: "Setting consent · 同意授权",
  saving_embedding: "Saving embedding · 保存特征",
  checking_in: "Checking in · 完成签到",
};

export function OnSpotCaptureDialog({
  open,
  onClose,
  onSuccess,
  eventId,
  participant,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("consent");
  const [consentChecked, setConsentChecked] = useState(false);
  const [persistStage, setPersistStage] = useState<PersistStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  // Render only on the client + lock body scroll while open
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "persisting") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, step]);

  // Reset state every time the dialog opens
  useEffect(() => {
    if (open) {
      setStep("consent");
      setConsentChecked(false);
      setPersistStage(null);
      setError(null);
      setPreviewUrl(null);
      setPreviewBlob(null);
    }
  }, [open]);

  // Camera lifecycle for the capture step
  useEffect(() => {
    if (step !== "capture") {
      // Clean up any active stream when leaving the capture step
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera unavailable");
        setStep("error");
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [step]);

  // Revoke object URLs when they're no longer in use
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (!blob) {
      setError("Failed to capture frame");
      setStep("error");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(blob);
    setPreviewBlob(blob);
    setPreviewUrl(url);
    setStep("preview");
  }

  async function persistChain() {
    if (!previewBlob) {
      setError("No photo to upload");
      setStep("error");
      return;
    }
    setStep("persisting");
    setError(null);

    // 1. Upload photo
    setPersistStage("uploading_photo");
    let photoUrl: string;
    try {
      const fd = new FormData();
      fd.append("action", "upload");
      fd.append(
        "file",
        new File([previewBlob], "on-spot.jpg", { type: "image/jpeg" }),
      );
      const res = await fetch(
        `/api/admin/participants/${participant.participant_id}/photo`,
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `upload_failed_${res.status}`);
      }
      const json = (await res.json()) as { ok: true; url: string };
      photoUrl = json.url;
    } catch (err) {
      handleChainError(err, "photo");
      return;
    }

    // 2. Extract embedding (client-side)
    setPersistStage("extracting_embedding");
    let embedding: number[] | null = null;
    try {
      const result = await extractEmbeddingFromImage(photoUrl);
      if (!result.ok) {
        throw new Error(`Face not detected · ${result.error}`);
      }
      embedding = result.embedding;
    } catch (err) {
      handleChainError(err, "embedding");
      return;
    }

    // 3. Flip consent
    setPersistStage("setting_consent");
    try {
      const res = await fetch(
        `/api/admin/participants/${participant.participant_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facial_recognition_consent: true }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `consent_failed_${res.status}`);
      }
    } catch (err) {
      handleChainError(err, "consent");
      return;
    }

    // 4. Save embedding
    setPersistStage("saving_embedding");
    try {
      const res = await fetch(
        `/api/admin/participants/${participant.participant_id}/face-embedding`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embedding }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `embedding_failed_${res.status}`);
      }
    } catch (err) {
      handleChainError(err, "embedding-persist");
      return;
    }

    // 5. Check in
    setPersistStage("checking_in");
    try {
      const res = await fetch(`/api/admin/events/${eventId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: participant.enrollment_id,
          method: "manual",
          notes: "on_spot_capture",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `checkin_failed_${res.status}`);
      }
    } catch (err) {
      handleChainError(err, "check-in");
      return;
    }

    setStep("done");
    playSuccess();
    setTimeout(() => {
      onSuccess();
      onClose();
    }, 1600);
  }

  function handleChainError(err: unknown, where: string) {
    const msg =
      err instanceof Error ? err.message : `Unknown error at ${where}`;
    setError(msg);
    setStep("error");
    playError();
  }

  if (!mounted || !open) return null;
  const name =
    participant.name_cn ?? participant.name_en ?? participant.region_id ?? "—";

  const content = (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== "persisting") onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[480px] max-h-[88vh] overflow-y-auto bg-[var(--paper-warm)] border border-[var(--paper-deep)] rounded-[18px] shadow-[var(--shadow-elevated)] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-[var(--paper-deep)]">
          <div className="text-[10.5px] tracking-[0.28em] uppercase text-[var(--cinnabar)]">
            Capture & check in · 拍照签到
          </div>
          <div className="mt-1 font-display text-[18px] leading-tight text-[var(--ink)]">
            {name}
            {participant.region_id ? (
              <span className="ml-2 text-[12px] tabular-nums text-[var(--ink-mute)]">
                {participant.region_id}
              </span>
            ) : null}
          </div>
        </div>

        {/* Body — step-dependent */}
        {step === "consent" ? (
          <div className="px-5 py-5">
            <p className="text-[14px] leading-[1.7] text-[var(--ink-soft)]">
              Confirm verbal consent before capturing.
            </p>
            <p className="mt-2 text-[14px] leading-[1.7] text-[var(--ink-soft)]">
              请在拍摄前获得 <strong>{name}</strong> 的口头同意。
              照片将用于现场签到验证。
            </p>
            <label className="mt-5 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-[var(--paper-shadow)] text-[var(--cinnabar)] focus:ring-[var(--cinnabar)]/30 cursor-pointer"
              />
              <span className="text-[13.5px] leading-[1.6] text-[var(--ink)]">
                I confirmed verbal consent · 已获得口头同意
              </span>
            </label>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center h-[44px] px-4 rounded-[var(--radius-pill)] bg-[var(--paper)] border border-[var(--paper-deep)] text-[12.5px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
              >
                Cancel · 取消
              </button>
              <button
                type="button"
                onClick={() => consentChecked && setStep("capture")}
                disabled={!consentChecked}
                className="inline-flex items-center h-[44px] px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12.5px] tracking-[0.04em] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Continue · 继续
              </button>
            </div>
          </div>
        ) : null}

        {step === "capture" ? (
          <div className="px-5 py-5 flex flex-col gap-4">
            <div className="text-[12px] text-[var(--ink-soft)] text-center">
              Centre the face. Good lighting. · 请对准面部，保持光线充足。
            </div>
            <div className="relative aspect-[4/3] bg-black rounded-[14px] overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="w-full h-full object-cover"
              />
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center h-[44px] px-4 rounded-[var(--radius-pill)] bg-[var(--paper)] border border-[var(--paper-deep)] text-[12.5px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void captureFrame()}
                className="inline-flex items-center h-[44px] px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12.5px] tracking-[0.04em] font-medium hover:opacity-90 transition-opacity"
              >
                Capture · 拍照
              </button>
            </div>
          </div>
        ) : null}

        {step === "preview" && previewUrl ? (
          <div className="px-5 py-5 flex flex-col gap-4">
            <div className="text-[12px] text-[var(--ink-soft)] text-center">
              Looks good? · 照片可以吗？
            </div>
            <div className="relative bg-black rounded-[14px] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt=""
                className="w-full h-auto block"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setStep("capture")}
                className="inline-flex items-center h-[44px] px-4 rounded-[var(--radius-pill)] bg-[var(--paper)] border border-[var(--paper-deep)] text-[12.5px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
              >
                Retake · 重拍
              </button>
              <button
                type="button"
                onClick={() => void persistChain()}
                className="inline-flex items-center h-[44px] px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12.5px] tracking-[0.04em] font-medium hover:opacity-90 transition-opacity"
              >
                Use & check in · 使用并签到
              </button>
            </div>
          </div>
        ) : null}

        {step === "persisting" ? (
          <div className="px-5 py-8 flex flex-col items-center gap-3">
            <Spinner />
            <div className="text-[13px] tracking-[0.04em] text-[var(--ink-soft)]">
              {persistStage ? STAGE_LABEL[persistStage] : "Working…"}
            </div>
            <div className="text-[10.5px] tracking-[0.12em] uppercase text-[var(--ink-faint)] tabular-nums">
              {persistStage === "uploading_photo"
                ? "Step 1 / 5"
                : persistStage === "extracting_embedding"
                  ? "Step 2 / 5"
                  : persistStage === "setting_consent"
                    ? "Step 3 / 5"
                    : persistStage === "saving_embedding"
                      ? "Step 4 / 5"
                      : persistStage === "checking_in"
                        ? "Step 5 / 5"
                        : ""}
            </div>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="px-5 py-8 flex flex-col items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--cinnabar)]">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--paper)]"
              >
                <polyline points="5 12 10 17 19 8" />
              </svg>
            </div>
            <div className="text-[13px] tracking-[0.04em] text-[var(--ink)]">
              Checked in · 已签到
            </div>
          </div>
        ) : null}

        {step === "error" ? (
          <div className="px-5 py-5 flex flex-col gap-3">
            <div className="text-[13px] leading-snug text-[var(--cinnabar-deep)]">
              <strong>Failed · 失败:</strong> {error ?? "Unknown error"}
            </div>
            <div className="flex gap-3 justify-end mt-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center h-[44px] px-4 rounded-[var(--radius-pill)] bg-[var(--paper)] border border-[var(--paper-deep)] text-[12.5px] tracking-[0.04em] text-[var(--ink-mute)] hover:text-[var(--cinnabar)] transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setStep("capture")}
                className="inline-flex items-center h-[44px] px-5 rounded-[var(--radius-pill)] bg-[var(--cinnabar)] text-[var(--paper)] text-[12.5px] tracking-[0.04em] font-medium hover:opacity-90 transition-opacity"
              >
                Retry · 重试
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function Spinner() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      className="animate-spin text-[var(--cinnabar)]"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M19.5 11A8.5 8.5 0 0 0 11 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
