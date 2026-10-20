'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import SiteNav from '../components/SiteNav';
import { useProjectorPlan } from '../components/useProjectorPlan';
import Link from 'next/link';
import { useChat } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AccountControls from '../components/AccountControls';
import { MilestoneTable, ProjectionChart } from '../components/ProjectionChart';
import { HouseholdAnalysisView, HouseholdChart, HouseholdComparison, HouseholdMilestones, HouseholdWarnings } from '../components/HouseholdCharts';
import { analyseHousehold } from '../lib/finance/householdAnalysis';
import UpgradePanel, { type LimitTier } from '../components/UpgradePanel';
import { projectHousehold, type HouseholdInput } from '../lib/finance/household';
import { openPlanLink, projectorLink } from '../lib/finance/householdLink';
import { collectionLabel } from '../lib/collections';
import { projectWealth, type ProjectionInput } from '../lib/finance/projections';
import { householdFromSimple } from '../lib/finance/fromSimple';
import { BasisLabel, CountrySelect, RetireInSelect, useCountry, useRetireIn } from '../components/CountryPicker';
import { COUNTRIES, disclaimerFor, isCountry, localTerms, questionHint, type CountryCode } from '../lib/countries';
import { safeHttpUrl } from '../lib/security';
import ProjectorShell from '../components/ProjectorShell';
import PlatformComparisonSection from '../components/PlatformComparisonSection';
import TrustedTools from '../components/TrustedTools';
import { useComparisonSummary } from '../lib/comparisonShare';

type Tab = 'ask' | 'numbers';
const INCLUDE_KEY = 'irl:include-plan';

/** Questions people ask once their numbers are in. */
const NUMBER_QUESTIONS = [
  'What do my numbers mean, in plain words?',
  'Where could I improve my plan to retire comfortably?',
  'Am I on track compared with the 4% rule?',
  'Should I stay with my KiwiSaver or super provider, or move? Explain the fee and tax differences.',
  'What are the biggest risks in my plan, and how could we reduce them as a couple?',
];

type Source = {
  text?: string; source?: string; document?: string; section?: string;
  collection?: string; url?: string; asOf?: string; score?: number;
};

const SUGGESTIONS = [
  "I'm 52 with NZD 500,000 and add $2,000 a month. Could I retire at 65 on $60,000 a year?",
  'Why do many Kiwi investors hold CSPX instead of IVV?',
  'How does the FIF de minimis threshold work?',
  'Should I sell after a market crash?',
  'Should I pay off my mortgage or invest?',
];

const TOPICS: [string, string][] = [
  ['Retirement', 'How does the 4% rule work, and what are its limits?'],
  ['KiwiSaver', 'How do KiwiSaver contributions and the government contribution work?'],
  ['FIF tax', 'Explain the FIF fair dividend rate and comparative value methods.'],
  ['ETFs', 'What is the difference between US-domiciled and Irish-domiciled ETFs?'],
  ['Currency', 'How does the NZD exchange rate affect returns on US shares?'],
];

/**
 * Projections are calculated once per set of inputs and reused. The chat
 * redraws many times a second while an answer streams in, and recalculating
 * (hundreds of simulated markets) on every redraw would freeze the page.
 */
const projectionCache = new Map<string, unknown>();
function once<T>(key: string, compute: () => T): T {
  if (!projectionCache.has(key)) {
    projectionCache.set(key, compute());
    if (projectionCache.size > 40) projectionCache.delete(projectionCache.keys().next().value as string);
  }
  return projectionCache.get(key) as T;
}

/** The chart is recomputed from the tool's inputs, so the full series never goes through the model. */
const ProjectionFromArgs = memo(function ProjectionFromArgs({ args, country: selected }: { args: unknown; country: CountryCode }) {
  // Label the chart in the currency the projection was run in, not just the sidebar setting
  const requested = (args as { country?: unknown } | null)?.country;
  const country: CountryCode = isCountry(requested) ? requested : selected;
  const key = `wealth:${country}:${JSON.stringify(args)}`;
  const data = useMemo(() => once(key, () => {
    try {
      const result = projectWealth(args as ProjectionInput);
      // The same plan as a household, so simple questions also get the full analysis
      const household = householdFromSimple(args as ProjectionInput, country);
      const analysis = analyseHousehold(projectHousehold(household));
      return { result, household, analysis };
    } catch {
      return null;
    }
  }), [key]);
  if (!data) return null;
  return (
    <details className="source-disclosure projection-disclosure" open>
      <summary>Projection</summary>
      <BasisLabel country={country} inflationPct={data.result.inputs.inflationPct} />
      <ProjectionChart result={data.result} country={country} />
      <MilestoneTable result={data.result} country={country} />
      <HouseholdAnalysisView analysis={data.analysis} country={country} />
      <p className="projection-note">
        <a href={projectorLink(data.household)} onClick={(e) => { e.preventDefault(); openPlanLink(projectorLink(data.household)); }}>Open these numbers in My numbers</a> to add income, property,
        pensions and more, privately on your device.
      </p>
    </details>
  );
});

