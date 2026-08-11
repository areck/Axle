const REDACTION = "***";

/**
 * The shortest secret value worth redacting. Values shorter than this are
 * treated as non-secret-like: redacting them would mangle unrelated output for
 * little gain (a 1–2 char "secret" would match everywhere).
 */
const MIN_REDACT_LENGTH = 4;

/**
 * Build a redactor that replaces literal occurrences of secret values with a
 * marker, so a secret a command happens to print never lands in the streamed
 * output, the log artifact, or a diagnostic.
 *
 * This is a safety net, not an exfiltration guarantee: values are matched
 * literally per output chunk, so a secret split across chunk boundaries or
 * transformed (base64, url-encoded, …) can still slip through. Longer values
 * are redacted first so a shorter secret that is a substring of a longer one
 * doesn't pre-empt it.
 */
export function makeRedactor(secretValues: string[]): (text: string) => string {
  const values = [...new Set(secretValues)]
    .filter((v) => v.length >= MIN_REDACT_LENGTH)
    .sort((a, b) => b.length - a.length);
  if (values.length === 0) return (text) => text;
  return (text) => {
    let out = text;
    for (const value of values) {
      if (out.includes(value)) out = out.split(value).join(REDACTION);
    }
    return out;
  };
}
