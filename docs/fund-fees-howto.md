# Adding real fund fees to the platform comparison

The comparison's **Fill in from a fund** picker reads `data/fund-fees.json`. Fees must come from official documents, because they change every quarter.

## Where to find the figures (New Zealand)
1. Go to the Disclose Register: https://disclose-register.companiesoffice.govt.nz
2. Search for the fund or scheme, and open its latest **fund update** (published quarterly).
3. Note the **total annual fund charges** (as a % of the fund) and any **dollar-based fees** (for example a yearly membership fee).
4. Cross-check against Sorted's KiwiSaver fund finder: https://sorted.org.nz/tools/kiwisaver-fund-finder

## Add each fund like this
```json
{
  "name": "Example Growth Fund",
  "provider": "Example Provider",
  "type": "growth",
  "annualFeePct": 0.55,
  "monthlyAccountFee": 2.5,
  "sourceUrl": "https://disclose-register.companiesoffice.govt.nz/...",
  "asOf": "2026-09-30"
}
```
- `type`: one of `defensive`, `conservative`, `balanced`, `growth`, `aggressive`, `index`, `other`.
- `monthlyAccountFee`: a yearly dollar fee divided by 12. Use 0 if none.
- Set the file's top-level `asOf` to the date you checked, so `npm run check:sources` can remind you to refresh it in 3 months.

The picker appears automatically once the `funds` list has entries.

## Retirement fund providers (KiwiSaver, super, 401(k)/IRA, pensions, PERA)

The "Retirement fund comparison" on the My financial numbers tab reads `data/retirement-providers.ts`.
Each fund has its fees, how they are charged (`feeHow`), a historic return with its basis, a source
link, an `asOf` date and a `confidence` of `sourced` or `indicative`. Review it every 3 months:

1. NZ: latest quarterly fund updates (Sorted Smart Investor / Disclose Register): total fund charges,
   member fee, 5-year return after fees and tax.
2. AU: fund performance (5-year, net of investment fees and tax) and total fees on $50,000 (ATO YourSuper).
3. US, UK, PH: expense ratios / annual management charges, contribution charges and fund fact sheets.
4. Change `PROVIDERS_REVIEWED`, run `npm test`, and turn `indicative` entries into `sourced` once checked.

Country rules (ESCT bands, government contribution, PIE tax, AU contributions/earnings tax, UK
qualifying earnings, PERA limits) are in `lib/finance/fund-comparison.ts`, dated `RULES_AS_AT`.
