'use client';

import Link from 'next/link';
import { SignInButton } from '@clerk/nextjs';
import UpgradeButton from './UpgradeButton';
import { ANONYMOUS_MONTHLY_QUESTIONS, PAID_PLANS, PLANS } from '../lib/plans';

export type LimitTier = 'anonymous' | 'free' | 'basic' | 'premium' | 'pro';

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function PlanChoices({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="upgrade-plans">
      {PAID_PLANS.map((id) => (
        <section className="upgrade-plan" key={id} aria-labelledby={`upgrade-${id}`}>
          <h3 id={`upgrade-${id}`}>{PLANS[id].label}</h3>
          <p><strong>${PLANS[id].priceNzd}</strong> a month</p>
          {PLANS[id].features.slice(0, 2).map((f) => <p key={f}>{f}</p>)}
          {signedIn ? (
            <UpgradeButton plan={id} label={`Choose ${PLANS[id].label}`} />
          ) : (
            <Link className="plan-button is-secondary" href="/pricing">See {PLANS[id].label}</Link>
          )}
        </section>
      ))}
    </div>
  );
}

/** Shown in place of the composer once this month's questions are used. */
export default function UpgradePanel({ tier }: { tier: LimitTier }) {
  if (tier === 'anonymous') {
    return (
      <section className="upgrade-panel" aria-labelledby="upgrade-title">
        <h2 id="upgrade-title">Sign in to keep asking</h2>
        <p>
          You&apos;ve used the {ANONYMOUS_MONTHLY_QUESTIONS} questions for visitors this month. A free account gives you{' '}
          {PLANS.free.monthlyQuestions} questions a month. Paid plans give you more.
        </p>
        {clerkEnabled && (
          <SignInButton mode="modal">
            <button type="button" className="plan-button">Sign in or create a free account</button>
          </SignInButton>
        )}
        <PlanChoices signedIn={false} />
        <small>The wealth projector stays free and works without an account. <Link href="/calculator">Open the projector</Link></small>
      </section>
    );
  }
  if (tier === 'free') {
    return (
      <section className="upgrade-panel" aria-labelledby="upgrade-title">
        <h2 id="upgrade-title">You&apos;ve used this month&apos;s free questions</h2>
        <p>
          The free plan includes {PLANS.free.monthlyQuestions} questions a month. Choose a plan to keep asking now. You can
          cancel at any time and keep your plan until the end of the month you&apos;ve paid for.
        </p>
        <PlanChoices signedIn />
        <small>Payments are handled by Stripe. We never see your card details. <Link href="/pricing">Compare plans</Link></small>
      </section>
    );
  }
  return (
    <section className="upgrade-panel" aria-labelledby="upgrade-title">
      <h2 id="upgrade-title">You&apos;ve used this month&apos;s questions</h2>
      <p>Your {PLANS[tier].label} plan includes {PLANS[tier].monthlyQuestions} questions a month, and resets 30 days after your allowance started.{tier !== 'pro' && ' A higher plan gives you more questions each month.'}</p>
      {tier !== 'pro' && <Link className="plan-button is-secondary" href="/pricing">Compare plans</Link>}
    </section>
  );
}
