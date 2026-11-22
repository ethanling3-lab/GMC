import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { findAuthUserByEmail } from "@/lib/auth-links";
import { sendParticipantAccountLink } from "@/lib/participant-invite";
import { createSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/auth/participant/forgot-password: emails a one-time link. Someone
// with a student record but no login yet gets a setup link instead. The
// response is the same whether or not the email exists.

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { email } = parsed.data;

  try {
    const service = createSupabaseServiceClient();
    const { data: candidates } = await service
      .from("participants")
      .select("id, email, name_en, name_cn")
      .ilike("email", email);
    const match = (candidates ?? []).find((c) => (c.email ?? "").trim().toLowerCase() === email);

    if (match || (await findAuthUserByEmail(email))) {
      const sent = await sendParticipantAccountLink(email, match?.name_en || match?.name_cn || "");
      if (sent.status === "sent") {
        await writeAuditLog({
          actor_id: null,
          action: "participant.password_reset_requested",
          entity: "auth",
          entity_id: sent.user_id,
          metadata: { link_type: sent.type },
        });
      } else {
        console.warn(`[forgot-password] link not sent: ${sent.status}`);
      }
    }
  } catch (err) {
    console.warn(`[forgot-password] ${err instanceof Error ? err.message : "failed"}`);
  }

  return NextResponse.json({
    ok: true,
    message: "If your email is in our system, you'll get a reset link shortly.",
  });
}
