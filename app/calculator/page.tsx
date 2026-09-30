import type { Metadata } from 'next';
import SiteHeader from '../../components/SiteHeader';
import PlatformComparison from '../../components/PlatformComparison';
import HouseholdPlanner from '../../components/HouseholdPlanner';

export const metadata: Metadata = {
  title: 'Wealth projector · Investment Research Library',
  description: 'Project your household\'s net worth to retirement and beyond, for one person or a couple, in today\'s dollars.',
};

export default function CalculatorPage() {
  return (
    <div className="page-shell">
      <SiteHeader current="calculator" />
      <main className="page-main">
        <h1 className="page-title">Wealth projector</h1>
        <p className="page-lede">
          Put your whole household in one place: cash, investments, retirement accounts, property, income, pensions, children,
          parents, pets and other costs, for one person or a couple. Change any number and the results update.
        </p>
        <p><a className="guide-link" href="/calculator/guide">How to fill this in, and what to change as life changes →</a></p>
        <HouseholdPlanner />
        <PlatformComparison />
      </main>
    </div>
  );
}
