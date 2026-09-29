'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { projectorLink } from '../lib/finance/householdLink';
import { collectionLabel } from '../lib/collections';
import { projectWealth, type ProjectionInput } from '../lib/finance/projections';
import { DISCLAIMER } from '../lib/guardrails/advice';
import { safeHttpUrl } from '../lib/security';

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

/** The chart is recomputed from the tool's inputs, so the full series never goes through the model. */
function ProjectionFromArgs({ args }: { args: unknown }) {
  const result = useMemo(() => {
    try {
      return projectWealth(args as ProjectionInput);
    } catch {
      return null;
    }
  }, [args]);
  if (!result) return null;
  return (
    <details className="source-disclosure projection-disclosure" open>
      <summary>Projection</summary>
      <ProjectionChart result={result} />
      <MilestoneTable result={result} />
      <p className="projection-note">
        <Link href="/calculator">Open the wealth projector</Link> to change these assumptions privately on your device.
      </p>
    </details>
  );
}

/** Whole-household projection, redrawn in the browser from the tool's inputs. */
function HouseholdFromArgs({ args }: { args: unknown }) {
  const { result, analysis } = useMemo(() => {
    try {
      const r = projectHousehold(args as HouseholdInput);
      return { result: r, analysis: analyseHousehold(r) };
    } catch {
      return { result: null, analysis: null };
    }
  }, [args]);
  if (!result || !analysis) return null;
  return (
    <details className="source-disclosure projection-disclosure" open>
      <summary>Household projection</summary>
      <HouseholdWarnings result={result} />
      <HouseholdChart result={result} />
      <HouseholdMilestones result={result} />
      <HouseholdComparison result={result} />
      <HouseholdAnalysisView analysis={analysis} />
      <p className="projection-note">
        <a href={projectorLink(args as HouseholdInput)}>Open these numbers in the wealth projector</a> to change them privately on your device.
      </p>
    </details>
  );
}

/** Wraps Markdown tables so wide ones scroll instead of breaking the layout. */
const MARKDOWN_COMPONENTS = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="table-scroll"><table>{children}</table></div>
  ),
};

type UsageInfo = { remaining: number | null; limit: number; tier: LimitTier; limitsActive: boolean };

export default function Page() {
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
  const isBusy = status === 'streaming' || status === 'submitted';
  const limitReached = limitTier !== null;
  const left = remaining ?? usage?.remaining ?? null;
  const usageLabel =
    left === null || !usage?.limitsActive
      ? 'ANSWERS CITE THE LIBRARY'
      : `${left} OF ${usage.limit} ${usage.tier === 'anonymous' || usage.tier === 'free' ? 'FREE ' : ''}QUESTIONS LEFT TODAY`;

  return (
    <main className="guide-shell">
      <aside className="guide-rail" aria-label="Library navigation">
        <a className="brand-lockup" href="#top" aria-label="Investment Research Library home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-copy">
            <strong>Research Library</strong>
            <small>NZ &amp; AU INVESTORS</small>
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
          <Link className="corpus-entry corpus-button" href="/calculator">
            <span className="corpus-glyph" aria-hidden="true">$</span>
            <span>
              <strong>Wealth projector</strong>
              <small>Private, runs on your device</small>
            </span>
            <span className="ready-dot" aria-hidden="true" />
          </Link>
        </div>

        <div className="rail-section recent-section">
          <p className="rail-label">EXPLORE</p>
          {TOPICS.map(([label, question]) => (
            <button className="rail-link" key={label} type="button" onClick={() => setInput(question)}>
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
          <div className="breadcrumb"><span>RESEARCH DESK</span><b>/</b> INVESTMENT LIBRARY</div>
          <div className="source-count">
            <span className="ready-dot" /> <span className="usage-meter">{usageLabel}</span>
          </div>
        </header>

        <div className="conversation-column">
          {messages.length === 0 ? (
            <section className="welcome-panel" aria-labelledby="welcome-title">
              <div className="welcome-seal" aria-hidden="true"><span>RL</span></div>
              <p className="eyebrow">A CITED INVESTING LIBRARY</p>
              <h1 id="welcome-title">Ask the <em>library.</em></h1>
              <p className="welcome-copy">
                Research investing questions against guides on ETFs, KiwiSaver, FIF tax and retirement, and see what
                your savings could grow to. Every answer shows its sources.
              </p>
              <div className="suggestion-list" aria-label="Suggested questions">
                {SUGGESTIONS.map((question) => (
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
                              <ProjectionFromArgs key={invocation.toolCallId} args={invocation.args} />
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

                      {finished && message.content && <p className="disclaimer-note">{DISCLAIMER}</p>}
                    </div>
                  </li>
                );
              })}
              {isBusy && (
                <li className="typing-status">
                  <span /> {answerHeld ? 'Preparing and checking an educational answer…' : 'Searching the library…'}
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
                placeholder={limitReached ? "You've used today's questions" : 'Ask about ETFs, KiwiSaver, FIF tax or your retirement numbers…'}
                disabled={isBusy || limitReached}
                maxLength={2000}
              />
              <button className="send-button" type="submit" aria-label="Send question" disabled={!input.trim() || isBusy || limitReached}>
                <span aria-hidden="true">↑</span>
              </button>
            </form>
            <p className="composer-note">
              Age and amounts are enough; don&apos;t include names, IRD numbers or bank details <span>·</span> education, not financial advice
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
