import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadUrl, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { formatMoney, formatRate, todayIso } from '../lib/format';
import { Button, Card, DateInput, Empty, ErrorBox, Loading, PageHeader, Select, StatusBadge, TableWrap, Tabs } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import { FiguresTable } from '../components/FiguresTable';
import { AXIS, GRID, SERIES, compactUGX } from '../components/charts';
import type { Figures } from '../lib/types';

const M = ({ v, strong }: { v: string | number | null | undefined; strong?: boolean }) => <td className={`num ${strong ? 'font-semibold' : ''}`}>{formatMoney(v)}</td>;

function useReport<T>(path: string, params: Record<string, string | number | undefined>, enabled = true) {
  return useQuery({ queryKey: ['report', path, params], queryFn: () => api.get<T>(`/reports/${path}${qs(params)}`), enabled });
}

function Section({ title, csv, children, q }: { title: string; csv?: string; children: ReactNode; q: { isLoading: boolean; error: unknown } }) {
  return (
    <Card title={title} padded={false} actions={<>
      <Button variant="secondary" onClick={() => window.print()}>Print</Button>
      {csv && <Button variant="secondary" onClick={() => downloadUrl(csv)}>Export CSV</Button>}
    </>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : children}
    </Card>
  );
}

export function ReportsPage() {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const [tab, setTab] = useState('summary');
  const [scope, setScope] = useState('');
  const params = scopeParams(scope);
  const yearOf = lookups?.years.find((y) => y.id === params.academicYearId || y.terms.some((t) => t.id === params.termId));
  const tabs = [
    { key: 'summary', label: 'Summary' }, { key: 'terms', label: 'Collection by term' }, { key: 'classes', label: 'Outstanding by class' },
    { key: 'items', label: 'Revenue by fee item' }, { key: 'expenses', label: 'Expenses by category' }, { key: 'income', label: 'Income and expenses' },
    { key: 'owner', label: 'Owner funds' }, { key: 'cash', label: 'Cash received' },
    ...(can('payroll.view') ? [{ key: 'payroll', label: 'Payroll summary' }] : []),
  ];
  const scoped = !['terms', 'cash', 'payroll'].includes(tab);
  return (
    <div className="landscape-print">
      <PageHeader title="Reports" subtitle="Every figure comes from the same calculation as the dashboard and term close. Billed is net of approved discounts and leaves out arrears brought forward." />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {scoped && <div className="no-print mb-4 max-w-sm"><TermSelect value={scope} onChange={setScope} allowAll allowYear label="Period" /></div>}
      {tab === 'summary' && <Summary params={params} />}
      {tab === 'terms' && <ByTerm yearId={yearOf?.id} />}
      {tab === 'classes' && <ByClass params={params} />}
      {tab === 'items' && <ByItem params={params} />}
      {tab === 'expenses' && <ByExpense params={params} />}
      {tab === 'income' && <Income params={params} />}
      {tab === 'owner' && <Owner params={params} />}
      {tab === 'cash' && <Cash />}
      {tab === 'payroll' && <Payroll />}
    </div>
  );
}

type P = { params: { termId?: number; academicYearId?: number } };

function Summary({ params }: P) {
  const q = useReport<Figures>('summary', params);
  return <Section title="Summary" q={q}>{q.data && <FiguresTable figures={q.data} />}</Section>;
}

