import "server-only";

const GRAPH_API = "https://graph.facebook.com/v22.0";

type TemplateParam = string;

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/**
 * Send a WhatsApp template message via the Cloud API.
 * During M1 we use this for the confirmation link; templates must be pre-approved in the
 * Meta Business Manager. If credentials aren't set we log and return mocked:true so the
 * registration flow can be tested end-to-end without waiting for Meta verification.
 */
export async function sendWhatsAppTemplate(params: {
  to: string;
  template: string;
  languageCode: "zh_CN" | "en_US";
  components?: Array<{ type: "body"; parameters: Array<{ type: "text"; text: TemplateParam }> }>;
}): Promise<{ mocked: boolean; id?: string; error?: string }> {
  if (!isWhatsAppConfigured()) {
    console.log(
      `[whatsapp:mock] template="${params.template}" lang=${params.languageCode} to=${maskPhone(params.to)}`,
    );
    return { mocked: true };
  }

  try {
    const res = await fetch(
      `${GRAPH_API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: params.to,
          type: "template",
          template: {
            name: params.template,
            language: { code: params.languageCode },
            components: params.components ?? [],
          },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { mocked: false, error: `whatsapp ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { mocked: false, id: json.messages?.[0]?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown whatsapp error";
    return { mocked: false, error: msg };
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 5) return "***";
  return digits.slice(0, 3) + "*".repeat(Math.max(1, digits.length - 5)) + digits.slice(-2);
}
