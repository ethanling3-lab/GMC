import { z } from "zod";

export const REGIONS = ["MY", "SG", "TW", "HK", "CN", "VN"] as const;
export const GENDERS = ["male", "female", "other", "undisclosed"] as const;
export const LANGUAGES = ["zh", "en", "both"] as const;
import { MOTIVATIONS } from "@/lib/participants/motivations";
export { MOTIVATIONS };

export const ExtractedRowSchema = z.object({
  region_id: z.string().nullable(),
  name_en: z.string().nullable(),
  name_cn: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  region: z.enum(REGIONS).nullable(),
  language: z.enum(LANGUAGES).nullable(),
  gender: z.enum(GENDERS).nullable(),
  birth_date: z.string().nullable(),
  occupation: z.string().nullable(),
  industry: z.string().nullable(),
  motivations: z.array(z.enum(MOTIVATIONS)).nullable(),
  sells_products: z.boolean().nullable(),
  is_old_student: z.boolean().nullable(),
  notes: z.string().nullable(),
});

export type ExtractedRow = z.infer<typeof ExtractedRowSchema>;

export const ExtractionPayloadSchema = z.object({
  rows: z.array(ExtractedRowSchema),
  summary: z.string(),
});

export type ExtractionPayload = z.infer<typeof ExtractionPayloadSchema>;

export const EXTRACTION_SYSTEM_PROMPT = `You are a data-extraction assistant for the GMC (Glorious Melodies Consultancy) CRM — a Singapore-based music/wellness retreat operator running bilingual (EN/中文) events across Malaysia, Singapore, Taiwan, Hong Kong, and Mainland China.

Your ONE job: read the tabular/contact data the admin hands you and return a clean array of participant rows matching the provided schema.

Rules:
- Produce ONE row per distinct person. Never duplicate, never invent.
- If a field is missing in the source, return null — do not guess.
- **Student ID (\`region_id\`)**: if the source has an existing participant/student ID, put it here EXACTLY as written — including any leading zeros, dashes, or letters. Common column headers: "Student ID", "学员编号", "编号", "ID", "Participant ID", "Member ID", "Region ID". If an ID-looking column is present but blank for this row, return null. If no ID column exists at all, return null — the system will auto-assign one on insert.
- Names: separate English (\`name_en\`) and Chinese (\`name_cn\`) when both are present. Don't force-romanize Chinese names.
- Region codes are strict ISO-style: MY | SG | TW | HK | CN. Infer from city / country / phone prefix if obvious (e.g. +60 → MY, +65 → SG, +886 → TW, +852 → HK, +86 → CN). Otherwise null.
- Phone: preserve international format including the country code when present.
- Email: lowercase. If clearly malformed, return null.
- Gender values must be exactly one of: male | female | other | undisclosed. Map "M"/"男"→male, "F"/"女"→female.
- Language: zh | en | both. Infer from name script + source column if obvious.
- Birth date: normalise to ISO YYYY-MM-DD. Accept DD/MM/YYYY, MM/DD/YYYY (prefer DD/MM if ambiguous — most source files are SE-Asian), Chinese dates (e.g. 1985年3月15日). If only year is known, return null.
- motivations = WHY they attend, an ordered array (first = main reason) of: networking | spiritual | business | family | other. Fill only when the source states their reason for attending (e.g. "想认识人"/"networking" → networking, "修行"/"spiritual" → spiritual, "生意"/"business" → business, "家庭" → family). Default null.
- sells_products: a CAUTION flag — true only when the source shows they may be attending to recruit others into insurance / direct sales / MLM (e.g. occupation "insurance agent", "保险", "直销", "传销", or a note saying so). Otherwise null.
- is_old_student: true only if the source explicitly marks "old student" / "老学员" / "returning" etc. Otherwise null (treated as unknown — default is false in the DB).
- Per-row \`notes\`: a short (≤80 char) freeform comment capturing anything notable the admin should double-check (e.g. "phone missing country code", "two birth dates on file — picked latest"). null when nothing notable.
- Top-level \`summary\`: a 1–2 sentence summary of what you extracted (row count, any parsing caveats, source format observations).

Return the structured JSON as specified. No prose outside the JSON.`;
