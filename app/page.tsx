'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useChat } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import AccountControls from '../components/AccountControls';
import { MilestoneTable, ProjectionChart } from '../components/ProjectionChart';
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

export default function Page() {
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [answerHeld, setAnswerHeld] = useState(false);

  const { messages, input, setInput, setMessages, handleInputChange, handleSubmit, status, error } = useChat({
    api: '/api/chat',
    onResponse: (res) => {
      const notice = res.headers.get('X-Privacy-Notice');
      setPrivacyNotice(notice ? decodeURIComponent(notice) : null);
      const left = res.headers.get('X-Questions-Remaining');
      setRemaining(left !== null ? Number(left) : null);
      setAnswerHeld(res.headers.get('X-Answer-Check') === 'held');
    },
  });
  const isBusy = status === 'streaming' || status === 'submitted';
  const limitReached = error?.message?.includes('Plans page');

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
            <span className="ready-dot" /> {remaining !== null ? `${remaining} QUESTIONS LEFT TODAY` : 'ANSWERS CITE THE LIBRARY'}
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
                          <ReactMarkdown>{message.content}</ReactMarkdown>
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
                          if (invocation.toolName !== 'getInformation') return null;
                          const sources = invocation.result as Source[];
                          const scopes = (invocation.args as { collections?: string[] })?.collections ?? [];
                          return (
                            <details className="source-disclosure" key={invocation.toolCallId}>
                              <summary>
                                Sources
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
              {error && (
                <li className="error-message">
                  {error.message || 'The request could not be completed.'}
                  {limitReached && <> <Link href="/pricing">See plans</Link></>}
                </li>
              )}
            </ul>
          )}

          {messages.length === 0 && error && <p className="error-message">{error.message}</p>}

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
                placeholder="Ask about ETFs, KiwiSaver, FIF tax or your retirement numbers…"
                disabled={isBusy}
                maxLength={2000}
              />
              <button className="send-button" type="submit" aria-label="Send question" disabled={!input.trim() || isBusy}>
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
