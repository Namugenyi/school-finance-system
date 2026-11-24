import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadUrl, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cleanAmount, formatDateTime, todayIso } from '../lib/format';
import { Button, Card, cx, DateInput, DecisionButtons, Dt, Empty, ErrorBox, Loading, Modal, Money, MoneyInput, Notice, PageHeader, Pagination, Select, SelectWithOther, StatusBadge, TableWrap, TextInput, withOther, Narrow } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import type { Paged } from '../lib/types';

export interface Expense {
  id: number; expenseNo: string; expenseDate: string; termId: number; termLabel: string; category: string; description: string; amount: string;
  supplier: string | null; method: string; invoiceRef: string | null; fundingSource: string; fundingSourceOther: string | null; fundingBucket: string; status: string;
  enteredById: number; enteredBy: string | null; enteredAt: string; approvedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  postClose: boolean; payrollRunId: number | null; contributionId: number | null; canDecide: boolean; warnings?: string[];
}

const BUCKET: Record<string, string> = { SCHOOL: 'School funds', OWNER: 'Owner funds', OTHER: 'Other funding' };

type Form = { expenseDate: string; termId: string; category: string; description: string; amount: string; supplier: string; method: string; invoiceRef: string; fundingSource: string; fundingSourceOther: string };

function ExpenseForm({ initial, onDone, onCancel }: { initial?: Expense; onDone: (e: Expense) => void; onCancel: () => void }) {
  const { lookups, options } = useLookups();
  const [f, setF] = useState<Form>(() => initial ? {
    expenseDate: initial.expenseDate, termId: String(initial.termId), category: initial.category, description: initial.description, amount: initial.amount,
    supplier: initial.supplier ?? '', method: initial.method, invoiceRef: initial.invoiceRef ?? '', fundingSource: initial.fundingSource, fundingSourceOther: initial.fundingSourceOther ?? '',
  } : { expenseDate: todayIso(), termId: String(lookups?.currentTermId ?? ''), category: '', description: '', amount: '', supplier: '', method: '', invoiceRef: '', fundingSource: 'SCHOOL_FUNDS', fundingSourceOther: '' });
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  // Suggest the term from the date (FR-704); the user can still change it.
  useEffect(() => {
    if (!f.expenseDate || initial) return;
    const t = lookups?.terms.find((t) => t.startDate <= f.expenseDate && t.endDate >= f.expenseDate);
    if (t) setF((x) => ({ ...x, termId: String(t.id) }));
  }, [f.expenseDate, lookups, initial]);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, termId: Number(f.termId), amount: cleanAmount(f.amount) };
      return initial ? api.patch<Expense>(`/expenses/${initial.id}`, body) : api.post<Expense>('/expenses', body);
    },
    onSuccess: onDone,
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <DateInput label="Date" value={f.expenseDate} onChange={set('expenseDate')} required />
        <Select label="Term" value={f.termId} onChange={(e) => set('termId')(e.target.value)} placeholder="Choose…" options={(lookups?.terms ?? []).map((t) => ({ value: t.id, label: `${t.label}${t.status === 'CLOSED' ? ' (closed)' : ''}` }))} required hint="Suggested from the date" />
        <Select label="Category" value={f.category} onChange={(e) => set('category')(e.target.value)} placeholder="Choose…" options={options('EXPENSE_CATEGORY')} required />
        <MoneyInput label="Amount (UGX)" value={f.amount} onChange={set('amount')} required />
        <TextInput label="Description" value={f.description} onChange={(e) => set('description')(e.target.value)} required className="sm:col-span-2" />
        <TextInput label="Supplier / payee" value={f.supplier} onChange={(e) => set('supplier')(e.target.value)} />
        <TextInput label="Invoice or receipt number" value={f.invoiceRef} onChange={(e) => set('invoiceRef')(e.target.value)} />
        <Select label="Paid by" value={f.method} onChange={(e) => set('method')(e.target.value)} placeholder="Choose…" options={options('PAYMENT_METHOD')} required />
        <SelectWithOther label="Funding source" value={f.fundingSource} onChange={set('fundingSource')} options={options('FUNDING_SOURCE')} required hint="Where the money came from. Owner-funded spending is not taken from school income."
          other={f.fundingSourceOther} onOtherChange={set('fundingSourceOther')} otherLabel="Funding source (please specify)" />
      </div>
      {f.category === 'SALARIES' && <Notice tone="warning">Salaries normally come from a payroll run. Only enter them here if they are not in payroll.</Notice>}
      <ErrorBox error={save.error} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button busy={save.isPending} disabled={!f.category || !f.method || !f.amount || !f.termId || !f.expenseDate || f.description.trim().length < 3 || (f.fundingSource === 'OTHER' && !f.fundingSourceOther.trim())} onClick={() => save.mutate()}>{initial ? 'Save changes' : 'Save for approval'}</Button>
      </div>
    </div>
  );
}

