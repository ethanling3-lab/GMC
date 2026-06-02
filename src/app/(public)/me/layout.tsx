import { requireParticipant } from "@/lib/participant-guard";
import { ParticipantShell } from "@/components/portal/ParticipantShell";

export default async function MeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const participant = await requireParticipant();
  return (
    <ParticipantShell
      participantName={participant.name_cn ?? participant.name_en ?? participant.email}
      regionId={participant.region_id}
    >
      {children}
    </ParticipantShell>
  );
}
