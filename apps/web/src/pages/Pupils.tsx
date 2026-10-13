import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { formatDate, formatDateTime, todayIso } from '../lib/format';
import { Button, Card, DateInput, Dt, Empty, ErrorBox, Loading, Modal, Money, Notice, PageHeader, Pagination, Select, StatusBadge, TableWrap, Tabs, TextArea, TextInput } from '../components/ui';
import type { Charge, Paged } from '../lib/types';

interface Pupil {
  id: number; pupilCode: string; fullName: string; sex: string; dateOfBirth: string | null; dateJoined: string; classId: number; className: string;
  sectionName: string; status: string; guardianName: string | null; phonePrimary?: string | null; phoneAlt?: string | null; address?: string | null;
  emergencyContact?: string | null; notes: string | null; dateLeft: string | null; leavingReason: string | null; contactsHidden?: boolean;
}
interface PupilDetail extends Pupil {
  totals: { netDue: string; totalPaid: string; balance: string };
  history: Array<{ id: number; eventType: string; effectiveDate: string; termLabel: string | null; className: string; sectionName: string; status: string; leavingReason: string | null; note: string | null; createdAt: string; correctedAt: string | null }>;
}

export function PupilsPage() {
  const { can } = useAuth();
  const { lookups, options } = useLookups();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['pupils', search, status, classId, page],
    queryFn: () => api.get<Paged<Pupil>>(`/pupils${qs({ search, status, classId, page })}`),
    placeholderData: (prev) => prev,
  });
  useEffect(() => setPage(1), [search, status, classId]);
  return (
    <div>
      <PageHeader title="Pupils" subtitle="The pupil register. Click a name for history, charges and payments." actions={can('pupils.manage') && <Link to="/pupils/new"><Button>Register a pupil</Button></Link>} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-3">
          <TextInput label="Search" placeholder="Name, pupil ID, parent or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={options('PUPIL_STATUS')} />
          <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="All classes" options={(lookups?.classes ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.sectionName})` }))} />
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Loading /> : q.data && q.data.items.length === 0 ? (
          <div className="p-4"><Empty title="No pupils match">Try a different search or status.</Empty></div>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Pupil ID</th><th>Name</th><th>Class</th><th>Status</th><th>Parent / guardian</th><th>Phone</th><th>Joined</th></tr></thead>
              <tbody>
                {q.data?.items.map((p) => (
                  <tr key={p.id} className={p.status === 'ACTIVE' ? '' : p.status === 'WITHDRAWN' ? 'bg-red-50/40' : ''}>
                    <td className="font-mono text-xs">{p.pupilCode}</td>
                    <td><Link to={`/pupils/${p.id}`} className="link">{p.fullName}</Link></td>
                    <td>{p.className} <span className="text-xs text-slate-500">{p.sectionName}</span></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>{p.guardianName}</td>
                    <td>{p.contactsHidden ? <span className="text-xs text-slate-400">Hidden</span> : p.phonePrimary}</td>
                    <td><Dt value={p.dateJoined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {q.data && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}

const emptyForm = { fullName: '', sex: '', dateOfBirth: '', dateJoined: todayIso(), classId: '', guardianName: '', phonePrimary: '', phoneAlt: '', address: '', emergencyContact: '', notes: '' };

export function PupilFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { lookups, options } = useLookups();
  const [form, setForm] = useState(emptyForm);
  const existing = useQuery({ queryKey: ['pupil', id], queryFn: () => api.get<PupilDetail>(`/pupils/${id}`), enabled: editing });
  useEffect(() => {
    const p = existing.data;
    if (p) setForm({ fullName: p.fullName, sex: p.sex, dateOfBirth: p.dateOfBirth ?? '', dateJoined: p.dateJoined, classId: String(p.classId), guardianName: p.guardianName ?? '', phonePrimary: p.phonePrimary ?? '', phoneAlt: p.phoneAlt ?? '', address: p.address ?? '', emergencyContact: p.emergencyContact ?? '', notes: p.notes ?? '' });
  }, [existing.data]);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, dateOfBirth: form.dateOfBirth || null };
      if (editing) {
        const { classId: _c, ...rest } = body;
        void _c;
        return api.patch<Pupil>(`/pupils/${id}`, rest);
      }
      return api.post<Pupil>('/pupils', { ...body, classId: Number(form.classId) });
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['pupils'] });
      void qc.invalidateQueries({ queryKey: ['pupil'] });
      navigate(`/pupils/${p.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title={editing ? `Edit ${existing.data?.fullName ?? 'pupil'}` : 'Register a pupil'} crumbs={[{ label: 'Pupils', to: '/pupils' }, { label: editing ? 'Edit' : 'New' }]}
        subtitle={editing ? <>Pupil ID <span className="font-mono">{existing.data?.pupilCode}</span> never changes. Use “Change class” or “Change status” on the pupil page for those.</> : 'The pupil ID (STJA-YYYY-NNNN) is issued automatically when you save.'} />
      <form onSubmit={submit} className="space-y-6">
        <Card title="Pupil">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Full name" value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} required className="sm:col-span-2" />
            <Select label="Sex" value={form.sex} onChange={(e) => set('sex')(e.target.value)} placeholder="Choose…" options={options('SEX')} required />
            <DateInput label="Date of birth" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
            <DateInput label="Date joined" value={form.dateJoined} onChange={set('dateJoined')} required />
            {!editing && (
              <Select label="Class" value={form.classId} onChange={(e) => set('classId')(e.target.value)} placeholder="Choose…" required
                options={(lookups?.classes ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.name} (${c.sectionName})` }))} hint="The section comes from the class." />
            )}
          </div>
        </Card>
        <Card title="Parent or guardian">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Parent / guardian name" value={form.guardianName} onChange={(e) => set('guardianName')(e.target.value)} />
            <TextInput label="Primary telephone" value={form.phonePrimary} onChange={(e) => set('phonePrimary')(e.target.value)} placeholder="07XX XXX XXX or +256…" inputMode="tel" />
            <TextInput label="Alternative telephone" value={form.phoneAlt} onChange={(e) => set('phoneAlt')(e.target.value)} inputMode="tel" />
            <TextInput label="Emergency contact" value={form.emergencyContact} onChange={(e) => set('emergencyContact')(e.target.value)} placeholder="Name and phone" />
            <TextInput label="Physical address" value={form.address} onChange={(e) => set('address')(e.target.value)} className="sm:col-span-2" />
            <div className="sm:col-span-2"><TextArea label="Notes" value={form.notes} onChange={set('notes')} /></div>
          </div>
        </Card>
        <ErrorBox error={save.error} />
        <div className="flex gap-2">
          <Button type="submit" busy={save.isPending}>{editing ? 'Save changes' : 'Register pupil'}</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = { ENROLLED: 'Enrolled', PROMOTED: 'Promoted', CLASS_CHANGE: 'Class change', STATUS_CHANGE: 'Status change' };

export function PupilDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { lookups, label, options } = useLookups();
  const qc = useQueryClient();
  const [tab, setTab] = useState('charges');
  const [modal, setModal] = useState<'status' | 'class' | null>(null);
  const [historyEdit, setHistoryEdit] = useState<PupilDetail['history'][number] | null>(null);
  const q = useQuery({ queryKey: ['pupil', id], queryFn: () => api.get<PupilDetail>(`/pupils/${id}`) });
  const charges = useQuery({ queryKey: ['charges', 'pupil', id], queryFn: () => api.get<Paged<Charge>>(`/charges${qs({ pupilId: id, pageSize: 200 })}`), enabled: can('charges.view') });
  const payments = useQuery({ queryKey: ['payments', 'pupil', id], queryFn: () => api.get<Paged<{ id: number; receiptNo: string; paymentDate: string; total: string; method: string; items: string; reversed: boolean }>>(`/payments${qs({ pupilId: id, pageSize: 100 })}`), enabled: can('payments.view') });
  const refresh = () => void qc.invalidateQueries();

  const [statusForm, setStatusForm] = useState({ status: '', effectiveDate: todayIso(), leavingReason: '', note: '' });
  const [classForm, setClassForm] = useState({ classId: '', effectiveDate: todayIso(), eventType: 'PROMOTED', note: '' });
  const [histForm, setHistForm] = useState({ effectiveDate: '', note: '', reason: '' });
  const statusM = useMutation({ mutationFn: () => api.post(`/pupils/${id}/status`, { ...statusForm, leavingReason: statusForm.leavingReason || null, confirm: true }), onSuccess: () => { setModal(null); refresh(); } });
  const classM = useMutation({ mutationFn: () => api.post(`/pupils/${id}/class`, { ...classForm, classId: Number(classForm.classId) }), onSuccess: () => { setModal(null); refresh(); } });
  const histM = useMutation({ mutationFn: () => api.patch(`/pupils/${id}/history/${historyEdit!.id}`, histForm), onSuccess: () => { setHistoryEdit(null); refresh(); } });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const p = q.data;
  const leaving = ['WITHDRAWN', 'COMPLETED', 'TRANSFERRED', 'ALUMNI'].includes(statusForm.status);

  return (
    <div>
      <PageHeader
        title={p.fullName}
        crumbs={[{ label: 'Pupils', to: '/pupils' }, { label: p.pupilCode }]}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{p.pupilCode}</span> · {p.className} ({p.sectionName}) <StatusBadge status={p.status} /></span>}
        actions={
          <>
            {can('payments.record') && <Link to={`/payments/new?pupilId=${p.id}`}><Button>Record payment</Button></Link>}
            {can('statements.view') && <Link to={`/statements/${p.id}`}><Button variant="secondary">Statement</Button></Link>}
            {can('pupils.manage') && (
              <>
                <Link to={`/pupils/${p.id}/edit`}><Button variant="secondary">Edit details</Button></Link>
                <Button variant="secondary" onClick={() => setModal('class')}>Change class</Button>
                <Button variant="secondary" onClick={() => { setStatusForm({ status: '', effectiveDate: todayIso(), leavingReason: '', note: '' }); setModal('status'); }}>Change status</Button>
              </>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ['Sex', label('SEX', p.sex)], ['Date of birth', formatDate(p.dateOfBirth)], ['Date joined', formatDate(p.dateJoined)],
              ['Parent / guardian', p.guardianName], ['Primary telephone', p.contactsHidden ? 'Hidden for your role' : p.phonePrimary],
              ['Alternative telephone', p.contactsHidden ? 'Hidden for your role' : p.phoneAlt], ['Emergency contact', p.contactsHidden ? 'Hidden for your role' : p.emergencyContact],
              ['Address', p.contactsHidden ? 'Hidden for your role' : p.address],
              ...(p.dateLeft ? [['Date left', formatDate(p.dateLeft)], ['Reason for leaving', label('LEAVING_REASON', p.leavingReason)]] : []),
              ['Notes', p.notes],
            ].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5">{v || <span className="text-slate-400">—</span>}</dd></div>
            ))}
          </dl>
        </Card>
        <Card title="Account (all years)">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt>Net billed</dt><dd><Money value={p.totals.netDue} /></dd></div>
            <div className="flex justify-between"><dt>Paid</dt><dd><Money value={p.totals.totalPaid} /></dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><dt>Balance</dt><dd className={Number(p.totals.balance) > 0 ? 'text-red-700' : 'text-emerald-700'}><Money value={p.totals.balance} credit /></dd></div>
          </dl>
        </Card>
      </div>

      <div className="mt-6">
        <Tabs tabs={[{ key: 'charges', label: 'Charges' }, { key: 'payments', label: 'Payments' }, { key: 'history', label: 'Class & status history' }]} active={tab} onChange={setTab} />
        {tab === 'charges' && (
          <Card padded={false}>
            {charges.data?.items.length === 0 ? <div className="p-4"><Empty title="No charges yet" /></div> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Term</th><th>Fee item</th><th className="num">Charged</th><th className="num">Discount</th><th className="num">Net due</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {charges.data?.items.map((c) => (
                      <tr key={c.id}>
                        <td>{c.termLabel}</td>
                        <td><Link to={`/charges/${c.id}`} className="link">{c.feeItemName}</Link>{c.arrearsFrom && <span className="block text-xs text-slate-500">from {c.arrearsFrom}</span>}</td>
                        <td className="num"><Money value={c.amountCharged} /></td>
                        <td className="num"><Money value={c.discount} /></td>
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
          </Card>
        )}
        {tab === 'payments' && (
          <Card padded={false}>
            {payments.data?.items.length === 0 ? <div className="p-4"><Empty title="No payments yet" /></div> : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Receipt</th><th>Date</th><th>Fee items</th><th>Method</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {payments.data?.items.map((r) => (
                      <tr key={r.id}>
                        <td><Link to={`/receipts/${r.receiptNo}`} className="link font-mono text-xs">{r.receiptNo}</Link> {r.reversed && <StatusBadge status="REVERSED" />}</td>
                        <td><Dt value={r.paymentDate} /></td>
                        <td className="whitespace-normal">{r.items}</td>
                        <td>{label('PAYMENT_METHOD', r.method)}</td>
                        <td className="num"><Money value={r.total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        )}
        {tab === 'history' && (
          <Card padded={false}>
            <TableWrap>
              <table className="table">
                <thead><tr><th>Effective</th><th>Event</th><th>Term</th><th>Class</th><th>Status</th><th>Note</th><th>Recorded</th>{can('pupils.manage') && <th />}</tr></thead>
                <tbody>
                  {p.history.map((h) => (
                    <tr key={h.id}>
                      <td><Dt value={h.effectiveDate} /></td>
                      <td>{EVENT_LABEL[h.eventType] ?? h.eventType}</td>
                      <td>{h.termLabel ?? <span className="text-slate-400">Holiday</span>}</td>
                      <td>{h.className} <span className="text-xs text-slate-500">{h.sectionName}</span></td>
                      <td><StatusBadge status={h.status} />{h.leavingReason && <span className="ml-1 text-xs text-slate-500">{label('LEAVING_REASON', h.leavingReason)}</span>}</td>
                      <td className="whitespace-normal">{h.note}</td>
                      <td className="text-xs text-slate-500">{formatDateTime(h.createdAt)}{h.correctedAt && <span className="block">Corrected {formatDateTime(h.correctedAt)}</span>}</td>
                      {can('pupils.manage') && <td><Button variant="ghost" onClick={() => { setHistForm({ effectiveDate: h.effectiveDate, note: h.note ?? '', reason: '' }); setHistoryEdit(h); }}>Correct</Button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}
      </div>

      <Modal open={modal === 'status'} title="Change status" onClose={() => setModal(null)}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button busy={statusM.isPending} disabled={!statusForm.status || !statusForm.effectiveDate} onClick={() => statusM.mutate()}>Confirm status change</Button></>}>
        <p className="text-sm text-slate-600">Current status: <StatusBadge status={p.status} />. The change is added to the pupil’s history; nothing is overwritten. Only Active pupils are included in term billing.</p>
        <Select label="New status" value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })} placeholder="Choose…" options={options('PUPIL_STATUS').filter((o) => o.value !== p.status)} required />
        <DateInput label="Effective date" value={statusForm.effectiveDate} onChange={(v) => setStatusForm({ ...statusForm, effectiveDate: v })} required />
        {leaving && <Select label="Reason for leaving" value={statusForm.leavingReason} onChange={(e) => setStatusForm({ ...statusForm, leavingReason: e.target.value })} placeholder="Choose…" options={options('LEAVING_REASON')} required />}
        <TextArea label="Note" value={statusForm.note} onChange={(v) => setStatusForm({ ...statusForm, note: v })} rows={2} />
        <ErrorBox error={statusM.error} />
      </Modal>

      <Modal open={modal === 'class'} title="Change class" onClose={() => setModal(null)}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button busy={classM.isPending} disabled={!classForm.classId || !classForm.effectiveDate} onClick={() => classM.mutate()}>Save class change</Button></>}>
        <p className="text-sm text-slate-600">Currently in {p.className}. The earlier placement stays in the history.</p>
        <Select label="Type of change" value={classForm.eventType} onChange={(e) => setClassForm({ ...classForm, eventType: e.target.value })} options={[{ value: 'PROMOTED', label: 'Promotion' }, { value: 'CLASS_CHANGE', label: 'Other class change' }]} />
        <Select label="New class" value={classForm.classId} onChange={(e) => setClassForm({ ...classForm, classId: e.target.value })} placeholder="Choose…" options={(lookups?.classes ?? []).filter((c) => c.active && c.id !== p.classId).map((c) => ({ value: c.id, label: `${c.name} (${c.sectionName})` }))} required />
        <DateInput label="Effective date" value={classForm.effectiveDate} onChange={(v) => setClassForm({ ...classForm, effectiveDate: v })} required />
        <TextArea label="Note" value={classForm.note} onChange={(v) => setClassForm({ ...classForm, note: v })} rows={2} />
        <ErrorBox error={classM.error} />
      </Modal>

      <Modal open={!!historyEdit} title="Correct a history entry" onClose={() => setHistoryEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setHistoryEdit(null)}>Cancel</Button><Button busy={histM.isPending} disabled={histForm.reason.trim().length < 5} onClick={() => histM.mutate()}>Save correction</Button></>}>
        <Notice tone="warning">Corrections are recorded in the audit log with the reason you give.</Notice>
        <DateInput label="Effective date" value={histForm.effectiveDate} onChange={(v) => setHistForm({ ...histForm, effectiveDate: v })} required />
        <TextArea label="Note" value={histForm.note} onChange={(v) => setHistForm({ ...histForm, note: v })} rows={2} />
        <TextArea label="Reason for the correction" value={histForm.reason} onChange={(v) => setHistForm({ ...histForm, reason: v })} rows={2} required />
        <ErrorBox error={histM.error} />
      </Modal>
    </div>
  );
}
