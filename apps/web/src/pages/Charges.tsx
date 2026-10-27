import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cleanAmount, formatDateTime } from '../lib/format';
import { Button, Card, DateInput, Dt, Empty, ErrorBox, Loading, Modal, Money, MoneyInput, Notice, PageHeader, Pagination, Select, StatusBadge, TableWrap, TextArea, TextInput } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import type { Charge, Paged } from '../lib/types';

interface ChargeDetail extends Charge {
  voidReason: string | null;
  carriedTo: { id: number; chargeNo: string; termLabel: string } | null;
  sourceChargeId: number | null;
  discounts: Array<{ id: number; amount: string; reason: string; status: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null }>;
  payments: Array<{ receiptId: number; receiptNo: string; paymentDate: string; amount: string; method: string; reversed: boolean }>;
}

const STATUSES = [
  { value: 'UNPAID', label: 'Unpaid' }, { value: 'PARTIAL', label: 'Partial' }, { value: 'PAID', label: 'Paid' }, { value: 'CARRIED_FORWARD', label: 'Carried forward' },
];

export function ChargesPage() {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const qc = useQueryClient();
  const [scope, setScope] = useState('');
  const [classId, setClassId] = useState('');
  const [feeItemId, setFeeItemId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(1), [scope, classId, feeItemId, status, search]);
  const q = useQuery({
    queryKey: ['charges', scope, classId, feeItemId, status, search, page],
    queryFn: () => api.get<Paged<Charge>>(`/charges${qs({ ...scopeParams(scope), classId, feeItemId, status, search, page })}`),
    placeholderData: (p) => p,
  });

  const [form, setForm] = useState({ pupilSearch: '', pupilId: '', feeItemId: '', amount: '', dueDate: '', notes: '' });
  const pupilsQ = useQuery({
    queryKey: ['pupil-pick', form.pupilSearch],
    queryFn: () => api.get<Paged<{ id: number; pupilCode: string; fullName: string; className: string }>>(`/pupils${qs({ search: form.pupilSearch, status: 'ACTIVE', pageSize: 20 })}`),
    enabled: adding && form.pupilSearch.length >= 2,
  });
  const create = useMutation({
    mutationFn: () => api.post<Charge>('/charges', { pupilId: Number(form.pupilId), termId: scopeParams(scope).termId, feeItemId: Number(form.feeItemId), amount: cleanAmount(form.amount), dueDate: form.dueDate || null, notes: form.notes || null }),
    onSuccess: () => { setAdding(false); void qc.invalidateQueries({ queryKey: ['charges'] }); },
  });

  return (
    <div>
      <PageHeader title="Charges" subtitle="Every fee owed by a pupil, with what has been paid. Balances and statuses are worked out by the system."
        actions={<>
          {can('billing.run') && <Link to="/billing"><Button>Bill a class</Button></Link>}
          {can('charges.manage') && <Button variant="secondary" disabled={!scopeParams(scope).termId} onClick={() => { setForm({ pupilSearch: '', pupilId: '', feeItemId: '', amount: '', dueDate: '', notes: '' }); setAdding(true); }}>Add one charge</Button>}
        </>} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <TermSelect value={scope} onChange={setScope} allowAll allowYear />
          <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="All classes" options={(lookups?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <Select label="Fee item" value={feeItemId} onChange={(e) => setFeeItemId(e.target.value)} placeholder="All fee items" options={(lookups?.feeItems ?? []).map((f) => ({ value: f.id, label: f.name }))} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={STATUSES} />
          <TextInput label="Pupil" placeholder="Name or pupil ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Loading /> : q.data?.items.length === 0 ? <div className="p-4"><Empty title="No charges match these filters" /></div> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Charge</th><th>Pupil</th><th>Class</th><th>Term</th><th>Fee item</th><th className="num">Charged</th><th className="num">Discount</th><th className="num">Net due</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th></tr></thead>
              <tbody>
                {q.data?.items.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/charges/${c.id}`} className="link font-mono text-xs">{c.chargeNo}</Link></td>
                    <td><Link to={`/pupils/${c.pupilId}`} className="link">{c.pupilName}</Link></td>
                    <td>{c.className}</td>
                    <td>{c.termLabel}</td>
                    <td>{c.feeItemName}{c.arrearsFrom && <span className="block text-xs text-slate-500">from {c.arrearsFrom}</span>}{c.postClose && <span className="block text-xs text-amber-700">Entered after close</span>}</td>
                    <td className="num"><Money value={c.amountCharged} /></td>
                    <td className="num"><Money value={c.discount} />{Number(c.pendingDiscount) > 0 && <span className="block text-xs text-amber-700">+<Money value={c.pendingDiscount} /> waiting</span>}</td>
                    <td className="num computed"><Money value={c.netDue} /></td>
                    <td className="num computed"><Money value={c.totalPaid} /></td>
                    <td className="num computed font-medium"><Money value={c.balance} credit /></td>
                    <td><StatusBadge status={c.status} balance={c.balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {q.data && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </Card>

      <Modal open={adding} title="Add one charge" onClose={() => setAdding(false)}
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button busy={create.isPending} disabled={!form.pupilId || !form.feeItemId || !form.amount} onClick={() => create.mutate()}>Add charge</Button></>}>
        <p className="text-sm text-slate-600">For a single item outside term billing, such as a uniform bought mid-term. Term: {lookups?.terms.find((t) => t.id === scopeParams(scope).termId)?.label}.</p>
        <TextInput label="Find pupil" placeholder="Type at least 2 letters" value={form.pupilSearch} onChange={(e) => setForm({ ...form, pupilSearch: e.target.value, pupilId: '' })} />
        {pupilsQ.data && (
          <Select label="Pupil" value={form.pupilId} onChange={(e) => setForm({ ...form, pupilId: e.target.value })} placeholder="Choose…" options={pupilsQ.data.items.map((p) => ({ value: p.id, label: `${p.fullName} · ${p.pupilCode} · ${p.className}` }))} />
        )}
        <Select label="Fee item" value={form.feeItemId} onChange={(e) => setForm({ ...form, feeItemId: e.target.value })} placeholder="Choose…" options={(lookups?.feeItems ?? []).filter((f) => f.active && !f.isSystem).map((f) => ({ value: f.id, label: f.name }))} required />
        <MoneyInput label="Amount (UGX)" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
        <DateInput label="Due date" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} />
        <TextArea label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2} />
        <ErrorBox error={create.error} />
      </Modal>
    </div>
  );
}

export function ChargeDetailPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const { label } = useLookups();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['charge', id], queryFn: () => api.get<ChargeDetail>(`/charges/${id}`) });
  const [modal, setModal] = useState<'discount' | 'void' | null>(null);
  const [disc, setDisc] = useState({ amount: '', reason: '' });
  const [voidReason, setVoidReason] = useState('');
  const refresh = () => void qc.invalidateQueries();
  const discountM = useMutation({ mutationFn: () => api.post(`/charges/${id}/discounts`, { amount: cleanAmount(disc.amount), reason: disc.reason }), onSuccess: () => { setModal(null); refresh(); } });
  const voidM = useMutation({ mutationFn: () => api.post(`/charges/${id}/void`, { reason: voidReason }), onSuccess: () => { setModal(null); refresh(); } });
  const decideM = useMutation({ mutationFn: ({ did, approve, note }: { did: number; approve: boolean; note: string }) => api.post(`/charges/discounts/${did}/decide`, { approve, note: note || null }), onSuccess: refresh });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const c = q.data;
  const canDiscount = can('discounts.request') && !c.voided && !c.isArrears && Number(c.carriedForward) === 0;
  return (
    <div>
      <PageHeader title={`${c.feeItemName} · ${c.pupilName}`} crumbs={[{ label: 'Charges', to: '/charges' }, { label: c.chargeNo }]}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{c.chargeNo}</span> · {c.termLabel} · {c.className} <StatusBadge status={c.status} balance={c.balance} /></span>}
        actions={<>
          {can('payments.record') && !c.voided && Number(c.balance) > 0 && c.status !== 'CARRIED_FORWARD' && <Link to={`/payments/new?pupilId=${c.pupilId}`}><Button>Record payment</Button></Link>}
          {canDiscount && <Button variant="secondary" onClick={() => { setDisc({ amount: '', reason: '' }); setModal('discount'); }}>Request discount</Button>}
          {can('charges.manage') && !c.voided && <Button variant="secondary" onClick={() => { setVoidReason(''); setModal('void'); }}>Void charge</Button>}
        </>} />
      {c.voided && <div className="mb-4"><Notice tone="warning" title="This charge is void">{c.voidReason}</Notice></div>}
      {c.carriedTo && <div className="mb-4"><Notice>The unpaid balance was carried forward to <Link className="link" to={`/charges/${c.carriedTo.id}`}>{c.carriedTo.chargeNo}</Link> in {c.carriedTo.termLabel}. Pay it there.</Notice></div>}
      {c.arrearsFrom && c.sourceChargeId && <div className="mb-4"><Notice>Arrears brought forward from <Link className="link" to={`/charges/${c.sourceChargeId}`}>{c.arrearsFrom}</Link>.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Amounts">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt>Amount charged</dt><dd><Money value={c.amountCharged} /></dd></div>
            <div className="flex justify-between"><dt>Approved discount</dt><dd>− <Money value={c.discount} /></dd></div>
            {Number(c.pendingDiscount) > 0 && <div className="flex justify-between text-amber-800"><dt>Discount waiting for approval</dt><dd><Money value={c.pendingDiscount} /></dd></div>}
            <div className="flex justify-between border-t border-slate-200 pt-2"><dt>Net due</dt><dd className="computed"><Money value={c.netDue} /></dd></div>
            <div className="flex justify-between"><dt>Paid</dt><dd className="computed">− <Money value={c.totalPaid} /></dd></div>
            {Number(c.carriedForward) > 0 && <div className="flex justify-between"><dt>Carried forward</dt><dd className="computed">− <Money value={c.carriedForward} /></dd></div>}
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><dt>Balance</dt><dd className="computed"><Money value={c.balance} credit /></dd></div>
            {c.dueDate && <div className="flex justify-between text-slate-600"><dt>Due</dt><dd><Dt value={c.dueDate} /></dd></div>}
          </dl>
          {c.notes && <p className="mt-3 text-sm text-slate-600">{c.notes}</p>}
        </Card>
        <Card title="Payments" padded={false} className="lg:col-span-2">
          {c.payments.length === 0 ? <div className="p-4"><Empty title="No payments against this charge" /></div> : (
            <table className="table">
              <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {c.payments.map((p) => (
                  <tr key={p.receiptId} className={p.reversed ? 'text-slate-400 line-through' : ''}>
                    <td><Link to={`/receipts/${p.receiptNo}`} className="link font-mono text-xs">{p.receiptNo}</Link> {p.reversed && <StatusBadge status="REVERSED" />}</td>
                    <td><Dt value={p.paymentDate} /></td>
                    <td>{label('PAYMENT_METHOD', p.method)}</td>
                    <td className="num"><Money value={p.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <Card title="Discounts and waivers" padded={false} className="mt-4">
        {c.discounts.length === 0 ? <div className="p-4"><Empty title="No discounts on this charge" /></div> : (
          <table className="table">
            <thead><tr><th>Requested</th><th>Reason</th><th className="num">Amount</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>
              {c.discounts.map((d) => (
                <tr key={d.id}>
                  <td className="text-xs">{d.requestedBy}<span className="block text-slate-500">{formatDateTime(d.requestedAt)}</span></td>
                  <td className="whitespace-normal">{d.reason}</td>
                  <td className="num"><Money value={d.amount} /></td>
                  <td><StatusBadge status={d.status} /></td>
                  <td className="text-xs">
                    {d.status === 'PENDING' && can('discounts.approve') ? (
                      d.requestedBy === me?.fullName ? <span className="text-slate-500">Someone else must approve</span> : (
                        <div className="flex gap-1">
                          <Button variant="success" busy={decideM.isPending} onClick={() => decideM.mutate({ did: d.id, approve: true, note: '' })}>Approve</Button>
                          <Button variant="secondary" onClick={() => { const note = window.prompt('Reason for rejecting'); if (note) decideM.mutate({ did: d.id, approve: false, note }); }}>Reject</Button>
                        </div>
                      )
                    ) : d.decidedBy ? <>{d.decidedBy}<span className="block text-slate-500">{formatDateTime(d.decidedAt)}{d.decisionNote ? ` · ${d.decisionNote}` : ''}</span></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 pb-3"><ErrorBox error={decideM.error} /></div>
      </Card>

      <Modal open={modal === 'discount'} title="Request a discount or waiver" onClose={() => setModal(null)}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button busy={discountM.isPending} disabled={!disc.amount || disc.reason.trim().length < 3} onClick={() => discountM.mutate()}>Send for approval</Button></>}>
        <p className="text-sm text-slate-600">The discount counts only after the Head Teacher (or another approver) approves it. It cannot be more than the amount charged (<Money value={c.amountCharged} />).</p>
        <MoneyInput label="Discount amount (UGX)" value={disc.amount} onChange={(v) => setDisc({ ...disc, amount: v })} required />
        <TextArea label="Reason" value={disc.reason} onChange={(v) => setDisc({ ...disc, reason: v })} required rows={2} />
        <ErrorBox error={discountM.error} />
      </Modal>
      <Modal open={modal === 'void'} title="Void this charge" onClose={() => setModal(null)}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button variant="danger" busy={voidM.isPending} disabled={voidReason.trim().length < 5} onClick={() => voidM.mutate()}>Void charge</Button></>}>
        <Notice tone="warning">Only for a charge raised in error. A charge with payments or carried forward cannot be voided. The charge stays on record, marked void.</Notice>
        <TextArea label="Reason" value={voidReason} onChange={setVoidReason} required rows={2} />
        <ErrorBox error={voidM.error} />
      </Modal>
    </div>
  );
}
