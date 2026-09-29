/**
 * The library's collections. Each one is a folder under data/corpus/, and its
 * id is stored on every chunk so the search tool can filter by collection.
 * Shared by the seed script, the chat route and the UI.
 */
export const COLLECTIONS = [
  { id: 'Library_Notes', label: 'Library notes', description: 'Plain-English explainers written for this library: compounding, withdrawal rates, allocation, currency, ETF domicile, behaviour, mortgage vs investing' },
  { id: 'Books', label: 'Books', description: 'Investing books you hold a licence to use' },
  { id: 'ETF_Factsheets', label: 'ETF factsheets', description: 'Issuer factsheets and fund documents: fees, holdings, domicile, index tracked' },
  { id: 'Berkshire_Letters', label: 'Berkshire letters', description: 'Berkshire Hathaway annual shareholder letters' },
  { id: 'Vanguard_Whitepapers', label: 'Vanguard research', description: 'Vanguard research papers on allocation, costs and behaviour' },
  { id: 'MSCI_Methodologies', label: 'MSCI methodologies', description: 'How MSCI indexes are built and weighted' },
  { id: 'NZX_Guides', label: 'NZX guides', description: 'NZX investor guides for the New Zealand share market' },
  { id: 'KiwiSaver_Guides', label: 'KiwiSaver', description: 'KiwiSaver fund types, contribution rates and government contributions' },
  { id: 'Australia_Guides', label: 'Australia', description: 'Australian superannuation, ETF and investment-platform information' },
  { id: 'FIF_Tax_Guides', label: 'FIF tax', description: 'NZ foreign investment fund (FIF) tax rules, de minimis threshold, FDR and CV methods' },
] as const;

export type CollectionId = (typeof COLLECTIONS)[number]['id'];

export const COLLECTION_IDS = COLLECTIONS.map((c) => c.id) as [CollectionId, ...CollectionId[]];

export const collectionLabel = (id: string) => COLLECTIONS.find((c) => c.id === id)?.label ?? id;

/** Upstash Vector namespace for this library (kept separate from the old Acme index). */
export const VECTOR_NAMESPACE = 'investment-research-library';