/** Whole-household projection, redrawn in the browser from the tool's inputs. */
const HouseholdFromArgs = memo(function HouseholdFromArgs({ args }: { args: unknown }) {
  const key = `household:${JSON.stringify(args)}`;
  const { result, analysis } = useMemo(() => once(key, () => {
    try {
      const r = projectHousehold(args as HouseholdInput);
      return { result: r, analysis: analyseHousehold(r) };
    } catch {
      return { result: null, analysis: null };
    }
  }), [key]);
  if (!result || !analysis) return null;
  return (
    <details className="source-disclosure projection-disclosure" open>
      <summary>Household projection</summary>
      <BasisLabel country={result.inputs.country} inflationPct={result.inputs.inflationPct} retireIn={result.inputs.retireIn} fx={result.inputs.fx} />
      <HouseholdWarnings result={result} />
      <HouseholdChart result={result} />
      <HouseholdMilestones result={result} />
      <HouseholdComparison result={result} />
      <HouseholdAnalysisView analysis={analysis} country={result.inputs.country} />
      <p className="projection-note">
        <a href={projectorLink(args as HouseholdInput)} onClick={(e) => { e.preventDefault(); openPlanLink(projectorLink(args as HouseholdInput)); }}>Open these numbers in My numbers</a> to change them privately on your device.
      </p>
    </details>
  );
});

/** Wraps Markdown tables so wide ones scroll instead of breaking the layout. */
const MARKDOWN_COMPONENTS = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="table-scroll"><table>{children}</table></div>
  ),
};

type UsageInfo = { remaining: number | null; limit: number; tier: LimitTier; limitsActive: boolean };

