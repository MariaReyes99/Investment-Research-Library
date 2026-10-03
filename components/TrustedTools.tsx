'use client';
/**
 * Free tools from trusted, independent sources for the visitor's country.
 * New Zealand links go to Sorted (Te Ara Ahunga Ora Retirement Commission).
 */
import { COUNTRIES, type CountryCode } from '../lib/countries';
import { useCountry } from './CountryPicker';

type Tool = { label: string; what: string; url: string };

const SORTED: Tool[] = [
  { label: 'Retirement calculator', what: 'Check whether you are on track, including NZ Super', url: 'https://sorted.org.nz/tools/retirement-calculator' },
  { label: 'Retirement navigator', what: 'How much to draw from savings each year in retirement', url: 'https://sorted.org.nz/tools/retirement-navigator' },
  { label: 'KiwiSaver fund finder', what: 'Compare every KiwiSaver fund by fees, returns and risk', url: 'https://sorted.org.nz/tools/kiwisaver-fund-finder' },
  { label: 'KiwiSaver calculator', what: 'Your KiwiSaver balance at retirement', url: 'https://sorted.org.nz/tools/kiwisaver-calculator' },
  { label: 'Budget planner', what: 'Work out what comes in and goes out', url: 'https://sorted.org.nz/tools/budget-planner' },
  { label: 'Mortgage calculator', what: 'Repayments, rates and paying off faster', url: 'https://sorted.org.nz/tools/mortgage-calculator' },
  { label: 'Debt calculator', what: 'Plan paying off debts and the interest saved', url: 'https://sorted.org.nz/tools/debt-calculator' },
];

function toolsFor(country: CountryCode): { intro: string; tools: Tool[] } {
  if (country === 'NZ') {
    return {
      intro: "Sorted is New Zealand's free, independent money guide, run by Te Ara Ahunga Ora Retirement Commission. Use it alongside this projector:",
      tools: SORTED,
    };
  }
  const c = COUNTRIES[country];
  return {
    intro: `Free, independent guidance for ${c.name}:`,
    tools: c.officialSources.map((s) => ({ label: s.label, what: `Official information for ${c.name}`, url: s.url })),
  };
}

export default function TrustedTools({ compact = false }: { compact?: boolean }) {
  const [country] = useCountry();
  const { intro, tools } = toolsFor(country);
  return (
    <section className={`trusted-tools${compact ? ' is-compact' : ''} no-print`} aria-labelledby="trusted-tools-title">
      <h2 id="trusted-tools-title"><span aria-hidden="true">🧭</span> Free tools from trusted sources</h2>
      <p>{intro}</p>
      <ul>
        {(compact ? tools.slice(0, 4) : tools).map((t) => (
          <li key={t.url}>
            <a href={t.url} target="_blank" rel="noopener noreferrer">{t.label} ↗</a>
            <small>{t.what}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
