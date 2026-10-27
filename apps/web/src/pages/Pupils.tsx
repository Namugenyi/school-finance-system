import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { formatDate, formatDateTime, todayIso } from '../lib/format';
import { Button, Card, DateInput, Dt, Empty, ErrorBox, Loading, Modal, Money, Notice, OTHER, PageHeader, Pagination, Select, SelectWithOther, StatusBadge, TableWrap, Tabs, TextArea, TextInput, withOther, Narrow } from '../components/ui';
import type { Charge, Paged } from '../lib/types';

interface Pupil {
  id: number; pupilCode: string; fullName: string; sex: string; dateOfBirth: string | null; dateJoined: string; classId: number; className: string;
  sectionName: string; status: string; guardianName: string | null; phonePrimary?: string | null; phoneAlt?: string | null; address?: string | null;
  guardianRelationship: string | null; guardianRelationshipOther: string | null; emergencyName?: string | null; emergencyRelationship?: string | null; emergencyRelationshipOther?: string | null; emergencyPhone?: string | null; notes: string | null; dateLeft: string | null; leavingReason: string | null; leavingReasonOther: string | null; contactsHidden?: boolean;
}
interface PupilDetail extends Pupil {
  totals: { netDue: string; totalPaid: string; balance: string };
  history: Array<{ id: number; eventType: string; effectiveDate: string; termLabel: string | null; className: string; sectionName: string; status: string; leavingReason: string | null; leavingReasonOther: string | null; note: string | null; createdAt: string; correctedAt: string | null }>;
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
                  <tr key={p.id} className={p.status === 'ACTIVE' ? '' : 'bg-slate-50/60'}>
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

/** A-12: Ugandan numbers are 0 or +256 followed by 9 digits; spaces and dashes are ignored (same rule as the server). */
export function phoneProblem(v: string): string | null {
  const digits = v.replace(/[\s-]/g, '');
  if (!digits) return null;
  return /^(\+256|0)\d{9}$/.test(digits) ? null : 'Enter a Ugandan number: 0 or +256 followed by 9 digits, for example 0772 123 456';
}

/** Tidy a phone number on leaving the field: "0772123456" -> "0772 123 456", "256772123456" -> "+256 772 123 456". */
export function tidyPhone(v: string): string {
  let d = v.replace(/[\s-]/g, '');
  if (/^256\d{9}$/.test(d)) d = `+${d}`;
  if (/^[3-9]\d{8}$/.test(d)) d = `0${d}`;
  if (/^0\d{9}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^\+256\d{9}$/.test(d)) return `+256 ${d.slice(4, 7)} ${d.slice(7, 10)} ${d.slice(10)}`;
  return v.trim();
}

const PHONE_HINT = 'For example 0772 123 456 or +256 772 123 456';

const emptyForm = { fullName: '', sex: '', dateOfBirth: '', dateJoined: todayIso(), classId: '', guardianName: '', guardianRelationship: '', guardianRelationshipOther: '', phonePrimary: '', phoneAlt: '', address: '',
  emergencyName: '', emergencyRelationship: '', emergencyRelationshipOther: '', emergencyPhone: '', notes: '' };

export function PupilFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { lookups, options } = useLookups();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof emptyForm, string>>>({});
  const [badDates, setBadDates] = useState({ dateOfBirth: false, dateJoined: false });
  const summaryRef = useRef<HTMLDivElement>(null);
  const existing = useQuery({ queryKey: ['pupil', id], queryFn: () => api.get<PupilDetail>(`/pupils/${id}`), enabled: editing });
  useEffect(() => {
    const p = existing.data;
    if (p) setForm({ fullName: p.fullName, sex: p.sex, dateOfBirth: p.dateOfBirth ?? '', dateJoined: p.dateJoined, classId: String(p.classId), guardianName: p.guardianName ?? '', guardianRelationship: p.guardianRelationship ?? '', guardianRelationshipOther: p.guardianRelationshipOther ?? '',
      phonePrimary: p.phonePrimary ?? '', phoneAlt: p.phoneAlt ?? '', address: p.address ?? '',
      emergencyName: p.emergencyName ?? '', emergencyRelationship: p.emergencyRelationship ?? '', emergencyRelationshipOther: p.emergencyRelationshipOther ?? '', emergencyPhone: p.emergencyPhone ?? '', notes: p.notes ?? '' });
  }, [existing.data]);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };
  const today = todayIso();
  const classes = (lookups?.classes ?? []).filter((c) => c.active);
  const chosenClass = classes.find((c) => String(c.id) === form.classId);

  /** The same rules the server applies, checked first so problems show beside the field. */
  const validate = () => {
    const e: Partial<Record<keyof typeof emptyForm, string>> = {};
    if (form.fullName.trim().length < 2) e.fullName = 'Enter the pupil’s full name';
    if (!form.sex) e.sex = 'Choose the pupil’s sex';
    if (badDates.dateJoined) e.dateJoined = 'Enter the date as DD/MM/YYYY, for example 05/02/2026';
    else if (!form.dateJoined) e.dateJoined = 'Enter the date the pupil joined';
    else if (form.dateJoined > today) e.dateJoined = 'Date joined cannot be in the future';
    if (badDates.dateOfBirth) e.dateOfBirth = 'Enter the date as DD/MM/YYYY, for example 05/02/2020';
    else if (form.dateOfBirth && form.dateJoined && form.dateOfBirth >= form.dateJoined) e.dateOfBirth = 'Date of birth must be before the date joined';
    if (!editing && !form.classId) e.classId = 'Choose a class';
    if (!form.guardianName.trim()) e.guardianName = 'Enter the parent or guardian’s name';
    if (!form.guardianRelationship) e.guardianRelationship = 'Choose how they are related to the pupil';
    else if (form.guardianRelationship === OTHER && !form.guardianRelationshipOther.trim()) e.guardianRelationshipOther = 'Type the relationship';
    if (!form.phonePrimary.trim()) e.phonePrimary = 'Enter a telephone number for the parent or guardian';
    if (!form.address.trim()) e.address = 'Enter where the family lives';
    if (!form.emergencyName.trim()) e.emergencyName = 'Enter the emergency contact’s name';
    if (!form.emergencyRelationship) e.emergencyRelationship = 'Choose how they are related to the pupil';
    else if (form.emergencyRelationship === OTHER && !form.emergencyRelationshipOther.trim()) e.emergencyRelationshipOther = 'Type the relationship';
    if (!form.emergencyPhone.trim()) e.emergencyPhone = 'Enter a telephone number for the emergency contact';
    for (const k of ['phonePrimary', 'phoneAlt', 'emergencyPhone'] as const) {
      const problem = phoneProblem(form[k]);
      if (problem && !e[k]) e[k] = problem;
    }
    return e;
  };
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
    const found = validate();
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    save.mutate();
  };
  const err = (k: keyof typeof emptyForm) => errors[k] ?? null;
  const loaded = existing.data;
  const guardianIncomplete = editing && !!loaded && !(loaded.guardianName && loaded.guardianRelationship && loaded.phonePrimary && loaded.address);
  const emergencyIncomplete = editing && !!loaded && !(loaded.emergencyName && loaded.emergencyRelationship && loaded.emergencyPhone);
  const problems = Object.entries(errors).filter(([, v]) => v) as Array<[keyof typeof emptyForm, string]>;
  const phoneProps = (k: 'phonePrimary' | 'phoneAlt' | 'emergencyPhone') => ({
    value: form[k], type: 'tel', inputMode: 'tel' as const, autoComplete: 'off', maxLength: 20, error: err(k),
    onChange: (e: { target: { value: string } }) => set(k)(e.target.value),
    onBlur: () => {
      const tidy = tidyPhone(form[k]);
      if (tidy !== form[k]) setForm((f) => ({ ...f, [k]: tidy }));
      const problem = phoneProblem(tidy);
      setErrors((x) => ({ ...x, [k]: problem ?? undefined }));
    },
  });
  const FIELD_LABEL: Partial<Record<keyof typeof emptyForm, string>> = {
    fullName: 'Full name', sex: 'Sex', dateOfBirth: 'Date of birth', dateJoined: 'Date joined', classId: 'Class',
    guardianName: 'Parent / guardian name', guardianRelationship: 'Guardian’s relationship to pupil', address: 'Physical address',
    guardianRelationshipOther: 'Guardian’s relationship', phonePrimary: 'Primary telephone', phoneAlt: 'Alternative telephone',
    emergencyName: 'Emergency contact name', emergencyRelationship: 'Emergency contact’s relationship to pupil',
    emergencyRelationshipOther: 'Emergency contact’s relationship', emergencyPhone: 'Emergency contact telephone',
  };
  return (
    <Narrow width="4xl">
      <PageHeader title={editing ? `Edit ${existing.data?.fullName ?? 'pupil'}` : 'Register a pupil'} crumbs={[{ label: 'Pupils', to: '/pupils' }, { label: editing ? 'Edit' : 'New' }]}
        subtitle={editing ? <>Pupil ID <span className="font-mono">{existing.data?.pupilCode}</span> never changes. Use “Change class” or “Change status” on the pupil page for those.</> : 'The pupil ID (STJA-YYYY-NNNN) is issued automatically when you save.'} />
      <form onSubmit={submit} noValidate className="form-roomy space-y-6">
        <p className="text-sm text-slate-600">Fields marked <span className="font-semibold text-red-700" aria-hidden>*</span><span className="sr-only">with an asterisk</span> are required.</p>
        {problems.length > 0 && (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
            <p className="font-semibold">Please fix {problems.length === 1 ? 'this field' : `these ${problems.length} fields`} before saving:</p>
            <ul className="mt-1 list-disc pl-5">{problems.map(([k, v]) => <li key={k}>{FIELD_LABEL[k] ?? k}: {v}</li>)}</ul>
          </div>
        )}
        <Card title="Pupil">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <TextInput label="Full name" value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} required className="sm:col-span-2" autoComplete="off" maxLength={120} error={err('fullName')} hint="As it should appear on receipts and statements" />
            <Select label="Sex" value={form.sex} onChange={(e) => set('sex')(e.target.value)} placeholder="Choose…" options={options('SEX')} required error={err('sex')} />
            <DateInput label="Date of birth" value={form.dateOfBirth} onChange={set('dateOfBirth')} max={form.dateJoined || today} error={err('dateOfBirth')}
              onTextValidity={(ok) => { setBadDates((b) => ({ ...b, dateOfBirth: !ok })); if (ok) setErrors((x) => ({ ...x, dateOfBirth: undefined })); }} hint="Optional. DD/MM/YYYY" />
            <DateInput label="Date joined" value={form.dateJoined} onChange={set('dateJoined')} required max={today} error={err('dateJoined')}
              onTextValidity={(ok) => { setBadDates((b) => ({ ...b, dateJoined: !ok })); if (ok) setErrors((x) => ({ ...x, dateJoined: undefined })); }} hint="DD/MM/YYYY. Cannot be in the future" />
            {!editing && (
              <Select label="Class" value={form.classId} onChange={(e) => set('classId')(e.target.value)} placeholder="Choose…" required error={err('classId')}
                options={classes.map((c) => ({ value: c.id, label: `${c.name} (${c.sectionName})` }))}
                hint={chosenClass ? <>Section: <span className="font-medium text-slate-700">{chosenClass.sectionName}</span> (set by the class)</> : 'The section comes from the class.'} />
            )}
          </div>
        </Card>
        <Card title="Parent or guardian">
          {guardianIncomplete && (
            <div className="mb-4"><Notice tone="warning" title="Parent or guardian details are incomplete">This pupil was registered before these details were required. Fill in the fields marked * to save your changes.</Notice></div>
          )}
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <TextInput label="Parent / guardian name" value={form.guardianName} onChange={(e) => set('guardianName')(e.target.value)} autoComplete="off" maxLength={120} required error={err('guardianName')} />
            <SelectWithOther label="Guardian's relationship to pupil" value={form.guardianRelationship} onChange={set('guardianRelationship')} placeholder="Choose…" options={options('RELATIONSHIP')} required error={err('guardianRelationship')}
              other={form.guardianRelationshipOther} onOtherChange={set('guardianRelationshipOther')} otherLabel="Guardian's relationship (please specify)" otherError={err('guardianRelationshipOther')} />
            <TextInput label="Primary telephone" {...phoneProps('phonePrimary')} placeholder="0772 123 456" hint={PHONE_HINT} required />
            <TextInput label="Alternative telephone" {...phoneProps('phoneAlt')} placeholder="0752 123 456" hint="Optional" />
            <TextArea label="Physical address" value={form.address} onChange={set('address')} rows={2} maxLength={300} className="sm:col-span-2" autoComplete="off" hint="Village or estate, parish and district" required error={err('address')} />
          </div>
        </Card>
        <Card title="Emergency contact">
          <p className="mb-4 text-sm text-slate-600">Someone to call if the parent or guardian cannot be reached.</p>
          {emergencyIncomplete && (
            <div className="mb-4"><Notice tone="warning" title="Emergency contact details are incomplete">This pupil was registered before these details were required. Fill in the fields marked * to save your changes.</Notice></div>
          )}
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <TextInput label="Emergency contact name" value={form.emergencyName} onChange={(e) => set('emergencyName')(e.target.value)} autoComplete="off" maxLength={120} required error={err('emergencyName')} />
            <SelectWithOther label="Emergency contact's relationship to pupil" value={form.emergencyRelationship} onChange={set('emergencyRelationship')} placeholder="Choose…" options={options('RELATIONSHIP')} required error={err('emergencyRelationship')}
              other={form.emergencyRelationshipOther} onOtherChange={set('emergencyRelationshipOther')} otherLabel="Emergency contact's relationship (please specify)" otherError={err('emergencyRelationshipOther')} />
            <TextInput label="Emergency contact telephone" {...phoneProps('emergencyPhone')} placeholder="0772 123 456" hint={PHONE_HINT} required />
          </div>
        </Card>
        <Card title="Notes">
          <TextArea label="Notes" value={form.notes} onChange={set('notes')} maxLength={1000} hint="Optional. Anything the bursar should know, for example a sibling at the school" />
        </Card>
        <ErrorBox error={save.error} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" className="h-11 px-5" busy={save.isPending}>{editing ? 'Save changes' : 'Register pupil'}</Button>
          <Button variant="secondary" className="h-11 px-5" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </Narrow>
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

  const [statusForm, setStatusForm] = useState({ status: '', effectiveDate: todayIso(), leavingReason: '', leavingReasonOther: '', note: '' });
  const [classForm, setClassForm] = useState({ classId: '', effectiveDate: todayIso(), eventType: 'PROMOTED', note: '' });
  const [histForm, setHistForm] = useState({ effectiveDate: '', note: '', reason: '' });
  const statusM = useMutation({ mutationFn: () => api.post(`/pupils/${id}/status`, { ...statusForm, leavingReason: statusForm.leavingReason || null, confirm: true }), onSuccess: () => { setModal(null); refresh(); } });
  const classM = useMutation({ mutationFn: () => api.post(`/pupils/${id}/class`, { ...classForm, classId: Number(classForm.classId) }), onSuccess: () => { setModal(null); refresh(); } });
  const histM = useMutation({ mutationFn: () => api.patch(`/pupils/${id}/history/${historyEdit!.id}`, histForm), onSuccess: () => { setHistoryEdit(null); refresh(); } });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const p = q.data;
  const leaving = statusForm.status === 'ALUMNI';

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
                <Button variant="secondary" onClick={() => { setStatusForm({ status: '', effectiveDate: todayIso(), leavingReason: '', leavingReasonOther: '', note: '' }); setModal('status'); }}>Change status</Button>
              </>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          {(() => {
            const hidden = (v: string | null | undefined) => (p.contactsHidden ? 'Hidden for your role' : v);
            const rel = (code: string | null | undefined, other: string | null | undefined) => (code ? withOther(label('RELATIONSHIP', code), other) : null);
            const groups: Array<[string | null, Array<[string, string | null | undefined]>]> = [
              [null, [
                ['Sex', label('SEX', p.sex)], ['Date of birth', formatDate(p.dateOfBirth)], ['Date joined', formatDate(p.dateJoined)],
                ...(p.dateLeft ? [['Date left', formatDate(p.dateLeft)], ['Reason for leaving', withOther(label('LEAVING_REASON', p.leavingReason), p.leavingReasonOther)]] as Array<[string, string]> : []),
              ]],
              ['Parent or guardian', [
                ['Name', p.guardianName], ['Relationship to pupil', rel(p.guardianRelationship, p.guardianRelationshipOther)],
                ['Primary telephone', hidden(p.phonePrimary)], ['Alternative telephone', hidden(p.phoneAlt)], ['Address', hidden(p.address)],
              ]],
              ['Emergency contact', [
                ['Name', hidden(p.emergencyName)], ['Relationship to pupil', p.contactsHidden ? 'Hidden for your role' : rel(p.emergencyRelationship, p.emergencyRelationshipOther)],
                ['Telephone', hidden(p.emergencyPhone)],
              ]],
              [null, [['Notes', p.notes]]],
            ];
            return groups.map(([heading, rows], gi) => (
              <section key={gi} className={gi > 0 ? 'mt-5 border-t border-slate-100 pt-4' : ''}>
                {heading && <h3 className="mb-3 text-sm font-semibold text-brand-900">{heading}</h3>}
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {rows.map(([k, v]) => (
                    <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5">{v || <span className="text-slate-400">—</span>}</dd></div>
                  ))}
                </dl>
              </section>
            ));
          })()}
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
                      <td><StatusBadge status={h.status} />{h.leavingReason && <span className="ml-1 text-xs text-slate-500">{withOther(label('LEAVING_REASON', h.leavingReason), h.leavingReasonOther)}</span>}</td>
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
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button busy={statusM.isPending} disabled={!statusForm.status || !statusForm.effectiveDate || (leaving && statusForm.leavingReason === OTHER && !statusForm.leavingReasonOther.trim())} onClick={() => statusM.mutate()}>Confirm status change</Button></>}>
        <p className="text-sm text-slate-600">Current status: <StatusBadge status={p.status} />. The change is added to the pupil’s history; nothing is overwritten. Only Active pupils are included in term billing.</p>
        <Select label="New status" value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })} placeholder="Choose…" options={options('PUPIL_STATUS').filter((o) => o.value !== p.status)} required />
        <DateInput label="Effective date" value={statusForm.effectiveDate} onChange={(v) => setStatusForm({ ...statusForm, effectiveDate: v })} required />
        {leaving && <SelectWithOther label="Reason for leaving" value={statusForm.leavingReason} onChange={(v) => setStatusForm({ ...statusForm, leavingReason: v })} placeholder="Choose…" options={options('LEAVING_REASON')} required
          other={statusForm.leavingReasonOther} onOtherChange={(v) => setStatusForm({ ...statusForm, leavingReasonOther: v })} otherLabel="Reason for leaving (please specify)" />}
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
