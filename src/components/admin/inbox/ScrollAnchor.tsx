"use client";

import { useEffect, useRef } from "react";

// Tail marker rendered as the last item in the thread list. Whenever the
// message count changes (new inbound, admin reply, server refresh), we
// scroll this marker into view so the latest message is always visible
// without the composer pushing off screen.

export function ScrollAnchor({ dep }: { dep: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `block: "end"` keeps the anchor flush at the bottom of the scroll
    // container. `behavior: "instant"` on mount so the user lands at the
    // latest message, smooth on subsequent updates for a nicer feel.
    el.scrollIntoView({ block: "end", behavior: "instant" as ScrollBehavior });
  }, [dep]);

  return <div ref={ref} aria-hidden="true" className="h-0" />;
}
