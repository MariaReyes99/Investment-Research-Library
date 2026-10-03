'use client';
/**
 * "Meet Penny": a short animated introduction to the app, presented by a
 * cartoon avatar. Captions are always shown; the voice uses the device's own
 * speech, so nothing is downloaded or sent anywhere.
 */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const POSITIONING = "Plan your whole household's retirement, even across countries, and ask questions you'll get cited answers to.";

type Scene = { icon: string; title: string; line: string; points?: string[]; mood?: 'wave' | 'point' | 'cheer' };

const SCENES: Scene[] = [
  {
    icon: '👋', title: "Kia ora, I'm Penny", mood: 'wave',
    line: `Kia ora, I'm Penny! In about a minute, I'll show you what this app can do. ${POSITIONING}`,
    points: ['Retirement planning', 'Investment research', 'All in one place'],
  },
  {
    icon: '🧭', title: 'Plan your whole household',
    line: 'Answer a few easy questions in the guided setup. It takes about five minutes. Add your savings, KiwiSaver or super, your home, your income and pensions, and the costs of children, parents and pets. Plan just for you, or for you and your partner.',
    points: ['Savings and KiwiSaver / Super', 'Home and property', 'Income and pensions', 'Family costs'],
  },
  {
    icon: '🌏', title: 'Even across countries', mood: 'point',
    line: "Working in one country and planning to retire in another? Add savings, homes and pensions in different currencies. We use today's exchange rates and each country's pension rules.",
    points: ['NZ, Australia, US, UK, Philippines', "Today's exchange rates", 'Pensions from several countries'],
  },
  {
    icon: '📈', title: 'See your money future',
    line: 'See how your savings could grow to retirement, and how long they could last, tested across hundreds of different ups and downs in the markets.',
    points: ['Your net worth by age', 'How long savings last', '300 simulated markets'],
  },
  {
    icon: '💡', title: 'Know your strengths and risks', mood: 'point',
    line: "We show what's working, what to watch, and levers you could pull, like retiring a little later, lowering fees, or a reverse mortgage. Plus a quick check of your emergency fund.",
    points: ['Strengths and weaknesses', 'Risks to watch', 'Levers to explore', 'Emergency fund check'],
  },
  {
    icon: '📚', title: 'Ask the library',
    line: "Ask questions in plain words, and get answers with sources you can check. Switch on 'include my plan' to have your own numbers reviewed against well-known investing principles and your country's rules.",
    points: ['Plain-English answers', 'Sources you can check', 'Reviews your own plan'],
  },
  {
    icon: '⚖️', title: 'Compare platforms and fees',
    line: "See how fees add up over the years, side by side, and find free tools from trusted sources such as Sorted.",
    points: ['Fees side by side', 'Named on the chart', 'Free trusted tools'],
  },
  {
    icon: '🔒', title: 'Private and safe',
    line: 'Your numbers stay on your device unless you choose to share them, and you can clear them at any time. Remember, this is education, not financial advice.',
    points: ['Stays on your device', 'Clear it any time', 'Education, not advice'],
  },
  {
    icon: '🚀', title: 'Ready to start?', mood: 'cheer',
    line: `${POSITIONING} Let's get started!`,
  },
];

const DISMISS_KEY = 'irl:intro-seen';
const VOICE_KEY = 'irl:intro-voice';
const LAST = SCENES.length - 1;
/** Set NEXT_PUBLIC_INTRO_AUDIO=on and add public/intro-audio/scene-1.mp3 … scene-9.mp3 to use recorded voice-overs. */
const RECORDED_AUDIO = process.env.NEXT_PUBLIC_INTRO_AUDIO === 'on';

type VoiceSettings = { voiceURI?: string; rate: number; pitch: number };
const DEFAULT_VOICE: VoiceSettings = { rate: 0.95, pitch: 1 };

/** Names that usually mean a higher-quality, more natural-sounding voice. */
const NATURAL = /natural|neural|online|premium|enhanced|google|siri/i;

function rankVoice(v: SpeechSynthesisVoice): number {
  let score = 0;
  if (NATURAL.test(v.name)) score += 4;
  if (/en-NZ/i.test(v.lang)) score += 3;
  else if (/en-(AU|GB)/i.test(v.lang)) score += 2;
  else if (/^en/i.test(v.lang)) score += 1;
  return score;
}

/** The chosen voice, or the most natural-sounding English voice on this device. */
function pickVoice(voices: SpeechSynthesisVoice[], uri?: string): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => /^en/i.test(v.lang));
  return (uri && voices.find((v) => v.voiceURI === uri)) || [...english].sort((a, b) => rankVoice(b) - rankVoice(a))[0] || null;
}

