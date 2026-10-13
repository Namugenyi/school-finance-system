import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cleanAmount, formatDate, formatDateTime, formatMoney, todayIso } from '../lib/format';
import { Button, Card, DateInput, DecisionButtons, Empty, ErrorBox, Loading, Modal, Money, MoneyInput, Notice, PageHeader, Select, StatusBadge, TableWrap, Tabs, TextInput, Narrow } from '../components/ui';

interface Staff { id: number; staffCode: string; fullName: string; jobRole: string; department: string | null; employmentType: string; basicSalary: string; startDate: string; status: string; phone: string | null; nssfNo: string | null; tin: string | null }
interface RateSet { id: number; effectiveFrom: string; nssfEmployeeRate: string; nssfEmployerRate: string; notes: string | null; validated: boolean; validatedBy: string | null; bands: Array<{ lowerBound: string; upperBound: string | null; rate: string }> }
interface RunSummary { id: number; year: number; month: number; label: string; status: string; termLabel: string; totalBasic: string; totalNet: string; expenseAmount: string }
interface Entry { id: number; staffId: number; staffCode: string; fullName: string; jobRole: string; department: string | null; basic: string; nssfEmployee: string; nssfEmployer: string; paye: string; otherDeductions: string; otherNote: string | null; net: string }
interface Run {
  id: number; year: number; month: number; label: string; status: string; termId: number; termLabel: string;
  rateSet: { id: number; effectiveFrom: string; validated: boolean };
  totals: { basic: string; nssfEmployee: string; nssfEmployer: string; paye: string; other: string; net: string; expenseAmount: string };
  preparedById: number; preparedBy: string | null; preparedAt: string; submittedAt: string | null; approvedBy: string | null; approvedAt: string | null; decisionNote: string | null;
  expense: { id: number; expenseNo: string; amount: string } | null; entries: Entry[];
}

const pct = (r: string) => `${(Number(r) * 100).toFixed(2).replace(/\.00$/, '')}%`;

function PayrollBanner() {
  const { lookups } = useLookups();
  if (lookups?.school.payrollEnabled) return null;
  return (
    <div className="mb-4">
      <Notice tone="warning" title="Payroll posting is switched off">
        You can keep the staff list and prepare payroll runs, but no run can be approved into the accounts until the PAYE bands and NSSF rates are checked against current URA and NSSF rules and an administrator switches payroll on in Setup. The rates loaded at start-up are the old ones from the spreadsheet.
      </Notice>
    </div>
  );
}

export function PayrollPage() {
  const [tab, setTab] = useState('runs');
  return (
    <div>
      <PageHeader title="Payroll" subtitle="Staff, monthly payroll runs and payslips. An approved run posts basic pay plus employer NSSF as one Salaries expense." />
      <PayrollBanner />
      <Tabs tabs={[{ key: 'runs', label: 'Payroll runs' }, { key: 'staff', label: 'Staff' }, { key: 'rates', label: 'PAYE and NSSF rates' }]} active={tab} onChange={setTab} />
      {tab === 'runs' && <Runs />}
      {tab === 'staff' && <StaffList />}
      {tab === 'rates' && <Rates />}
    </div>
  );
}

