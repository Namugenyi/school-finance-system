import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, downloadUrl, newKey, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cleanAmount, formatDate, formatDateTime, formatMoney, sumMoney, todayIso } from '../lib/format';
import { Button, Card, DateInput, Dt, Empty, ErrorBox, Loading, Modal, Money, Notice, PageHeader, Pagination, Select, StatusBadge, TableWrap, TextArea, TextInput } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import type { Charge, Paged } from '../lib/types';

interface PaymentRow { id: number; receiptNo: string; paymentDate: string; pupilId: number; pupilCode: string; pupilName: string; method: string; reference: string | null; total: string; receivedByName: string; reversed: boolean; reversalStatus: string | null; postClose: boolean; items: string }

export function PaymentsPage() {
  const { can } = useAuth();
  const { options, label } = useLookups();
  const [scope, setScope] = useState('');
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [scope, search, method, from, to]);
  const params = { ...scopeParams(scope), search, method, from, to };
  const q = useQuery({
    queryKey: ['payments', params, page],
    queryFn: () => api.get<Paged<PaymentRow> & { sumTotal: string }>(`/payments${qs({ ...params, page })}`),
    placeholderData: (p) => p,
  });
  return (
    <div>
      <PageHeader title="Payments" subtitle="Every receipt issued. Reversed receipts stay on the list, marked, and do not count."
        actions={<>
          {can('payments.record') && <Link to="/payments/new"><Button>Record payment</Button></Link>}
          <Button variant="secondary" onClick={() => downloadUrl(`/payments${qs({ ...params, format: 'csv' })}`)}>Export CSV</Button>
        </>} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <TextInput label="Search" placeholder="Receipt, pupil or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
          <TermSelect value={scope} onChange={setScope} allowAll allowYear label="Charges in" />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="All methods" options={options('PAYMENT_METHOD', true)} />
          <DateInput label="Paid from" value={from} onChange={setFrom} />
          <DateInput label="Paid to" value={to} onChange={setTo} />
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Loading /> : q.data?.items.length === 0 ? <div className="p-4"><Empty title="No payments match" /></div> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Receipt</th><th>Date</th><th>Pupil</th><th>Fee items</th><th>Method</th><th>Reference</th><th>Received by</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {q.data?.items.map((r) => (
                  <tr key={r.id} className={r.reversed ? 'text-slate-400' : ''}>
                    <td><Link to={`/receipts/${r.receiptNo}`} className="link font-mono text-xs">{r.receiptNo}</Link>
                      {r.reversed ? <span className="ml-1"><StatusBadge status="REVERSED" /></span> : r.reversalStatus === 'PENDING' ? <span className="ml-1"><StatusBadge status="PENDING" label="Reversal waiting" /></span> : null}
                      {r.postClose && <span className="block text-xs text-amber-700">Entered after close</span>}</td>
                    <td><Dt value={r.paymentDate} /></td>
                    <td><Link to={`/pupils/${r.pupilId}`} className="link">{r.pupilName}</Link><span className="block font-mono text-xs text-slate-500">{r.pupilCode}</span></td>
                    <td className="max-w-xs whitespace-normal text-xs">{r.items}</td>
                    <td>{label('PAYMENT_METHOD', r.method)}</td>
                    <td className="text-xs">{r.reference}</td>
                    <td className="text-xs">{r.receivedByName}</td>
                    <td className={`num ${r.reversed ? 'line-through' : ''}`}><Money value={r.total} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={7} className="px-3 py-2 font-semibold">Total received (not counting reversed)</td><td className="num px-3 py-2 font-semibold"><Money value={q.data?.sumTotal} /></td></tr></tfoot>
            </table>
          </TableWrap>
        )}
        {q.data && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}

export function NewPaymentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { options } = useLookups();
  const [pupilSearch, setPupilSearch] = useState('');
  const [pupilId, setPupilId] = useState(params.get('pupilId') ?? '');
  const [form, setForm] = useState({ paymentDate: todayIso(), method: '', reference: '', notes: '' });
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [overpayAsk, setOverpayAsk] = useState<string | null>(null);
  const [key] = useState(newKey);

  const pupils = useQuery({
    queryKey: ['pupil-pick', pupilSearch],
    queryFn: () => api.get<Paged<{ id: number; pupilCode: string; fullName: string; className: string; status: string }>>(`/pupils${qs({ search: pupilSearch, pageSize: 15 })}`),
    enabled: pupilSearch.length >= 2,
  });
  const pupil = useQuery({ queryKey: ['pupil', pupilId], queryFn: () => api.get<{ id: number; pupilCode: string; fullName: string; className: string; status: string; totals: { balance: string } }>(`/pupils/${pupilId}`), enabled: !!pupilId });
  const charges = useQuery({ queryKey: ['allocatable', pupilId], queryFn: () => api.get<Charge[]>(`/payments/allocatable/${pupilId}`), enabled: !!pupilId });
  useEffect(() => setAmounts({}), [pupilId]);

  const lines = useMemo(() => Object.entries(amounts).filter(([, v]) => Number(cleanAmount(v)) > 0).map(([id, v]) => ({ chargeId: Number(id), amount: cleanAmount(v) })), [amounts]);
  const total = sumMoney(lines.map((l) => l.amount));
  const overpaid = (charges.data ?? []).filter((c) => Number(cleanAmount(amounts[c.id] ?? '')) > Number(c.balance));

  const save = useMutation({
    mutationFn: (ack: boolean) => api.post<{ id: number; receiptNo: string; repeated: boolean; warnings: string[] }>('/payments', {
      pupilId: Number(pupilId), paymentDate: form.paymentDate, method: form.method, reference: form.reference, notes: form.notes,
      idempotencyKey: key, acknowledgeOverpayment: ack, lines,
    }),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      navigate(`/receipts/${r.receiptNo}${r.warnings.length ? `?warn=${encodeURIComponent(r.warnings.join(' '))}` : ''}`);
    },
    onError: (e) => { if (e instanceof ApiError && e.code === 'OVERPAYMENT') setOverpayAsk(e.message); },
  });

  const payOldestFirst = (amount: number) => {
    const next: Record<number, string> = {};
    let left = amount;
    for (const c of charges.data ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, Number(c.balance));
      next[c.id] = take.toFixed(2);
      left -= take;
    }
    setAmounts(next);
  };
  const [quick, setQuick] = useState('');

  return (
    <div className="max-w-5xl">
      <PageHeader title="Record a payment" crumbs={[{ label: 'Payments', to: '/payments' }, { label: 'New' }]} subtitle="One receipt per visit. Split the money across the fee items the parent is paying for." />
      {!pupilId ? (
        <Card title="1. Find the pupil">
          <TextInput label="Pupil name or ID" placeholder="Type at least 2 letters" value={pupilSearch} onChange={(e) => setPupilSearch(e.target.value)} autoFocus />
          <ul className="mt-3 divide-y divide-slate-100">
            {pupils.data?.items.map((p) => (
              <li key={p.id}><button type="button" className="flex w-full items-center justify-between px-2 py-2 text-left hover:bg-slate-50" onClick={() => setPupilId(String(p.id))}>
                <span><span className="font-medium">{p.fullName}</span> <span className="font-mono text-xs text-slate-500">{p.pupilCode}</span></span>
                <span className="text-sm text-slate-500">{p.className} <StatusBadge status={p.status} /></span>
              </button></li>
            ))}
          </ul>
          {pupils.data?.items.length === 0 && <p className="mt-2 text-sm text-slate-500">No pupil found.</p>}
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-lg font-semibold">{pupil.data?.fullName}</p>
                <p className="text-sm text-slate-600"><span className="font-mono">{pupil.data?.pupilCode}</span> · {pupil.data?.className} {pupil.data && <StatusBadge status={pupil.data.status} />}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-500">Outstanding (all years)</p>
                <p className="text-xl font-semibold"><Money value={pupil.data?.totals.balance} credit /></p>
              </div>
              <Button variant="ghost" onClick={() => { setPupilId(''); setPupilSearch(''); }}>Change pupil</Button>
            </div>
          </Card>
          <Card title="2. Allocate the money" padded={false}
            actions={<div className="flex items-end gap-2"><input className="input w-36 text-right" inputMode="decimal" placeholder="Amount received" aria-label="Amount received" value={quick} onChange={(e) => setQuick(e.target.value)} /><Button variant="secondary" disabled={!Number(cleanAmount(quick))} onClick={() => payOldestFirst(Number(cleanAmount(quick)))}>Fill oldest first</Button></div>}>
            {charges.isLoading ? <Loading /> : charges.data?.length === 0 ? <div className="p-4"><Empty title="Nothing is owed">This pupil has no unpaid charges. A payment must go against a charge, so add the charge first.</Empty></div> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Term</th><th>Fee item</th><th className="num">Net due</th><th className="num">Paid so far</th><th className="num">Balance</th><th className="num">Paying now</th></tr></thead>
                  <tbody>
                    {charges.data?.map((c) => {
                      const v = amounts[c.id] ?? '';
                      const over = Number(cleanAmount(v)) > Number(c.balance);
                      return (
                        <tr key={c.id}>
                          <td>{c.termLabel}</td>
                          <td>{c.feeItemName}{c.arrearsFrom && <span className="block text-xs text-slate-500">from {c.arrearsFrom}</span>}</td>
                          <td className="num"><Money value={c.netDue} /></td>
                          <td className="num"><Money value={c.totalPaid} /></td>
                          <td className="num font-medium"><Money value={c.balance} /></td>
                          <td className="num">
                            <div className="flex items-center justify-end gap-1">
                              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setAmounts({ ...amounts, [c.id]: c.balance })}>Full</button>
                              <input className={`input w-32 text-right ${over ? 'border-amber-500' : ''}`} inputMode="decimal" aria-label={`Paying now for ${c.feeItemName}, ${c.termLabel}`} value={v} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })} />
                            </div>
                            {over && <span className="text-xs text-amber-700">More than the balance</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td colSpan={5} className="px-3 py-2 text-right font-semibold">Receipt total</td><td className="num px-3 py-2 text-lg font-semibold">UGX {formatMoney(total)}</td></tr></tfoot>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card title="3. Payment details">
            <div className="grid gap-4 sm:grid-cols-3">
              <DateInput label="Date paid" value={form.paymentDate} onChange={(v) => setForm({ ...form, paymentDate: v })} required />
              <Select label="Method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} placeholder="Choose…" options={options('PAYMENT_METHOD')} required />
              <TextInput label="Reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} hint="Bank slip, mobile money transaction ID or cheque number" />
              <div className="sm:col-span-3"><TextArea label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2} /></div>
            </div>
            {overpaid.length > 0 && <div className="mt-3"><Notice tone="warning">{overpaid.map((c) => c.feeItemName).join(', ')}: the amount is more than the balance. The extra is kept as a credit on that item.</Notice></div>}
            <div className="mt-4 space-y-3">
              <ErrorBox error={save.error instanceof ApiError && save.error.code === 'OVERPAYMENT' ? null : save.error} />
              <Button busy={save.isPending} disabled={!lines.length || !form.method || !form.paymentDate} onClick={() => save.mutate(false)}>Save and issue receipt (UGX {formatMoney(total)})</Button>
            </div>
          </Card>
        </div>
      )}
      <Modal open={!!overpayAsk} title="Record an overpayment?" onClose={() => setOverpayAsk(null)}
        footer={<><Button variant="secondary" onClick={() => setOverpayAsk(null)}>Go back and correct</Button><Button busy={save.isPending} onClick={() => { setOverpayAsk(null); save.mutate(true); }}>Yes, record the overpayment</Button></>}>
        <p className="text-sm">{overpayAsk}</p>
      </Modal>
    </div>
  );
}