/** Speaking one sentence at a time adds natural pauses between them. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

/** The cartoon presenter. */
function Penny({ talking, mood, size = 180 }: { talking: boolean; mood?: Scene['mood']; size?: number }) {
  return (
    <svg className={`penny${talking ? ' is-talking' : ''}${mood ? ` is-${mood}` : ''}`} width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Penny, the presenter">
      <circle cx="100" cy="100" r="96" fill="#eef3e8" />
      {/* body */}
      <path d="M38 196c4-38 30-58 62-58s58 20 62 58" fill="#53634f" />
      <path d="M84 140l16 18 16-18" fill="#f3e6dc" />
      {/* arm (waves or points) */}
      <g className="penny-arm">
        <path d="M150 168c10-14 18-30 22-48" stroke="#53634f" strokeWidth="16" strokeLinecap="round" fill="none" />
        <circle cx="173" cy="116" r="10" fill="#e9b894" />
      </g>
      {/* neck and head */}
      <rect x="88" y="118" width="24" height="22" rx="8" fill="#e9b894" />
      <ellipse cx="100" cy="88" rx="42" ry="46" fill="#f2c7a5" />
      {/* hair */}
      <path d="M56 86c-2-34 20-56 46-56 28 0 46 22 44 54-8-16-22-26-44-28-20 2-36 12-46 30z" fill="#4a3426" />
      <circle cx="100" cy="30" r="15" fill="#4a3426" />
      {/* cheeks */}
      <circle cx="74" cy="102" r="7" fill="#f0a98f" opacity="0.6" />
      <circle cx="126" cy="102" r="7" fill="#f0a98f" opacity="0.6" />
      {/* eyes */}
      <g className="penny-eyes">
        <ellipse cx="84" cy="88" rx="5" ry="6" fill="#26322c" />
        <ellipse cx="116" cy="88" rx="5" ry="6" fill="#26322c" />
        <circle cx="86" cy="86" r="1.6" fill="#fff" />
        <circle cx="118" cy="86" r="1.6" fill="#fff" />
      </g>
      <path d="M76 76q8-5 16 0M108 76q8-5 16 0" stroke="#4a3426" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* mouth: a smile, opening while talking */}
      <path className="penny-smile" d="M86 108q14 12 28 0" stroke="#7a3b2c" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      <ellipse className="penny-mouth" cx="100" cy="111" rx="9" ry="6" fill="#7a3b2c" />
    </svg>
  );
}

