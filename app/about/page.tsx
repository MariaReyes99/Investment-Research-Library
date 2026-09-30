import type { Metadata } from 'next';
import SiteHeader from '../../components/SiteHeader';
import { DISCLAIMER } from '../../lib/guardrails/advice';

export const metadata: Metadata = { title: 'About & privacy · Investment Research Library' };

/*
 * DRAFT wording. Have a New Zealand lawyer review this page (financial advice
 * boundary under the Financial Markets Conduct Act 2013, and the Privacy Act
 * 2020) before charging for the service. Replace [Business name] and the
 * contact address.
 */
export default function AboutPage() {
  return (
    <div className="page-shell">
      <SiteHeader current="about" />
      <main className="page-main prose-page">
        <h1 className="page-title">About &amp; privacy</h1>

        <h2>What this is</h2>
        <p>
          The Investment Research Library answers investing questions using a curated library of guides and documents,
          and shows the sources behind every answer. The wealth projector illustrates how savings could grow under
          assumptions you choose.
        </p>

        <h2>Not financial advice</h2>
        <p>{DISCLAIMER}</p>
        <p>
          Answers explain how investments, tax rules and strategies work and compare their trade-offs. They do not
          recommend what you personally should buy, sell or hold. Projections are illustrations, not predictions, and
          returns are not guaranteed. Tax rules and KiwiSaver settings change; check IRD for the current rules. To find a
          licensed financial adviser, see the{' '}
          <a href="https://www.fma.govt.nz/consumer/getting-advice/" target="_blank" rel="noreferrer">FMA&apos;s guidance</a>.
        </p>

        <h2>Your privacy</h2>
        <ul>
          <li>The wealth projector runs in your browser. The numbers you enter there are not sent to us or stored.</li>
          <li>
            Questions you ask the library are sent to our AI provider (OpenAI) to generate an answer. Before that, we
            automatically remove details such as email addresses, phone numbers, IRD numbers, bank account numbers and
            street addresses. You don&apos;t need to share any of them.
          </li>
          <li>
            Messages containing payment card details are blocked and never processed. Never share card details in chat.
          </li>
          <li>
            Payments are handled by Stripe on its own secure page. We store only which plan you are on, never your card
            number.
          </li>
          <li>
            To apply monthly question allowances we keep a count per account, or per anonymised (hashed) internet address for visitors
            who are not signed in. We don&apos;t sell your data or show ads.
          </li>
          <li>
            You can ask to see or correct the personal information we hold, or to delete your account, by emailing
            [privacy@your-domain]. [Business name] handles personal information under the New Zealand Privacy Act 2020.
          </li>
        </ul>

        <h2>Sources and attribution</h2>
        <p>
          Library notes are written for this site and cite the primary sources they rely on. Third-party documents are
          added only where we have the right to use them, and each answer links to its source and the date it was
          captured.
        </p>
      </main>
    </div>
  );
}
