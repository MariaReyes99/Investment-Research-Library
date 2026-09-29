/**
 * Seed the Investment Research Library into its Upstash Vector namespace.
 *
 * Layout:  data/corpus/<Collection>/<file>   (collections: lib/collections.ts)
 * Formats: .md (split at headings), .txt, .html, .pdf (per page), .epub (per chapter)
 *
 * Licence check (copyright guardrail)
 * ------------------------------------
 * Every file must have an entry in data/corpus/sources.json, keyed by its path
 * relative to data/corpus, e.g.
 *
 *   "FIF_Tax_Guides/ird-fif-exemptions.pdf": {
 *     "title": "IRD - Foreign investment fund rules exemptions",
 *     "url": "https://www.ird.govt.nz/...",
 *     "licence": "cc-by",
 *     "asOf": "2026-09-29"
 *   }
 *
 * licence is one of: own-content, public-domain, cc-by, permission-granted,
 * licensed, personal-study-only. Files that are missing from the manifest or
 * marked personal-study-only are NOT uploaded, because this index powers a
 * public, paid site. For private local testing only, you can override that
 * with --include-unlicensed and a separate namespace (--namespace=private).
 *
 * Usage:
 *   npm run seed                      embed and upload
 *   npm run seed -- --dry-run         chunk statistics only (no API calls)
 */
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

// Next.js reads .env.local automatically; this script does not.
loadEnv({ path: path.join(process.cwd(), '.env.local') });
import { Index } from '@upstash/vector';
import { embedMany } from 'ai';
import JSZip from 'jszip';
import { createOpenAIProvider } from './openai';
import { COLLECTIONS, VECTOR_NAMESPACE, type CollectionId } from './collections';

const CORPUS_PATH = path.join(process.cwd(), 'data', 'corpus');
const MANIFEST_PATH = path.join(CORPUS_PATH, 'sources.json');
const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_UNLICENSED = process.argv.includes('--include-unlicensed');
const NAMESPACE = process.argv.find((a) => a.startsWith('--namespace='))?.split('=')[1] ?? VECTOR_NAMESPACE;

const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 250;
const MIN_SECTION_CHARS = 80;
const ID_PREFIX = 'irl_';

const LICENCES = ['own-content', 'public-domain', 'cc-by', 'permission-granted', 'licensed', 'personal-study-only'] as const;
type Licence = (typeof LICENCES)[number];
type ManifestEntry = { title?: string; url?: string; licence: Licence; asOf?: string; publisher?: string };

type Chunk = {
  text: string;
  source: string; // file name shown in citations
  document: string; // human-readable title
  section: string;
  collection: CollectionId;
  url: string;
  asOf: string;
  licence: Licence;
  chunk: number;
};
type Meta = Omit<Chunk, 'text' | 'section' | 'chunk'>;
type Section = { section: string; text: string };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function splitLongText(text: string, size: number, overlap: number): string[] {
  const pieces: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      // Try to end on a sentence boundary shortly after the size limit.
      const m = text.slice(end, end + 300).match(/[.!?]\s/);
      if (m && m.index !== undefined) end += m.index + 1;
    }
    const piece = text.slice(i, end).trim();
    if (piece) pieces.push(piece);
    if (end >= text.length) break;
    i = end - overlap;
    const nextSpace = text.slice(i).search(/\s/);
    if (nextSpace > 0 && nextSpace < 40) i += nextSpace + 1;
  }
  return pieces;
}

/** Collect sections, merging very short ones into the following section. */
function buildChunks(sections: Section[], meta: Meta): Chunk[] {
  const chunks: Chunk[] = [];
  let carry = '';
  sections.forEach(({ section, text }, idx) => {
    const combined = [carry, text.trim()].filter(Boolean).join('\n\n');
    if (!combined) return;
    if (combined.length < MIN_SECTION_CHARS && idx !== sections.length - 1) {
      carry = combined;
      return;
    }
    carry = '';
    for (const piece of splitLongText(combined, CHUNK_SIZE, CHUNK_OVERLAP)) {
      chunks.push({ ...meta, section, text: piece, chunk: 0 });
    }
  });
  return chunks.map((c, i) => ({ ...c, chunk: i + 1 }));
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

const firstHeading = (html: string) =>
  html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1].replace(/<[^>]+>/g, '').trim() ||
  html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim();

