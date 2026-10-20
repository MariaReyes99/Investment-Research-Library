/**
 * Retirement fund providers by country, for the fund comparison.
 *
 * Every figure has a source and an "as at" date. `confidence` says how firm it is:
 *  - 'sourced'    copied from a published table or fund document (see sourceUrl)
 *  - 'indicative' a typical published charge we could not confirm for this exact fund;
 *                 the app tells users to check the fund's current disclosure
 *
 * Returns are HISTORIC, on the basis stated in `returnBasis`. The engine converts them to a
 * gross (before fees and tax) assumption so fees and tax can be shown separately.
 * Funds without a historic return use the long-term assumption for their risk type.
 *
 * Review every 3 months (fees and returns change). Last full review: 2026-10-20.
 */
import type { CountryCode } from '../lib/countries';

export type FundRisk = 'conservative' | 'balanced' | 'growth' | 'aggressive';
export type ReturnBasis =
  | 'after-fees-after-tax'      // NZ fund updates / Sorted (tax at 28% PIR)
  | 'after-fees-before-tax'     // Morningstar NZ survey
  | 'net-of-fees-and-tax'       // Australian super (investment fees and earnings tax already taken out)
  | 'net-of-fund-fees';         // US/UK/PH fund NAV returns (after the fund's own expense ratio)

export interface ProviderFund {
  id: string;
  provider: string;
  fund: string;
  risk: FundRisk;
  /** Share of the fund in growth assets (shares, property), 0-100. Used for NZ PIE tax. */
  growthSharePct: number;
  /** Fund / investment management charge, % of balance a year (total fund charges where that is what's published). */
  investmentFeePct: number;
  /** Administration charge, % of balance a year (where published separately). */
  adminFeePct?: number;
  /** Fixed member / administration fee in local currency a year. */
  fixedFeePerYear?: number;
  /** Platform fee % a year, with an optional yearly cap (UK platforms). */
  platformFeePct?: number;
  platformFeeCapPerYear?: number;
  /** Estimated performance fee, % a year. */
  performanceFeePct?: number;
  /** Charge taken from every contribution before it is invested (e.g. NEST 1.8%). */
  contributionChargePct?: number;
  /** Historic annualised return (usually 5 years) on returnBasis. */
  historicReturnPct?: number;
  historicYears?: number;
  returnBasis?: ReturnBasis;
  /** How the fees are actually charged, in plain words. */
  feeHow: string;
  sourceLabel: string;
  sourceUrl: string;
  asOf: string;
  confidence: 'sourced' | 'indicative';
  note?: string;
}

const MB = 'MoneyBalance (from Sorted Smart Investor fund updates)';
const MB_FEES = 'https://moneybalance.co.nz/kiwisaver/fees/fund-fees-comparison/';
const MB_RET = 'https://moneybalance.co.nz/kiwisaver/performance/best-performing-kiwisaver-funds/';
const NZ_FEE_HOW = 'Fund charges are a % of your balance, taken inside the fund (you never see an invoice). Any member fee is a fixed $ amount deducted from your account.';

const nz = (
  id: string, provider: string, fund: string, risk: FundRisk, fee: number, fixed: number,
  ret?: number, extra: Partial<ProviderFund> = {},
): ProviderFund => ({
  id, provider, fund, risk,
  growthSharePct: risk === 'aggressive' ? 95 : risk === 'growth' ? 80 : risk === 'balanced' ? 60 : 30,
  investmentFeePct: fee, fixedFeePerYear: fixed || undefined,
  historicReturnPct: ret, historicYears: ret === undefined ? undefined : 5,
  returnBasis: ret === undefined ? undefined : 'after-fees-after-tax',
  feeHow: NZ_FEE_HOW,
  sourceLabel: MB, sourceUrl: ret === undefined ? MB_FEES : MB_RET,
  asOf: '2026-06-30', confidence: 'sourced',
  ...extra,
});

const FMD = 'https://findmyfund.co.nz/rankings';

