import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '../../components/SiteHeader';
import { COUNTRIES, COUNTRY_CODES, PROFILES_AS_AT, disclaimerFor } from '../../lib/countries';

export const metadata: Metadata = { title: 'Methodology · Investment Research Library' };

/*
 * DRAFT wording. Have a lawyer in each country you serve review this page and
 * the disclaimers below before charging for the service (see COMPLIANCE.md).
 */
export default function MethodologyPage() {
  return (
    <div className="page-shell">
      <SiteHeader current="methodology" />
      <main className="page-main prose-page">
        <h1 className="page-title">How the library works</h1>
        <p className="page-lede">
          What the answers are based on, how the wealth projector calculates, and what it leaves out.
        </p>

        <h2>Answers</h2>
        <p>
          Every answer is written from documents in the library, found by searching for passages that match your question.
          Answers cite the document and section they rely on, and each document lists its source and the date its facts
          were checked (see <Link href="/sources">Sources</Link>). Documents are filtered to your country of residence plus
          general investing notes. If the library has nothing on a question, the answer says so and points to an official
          source instead of guessing.
        </p>
        <p>
          The assistant explains and compares; it does not tell you what to buy, sell or hold. Questions that ask for a
          personal recommendation get an educational answer that is checked before you see it.
        </p>

        <h2>The wealth projector</h2>
        <p>
          The projector works month by month. Each month it adds income (after tax), subtracts living costs, dependants,
          other expenses, loan repayments and investment contributions, then grows every balance by its own return. Money
          left over is reinvested. A shortfall is paid from cash first, then reinvested savings, then investments you can
          withdraw from (retirement accounts only from their access age). Properties are kept unless you add an event to
          sell them. All amounts are shown in today&apos;s money, so a figure 20 years out is what it would buy today.
        </p>
        <ul>
          <li><strong>Low, expected and high:</strong> the same plan with investment returns 2 percentage points lower and higher, and property growth 1 point lower and higher.</li>
          <li><strong>Simulated markets (Monte Carlo):</strong> 300 runs in which every year&apos;s investment return is drawn at random around your expected return, with the yearly swings you set. The result is the share of runs in which spending was always covered. Property values are not randomised, and returns are not correlated across years.</li>
          <li><strong>Tax:</strong> incomes are entered after tax. Each investment can be marked as after-tax returns, taxed on returns each year, taxed when withdrawn, or tax-free, at a rate you enter. Detailed national tax rules (brackets, PIE and FIF calculations, super contribution caps, Roth conversions, ISA allowances) are not modelled.</li>
          <li><strong>More than one country:</strong> every investment, property, loan, income, dependant, expense and event can be in its own currency. Each is converted into the currency of the country you live in every month, using exchange rates you can change (filled in from the European Central Bank&apos;s daily reference rates via Frankfurter) and an expected yearly change. Retirement costs can be in the country you plan to retire in. Each pension starts at the age set by the country that pays it. Exchange rates are not randomised in the simulated markets.</li>
          <li><strong>Retirement spending:</strong> spend a fixed amount (your retirement living costs), a fixed percentage of savings each year, or a flexible &quot;guardrails&quot; rule that cuts spending 10% when withdrawals rise well above where they started and raises it 10% when markets do well.</li>
          <li><strong>Portfolio analysis:</strong> strengths, weaknesses and risks are worked out from your numbers using rules of thumb (for example, a cash buffer of 3 to 6 months). Each lever re-runs the whole plan with one change so its effect is measured. Levers show trade-offs; they are not recommendations.</li>
        </ul>

        <h2>What it leaves out</h2>
        <p>
          Historical backtesting, detailed tax, fund-level analysis of what you hold (asset mix, regions and overlap), aged
          care, currency movements on foreign assets, and changes to government pensions. Projections are illustrations,
          not predictions.
        </p>

        <h2>Country settings</h2>
        <p>Defaults below were checked on {PROFILES_AS_AT}. You can change every one of them in the projector.</p>
        <div className="table-scroll">
          <table className="milestone-table">
            <thead>
              <tr><th scope="col">Country</th><th scope="col">Currency</th><th scope="col">Pension</th><th scope="col">Retirement account</th><th scope="col">Regulator</th></tr>
            </thead>
            <tbody>
              {COUNTRY_CODES.map((code) => {
                const c = COUNTRIES[code];
                return (
                  <tr key={code}>
                    <th scope="row">{c.name}</th>
                    <td>{c.currency}</td>
                    <td>{c.pension.name} from {c.pension.age}</td>
                    <td>{c.retirementAccount.name} from {c.retirementAccount.accessAge}</td>
                    <td>{c.regulator}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2>Not financial advice</h2>
        {COUNTRY_CODES.map((code) => (
          <p key={code}><strong>{COUNTRIES[code].name}:</strong> {disclaimerFor(code)}</p>
        ))}
      </main>
    </div>
  );
}
