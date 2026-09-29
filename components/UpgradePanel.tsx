'use client';

import Link from 'next/link';
import { SignInButton } from '@clerk/nextjs';
import UpgradeButton from './UpgradeButton';
import { ANONYMOUS_DAILY_QUESTIONS, PAID_PLANS, PLANS } from '../lib/plans';

export type LimitTier = 'anonymous' | 'free' | 'basic' | 'premium' | 'pro';

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function PlanChoices({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="upgrade-plans">
      {PAID_PLANS.map((id) => (
        <section className="upgrade-plan" key={id} aria-labelledby={`upgrade-${id}`}>
          <h3 id={`upgrade-${id}`}>{PLANS[id].label}</h3>
          <p><strong>${PLANS[id].priceNzd}</strong> a month</p>
          <p>{PLANS[id].features[0]}</p>
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

/** Shown in place of the composer once today's questions are used. */
export default function UpgradePanel({ tier }: { tier: LimitTier }) {
  if (tier === 'anonymous') {
    return (
      <section className="upgrade-panel" aria-labelledby="upgrade-title">
        <h2 id="upgrade-title">Sign in to keep asking</h2>
        <p>
          You&apos;ve used today&apos;s {ANONYMOUS_DAILY_QUESTIONS} questions for visitors. A free account gives you{' '}
          {PLANS.free.dailyQuestions} questions a day. Paid plans give you more.
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
        <h2 id="upgrade-title">You&apos;ve used today&apos;s free questions</h2>
        <p>
          The free plan includes {PLANS.free.dailyQuestions} questions a day. Choose a plan to keep asking now, or come back
          tomorrow. You can cancel at any time.
        </p>
        <PlanChoices signedIn />
        <small>Payments are handled by Stripe. We never see your card details. <Link href="/pricing">Compare plans</Link></small>
      </section>
    );
  }
  return (
    <section className="upgrade-panel" aria-labelledby="upgrade-title">
      <h2 id="upgrade-title">You&apos;ve reached today&apos;s fair-use limit</h2>
      <p>Your {PLANS[tier].label} plan resets within 24 hours.{tier !== 'pro' && ' A higher plan gives you more questions each day.'}</p>
      {tier !== 'pro' && <Link className="plan-button is-secondary" href="/pricing">Compare plans</Link>}
    </section>
  );
}