export function ExpensesPage() {
  const { can } = useAuth();
  const { options, label } = useLookups();
  const qc = useQueryClient();
  const [scope, setScope] = useState('');
  const [category, setCategory] = useState('');
  const [fundingSource, setFunding] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<Expense | null>(null);
  useEffect(() => setPage(1), [scope, category, fundingSource, status, search]);
  const params = { ...scopeParams(scope), category, fundingSource, status, search };
  const q = useQuery({ queryKey: ['expenses', params, page], queryFn: () => api.get<Paged<Expense> & { approvedTotal: string }>(`/expenses${qs({ ...params, page })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Spending entered here waits for approval and only counts once approved."
        actions={<>
          {can('expenses.manage') && <Button onClick={() => { setSaved(null); setAdding(true); }}>Add expense</Button>}
          <Button variant="secondary" onClick={() => downloadUrl(`/expenses${qs({ ...params, format: 'csv' })}`)}>Export CSV</Button>
        </>} />
      {saved && <div className="mb-4"><Notice tone="success" title={`Saved as ${saved.expenseNo}, waiting for approval`}>{saved.warnings?.map((w, i) => <p key={i} className="text-amber-800">{w}</p>)}</Notice></div>}
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <TermSelect value={scope} onChange={setScope} allowAll allowYear />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" options={options('EXPENSE_CATEGORY', true)} />
          <Select label="Funding source" value={fundingSource} onChange={(e) => setFunding(e.target.value)} placeholder="All sources" options={options('FUNDING_SOURCE', true)} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={[{ value: 'PENDING', label: 'Waiting for approval' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
          <TextInput label="Search" placeholder="Description, supplier, invoice" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Loading /> : q.data?.items.length === 0 ? <div className="p-4"><Empty title="No expenses match" /></div> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Expense</th><th>Date</th><th>Term</th><th>Category</th><th>Description</th><th>Supplier</th><th>Funding</th><th>Status</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {q.data?.items.map((e) => (
                  <tr key={e.id} className={cx(e.status === 'REJECTED' && 'text-slate-400', e.fundingBucket === 'OWNER' && 'bg-violet-50')}>
                    <td><Link to={`/expenses/${e.id}`} className="link font-mono text-xs">{e.expenseNo}</Link>{e.payrollRunId && <span className="block text-xs text-slate-500">From payroll</span>}{e.postClose && <span className="block text-xs text-amber-700">Entered after close</span>}</td>
                    <td><Dt value={e.expenseDate} /></td>
                    <td>{e.termLabel}</td>
                    <td>{label('EXPENSE_CATEGORY', e.category)}</td>
                    <td className="max-w-xs whitespace-normal">{e.description}</td>
                    <td>{e.supplier}</td>
                    <td className="max-w-[12rem] whitespace-normal text-xs">{withOther(label('FUNDING_SOURCE', e.fundingSource), e.fundingSourceOther)}{e.fundingBucket === 'OWNER'
                      ? <span className="mt-0.5 block w-fit rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-800">Owner</span>
                      : <span className="block text-slate-500">{BUCKET[e.fundingBucket]}</span>}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td className="num"><Money value={e.amount} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={8} className="px-3 py-2 font-semibold">Approved total for this selection</td><td className="num px-3 py-2 font-semibold"><Money value={q.data?.approvedTotal} /></td></tr></tfoot>
            </table>
          </TableWrap>
        )}
        {q.data && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </Card>
      <Modal open={adding} wide title="Add expense" onClose={() => setAdding(false)}>
        <ExpenseForm onCancel={() => setAdding(false)} onDone={(e) => { setAdding(false); setSaved(e); void qc.invalidateQueries({ queryKey: ['expenses'] }); void qc.invalidateQueries({ queryKey: ['approvals'] }); }} />
      </Modal>
    </div>
  );
}

export function ExpenseDetailPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const { label } = useLookups();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['expense', id], queryFn: () => api.get<Expense>(`/expenses/${id}`) });
  const decide = useMutation({ mutationFn: ({ approve, note }: { approve: boolean; note: string }) => api.post(`/expenses/${id}/decide`, { approve, note: note || null }), onSuccess: () => void qc.invalidateQueries() });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const e = q.data;
  return (
    <Narrow width="3xl">
      <PageHeader title={e.description} crumbs={[{ label: 'Expenses', to: '/expenses' }, { label: e.expenseNo }]}
        subtitle={<span className="flex items-center gap-2"><span className="font-mono">{e.expenseNo}</span> <StatusBadge status={e.status} /></span>}
        actions={can('expenses.manage') && e.status === 'PENDING' && !e.payrollRunId && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>} />
      {e.payrollRunId && <div className="mb-4"><Notice>Posted from <Link className="link" to={`/payroll/runs/${e.payrollRunId}`}>a payroll run</Link>. It is approved with that run.</Notice></div>}
      <Card>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {[
            ['Amount', <span key="a" className="text-lg font-semibold">UGX <Money value={e.amount} /></span>],
            ['Date', <Dt key="d" value={e.expenseDate} />], ['Term', e.termLabel], ['Category', label('EXPENSE_CATEGORY', e.category)],
            ['Supplier / payee', e.supplier], ['Invoice or receipt', e.invoiceRef], ['Paid by', label('PAYMENT_METHOD', e.method)],
            ['Funding source', `${withOther(label('FUNDING_SOURCE', e.fundingSource), e.fundingSourceOther)} (${BUCKET[e.fundingBucket]})`],
            ['Entered by', `${e.enteredBy ?? ''} · ${formatDateTime(e.enteredAt)}`],
            ['Decision', e.approvedByName ? `${e.approvedByName} · ${formatDateTime(e.decidedAt)}${e.decisionNote ? ` · ${e.decisionNote}` : ''}` : null],
            ...(e.postClose ? [['Note', 'Entered after the term was closed']] : []),
          ].map(([k, v], i) => <div key={i}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5">{v || <span className="text-slate-400">—</span>}</dd></div>)}
        </dl>
        {e.status === 'PENDING' && !e.payrollRunId && can('expenses.approve') && (
          <div className="mt-6 border-t border-slate-200 pt-4">
            <DecisionButtons busy={decide.isPending} onDecide={(approve, note) => decide.mutate({ approve, note })}
              disabledReason={e.enteredById === me?.id ? 'You entered this expense, so someone else must approve it.' : null} />
            <div className="mt-2"><ErrorBox error={decide.error} /></div>
          </div>
        )}
      </Card>
      <Modal open={editing} wide title={`Edit ${e.expenseNo}`} onClose={() => setEditing(false)}>
        <ExpenseForm initial={e} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); void qc.invalidateQueries(); }} />
      </Modal>
    </Narrow>
  );
}
