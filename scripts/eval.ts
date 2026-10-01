/**
 * npm run eval
 *
 * Re-runs the question set in tests/eval/questions.json against the chat API
 * and checks each answer: which tools were used and how often, key numbers
 * passed to the tools, citations, and wording that must or must not appear.
 * Run it after every change to the prompt, tools or corpus.
 *
 *   npm run dev            (in one terminal; leave ENFORCE_LIMITS unset)
 *   npm run eval           (in another)
 *   EVAL_URL=https://your-site.vercel.app npm run eval    (a deployed site; uses questions)
 *
 * Results are saved to tests/eval/last-run.json.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

type Expect = {
  tools?: string[];
  anyTool?: string[];
  noTools?: boolean;
  maxCalls?: Record<string, number>;
  toolArgs?: { tool: string; path: string; equals: unknown }[];
  mustCite?: boolean;
  mustInclude?: string[];
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
};
type Case = { id: string; country: string; retireIn?: string; history?: unknown[]; plan?: unknown; question: string; expect: Expect };
type ToolCall = { toolName: string; args: Record<string, unknown> };

const BASE = (process.env.EVAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

/** Reads the AI SDK data stream: 0: text parts, 9: tool calls, 3: errors. */
function parseStream(body: string) {
  let text = '';
  const calls: ToolCall[] = [];
  const errors: string[] = [];
  for (const line of body.split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const kind = line.slice(0, i);
    let value: unknown;
    try {
      value = JSON.parse(line.slice(i + 1));
    } catch {
      continue;
    }
    if (kind === '0' && typeof value === 'string') text += value;
    else if (kind === '9') calls.push(value as ToolCall);
    else if (kind === '3') errors.push(String(value));
  }
  return { text, calls, errors };
}

const get = (obj: unknown, p: string) => p.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);

function check(c: Case, text: string, calls: ToolCall[]): string[] {
  const e = c.expect;
  const lower = text.toLowerCase();
  const used = calls.map((x) => x.toolName);
  const fails: string[] = [];
  for (const t of e.tools ?? []) if (!used.includes(t)) fails.push(`expected tool ${t}`);
  if (e.anyTool && !e.anyTool.some((t) => used.includes(t))) fails.push(`expected one of ${e.anyTool.join(', ')}`);
  if (e.noTools && used.length) fails.push(`expected no tools, got ${used.join(', ')}`);
  for (const [t, max] of Object.entries(e.maxCalls ?? {})) {
    const n = used.filter((u) => u === t).length;
    if (n > max) fails.push(`${t} called ${n} times (max ${max})`);
  }
  for (const a of e.toolArgs ?? []) {
    const call = calls.find((x) => x.toolName === a.tool);
    const actual = call ? get(call.args, a.path) : undefined;
    if (actual !== a.equals) fails.push(`${a.tool}.${a.path} was ${JSON.stringify(actual)}, expected ${JSON.stringify(a.equals)}`);
  }
  if (e.mustCite && !/\[[^\]]+\]/.test(text)) fails.push('no citation in square brackets');
  for (const s of e.mustInclude ?? []) if (!lower.includes(s.toLowerCase())) fails.push(`missing "${s}"`);
  if (e.mustIncludeAny && !e.mustIncludeAny.some((s) => lower.includes(s.toLowerCase()))) fails.push(`missing any of ${e.mustIncludeAny.map((s) => `"${s}"`).join(', ')}`);
  for (const s of e.mustNotInclude ?? []) if (lower.includes(s.toLowerCase())) fails.push(`contains "${s}"`);
  return fails;
}

async function main() {
  const file = path.join(process.cwd(), 'tests', 'eval', 'questions.json');
  const cases = (JSON.parse(await fs.readFile(file, 'utf8')) as Case[]).filter((c) => !only || c.id === only);
  console.log(`Running ${cases.length} questions against ${BASE}\n`);
  const results = [];
  let failed = 0;
  for (const c of cases) {
    const started = Date.now();
    let status = 0;
    let body = '';
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...(c.history ?? []), { role: 'user', content: c.question }], country: c.country, retireIn: c.retireIn, plan: c.plan }),
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      body = String(err);
    }
    const { text, calls, errors } = parseStream(body);
    const fails = status !== 200 ? [`HTTP ${status}: ${body.slice(0, 160)}`] : [...errors.map((x) => `stream error: ${x}`), ...check(c, text, calls)];
    if (fails.length) failed++;
    const ms = Date.now() - started;
    console.log(`${fails.length ? 'FAIL' : 'pass'}  ${c.id}  (${(ms / 1000).toFixed(1)}s, tools: ${calls.map((x) => x.toolName).join(', ') || 'none'})`);
    for (const f of fails) console.log(`      - ${f}`);
    results.push({ id: c.id, country: c.country, passed: !fails.length, fails, tools: calls.map((x) => x.toolName), ms, answer: text });
    if (status === 429) console.log('      (Question limit hit: remove ENFORCE_LIMITS from .env.local and restart npm run dev.)');
  }
  await fs.writeFile(path.join(process.cwd(), 'tests', 'eval', 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
  console.log(`\n${cases.length - failed} of ${cases.length} passed. Details: tests/eval/last-run.json`);
  process.exit(failed ? 1 : 0);
}

main();
