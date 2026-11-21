import { redirect } from "next/navigation";

// The desk scanner now lives on the check-in page itself (one-stop: scan,
// manual search, and today's progress together). Kept as a redirect so old
// links, bookmarks and home-screen installs still land in the right place.

type PageProps = { params: Promise<{ id: string }> };

export default async function CheckInScanRedirect({ params }: PageProps) {
  const { id } = await params;
  redirect(`/admin/events/${id}/check-in`);
}
