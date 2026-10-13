import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth, useLookups } from '../lib/auth';
import { cx } from './ui';
import { formatMoney } from '../lib/format';

interface NavItem { to: string; label: string; perm?: string; icon: string }
const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: '', items: [{ to: '/', label: 'Dashboard', perm: 'dashboard.view', icon: '◧' }, { to: '/approvals', label: 'Approvals', perm: 'approvals.view', icon: '✓' }] },
  {
    group: 'Records',
    items: [
      { to: '/pupils', label: 'Pupils', perm: 'pupils.view', icon: '👤' },
      { to: '/fees', label: 'Fee structure', perm: 'fees.view', icon: '▤' },
      { to: '/charges', label: 'Charges', perm: 'charges.view', icon: '≡' },
      { to: '/payments', label: 'Payments & receipts', perm: 'payments.view', icon: '₵' },
      { to: '/expenses', label: 'Expenses', perm: 'expenses.view', icon: '↗' },
      { to: '/owner-funds', label: 'Owner funds', perm: 'owner.view', icon: '◆' },
      { to: '/payroll', label: 'Staff & payroll', perm: 'payroll.view', icon: '☰' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/billing', label: 'Term billing', perm: 'billing.run', icon: '⊞' },
      { to: '/carry-forward', label: 'Carry forward', perm: 'carryforward.run', icon: '⇥' },
      { to: '/term-close', label: 'Term close & snapshots', perm: 'snapshots.view', icon: '⊡' },
    ],
  },
  {
    group: 'Reports',
    items: [
      { to: '/arrears', label: 'Arrears list', perm: 'arrears.view', icon: '!' },
      { to: '/statements', label: 'Pupil statements', perm: 'statements.view', icon: '⎙' },
      { to: '/reports', label: 'Financial reports', perm: 'reports.view', icon: '▥' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/setup', label: 'Setup', perm: 'setup.view', icon: '⚙' },
      { to: '/users', label: 'Users & roles', perm: 'users.manage', icon: '⚿' },
      { to: '/audit', label: 'Audit log', perm: 'audit.view', icon: '⌕' },
    ],
  },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<{ pupils: Array<{ id: number; pupilCode: string; fullName: string }>; receipts: Array<{ id: number; receiptNo: string; total: string }>; expenses: Array<{ id: number; expenseNo: string; description: string }> }>(`/search${qs({ q })}`),
    enabled: q.trim().length >= 2,
  });
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };
  const results = data ? data.pupils.length + data.receipts.length + data.expenses.length : 0;
  return (
    <div ref={box} className="relative w-full max-w-md">
      <input
        className="input bg-slate-50"
        type="search"
        placeholder="Search pupils, receipts, expenses…"
        aria-label="Search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && q.trim().length >= 2 && data && (
        <div className="absolute z-40 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {results === 0 && <p className="px-3 py-2 text-slate-500">No matches</p>}
          {data.pupils.map((p) => (
            <button key={`p${p.id}`} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => go(`/pupils/${p.id}`)}>
              <span className="font-medium">{p.fullName}</span> <span className="text-slate-500">{p.pupilCode}</span>
            </button>
          ))}
          {data.receipts.map((r) => (
            <button key={`r${r.id}`} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => go(`/receipts/${r.receiptNo}`)}>
              Receipt <span className="font-medium">{r.receiptNo}</span> <span className="text-slate-500">UGX {formatMoney(r.total)}</span>
            </button>
          ))}
          {data.expenses.map((e) => (
            <button key={`e${e.id}`} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => go(`/expenses/${e.id}`)}>
              Expense <span className="font-medium">{e.expenseNo}</span> <span className="text-slate-500">{e.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const { me, can, signOut } = useAuth();
  const { lookups } = useLookups();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
  }, [location.pathname]);
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<Array<{ canDecide: boolean }>>('/approvals'), enabled: can('approvals.view'), refetchInterval: 60_000 });
  const waiting = approvals.data?.filter((a) => a.canDecide).length ?? 0;

  const nav = (
    <nav aria-label="Main" className="space-y-5 px-3 py-4">
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.perm || can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.group || 'top'}>
            {g.group && <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-brand-200/80">{g.group}</p>}
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.to === '/'}
                    className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm', isActive ? 'bg-brand-800 font-medium text-white' : 'text-brand-100 hover:bg-brand-800/60 hover:text-white')}
                  >
                    <span aria-hidden className="w-4 text-center text-xs opacity-80">{i.icon}</span>
                    <span className="flex-1">{i.label}</span>
                    {i.to === '/approvals' && waiting > 0 && <span className="rounded-full bg-gold-400 px-1.5 text-xs font-semibold text-brand-950">{waiting}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className={cx('no-print fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto bg-brand-900 transition lg:static lg:translate-x-0', menuOpen ? 'translate-x-0' : '-translate-x-full')}>
        <Link to="/" className="flex items-center gap-2.5 border-b border-brand-800 px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gold-400 text-lg font-bold text-brand-950">S</span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-white">STJA Finance</span>
            <span className="block text-[11px] text-brand-200">Supreme Tower Junior Academy</span>
          </span>
        </Link>
        {nav}
      </aside>
      {menuOpen && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
          <button type="button" className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">☰</button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            {lookups?.school.name.includes('DEMO') && <span className="hidden rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 sm:inline">DEMO DATA</span>}
            {can('approvals.view') && (
              <Link to="/approvals" className="relative rounded p-1.5 text-slate-600 hover:bg-slate-100" aria-label={`Approvals waiting: ${waiting}`}>
                <span aria-hidden>🔔</span>
                {waiting > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{waiting}</span>}
              </Link>
            )}
            <div className="relative">
              <button type="button" onClick={() => setUserOpen((o) => !o)} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-100" aria-expanded={userOpen}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{me?.fullName.split(' ').map((s) => s[0]).slice(0, 2).join('')}</span>
                <span className="hidden text-left sm:block">
                  <span className="block font-medium leading-tight">{me?.fullName}</span>
                  <span className="block text-xs leading-tight text-slate-500">{me?.roles.join(', ')}</span>
                </span>
              </button>
              {userOpen && (
                <div className="absolute right-0 z-40 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
                  <Link to="/account" className="block px-3 py-2 hover:bg-slate-50">Change password</Link>
                  <button type="button" className="block w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => void signOut()}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
