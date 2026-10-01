import Link from 'next/link';
import AccountControls from './AccountControls';
import SiteNav, { type NavKey } from './SiteNav';

/** Header for the secondary pages (calculator, plans, about). The chat page shows the same menu in its top bar. */
export default function SiteHeader({ current }: { current: Exclude<NavKey, 'ask'> }) {
  return (
    <header className="site-header">
      <Link className="brand-lockup" href="/">
        <span className="brand-mark" aria-hidden="true">R</span>
        <span className="brand-copy">
          <strong>Research Library</strong>
          <small>NZ, Australia, US, UK and Philippines</small>
        </span>
      </Link>
      <SiteNav current={current} />
      <AccountControls />
    </header>
  );
}
