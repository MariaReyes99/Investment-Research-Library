# Update 2: wider fields, portfolio analysis, friendly errors

Unzip into your Caps_Invst folder and choose Replace for existing files.
If `npm run dev` is running, the page updates by itself. Otherwise:

    npm test        (should show 42 passing)
    npm run dev

Changed files
- components/HouseholdPlanner.tsx: wider form, shorter unit labels, plain-English errors,
  keeps your last results on screen while you fix a field, shows the analysis
- lib/finance/householdAnalysis.ts (new): strengths, weaknesses, risks and levers
- components/HouseholdCharts.tsx: analysis display
- app/page.tsx, app/api/chat/route.ts, lib/guardrails/advice.ts: the chat shows and explains the analysis
- lib/finance/household.ts: dollar signs in warnings
- app/globals.css, tests/household.test.ts
