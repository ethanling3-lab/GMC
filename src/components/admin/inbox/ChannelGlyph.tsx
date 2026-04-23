// Per-channel glyph used on avatars + filter chips + message bubbles. Kept
// as a pure SVG component so it's safe on both server + client.

export function ChannelGlyph({
  channel,
  size = 12,
}: {
  channel: string;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (channel === "whatsapp") {
    return (
      <svg {...common}>
        <path d="M3 13l.9-3A5 5 0 1 1 6 13.1z" />
        <path d="M6 7.5c.4 1.4 1.2 2.2 2.5 2.6l.7-.9 1.4.6-.3 1.3c-.7.2-1.4.1-2.3-.3-1.6-.6-2.7-1.7-3.3-3.2-.4-.9-.5-1.6-.3-2.3l1.3-.3.6 1.4-.9.7z" />
      </svg>
    );
  }
  if (channel === "line") {
    return (
      <svg {...common}>
        <rect x="2" y="3" width="12" height="9" rx="2.2" />
        <path d="M5 6.5v3M5 7.5h2.5M10 6.5h-2v3h2M10 8h-1.5" />
      </svg>
    );
  }
  if (channel === "email") {
    return (
      <svg {...common}>
        <rect x="2" y="4" width="12" height="8" rx="1.2" />
        <path d="M2.5 5l5.5 4 5.5-4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}
