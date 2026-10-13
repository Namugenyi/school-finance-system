import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatMoney, formatRate } from '../lib/format';
import { Button, Card, DecisionButtons, Empty, ErrorBox, Loading, Modal, Notice, PageHeader, StatusBadge, TableWrap, TextArea } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import { FiguresTable } from '../components/FiguresTable';
import type { Figures } from '../lib/types';

interface Readiness {
  term: { id: number; label: string; status: string; startDate: string; endDate: string };
  blockers: string[]; warnings: string[]; figures: Figures;
  postCloseExceptions: Array<{ type: string; ref: string; at: string }>;
}
interface Snapshot extends Record<string, unknown> {
  id: number; termId: number; termLabel?: string; version: number; supersedesId: number | null; status: string; collectionRate: string | null;
  totalBilled: string; totalCollected: string; outstanding: string; totalExpenses: string; netResult: string;
  notes: string | null; recordedById: number; recordedByName: string; recordedAt: string; approvedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  detail: {
    byClass?: Array<{ className: string; totalBilled: string; totalCollected: string; outstanding: string; collectionRate: string | null }>;
    byFeeItem?: Array<{ feeItemName: string; netBilled: string; collected: string; outstanding: string }>;
    expensesByCategory?: Array<{ categoryLabel: string; schoolFunded: string; ownerFunded: string; otherFunded: string; total: string }>;
    credits?: string; collectedOnArrears?: string; warnings?: string[];
  };
}

