import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase";

/**
 * CS work only on their own customers (participants.assigned_cs_id).
 * True when this enrolment's participant is assigned to that CS.
 * (Phase 3, 2026-11-26 — flights limited to own customers.)
 */
export async function csOwnsEnrollment(csId: string, enrollmentId: string): Promise<boolean> {
  const { data } = await createSupabaseServiceClient()
    .from("enrollments")
    .select("id, participant:participants!inner(assigned_cs_id)")
    .eq("id", enrollmentId)
    .maybeSingle<{ id: string; participant: { assigned_cs_id: string | null } | null }>();
  return Boolean(data && data.participant?.assigned_cs_id === csId);
}
