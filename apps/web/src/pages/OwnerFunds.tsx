import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cleanAmount, todayIso } from '../lib/format';
import { Button, Card, DateInput, Dt, Empty, ErrorBox, Loading, Modal, Money, MoneyInput, Notice, PageHeader, Pagination, Select, Stat, StatusBadge, TableWrap, TextInput } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import type { Paged } from '../lib/types';
import type { Expense } from './Expenses';

interface Contribution { id: number; contributionNo: string; date: string; termId: number; termLabel: string; type: string; amount: string; ownerName: string; description: string | null; method: string | null; reference: string | null; expense: { id: number; expenseNo: string; status: string; amount: string } | null }

export function OwnerFundsPage() {
  const { can } = useAuth();
  const { lookups, options, label } = useLookups();
  const qc = useQueryClient();
  const [scope, setScope] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(1), [scope, type]);
  const params = { ...scopeParams(scope), type };
  const q = useQuery({ queryKey: ['owner-funds', params, page], queryFn: () => api.get<Paged<Contribution> & { totalsByType: Record<string, string> }>(`/owner-funds${qs({ ...params, page })}`), placeholderData: (p) => p });

  const blank = { date: todayIso(), termId: String(lookups?.currentTermId ?? ''), type: '', amount: '', ownerName: '', description: '', method: '', reference: '', expenseId: '' };
  const [f, setF] = useState(blank);
  const direct = f.type === 'EXPENSE_PAID_DIRECTLY';
  const ownerExpenses = useQuery({
    queryKey: ['owner-expenses'],
    queryFn: () => api.get<Paged<Expense>>(`/expenses${qs({ fundingSource: 'OWNER_CONTRIBUTION', pageSize: 100 })}`),
    enabled: adding && direct,
  });
  const save = useMutation({
    mutationFn: () => api.post('/owner-funds', { ...f, termId: Number(f.termId), amount: cleanAmount(f.amount), method: f.method || null, expenseId: f.expenseId ? Number(f.expenseId) : null }),
    onSuccess: () => { setAdding(false); void qc.invalidateQueries({ queryKey: ['owner-funds'] }); },
  });
  const totals = q.data?.totalsByType ?? {};
  return (
    <div>
      <PageHeader title="Owner funds" subtitle="Money the proprietor puts into the school. It is funding, not income, so it never counts as fees collected."
        actions={can('owner.manage') && <Button onClick={() => { setF(blank); setAdding(true); }}>Record contribution</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <TermSelect value={scope} onChange={setScope} allowAll allowYear />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)} placeholder="All types" options={options('CONTRIBUTION_TYPE', true)} />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {options('CONTRIBUTION_TYPE', true).map((o) => <Stat key={o.value} label={o.label} value={<Money value={totals[o.value] ?? 0} />} />)}
      </div>
      <Card padded={false}>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Loading /> : q.data?.items.length === 0 ? <div className="p-4"><Empty title="No owner contributions recorded" /></div> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>No.</th><th>Date</th><th>Term</th><th>Type</th><th>Owner</th><th>Description</th><th>Linked expense</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {q.data?.items.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-xs">{c.contributionNo}</td>
                    <td><Dt value={c.date} /></td>
                    <td>{c.termLabel}</td>
                    <td>{label('CONTRIBUTION_TYPE', c.type)}</td>
                    <td>{c.ownerName}</td>
                    <td className="max-w-xs whitespace-normal">{c.description}</td>
                    <td>{c.expense ? <><Link to={`/expenses/${c.expense.id}`} className="link font-mono text-xs">{c.expense.expenseNo}</Link> <StatusBadge status={c.expense.status} /></> : ''}</td>
                    <td className="num"><Money value={c.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {q.data && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </Card>
      <Modal open={adding} wide title="Record owner contribution" onClose={() => setAdding(false)}
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button busy={save.isPending} disabled={!f.type || !f.amount || !f.ownerName || !f.termId || (direct && !f.expenseId)} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, expenseId: '' })} placeholder="Choose…" options={options('CONTRIBUTION_TYPE')} required />
          <TextInput label="Owner name" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} required />
          <DateInput label="Date" value={f.date} onChange={(v) => setF({ ...f, date: v })} required />
          <Select label="Term" value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })} placeholder="Choose…" options={(lookups?.terms ?? []).map((t) => ({ value: t.id, label: t.label }))} required />
          {direct && (
            <Select className="sm:col-span-2" label="Expense the owner paid" value={f.expenseId} placeholder="Choose…" required
              hint="Only expenses with Owner Contribution as the funding source, not yet linked. The amount must match."
              onChange={(e) => { const ex = ownerExpenses.data?.items.find((x) => String(x.id) === e.target.value); setF({ ...f, expenseId: e.target.value, amount: ex?.amount ?? f.amount }); }}
              options={(ownerExpenses.data?.items ?? []).filter((x) => !x.contributionId && x.status !== 'REJECTED').map((x) => ({ value: x.id, label: `${x.expenseNo} · ${x.description} · ${x.amount}` }))} />
          )}
          <MoneyInput label="Amount (UGX)" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} required />
          <Select label="Method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="Not applicable" options={options('PAYMENT_METHOD')} />
          <TextInput label="Reference" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          <TextInput label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        {direct && <Notice>The expense is counted once, as owner-funded spending. This record just shows the owner paid it.</Notice>}
        <ErrorBox error={save.error} />
      </Modal>
    </div>
  );
}
