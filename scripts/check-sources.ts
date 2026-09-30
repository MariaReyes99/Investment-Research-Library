/**
 * npm run check:sources
 * Lists every library document with its review date. Exits with an error if
 * any review is overdue, so it can run before each deploy.
 */
import { sourcesRegister } from '../lib/sources';

const rows = sourcesRegister();
const width = Math.max(...rows.map((r) => r.title.length), 20);
console.log(`${'Document'.padEnd(width)}  Country  Checked     Review due  Status`);
for (const r of rows) {
  console.log(`${r.title.padEnd(width)}  ${r.country.padEnd(7)}  ${(r.asOf || '-').padEnd(10)}  ${(r.reviewDue || '-').padEnd(10)}  ${r.status}`);
}
const overdue = rows.filter((r) => r.status === 'overdue' || r.status === 'undated');
if (overdue.length) {
  console.error(`\n${overdue.length} document(s) need review: update the facts, then the asOf date in data/corpus/sources.json.`);
  process.exit(1);
}
console.log(`\nAll ${rows.length} documents are within their review dates.`);
