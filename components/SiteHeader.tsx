import Link from 'next/link';
import AccountControls from './AccountControls';

/** Header for the secondary pages (calculator, plans, about). */
export default function SiteHeader({ current }: { current: 'calculator' | 'pricing' | 'about' | 'methodology' | 'sources' }) {
  const links = [
    { href: '/', label: 'Ask the library', key: 'ask' },
    { href: '/calculator', label: 'Wealth projector', key: 'calculator' },
    { href: '/methodology', label: 'Methodology', key: 'methodology' },
    { href: '/sources', label: 'Sources', key: 'sources' },
    { href: '/about', label: 'About & privacy', key: 'about' },
  ];
  return (
    <header className="site-header">
      <Link className="brand-lockup" href="/">
        <span className="brand-mark" aria-hidden="true">R</span>
        <span className="brand-copy">
          <strong>Research Library</strong>
          <small>NZ, Australia, US, UK and Philippines</small>
        </span>
      </Link>
      <nav className="site-nav" aria-label="Main">
        {links.map((l) => (
          <Link key={l.key} href={l.href} aria-current={l.key === current ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <AccountControls />
    </header>
  );
}
