import type { Metadata } from 'next';
import SiteHeader from '../../components/SiteHeader';
import ProjectorShell from '../../components/ProjectorShell';
import PlatformComparisonSection from '../../components/PlatformComparisonSection';
import TrustedTools from '../../components/TrustedTools';

export const metadata: Metadata = {
  title: 'Wealth projector · Investment Research Library',
  description: 'Project your household\'s net worth to retirement and beyond, for one person or a couple, in today\'s dollars.',
};

export default function CalculatorPage() {
  return (
    <div className="page-shell">
      <SiteHeader current="calculator" />
      <main className="page-main is-wide">
        <h1 className="page-title">Wealth projector</h1>
        <p className="page-lede">
          See where your money could take you. Answer a few simple questions about what you have, what comes in and what goes
          out, and we&apos;ll show how your savings could grow and how long they could last. Private: it all happens on your
          device.
        </p>
        <p><a className="guide-link" href="/calculator/guide">Need help? Read the step-by-step guide →</a></p>
        <ProjectorShell />
        <PlatformComparisonSection />
        <TrustedTools />
      </main>
    </div>
  );
}
