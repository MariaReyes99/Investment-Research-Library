/**
 * Opens a chat projection in the wealth projector. The numbers travel in the
 * URL fragment (after #), which browsers never send to the server, so they
 * stay on the device.
 */
import { HouseholdInputSchema, type HouseholdInput } from './household';

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function projectorLink(input: HouseholdInput) {
  return `/calculator#plan=${toBase64Url(JSON.stringify(input))}`;
}

/** Reads a plan from location.hash. Returns null if there isn't a valid one. */
export function planFromHash(hash: string): HouseholdInput | null {
  const match = /(?:^#|&)plan=([A-Za-z0-9_-]+)/.exec(hash);
  if (!match || match[1].length > 20_000) return null;
  try {
    const parsed = HouseholdInputSchema.safeParse(JSON.parse(fromBase64Url(match[1])));
    return parsed.success ? (parsed.data as HouseholdInput) : null;
  } catch {
    return null;
  }
}
