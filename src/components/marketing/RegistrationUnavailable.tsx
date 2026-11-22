import {
  registrationBlockLabel,
  type RegistrationBlock,
} from "@/lib/event-registration-window";

export function RegistrationUnavailable({
  block,
  locale,
  className = "",
}: {
  block: RegistrationBlock;
  locale: "zh" | "en";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center px-5 rounded-full border border-[var(--paper-shadow)] bg-[var(--paper-deep)] text-[13px] font-medium text-[var(--ink-soft)] ${className}`}
    >
      {registrationBlockLabel(block, locale)}
    </span>
  );
}
