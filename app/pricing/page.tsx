import type { Metadata } from 'next';
import SiteHeader from '../../components/SiteHeader';
import UpgradeButton from '../../components/UpgradeButton';
import { PAID_PLANS, PLANS, planFrom, type Plan } from '../../lib/plans';
import ManagePlanButton from '../../components/ManagePlanButton';
import { clerkEnabled } from '../../lib/viewer';

export const metadata: Metadata = { title: 'Plans · Investment Research Library' };

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ upgraded?: string }> }) {
  const { upgraded } = await searchParams;
  let current: Plan = 'free';
  if (clerkEnabled) {
    const { currentUser } = await import('@clerk/nextjs/server');
    const user = await currentUser().catch(() => null);
    current = planFrom(user?.publicMetadata);
  }
  return (
    <div className="page-shell">
      <SiteHeader current="pricing" />
      <main className="page-main">
        <h1 className="page-title">Plans</h1>
        <p className="page-lede">
          Start free. Upgrade when you want more questions. Prices are in NZD per month including GST. Cancel at any time:
          you keep your plan until the end of the month you&apos;ve paid for, and you won&apos;t be charged again.
        </p>
        {upgraded && <p className="privacy-notice" role="status">Thanks, your plan is being updated. It can take a minute to show.</p>}
        {current !== 'free' && (
          <div className="current-plan">
            <p>You&apos;re on the <strong>{PLANS[current].label}</strong> plan.</p>
            <ManagePlanButton />
          </div>
        )}

        <div className="plan-grid">
          {(['free', ...PAID_PLANS] as const).map((id) => {
            const p = PLANS[id];
            return (
              <section key={id} className={`plan-card${id === 'premium' ? ' is-featured' : ''}`} aria-labelledby={`plan-${id}`}>
                <h2 id={`plan-${id}`}>{p.label}</h2>
                <p className="plan-price">
                  {p.priceNzd === 0 ? 'Free' : <>${p.priceNzd}<span>/month</span></>}
                </p>
                <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                {id === current ? (
                  <p className="plan-current-tag">Your current plan</p>
                ) : id === 'free' ? (
                  <a className="plan-button is-secondary" href="/">Start asking</a>
                ) : current !== 'free' ? (
                  <ManagePlanButton label={`Switch to ${p.label}`} />
                ) : (
                  <UpgradeButton plan={id} label={`Choose ${p.label}`} />
                )}
              </section>
            );
          })}
        </div>

        <p className="page-small">
          Payments are handled by Stripe. We never see or store your card details. To cancel, choose &quot;Manage or cancel
          your plan&quot; above. Question allowances run in 30-day periods. All plans give general information and education,
          not personal financial advice.
        </p>
      </main>
    </div>
  );
}
