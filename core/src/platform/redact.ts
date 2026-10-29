// SEC-03, PRV-03: structured logs are redacted before they leave the process.
const SENSITIVE_KEYS = /pass(word)?|secret|token|otp|authorization|cookie|csrf|mfa|national|citizenship|account(_?no|number)?|phone|mobile|email|dob|birth|card|pan/i;
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b(?:\+?977[- ]?)?9[78]\d{8}\b/g, '[phone]'],
  [/\b\d{9,18}\b/g, '[number]'],
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return VALUE_PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)]),
    );
  }
  return value;
}
