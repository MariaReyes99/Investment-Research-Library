/**
 * Who is asking. Works with or without Clerk:
 *  - Clerk configured and signed in → keyed by user id, plan from Clerk metadata.
 *  - Otherwise → anonymous free tier, keyed by a hash of the IP address
 *    (the raw IP is never stored).
 */
import { createHash } from 'node:crypto';
import { planFrom, type Plan } from './plans';

export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export type Viewer = { key: string; userId: string | null; plan: Plan };

export async function getViewer(req: Request): Promise<Viewer> {
  if (clerkEnabled) {
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (userId) {
      const user = await currentUser();
      return { key: `u:${userId}`, userId, plan: planFrom(user?.publicMetadata) };
    }
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const salt = process.env.IP_HASH_SALT ?? 'irl';
  return { key: `ip:${createHash('sha256').update(salt + ip).digest('hex').slice(0, 24)}`, userId: null, plan: 'free' };
}
