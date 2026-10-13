import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { formatDate } from '../lib/format';
import { Button, Card, DateInput, ErrorBox, Loading, Modal, Notice, PageHeader, Select, StatusBadge, TableWrap, Tabs, TextInput } from '../components/ui';
import { FREQ } from './Fees';
import type { RefValue, Term } from '../lib/types';

interface Settings { schoolName: string; address: string | null; phone: string | null; email: string | null; registrationNo: string | null; receiptFooter: string | null; pupilIdStartYear: number; payrollEnabled: boolean }
interface RefList { id: number; code: string; name: string; description: string | null; locked: boolean; values: Array<RefValue & { sortOrder: number }> }

/** After any setup change, every dropdown in the app refreshes (FR-103). */
function useSetupMutation<T>(fn: (v: T) => Promise<unknown>, after?: () => void) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { void qc.invalidateQueries({ queryKey: ['lookups'] }); void qc.invalidateQueries({ queryKey: ['setup'] }); after?.(); } });
}

export function SetupPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('school');
  const manage = can('setup.manage');
  return (
    <div>
      <PageHeader title="Setup" subtitle="School details, the calendar, classes, fee items and every dropdown list. Changes show up across the system straight away." />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'school', label: 'School' }, { key: 'calendar', label: 'Years and terms' }, { key: 'classes', label: 'Sections and classes' }, { key: 'fees', label: 'Fee items' }, { key: 'lists', label: 'Dropdown lists' }]} />
      {tab === 'school' && <School manage={manage} />}
      {tab === 'calendar' && <Calendar manage={manage} />}
      {tab === 'classes' && <Classes manage={manage} />}
      {tab === 'fees' && <FeeItems manage={manage} />}
      {tab === 'lists' && <Lists manage={manage} />}
    </div>
  );
}

function School({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: ['setup', 'settings'], queryFn: () => api.get<Settings>('/setup/settings') });
  const [f, setF] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useSetupMutation(() => api.patch('/setup/settings', { ...f, address: f!.address || null, phone: f!.phone || null, email: f!.email || '', registrationNo: f!.registrationNo || null, receiptFooter: f!.receiptFooter || null }), () => setSaved(true));
  const [confirmPayroll, setConfirmPayroll] = useState(false);
  if (!f) return <Loading />;
  const set = (k: keyof Settings) => (e: { target: { value: string } }) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  return (
    <div className="max-w-3xl space-y-4">
      <Card title="School details" actions={manage && <Button busy={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>}>
        <fieldset disabled={!manage} className="grid gap-4 sm:grid-cols-2">
          <TextInput label="School name" value={f.schoolName} onChange={set('schoolName')} className="sm:col-span-2" />
          <TextInput label="Address" value={f.address ?? ''} onChange={set('address')} className="sm:col-span-2" />
          <TextInput label="Phone" value={f.phone ?? ''} onChange={set('phone')} />
          <TextInput label="Email" value={f.email ?? ''} onChange={set('email')} />
          <TextInput label="Registration number" value={f.registrationNo ?? ''} onChange={set('registrationNo')} />
          <TextInput label="First year for pupil IDs" inputMode="numeric" value={String(f.pupilIdStartYear)} onChange={(e) => setF({ ...f, pupilIdStartYear: Number(e.target.value) || f.pupilIdStartYear })} hint="Pupil IDs look like STJA-YYYY-NNNN" />
          <TextInput label="Receipt footer" value={f.receiptFooter ?? ''} onChange={set('receiptFooter')} className="sm:col-span-2" hint="Printed at the bottom of every receipt" />
        </fieldset>
        <div className="mt-3"><ErrorBox error={save.error} />{saved && <Notice tone="success">Saved.</Notice>}</div>
      </Card>
      <Card title="Payroll posting">
        <p className="text-sm">Status: <StatusBadge status={f.payrollEnabled ? 'ACTIVE' : 'INACTIVE'} label={f.payrollEnabled ? 'Switched on' : 'Switched off'} /></p>
        <p className="mt-2 text-sm text-slate-600">While off, payroll can be prepared but no run can be approved into the accounts. Switch it on only after the PAYE bands and NSSF rates have been checked against current URA and NSSF rules and marked as checked under Payroll.</p>
        {manage && <Button className="mt-3" variant={f.payrollEnabled ? 'secondary' : 'primary'} onClick={() => setConfirmPayroll(true)}>{f.payrollEnabled ? 'Switch payroll posting off' : 'Switch payroll posting on'}</Button>}
      </Card>
      <PayrollToggle open={confirmPayroll} on={!f.payrollEnabled} onClose={() => setConfirmPayroll(false)} onDone={() => setF({ ...f, payrollEnabled: !f.payrollEnabled })} />
    </div>
  );
}