export const PROVIDERS: Record<CountryCode, ProviderFund[]> = {
  NZ: [
    nz('nz-simplicity-growth', 'Simplicity', 'Growth Fund', 'growth', 0.23, 0, 7.23),
    nz('nz-simplicity-balanced', 'Simplicity', 'Balanced Fund', 'balanced', 0.23, 0, 5.28),
    nz('nz-asb-growth', 'ASB', 'Growth Fund', 'growth', 0.70, 0, 7.15),
    nz('nz-asb-balanced', 'ASB', 'Balanced Fund', 'balanced', 0.65, 0, 5.72),
    nz('nz-bnz-growth', 'BNZ', 'Growth Fund', 'growth', 0.45, 0, 6.81),
    nz('nz-bnz-balanced', 'BNZ', 'Balanced Fund', 'balanced', 0.45, 0, 5.35),
    nz('nz-anz-growth', 'ANZ', 'Growth Fund', 'growth', 0.95, 0, 5.29),
    nz('nz-anz-balanced', 'ANZ', 'Balanced Fund', 'balanced', 0.86, 0),
    nz('nz-westpac-growth', 'Westpac', 'Growth Fund', 'growth', 0.55, 0, 6.29),
    nz('nz-westpac-balanced', 'Westpac', 'Balanced Fund', 'balanced', 0.50, 0),
    nz('nz-booster-growth', 'Booster', 'Growth Fund', 'growth', 1.24, 36, 5.36),
    nz('nz-booster-highgrowth', 'Booster', 'High Growth Fund', 'aggressive', 1.34, 36, 6.65),
    nz('nz-booster-balanced', 'Booster', 'Balanced Fund', 'balanced', 1.19, 36, 4.18),
    nz('nz-fisher-growth', 'Fisher Funds', 'KiwiSaver Plan Growth Fund', 'growth', 1.13, 0, 4.46),
    nz('nz-fisher-balanced', 'Fisher Funds', 'KiwiSaver Plan Balanced Fund', 'balanced', 1.01, 0, 3.82),
    nz('nz-milford-activegrowth', 'Milford', 'Active Growth Fund', 'growth', 1.05, 0, 6.60, {
      performanceFeePct: 0.39,
      feeHow: 'A 1.05% base fee is taken from the fund, plus a performance fee when returns beat a hurdle. Milford\'s fund update estimates total charges of about 1.44% a year, so 0.39% is modelled as performance fee.',
    }),
    nz('nz-milford-balanced', 'Milford', 'Balanced Fund', 'balanced', 1.05, 0, 5.04, {
      performanceFeePct: 0.07,
      feeHow: 'A 1.05% base fee plus any performance fee; total charges estimated at about 1.12% a year.',
    }),
    nz('nz-generate-focusedgrowth', 'Generate', 'Focused Growth Fund', 'aggressive', 1.25, 36, 8.03),
    nz('nz-superlife-growth', 'SuperLife', 'Growth Fund', 'growth', 0.61, 30, 6.74),
    nz('nz-pathfinder-growth', 'Pathfinder', 'Growth Fund', 'growth', 1.35, 27, 6.44, {
      note: 'Member fee not charged under 18 or on balances below $5,000.',
    }),
    nz('nz-kernel-highgrowth', 'Kernel', 'High Growth Fund', 'aggressive', 0.25, 0, undefined, { note: 'Fund started in 2022: no 5-year return yet.' }),
    nz('nz-kernel-balanced', 'Kernel', 'Balanced Fund', 'balanced', 0.25, 0),
    nz('nz-koura-growth', 'Kōura', 'Growth Strategy', 'growth', 1.03, 30),
    nz('nz-summer-growth', 'Summer', 'Growth Selection', 'growth', 0.90, 36),
    nz('nz-amp-growth', 'AMP', 'Growth Fund', 'growth', 0.77, 0, undefined, { sourceLabel: 'FindMyFund (FMA Disclose Register)', sourceUrl: FMD }),
    nz('nz-mercer-growth', 'Mercer', 'Growth Fund', 'growth', 0.88, 0, undefined, { sourceLabel: 'FindMyFund (FMA Disclose Register)', sourceUrl: FMD }),
    nz('nz-quaystreet-growth', 'QuayStreet', 'Growth Fund', 'growth', 1.27, 0, 10.1, {
      returnBasis: 'after-fees-before-tax',
      sourceLabel: 'Morningstar KiwiSaver Survey (via Solid Steele Advice); fee from FindMyFund',
      sourceUrl: 'https://www.solidsteeleadvice.co.nz/kiwisaver-morningstar-returns-latest',
    }),
    nz('nz-pie-growth', 'Pie Funds', 'KiwiSaver Growth Fund', 'growth', 1.01, 0, undefined, { sourceLabel: 'FindMyFund (FMA Disclose Register)', sourceUrl: FMD }),
  ],

  AU: ((): ProviderFund[] => {
    const RET = 'https://www.comparefair.com.au/superannuation/guides/super-fund-returns';
    const FEE = 'https://reviewmysuper.com.au/compare-super-funds/';
    const how = 'Super fees are charged three ways: a fixed admin fee ($ a week), an admin % of your balance, and investment fees & costs taken inside the option. The figure here is the total cost on a $50,000 balance (Lonsec, 31 Aug 2026) shown as a % of balance; the fixed part makes it a bigger % on small balances.';
    const au = (id: string, provider: string, fund: string, risk: FundRisk, totalOn50k: number, ret?: number): ProviderFund => ({
      id, provider, fund, risk, growthSharePct: risk === 'growth' ? 85 : 70,
      investmentFeePct: Math.round((totalOn50k / 50_000) * 10_000) / 100,
      historicReturnPct: ret, historicYears: ret === undefined ? undefined : 5,
      returnBasis: ret === undefined ? undefined : 'net-of-fees-and-tax',
      feeHow: how,
      sourceLabel: 'Returns: CompareFair (fund-published, 30 Jun 2026). Fees: ReviewMySuper (Lonsec, 31 Aug 2026)',
      sourceUrl: ret === undefined ? FEE : RET,
      asOf: '2026-06-30', confidence: 'sourced',
    });
    return [
      au('au-australiansuper-balanced', 'AustralianSuper', 'Balanced (MySuper)', 'balanced', 367, 6.53),
      au('au-art-balanced', 'Australian Retirement Trust', 'Super Savings Balanced', 'balanced', 407.2, 7.52),
      au('au-aware-balanced', 'Aware Super', 'Future Saver Balanced', 'balanced', 417, 7.56),
      au('au-unisuper-balanced', 'UniSuper', 'Balanced (MySuper)', 'balanced', 351, 7.07),
      au('au-hostplus-balanced', 'Hostplus', 'Balanced (MySuper)', 'balanced', 569.1, 7.74),
      au('au-rest-growth', 'Rest', 'Growth (MySuper)', 'growth', 438, 6.94),
      au('au-hesta-balancedgrowth', 'HESTA', 'Balanced Growth (MySuper)', 'balanced', 407, 7.21),
      au('au-cbus-growth', 'Cbus', 'Growth (MySuper)', 'growth', 462, 6.48),
      au('au-brighter-mysuper', 'Brighter Super', 'MySuper', 'balanced', 386, 7.21),
      au('au-firstsuper-balanced', 'First Super', 'Balanced (MySuper)', 'balanced', 465.8, 7.27),
      au('au-caresuper-balanced', 'CareSuper', 'Balanced', 'balanced', 467.6, 6.36),
      au('au-ngs-diversified', 'NGS Super', 'Diversified (MySuper)', 'balanced', 545, 6.95),
      au('au-ausethical-balanced', 'Australian Ethical', 'Balanced (MySuper)', 'balanced', 683, 5.00),
      au('au-vanguard-balanced', 'Vanguard Super', 'SaveSmart Balanced', 'balanced', 350),
    ];
  })(),

  US: [
    {
      id: 'us-vanguard-tr2050', provider: 'Vanguard', fund: 'Target Retirement 2050 (VFIFX)', risk: 'growth', growthSharePct: 90,
      investmentFeePct: 0.08, historicReturnPct: 9.66, historicYears: 5, returnBasis: 'net-of-fund-fees',
      feeHow: 'The expense ratio is taken daily from the fund price. In a 401(k), your plan may add a record-keeping/admin fee (often $ a year or a %).',
      sourceLabel: 'CompareMutualFunds (Yahoo Finance data)', sourceUrl: 'https://comparemutualfunds.com/learn/best-target-date-fund-2050',
      asOf: '2026-06-30', confidence: 'indicative', note: 'Return date not stated by the source: check the fund page.',
    },
    {
      id: 'us-fidelity-fipfx', provider: 'Fidelity', fund: 'Freedom Index 2050 (FIPFX)', risk: 'growth', growthSharePct: 90,
      investmentFeePct: 0.12, feeHow: 'Expense ratio taken inside the fund price; plan admin fees may be extra.',
      sourceLabel: 'CompareMutualFunds', sourceUrl: 'https://comparemutualfunds.com/learn/best-target-date-fund-2050', asOf: '2025-06-30', confidence: 'sourced',
    },
    {
      id: 'us-schwab-swymx', provider: 'Charles Schwab', fund: 'Target 2050 Index (SWYMX)', risk: 'growth', growthSharePct: 90,
      investmentFeePct: 0.08, feeHow: 'Expense ratio taken inside the fund price; plan admin fees may be extra.',
      sourceLabel: 'CompareMutualFunds', sourceUrl: 'https://comparemutualfunds.com/learn/best-target-date-fund-2050', asOf: '2025-06-30', confidence: 'sourced',
    },
    {
      id: 'us-fidelity-ffhx', provider: 'Fidelity', fund: 'Freedom 2050 (actively managed)', risk: 'growth', growthSharePct: 90,
      investmentFeePct: 0.75, feeHow: 'Actively managed target-date fund: higher expense ratio taken inside the fund price.',
      sourceLabel: 'Typical published expense ratio', sourceUrl: 'https://www.fidelity.com', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'us-troweprice-2050', provider: 'T. Rowe Price', fund: 'Retirement 2050 (actively managed)', risk: 'growth', growthSharePct: 90,
      investmentFeePct: 0.62, feeHow: 'Actively managed target-date fund: expense ratio taken inside the fund price.',
      sourceLabel: 'Typical published expense ratio', sourceUrl: 'https://www.troweprice.com', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'us-typical-401k', provider: 'Employer 401(k) plan', fund: 'Typical plan (fund + record-keeping)', risk: 'growth', growthSharePct: 85,
      investmentFeePct: 0.45, adminFeePct: 0.15, fixedFeePerYear: 50,
      feeHow: 'Most 401(k)s charge the fund expense ratio plus a record-keeping/admin fee, either a % of assets or a $ amount per participant. Your plan\'s annual fee disclosure (404a-5 notice) lists them.',
      sourceLabel: 'Illustrative: replace with your plan\'s 404(a)(5) fee notice', sourceUrl: 'https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/resource-center/publications/a-look-at-401k-plan-fees',
      asOf: '2026-01-01', confidence: 'indicative',
    },
  ],

  UK: [
    {
      id: 'uk-nest', provider: 'NEST', fund: 'Nest Retirement Date Fund', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.3, contributionChargePct: 1.8,
      feeHow: 'Two charges: 1.8% is taken from every contribution before it is invested, and 0.3% a year is taken from the whole pot.',
      sourceLabel: 'Pension Bible fee guide (reviewed 6 May 2026)', sourceUrl: 'https://www.pensionbible.co.uk/guides/pension-fees', asOf: '2026-05-06', confidence: 'sourced',
    },
    {
      id: 'uk-vanguard-pp', provider: 'Vanguard', fund: 'Personal Pension (LifeStrategy 80%)', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.22, platformFeePct: 0.15, platformFeeCapPerYear: 375,
      feeHow: 'A 0.15% platform fee, capped at £375 a year (minimum £4 a month on small accounts), plus the fund\'s own charge (OCF) taken inside the fund price.',
      sourceLabel: 'Pension Bible fee guide; fund OCF indicative', sourceUrl: 'https://www.pensionbible.co.uk/guides/pension-fees', asOf: '2026-05-06', confidence: 'sourced',
    },
    {
      id: 'uk-peoples', provider: "The People's Pension", fund: 'Balanced Profile', risk: 'balanced', growthSharePct: 70,
      investmentFeePct: 0.5, feeHow: 'An annual management charge as a % of your pot, with rebates on larger balances.',
      sourceLabel: 'Typical published charge', sourceUrl: 'https://thepeoplespension.co.uk', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'uk-pensionbee', provider: 'PensionBee', fund: 'Tailored Plan', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.7, feeHow: 'One all-in annual fee as a % of your pot (halved on the part above £100,000).',
      sourceLabel: 'Typical published charge', sourceUrl: 'https://www.pensionbee.com/uk/fees', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'uk-aviva', provider: 'Aviva', fund: 'Workplace pension default fund', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.5, feeHow: 'Annual management charge agreed by your employer, as a % of the pot (default funds are capped at 0.75% by law).',
      sourceLabel: 'Typical published charge', sourceUrl: 'https://www.aviva.co.uk', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'uk-lg', provider: 'Legal & General', fund: 'WorkSave Mastertrust default', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.4, feeHow: 'Annual management charge as a % of the pot, set by your employer\'s scheme.',
      sourceLabel: 'Typical published charge', sourceUrl: 'https://www.legalandgeneral.com', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'uk-scottishwidows', provider: 'Scottish Widows', fund: 'Workplace pension default', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.5, feeHow: 'Annual management charge as a % of the pot.',
      sourceLabel: 'Typical published charge', sourceUrl: 'https://www.scottishwidows.co.uk', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'uk-royallondon', provider: 'Royal London', fund: 'Governed Portfolio', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.5, feeHow: 'Annual management charge as a % of the pot; larger pots may get a discount.',
      sourceLabel: 'Typical published charge', sourceUrl: 'https://www.royallondon.com', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'uk-smart', provider: 'Smart Pension', fund: 'Default fund', risk: 'growth', growthSharePct: 80,
      investmentFeePct: 0.5, feeHow: 'Annual management charge as a % of the pot.',
      sourceLabel: 'Typical published charge', sourceUrl: 'https://www.smart.co', asOf: '2026-01-01', confidence: 'indicative',
    },
  ],

  PH: [
    {
      id: 'ph-bpi-pera-equity', provider: 'BPI Wealth', fund: 'PERA Equity Fund', risk: 'aggressive', growthSharePct: 95,
      investmentFeePct: 1.5, historicReturnPct: 0.67, historicYears: 5, returnBasis: 'net-of-fund-fees',
      feeHow: 'A 1.50% a year trust fee is taken from the fund\'s value (NAVPU), plus very small custody costs.',
      sourceLabel: 'BPI PERA Equity Fund fact sheet, March 2026', sourceUrl: 'https://www.bpi.com.ph/content/dam/bpi-wealth/investment-funds-pdfs/2026/bpi-pera-equity-fund/BPI%20PERA%20Equity%20Fund%20-%20March%202026.pdf',
      asOf: '2026-03-31', confidence: 'sourced',
      note: 'The Philippine share market has been weak for five years, so this historic return is far below a long-term assumption.',
    },
    {
      id: 'ph-bdo-pera-equityindex', provider: 'BDO', fund: 'PERA Equity Index Fund', risk: 'aggressive', growthSharePct: 95,
      investmentFeePct: 1.0, adminFeePct: 0.1,
      feeHow: 'A 1.0% a year trust fee plus about 0.1% trustee and custody costs, taken from the fund\'s value.',
      sourceLabel: 'BDO PERA Equity Index Fund fact sheet, July 2025', sourceUrl: 'https://www.bdo.com.ph/content/dam/bdounibank/en-ph/investments/files/pera/pera-equity-index-fund/PERA-Equity-Index-Fund-073125.pdf',
      asOf: '2025-07-31', confidence: 'sourced',
    },
    {
      id: 'ph-sunlife-pera', provider: 'Sun Life', fund: 'Prosperity PERA fund (balanced)', risk: 'balanced', growthSharePct: 60,
      investmentFeePct: 1.5, feeHow: 'Management fee as a % a year, taken from the fund\'s value.',
      sourceLabel: 'Typical published fee: check the fund fact sheet', sourceUrl: 'https://www.sunlifefunds.com', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'ph-atram-pera', provider: 'ATRAM', fund: 'PERA fund', risk: 'balanced', growthSharePct: 60,
      investmentFeePct: 1.5, feeHow: 'Management fee as a % a year, taken from the fund\'s value.',
      sourceLabel: 'Typical published fee: check the fund fact sheet', sourceUrl: 'https://www.atram.com.ph', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'ph-philequity-pera', provider: 'Philequity', fund: 'PERA Fund', risk: 'aggressive', growthSharePct: 95,
      investmentFeePct: 1.5, feeHow: 'Management fee as a % a year, taken from the fund\'s value.',
      sourceLabel: 'Typical published fee: check the fund fact sheet', sourceUrl: 'https://www.philequity.net', asOf: '2026-01-01', confidence: 'indicative',
    },
    {
      id: 'ph-pagibig-mp2', provider: 'Pag-IBIG Fund', fund: 'MP2 Savings (5-year term)', risk: 'conservative', growthSharePct: 0,
      investmentFeePct: 0, historicReturnPct: 7.12, historicYears: 1, returnBasis: 'net-of-fund-fees',
      feeHow: 'No fees are charged to members. The dividend rate is declared each year after Pag-IBIG\'s costs, and MP2 dividends are tax-free.',
      sourceLabel: 'Pag-IBIG Fund declared MP2 dividend for 2025', sourceUrl: 'https://www.pagibigfund.gov.ph', asOf: '2025-12-31', confidence: 'sourced',
      note: 'Not a PERA: it is a 5-year government savings scheme. Past dividend rates are not guaranteed.',
    },
  ],
};

/** Long-term gross (before fees and tax) return assumptions by risk type, used when there is no historic figure. */
export const LONG_TERM_GROSS_RETURN: Record<FundRisk, number> = {
  conservative: 4.5,
  balanced: 6.0,
  growth: 7.0,
  aggressive: 7.5,
};

export const PROVIDERS_REVIEWED = '2026-10-20';
