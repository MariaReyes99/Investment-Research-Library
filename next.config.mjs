/**
 * Security headers for every page and API response.
 *
 * The Content Security Policy only lets the browser load scripts, styles,
 * images and connections from this site (plus Clerk's sign-in service when
 * it's configured, following Clerk's documented CSP requirements). This blocks
 * injected third-party scripts, clickjacking in iframes, and form posts to
 * other sites. Stripe Checkout is a full-page redirect, so it needs no entries.
 */

/** Clerk's Frontend API host is encoded in the publishable key: pk_live_<base64("host$")>. */
function clerkFrontendApi() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return null;
  try {
    const host = Buffer.from(key.split('_')[2] ?? '', 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
}

const isDev = process.env.NODE_ENV !== 'production';
const clerk = clerkFrontendApi();
const clerkHosts = clerk ? [clerk, 'https://challenges.cloudflare.com', 'https://*.protect.clerk.com'] : [];

const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required by the Next.js App Router without nonces; 'unsafe-eval' only in development.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${clerkHosts.join(' ')}`,
  `connect-src 'self' ${clerk ? `${clerk} https://*.protect.clerk.com` : ''}`,
  `img-src 'self' data: blob:${clerk ? ' https://img.clerk.com' : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  `frame-src 'self'${clerk ? ' https://challenges.cloudflare.com' : ''}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
]
  .map((d) => d.replace(/\s+/g, ' ').trim())
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['tsx', 'ts'],
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