function PayrollToggle({ open, on, onClose, onDone }: { open: boolean; on: boolean; onClose: () => void; onDone: () => void }) {
  const m = useSetupMutation(() => api.patch('/setup/settings', { payrollEnabled: on }), () => { onDone(); onClose(); });
  return (
    <Modal open={open} title={on ? 'Switch payroll posting on?' : 'Switch payroll posting off?'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={m.isPending} onClick={() => m.mutate(undefined)}>{on ? 'Yes, the rates have been checked' : 'Switch off'}</Button></>}>
      {on ? <Notice tone="warning">Confirm that an accountant or official URA/NSSF source has confirmed the PAYE bands and NSSF rates in Payroll &gt; Rates. Approved runs will post salary costs into the accounts.</Notice> : <p className="text-sm">Payroll runs will no longer be approvable until it is switched back on.</p>}
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function Calendar({ manage }: { manage: boolean }) {
  const { lookups } = useLookups();
  const [year, setYear] = useState('');
  const addYear = useSetupMutation(() => api.post('/setup/years', { year: Number(year) }), () => setYear(''));
  const [termForm, setTermForm] = useState<{ id?: number; academicYearId: string; number: string; name: string; startDate: string; endDate: string } | null>(null);
  const saveTerm = useSetupMutation(() => termForm!.id
    ? api.patch(`/setup/terms/${termForm!.id}`, { name: termForm!.name, startDate: termForm!.startDate, endDate: termForm!.endDate })
    : api.post('/setup/terms', { academicYearId: Number(termForm!.academicYearId), number: Number(termForm!.number), name: termForm!.name || undefined, startDate: termForm!.startDate, endDate: termForm!.endDate }), () => setTermForm(null));
  const edit = (t: Term) => setTermForm({ id: t.id, academicYearId: String(t.academicYearId), number: String(t.number), name: t.name, startDate: t.startDate, endDate: t.endDate });
  return (
    <div className="space-y-4">
      {manage && (
        <Card title="Add an academic year">
          <div className="flex items-end gap-2">
            <TextInput label="Year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} className="w-32" />
            <Button busy={addYear.isPending} disabled={!/^\d{4}$/.test(year)} onClick={() => addYear.mutate(undefined)}>Add year</Button>
          </div>
          <div className="mt-2"><ErrorBox error={addYear.error} /></div>
        </Card>
      )}
      {lookups?.years.map((y) => (
        <Card key={y.id} title={String(y.year)} padded={false} actions={manage && y.terms.length < 3 && <Button variant="secondary" onClick={() => setTermForm({ academicYearId: String(y.id), number: String(y.terms.length + 1), name: '', startDate: '', endDate: '' })}>Add term</Button>}>
          {y.terms.length === 0 ? <p className="p-4 text-sm text-slate-500">No terms yet.</p> : (
            <table className="table">
              <thead><tr><th>Term</th><th>Starts</th><th>Ends</th><th>Status</th>{manage && <th />}</tr></thead>
              <tbody>{y.terms.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td>{formatDate(t.startDate)}</td><td>{formatDate(t.endDate)}</td><td><StatusBadge status={t.status} /></td>
                  {manage && <td>{t.status !== 'CLOSED' && <Button variant="ghost" onClick={() => edit(t)}>Edit</Button>}</td>}</tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      ))}
      <Modal open={!!termForm} title={termForm?.id ? 'Edit term' : 'Add term'} onClose={() => setTermForm(null)}
        footer={<><Button variant="secondary" onClick={() => setTermForm(null)}>Cancel</Button><Button busy={saveTerm.isPending} disabled={!termForm?.startDate || !termForm?.endDate} onClick={() => saveTerm.mutate(undefined)}>Save</Button></>}>
        {termForm && <>
          {!termForm.id && <Select label="Term number" value={termForm.number} onChange={(e) => setTermForm({ ...termForm, number: e.target.value })} options={[1, 2, 3].map((n) => ({ value: n, label: `Term ${n}` }))} />}
          <TextInput label="Name" placeholder={`Term ${termForm.number}`} value={termForm.name} onChange={(e) => setTermForm({ ...termForm, name: e.target.value })} />
          <DateInput label="Start date" value={termForm.startDate} onChange={(v) => setTermForm({ ...termForm, startDate: v })} required />
          <DateInput label="End date" value={termForm.endDate} onChange={(v) => setTermForm({ ...termForm, endDate: v })} required hint="Terms cannot overlap" />
        </>}
        <ErrorBox error={saveTerm.error} />
      </Modal>
    </div>
  );
}

function Classes({ manage }: { manage: boolean }) {
  const { lookups } = useLookups();
  const [section, setSection] = useState('');
  const addSection = useSetupMutation(() => api.post('/setup/sections', { name: section, sortOrder: (lookups?.sections.length ?? 0) + 1 }), () => setSection(''));
  const [cls, setCls] = useState({ name: '', sectionId: '' });
  const addClass = useSetupMutation(() => api.post('/setup/classes', { name: cls.name, sectionId: Number(cls.sectionId), sortOrder: (lookups?.classes.length ?? 0) + 1 }), () => setCls({ name: '', sectionId: cls.sectionId }));
  const toggleClass = useSetupMutation((c: { id: number; active: boolean }) => api.patch(`/setup/classes/${c.id}`, { active: !c.active }));
  const toggleSection = useSetupMutation((s: { id: number; active: boolean }) => api.patch(`/setup/sections/${s.id}`, { active: !s.active }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Sections" padded={false}>
        <table className="table"><tbody>{lookups?.sections.map((s) => (
          <tr key={s.id}><td>{s.name}</td><td><StatusBadge status={s.active ? 'ACTIVE' : 'INACTIVE'} /></td>{manage && <td className="text-right"><Button variant="ghost" onClick={() => toggleSection.mutate(s)}>{s.active ? 'Deactivate' : 'Reactivate'}</Button></td>}</tr>
        ))}</tbody></table>
        {manage && <div className="flex items-end gap-2 p-4"><TextInput label="New section" value={section} onChange={(e) => setSection(e.target.value)} /><Button disabled={!section.trim()} busy={addSection.isPending} onClick={() => addSection.mutate(undefined)}>Add</Button></div>}
        <div className="px-4 pb-3"><ErrorBox error={addSection.error ?? toggleSection.error} /></div>
      </Card>
      <Card title="Classes" padded={false}>
        <TableWrap><table className="table"><thead><tr><th>Class</th><th>Section</th><th>Status</th>{manage && <th />}</tr></thead><tbody>{lookups?.classes.map((c) => (
          <tr key={c.id}><td>{c.name}</td><td>{c.sectionName}</td><td><StatusBadge status={c.active ? 'ACTIVE' : 'INACTIVE'} /></td>{manage && <td className="text-right"><Button variant="ghost" onClick={() => toggleClass.mutate(c)}>{c.active ? 'Deactivate' : 'Reactivate'}</Button></td>}</tr>
        ))}</tbody></table></TableWrap>
        {manage && (
          <div className="grid grid-cols-3 items-end gap-2 p-4">
            <TextInput label="New class" value={cls.name} onChange={(e) => setCls({ ...cls, name: e.target.value })} />
            <Select label="Section" value={cls.sectionId} onChange={(e) => setCls({ ...cls, sectionId: e.target.value })} placeholder="Choose…" options={(lookups?.sections ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} />
            <Button disabled={!cls.name.trim() || !cls.sectionId} busy={addClass.isPending} onClick={() => addClass.mutate(undefined)}>Add class</Button>
          </div>
        )}
        <div className="px-4 pb-3"><ErrorBox error={addClass.error ?? toggleClass.error} /></div>
      </Card>
    </div>
  );
}

function FeeItems({ manage }: { manage: boolean }) {
  const { lookups } = useLookups();
  const [f, setF] = useState({ name: '', frequency: 'TERM', defaultMandatory: false });
  const add = useSetupMutation(() => api.post('/setup/fee-items', f), () => setF({ name: '', frequency: 'TERM', defaultMandatory: false }));
  const update = useSetupMutation((v: { id: number; patch: Record<string, unknown> }) => api.patch(`/setup/fee-items/${v.id}`, v.patch));
  return (
    <Card title="Fee items" padded={false}>
      <p className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">How often decides what billing does: a once-only fee is skipped for a pupil already charged it, a yearly fee is skipped if already charged that year. Arrears B/F is used by carry-forward and cannot be billed.</p>
      <TableWrap><table className="table">
        <thead><tr><th>Fee item</th><th>How often</th><th>Mandatory by default</th><th>Status</th>{manage && <th />}</tr></thead>
        <tbody>{lookups?.feeItems.map((i) => (
          <tr key={i.id}>
            <td>{i.name}{i.isSystem && <span className="ml-1 text-xs text-slate-500">(system)</span>}</td>
            <td>{manage && !i.isSystem ? <select className="input w-40" aria-label={`${i.name} frequency`} value={i.frequency} onChange={(e) => update.mutate({ id: i.id, patch: { frequency: e.target.value } })}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : FREQ[i.frequency]}</td>
            <td>{manage && !i.isSystem ? <input type="checkbox" aria-label={`${i.name} mandatory by default`} checked={i.defaultMandatory} onChange={(e) => update.mutate({ id: i.id, patch: { defaultMandatory: e.target.checked } })} /> : i.defaultMandatory ? 'Yes' : 'No'}</td>
            <td><StatusBadge status={i.active ? 'ACTIVE' : 'INACTIVE'} /></td>
            {manage && <td className="text-right">{!i.isSystem && <Button variant="ghost" onClick={() => update.mutate({ id: i.id, patch: { active: !i.active } })}>{i.active ? 'Deactivate' : 'Reactivate'}</Button>}</td>}
          </tr>
        ))}</tbody>
      </table></TableWrap>
      {manage && (
        <div className="grid items-end gap-2 p-4 sm:grid-cols-4">
          <TextInput label="New fee item" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select label="How often" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} options={Object.entries(FREQ).map(([k, v]) => ({ value: k, label: v }))} />
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.defaultMandatory} onChange={(e) => setF({ ...f, defaultMandatory: e.target.checked })} /> Mandatory by default</label>
          <Button disabled={!f.name.trim()} busy={add.isPending} onClick={() => add.mutate(undefined)}>Add fee item</Button>
        </div>
      )}
      <div className="px-4 pb-3"><ErrorBox error={add.error ?? update.error} /></div>
    </Card>
  );
}

function Lists({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: ['setup', 'lists'], queryFn: () => api.get<RefList[]>('/setup/reference-lists') });
  const [code, setCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(null);
  const list = q.data?.find((l) => l.code === code) ?? q.data?.[0];
  const add = useSetupMutation(() => api.post(`/setup/reference-lists/${list!.code}/values`, { label: newLabel }), () => setNewLabel(''));
  const update = useSetupMutation((v: { id: number; patch: Record<string, unknown> }) => api.patch(`/setup/reference-values/${v.id}`, v.patch), () => setEditing(null));
  if (q.isLoading) return <Loading />;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Lists" padded={false}>
        <ul className="divide-y divide-slate-100">{q.data?.map((l) => (
          <li key={l.code}><button type="button" className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${l.code === list?.code ? 'bg-brand-50 font-medium text-brand-900' : ''}`} onClick={() => setCode(l.code)}>{l.name}<span className="ml-1 text-xs text-slate-500">({l.values.length})</span></button></li>
        ))}</ul>
      </Card>
      {list && (
        <Card title={list.name} padded={false} className="lg:col-span-2">
          {list.description && <p className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">{list.description}{list.locked && '. The values in this list are fixed by the FRS: you can rename them but not add new ones.'}</p>}
          <table className="table">
            <thead><tr><th>Value</th><th>Status</th>{manage && <th />}</tr></thead>
            <tbody>{list.values.map((v) => (
              <tr key={v.id}>
                <td>{editing?.id === v.id ? <input className="input" aria-label="New label" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /> : <>{v.label}{v.isSystem && <span className="ml-1 text-xs text-slate-500">(system)</span>}</>}</td>
                <td><StatusBadge status={v.active ? 'ACTIVE' : 'INACTIVE'} /></td>
                {manage && <td className="text-right">{editing?.id === v.id ? <>
                  <Button busy={update.isPending} onClick={() => update.mutate({ id: v.id, patch: { label: editing.label } })}>Save</Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </> : <>
                  <Button variant="ghost" onClick={() => setEditing({ id: v.id, label: v.label })}>Rename</Button>
                  {!v.isSystem && <Button variant="ghost" onClick={() => update.mutate({ id: v.id, patch: { active: !v.active } })}>{v.active ? 'Deactivate' : 'Reactivate'}</Button>}
                </>}</td>}
              </tr>
            ))}</tbody>
          </table>
          {manage && !list.locked && (
            <div className="flex items-end gap-2 p-4"><TextInput label="New value" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} /><Button disabled={!newLabel.trim()} busy={add.isPending} onClick={() => add.mutate(undefined)}>Add</Button></div>
          )}
          <div className="px-4 pb-3"><ErrorBox error={add.error ?? update.error} /></div>
          <p className="px-4 pb-3 text-xs text-slate-500">Deactivated values disappear from dropdowns but stay on old records.</p>
        </Card>
      )}
    </div>
  );
}
