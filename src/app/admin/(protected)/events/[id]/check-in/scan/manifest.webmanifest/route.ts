import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";

// M7.1d — Dynamic per-event PWA manifest. Each event's scanner gets its
// own home-screen icon + name, so admin can install multiple scanners
// (one per active event) without them colliding. The unique `id` field
// is what tells Chrome / Safari to treat each install as a distinct app.
//
// This route is auth-gated by the parent (protected) layout. That means
// only logged-in admins can install — fine since the scanner is admin-
// only anyway. The manifest itself contains no sensitive data.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx) {
  const { id } = await params;
  const service = createSupabaseServiceClient();

  const { data: event, error } = await service
    .from("events")
    .select("id, slug, title_en, title_cn")
    .eq("id", id)
    .maybeSingle();
  if (error || !event) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const title =
    (event.title_en as string | null) ??
    (event.title_cn as string | null) ??
    event.slug;
  const startUrl = `/admin/events/${event.id}/check-in/scan`;
  const manifest = {
    id: `gmc-scan-${event.id}`,
    name: `GMC Check-in · ${title}`,
    short_name: "GMC Check-in",
    description: `Door scanner for ${title}`,
    start_url: startUrl,
    scope: `/admin/events/${event.id}/check-in/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5EFE3",
    theme_color: "#0B2954",
    icons: [
      {
        src: "/icons/gmc-scan-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/gmc-scan-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/gmc-scan-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/gmc-scan-apple-touch.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
    ],
  };

  return new NextResponse(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "content-type": "application/manifest+json",
      "cache-control": "no-store",
    },
  });
}
