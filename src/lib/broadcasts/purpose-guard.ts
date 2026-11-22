import "server-only";
import { findTemplate } from "@/lib/inbox/whatsapp-templates";
import {
  broadcastPurpose,
  templateFitsPurpose,
  type AudienceFilter,
  type BroadcastChannel,
} from "./types";

// The rule every send path checks before anything leaves: send now, schedule,
// the scheduled-send cron, and retry. Returns what's wrong in words an admin
// can act on, or null when the broadcast may go.
//
// Fails closed: if the template can't be confirmed with Meta, nothing is sent.
export async function broadcastSendProblem(broadcast: {
  audience_filter: AudienceFilter;
  channels: BroadcastChannel[];
  whatsapp_template_name: string | null;
}): Promise<string | null> {
  const purpose = broadcastPurpose(broadcast.audience_filter);

  if (purpose === "official" && broadcast.audience_filter.mode !== "event_cohort") {
    return "An official notice must go to the participants of one event.";
  }
  if (!broadcast.channels.includes("whatsapp")) return null;
  if (!broadcast.whatsapp_template_name) return "Pick a WhatsApp template.";

  let category: string | undefined;
  try {
    category = (await findTemplate(broadcast.whatsapp_template_name))?.category;
  } catch {
    return "Couldn't confirm this template with WhatsApp. Try again in a minute.";
  }
  if (!category) return "This WhatsApp template isn't approved. Pick another one.";
  if (!templateFitsPurpose(category, purpose)) {
    return purpose === "official"
      ? "Official notices can only use utility templates. Pick another one."
      : "Marketing broadcasts can only use marketing templates. Pick another one.";
  }
  return null;
}
