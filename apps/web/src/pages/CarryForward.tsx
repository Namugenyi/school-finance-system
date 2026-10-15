import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, newKey } from '../lib/api';
import { useLookups } from '../lib/auth';
import { formatDateTime, formatMoney } from '../lib/format';
import { Button, Card, DateInput, Empty, ErrorBox, Modal, Money, Notice, PageHeader, Select, Stat, TableWrap } from '../components/ui';
import type { Charge } from '../lib/types';

interface Row extends Charge { blockedReason: string | null }
interface Preview { source: { id: number; label: string }; dest: { id: number; label: string; status: string }; counts: { examined: number; withBalance: number; ready: number; blocked: number }; totalArrears: string; diagnostics: string[]; rows: Row[] }

export function CarryForwardPage() {
  const { lookups } = useLookups();
  const qc = useQueryClient();
  const [source, setSource] = useState('');
  const [dest, setDest] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newKey);
  const [result, setResult] = useState<{ carried: number; totalAmount: string; repeated: boolean } | null>(null);
  const terms = lookups?.terms ?? [];
  const sourceTerm = terms.find((t) => String(t.id) === source);
  const batches = useQuery({ queryKey: ['carry-batches'], queryFn: () => api.get<Array<{ id: number; source: string; dest: string; chargeCount: number; totalAmount: string; createdAt: string }>>('/carry-forward/batches') });

  const previewM = useMutation({
    mutationFn: () => api.post<Preview>('/carry-forward/preview', { sourceTermId: Number(source), destTermId: Number(dest) }),
    onSuccess: (p) => { setPreview(p); setExcluded(new Set()); setResult(null); setKey(newKey()); },
  });
  const selected = useMemo(() => (preview?.rows ?? []).filter((r) => !r.blockedReason && !excluded.has(r.id)), [preview, excluded]);
  const total = selected.reduce((s, r) => s + Number(r.balance), 0);
  const post = useMutation({
    mutationFn: () => api.post<{ carried: number; totalAmount: string; repeated: boolean }>('/carry-forward/post', {
      sourceTermId: Number(source), destTermId: Number(dest), idempotencyKey: key, dueDate: dueDate || null, confirm: true,
      chargeIds: excluded.size ? selected.map((r) => r.id) : undefined,
    }),
    onSuccess: (r) => { setResult(r); setPreview(null); setConfirming(false); void qc.invalidateQueries(); },
  });

  return (
    <div>
      <PageHeader title="Carry forward arrears" subtitle="Move unpaid balances from a finished term into the next one. Each unpaid fee becomes its own Arrears B/F charge, and the old charge shows as carried forward so the debt is counted once." />
      <Card>
        <div className="grid items-end gap-3 sm:grid-cols-4">
          <Select label="From term" value={source} onChange={(e) => { setSource(e.target.value); setPreview(null); }} placeholder="Choose…" options={terms.map((t) => ({ value: t.id, label: `${t.label}${t.status === 'CLOSED' ? ' (closed)' : ''}` }))} />
          <Select label="To term" value={dest} onChange={(e) => { setDest(e.target.value); setPreview(null); }} placeholder="Choose…" options={terms.filter((t) => !sourceTerm || t.startDate > sourceTerm.startDate).map((t) => ({ value: t.id, label: t.label }))} />
          <DateInput label="Due date (optional)" value={dueDate} onChange={setDueDate} />
          <div><Button busy={previewM.isPending} disabled={!source || !dest} onClick={() => previewM.mutate()}>Preview</Button></div>
        </div>
        {sourceTerm && sourceTerm.status !== 'CLOSED' && <div className="mt-3"><Notice tone="warning">{sourceTerm.label} is still open. Normally you close the term first, so no more payments land on the old charges.</Notice></div>}
        <div className="mt-3"><ErrorBox error={previewM.error} /></div>
      </Card>
      {result && <div className="mt-4"><Notice tone="success" title={result.repeated ? 'Already carried forward' : 'Arrears carried forward'}>{result.carried} balances totalling UGX {formatMoney(result.totalAmount)} moved. <Link className="link" to="/arrears">View arrears</Link></Notice></div>}
      {preview && (
        <div className="mt-4 space-y-4">
          {preview.diagnostics.map((d, i) => <Notice key={i} tone="warning">{d}</Notice>)}
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Charges checked" value={preview.counts.examined} />
            <Stat label="With a balance" value={preview.counts.withBalance} />
            <Stat label="Blocked" value={preview.counts.blocked} hint="Discount waiting for approval" tone={preview.counts.blocked ? 'bad' : undefined} />
            <Stat label="To carry (UGX)" value={<Money value={total} />} hint={`${selected.length} charges`} />
          </div>
          {preview.rows.length > 0 && (
            <Card padded={false} title={`${preview.source.label} → ${preview.dest.label}`} actions={<Button disabled={!selected.length} onClick={() => setConfirming(true)}>Carry {selected.length} balances</Button>}>
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Carry</th><th>Pupil</th><th>Class</th><th>Fee item</th><th className="num">Net due</th><th className="num">Paid</th><th className="num">Balance</th><th>Note</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.id} className={r.blockedReason || excluded.has(r.id) ? 'bg-slate-50 text-slate-500' : ''}>
                        <td><input type="checkbox" aria-label={`Carry ${r.feeItemName} for ${r.pupilName}`} disabled={!!r.blockedReason} checked={!r.blockedReason && !excluded.has(r.id)}
                          onChange={(e) => { const s = new Set(excluded); if (e.target.checked) s.delete(r.id); else s.add(r.id); setExcluded(s); }} /></td>
                        <td>{r.pupilName}<span className="block font-mono text-xs text-slate-500">{r.pupilCode}</span></td>
                        <td>{r.className}</td>
                        <td>{r.feeItemName}{r.arrearsFrom && <span className="block text-xs text-slate-500">from {r.arrearsFrom}</span>}</td>
                        <td className="num"><Money value={r.netDue} /></td>
                        <td className="num"><Money value={r.totalPaid} /></td>
                        <td className="num font-medium"><Money value={r.balance} /></td>
                        <td className="whitespace-normal text-xs text-amber-800">{r.blockedReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}
        </div>
      )}
      {!preview && (
        <Card title="Earlier carry-forwards" padded={false} className="mt-4">
          {batches.data?.length === 0 ? <div className="p-4"><Empty title="Nothing carried forward yet" /></div> : (
            <table className="table">
              <thead><tr><th>When</th><th>From</th><th>To</th><th className="num">Charges</th><th className="num">Amount</th></tr></thead>
              <tbody>{batches.data?.map((b) => <tr key={b.id}><td>{formatDateTime(b.createdAt)}</td><td>{b.source}</td><td>{b.dest}</td><td className="num">{b.chargeCount}</td><td className="num"><Money value={b.totalAmount} /></td></tr>)}</tbody>
            </table>
          )}
        </Card>
      )}
      <Modal open={confirming} title="Carry these balances forward?" onClose={() => setConfirming(false)}
        footer={<><Button variant="secondary" onClick={() => setConfirming(false)}>Go back</Button><Button busy={post.isPending} onClick={() => post.mutate()}>Yes, carry forward</Button></>}>
        <p className="text-sm">{selected.length} unpaid balances totalling <strong>UGX {formatMoney(total)}</strong> will move from {preview?.source.label} to {preview?.dest.label}. Parents then pay them on the new Arrears B/F charges.</p>
        <ErrorBox error={post.error} />
      </Modal>
    </div>
  );
}
