import Link from 'next/link';

export type NavKey = 'ask' | 'calculator' | 'pricing' | 'about' | 'methodology' | 'sources';

const LINKS: { href: string; label: string; key: NavKey }[] = [
  { href: '/', label: 'Ask the library', key: 'ask' },
  { href: '/calculator', label: 'Wealth projector', key: 'calculator' },
  { href: '/methodology', label: 'Methodology', key: 'methodology' },
  { href: '/sources', label: 'Sources', key: 'sources' },
  { href: '/about', label: 'About & privacy', key: 'about' },
];

/** The main menu, shown on every page so people never lose their way. */
export default function SiteNav({ current }: { current: NavKey }) {
  return (
    <nav className="site-nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.key} href={l.href} aria-current={l.key === current ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
