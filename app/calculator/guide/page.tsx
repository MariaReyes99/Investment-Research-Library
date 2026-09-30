import type { Metadata } from 'next';
import Link from 'next/link';
import SiteHeader from '../../../components/SiteHeader';

export const metadata: Metadata = { title: 'How to fill in the wealth projector · Investment Research Library' };

/** Step-by-step guide to the wealth projector, plus what to change at each life stage. */
export default function ProjectorGuidePage() {
  return (
    <div className="page-shell">
      <SiteHeader current="calculator" />
      <main className="page-main prose-page guide-page">
        <p className="guide-back"><Link href="/calculator">← Back to the wealth projector</Link></p>
        <h1 className="page-title">How to fill in the wealth projector</h1>
        <p className="page-lede">
          Work down the form from top to bottom. You don&apos;t need every section: leave out anything that doesn&apos;t apply,
          and use rough numbers first. The results update as you type, so you can refine as you go.
        </p>

        <nav className="guide-contents" aria-label="Contents">
          <a href="#before">Before you start</a>
          <a href="#sections">Section by section</a>
          <a href="#life-events">What to change as life changes</a>
          <a href="#two-countries">Money in two countries</a>
          <a href="#mistakes">Common mistakes</a>
          <a href="#results">Reading the results</a>
        </nav>

        <h2 id="before">Before you start</h2>
        <ul>
          <li><strong>Amounts are in today&apos;s money.</strong> Enter what things cost now. The projector adds inflation for you, so don&apos;t inflate future costs yourself.</li>
          <li><strong>Income is after tax</strong>: what reaches your bank account each month.</li>
          <li><strong>Percentages are yearly</strong> (7 means 7% a year), except selling costs and tax rates, which are a share of a sale or withdrawal.</li>
          <li><strong>Nothing is sent to us.</strong> Everything is calculated in your browser. Saved plans stay in this browser only.</li>
          <li>Have these to hand: recent statements for savings, KiwiSaver or other retirement accounts, your mortgage balance, rate and repayment, and a rough monthly budget.</li>
        </ul>

        <h2 id="sections">Section by section</h2>

        <h3>1. Who&apos;s in the plan</h3>
        <ul>
          <li><strong>I live in:</strong> sets the currency results are shown in, and default pension and retirement-account ages.</li>
          <li><strong>I plan to retire in:</strong> choose another country only if you&apos;ll move there. Your retirement living costs are then entered in that country&apos;s currency.</li>
          <li><strong>Just me or a couple:</strong> choose a couple to give each partner their own age, retirement age, income and pension. Each item then has a &quot;Belongs to&quot; choice.</li>
          <li><strong>Plan to your age:</strong> 90 or 95 is sensible. Planning too short makes money look like it lasts longer than it might need to.</li>
        </ul>

        <h3>2. Cash on hand</h3>
        <p>Everyday and savings accounts. This is spent first if money runs short, so it&apos;s your emergency buffer. Term deposits and savings you won&apos;t touch can go under Investments instead.</p>

        <h3>3. Investments</h3>
        <ul>
          <li>Add one card per account: KiwiSaver or other retirement account, share or ETF portfolio, managed fund, term deposit.</li>
          <li><strong>Return</strong> is the yearly return you expect <em>before</em> fees. If unsure: cash and term deposits 3 to 4%, balanced funds 5 to 6%, growth or share funds 6 to 8%. Higher numbers make the plan look better but are less certain; the Low case and simulated markets show what happens if returns disappoint.</li>
          <li><strong>Fees:</strong> the fund&apos;s yearly fee, from its fact sheet.</li>
          <li><strong>Monthly contribution:</strong> what goes in each month, including any employer share. Tick &quot;Contributions stop at retirement&quot; for workplace schemes.</li>
          <li><strong>Tax and access:</strong> leave &quot;Return entered is after tax&quot; unless you know the account is taxed differently. Retirement accounts can&apos;t be withdrawn until their access age.</li>
        </ul>

        <h3>4. Property</h3>
        <ul>
          <li>Enter the <strong>market value</strong> and the <strong>mortgage owing</strong> as separate numbers. Don&apos;t enter the mortgage as the value.</li>
          <li><strong>Repayment</strong> is your actual monthly mortgage payment. If you see a warning that it doesn&apos;t cover the interest, check the balance, rate and repayment with your lender.</li>
          <li><strong>Net rent</strong> is rent after rates, insurance, repairs and management fees. Leave it at 0 for the home you live in.</li>
          <li>Properties are kept for life unless you add a sale under One-off events.</li>
        </ul>

        <h3>5. Other assets and other debts</h3>
        <p>Cars lose about 10% a year automatically. Jewellery, collectibles and business interests stay at their value unless you enter a yearly change. Put car loans, personal loans and credit cards under Other debts; mortgages belong with their property.</p>

        <h3>6. Income</h3>
        <ul>
          <li><strong>Salary:</strong> your take-home pay. It stops at your retirement age automatically.</li>
          <li><strong>Pensions:</strong> add one card for each pension, and set <strong>Paid by</strong> to the country paying it. Each starts at that country&apos;s pension age unless you set another. Check your expected amount with the pension office.</li>
          <li><strong>Other income:</strong> dividends, rent from a property not listed above, business income or an annuity. Use &quot;From age&quot; and &quot;Until age&quot; if it only lasts for a while.</li>
        </ul>

        <h3>7. Spending</h3>
        <ul>
          <li><strong>Living costs now:</strong> food, power, phone, transport, insurance and everyday spending. Leave out mortgage repayments, loan payments and investing: they&apos;re already counted in their own sections.</li>
          <li><strong>In retirement:</strong> fill this in if you expect to spend differently once retired, for example less on commuting or more on travel. Leave blank to keep today&apos;s living costs.</li>
          <li><strong>How retirement spending is set:</strong> &quot;Spend my retirement living costs&quot; is the simplest. &quot;Fixed %&quot; spends a share of your savings each year. &quot;Flexible (guardrails)&quot; trims spending after bad years and raises it after good ones, which often helps savings last longer.</li>
        </ul>

        <h3>8. Dependants and other expenses</h3>
        <ul>
          <li>Add each child, parent you support, or pet with a monthly cost and <strong>for how many years</strong>. For a child, that&apos;s usually until they finish school or study.</li>
          <li>Use <strong>Starting in</strong> for costs that begin later, such as university in 5 years.</li>
          <li>Other expenses covers anything else regular: travel, private health insurance, school fees, rent if you don&apos;t own your home. Leave &quot;For years&quot; blank for ongoing costs.</li>
        </ul>

        <h3>9. One-off events</h3>
        <ul>
          <li><strong>Money in:</strong> an inheritance, a redundancy payment or selling a business.</li>
          <li><strong>Money out:</strong> a renovation, a new car, a wedding or helping a child with a house deposit.</li>
          <li><strong>Sell or downsize a property:</strong> choose the property and the age. Selling costs are the agent and legal fees as a share of the price, usually 2 to 5%. If you&apos;re buying a cheaper home, enter its price in &quot;Buy instead&quot;; only the difference goes into savings.</li>
        </ul>

        <h3>10. Goal, comparisons and settings</h3>
        <p>Set a target net worth and the age you want to reach it. Use &quot;Compare return assumptions&quot; to see the same plan at, say, 4%, 6% and 8%. Under &quot;Inflation, reinvested savings and market swings&quot;, the defaults suit most people; raise &quot;Market ups and downs&quot; to 15 or more if most of your money is in shares.</p>

        <h2 id="life-events">What to change as life changes</h2>
        <p>Update your plan when something big changes. The table shows what to add, change or remove.</p>
        <div className="table-scroll">
          <table className="milestone-table guide-table">
            <thead>
              <tr><th scope="col">When this happens</th><th scope="col">Add</th><th scope="col">Change or remove</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">A child is born or you start supporting a parent</th><td>A dependant with its monthly cost and years</td><td>Living costs, if you&apos;d counted them there</td></tr>
              <tr><th scope="row">A child finishes school or leaves home</th><td>Nothing: the cost ends after the years you set</td><td>Check the dependant&apos;s years are right; add university costs as a dependant or expense starting later</td></tr>
              <tr><th scope="row">You change jobs or get a pay rise</th><td>—</td><td>Take-home pay and monthly contributions</td></tr>
              <tr><th scope="row">You pay off the mortgage</th><td>Nothing: repayments stop automatically once the balance reaches 0</td><td>Update the mortgage owing each year so it stays accurate</td></tr>
              <tr><th scope="row">You plan to sell or downsize</th><td>A sell event at the age you&apos;ll sell; &quot;Buy instead&quot; if you&apos;ll buy a cheaper home</td><td>If you&apos;ll rent afterwards, add rent under Other expenses starting that year</td></tr>
              <tr><th scope="row">You get an inheritance or lump sum</th><td>A money-in event at that age</td><td>After it arrives, remove the event and add the money to cash or investments</td></tr>
              <tr><th scope="row">You retire</th><td>Your pension or pensions, if not already added</td><td>Living costs in retirement; salary stops automatically at the retirement age you set</td></tr>
              <tr><th scope="row">You start receiving a pension</th><td>—</td><td>Replace the estimate with the actual amount</td></tr>
              <tr><th scope="row">You move country or decide to retire abroad</th><td>&quot;I plan to retire in&quot;; currencies on items held abroad</td><td>Living costs in retirement, in that country&apos;s currency</td></tr>
              <tr><th scope="row">A partner joins or leaves the plan</th><td>&quot;A couple&quot; with their ages, income and pension</td><td>&quot;Belongs to&quot; on shared or personal accounts; back to &quot;Just me&quot; if needed</td></tr>
              <tr><th scope="row">Once a year</th><td>Save a new version of the plan</td><td>Balances, mortgage owing, fees and returns, and compare with last year&apos;s saved plan</td></tr>
            </tbody>
          </table>
        </div>

        <h2 id="two-countries">Money in two countries</h2>
        <ul>
          <li>Tick <strong>&quot;Some of my money, income or costs are in another currency&quot;</strong>. Each card then has a Currency choice.</li>
          <li>Enter amounts in their own currency, for example a house in the Philippines in PHP or money you send to parents in PHP. Don&apos;t convert them yourself.</li>
          <li>Exchange rates fill in automatically from the European Central Bank&apos;s daily rates. You can change them, and add an expected yearly change if you think a currency will strengthen or weaken.</li>
          <li>Add a separate pension for each country that will pay you one, with &quot;Paid by&quot; set to that country. Some countries reduce their pension if you receive another country&apos;s, so check with each pension office.</li>
        </ul>

        <h2 id="mistakes">Common mistakes</h2>
        <ul>
          <li>Entering the mortgage balance as the property&apos;s value.</li>
          <li>Counting mortgage repayments or investing inside living costs as well as in their own sections.</li>
          <li>Entering income before tax.</li>
          <li>Typing a whole number where a percentage is expected, or a dollar amount in selling costs.</li>
          <li>Leaving out the pension. It usually makes a big difference.</li>
          <li>Selling your only home without adding rent or a replacement home.</li>
        </ul>

        <h2 id="results">Reading the results</h2>
        <ul>
          <li><strong>Net worth</strong> is everything you own minus everything you owe. <strong>Cash and investments</strong> is the part you can spend without selling property; this is what pays for retirement.</li>
          <li>In <strong>Year by year</strong>, a negative &quot;Income minus outgoings&quot; is normal in retirement: it&apos;s paid from your cash and investments. It only becomes a problem if a &quot;Not covered&quot; column appears.</li>
          <li>The <strong>Low and High</strong> cases move returns 2 points down and up. <strong>Simulated markets</strong> show how often your money lasts when returns jump around each year; many planners aim for 80 to 90% or more.</li>
          <li><strong>Levers to explore</strong> re-run your whole plan with one change each, so you can see what makes the biggest difference and what it costs you.</li>
          <li>If the results fade with a banner saying they&apos;re out of date, a field needs fixing. The banner says which.</li>
        </ul>

        <p className="page-small">
          This guide explains how to use the projector. It is general information, not financial advice. See{' '}
          <Link href="/methodology">how the projector calculates</Link>.
        </p>
      </main>
    </div>
  );
}
