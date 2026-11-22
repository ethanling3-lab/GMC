import { redirect } from "next/navigation";

// Logistics now lives on each event. Keeps old bookmarks working.
export default async function LegacyTransferListPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ dir?: string }>;
}) {
  const { eventId } = await params;
  const { dir } = await searchParams;
  const query = dir === "departure" ? "?dir=departure" : "";
  redirect(`/admin/events/${eventId}/logistics${query}`);
}
