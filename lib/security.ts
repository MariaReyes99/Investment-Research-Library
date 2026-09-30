/**
 * Request hardening for the public API routes.
 *
 *  - assertSameOrigin: rejects cross-site requests (CSRF). Browsers always
 *    send Origin / Sec-Fetch-Site on POST, so another website can't make a
 *    visitor's browser spend their quota or start a checkout.
 *  - readJsonBody: rejects non-JSON and oversized bodies before parsing, so a
 *    huge payload can't tie up the server or run up OpenAI costs.
 *  - sanitizeChatMessages: rebuilds the conversation from an allowlist. Only
 *    "user" and "assistant" text is kept. A client can't inject "system"
 *    messages, forged tool results, attachments or oversized history.
 */
import { z } from 'zod';

export type Rejection = { ok: false; status: number; message: string };

const reject = (status: number, message: string): Rejection => ({ ok: false, status, message });

/** Allow only same-origin browser requests. Requests with no Origin (curl, server-to-server) fall through to rate limits. */
export function assertSameOrigin(req: Request): Rejection | null {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return reject(403, 'Cross-site requests are not allowed.');
  }
  const origin = req.headers.get('origin');
  if (!origin) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return reject(403, 'Invalid origin.');
  }
  const allowed = new Set<string>();
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) allowed.add(host);
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    try {
      allowed.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).host);
    } catch {
      /* ignore a malformed setting */
    }
  }
  return allowed.has(originHost) ? null : reject(403, 'Cross-site requests are not allowed.');
}

/** Read a JSON body with a hard byte limit, without trusting Content-Length. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<{ ok: true; data: unknown } | Rejection> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return reject(415, 'Requests must be JSON.');

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return reject(413, 'Request is too large.');
  if (!req.body) return reject(400, 'Request body is empty.');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return reject(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return reject(400, 'Invalid JSON body.');
  }
}

export const CHAT_LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxMessagesInRequest: 100,
  maxHistory: 12,
  maxUserChars: 2000,
  maxAssistantChars: 8000,
} as const;

const IncomingSchema = z.object({
  messages: z
    .array(z.object({ role: z.string(), content: z.unknown() }).passthrough())
    .min(1)
    .max(CHAT_LIMITS.maxMessagesInRequest),
});

export type CleanMessage = { role: 'user' | 'assistant'; content: string };

/** How many earlier projections to carry into follow-up questions. */
const PROJECTIONS_KEPT = 2;

/**
 * Rebuild the conversation from scratch. Anything not on the allowlist is
 * dropped: system/data/tool roles, toolInvocations, parts, attachments, ids.
 */
export function sanitizeChatMessages(
  body: unknown,
  /** Describes tool results on an assistant message (for example the projection inputs), so follow-ups can refer back. */
  describeTools?: (toolInvocations: unknown) => string,
): { ok: true; messages: CleanMessage[] } | Rejection {
  const parsed = IncomingSchema.safeParse(body);
  if (!parsed.success) return reject(400, 'Request must include a messages array (at most 100 messages).');

  const cleaned: CleanMessage[] = [];
  const notes: { index: number; note: string }[] = [];
  for (const m of parsed.data.messages) {
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.replace(/\u0000/g, '').trim();
    const note = m.role === 'assistant' && describeTools ? describeTools((m as { toolInvocations?: unknown }).toolInvocations) : '';
    if (!content && !note) continue;
    if (note) notes.push({ index: cleaned.length, note });
    if (m.role === 'user' && content.length > CHAT_LIMITS.maxUserChars) {
      return reject(413, `Please keep questions under ${CHAT_LIMITS.maxUserChars} characters.`);
    }
    cleaned.push({
      role: m.role,
      content: m.role === 'assistant' ? content.slice(0, CHAT_LIMITS.maxAssistantChars) : content,
    });
  }
  // Attach only the most recent projections, to keep the request small
  for (const { index, note } of notes.slice(-PROJECTIONS_KEPT)) cleaned[index].content += note;

  let recent = cleaned.slice(-CHAT_LIMITS.maxHistory);
  const firstUser = recent.findIndex((m) => m.role === 'user');
  if (firstUser === -1) return reject(400, 'The conversation must include a question.');
  recent = recent.slice(firstUser);
  if (recent[recent.length - 1].role !== 'user') return reject(400, 'The last message must be a question.');
  return { ok: true, messages: recent };
}

/** Only http(s) links are rendered; anything else (javascript:, data:) is dropped. */
export function safeHttpUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