export default function IntroAvatar() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(true);
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [voice, setVoice] = useState(true);
  const [talking, setTalking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Each scene run gets a number; signals from a stopped run are ignored. */
  const run = useRef(0);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // The device's voices load after a moment in some browsers
  useEffect(() => {
    if (!canSpeak) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    try {
      const saved = JSON.parse(window.localStorage.getItem(VOICE_KEY) ?? 'null');
      if (saved && typeof saved.rate === 'number') setVoiceSettings({ ...DEFAULT_VOICE, ...saved });
    } catch { /* use defaults */ }
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [canSpeak]);

  const updateVoice = (patch: Partial<VoiceSettings>) => {
    setVoiceSettings((v) => {
      const next = { ...v, ...patch };
      try { window.localStorage.setItem(VOICE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  /** Speaks text one sentence at a time with the chosen voice; calls done once at the end. */
  const speak = useCallback((text: string, id: number, done: () => void) => {
    const v = pickVoice(window.speechSynthesis.getVoices(), voiceSettings.voiceURI);
    const parts = sentences(text);
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      u.voice = v;
      if (v) u.lang = v.lang;
      u.rate = voiceSettings.rate;
      u.pitch = voiceSettings.pitch;
      if (i === parts.length - 1) {
        u.onend = () => { if (id === run.current) done(); };
        u.onerror = () => { if (id === run.current) done(); };
      }
      window.speechSynthesis.speak(u);
    });
  }, [voiceSettings]);

  useEffect(() => {
    try { setSeen(window.localStorage.getItem(DISMISS_KEY) === '1'); } catch { setSeen(false); }
  }, []);

  const stop = useCallback(() => {
    run.current += 1; // anything still finishing from before is ignored
    if (timer.current) clearTimeout(timer.current);
    if (audio.current) { audio.current.pause(); audio.current = null; }
    if (canSpeak) window.speechSynthesis.cancel();
    setTalking(false);
  }, [canSpeak]);

  // Present the current scene: play or speak it (if sound is on) or wait long enough to read it, then move on
  useEffect(() => {
    if (!open) return;
    stop();
    if (!playing) return;
    const id = run.current;
    const index = Math.min(scene, LAST);
    const s = SCENES[index];
    const next = () => {
      if (id !== run.current) return;
      setTalking(false);
      if (index < LAST) timer.current = setTimeout(() => setScene((i) => Math.min(LAST, i + 1)), 900);
      else setPlaying(false);
    };
    const readingTime = () => { timer.current = setTimeout(next, Math.max(4000, s.line.split(/\s+/).length * 330)); };
    setTalking(true);
    if (voice && RECORDED_AUDIO) {
      // A recorded voice-over, falling back to the device voice if the file is missing
      const a = new Audio(`/intro-audio/scene-${index + 1}.mp3`);
      audio.current = a;
      a.onended = next;
      a.onerror = () => { if (id === run.current) { if (canSpeak) speak(s.line, id, next); else readingTime(); } };
      a.play().catch(() => a.onerror?.(new Event('error')));
    } else if (voice && canSpeak) {
      speak(s.line, id, next);
    } else {
      readingTime();
    }
    return stop;
  }, [open, scene, playing, voice, canSpeak, stop, speak]);

  const start = () => {
    setScene(0);
    setPlaying(true);
    setOpen(true);
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setSeen(true);
  };
  const close = () => { stop(); setOpen(false); };

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setScene((i) => Math.min(LAST, i + 1));
      if (e.key === 'ArrowLeft') setScene((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const s = SCENES[Math.min(scene, LAST)];
  const last = scene >= LAST;

  return (
    <>
      <button type="button" className={`intro-launcher no-print${seen ? '' : ' is-new'}`} onClick={start} aria-label="Watch the 1-minute intro with Penny">
        <span className="intro-launcher-face" aria-hidden="true"><Penny talking={false} size={44} /></span>
        <span className="intro-launcher-text"><b>Watch the 1-minute intro</b><small>Meet Penny, your guide</small></span>
      </button>

      {open && (
        <div className="intro-backdrop" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <section className="intro-dialog" role="dialog" aria-modal="true" aria-labelledby="intro-title">
            <button ref={closeButton} type="button" className="intro-close" onClick={close} aria-label="Close the intro">×</button>
            <div className="intro-stage">
              <div className="intro-presenter">
                <Penny talking={talking} mood={s.mood} />
                <span className="intro-name">Penny</span>
              </div>
              <div className="intro-slide" key={scene}>
                <span className="intro-icon" aria-hidden="true">{s.icon}</span>
                <h2 id="intro-title">{s.title}</h2>
                {s.points && <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>}
                {last && (
                  <div className="intro-cta">
                    <p className="intro-positioning">{POSITIONING}</p>
                    <Link className="wizard-button" href="/calculator" onClick={close}>Start the guided setup</Link>
                    <Link className="wizard-button is-quiet" href="/" onClick={close}>Ask the library</Link>
                  </div>
                )}
              </div>
            </div>
            <p className="intro-caption" aria-live="polite">{s.line}</p>
            <div className="intro-controls">
              <div className="intro-dots" aria-label={`Scene ${scene + 1} of ${SCENES.length}`}>
                {SCENES.map((x, i) => (
                  <button key={x.title} type="button" className={i === scene ? 'is-on' : ''} aria-label={`Go to scene ${i + 1}: ${x.title}`} onClick={() => setScene(i)} />
                ))}
              </div>
              <div className="intro-buttons">
                <button type="button" onClick={() => setScene((i) => Math.max(0, i - 1))} disabled={scene === 0}>← Back</button>
                <button type="button" onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
                <button type="button" onClick={() => setScene((i) => Math.min(LAST, i + 1))} disabled={last}>Next →</button>
                {(canSpeak || RECORDED_AUDIO) && (
                  <button type="button" onClick={() => setVoice((v) => !v)} aria-pressed={voice}>{voice ? '🔊 Voice on' : '🔇 Voice off'}</button>
                )}
                {canSpeak && !RECORDED_AUDIO && (
                  <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>⚙ Voice settings</button>
                )}
              </div>
            </div>
            {settingsOpen && canSpeak && (
              <div className="intro-voice-settings">
                <label>
                  <span>Voice</span>
                  <select value={voiceSettings.voiceURI ?? ''} onChange={(e) => updateVoice({ voiceURI: e.target.value || undefined })}>
                    <option value="">Automatic: the most natural voice on this device</option>
                    {voices.filter((v) => /^en/i.test(v.lang)).sort((a, b) => rankVoice(b) - rankVoice(a)).map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>{NATURAL.test(v.name) ? '★ ' : ''}{v.name} ({v.lang})</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Speed: {voiceSettings.rate.toFixed(2)}×</span>
                  <input type="range" min={0.75} max={1.25} step={0.05} value={voiceSettings.rate} onChange={(e) => updateVoice({ rate: Number(e.target.value) })} />
                </label>
                <label>
                  <span>Pitch: {voiceSettings.pitch.toFixed(2)}</span>
                  <input type="range" min={0.8} max={1.2} step={0.05} value={voiceSettings.pitch} onChange={(e) => updateVoice({ pitch: Number(e.target.value) })} />
                </label>
                <div className="intro-voice-actions">
                  <button type="button" onClick={() => { stop(); setPlaying(false); speak("Kia ora, I'm Penny. Is this voice good for you?", run.current, () => setTalking(false)); setTalking(true); }}>▶ Test voice</button>
                  <button type="button" onClick={() => { try { window.localStorage.removeItem(VOICE_KEY); } catch { /* ignore */ } setVoiceSettings(DEFAULT_VOICE); }}>Reset</button>
                </div>
                <p>
                  ★ marks voices that usually sound most natural. Voices come from your device and browser, so the choice differs
                  between computers and phones. Microsoft Edge and Chrome offer the most natural-sounding voices.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
