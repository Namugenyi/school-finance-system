import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, downloadUrl, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cleanAmount, formatDateTime } from '../lib/format';
import { Button, Card, Dt, Empty, ErrorBox, Loading, Money, PageHeader, Select, Stat, StatusBadge, TableWrap, TextInput } from '../components/ui';
import { TermSelect, scopeParams } from '../components/TermSelect';
import type { Charge, Paged } from '../lib/types';

interface ArrearsRow { pupilId: number; pupilCode: string; pupilName: string; className: string; pupilStatus: string; guardianName: string | null; phonePrimary: string | null; phoneAlt: string | null; totalBilled: string; totalPaid: string; outstanding: string; unpaidItems: number; status: string; statusLabel: string }

export function ArrearsPage() {
  const { lookups } = useLookups();
  const [scope, setScope] = useState('');
  const [classId, setClassId] = useState('');
  const [minBalance, setMinBalance] = useState('');
  const [onlyOutstanding, setOnlyOutstanding] = useState('true');
  const params = { ...scopeParams(scope), classId, minBalance: cleanAmount(minBalance), onlyOutstanding };
  const q = useQuery({ queryKey: ['arrears', params], queryFn: () => api.get<{ rows: ArrearsRow[]; totals: { pupils: number; totalBilled: string; totalPaid: string; outstanding: string }; contactsHidden: boolean }>(`/collections/arrears${qs(params)}`) });
  const scopeLabel = scope.startsWith('t:') ? lookups?.terms.find((t) => `t:${t.id}` === scope)?.label : scope.startsWith('y:') ? `Year ${lookups?.years.find((y) => `y:${y.id}` === scope)?.year}` : 'All terms';
  return (
    <div className="landscape-print">
      <PageHeader title="Arrears" subtitle={`Pupils who still owe money · ${scopeLabel}. Billed is net of approved discounts and leaves out arrears brought forward.`}
        actions={<>
          <Button variant="secondary" onClick={() => window.print()}>Print</Button>
          <Button variant="secondary" onClick={() => downloadUrl(`/collections/arrears${qs({ ...params, format: 'csv' })}`)}>Export CSV</Button>
        </>} />
      <div className="no-print mb-4 grid gap-3 sm:grid-cols-4">
        <TermSelect value={scope} onChange={setScope} allowAll allowYear />
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="All classes" options={(lookups?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <TextInput label="Owing at least (UGX)" inputMode="decimal" value={minBalance} onChange={(e) => setMinBalance(e.target.value)} />
        <Select label="Show" value={onlyOutstanding} onChange={(e) => setOnlyOutstanding(e.target.value)} options={[{ value: 'true', label: 'Only pupils who owe' }, { value: 'false', label: 'All billed pupils' }]} />
      </div>
      <ErrorBox error={q.error} />
      {q.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Pupils" value={q.data.totals.pupils} />
          <Stat label="Billed (UGX)" value={<Money value={q.data.totals.totalBilled} />} />
          <Stat label="Paid (UGX)" value={<Money value={q.data.totals.totalPaid} />} />
          <Stat label="Outstanding (UGX)" tone="bad" value={<Money value={q.data.totals.outstanding} credit />} />
        </div>
      )}
      <Card padded={false}>
        {q.isLoading ? <Loading /> : q.data?.rows.length === 0 ? <div className="p-4"><Empty title="Nobody owes anything for this selection" /></div> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Pupil ID</th><th>Pupil</th><th>Class</th><th>Status</th><th>Parent / guardian</th>{!q.data?.contactsHidden && <th>Phone</th>}<th className="num">Billed</th><th className="num">Paid</th><th className="num">Outstanding</th><th className="num">Unpaid items</th></tr></thead>
              <tbody>
                {q.data?.rows.map((r) => (
                  <tr key={r.pupilId} className={Number(r.outstanding) > 0 ? 'bg-red-50/40' : 'bg-emerald-50/40'}>
                    <td className="font-mono text-xs">{r.pupilCode}</td>
                    <td><Link to={`/statements/${r.pupilId}`} className="link">{r.pupilName}</Link>{r.pupilStatus !== 'ACTIVE' && <span className="ml-1"><StatusBadge status={r.pupilStatus} /></span>}</td>
                    <td>{r.className}</td>
                    <td><StatusBadge status={r.status} label={r.statusLabel} /></td>
                    <td>{r.guardianName}</td>
                    {!q.data?.contactsHidden && <td className="text-xs">{r.phonePrimary}{r.phoneAlt && <span className="block">{r.phoneAlt}</span>}</td>}
                    <td className="num"><Money value={r.totalBilled} /></td>
                    <td className="num"><Money value={r.totalPaid} /></td>
                    {/* FR-1304: owing in red, settled in green. */}
                    <td className={`num font-semibold ${Number(r.outstanding) > 0 ? 'text-red-700' : 'text-emerald-700'}`}><Money value={r.outstanding} credit /></td>
                    <td className="num">{r.unpaidItems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="mt-3 hidden text-xs text-slate-500 print:block">Printed {formatDateTime(new Date().toISOString())}</p>
    </div>
  );
}

interface Statement {
  school: { name: string; address: string | null; phone: string | null; email: string | null };
  pupil: { id: number; pupilCode: string; fullName: string; className: string; sectionName: string; status: string; guardianName: string | null; phonePrimary: string | null; address: string | null };
  charges: Charge[];
  payments: Array<{ receiptNo: string; paymentDate: string; feeItemName: string; termLabel: string; amount: string; method: string; reference: string | null; reversed: boolean }>;
  totals: { totalBilled: string; totalPaid: string; outstanding: string; status: string; statusLabel: string };
  generatedAt: string;
}

export function StatementPage() {
  const { pupilId } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { label } = useLookups();
  const [search, setSearch] = useState('');
  const pupils = useQuery({
    queryKey: ['pupil-pick', search],
    queryFn: () => api.get<Paged<{ id: number; pupilCode: string; fullName: string; className: string }>>(`/pupils${qs({ search, pageSize: 15 })}`),
    enabled: !pupilId && search.length >= 2,
  });
  const q = useQuery({ queryKey: ['statement', pupilId], queryFn: () => api.get<Statement>(`/collections/statements/${pupilId}`), enabled: !!pupilId });

  if (!pupilId)
    return (
      <div className="max-w-2xl">
        <PageHeader title="Statement of account" subtitle="Every charge and payment for a pupil, across all years." />
        <Card>
          <TextInput label="Find pupil" placeholder="Type at least 2 letters of the name or ID" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <ul className="mt-3 divide-y divide-slate-100">
            {pupils.data?.items.map((p) => (
              <li key={p.id}><button type="button" className="w-full px-2 py-2 text-left hover:bg-slate-50" onClick={() => navigate(`/statements/${p.id}`)}>
                <span className="font-medium">{p.fullName}</span> <span className="font-mono text-xs text-slate-500">{p.pupilCode}</span> <span className="text-sm text-slate-500">{p.className}</span>
              </button></li>
            ))}
          </ul>
        </Card>
      </div>
    );
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  const terms = [...new Set(s.charges.map((c) => c.termLabel))];
  return (
    <div className="max-w-5xl">
      <div className="no-print">
        <PageHeader title={`Statement: ${s.pupil.fullName}`} crumbs={[{ label: 'Statements', to: '/statements' }, { label: s.pupil.pupilCode }]}
          actions={<>
            <Button onClick={() => window.print()}>Print statement</Button>
            {can('payments.record') && <Link to={`/payments/new?pupilId=${s.pupil.id}`}><Button variant="secondary">Record payment</Button></Link>}
          </>} />
      </div>
      <article className="card print-area p-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-brand-800 pb-3">
          <div>
            <h2 className="text-lg font-bold uppercase text-brand-900">{s.school.name}</h2>
            <p className="text-sm">{[s.school.address, s.school.phone, s.school.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold uppercase tracking-wide">Statement of account</p>
            <p className="text-sm">As at {formatDateTime(s.generatedAt)}</p>
          </div>
        </header>
        <section className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          <p><span className="text-slate-500">Pupil:</span> <strong>{s.pupil.fullName}</strong> ({s.pupil.pupilCode})</p>
          <p><span className="text-slate-500">Class:</span> {s.pupil.className} · {s.pupil.sectionName} <StatusBadge status={s.pupil.status} /></p>
          <p><span className="text-slate-500">Parent / guardian:</span> {s.pupil.guardianName ?? '—'}</p>
          {s.pupil.phonePrimary && <p><span className="text-slate-500">Phone:</span> {s.pupil.phonePrimary}</p>}
        </section>
        <section className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded border border-slate-200 p-2"><p className="text-xs uppercase text-slate-500">Total billed</p><p className="font-semibold"><Money value={s.totals.totalBilled} /></p></div>
          <div className="rounded border border-slate-200 p-2"><p className="text-xs uppercase text-slate-500">Total paid</p><p className="font-semibold"><Money value={s.totals.totalPaid} /></p></div>
          <div className="rounded border border-slate-200 p-2"><p className="text-xs uppercase text-slate-500">Outstanding</p><p className="font-semibold"><Money value={s.totals.outstanding} credit /></p><StatusBadge status={s.totals.status} label={s.totals.statusLabel} /></div>
        </section>
        <h3 className="mt-6 font-semibold">Charges</h3>
        {terms.length === 0 ? <Empty title="No charges" /> : (
          <TableWrap>
            <table className="table mt-2">
              <thead><tr><th>Term</th><th>Fee item</th><th className="num">Charged</th><th className="num">Discount</th><th className="num">Net due</th><th className="num">Paid</th><th className="num">Carried</th><th className="num">Balance</th><th>Status</th></tr></thead>
              <tbody>
                {s.charges.map((c) => (
                  <tr key={c.id}>
                    <td>{c.termLabel}</td>
                    <td>{c.feeItemName}{c.arrearsFrom && <span className="block text-xs text-slate-500">from {c.arrearsFrom}</span>}</td>
                    <td className="num"><Money value={c.amountCharged} /></td>
                    <td className="num"><Money value={c.discount} /></td>
                    <td className="num"><Money value={c.netDue} /></td>
                    <td className="num"><Money value={c.totalPaid} /></td>
                    <td className="num">{Number(c.carriedForward) ? <Money value={c.carriedForward} /> : ''}</td>
                    <td className="num font-medium"><Money value={c.balance} credit /></td>
                    <td><StatusBadge status={c.status} balance={c.balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <h3 className="mt-6 font-semibold">Payments (newest first)</h3>
        {s.payments.length === 0 ? <Empty title="No payments" /> : (
          <TableWrap>
            <table className="table mt-2">
              <thead><tr><th>Date</th><th>Receipt</th><th>Fee item</th><th>Term</th><th>Method</th><th>Reference</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {s.payments.map((p, i) => (
                  <tr key={i} className={p.reversed ? 'text-slate-400 line-through' : ''}>
                    <td><Dt value={p.paymentDate} /></td>
                    <td className="font-mono text-xs"><Link className="link no-underline" to={`/receipts/${p.receiptNo}`}>{p.receiptNo}</Link>{p.reversed && ' (reversed)'}</td>
                    <td>{p.feeItemName}</td><td>{p.termLabel}</td><td>{label('PAYMENT_METHOD', p.method)}</td><td className="text-xs">{p.reference}</td>
                    <td className="num"><Money value={p.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </article>
    </div>
  );
}
