import type { Metadata } from 'next';
import SiteHeader from '../../components/SiteHeader';
import { sourcesRegister } from '../../lib/sources';
import { COUNTRIES, isCountry } from '../../lib/countries';

export const metadata: Metadata = { title: 'Sources · Investment Research Library' };
export const dynamic = 'force-dynamic';

const STATUS = { current: 'Current', 'due-soon': 'Review due soon', overdue: 'Review overdue', undated: 'No date' } as const;

export default function SourcesPage() {
  const sources = sourcesRegister();
  return (
    <div className="page-shell">
      <SiteHeader current="sources" />
      <main className="page-main prose-page">
        <h1 className="page-title">Sources</h1>
        <p className="page-lede">
          Every document the library answers from, with where it comes from, the date its facts were checked, and when
          it is next due for review. Rules change, so check the linked official source before you act.
        </p>
        <div className="table-scroll">
          <table className="milestone-table sources-table">
            <thead>
              <tr>
                <th scope="col">Document</th><th scope="col">Country</th><th scope="col">Facts checked</th>
                <th scope="col">Next review</th><th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.path} className={`is-${s.status}`}>
                  <th scope="row">
                    {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                    <small className="lever-detail">{s.publisher}{s.publisher && ', '}licence: {s.licence}</small>
                  </th>
                  <td>{isCountry(s.country) ? COUNTRIES[s.country].name : 'All countries'}</td>
                  <td>{s.asOf || '—'}</td>
                  <td>{s.reviewDue || '—'}</td>
                  <td>{STATUS[s.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="page-small">
          Review schedule: documents about rules that are changing are reviewed every 3 months, country-specific guides
          every 6 months, and general investing notes every 12 months.
        </p>
      </main>
    </div>
  );
}
