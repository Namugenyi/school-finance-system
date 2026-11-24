import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, newKey } from '../lib/api';
import { useLookups } from '../lib/auth';
import { cleanAmount, formatDateTime } from '../lib/format';
import { Button, Card, DateInput, Empty, ErrorBox, Modal, Money, Notice, PageHeader, Select, Stat, TableWrap } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';

interface Row { key: string; pupilId: number; pupilCode: string; pupilName: string; feeItemId: number; feeItemName: string; frequency: string; mandatory: boolean; amount: string; skipReason: string | null; duplicate: boolean }
interface Preview {
  term: { id: number; label: string; status: string };
  class: { id: number; name: string; sectionName: string };
  counts: { feeItems: number; activePupils: number; proposedRows: number; billableRows: number; skippedRows: number };
  totalAmount: string; diagnostics: string[]; rows: Row[];
}
interface Decision { include: boolean; discount: string; discountReason: string; overrideReason: string }
interface Result { batchId: number; repeated: boolean; created: number; skipped: Array<{ pupilName: string; feeItemName: string; reason: string }>; totalAmount: string; termLabel: string; className: string }

export function BillingPage() {
  const { lookups } = useLookups();
  const qc = useQueryClient();
  const [scope, setScope] = useState('');
  const [classId, setClassId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newKey);
  const [result, setResult] = useState<Result | null>(null);
  const termId = scopeParams(scope).termId;

  const batches = useQuery({ queryKey: ['billing-batches'], queryFn: () => api.get<Array<{ id: number; termLabel: string; className: string; createdCount: number; skippedCount: number; totalAmount: string; createdAt: string }>>('/billing/batches?pageSize=10') });
  const previewM = useMutation({
    mutationFn: () => api.post<Preview>('/billing/preview', { termId, classId: Number(classId) }),
    onSuccess: (p) => { setPreview(p); setDecisions({}); setResult(null); setKey(newKey()); },
  });
  const dec = (k: string): Decision => decisions[k] ?? { include: true, discount: '', discountReason: '', overrideReason: '' };
  const setDec = (k: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d, [k]: { ...dec(k), ...patch } }));

  const willCharge = (r: Row) => {
    const d = dec(r.key);
    if (!d.include || r.duplicate) return false;
    if (r.skipReason && !d.overrideReason.trim()) return false;
    return Number(r.amount) > 0;
  };
  const totals = useMemo(() => {
    if (!preview) return { count: 0, amount: 0, discounts: 0 };
    const rows = preview.rows.filter(willCharge);
    return {
      count: rows.length,
      amount: rows.reduce((s, r) => s + Number(r.amount), 0),
      discounts: rows.reduce((s, r) => s + Number(cleanAmount(dec(r.key).discount) || 0), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, decisions]);

  const postM = useMutation({
    mutationFn: () => api.post<Result>('/billing/post', {
      termId, classId: Number(classId), idempotencyKey: key, dueDate: dueDate || null, confirm: true,
      rows: Object.entries(decisions).map(([k, d]) => ({
        key: k, include: d.include, discount: cleanAmount(d.discount) || null, discountReason: d.discountReason || null, overrideReason: d.overrideReason || null,
      })),
    }),
    onSuccess: (r) => { setResult(r); setConfirming(false); setPreview(null); void qc.invalidateQueries(); },
  });

  // Group rows by pupil for the review table.
  const byPupil = useMemo(() => {
    const m = new Map<number, Row[]>();
    for (const r of preview?.rows ?? []) m.set(r.pupilId, [...(m.get(r.pupilId) ?? []), r]);
    return [...m.values()];
  }, [preview]);

  return (
    <div>
      <PageHeader title="Term billing" subtitle="Charge a class for the term from its fee structure. Preview, review each pupil, then post." crumbs={[{ label: 'Charges', to: '/charges' }, { label: 'Billing' }]} />
      <Card>
        <div className="grid items-end gap-3 sm:grid-cols-4">
          <TermSelect value={scope} onChange={(v) => { setScope(v); setPreview(null); }} />
          <Select label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setPreview(null); }} placeholder="Choose…" options={(lookups?.classes ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name} (${c.sectionName})` }))} />
          <DateInput label="Due date (optional)" value={dueDate} onChange={setDueDate} />
          <div><Button busy={previewM.isPending} disabled={!termId || !classId} onClick={() => previewM.mutate()}>Preview charges</Button></div>
        </div>
        <div className="mt-3"><ErrorBox error={previewM.error} /></div>
      </Card>

      {result && (
        <div className="mt-4">
          <Notice tone="success" title={result.repeated ? 'These charges were already posted' : 'Charges posted'}>
            {result.created} charges for {result.className}, {result.termLabel}, totalling UGX <Money value={result.totalAmount} />. {result.skipped.length > 0 && `${result.skipped.length} rows were not charged.`} <Link to="/charges" className="link">View charges</Link>
          </Notice>
          {result.skipped.length > 0 && (
            <Card title="Not charged" padded={false} className="mt-3">
              <table className="table"><thead><tr><th>Pupil</th><th>Fee item</th><th>Reason</th></tr></thead>
                <tbody>{result.skipped.map((s, i) => <tr key={i}><td>{s.pupilName}</td><td>{s.feeItemName}</td><td>{s.reason}</td></tr>)}</tbody></table>
            </Card>
          )}
        </div>
      )}

      {preview && (
        <div className="mt-4 space-y-4">
          {preview.term.status === 'CLOSED' && <Notice tone="warning">{preview.term.label} is closed. Posting needs the post-close permission and every charge will be flagged as entered after close.</Notice>}
          {preview.diagnostics.map((d, i) => <Notice key={i} tone="danger" title="Cannot bill yet">{d}</Notice>)}
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Active pupils" value={preview.counts.activePupils} />
            <Stat label="Fee items" value={preview.counts.feeItems} />
            <Stat label="Charges to post" value={totals.count} hint={`${preview.counts.proposedRows - totals.count} not charged`} />
            <Stat label="Total to charge (UGX)" value={<Money value={totals.amount} />} hint={totals.discounts ? <>Discounts requested: <Money value={totals.discounts} /></> : undefined} />
          </div>
          {byPupil.length > 0 && (
            <Card title={`Review: ${preview.class.name}, ${preview.term.label}`} padded={false}
              actions={<Button disabled={preview.diagnostics.length > 0 || totals.count === 0} onClick={() => setConfirming(true)}>Post {totals.count} charges</Button>}>
              <p className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">Untick an optional item a pupil does not take. Mandatory items cannot be removed. A discount you enter here is sent for approval and only counts once approved. A once-only or yearly fee already charged is skipped unless you give a reason to charge it again.</p>
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Pupil</th><th>Fee item</th><th className="num">Amount</th><th>Charge</th><th>Discount (UGX)</th><th>Discount reason</th><th>Note</th></tr></thead>
                  <tbody>
                    {byPupil.map((rows) => rows.map((r, i) => {
                      const d = dec(r.key);
                      const charged = willCharge(r);
                      return (
                        <tr key={r.key} className={charged ? '' : 'bg-slate-50 text-slate-500'}>
                          <td>{i === 0 && <><span className="font-medium text-slate-900">{r.pupilName}</span><span className="block font-mono text-xs text-slate-500">{r.pupilCode}</span></>}</td>
                          <td>{r.feeItemName}{r.mandatory && <span className="ml-1 text-xs text-slate-500">(mandatory)</span>}</td>
                          <td className="num"><Money value={r.amount} /></td>
                          <td><input type="checkbox" aria-label={`Charge ${r.feeItemName} to ${r.pupilName}`} checked={d.include} disabled={r.mandatory || r.duplicate} onChange={(e) => setDec(r.key, { include: e.target.checked })} /></td>
                          <td><input className="input w-28 text-right" inputMode="decimal" aria-label={`Discount for ${r.pupilName}, ${r.feeItemName}`} disabled={!charged} value={d.discount} onChange={(e) => setDec(r.key, { discount: e.target.value })} /></td>
                          <td><input className="input w-40" aria-label={`Discount reason for ${r.pupilName}, ${r.feeItemName}`} disabled={!charged || !d.discount} value={d.discountReason} onChange={(e) => setDec(r.key, { discountReason: e.target.value })} /></td>
                          <td className="whitespace-normal text-xs">
                            {r.duplicate ? <span className="text-amber-800">Already charged this term</span> : r.skipReason ? (
                              <div>
                                <span className="text-amber-800">{r.skipReason}.</span>
                                <input className="input mt-1 w-48" placeholder="Reason to charge again" aria-label={`Reason to charge ${r.feeItemName} again for ${r.pupilName}`} value={d.overrideReason} onChange={(e) => setDec(r.key, { overrideReason: e.target.value })} />
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}
        </div>
      )}

      {!preview && !result && (
        <Card title="Recent billing runs" padded={false} className="mt-4">
          {batches.data?.length === 0 ? <div className="p-4"><Empty title="No classes billed yet" /></div> : (
            <table className="table">
              <thead><tr><th>Posted</th><th>Term</th><th>Class</th><th className="num">Charges</th><th className="num">Not charged</th><th className="num">Total</th></tr></thead>
              <tbody>
                {batches.data?.map((b) => (
                  <tr key={b.id}><td>{formatDateTime(b.createdAt)}</td><td>{b.termLabel}</td><td>{b.className}</td><td className="num">{b.createdCount}</td><td className="num">{b.skippedCount}</td><td className="num"><Money value={b.totalAmount} /></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Modal open={confirming} title="Post these charges?" onClose={() => setConfirming(false)}
        footer={<><Button variant="secondary" onClick={() => setConfirming(false)}>Go back</Button><Button busy={postM.isPending} onClick={() => postM.mutate()}>Yes, post {totals.count} charges</Button></>}>
        <p className="text-sm">You are about to charge <strong>{totals.count}</strong> fee lines to {preview?.class.name} for {preview?.term.label}, totalling <strong>UGX <Money value={totals.amount} /></strong>.</p>
        <p className="text-sm text-slate-600">Posting twice is safe: pressing this again will not create duplicate charges.</p>
        <ErrorBox error={postM.error} />
      </Modal>
    </div>
  );
}
