import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatMoney, parseDisplayDate } from '../lib/format';
import { ApiError } from '../lib/api';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-300',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

export function Button({ variant = 'primary', busy, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx('inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed', variants[variant], className)}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, required, className }: { label: string; error?: string | null; hint?: ReactNode; children: (id: string) => ReactNode; required?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}

export function TextInput({ label, error, hint, required, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: ReactNode }) {
  return <Field label={label} error={error} hint={hint} required={required} className={className}>{(id) => <input id={id} className="input" required={required} {...rest} />}</Field>;
}

export function Select({ label, options, placeholder, error, hint, required, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; options: Array<{ value: string | number; label: string }>; placeholder?: string; error?: string | null; hint?: ReactNode }) {
  const select = (id?: string) => (
    <select id={id} className="input" required={required} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  if (!label) return select();
  return <Field label={label} error={error} hint={hint} required={required} className={className}>{(id) => select(id)}</Field>;
}

/** Date entry shown and typed as DD/MM/YYYY (FR-606); the value is YYYY-MM-DD. */
export function DateInput({ label, value, onChange, required, error, hint, className, disabled }: { label: string; value: string; onChange: (iso: string) => void; required?: boolean; error?: string | null; hint?: ReactNode; className?: string; disabled?: boolean }) {
  const [text, setText] = useState(formatDate(value));
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(formatDate(value));
      last.current = value;
    }
  }, [value]);
  return (
    <Field label={label} required={required} error={error ?? (bad ? 'Use DD/MM/YYYY' : null)} hint={hint ?? 'DD/MM/YYYY'} className={className}>
      {(id) => (
        <input
          id={id}
          className="input"
          inputMode="numeric"
          placeholder="DD/MM/YYYY"
          value={text}
          disabled={disabled}
          required={required}
          onChange={(e) => {
            setText(e.target.value);
            const iso = parseDisplayDate(e.target.value);
            setBad(e.target.value !== '' && !iso);
            const next = iso ?? '';
            last.current = next;
            onChange(next);
          }}
        />
      )}
    </Field>
  );
}