interface ReceiptData {
  school: { name: string; address: string | null; phone: string | null; email: string | null; registrationNo: string | null; footer: string | null };
  id: number; receiptNo: string; paymentDate: string; termLabel: string;
  pupil: { id: number; pupilCode: string; fullName: string; className: string; sectionName: string; guardianName: string | null };
  lines: Array<{ chargeId: number; chargeNo: string; feeItemName: string; termLabel: string; amount: string; balanceAfter: string }>;
  total: string; method: string; methodLabel: string; reference: string | null; notes: string | null; receivedByName: string; createdAt: string;
  reversed: boolean; reversal: { status: string; reason: string; requestedAt: string; decidedAt: string | null } | null; pupilOutstanding: string;
}

export function ReceiptPage() {
  const { receiptNo } = useParams();
  const [params] = useSearchParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['receipt', receiptNo], queryFn: () => api.get<ReceiptData>(`/payments/receipts/${receiptNo}`) });
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const reverse = useMutation({ mutationFn: () => api.post(`/payments/${q.data!.id}/reversal`, { reason }), onSuccess: () => { setReversing(false); void qc.invalidateQueries(); } });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const r = q.data;
  const warn = params.get('warn');
  return (
    <div className="max-w-3xl">
      <div className="no-print">
        <PageHeader title={`Receipt ${r.receiptNo}`} crumbs={[{ label: 'Payments', to: '/payments' }, { label: r.receiptNo }]}
          actions={<>
            <Button onClick={() => window.print()}>Print receipt</Button>
            <Link to={`/pupils/${r.pupil.id}`}><Button variant="secondary">Pupil</Button></Link>
            {can('payments.reverse.request') && !r.reversed && r.reversal?.status !== 'PENDING' && <Button variant="secondary" onClick={() => { setReason(''); setReversing(true); }}>Request reversal</Button>}
          </>} />
        {warn && <div className="mb-4"><Notice tone="warning">{warn}</Notice></div>}
        {r.reversal?.status === 'PENDING' && <div className="mb-4"><Notice tone="warning" title="Reversal waiting for approval">{r.reversal.reason}</Notice></div>}
        {r.reversal?.status === 'REJECTED' && <div className="mb-4"><Notice>A reversal was requested and rejected.</Notice></div>}
      </div>
      <article className="card print-area relative p-8">
        {r.reversed && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="-rotate-12 rounded border-4 border-red-600 px-6 py-2 text-5xl font-bold uppercase text-red-600/80">Reversed</span></div>}
        <header className="flex items-start justify-between border-b-2 border-accent-600 pb-4">
          <div>
            <h2 className="text-xl font-bold uppercase text-brand-900">{r.school.name}</h2>
            {r.school.address && <p className="text-sm">{r.school.address}</p>}
            <p className="text-sm">{[r.school.phone, r.school.email].filter(Boolean).join(' · ')}</p>
            {r.school.registrationNo && <p className="text-xs text-slate-500">Reg. No. {r.school.registrationNo}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold uppercase tracking-wide">Official receipt</p>
            <p className="font-mono text-lg">{r.receiptNo}</p>
            <p className="text-sm">Date: {formatDate(r.paymentDate)}</p>
          </div>
        </header>
        <section className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <p><span className="text-slate-500">Received from:</span> {r.pupil.guardianName ?? '—'}</p>
          <p><span className="text-slate-500">Pupil:</span> <strong>{r.pupil.fullName}</strong> ({r.pupil.pupilCode})</p>
          <p><span className="text-slate-500">Class:</span> {r.pupil.className} · {r.pupil.sectionName}</p>
          <p><span className="text-slate-500">Term:</span> {r.termLabel}</p>
        </section>
        <table className="mt-4 w-full text-sm">
          <thead><tr className="border-b border-slate-300 text-left"><th className="py-1">Fee item</th><th className="py-1">Term</th><th className="py-1 text-right">Amount (UGX)</th><th className="py-1 text-right">Balance left</th></tr></thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.chargeId} className="border-b border-slate-100"><td className="py-1.5">{l.feeItemName}</td><td>{l.termLabel}</td><td className="text-right tabular-nums">{formatMoney(l.amount)}</td><td className="text-right tabular-nums text-slate-600">{formatMoney(l.balanceAfter)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-800"><td colSpan={2} className="py-2 font-semibold">Total paid</td><td className="py-2 text-right text-lg font-bold tabular-nums">UGX {formatMoney(r.total)}</td><td /></tr></tfoot>
        </table>
        <section className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <p><span className="text-slate-500">Method:</span> {r.methodLabel}</p>
          <p><span className="text-slate-500">Reference:</span> {r.reference ?? '—'}</p>
          <p><span className="text-slate-500">Received by:</span> {r.receivedByName}</p>
          <p><span className="text-slate-500">Pupil’s total outstanding:</span> <strong>UGX {formatMoney(r.pupilOutstanding)}</strong></p>
          {r.notes && <p className="col-span-2"><span className="text-slate-500">Notes:</span> {r.notes}</p>}
        </section>
        <footer className="mt-12 grid grid-cols-2 gap-10 text-sm">
          <div className="border-t border-slate-400 pt-1 text-center text-slate-600">Received by (signature and stamp)</div>
          <div className="border-t border-slate-400 pt-1 text-center text-slate-600">Parent / guardian signature</div>
        </footer>
        <p className="mt-4 text-right text-xs text-slate-500">Printed {formatDateTime(new Date().toISOString())}</p>
        {r.school.footer && <p className="mt-4 text-center text-xs italic text-slate-600">{r.school.footer}</p>}
      </article>
      <Modal open={reversing} title="Request a reversal" onClose={() => setReversing(false)}
        footer={<><Button variant="secondary" onClick={() => setReversing(false)}>Cancel</Button><Button variant="danger" busy={reverse.isPending} disabled={reason.trim().length < 5} onClick={() => reverse.mutate()}>Send for approval</Button></>}>
        <p className="text-sm text-slate-600">The receipt is never deleted. Once someone else approves, it is marked reversed and stops counting, and the balances go back up.</p>
        <p className="text-sm text-slate-600">If a fee on this receipt has since been carried forward to a later term, the reversed amount is added to that pupil’s Arrears B/F charge, so it can be collected there.</p>
        <TextArea label="Reason" value={reason} onChange={setReason} required rows={3} />
        <ErrorBox error={reverse.error} />
      </Modal>
    </div>
  );
}
