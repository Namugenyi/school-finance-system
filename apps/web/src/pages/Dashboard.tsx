import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatMoney, formatRate } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, Notice, PageHeader, Stat, StatusBadge } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import { AXIS, GRID, SERIES, compactUGX } from '../components/charts';
import type { Figures } from '../lib/types';

interface Dashboard {
  term: { id: number | null; label: string; status: string | null };
  year: { id: number; year: number };
  figures: Figures;
  byClass: Array<{ classId: number; className: string; totalBilled: string; totalCollected: string; outstanding: string; collectionRate: string | null; status: string }>;
  expensesByCategory: Array<{ categoryLabel: string; schoolFunded: string; ownerFunded: string; otherFunded: string; total: string; share: string | null }>;
  weeklyCollections: Array<{ week: string; amount: string }>;
  termsTrend: Array<{ termLabel: string; totalBilled: string; totalCollected: string; outstanding: string }>;
  pendingApprovals: Record<string, number>;
}

const n = (v: unknown) => Number(v ?? 0);
const CLASS_STATUS: Record<string, { label: string; cls: string }> = {
  ALL_PAID: { label: 'All paid', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-100 text-amber-900 ring-amber-600/30' },
  NONE_PAID: { label: 'None paid', cls: 'bg-red-100 text-red-800 ring-red-600/20' },
  NO_DATA: { label: 'No data', cls: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
};
const tip = (v: number) => `UGX ${formatMoney(v)}`;

const d_isYear = (v: string) => v.startsWith('y:');

export function DashboardPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const scope = scopeParams(term);
  const q = useQuery({ queryKey: ['dashboard', scope.termId, scope.academicYearId], queryFn: () => api.get<Dashboard>(`/dashboard${qs(scope)}`), enabled: !!(scope.termId || scope.academicYearId) });
  const wholeYear = !!d_isYear(term);
  const d = q.data;
  const f = d?.figures;
  const net = n(f?.netResult);
  const pending = d ? Object.values(d.pendingApprovals).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={d ? <>Headline figures for <strong>{d.term.label}</strong> {d.term.status && <StatusBadge status={d.term.status} />}</> : 'Headline figures for a term or a whole year'}
        actions={<TermSelect value={term} onChange={setTerm} allowYear className="w-56" />}
      />
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {f && d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Active pupils" value={f.activePupils ?? 'n/a'} hint={`${f.pupilsBilled ?? 0} billed ${wholeYear ? 'this year' : 'this term'}`} />
            <Stat label="Total billed" value={formatMoney(f.totalBilled as string)} hint="After approved discounts" />
            <Stat label="Total collected" value={formatMoney(f.totalCollected as string)} />
            <Stat label="Outstanding" value={formatMoney(f.outstanding as string)} tone={n(f.outstanding) > 0 ? 'bad' : 'good'} hint={n(f.arrearsBroughtForward) > 0 ? `Includes arrears brought forward of ${formatMoney(f.arrearsBroughtForward as string)}` : undefined} />
            <Stat label="Collection rate" value={formatRate(f.collectionRate as string | null)} hint={wholeYear ? "Collected on this year's billing ÷ billed" : "Collected on this term's billing ÷ billed"} />
            <Stat label="Total expenses" value={formatMoney(f.totalExpenses as string)} />
            <Stat label="School-funded" value={formatMoney(f.schoolFundedExpenses as string)} />
            <Stat label="Owner-funded" value={formatMoney(f.ownerFundedExpenses as string)} hint="Owner contributions and loans" />
            <Stat label="Other-funded" value={formatMoney(f.otherFundedExpenses as string)} hint="Donations and other" />
            <Stat
              label={net < 0 ? 'Net deficit' : 'Net surplus'}
              value={<>{net < 0 ? '▼ ' : '▲ '}{formatMoney(Math.abs(net))}</>}
              tone={net < 0 ? 'bad' : 'good'}
              hint="Collected − expenses (cash basis)"
            />
          </div>

          {pending > 0 && can('approvals.view') && (
            <Notice tone="warning">
              {pending} item{pending === 1 ? '' : 's'} waiting for approval. <Link to="/approvals" className="link">Open approvals</Link>
            </Notice>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={`Billed and collected by term, ${d.year.year}`}>
              {d.termsTrend.every((t) => n(t.totalBilled) === 0 && n(t.totalCollected) === 0) ? (
                <Empty title="Nothing billed yet this year" />
              ) : (
                <div className="h-64" role="img" aria-label="Bar chart of billed and collected amounts for each term">
                  <ResponsiveContainer>
                    <BarChart data={d.termsTrend.map((t) => ({ name: t.termLabel.replace(/ \d{4}$/, ''), Billed: n(t.totalBilled), Collected: n(t.totalCollected) }))} barGap={2}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="name" tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} />
                      <YAxis tickFormatter={compactUGX} tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} width={48} />
                      <Tooltip formatter={tip} cursor={{ fill: '#f1f5f9' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Billed" fill={SERIES.s1} radius={[4, 4, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="Collected" fill={SERIES.s2} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title={wholeYear ? `Cash collected per week, ${d.year.year}` : 'Cash collected per week this term'}>
              {d.weeklyCollections.length === 0 ? (
                <Empty title={wholeYear ? 'No payments recorded for this year yet' : 'No payments recorded for this term yet'} />
              ) : (
                <div className="h-64" role="img" aria-label="Line chart of money collected each week">
                  <ResponsiveContainer>
                    <LineChart data={d.weeklyCollections.map((w) => ({ week: formatDate(w.week).slice(0, 5), Collected: n(w.amount) }))}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="week" tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} />
                      <YAxis tickFormatter={compactUGX} tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} width={48} />
                      <Tooltip formatter={tip} labelFormatter={(l) => `Week of ${l}`} />
                      <Line type="monotone" dataKey="Collected" stroke={SERIES.s1} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Outstanding by class" padded={false} className="lg:col-span-2">
              {d.byClass.length === 0 ? (
                <div className="p-4"><Empty title={wholeYear ? 'No charges in this year' : 'No charges in this term'} /></div>
              ) : (
                <div className="overflow-x-auto">
                <table className="table">
                  {can('arrears.view') && <caption className="caption-bottom px-3 py-2 text-left text-xs text-slate-500">Choose a class to see the pupils in it who still owe for {wholeYear ? 'this year' : 'this term'}.</caption>}
                  <thead><tr><th>Class</th><th className="num">Billed</th><th className="num">Collected</th><th className="num">Outstanding</th><th className="num">Rate</th></tr></thead>
                  <tbody>
                    {d.byClass.map((c) => {
                      const to = `/arrears${qs({ term: term, classId: c.classId })}`;
                      return (
                      <tr key={c.classId}
                        className={can('arrears.view') ? 'cursor-pointer hover:!bg-cream-100' : undefined}
                        onClick={can('arrears.view') ? (e) => { if (!(e.target as HTMLElement).closest('a')) navigate(to); } : undefined}>
                        <td className="font-medium">
                          {can('arrears.view')
                            ? <Link to={to} className="link inline-flex items-center gap-1" aria-label={`${c.className}: see pupils who owe for ${wholeYear ? 'this year' : 'this term'}`}>{c.className}<span aria-hidden className="text-slate-400">›</span></Link>
                            : c.className}
                          <span className={`mt-1 flex w-fit whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${CLASS_STATUS[c.status]?.cls ?? ''}`}>{CLASS_STATUS[c.status]?.label ?? c.status}</span>
                        </td>
                        <td className="num">{formatMoney(c.totalBilled)}</td>
                        <td className="num">{formatMoney(c.totalCollected)}</td>
                        <td className={`num ${n(c.outstanding) > 0 ? 'font-medium text-red-700' : ''}`}>{formatMoney(c.outstanding)}</td>
                        <td className="num">{formatRate(c.collectionRate)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </Card>

            <Card title="Expenses by category and funding" className="lg:col-span-2">
              {d.expensesByCategory.length === 0 ? (
                <Empty title={wholeYear ? 'No approved expenses in this year' : 'No approved expenses in this term'} />
              ) : (
                <div style={{ height: Math.max(220, d.expensesByCategory.length * 34 + 60) }} role="img" aria-label="Stacked bar chart of expenses by category, split by funding source">
                  <ResponsiveContainer>
                    <BarChart layout="vertical" data={d.expensesByCategory.map((e) => ({ name: e.categoryLabel, School: n(e.schoolFunded), Owner: n(e.ownerFunded), Other: n(e.otherFunded) }))} margin={{ left: 16 }}>
                      <CartesianGrid horizontal={false} stroke={GRID} />
                      <XAxis type="number" tickFormatter={compactUGX} tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} />
                      <Tooltip formatter={tip} cursor={{ fill: '#f1f5f9' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => `${v}-funded`} />
                      <Bar dataKey="School" stackId="a" fill={SERIES.s1} stroke="#fff" strokeWidth={2} maxBarSize={20} />
                      <Bar dataKey="Owner" stackId="a" fill={SERIES.s2} stroke="#fff" strokeWidth={2} maxBarSize={20} />
                      <Bar dataKey="Other" stackId="a" fill={SERIES.s3} stroke="#fff" strokeWidth={2} maxBarSize={20} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {d.expensesByCategory.length > 0 && (
                <table className="table mt-3">
                  <thead><tr><th>Category</th><th className="num">Amount</th><th className="num">Share of total</th></tr></thead>
                  <tbody>
                    {d.expensesByCategory.map((e) => (
                      <tr key={e.categoryLabel}><td>{e.categoryLabel}</td><td className="num">{formatMoney(e.total)}</td><td className="num">{formatRate(e.share)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="font-semibold"><td>Total</td><td className="num">{formatMoney(f.totalExpenses as string)}</td><td className="num">100%</td></tr></tfoot>
                </table>
              )}
            </Card>
          </div>
          <p className="text-xs text-slate-500">Cash basis. Fee income counts in the term of the charge it pays. Owner loans and cash contributions are funding, not income. This is not a general ledger.</p>
        </div>
      )}
    </div>
  );
}
