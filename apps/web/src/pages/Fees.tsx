import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cleanAmount, sumMoney } from '../lib/format';
import { Button, Card, Empty, ErrorBox, Loading, Modal, Money, Notice, PageHeader, Select, TableWrap } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';

interface FeeLine { id: number; termId: number; classId: number; className: string; sectionName: string; feeItemId: number; feeItemName: string; frequency: string; mandatory: boolean; amount: string }
interface EditLine { feeItemId: number; amount: string; mandatory: boolean; included: boolean }

export const FREQ: Record<string, string> = { TERM: 'Every term', YEAR: 'Once a year', ONCE: 'Once only' };

export function FeesPage() {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const qc = useQueryClient();
  const [scope, setScope] = useState('');
  const termId = scopeParams(scope).termId;
  const term = lookups?.terms.find((t) => t.id === termId);
  const [classId, setClassId] = useState('');
  const [edit, setEdit] = useState<EditLine[] | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [fromTermId, setFromTermId] = useState('');

  const all = useQuery({ queryKey: ['fees', termId], queryFn: () => api.get<FeeLine[]>(`/fees${qs({ termId })}`), enabled: !!termId });
  const classes = useMemo(() => (lookups?.classes ?? []).filter((c) => c.active), [lookups]);
  const items = useMemo(() => (lookups?.feeItems ?? []).filter((i) => i.active && !i.isSystem), [lookups]);
  const selectedClass = classes.find((c) => String(c.id) === classId);
  const lines = (all.data ?? []).filter((l) => String(l.classId) === classId);
  const editable = can('fees.manage') && term?.status !== 'CLOSED';

  useEffect(() => setEdit(null), [termId, classId]);
  useEffect(() => {
    if (!classId && classes[0]) setClassId(String(classes[0].id));
  }, [classes, classId]);

  const startEdit = () =>
    setEdit(items.map((i) => {
      const l = lines.find((x) => x.feeItemId === i.id);
      return { feeItemId: i.id, amount: l ? l.amount : '', mandatory: l ? l.mandatory : i.defaultMandatory, included: !!l };
    }));

  const save = useMutation({
    mutationFn: () => api.put('/fees', {
      termId, classId: Number(classId),
      lines: edit!.filter((l) => l.included).map((l) => ({ feeItemId: l.feeItemId, amount: cleanAmount(l.amount), mandatory: l.mandatory })),
    }),
    onSuccess: () => { setEdit(null); void qc.invalidateQueries({ queryKey: ['fees'] }); },
  });
  const copy = useMutation({
    mutationFn: () => api.post<{ copied: number; skipped: number }>('/fees/copy', { fromTermId: Number(fromTermId), toTermId: termId }),
    onSuccess: () => { setCopyOpen(false); void qc.invalidateQueries({ queryKey: ['fees'] }); },
  });

  // Summary per class for the selected term.
  const byClass = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of all.data ?? []) m.set(l.classId, (m.get(l.classId) ?? 0) + Number(l.amount));
    return m;
  }, [all.data]);

  return (
    <div>
      <PageHeader title="Fee structure" subtitle="What each class pays per fee item in a term. Billing uses these amounts."
        actions={editable && <Button variant="secondary" onClick={() => setCopyOpen(true)}>Copy from another term</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <TermSelect value={scope} onChange={setScope} />
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} options={classes.map((c) => ({ value: c.id, label: `${c.name} (${c.sectionName})` }))} />
      </div>
      {term?.status === 'CLOSED' && <div className="mb-4"><Notice tone="warning">This term is closed, so its fees can no longer change.</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2" title={selectedClass ? `${selectedClass.name} · ${term?.label ?? ''}` : 'Fees'}
          actions={editable && !edit && <Button onClick={startEdit}>Edit fees</Button>}>
          <ErrorBox error={all.error} />
          {all.isLoading ? <Loading /> : edit ? (
            <div>
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Charge</th><th>Fee item</th><th>How often</th><th>Mandatory</th><th className="num">Amount (UGX)</th></tr></thead>
                  <tbody>
                    {edit.map((l, idx) => {
                      const item = items.find((i) => i.id === l.feeItemId)!;
                      const upd = (patch: Partial<EditLine>) => setEdit(edit.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
                      return (
                        <tr key={l.feeItemId}>
                          <td><input type="checkbox" aria-label={`Charge ${item.name}`} checked={l.included} onChange={(e) => upd({ included: e.target.checked })} /></td>
                          <td>{item.name}</td>
                          <td className="text-xs text-slate-500">{FREQ[item.frequency] ?? item.frequency}</td>
                          <td><input type="checkbox" aria-label={`${item.name} mandatory`} checked={l.mandatory} disabled={!l.included} onChange={(e) => upd({ mandatory: e.target.checked })} /></td>
                          <td className="num"><input className="input w-36 text-right" inputMode="decimal" aria-label={`${item.name} amount`} disabled={!l.included} value={l.amount} onChange={(e) => upd({ amount: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td colSpan={4} className="font-semibold">Total per pupil (all items)</td><td className="num font-semibold"><Money value={sumMoney(edit.filter((l) => l.included).map((l) => cleanAmount(l.amount)))} /></td></tr></tfoot>
                </table>
              </TableWrap>
              <div className="space-y-3 p-4">
                <ErrorBox error={save.error} />
                <div className="flex gap-2">
                  <Button busy={save.isPending} onClick={() => save.mutate()}>Save fees</Button>
                  <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
                </div>
              </div>
            </div>
          ) : lines.length === 0 ? (
            <div className="p-4"><Empty title="No fees entered for this class and term">{editable ? 'Choose “Edit fees” to add them, or copy last term’s fees.' : ''}</Empty></div>
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Fee item</th><th>How often</th><th>Mandatory</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.feeItemName}</td>
                      <td className="text-xs text-slate-500">{FREQ[l.frequency] ?? l.frequency}</td>
                      <td>{l.mandatory ? 'Yes' : 'Optional'}</td>
                      <td className="num"><Money value={l.amount} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3} className="font-semibold">Total per pupil</td><td className="num font-semibold"><Money value={sumMoney(lines.map((l) => l.amount))} /></td></tr></tfoot>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="All classes this term" padded={false}>
          <table className="table">
            <thead><tr><th>Class</th><th className="num">Total per pupil</th></tr></thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id} className={String(c.id) === classId ? 'bg-brand-50' : ''}>
                  <td><button type="button" className="link" onClick={() => setClassId(String(c.id))}>{c.name}</button></td>
                  <td className="num">{byClass.has(c.id) ? <Money value={byClass.get(c.id)} /> : <span className="text-xs text-amber-700">Not set</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Modal open={copyOpen} title="Copy fees from another term" onClose={() => setCopyOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setCopyOpen(false)}>Cancel</Button><Button busy={copy.isPending} disabled={!fromTermId} onClick={() => copy.mutate()}>Copy fees</Button></>}>
        <p className="text-sm text-slate-600">Copies every class’s fee lines into {term?.label}. Lines already entered for {term?.label} are kept as they are. You can edit the copied amounts afterwards.</p>
        <Select label="Copy from" value={fromTermId} onChange={(e) => setFromTermId(e.target.value)} placeholder="Choose a term…" options={(lookups?.terms ?? []).filter((t) => t.id !== termId).map((t) => ({ value: t.id, label: t.label }))} />
        {copy.data && <Notice tone="success">Copied {copy.data.copied} lines.</Notice>}
        <ErrorBox error={copy.error} />
      </Modal>
    </div>
  );
}
