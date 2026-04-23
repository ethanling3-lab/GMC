"use client";

import { useEffect } from "react";

// Fires once per thread-view mount. Upserts the per-admin cursor so Wave 2b
// can drive unread badges on the inbox list.

export function MarkReadOnMount({ conversationId }: { conversationId: string }) {
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/inbox/${conversationId}/read`, {
      method: "POST",
      signal: controller.signal,
    }).catch(() => {
      /* non-blocking — worst case the cursor stays stale for this session */
    });
    return () => controller.abort();
  }, [conversationId]);
  return null;
}
