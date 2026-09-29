import { z } from 'zod';

const PlatformOptionSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(80),
  expectedReturnPct: z.number().min(-10).max(20),
  annualFeePct: z.number().min(0).max(5).default(0),
  monthlyAccountFee: z.number().min(0).max(1000).default(0),
  transactionFee: z.number().min(0).max(1000).default(0),
  oneOffFee: z.number().min(0).max(10000).default(0),
});

export const PlatformComparisonInputSchema = z.object({
  initialBalance: z.number().min(0).max(1e10),
  monthlyContribution: z.number().min(0).max(1e7),
  years: z.number().int().min(1).max(60),
  inflationPct: z.number().min(0).max(15).default(2.5),
  options: z.array(PlatformOptionSchema).min(2).max(4),
});

export type PlatformComparisonInput = z.input<typeof PlatformComparisonInputSchema>;
type PlatformOption = z.output<typeof PlatformOptionSchema>;
type ComparisonInput = z.output<typeof PlatformComparisonInputSchema>;

export interface PlatformComparisonSeriesPoint {
  year: number;
  balance: number;
  feesPaid: number;
}

export interface PlatformComparisonOptionResult {
  id: string;
  name: string;
  expectedReturnPct: number;
  annualFeePct: number;
  endingBalanceNominal: number;
  endingBalanceReal: number;
  feesPaid: number;
  feeImpact: number;
  series: PlatformComparisonSeriesPoint[];
}

export interface PlatformComparisonResult {
  inputs: ComparisonInput;
  options: PlatformComparisonOptionResult[];
  assumptions: string[];
}

const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

function projectOption(input: ComparisonInput, option: PlatformOption, includeFees: boolean) {
  let balance = Math.max(0, input.initialBalance - (includeFees ? option.oneOffFee : 0));
  let feesPaid = includeFees ? Math.min(input.initialBalance, option.oneOffFee) : 0;
  const series: PlatformComparisonSeriesPoint[] = [{ year: 0, balance, feesPaid }];
  const returnRate = monthlyRate(option.expectedReturnPct);
  const managementRate = includeFees ? monthlyRate(option.annualFeePct) : 0;

  for (let month = 1; month <= input.years * 12; month++) {
    const transactionFee = includeFees && input.monthlyContribution > 0
      ? Math.min(input.monthlyContribution, option.transactionFee)
      : 0;
    balance += input.monthlyContribution - transactionFee;

    const managementFee = balance * managementRate;
    const growth = balance * returnRate;
    const accountFee = includeFees ? Math.min(Math.max(0, balance + growth - managementFee), option.monthlyAccountFee) : 0;
    balance = Math.max(0, balance + growth - managementFee - accountFee);
    feesPaid += transactionFee + managementFee + accountFee;

    if (month % 12 === 0) series.push({ year: month / 12, balance, feesPaid });
  }

  return { endingBalanceNominal: balance, feesPaid, series };
}

/**
 * Compare editable platform/fund assumptions. Return assumptions are user-entered;
 * fee impact is relative to the same return and cash flows before any fees.
 */
export function comparePlatforms(raw: PlatformComparisonInput): PlatformComparisonResult {
  const input = PlatformComparisonInputSchema.parse(raw);
  const deflator = Math.pow(1 + monthlyRate(input.inflationPct), input.years * 12);
  const options = input.options.map((option) => {
    const result = projectOption(input, option, true);
    const noFeeBaseline = projectOption(input, option, false).endingBalanceNominal;
    return {
      id: option.id,
      name: option.name,
      expectedReturnPct: option.expectedReturnPct,
      annualFeePct: option.annualFeePct,
      endingBalanceNominal: result.endingBalanceNominal,
      endingBalanceReal: result.endingBalanceNominal / deflator,
      feesPaid: result.feesPaid,
      feeImpact: Math.max(0, noFeeBaseline - result.endingBalanceNominal),
      series: result.series,
    };
  });

  return {
    inputs: input,
    options,
    assumptions: [
      `Each option uses its own entered gross return and fee assumptions, with the same opening balance, monthly contributions and timeframe.`,
      `Annual percentage fees are charged monthly; account fees are charged monthly; transaction fees are charged on each positive monthly contribution; one-off fees are deducted at the start.`,
      `Fee impact includes the growth those fees would otherwise have earned, relative to a no-fee projection at the same return.`,
      `Taxes, foreign-exchange costs, spreads and brokerage beyond the entered transaction fee are not modeled.`,
      `Returns are editable scenarios, not provider forecasts or recommendations.`,
    ],
  };
}