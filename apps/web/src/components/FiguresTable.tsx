import { formatMoney, formatRate } from '../lib/format';
import type { Figures } from '../lib/types';

/** One place that names each headline figure, so reports, close and snapshots read the same. */
export const FIGURE_ROWS: Array<{ key: string; label: string; hint?: string; kind?: 'count' | 'rate'; strong?: boolean }> = [
  { key: 'activePupils', label: 'Active pupils', kind: 'count' },
  { key: 'pupilsBilled', label: 'Pupils billed', hint: 'Each pupil with a charge in the period, counted once', kind: 'count' },
  { key: 'grossBilled', label: 'Gross billed (before discounts)' },
  { key: 'totalDiscounts', label: 'Approved discounts' },
  { key: 'totalBilled', label: 'Total billed', hint: 'Net of discounts, excluding arrears brought forward', strong: true },
  { key: 'arrearsBroughtForward', label: 'Arrears brought forward' },
  { key: 'collectedOnCurrent', label: 'Collected on this term’s fees' },
  { key: 'collectedOnArrears', label: 'Collected on arrears' },
  { key: 'totalCollected', label: 'Total collected', strong: true },
  { key: 'carriedForwardOut', label: 'Carried forward to a later term' },
  { key: 'outstanding', label: 'Outstanding (still owed)', strong: true },
  { key: 'credits', label: 'Credits held (overpayments)' },
  { key: 'collectionRate', label: 'Collection rate', hint: 'Collected on this term’s fees ÷ total billed', kind: 'rate', strong: true },
  { key: 'schoolFundedExpenses', label: 'Expenses paid from school funds' },
  { key: 'ownerFundedExpenses', label: 'Expenses paid by the owner' },
  { key: 'otherFundedExpenses', label: 'Expenses from other funding' },
  { key: 'totalExpenses', label: 'Total expenses', strong: true },
  { key: 'netResult', label: 'Net result', hint: 'Total collected − total expenses. Owner contributions and loans are not income.', strong: true },
];

export function FiguresTable({ figures, compare }: { figures: Figures; compare?: Figures }) {
  const fmt = (row: (typeof FIGURE_ROWS)[number], v: Figures[string] | undefined) =>
    v === undefined ? '' : row.kind === 'count' ? String(v ?? '') : row.kind === 'rate' ? formatRate(v as string | null) : formatMoney(v as string);
  return (
    <table className="table">
      <thead><tr><th>Figure</th><th className="num">Amount (UGX)</th>{compare && <th className="num">Live now</th>}</tr></thead>
      <tbody>
        {FIGURE_ROWS.filter((r) => figures[r.key] !== undefined).map((r) => {
          const changed = compare && fmt(r, compare[r.key]) !== fmt(r, figures[r.key]);
          return (
            <tr key={r.key} className={r.strong ? 'font-semibold' : ''}>
              <td className="whitespace-normal">{r.label}{r.hint && <span className="block text-xs font-normal text-slate-500">{r.hint}</span>}</td>
              <td className="num">{fmt(r, figures[r.key])}</td>
              {compare && <td className={`num ${changed ? 'bg-amber-50 text-amber-900' : 'text-slate-500'}`}>{fmt(r, compare[r.key])}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