// ---------------------------------------------------------------------------
// Readers, one per format
// ---------------------------------------------------------------------------

function readMarkdown(markdown: string, fallbackTitle: string): { title: string; sections: Section[] } {
  const sections: Section[] = [];
  let title = fallbackTitle;
  let section = fallbackTitle;
  let lines: string[] = [];
  const flush = () => {
    sections.push({ section, text: lines.join('\n') });
    lines = [];
  };
  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      section = heading[2].trim();
      if (heading[1] === '#' && title === fallbackTitle) title = section;
    } else {
      lines.push(line);
    }
  }
  flush();
  return { title, sections };
}

async function readPdf(buf: Buffer): Promise<Section[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ section: `p. ${i + 1}`, text: t.replace(/[ \t]+/g, ' ') }));
}

async function readEpub(buf: Buffer): Promise<{ title?: string; sections: Section[] }> {
  const zip = await JSZip.loadAsync(buf);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('Not a valid EPUB (no OPF package file).');
  const opf = (await zip.file(opfPath)?.async('string')) ?? '';
  const base = path.posix.dirname(opfPath);
  const title = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1].trim();

  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = m[0].match(/\bid="([^"]+)"/)?.[1];
    const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => m[1]);

  const sections: Section[] = [];
  let n = 0;
  for (const id of spine) {
    const href = manifest.get(id);
    if (!href) continue;
    const html = await zip.file(path.posix.join(base === '.' ? '' : base, href))?.async('string');
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < 40) continue;
    n++;
    sections.push({ section: firstHeading(html) ?? `Chapter ${n}`, text });
  }
  return { title, sections };
}

// ---------------------------------------------------------------------------
// Load everything
// ---------------------------------------------------------------------------

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (/\.(md|txt|html?|pdf|epub)$/i.test(entry.name)) files.push(full);
  }
  return files.sort();
}

async function loadManifest(): Promise<Record<string, ManifestEntry>> {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    console.warn('⚠ No data/corpus/sources.json found; every file will be treated as unlicensed.');
    return {};
  }
}

async function loadCorpus(): Promise<{ chunks: Chunk[]; skipped: string[] }> {
  const manifest = await loadManifest();
  const chunks: Chunk[] = [];
  const skipped: string[] = [];

  for (const { id: collection } of COLLECTIONS) {
    for (const file of await listFiles(path.join(CORPUS_PATH, collection))) {
      const rel = path.relative(CORPUS_PATH, file).split(path.sep).join('/');
      const entry = manifest[rel];
      const allowed = entry && LICENCES.includes(entry.licence) && entry.licence !== 'personal-study-only';
      if (!allowed && !INCLUDE_UNLICENSED) {
        skipped.push(`${rel}  (${entry ? `licence: ${entry.licence}` : 'not in sources.json'})`);
        continue;
      }

      const name = path.basename(file);
      const ext = path.extname(name).toLowerCase();
      const fallbackTitle = entry?.title ?? path.parse(name).name.replace(/[_-]+/g, ' ');
      const buf = await fs.readFile(file);

      let title = fallbackTitle;
      let sections: Section[];
      if (ext === '.md') {
        const md = readMarkdown(buf.toString('utf8'), fallbackTitle);
        title = entry?.title ?? md.title;
        sections = md.sections;
      } else if (ext === '.pdf') {
        sections = await readPdf(buf);
      } else if (ext === '.epub') {
        const book = await readEpub(buf);
        title = entry?.title ?? book.title ?? fallbackTitle;
        sections = book.sections;
      } else if (ext === '.html' || ext === '.htm') {
        const html = buf.toString('utf8');
        title = entry?.title ?? firstHeading(html) ?? fallbackTitle;
        sections = [{ section: title, text: htmlToText(html) }];
      } else {
        sections = buf
          .toString('utf8')
          .split(/\n\s*\n/)
          .map((text, i) => ({ section: `Part ${i + 1}`, text }));
      }

      chunks.push(
        ...buildChunks(sections, {
          source: name,
          document: title,
          collection,
          url: entry?.url ?? '',
          asOf: entry?.asOf ?? '',
          licence: entry?.licence ?? 'personal-study-only',
        }),
      );
    }
  }
  return { chunks, skipped };
}

