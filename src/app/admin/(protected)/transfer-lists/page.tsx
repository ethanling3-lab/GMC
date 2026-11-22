import { redirect } from "next/navigation";

// Logistics now lives on each event. Keeps old bookmarks working.
export default function LegacyTransferListsPage() {
  redirect("/admin/events");
}