export default function Page() {
  const [country, setCountry] = useCountry();
  const [retireIn, setRetireIn] = useRetireIn();
  // The plan from the wealth projector, sent only while "Include my plan" is on
  const projectorPlan = useProjectorPlan(country);
  // On by default: the projector on this page is linked to the library automatically. People can switch it off.
  const [includePlan, setIncludePlanState] = useState(true);
  useEffect(() => {
    try { if (window.localStorage.getItem(INCLUDE_KEY) === 'off') setIncludePlanState(false); } catch { /* ignore */ }
  }, []);
  const setIncludePlan = (on: boolean) => {
    setIncludePlanState(on);
    try { window.localStorage.setItem(INCLUDE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  };
  const sharePlan = includePlan && projectorPlan ? projectorPlan.plan : undefined;
  const comparisonSummary = useComparisonSummary();
  const shareComparison = includePlan && comparisonSummary ? comparisonSummary : undefined;
  const [tab, setTab] = useState<Tab>('ask');
  const [numbersOpened, setNumbersOpened] = useState(false);
  const [projectorKey, setProjectorKey] = useState(0);
  // A projection in a chat answer was opened: show it in "My numbers" without leaving the page
  useEffect(() => {
    const open = () => { setTab('numbers'); setNumbersOpened(true); setProjectorKey((k) => k + 1); window.scrollTo({ top: 0 }); };
    window.addEventListener('irl:open-plan', open);
    return () => window.removeEventListener('irl:open-plan', open);
  }, []);
  const openTab = (t: Tab) => {
    setTab(t);
    if (t === 'numbers') setNumbersOpened(true);
    const url = new URL(window.location.href);
    if (t === 'numbers') url.searchParams.set('tab', 'numbers'); else { url.searchParams.delete('tab'); url.searchParams.delete('view'); }
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    window.scrollTo({ top: 0 });
  };
  // Open "My numbers" when arriving from an old /calculator link or a "plan" link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'numbers' || params.get('view') === 'full' || window.location.hash.startsWith('#plan=')) {
      setTab('numbers');
      setNumbersOpened(true);
    }
  }, []);

  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [answerHeld, setAnswerHeld] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [limitTier, setLimitTier] = useState<LimitTier | null>(null);

  // Show how many questions are left before the first one is asked.
  useEffect(() => {
    fetch('/api/usage', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: UsageInfo | null) => {
        if (!data) return;
        setUsage(data);
        if (data.limitsActive && data.remaining === 0) setLimitTier(data.tier);
      })
      .catch(() => {});
  }, []);

  const { messages, input, setInput, setMessages, handleInputChange, handleSubmit, status, error } = useChat({
    api: '/api/chat',
    body: { country, retireIn: retireIn && retireIn !== country ? retireIn : undefined, plan: sharePlan, comparison: shareComparison },
    onResponse: (res) => {
      const notice = res.headers.get('X-Privacy-Notice');
      setPrivacyNotice(notice ? decodeURIComponent(notice) : null);
      const left = res.headers.get('X-Questions-Remaining');
      setRemaining(left !== null ? Number(left) : null);
      const reached = res.headers.get('X-Limit-Reached');
      if (reached) setLimitTier(reached as LimitTier);
      // That was the last question for today: show the upgrade panel under the answer.
      else if (res.ok && left === '0') setLimitTier((res.headers.get('X-Questions-Tier') ?? 'free') as LimitTier);
      setAnswerHeld(res.headers.get('X-Answer-Check') === 'held');
    },
  });
  const askAbout = (q: string) => { openTab('ask'); setInput(q); };
  const isBusy = status === 'streaming' || status === 'submitted';
  const limitReached = limitTier !== null;
  const left = remaining ?? usage?.remaining ?? null;
  const usageLabel =
    left === null || !usage?.limitsActive
      ? 'ANSWERS CITE THE LIBRARY'
      : `${left} OF ${usage.limit} ${usage.tier === 'anonymous' || usage.tier === 'free' ? 'FREE ' : ''}QUESTIONS LEFT THIS MONTH`;

  return (
    <main className="guide-shell">
      <aside className="guide-rail" aria-label="Library navigation">
        <a className="brand-lockup" href="#top" aria-label="Investment Research Library home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-copy">
            <strong>Research Library</strong>
            <small>NZ, AU, US, UK, PH</small>
          </span>
        </a>

        <button
          className="new-chat-button"
          type="button"
          onClick={() => {
            setMessages([]);
            setInput('');
            setPrivacyNotice(null);
          }}
        >
          <span aria-hidden="true">+</span> New conversation
        </button>

        <div className="rail-section">
          <p className="rail-label">TOOLS</p>
          <button type="button" className="corpus-entry corpus-button" onClick={() => openTab(tab === 'numbers' ? 'ask' : 'numbers')}>
            <span className="corpus-glyph" aria-hidden="true">$</span>
            <span>
              <strong>{tab === 'numbers' ? 'Back to the library' : 'My numbers'}</strong>
              <small>{tab === 'numbers' ? 'Ask about your plan' : 'Wealth projector and fund comparison'}</small>
            </span>
            <span className="ready-dot" aria-hidden="true" />
          </button>
        </div>

        <div className="rail-section rail-country">
          <CountrySelect id="chat-country" value={country} onChange={setCountry} label="I live in" />
          <RetireInSelect id="chat-retire-in" value={retireIn && retireIn !== country ? retireIn : null} livesIn={country} onChange={setRetireIn} />
        </div>

        <div className="rail-section recent-section">
          <p className="rail-label">EXPLORE</p>
          {TOPICS.map(([label, question]) => (
            <button className="rail-link" key={label} type="button" onClick={() => askAbout(question)}>
              {label}
            </button>
          ))}
        </div>

        <div className="rail-footer rail-footer-account">
          <AccountControls showProjector />
          <small>
            Education, not financial advice. <Link href="/about">About &amp; privacy</Link>
          </small>
        </div>
      </aside>

      <section className="guide-workspace" id="top">
        <header className="workspace-bar">
          <SiteNav current={tab === 'numbers' ? 'calculator' : 'ask'} onTab={openTab} />
          <div className="source-count">
            <span className="ready-dot" /> <span className="usage-meter">{usageLabel}</span>
          </div>
        </header>
        {/* On phones the sidebar is hidden, so country settings sit under the top bar */}
        <div className="mobile-settings">
          <CountrySelect id="chat-country-mobile" value={country} onChange={setCountry} label="I live in" />
          <RetireInSelect id="chat-retire-in-mobile" value={retireIn && retireIn !== country ? retireIn : null} livesIn={country} onChange={setRetireIn} />
        </div>

        <div className="workspace-tabs" role="tablist" aria-label="Library or my numbers">
          <button type="button" role="tab" aria-selected={tab === 'ask'} className={tab === 'ask' ? 'is-on' : ''} onClick={() => openTab('ask')}>
            💬 Ask the library {includePlan && (projectorPlan || comparisonSummary) && <small>· linked to my numbers</small>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'numbers'} className={tab === 'numbers' ? 'is-on' : ''} onClick={() => openTab('numbers')}>
            📊 My numbers <small>· wealth projector and fund comparison</small>
          </button>
        </div>

        {numbersOpened && (
          <div className="numbers-panel" hidden={tab !== 'numbers'}>
            <h1 className="page-title">My numbers</h1>
            <p className="page-lede">
              See where your money could take you, on your own or as a couple. Your answers stay on this device; while
              &quot;Include my numbers&quot; is on, the library uses them to explain what they mean and how you could improve them.
            </p>
            <div className="ask-about-numbers">
              <strong>Ask the library about these numbers:</strong>
              {NUMBER_QUESTIONS.map((q) => <button key={q} type="button" className="suggestion-chip" onClick={() => askAbout(q)}>{q}</button>)}
            </div>
            <p><a className="guide-link" href="/calculator/guide">Need help? Read the step-by-step guide →</a></p>
            <ProjectorShell key={projectorKey} />
            <PlatformComparisonSection />
            <TrustedTools />
            <div className="ask-about-numbers">
              <strong>Questions about your plan or the comparison?</strong>
              <button type="button" className="suggestion-chip" onClick={() => openTab('ask')}>Ask the library ↗</button>
            </div>
          </div>
        )}

        <div className="conversation-column" hidden={tab !== 'ask'}>
          {messages.length === 0 ? (
            <section className="welcome-panel" aria-labelledby="welcome-title">
              <div className="welcome-seal" aria-hidden="true"><span>RL</span></div>
              <p className="eyebrow">A CITED INVESTING LIBRARY</p>
              <h1 id="welcome-title">Ask the <em>library.</em></h1>
              <p className="welcome-copy">
                Research investing questions against guides on ETFs, KiwiSaver, FIF tax and retirement, and see what
                your savings could grow to. Every answer shows its sources.
              </p>
              {COUNTRIES[country].coverage !== 'full' && (
                <p className="coverage-note">
                  You&apos;ve chosen {COUNTRIES[country].name}. Projections use {COUNTRIES[country].name} settings and{' '}
                  {COUNTRIES[country].currency}. The library&apos;s {COUNTRIES[country].name} documents are{' '}
                  {COUNTRIES[country].coverage === 'partial' ? 'still being expanded' : 'not added yet'}, so answers about its tax
                  and pension rules will point you to official sources.
                </p>
              )}
              <div className="suggestion-list" aria-label="Suggested questions">
                {SUGGESTIONS.map((q) => q.replace('NZD', COUNTRIES[country].currency)).map((question) => (
                  <button className="suggestion-chip" key={question} type="button" onClick={() => setInput(question)}>
                    {question}<span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <ul className="message-list" aria-live="polite">
              {messages.map((message, i) => {
                const isLastAssistant = message.role === 'assistant' && i === messages.length - 1;
                const finished = message.role === 'assistant' && (!isLastAssistant || !isBusy);
                return (
                  <li className={`message-row message-${message.role}`} key={message.id}>
                    {message.role === 'assistant' && <span className="assistant-mark">RL</span>}
                    <div className="message-content">
                      <span className="message-speaker">{message.role === 'user' ? 'YOU' : 'LIBRARY'}</span>
                      {message.role === 'assistant' ? (
                        <div className="message-bubble markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="message-bubble">{message.content}</div>
                      )}

                      {message.role === 'assistant' &&
                        message.toolInvocations?.map((invocation) => {
                          if (invocation.state !== 'result') return null;
                          if (invocation.toolName === 'projectWealth') {
                            return (invocation.result as { ok?: boolean })?.ok ? (
                              <ProjectionFromArgs key={invocation.toolCallId} args={invocation.args} country={country} />
                            ) : null;
                          }
                          if (invocation.toolName === 'projectHousehold') {
                            return (invocation.result as { ok?: boolean })?.ok ? (
                              <HouseholdFromArgs key={invocation.toolCallId} args={invocation.args} />
                            ) : null;
                          }
                          if (invocation.toolName !== 'getInformation') return null;
                          const sources = invocation.result as Source[];
                          const scopes = [...new Set(sources.map((source) => source.collection).filter((collection): collection is string => Boolean(collection)))];
                          return (
                            <details className="source-disclosure" key={invocation.toolCallId} open={isLastAssistant}>
                              <summary>
                                Sources used
                                {scopes.length > 0 && <> · {scopes.map(collectionLabel).join(', ')}</>}{' '}
                                <span>{sources.length}</span>
                              </summary>
                              <ul className="source-list">
                                {sources.map((source, index) => (
                                  <li className="source-item" key={`${source.source}-${index}`} title={source.document || undefined}>
                                    <span className="source-meta">
                                      {safeHttpUrl(source.url) ? (
                                        <a href={safeHttpUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.document || source.source}</a>
                                      ) : (
                                        source.document || source.source
                                      )}{' '}
                                      <b>/</b> {source.section ?? 'Unlabeled section'}
                                      {source.collection && <> <b>/</b> {collectionLabel(source.collection)}</>}
                                      {source.asOf && <> <b>/</b> as at {source.asOf}</>}
                                      <span className="source-score">
                                        {typeof source.score === 'number' ? source.score.toFixed(2) : '—'}
                                      </span>
                                    </span>
                                    <p>{source.text}</p>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          );
                        })}

                      {finished && message.content && <p className="disclaimer-note">{disclaimerFor(country)}</p>}
                    </div>
                  </li>
                );
              })}
              {isBusy && (
                <li className="typing-status">
                  <span /> {answerHeld
                    ? 'Preparing and checking an educational answer…'
                    : messages[messages.length - 1]?.toolInvocations?.some((t) => t.state === 'result')
                      ? 'Writing the answer…'
                      : 'Searching the library…'}
                </li>
              )}
              {error && !limitReached && (
                <li className="error-message">{error.message || 'The request could not be completed.'}</li>
              )}
            </ul>
          )}

          {messages.length === 0 && error && !limitReached && <p className="error-message">{error.message}</p>}
          {limitTier && <UpgradePanel tier={limitTier} />}

          <div className="composer-wrap">
            <div className={`plan-share${includePlan && (projectorPlan || comparisonSummary) ? ' is-on' : ''}`}>
              {projectorPlan || comparisonSummary ? (
                <>
                  <label className="plan-share-toggle">
                    <input type="checkbox" role="switch" checked={includePlan} onChange={(ev) => setIncludePlan(ev.target.checked)} />
                    <span className="plan-share-track" aria-hidden="true"><span /></span>
                    <span>📎 Include my numbers (projector plan{comparisonSummary ? ' and fund comparison' : ''})</span>
                  </label>
                  <small>
                    {includePlan
                      ? `Linked: ${projectorPlan ? `your ${projectorPlan.source === 'full' ? '"Advanced"' : 'guided'} plan` : ''}${projectorPlan && comparisonSummary ? ' and ' : ''}${comparisonSummary ? 'your fund comparison' : ''} ${projectorPlan && comparisonSummary ? 'are' : 'is'} sent with each question while this is on. Names, tax numbers and bank numbers are removed first.`
                      : 'Off: your numbers stay on this device.'}
                  </small>
                  {includePlan && (
                    <div className="plan-share-ideas">
                      {[
                        'What do my numbers mean, in plain words?',
                        'Where could I improve my plan?',
                        'Review my plan against well-known investing principles',
                        ...(comparisonSummary ? ['Should I stay with my current fund or move?'] : []),
                      ].map((q) => (
                        <button key={q} type="button" className="suggestion-chip" onClick={() => setInput(q)}>{q}</button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <small>Want answers about your own numbers? <button type="button" className="link-button" onClick={() => openTab('numbers')}>Fill in My numbers</button> and the library will use them automatically.</small>
              )}
            </div>
            {privacyNotice && (
              <p className="privacy-notice" role="status">
                {privacyNotice}
                <button type="button" onClick={() => setPrivacyNotice(null)} aria-label="Dismiss privacy notice">×</button>
              </p>
            )}
            <form onSubmit={handleSubmit} className="composer">
              <label className="sr-only" htmlFor="question-input">Ask the library</label>
              <input
                id="question-input"
                value={input}
                onChange={handleInputChange}
                placeholder={limitReached ? "You've used this month's questions" : questionHint(country)}
                disabled={isBusy || limitReached}
                maxLength={2000}
              />
              <button className="send-button" type="submit" aria-label="Send question" disabled={!input.trim() || isBusy || limitReached}>
                <span aria-hidden="true">↑</span>
              </button>
            </form>
            <p className="composer-note">
              Age and amounts are enough; don&apos;t include names, {localTerms(country).taxNumber} or bank details <span>·</span> education, not financial advice
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