export function MoneyInput({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { error?: string | null; hint?: ReactNode }) {
  return <TextInput label={label} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function Money({ value, className, credit }: { value: string | number | null | undefined; className?: string; credit?: boolean }) {
  const n = Number(value ?? 0);
  // FR-507: a negative balance is a credit, shown differently from an arrear.
  if (credit && n < 0) return <span className={cx('tabular-nums font-medium text-sky-700', className)}>{formatMoney(Math.abs(n))} CR</span>;
  return <span className={cx('tabular-nums', className)}>{formatMoney(value)}</span>;
}

export const Dt = ({ value }: { value: string | null | undefined }) => <span className="tabular-nums">{formatDate(value)}</span>;

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  PAID: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
  PARTIAL: { label: 'Partial', cls: 'bg-amber-100 text-amber-900 ring-amber-600/30' },
  UNPAID: { label: 'Unpaid', cls: 'bg-red-100 text-red-800 ring-red-600/20' },
  CARRIED_FORWARD: { label: 'Carried forward', cls: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
  VOID: { label: 'Void', cls: 'bg-slate-100 text-slate-500 ring-slate-400/20 line-through' },
  ACTIVE: { label: 'Active', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
  WITHDRAWN: { label: 'Withdrawn', cls: 'bg-red-100 text-red-800 ring-red-600/20' },
  COMPLETED: { label: 'Completed', cls: 'bg-indigo-50 text-indigo-800 ring-indigo-600/20' },
  TRANSFERRED: { label: 'Transferred', cls: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
  ALUMNI: { label: 'Alumni', cls: 'bg-violet-50 text-violet-800 ring-violet-600/20' },
  PENDING: { label: 'Waiting for approval', cls: 'bg-amber-100 text-amber-900 ring-amber-600/30' },
  APPROVED: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
  REJECTED: { label: 'Rejected', cls: 'bg-red-100 text-red-800 ring-red-600/20' },
  DRAFT: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
  SUBMITTED: { label: 'Waiting for approval', cls: 'bg-amber-100 text-amber-900 ring-amber-600/30' },
  POSTED: { label: 'Posted', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
  OPEN: { label: 'Open', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
  CLOSED: { label: 'Closed', cls: 'bg-slate-200 text-slate-800 ring-slate-500/20' },
  PAID_IN_FULL: { label: 'Paid in Full', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20' },
  INACTIVE: { label: 'Inactive', cls: 'bg-slate-100 text-slate-600 ring-slate-400/20' },
  REVERSED: { label: 'Reversed', cls: 'bg-red-100 text-red-800 ring-red-600/20' },
};

/** Status shown as coloured text with a label, never colour alone (WR-26). */
export function StatusBadge({ status, label, balance }: { status: string; label?: string; balance?: string }) {
  if (status === 'PAID' && balance && Number(balance) < 0) {
    return <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-600/20">Paid (credit)</span>;
  }
  const s = STATUS_STYLE[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700 ring-slate-500/20' };
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', s.cls)}>{label ?? s.label}</span>;
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: Array<{ label: string; to?: string }> }) {
  useEffect(() => {
    document.title = `${title} · STJA Finance`;
  }, [title]);
  return (
    <div className="mb-5">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="no-print mb-1 text-xs text-slate-500">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5">/</span>}
              {c.to ? <Link to={c.to} className="hover:text-brand-700 hover:underline">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as Array<{ field: string; message: string }>) : null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-medium">{message}</p>
      {details && (
        <ul className="mt-1 list-disc pl-5">
          {details.map((d, i) => <li key={i}>{d.field ? `${d.field}: ` : ''}{d.message}</li>)}
        </ul>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warning' | 'success' | 'danger'; children: ReactNode; title?: string }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
  };
  return (
    <div className={cx('rounded-md border px-4 py-3 text-sm', tones[tone])} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-16" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={ref} className={cx('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="px-3 py-2 text-xs text-slate-500">{total} record{total === 1 ? '' : 's'}</p>;
  return (
    <div className="no-print flex items-center justify-between px-3 py-2 text-sm text-slate-600">
      <span>{total} records · page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'neutral'; hint?: ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx('mt-1 text-xl font-semibold tabular-nums', tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-900')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ key: string; label: string }>; active: string; onChange: (k: string) => void }) {
  return (
    <div className="no-print mb-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', active === t.key ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  // NFR-06: the wrapper scrolls on its own so the sticky column headings stay in view on long lists.
  return <div className="max-h-[75vh] overflow-auto print:max-h-none print:overflow-visible">{children}</div>;
}

export function TextArea({ label, value, onChange, rows = 3, required, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; required?: boolean; hint?: ReactNode }) {
  return <Field label={label} required={required} hint={hint}>{(id) => <textarea id={id} rows={rows} className="input" value={value} required={required} onChange={(e) => onChange(e.target.value)} />}</Field>;
}

/** Approve / reject with a note; the reason is required to reject. */
export function DecisionButtons({ onDecide, busy, disabledReason }: { onDecide: (approve: boolean, note: string) => void; busy?: boolean; disabledReason?: string | null }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  if (disabledReason) return <p className="text-xs text-slate-500">{disabledReason}</p>;
  if (rejecting)
    return (
      <div className="flex flex-wrap items-end gap-2">
        <input className="input max-w-xs" placeholder="Reason for rejecting" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason for rejecting" />
        <Button variant="danger" busy={busy} disabled={!note.trim()} onClick={() => onDecide(false, note)}>Reject</Button>
        <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
      </div>
    );
  return (
    <div className="flex gap-2">
      <Button variant="success" busy={busy} onClick={() => onDecide(true, '')}>Approve</Button>
      <Button variant="secondary" onClick={() => setRejecting(true)}>Reject</Button>
    </div>
  );
}

export const moneyText = formatMoney;
