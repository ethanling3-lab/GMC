// The check-in desk shows customer service only what it takes to check someone
// in, so phone numbers are removed from every desk response for that role.

export function forDeskRole<T>(role: string, value: T): T {
  return role === "super_admin" ? value : (stripPhones(value) as T);
}

function stripPhones(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPhones);
  if (value instanceof Map) {
    return new Map([...value].map(([k, v]) => [k, stripPhones(v)]));
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, k === "phone" ? null : stripPhones(v)]),
    );
  }
  return value;
}
