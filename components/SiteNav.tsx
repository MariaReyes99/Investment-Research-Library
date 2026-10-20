import Link from 'next/link';

export type NavKey = 'ask' | 'calculator' | 'pricing' | 'about' | 'methodology' | 'sources';

const LINKS: { href: string; label: string; key: NavKey }[] = [
  { href: '/', label: 'Ask the library', key: 'ask' },
  { href: '/?tab=numbers', label: 'My numbers', key: 'calculator' },
  { href: '/methodology', label: 'Methodology', key: 'methodology' },
  { href: '/sources', label: 'Sources', key: 'sources' },
  { href: '/about', label: 'About & privacy', key: 'about' },
];

/**
 * The main menu, shown on every page so people never lose their way.
 * On the library page, "Ask" and "My numbers" switch tabs instead of navigating (onTab).
 */
export default function SiteNav({ current, onTab }: { current: NavKey; onTab?: (tab: 'ask' | 'numbers') => void }) {
  return (
    <nav className="site-nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.key} href={l.href} aria-current={l.key === current ? 'page' : undefined}
          onClick={onTab && (l.key === 'ask' || l.key === 'calculator') ? (e) => { e.preventDefault(); onTab(l.key === 'ask' ? 'ask' : 'numbers'); } : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