export function TermClosePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [scope, setScope] = useState('');
  const termId = scopeParams(scope).termId;
  const ready = useQuery({ queryKey: ['readiness', termId], queryFn: () => api.get<Readiness>(`/term-close/${termId}/readiness`), enabled: !!termId });
  const snaps = useQuery({ queryKey: ['snapshots', termId], queryFn: () => api.get<Snapshot[]>(`/term-close/snapshots${qs({ termId })}`), enabled: !!termId });
  const [preparing, setPreparing] = useState(false);
  const [notes, setNotes] = useState('');
  const prepare = useMutation({ mutationFn: () => api.post<Snapshot>(`/term-close/${termId}/prepare`, { notes: notes || null, confirm: true }), onSuccess: () => { setPreparing(false); void qc.invalidateQueries(); } });
  const r = ready.data;
  return (
    <div>
      <PageHeader title="Term close" subtitle="Check the term, record a snapshot of its figures, and have the Head Teacher approve it. Approval closes the term and freezes the snapshot." />
      <div className="mb-4 max-w-sm"><TermSelect value={scope} onChange={setScope} /></div>
      <ErrorBox error={ready.error} />
      {ready.isLoading && <Loading />}
      {r && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title={<span className="flex items-center gap-2">{r.term.label} <StatusBadge status={r.term.status} /></span>}
              actions={can('termclose.prepare') && <Button disabled={r.blockers.length > 0} onClick={() => { setNotes(''); setPreparing(true); }}>{r.term.status === 'CLOSED' ? 'Prepare a revised snapshot' : 'Prepare close snapshot'}</Button>}>
              {r.blockers.length > 0 ? (
                <Notice tone="danger" title="Settle these before closing"><ul className="list-disc pl-5">{r.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>{can('approvals.view') && <Link to="/approvals" className="link">Open approvals</Link>}</Notice>
              ) : <Notice tone="success">Nothing is blocking the close.</Notice>}
              {r.warnings.length > 0 && <div className="mt-3"><Notice tone="warning" title="Worth checking"><ul className="list-disc pl-5">{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice></div>}
              {r.postCloseExceptions.length > 0 && (
                <div className="mt-3"><Notice tone="warning" title="Entered after this term was closed">
                  <ul className="list-disc pl-5">{r.postCloseExceptions.map((e, i) => <li key={i}>{e.type} {e.ref} on {formatDateTime(e.at)}</li>)}</ul>
                  These change the figures, so prepare a revised snapshot for approval.
                </Notice></div>
              )}
            </Card>
            <Card title="Live figures" padded={false}><FiguresTable figures={r.figures} /></Card>
          </div>
          <Card title="Snapshots" padded={false}>
            {snaps.data?.length === 0 ? <div className="p-4"><Empty title="No snapshot yet" /></div> : (
              <ul className="divide-y divide-slate-100">
                {snaps.data?.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-center justify-between"><Link to={`/term-close/snapshots/${s.id}`} className="link">Version {s.version}</Link><StatusBadge status={s.status} /></div>
                    <p className="text-xs text-slate-500">By {s.recordedByName}, {formatDateTime(s.recordedAt)}</p>
                    {s.approvedByName && <p className="text-xs text-slate-500">{s.status === 'APPROVED' ? 'Approved' : 'Decided'} by {s.approvedByName}, {formatDateTime(s.decidedAt)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <Modal open={preparing} title="Prepare the close snapshot" onClose={() => setPreparing(false)}
        footer={<><Button variant="secondary" onClick={() => setPreparing(false)}>Cancel</Button><Button busy={prepare.isPending} onClick={() => prepare.mutate()}>I have checked the figures, record the snapshot</Button></>}>
        <p className="text-sm text-slate-600">The current figures are copied into a snapshot and sent for approval. Approval closes {r?.term.label}; after that, only people with the post-close permission can change it, and every change is flagged.</p>
        <TextArea label="Notes for the approver" value={notes} onChange={setNotes} rows={3} />
        <ErrorBox error={prepare.error} />
      </Modal>
    </div>
  );
}

export function SnapshotPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['snapshot', id], queryFn: () => api.get<Snapshot>(`/term-close/snapshots/${id}`) });
  const live = useQuery({ queryKey: ['readiness', q.data?.termId], queryFn: () => api.get<Readiness>(`/term-close/${q.data!.termId}/readiness`), enabled: !!q.data && q.data.status === 'PENDING' });
  const decide = useMutation({ mutationFn: ({ approve, note }: { approve: boolean; note: string }) => api.post(`/term-close/snapshots/${id}/decide`, { approve, note: note || null }), onSuccess: () => void qc.invalidateQueries() });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  const figures = s as unknown as Figures;
  const d = s.detail ?? {};
  return (
    <div>
      <PageHeader title={`${s.termLabel ?? 'Term'} close · version ${s.version}`} crumbs={[{ label: 'Term close', to: '/term-close' }, { label: `Version ${s.version}` }]}
        subtitle={<span className="flex items-center gap-2"><StatusBadge status={s.status} /> Recorded by {s.recordedByName} on {formatDateTime(s.recordedAt)}</span>}
        actions={<Button variant="secondary" onClick={() => window.print()}>Print</Button>} />
      {s.supersedesId && <div className="mb-4"><Notice>This revises an earlier approved snapshot (<Link className="link" to={`/term-close/snapshots/${s.supersedesId}`}>see it</Link>). Both are kept.</Notice></div>}
      {s.status === 'APPROVED' && <div className="mb-4"><Notice tone="success">Approved by {s.approvedByName} on {formatDateTime(s.decidedAt)}. This snapshot is frozen and cannot be edited.</Notice></div>}
      {s.status === 'REJECTED' && <div className="mb-4"><Notice tone="warning" title={`Rejected by ${s.approvedByName}`}>{s.decisionNote}</Notice></div>}
      {s.notes && <div className="mb-4"><Notice title="Notes">{s.notes}</Notice></div>}
      {s.status === 'PENDING' && can('termclose.approve') && (
        <Card className="no-print mb-4" title="Decision">
          <p className="mb-3 text-sm text-slate-600">Approving closes the term. If any figure has changed since this was recorded (shown highlighted below), approval is refused and a new snapshot must be prepared.</p>
          <DecisionButtons busy={decide.isPending} onDecide={(approve, note) => decide.mutate({ approve, note })}
            disabledReason={s.recordedById === me?.id ? 'You recorded this snapshot, so someone else must approve it.' : null} />
          <div className="mt-2"><ErrorBox error={decide.error} /></div>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Figures" padded={false}><FiguresTable figures={{ ...figures, credits: d.credits ?? null, collectedOnArrears: d.collectedOnArrears ?? null } as Figures} compare={live.data?.figures} /></Card>
        <div className="space-y-4">
          {d.byClass && (
            <Card title="By class" padded={false}>
              <TableWrap><table className="table">
                <thead><tr><th>Class</th><th className="num">Billed</th><th className="num">Collected</th><th className="num">Outstanding</th><th className="num">Rate</th></tr></thead>
                <tbody>{d.byClass.map((c) => <tr key={c.className}><td>{c.className}</td><td className="num">{formatMoney(c.totalBilled)}</td><td className="num">{formatMoney(c.totalCollected)}</td><td className="num">{formatMoney(c.outstanding)}</td><td className="num">{formatRate(c.collectionRate)}</td></tr>)}</tbody>
              </table></TableWrap>
            </Card>
          )}
          {d.expensesByCategory && d.expensesByCategory.length > 0 && (
            <Card title="Expenses by category" padded={false}>
              <TableWrap><table className="table">
                <thead><tr><th>Category</th><th className="num">School</th><th className="num">Owner</th><th className="num">Other</th><th className="num">Total</th></tr></thead>
                <tbody>{d.expensesByCategory.map((c) => <tr key={c.categoryLabel}><td>{c.categoryLabel}</td><td className="num">{formatMoney(c.schoolFunded)}</td><td className="num">{formatMoney(c.ownerFunded)}</td><td className="num">{formatMoney(c.otherFunded)}</td><td className="num">{formatMoney(c.total)}</td></tr>)}</tbody>
              </table></TableWrap>
            </Card>
          )}
          {d.warnings && d.warnings.length > 0 && <Notice tone="warning" title="Noted at the time"><ul className="list-disc pl-5">{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
        </div>
      </div>
    </div>
  );
}