function printStats(chunks: Chunk[], skipped: string[]) {
  const byFile = new Map<string, Chunk[]>();
  for (const c of chunks) byFile.set(`${c.collection}/${c.source}`, [...(byFile.get(`${c.collection}/${c.source}`) ?? []), c]);
  console.log('\nFile                                                        Chunks  Avg chars');
  for (const [file, list] of byFile) {
    const avg = Math.round(list.reduce((a, c) => a + c.text.length, 0) / list.length);
    console.log(`${file.padEnd(60)}${String(list.length).padStart(6)}${String(avg).padStart(11)}`);
  }
  console.log(`\nTotal: ${chunks.length} chunks from ${byFile.size} files`);
  if (skipped.length) {
    console.log(`\n⚠ Skipped ${skipped.length} file(s) without a publishable licence in sources.json:`);
    for (const s of skipped) console.log(`   - ${s}`);
  }
  console.log();
}

async function main() {
  console.log(`Loading and chunking files from ${CORPUS_PATH}…`);
  const { chunks, skipped } = await loadCorpus();
  printStats(chunks, skipped);
  if (chunks.length === 0) throw new Error('No publishable documents found. Add files and entries in data/corpus/sources.json.');

  if (DRY_RUN) {
    for (const c of chunks.slice(0, 2)) console.log(`--- ${c.source} | ${c.section} (${c.text.length} chars)\n${c.text.slice(0, 240)}…\n`);
    console.log('Dry run only: nothing was embedded or uploaded.');
    return;
  }
  if (INCLUDE_UNLICENSED && NAMESPACE === VECTOR_NAMESPACE) {
    throw new Error('--include-unlicensed must be used with a private namespace, e.g. --namespace=private, never the public one.');
  }
  if (!process.env.UPSTASH_VECTOR_REST_URL || !process.env.UPSTASH_VECTOR_REST_TOKEN) {
    throw new Error('Missing UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN. Set them in .env.local.');
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY in .env.local.');

  console.log('Embedding…');
  const openai = createOpenAIProvider();
  const { embeddings } = await embedMany({
    model: openai.embedding(process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'),
    // Prepend the title and section so each vector carries its topic.
    values: chunks.map((c) => `${c.document} — ${c.section}\n${c.text}`),
  });

  const index = new Index().namespace(NAMESPACE);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const records = chunks.map((c, i) => ({
    id: `${ID_PREFIX}${slug(c.collection)}_${slug(path.parse(c.source).name)}_${c.chunk}`,
    vector: embeddings[i],
    metadata: {
      text: c.text,
      source: c.source,
      document: c.document,
      section: c.section,
      collection: c.collection,
      url: c.url,
      asOf: c.asOf,
      licence: c.licence,
    },
  }));

  await index.delete({ prefix: ID_PREFIX });
  console.log(`Upserting ${records.length} chunks to Upstash Vector (namespace "${NAMESPACE}")…`);
  const BATCH = 100;
  for (let i = 0; i < records.length; i += BATCH) await index.upsert(records.slice(i, i + BATCH));
  console.log('✅ Done. Run `npm run dev` and open http://localhost:3000');
}

main().catch((error: unknown) => {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
  if (typeof statusCode === 'number') {
    console.error(`Seeding failed with HTTP ${statusCode}. Check your API key and OPENAI_BASE_URL.`);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('Seeding failed. Check the environment configuration and the files in data/corpus.');
  }
  process.exit(1);
});