function Runs() {
  const { can } = useAuth();
  const { lookups } = useLookups();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['payroll-runs'], queryFn: () => api.get<RunSummary[]>('/payroll/runs') });
  const now = todayIso();
  const [form, setForm] = useState({ year: now.slice(0, 4), month: String(Number(now.slice(5, 7))), termId: '' });
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: () => api.post<Run>('/payroll/runs', { year: Number(form.year), month: Number(form.month), termId: form.termId ? Number(form.termId) : undefined }),
    onSuccess: (r) => navigate(`/payroll/runs/${r.id}`),
  });
  return (
    <Card padded={false} title="Monthly runs" actions={can('payroll.manage') && <Button onClick={() => setOpen(true)}>Prepare a month</Button>}>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : q.data?.length === 0 ? <div className="p-4"><Empty title="No payroll runs yet" /></div> : (
        <TableWrap>
          <table className="table">
            <thead><tr><th>Month</th><th>Posted to term</th><th>Status</th><th className="num">Basic pay</th><th className="num">Net pay</th><th className="num">Cost to school</th></tr></thead>
            <tbody>
              {q.data?.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/payroll/runs/${r.id}`} className="link">{r.label}</Link></td>
                  <td>{r.termLabel}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num"><Money value={r.totalBasic} /></td>
                  <td className="num"><Money value={r.totalNet} /></td>
                  <td className="num"><Money value={r.expenseAmount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Modal open={open} title="Prepare a payroll month" onClose={() => setOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button busy={create.isPending} onClick={() => create.mutate()}>Prepare</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i, 1).toLocaleString('en-GB', { month: 'long' }) }))} />
          <TextInput label="Year" inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
          <Select className="sm:col-span-2" label="Post salaries to term" value={form.termId} onChange={(e) => setForm({ ...form, termId: e.target.value })} placeholder="Work it out from the month"
            hint="By default: the term that contains the 15th of the month, or for a holiday month the term that just ended." options={(lookups?.terms ?? []).map((t) => ({ value: t.id, label: `${t.label}${t.status === 'CLOSED' ? ' (closed)' : ''}` }))} />
        </div>
        <ErrorBox error={create.error} />
      </Modal>
    </Card>
  );
}

const blankStaff = { fullName: '', jobRole: '', department: '', employmentType: '', basicSalary: '', startDate: todayIso(), status: 'ACTIVE', phone: '', nssfNo: '', tin: '' };

function StaffList() {
  const { can } = useAuth();
  const { options, label } = useLookups();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api.get<Staff[]>('/payroll/staff') });
  const [editing, setEditing] = useState<Staff | 'new' | null>(null);
  const [f, setF] = useState(blankStaff);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, basicSalary: cleanAmount(f.basicSalary) };
      return editing === 'new' ? api.post('/payroll/staff', body) : api.patch(`/payroll/staff/${(editing as Staff).id}`, body);
    },
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ['staff'] }); },
  });
  const open = (s: Staff | 'new') => {
    setF(s === 'new' ? blankStaff : { fullName: s.fullName, jobRole: s.jobRole, department: s.department ?? '', employmentType: s.employmentType, basicSalary: s.basicSalary, startDate: s.startDate, status: s.status, phone: s.phone ?? '', nssfNo: s.nssfNo ?? '', tin: s.tin ?? '' });
    setEditing(s);
  };
  return (
    <Card padded={false} title="Staff" actions={can('payroll.manage') && <Button onClick={() => open('new')}>Add staff member</Button>}>
      {q.isLoading ? <Loading /> : q.data?.length === 0 ? <div className="p-4"><Empty title="No staff yet" /></div> : (
        <TableWrap>
          <table className="table">
            <thead><tr><th>Staff ID</th><th>Name</th><th>Role</th><th>Department</th><th>Type</th><th>Started</th><th>Status</th><th className="num">Basic salary</th>{can('payroll.manage') && <th />}</tr></thead>
            <tbody>
              {q.data?.map((s) => (
                <tr key={s.id} className={s.status === 'ACTIVE' ? '' : 'text-slate-400'}>
                  <td className="font-mono text-xs">{s.staffCode}</td><td>{s.fullName}</td><td>{s.jobRole}</td><td>{s.department}</td>
                  <td>{label('EMPLOYMENT_TYPE', s.employmentType)}</td><td>{formatDate(s.startDate)}</td><td><StatusBadge status={s.status} /></td>
                  <td className="num"><Money value={s.basicSalary} /></td>
                  {can('payroll.manage') && <td><Button variant="ghost" onClick={() => open(s)}>Edit</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Modal open={!!editing} wide title={editing === 'new' ? 'Add staff member' : 'Edit staff member'} onClose={() => setEditing(null)}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button busy={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
          <TextInput label="Job role" value={f.jobRole} onChange={(e) => setF({ ...f, jobRole: e.target.value })} required />
          <TextInput label="Department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} />
          <Select label="Employment type" value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })} placeholder="Choose…" options={options('EMPLOYMENT_TYPE')} required />
          <MoneyInput label="Basic monthly salary (UGX)" value={f.basicSalary} onChange={(v) => setF({ ...f, basicSalary: v })} required />
          <DateInput label="Start date" value={f.startDate} onChange={(v) => setF({ ...f, startDate: v })} required />
          <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
          <TextInput label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <TextInput label="NSSF number" value={f.nssfNo} onChange={(e) => setF({ ...f, nssfNo: e.target.value })} />
          <TextInput label="TIN" value={f.tin} onChange={(e) => setF({ ...f, tin: e.target.value })} />
        </div>
        <ErrorBox error={save.error} />
      </Modal>
    </Card>
  );
}

function Rates() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payroll-rates'], queryFn: () => api.get<RateSet[]>('/payroll/rates') });
  const [adding, setAdding] = useState(false);
  const [validating, setValidating] = useState<RateSet | null>(null);
  const [by, setBy] = useState('');
  const [f, setF] = useState({ effectiveFrom: todayIso(), nssfEmployeeRate: '0.05', nssfEmployerRate: '0.10', notes: '', bands: [{ lowerBound: '0', upperBound: '', rate: '0' }] });
  const create = useMutation({
    mutationFn: () => api.post('/payroll/rates', { ...f, bands: f.bands.map((b) => ({ lowerBound: cleanAmount(b.lowerBound), upperBound: b.upperBound ? cleanAmount(b.upperBound) : null, rate: b.rate })) }),
    onSuccess: () => { setAdding(false); void qc.invalidateQueries({ queryKey: ['payroll-rates'] }); },
  });
  const validate = useMutation({ mutationFn: () => api.post(`/payroll/rates/${validating!.id}/validate`, { validatedBy: by }), onSuccess: () => { setValidating(null); void qc.invalidateQueries({ queryKey: ['payroll-rates'] }); } });
  const setBand = (i: number, patch: Partial<(typeof f.bands)[number]>) => setF({ ...f, bands: f.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  return (
    <div className="space-y-4">
      {can('payroll.rates') && <div><Button onClick={() => setAdding(true)}>Add a new rate set</Button></div>}
      {q.data?.map((s) => (
        <Card key={s.id} title={`Effective from ${formatDate(s.effectiveFrom)}`}
          actions={s.validated ? <StatusBadge status="APPROVED" label={`Checked: ${s.validatedBy}`} /> : <>
            <StatusBadge status="PENDING" label="Not yet checked" />
            {can('payroll.rates') && <Button variant="secondary" onClick={() => { setBy(''); setValidating(s); }}>Mark as checked</Button>}
          </>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">PAYE bands (monthly)</p>
              <table className="table mt-1">
                <thead><tr><th className="num">From</th><th className="num">Up to</th><th className="num">Rate</th></tr></thead>
                <tbody>{s.bands.map((b, i) => <tr key={i}><td className="num">{formatMoney(b.lowerBound)}</td><td className="num">{b.upperBound ? formatMoney(b.upperBound) : 'and above'}</td><td className="num">{pct(b.rate)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="text-sm">
              <p><span className="text-slate-500">NSSF, employee share:</span> {pct(s.nssfEmployeeRate)}</p>
              <p><span className="text-slate-500">NSSF, employer share:</span> {pct(s.nssfEmployerRate)}</p>
              {s.notes && <p className="mt-2 text-slate-600">{s.notes}</p>}
            </div>
          </div>
        </Card>
      ))}
      <Modal open={adding} wide title="Add PAYE and NSSF rates" onClose={() => setAdding(false)}
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button busy={create.isPending} onClick={() => create.mutate()}>Save rates</Button></>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <DateInput label="Effective from" value={f.effectiveFrom} onChange={(v) => setF({ ...f, effectiveFrom: v })} required />
          <TextInput label="NSSF employee rate" value={f.nssfEmployeeRate} onChange={(e) => setF({ ...f, nssfEmployeeRate: e.target.value })} hint="As a fraction, 0.05 = 5%" />
          <TextInput label="NSSF employer rate" value={f.nssfEmployerRate} onChange={(e) => setF({ ...f, nssfEmployerRate: e.target.value })} hint="As a fraction, 0.10 = 10%" />
        </div>
        <p className="text-sm font-medium">PAYE bands. The first starts at 0, each starts where the last ended, and only the top band is open-ended.</p>
        {f.bands.map((b, i) => (
          <div key={i} className="grid grid-cols-4 items-end gap-2">
            <TextInput label="From (UGX)" value={b.lowerBound} onChange={(e) => setBand(i, { lowerBound: e.target.value })} />
            <TextInput label="Up to (UGX)" value={b.upperBound} placeholder="Leave empty for top band" onChange={(e) => setBand(i, { upperBound: e.target.value })} />
            <TextInput label="Rate" value={b.rate} onChange={(e) => setBand(i, { rate: e.target.value })} hint="0.30 = 30%" />
            <Button variant="ghost" disabled={f.bands.length === 1} onClick={() => setF({ ...f, bands: f.bands.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setF({ ...f, bands: [...f.bands, { lowerBound: f.bands[f.bands.length - 1].upperBound, upperBound: '', rate: '' }] })}>Add band</Button>
        <TextInput label="Notes / source" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <ErrorBox error={create.error} />
      </Modal>
      <Modal open={!!validating} title="Mark these rates as checked" onClose={() => setValidating(null)}
        footer={<><Button variant="secondary" onClick={() => setValidating(null)}>Cancel</Button><Button busy={validate.isPending} disabled={by.trim().length < 3} onClick={() => validate.mutate()}>Confirm</Button></>}>
        <p className="text-sm text-slate-600">Only confirm once an accountant or URA/NSSF source has confirmed these bands and rates are current. Payroll runs cannot be posted with unchecked rates.</p>
        <TextInput label="Checked by (name and source)" value={by} onChange={(e) => setBy(e.target.value)} required />
        <ErrorBox error={validate.error} />
      </Modal>
    </div>
  );
}

export function PayrollRunPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const { lookups } = useLookups();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['payroll-run', id], queryFn: () => api.get<Run>(`/payroll/runs/${id}`) });
  const [err, setErr] = useState<unknown>(null);
  const done = (r?: unknown) => { setErr(null); if (r) qc.setQueryData(['payroll-run', id], r); void qc.invalidateQueries({ queryKey: ['payroll-runs'] }); void qc.invalidateQueries({ queryKey: ['approvals'] }); };
  const act = useMutation({ mutationFn: (path: string) => api.post<Run>(`/payroll/runs/${id}/${path}`), onSuccess: done, onError: setErr });
  const setTerm = useMutation({ mutationFn: (termId: number) => api.patch<Run>(`/payroll/runs/${id}`, { termId }), onSuccess: done, onError: setErr });
  const decide = useMutation({ mutationFn: ({ approve, note }: { approve: boolean; note: string }) => api.post<Run>(`/payroll/runs/${id}/decide`, { approve, note: note || null }), onSuccess: done, onError: setErr });
  const del = useMutation({ mutationFn: () => api.del(`/payroll/runs/${id}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['payroll-runs'] }); navigate('/payroll'); }, onError: setErr });
  const [other, setOther] = useState<Entry | null>(null);
  const [of, setOf] = useState({ amount: '', note: '' });
  const saveOther = useMutation({ mutationFn: () => api.patch<Run>(`/payroll/runs/${id}/entries/${other!.id}`, { otherDeductions: cleanAmount(of.amount) || '0', otherNote: of.note || null }), onSuccess: (r) => { setOther(null); done(r); } });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const r = q.data;
  const editable = can('payroll.manage') && ['DRAFT', 'REJECTED'].includes(r.status);
  return (
    <div>
      <PageHeader title={`Payroll: ${r.label}`} crumbs={[{ label: 'Payroll', to: '/payroll' }, { label: r.label }]}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} /> Salaries post to {r.termLabel} · Rates from {formatDate(r.rateSet.effectiveFrom)} {!r.rateSet.validated && <StatusBadge status="PENDING" label="Rates not checked" />}</span>}
        actions={<>
          {editable && <Button variant="secondary" busy={act.isPending} onClick={() => act.mutate('recalculate')}>Recalculate</Button>}
          {editable && <Button busy={act.isPending} onClick={() => act.mutate('submit')}>Submit for approval</Button>}
          {editable && <Button variant="ghost" onClick={() => window.confirm('Delete this draft payroll run?') && del.mutate()}>Delete draft</Button>}
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        </>} />
      <PayrollBanner />
      {r.status === 'REJECTED' && r.decisionNote && <div className="mb-4"><Notice tone="warning" title="Rejected">{r.decisionNote}</Notice></div>}
      {r.expense && <div className="mb-4"><Notice tone="success">Posted as expense <Link className="link" to={`/expenses/${r.expense.id}`}>{r.expense.expenseNo}</Link> for UGX {formatMoney(r.expense.amount)} (basic pay plus employer NSSF). Approved by {r.approvedBy} on {formatDateTime(r.approvedAt)}.</Notice></div>}
      <ErrorBox error={err} />
      {editable && (
        <div className="no-print mb-4 max-w-sm">
          <Select label="Post salaries to term" value={String(r.termId)} onChange={(e) => setTerm.mutate(Number(e.target.value))} options={(lookups?.terms ?? []).map((t) => ({ value: t.id, label: t.label }))} />
        </div>
      )}
      <Card padded={false}>
        <TableWrap>
          <table className="table">
            <thead><tr><th>Staff</th><th>Role</th><th className="num">Basic</th><th className="num">NSSF (employee)</th><th className="num">PAYE</th><th className="num">Other deductions</th><th className="num">Net pay</th><th className="num">NSSF (employer)</th><th className="w-36">Signature</th><th className="no-print" /></tr></thead>
            <tbody>
              {r.entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.fullName}<span className="block font-mono text-xs text-slate-500">{e.staffCode}</span></td>
                  <td>{e.jobRole}</td>
                  <td className="num"><Money value={e.basic} /></td>
                  <td className="num computed"><Money value={e.nssfEmployee} /></td>
                  <td className="num computed"><Money value={e.paye} /></td>
                  <td className="num"><Money value={e.otherDeductions} />{e.otherNote && <span className="block text-xs text-slate-500">{e.otherNote}</span>}</td>
                  <td className="num computed font-semibold"><Money value={e.net} /></td>
                  <td className="num computed"><Money value={e.nssfEmployer} /></td>
                  <td className="w-36 border-b border-slate-400" aria-label={`Signature for ${e.fullName}`} />
                  <td className="no-print whitespace-nowrap">
                    <Link to={`/payroll/runs/${r.id}/payslips/${e.staffId}`} className="link text-xs">Payslip</Link>
                    {editable && <button type="button" className="link ml-3 text-xs" onClick={() => { setOf({ amount: e.otherDeductions, note: e.otherNote ?? '' }); setOther(e); }}>Deductions</button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-semibold">
              <tr><td colSpan={2} className="px-3 py-2">Totals</td><td className="num px-3"><Money value={r.totals.basic} /></td><td className="num px-3"><Money value={r.totals.nssfEmployee} /></td><td className="num px-3"><Money value={r.totals.paye} /></td><td className="num px-3"><Money value={r.totals.other} /></td><td className="num px-3"><Money value={r.totals.net} /></td><td className="num px-3"><Money value={r.totals.nssfEmployer} /></td><td /><td className="no-print" /></tr>
            </tfoot>
          </table>
        </TableWrap>
        <p className="border-t border-slate-200 px-4 py-3 text-sm">Cost to the school, posted as the Salaries expense: <strong>UGX {formatMoney(r.totals.expenseAmount)}</strong> (basic pay plus employer NSSF).</p>
      </Card>
      <p className="mt-2 text-xs text-slate-500">Prepared by {r.preparedBy} on {formatDateTime(r.preparedAt)}{r.submittedAt ? `, submitted ${formatDateTime(r.submittedAt)}` : ''}.</p>
      {r.status === 'SUBMITTED' && can('payroll.approve') && (
        <Card className="no-print mt-4" title="Approve and post">
          <p className="mb-3 text-sm text-slate-600">Approving posts one Salaries expense of UGX {formatMoney(r.totals.expenseAmount)} to {r.termLabel}.</p>
          <DecisionButtons busy={decide.isPending} onDecide={(approve, note) => decide.mutate({ approve, note })}
            disabledReason={r.preparedById === me?.id ? 'You prepared this run, so someone else must approve it.' : null} />
        </Card>
      )}
      <Modal open={!!other} title={`Other deductions: ${other?.fullName ?? ''}`} onClose={() => setOther(null)}
        footer={<><Button variant="secondary" onClick={() => setOther(null)}>Cancel</Button><Button busy={saveOther.isPending} onClick={() => saveOther.mutate()}>Save</Button></>}>
        <MoneyInput label="Amount (UGX)" value={of.amount} onChange={(v) => setOf({ ...of, amount: v })} />
        <TextInput label="What it is for" value={of.note} onChange={(e) => setOf({ ...of, note: e.target.value })} hint="For example a salary advance or loan repayment" />
        <ErrorBox error={saveOther.error} />
      </Modal>
    </div>
  );
}

