// Unresolved-placeholder detection for anything about to leave the building.
//
// Client-safe on purpose (no "server-only"): the composer previews with the
// same function that blocks the send, so what an admin is warned about and
// what is actually refused can never drift apart.
//
// WHY THIS EXISTS
//
// A WhatsApp message went out reading, literally:
//
//     Hi {name}, thanks for reaching out about {event}
//
// Two things had to be true at once for that to reach a real person:
//
//   1. `findUnresolvedTokens` lived in broadcasts/types.ts with a comment
//      claiming it was "used by the composer preview pane and by the pre-send
//      sanity check". It had ZERO call sites. Nothing checked anything.
//   2. Its regex only matched `${...}`. The text that shipped used single
//      braces, so even a wired-up detector would have waved it through.
//
// A dead guard and a guard that looks at the wrong thing fail identically,
// and both look like a guard in code review.
//
// WHAT COUNTS AS A TOKEN
//
// Both brace styles, because both appear in practice:
//
//   ${name}          the documented interpolation syntax (INTERPOLATION_TOKENS)
//   {name}           what people actually type, and what the snippet library
//                    is full of
//
// The inner shape stays deliberately narrow — `[A-Za-z0-9_.]+`, no spaces —
// so ordinary prose containing braces is not flagged. "{name}" trips it;
// "the {} operator" and "{ a: 1 }" do not.

const TOKEN_PATTERN = /\$?\{[A-Za-z0-9_.]+\}/g;

/** Every unresolved placeholder in `s`, in order, duplicates included. */
export function findUnresolvedTokens(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.match(TOKEN_PATTERN) ?? [];
}

/** Thrown by assertNoUnresolvedTokens. Carries the offending tokens so the
 *  API layer can name them instead of returning a generic failure. */
export class UnresolvedTokenError extends Error {
  readonly tokens: string[];
  constructor(tokens: string[]) {
    const unique = Array.from(new Set(tokens));
    super(
      `Message still contains unresolved placeholder${unique.length === 1 ? "" : "s"}: ` +
        `${unique.join(", ")}. Replace ${unique.length === 1 ? "it" : "them"} with real text, ` +
        `or use a documented \${token} that the sender resolves.`,
    );
    this.name = "UnresolvedTokenError";
    this.tokens = unique;
  }
}

/**
 * Refuse to send anything still carrying a placeholder.
 *
 * Call this at the single outbound choke point, never per-caller — the whole
 * failure being fixed here is a check that existed but was not reached.
 *
 * Blocking rather than best-effort substituting is deliberate. A literal
 * "{name}" is embarrassing; silently guessing the wrong name is worse, and
 * quietly deleting the token ships a sentence with a hole in it.
 */
export function assertNoUnresolvedTokens(...parts: Array<string | null | undefined>): void {
  const found = parts.flatMap(findUnresolvedTokens);
  if (found.length > 0) throw new UnresolvedTokenError(found);
}
