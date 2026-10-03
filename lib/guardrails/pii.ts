/**
 * Personal and payment data guardrails.
 *
 * Run redactPII() on every user message BEFORE it is sent to OpenAI, written
 * to logs or analytics (PostHog), or saved as a report. Payment card data is
 * never processed: the request is blocked and the user is told to pay through
 * the Stripe checkout page instead.
 *
 * Deliberately NOT redacted: ages, dollar amounts and percentages, because the
 * research and projection features need them and they don't identify a person
 * on their own.
 */

export type PiiType =
  | "card_number"
  | "card_security_code"
  | "card_expiry"
  | "bank_account"
  | "ird_number"
  | "tax_number"
  | "email"
  | "phone"
  | "date_of_birth"
  | "street_address"
  | "passport_or_licence"
  | "secret_key";

export interface RedactionResult {
  clean: string;
  findings: Partial<Record<PiiType, number>>;
  /** True when payment card data was present: do not process this message. */
  blocked: boolean;
  userNotice?: string;
}

const BLOCKING: PiiType[] = ["card_number", "card_security_code", "card_expiry"];

/** Luhn checksum, so ordinary long numbers aren't mistaken for cards. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let k = digits.length - 1; k >= 0; k--) {
    let d = digits.charCodeAt(k) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** NZ IRD number check-digit validation (IRD's published algorithm). */
export function irdValid(input: string): boolean {
  const n = input.replace(/\D/g, "");
  if (n.length < 8 || n.length > 9) return false;
  const num = Number(n);
  if (num < 10_000_000 || num > 150_000_000) return false;
  const base = n.slice(0, -1).padStart(8, "0");
  const check = Number(n.slice(-1));
  const calc = (w: number[]) => {
    const s = [...base].reduce((acc, ch, idx) => acc + Number(ch) * w[idx], 0);
    const r = s % 11;
    return r === 0 ? 0 : 11 - r;
  };
  let c = calc([3, 2, 7, 6, 5, 4, 3, 2]);
  if (c === 10) c = calc([7, 4, 3, 2, 5, 2, 7, 6]);
  return c !== 10 && c === check;
}

interface Rule {
  type: PiiType;
  re: RegExp;
  /** Optional extra check on the match; return false to keep the text. */
  test?: (m: string) => boolean;
}

// Order matters: specific patterns run before general ones.
const RULES: Rule[] = [
  { type: "secret_key", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b|\bsk-[A-Za-z0-9_-]{20,}\b/g },
  // NZ bank account: 12-3456-1234567-00 (last part 2 or 3 digits)
  { type: "bank_account", re: /\b\d{2}[- ]\d{4}[- ]\d{7}[- ]\d{2,3}\b/g },
  {
    type: "card_number",
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    test: (m) => {
      const d = m.replace(/\D/g, "");
      return d.length >= 13 && d.length <= 19 && luhnValid(d);
    },
  },
  { type: "card_security_code", re: /\b(?:cvv2?|cvc2?|csc|security code)\s*[:#=]?\s*\d{3,4}\b/gi },
  { type: "card_expiry", re: /\b(?:exp(?:iry|ires|iration)?|valid thru)\s*[:#=]?\s*(?:0[1-9]|1[0-2])\s*[/-]\s*(?:\d{2}|\d{4})\b/gi },
  { type: "bank_account", re: /\b(?:iban|account (?:no\.?|number))\s*[:#]?\s*[A-Z0-9][A-Z0-9 -]{7,33}\b/gi },
  // IRD: keyword-labelled, or a dashed 8-9 digit number that passes the checksum
  { type: "ird_number", re: /\b(?:ird|tax file|tfn|tax number)\s*(?:no\.?|number|#)?\s*[:#]?\s*\d{2,3}[- ]?\d{3}[- ]?\d{3}\b/gi },
  { type: "ird_number", re: /\b\d{2,3}-\d{3}-\d{3}\b/g, test: irdValid },
  // US Social Security number: labelled, or in the usual 3-2-4 format (skipping numbers that are never issued)
  { type: "tax_number", re: /\b(?:ssn|social security (?:no\.?|number))\s*[:#]?\s*\d{3}[- ]?\d{2}[- ]?\d{4}\b/gi },
  { type: "tax_number", re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  // UK National Insurance number, e.g. QQ 12 34 56 C
  { type: "tax_number", re: /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gi },
  // Philippine TIN: labelled, 9 to 12 digits in groups of three
  { type: "tax_number", re: /\b(?:tin|tax identification (?:no\.?|number))\s*[:#]?\s*\d{3}[- ]?\d{3}[- ]?\d{3}(?:[- ]?\d{3,5})?\b/gi },
  { type: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // NZ/AU/international phone numbers
  { type: "phone", re: /(?:\+\d{1,3}[ -]?)?\(?0?\d{1,2}\)?[ -]?\d{3,4}[ -]?\d{3,4}\b/g,
    test: (m) => {
      const d = m.replace(/\D/g, "");
      return d.length >= 8 && d.length <= 13 && /^(\+|0|\()/.test(m.trim());
    } },
  { type: "date_of_birth", re: /\b(?:dob|d\.o\.b\.?|date of birth|born(?: on)?)\s*[:#]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/gi },
  { type: "street_address",
    re: /\b\d{1,5}[A-Za-z]?\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Place|Pl|Crescent|Cres|Lane|Ln|Terrace|Tce|Way|Grove|Close|Parade|Highway|Hwy)\b\.?/g },
  { type: "passport_or_licence", re: /\b(?:passport|driver'?s? licen[cs]e|licen[cs]e (?:no\.?|number))\s*[:#]?\s*[A-Z]{1,2}\d{6,8}\b/gi },
];

export function redactPII(text: string): RedactionResult {
  const findings: RedactionResult["findings"] = {};
  let clean = text;

  for (const rule of RULES) {
    clean = clean.replace(rule.re, (m) => {
      if (rule.test && !rule.test(m)) return m;
      findings[rule.type] = (findings[rule.type] ?? 0) + 1;
      return `[${rule.type.toUpperCase()} REMOVED]`;
    });
  }

  const blocked = BLOCKING.some((t) => findings[t]);
  const found = Object.keys(findings) as PiiType[];

  return {
    clean,
    findings,
    blocked,
    userNotice: blocked
      ? "It looks like your message contains payment card details, so it wasn't processed or stored. Please never share card details in chat. To upgrade, go to the Plans page, which opens Stripe's secure checkout."
      : found.length
        ? `For your privacy, we removed ${found.map((t) => t.replace(/_/g, " ")).join(", ")} before processing your question. You don't need to share personal identifiers to use the library.`
        : undefined,
  };
}

/** Recursively redact strings inside any object (for logs and analytics events). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactPII(value).clean as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactDeep(v)]),
    ) as T;
  }
  return value;
}

/** Drop-in replacement for console.log in API routes. */
export const safeLog = (...args: unknown[]) => console.log(...args.map(redactDeep));