export function PayslipPage() {
  const { id, staffId } = useParams();
  const q = useQuery({ queryKey: ['payslip', id, staffId], queryFn: () => api.get<{ school: { name: string; address: string | null }; period: string; status: string; entry: Entry }>(`/payroll/runs/${id}/payslips/${staffId}`) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const { school, period, status, entry: e } = q.data;
  const row = (k: string, v: string, strong = false) => <tr className="border-b border-slate-100"><td className="py-1.5">{k}</td><td className={`py-1.5 text-right tabular-nums ${strong ? 'font-bold' : ''}`}>{formatMoney(v)}</td></tr>;
  return (
    <Narrow width="xl">
      <div className="no-print">
        <PageHeader title={`Payslip: ${e.fullName}`} crumbs={[{ label: 'Payroll', to: '/payroll' }, { label: period, to: `/payroll/runs/${id}` }, { label: e.staffCode }]} actions={<Button onClick={() => window.print()}>Print payslip</Button>} />
        {status !== 'POSTED' && <div className="mb-4"><Notice tone="warning">This payroll run is not approved yet ({status.toLowerCase()}). Figures may change.</Notice></div>}
      </div>
      <article className="card print-area p-6">
        <header className="border-b-2 border-accent-600 pb-3">
          <h2 className="text-lg font-bold uppercase text-brand-900">{school.name}</h2>
          {school.address && <p className="text-sm">{school.address}</p>}
          <p className="mt-2 font-semibold">Payslip for {period}</p>
        </header>
        <div className="mt-3 grid grid-cols-2 gap-1 text-sm">
          <p><span className="text-slate-500">Name:</span> {e.fullName}</p><p><span className="text-slate-500">Staff ID:</span> {e.staffCode}</p>
          <p><span className="text-slate-500">Role:</span> {e.jobRole}</p><p><span className="text-slate-500">Department:</span> {e.department ?? '—'}</p>
        </div>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {row('Basic salary', e.basic)}
            {row('Less NSSF (employee share)', e.nssfEmployee)}
            {row('Less PAYE', e.paye)}
            {Number(e.otherDeductions) > 0 && row(`Less other deductions${e.otherNote ? ` (${e.otherNote})` : ''}`, e.otherDeductions)}
            <tr className="border-t-2 border-slate-800"><td className="py-2 font-semibold">Net pay (UGX)</td><td className="py-2 text-right text-lg font-bold tabular-nums">{formatMoney(e.net)}</td></tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">Employer NSSF contribution paid on your behalf: UGX {formatMoney(e.nssfEmployer)}</p>
      </article>
    </Narrow>
  );
}
