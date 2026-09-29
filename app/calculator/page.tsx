import type { Metadata } from 'next';
import SiteHeader from '../../components/SiteHeader';
import PlatformComparison from '../../components/PlatformComparison';
import WealthProjector from '../../components/WealthProjector';

export const metadata: Metadata = {
  title: 'Wealth projector · Investment Research Library',
  description: 'Project your savings to retirement in today\'s dollars, with low, expected and high scenarios.',
};

export default function CalculatorPage() {
  return (
    <div className="page-shell">
      <SiteHeader current="calculator" />
      <main className="page-main">
        <h1 className="page-title">Wealth projector</h1>
        <p className="page-lede">
          See where your savings could be at each age, whether you&apos;re on track for your goal, and how much the
          answer depends on returns. Change any number and the results update.
        </p>
        <WealthProjector />
        <PlatformComparison />
      </main>
    </div>
  );
}
