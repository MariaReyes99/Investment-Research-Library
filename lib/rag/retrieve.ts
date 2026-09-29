/**
 * Retrieval adapter. If the ACME app already has a retrieve/search function,
 * replace the body of retrieve() with a call to it and map its results to
 * RetrievedChunk. This default version queries Upstash Vector directly.
 *
 * Expected metadata on each vector (set when you ingest documents):
 *   { title, section, text, url, collection, licence }
 * collection = Books | ETF_Factsheets | Berkshire_Letters | Vanguard_Whitepapers |
 *              MSCI_Methodologies | NZX_Guides | KiwiSaver_Guides | FIF_Tax_Guides
 */
import { Index } from "@upstash/vector";
import OpenAI from "openai";

export interface RetrievedChunk {
  text: string;
  title: string;
  section?: string;
  url?: string;
  collection?: string;
  score: number;
}

const index = new Index(); // UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN
const openai = new OpenAI();

export async function retrieve(
  query: string,
  opts: { topK?: number; collections?: string[] } = {},
): Promise<RetrievedChunk[]> {
  const emb = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    input: query,
  });

  const filter = opts.collections?.length
    ? opts.collections.map((c) => `collection = '${c.replace(/'/g, "")}'`).join(" OR ")
    : undefined;

  const results = await index.query<Record<string, string>>({
    vector: emb.data[0].embedding,
    topK: opts.topK ?? 6,
    includeMetadata: true,
    filter,
  });

  return results
    .filter((r) => r.metadata?.text && r.score > 0.3)
    .map((r) => ({
      text: r.metadata!.text,
      title: r.metadata!.title ?? "Untitled",
      section: r.metadata!.section,
      url: r.metadata!.url,
      collection: r.metadata!.collection,
      score: r.score,
    }));
}
