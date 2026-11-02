/**
 * Who is asking. Works with or without Clerk:
 *  - Clerk configured and signed in → keyed by user id, plan from Clerk
 *    publicMetadata (which users cannot edit from the browser).
 *  - Otherwise → anonymous free tier, keyed by a salted hash of the IP address.
 *    The raw IP is never stored or logged.
 */
import { createHash } from 'node:crypto';
import { planFrom, type Plan } from './plans';

export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export type Viewer = { key: string; userId: string | null; plan: Plan };

/**
 * Testing mode: set FREE_TESTING=true in Vercel to give every visitor the
 * Premium features (saved plans, side-by-side comparison, plan files) without
 * paying, and hide the upgrade prompts. Remove it to switch subscriptions back on.
 */
export const freeTesting = process.env.FREE_TESTING === 'true';
const TESTING_PLAN: Plan = 'premium';

let warnedSalt = false;

/**
 * Client IP. On Vercel, x-real-ip and x-forwarded-for are set by the platform,
 * so visitors can't spoof them. x-real-ip is preferred.
 */
function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export async function getViewer(req: Request): Promise<Viewer> {
  if (clerkEnabled) {
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (userId) {
      const user = await currentUser();
      return { key: `u:${userId}`, userId, plan: freeTesting ? TESTING_PLAN : planFrom(user?.publicMetadata) };
    }
  }
  const salt = process.env.IP_HASH_SALT;
  if (!salt && process.env.NODE_ENV === 'production' && !warnedSalt) {
    warnedSalt = true;
    console.warn('IP_HASH_SALT is not set. Set a long random value so visitor IP hashes cannot be reversed.');
  }
  const hash = createHash('sha256').update(`${salt ?? 'irl-dev'}|${clientIp(req)}`).digest('hex').slice(0, 32);
  return { key: `ip:${hash}`, userId: null, plan: freeTesting ? TESTING_PLAN : 'free' };
}