function ByTerm({ yearId }: { yearId?: number }) {
  const { lookups } = useLookups();
  const [year, setYear] = useState('');
  const academicYearId = year ? Number(year) : yearId;
  const q = useReport<Array<Record<string, string> & { termId: number; termLabel: string; status: string }>>('collection-by-term', { academicYearId });
  const n = (v: unknown) => Number(v ?? 0);
  return (
    <div className="space-y-4">
      <div className="no-print max-w-xs"><Select label="Year" value={year} onChange={(e) => setYear(e.target.value)} placeholder="All years" options={(lookups?.years ?? []).map((y) => ({ value: y.id, label: String(y.year) }))} /></div>
      <Section title="Billed, collected and outstanding by term" q={q}>
        {q.data && q.data.length > 0 && (
          <div className="h-64 p-4" role="img" aria-label="Bar chart of billed, collected and outstanding per term">
            <ResponsiveContainer>
              <BarChart data={q.data.map((t) => ({ name: t.termLabel, Billed: n(t.totalBilled), Collected: n(t.totalCollected), Outstanding: n(t.outstanding) }))} barGap={2}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="name" tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} />
                <YAxis tickFormatter={compactUGX} tick={{ fontSize: AXIS.fontSize, fill: AXIS.tickColor }} stroke={AXIS.stroke} width={48} />
                <Tooltip formatter={(v: number) => `UGX ${formatMoney(v)}`} cursor={{ fill: '#f1f5f9' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Billed" fill={SERIES.s1} radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="Collected" fill={SERIES.s2} radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="Outstanding" fill={SERIES.s3} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <TableWrap>
          <table className="table">
            <thead><tr><th>Term</th><th>Status</th><th className="num">Billed</th><th className="num">Arrears B/F</th><th className="num">Collected</th><th className="num">Carried out</th><th className="num">Outstanding</th><th className="num">Collection rate</th></tr></thead>
            <tbody>
              {q.data?.map((t) => (
                <tr key={t.termId}><td>{t.termLabel}</td><td><StatusBadge status={t.status} /></td><M v={t.totalBilled} /><M v={t.arrearsBroughtForward} /><M v={t.totalCollected} /><M v={t.carriedForwardOut} /><M v={t.outstanding} strong /><td className="num">{formatRate(t.collectionRate)}</td></tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>
    </div>
  );
}

function ByClass({ params }: P) {
  const q = useReport<Array<{ classId: number; className: string; sectionName: string; totalBilled: string; arrearsBroughtForward: string; totalCollected: string; outstanding: string; chargesWithBalance: number; collectionRate: string | null }>>('outstanding-by-class', params);
  return (
    <Section title="Outstanding by class" csv={`/reports/outstanding-by-class${qs({ ...params, format: 'csv' })}`} q={q}>
      {q.data?.length === 0 ? <div className="p-4"><Empty title="Nothing billed for this period" /></div> : (
        <TableWrap><table className="table">
          <thead><tr><th>Class</th><th>Section</th><th className="num">Billed</th><th className="num">Arrears B/F</th><th className="num">Collected</th><th className="num">Outstanding</th><th className="num">Unpaid charges</th><th className="num">Collection rate</th></tr></thead>
          <tbody>{q.data?.map((c) => <tr key={c.classId}><td>{c.className}</td><td>{c.sectionName}</td><M v={c.totalBilled} /><M v={c.arrearsBroughtForward} /><M v={c.totalCollected} /><M v={c.outstanding} strong /><td className="num">{c.chargesWithBalance}</td><td className="num">{formatRate(c.collectionRate)}</td></tr>)}</tbody>
        </table></TableWrap>
      )}
    </Section>
  );
}

function ByItem({ params }: P) {
  const q = useReport<Array<{ feeItemId: number; feeItemName: string; isArrears: boolean; grossBilled: string; discounts: string; netBilled: string; collected: string; outstanding: string }>>('revenue-by-item', params);
  return (
    <Section title="Revenue by fee item" csv={`/reports/revenue-by-item${qs({ ...params, format: 'csv' })}`} q={q}>
      <TableWrap><table className="table">
        <thead><tr><th>Fee item</th><th className="num">Gross billed</th><th className="num">Discounts</th><th className="num">Net billed</th><th className="num">Collected</th><th className="num">Outstanding</th></tr></thead>
        <tbody>{q.data?.map((i) => <tr key={i.feeItemId} className={i.isArrears ? 'italic text-slate-600' : ''}><td>{i.feeItemName}{i.isArrears && <span className="block text-xs not-italic">Not counted in billed</span>}</td><M v={i.grossBilled} /><M v={i.discounts} /><M v={i.netBilled} /><M v={i.collected} /><M v={i.outstanding} strong /></tr>)}</tbody>
      </table></TableWrap>
    </Section>
  );
}

function ByExpense({ params }: P) {
  const q = useReport<Array<{ category: string; categoryLabel: string; schoolFunded: string; ownerFunded: string; otherFunded: string; total: string }>>('expenses-by-category', params);
  const sum = (k: 'schoolFunded' | 'ownerFunded' | 'otherFunded' | 'total') => (q.data ?? []).reduce((s, r) => s + Number(r[k]), 0);
  return (
    <Section title="Approved expenses by category" csv={`/reports/expenses-by-category${qs({ ...params, format: 'csv' })}`} q={q}>
      {q.data?.length === 0 ? <div className="p-4"><Empty title="No approved expenses for this period" /></div> : (
        <TableWrap><table className="table">
          <thead><tr><th>Category</th><th className="num">School funds</th><th className="num">Owner funds</th><th className="num">Other funding</th><th className="num">Total</th></tr></thead>
          <tbody>{q.data?.map((c) => <tr key={c.category}><td>{c.categoryLabel}</td><M v={c.schoolFunded} /><M v={c.ownerFunded} /><M v={c.otherFunded} /><M v={c.total} strong /></tr>)}</tbody>
          <tfoot className="font-semibold"><tr><td className="px-3 py-2">Total</td><M v={sum('schoolFunded')} /><M v={sum('ownerFunded')} /><M v={sum('otherFunded')} /><M v={sum('total')} /></tr></tfoot>
        </table></TableWrap>
      )}
    </Section>
  );
}

interface IncomeStatement {
  basis: string; income: Array<{ label: string; amount: string }>; totalIncome: string;
  expenses: Array<{ label: string; amount: string; schoolFunded: string; ownerFunded: string; otherFunded: string }>;
  totalExpenses: string; schoolFundedExpenses: string; ownerFundedExpenses: string; otherFundedExpenses: string; netResult: string;
  belowTheLine: OwnerData;
}
function Income({ params }: P) {
  const q = useReport<IncomeStatement>('income-statement', params);
  const s = q.data;
  return (
    <Section title="Income and expenses statement" q={q}>
      {s && (
        <div className="max-w-3xl p-4 text-sm">
          <p className="mb-4 text-xs text-slate-500">{s.basis}</p>
          <h3 className="font-semibold">Income (fees collected)</h3>
          <table className="mt-1 w-full"><tbody>
            {s.income.map((i) => <tr key={i.label} className="border-b border-slate-100"><td className="py-1">{i.label}</td><td className="text-right tabular-nums">{formatMoney(i.amount)}</td></tr>)}
            <tr className="font-semibold"><td className="py-1.5">Total income</td><td className="text-right tabular-nums">{formatMoney(s.totalIncome)}</td></tr>
          </tbody></table>
          <h3 className="mt-5 font-semibold">Expenses (approved)</h3>
          <table className="mt-1 w-full"><tbody>
            {s.expenses.map((e) => <tr key={e.label} className="border-b border-slate-100"><td className="py-1">{e.label}</td><td className="text-right tabular-nums">{formatMoney(e.amount)}</td></tr>)}
            <tr className="font-semibold"><td className="py-1.5">Total expenses</td><td className="text-right tabular-nums">{formatMoney(s.totalExpenses)}</td></tr>
            <tr className="text-slate-600"><td className="pl-4">of which paid from school funds</td><td className="text-right tabular-nums">{formatMoney(s.schoolFundedExpenses)}</td></tr>
            <tr className="text-slate-600"><td className="pl-4">of which paid by the owner</td><td className="text-right tabular-nums">{formatMoney(s.ownerFundedExpenses)}</td></tr>
            <tr className="text-slate-600"><td className="pl-4">of which from other funding</td><td className="text-right tabular-nums">{formatMoney(s.otherFundedExpenses)}</td></tr>
          </tbody></table>
          <div className={`mt-4 flex justify-between border-y-2 border-slate-800 py-2 text-base font-bold ${Number(s.netResult) < 0 ? 'text-red-700' : ''}`}><span>Net result</span><span className="tabular-nums">UGX {formatMoney(s.netResult)}</span></div>
          <h3 className="mt-6 font-semibold">Owner funding (not income)</h3>
          <OwnerTable o={s.belowTheLine} />
        </div>
      )}
    </Section>
  );
}

interface OwnerData { cashContributions: string; expensesPaidDirectly: string; loansReceived: string; ownerFundedExpenses: string; ownerFundedByContribution: string; ownerFundedByLoan: string; loansOutstandingAllTime: string }
function OwnerTable({ o }: { o: OwnerData }) {
  const rows: Array<[string, string]> = [
    ['Cash contributions', o.cashContributions], ['Expenses paid directly by the owner', o.expensesPaidDirectly], ['Loans received', o.loansReceived],
    ['Owner-funded expenses (approved)', o.ownerFundedExpenses], ['  funded by contributions', o.ownerFundedByContribution], ['  funded by loans', o.ownerFundedByLoan],
    ['Owner loans received to date (repayments are not tracked yet)', o.loansOutstandingAllTime],
  ];
  return <table className="mt-1 w-full text-sm"><tbody>{rows.map(([k, v]) => <tr key={k} className="border-b border-slate-100"><td className={`py-1 ${k.startsWith('  ') ? 'pl-4 text-slate-600' : ''}`}>{k.trim()}</td><td className="text-right tabular-nums">{formatMoney(v)}</td></tr>)}</tbody></table>;
}
function Owner({ params }: P) {
  const q = useReport<OwnerData>('owner-funds', params);
  return <Section title="Owner funds" q={q}><div className="max-w-2xl p-4">{q.data && <OwnerTable o={q.data} />}<p className="mt-3 text-xs text-slate-500">Owner money is funding, not income, so none of it is in Total collected. <Link className="link" to="/owner-funds">See each contribution</Link>.</p></div></Section>;
}

function Cash() {
  const { label } = useLookups();
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const q = useReport<{ total: string; receipts: number; byMethod: Array<{ method: string; amount: string; receipts: number }>; byDay: Array<{ date: string; amount: string; receipts: number }> }>('cash-received', { from, to }, !!from && !!to);
  return (
    <div className="space-y-4">
      <div className="no-print grid max-w-lg grid-cols-2 gap-3"><DateInput label="From" value={from} onChange={setFrom} /><DateInput label="To" value={to} onChange={setTo} /></div>
      <Section title={`Cash received: UGX ${formatMoney(q.data?.total ?? 0)} on ${q.data?.receipts ?? 0} receipts`} q={q}>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <table className="table"><thead><tr><th>Method</th><th className="num">Receipts</th><th className="num">Amount</th></tr></thead>
            <tbody>{q.data?.byMethod.map((m) => <tr key={m.method}><td>{label('PAYMENT_METHOD', m.method)}</td><td className="num">{m.receipts}</td><M v={m.amount} /></tr>)}</tbody></table>
          <table className="table"><thead><tr><th>Day</th><th className="num">Receipts</th><th className="num">Amount</th></tr></thead>
            <tbody>{q.data?.byDay.map((d) => <tr key={d.date}><td>{d.date.split('-').reverse().join('/')}</td><td className="num">{d.receipts}</td><M v={d.amount} /></tr>)}</tbody></table>
        </div>
        <p className="px-4 pb-4 text-xs text-slate-500">Reversed receipts are left out. This counts money by the date it was received, whatever term it paid for.</p>
      </Section>
    </div>
  );
}

function Payroll() {
  const [year, setYear] = useState(todayIso().slice(0, 4));
  const q = useReport<Array<{ runId: number; period: string; status: string; staff: number; basic: string; nssfEmployee: string; nssfEmployer: string; paye: string; other: string; net: string; schoolCost: string }>>('payroll-summary', { year });
  return (
    <div className="space-y-4">
      <div className="no-print max-w-[10rem]"><Select label="Year" value={year} onChange={(e) => setYear(e.target.value)} options={[0, 1, 2].map((i) => String(Number(todayIso().slice(0, 4)) - i)).map((y) => ({ value: y, label: y }))} /></div>
      <Section title="Payroll by month" q={q}>
        {q.data?.length === 0 ? <div className="p-4"><Empty title="No payroll runs this year" /></div> : (
          <TableWrap><table className="table">
            <thead><tr><th>Month</th><th>Status</th><th className="num">Staff</th><th className="num">Basic</th><th className="num">NSSF (employee)</th><th className="num">PAYE</th><th className="num">Other</th><th className="num">Net pay</th><th className="num">NSSF (employer)</th><th className="num">Cost to school</th></tr></thead>
            <tbody>{q.data?.map((r) => <tr key={r.runId}><td><Link className="link" to={`/payroll/runs/${r.runId}`}>{r.period}</Link></td><td><StatusBadge status={r.status} /></td><td className="num">{r.staff}</td><M v={r.basic} /><M v={r.nssfEmployee} /><M v={r.paye} /><M v={r.other} /><M v={r.net} /><M v={r.nssfEmployer} /><M v={r.schoolCost} strong /></tr>)}</tbody>
          </table></TableWrap>
        )}
      </Section>
    </div>
  );
}
