import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatMoney, parseDisplayDate } from '../lib/format';
import { ApiError } from '../lib/api';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-200',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'border border-red-700 bg-white text-red-700 hover:bg-red-50 disabled:border-red-200 disabled:text-red-300',
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

const ErrorIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="mt-px h-4 w-4 shrink-0"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
);

/** Ids for a field's helper text and error, so the control can point at them with aria-describedby. */
export const describedBy = (id: string, error?: string | null, hint?: ReactNode) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

export function Field({ label, error, hint, children, required, className }: { label: string; error?: string | null; hint?: ReactNode; children: (id: string) => ReactNode; required?: boolean; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
      </label>
      {children(id)}
      {hint && !error && <p id={`${id}-hint`} className="field-hint mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${id}-error`} className="field-error mt-1 flex items-start gap-1 text-xs font-medium text-red-700"><ErrorIcon />{error}</p>}
    </div>
  );
}

export function TextInput({ label, error, hint, required, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: ReactNode }) {
  return <Field label={label} error={error} hint={hint} required={required} className={className}>{(id) => <input id={id} className="input" required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} {...rest} />}</Field>;
}

export function Select({ label, options, placeholder, error, hint, required, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; options: Array<{ value: string | number; label: string }>; placeholder?: string; error?: string | null; hint?: ReactNode }) {
  const select = (id?: string) => (
    <select id={id} className="input" required={required} aria-invalid={error ? true : undefined} aria-describedby={id ? describedBy(id, error, hint) : undefined} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  if (!label) return select();
  return <Field label={label} error={error} hint={hint} required={required} className={className}>{(id) => select(id)}</Field>;
}

/** Code of the list value that asks the user to type what isn't on the list. */
export const OTHER = 'OTHER';

/** A list label plus the typed details when "Other" was chosen, e.g. "Other: Neighbour". */
export const withOther = (text: string | null | undefined, other: string | null | undefined) => (other ? `${text ?? 'Other'}: ${other}` : text);

/**
 * A dropdown that, when "Other" is picked, shows a required box for what isn't on the list.
 * In the two-column forms the box takes its own full-width row under the dropdown.
 */
export function SelectWithOther({ other, onOtherChange, otherLabel, otherError, onChange, value, ...rest }: Omit<Parameters<typeof Select>[0], 'onChange' | 'value'> & {
  value: string; onChange: (v: string) => void; other: string; onOtherChange: (v: string) => void; otherLabel: string; otherError?: string | null;
}) {
  return (
    <>
      <Select value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {value === OTHER && (
        <TextInput label={otherLabel} value={other} onChange={(e) => onOtherChange(e.target.value)} required maxLength={120} autoFocus error={otherError}
          placeholder="Type what isn’t on the list" className="sm:col-span-2" />
      )}
    </>
  );
}

/** Insert the slashes as digits are typed: "0102" -> "01/02/", "01022026" -> "01/02/2026". */
export function autoSlashDate(next: string, prev: string): string {
  if (/^\d{8}$/.test(next)) return `${next.slice(0, 2)}/${next.slice(2, 4)}/${next.slice(4)}`;
  if (next.length > prev.length && (/^\d{2}$/.test(next) || /^\d{1,2}\/\d{2}$/.test(next))) return `${next}/`;
  return next;
}

/** Tidy a typed date on leaving the field: "1/2/2026" -> "01/02/2026". Unparseable text is left as typed. */
function tidyDate(text: string): string {
  const iso = parseDisplayDate(text);
  return iso ? formatDate(iso) : text;
}

/**
 * Date entry shown and typed as DD/MM/YYYY (FR-606); the value is YYYY-MM-DD.
 * Slashes are added while typing, a calendar button opens the browser's date picker,
 * and a badly formed date is flagged when the person leaves the field.
 */
export function DateInput({ label, value, onChange, required, error, hint, className, disabled, max, min, onTextValidity }: { label: string; value: string; onChange: (iso: string) => void; required?: boolean; error?: string | null; hint?: ReactNode; className?: string; disabled?: boolean; max?: string; min?: string; onTextValidity?: (ok: boolean) => void }) {
  const [text, setText] = useState(formatDate(value));
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== last.current) {
      setText(formatDate(value));
      setBad(false);
      last.current = value;
    }
  }, [value]);
  const accept = (raw: string) => {
    setText(raw);
    const iso = parseDisplayDate(raw);
    if (iso) setBad(false);
    onTextValidity?.(raw.trim() === '' || !!iso);
    const next = iso ?? '';
    last.current = next;
    onChange(next);
  };
  const shown = error ?? (bad ? 'Enter the date as DD/MM/YYYY, for example 05/02/2026' : null);
  return (
    <Field label={label} required={required} error={shown} hint={hint ?? 'DD/MM/YYYY'} className={className}>
      {(id) => (
        <div className="relative">
          <input
            id={id}
            className="input pr-11"
            inputMode="numeric"
            autoComplete="off"
            placeholder="DD/MM/YYYY"
            maxLength={10}
            value={text}
            disabled={disabled}
            required={required}
            aria-invalid={shown ? true : undefined}
            aria-describedby={describedBy(id, shown, hint ?? 'DD/MM/YYYY')}
            onChange={(e) => accept(autoSlashDate(e.target.value, text))}
            onBlur={() => {
              const tidy = tidyDate(text);
              if (tidy !== text) setText(tidy);
              setBad(text.trim() !== '' && !parseDisplayDate(text));
            }}
          />
          <button
            type="button"
            disabled={disabled}
            className="date-pick absolute inset-y-1 right-1 inline-flex w-9 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              const el = picker.current;
              if (!el) return;
              el.value = value;
              try { el.showPicker(); } catch { el.focus(); }
            }}
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd" /></svg>
            {/* Named by its content, not aria-label, so it is never mistaken for the date box's own label. */}
            <span className="sr-only">Open calendar ({label})</span>
          </button>
          <input
            ref={picker}
            type="date"
            tabIndex={-1}
            aria-hidden
            max={max}
            min={min}
            className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
            onChange={(e) => { if (e.target.value) accept(formatDate(e.target.value)); }}
          />
        </div>
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
        <nav aria-label="Breadcrumb" className="no-print mb-1 text-xs text-slate-600">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5">/</span>}
              {c.to ? <Link to={c.to} className="hover:text-accent-700 hover:underline">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-900">{title}</h1>
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
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-accent-600" aria-hidden />
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
          className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', active === t.key ? 'border-accent-600 text-brand-900' : 'border-transparent text-slate-500 hover:text-slate-800')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const NARROW = { lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl', '5xl': 'max-w-5xl' } as const;

/** Page body for forms and single documents: a readable width, centred in the content area. */
export function Narrow({ width = '3xl', className, children }: { width?: keyof typeof NARROW; className?: string; children: ReactNode }) {
  return <div className={cx('mx-auto w-full', NARROW[width], className)}>{children}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  // NFR-06: the wrapper scrolls on its own so the sticky column headings stay in view on long lists.
  return <div className="max-h-[75vh] overflow-auto print:max-h-none print:overflow-visible">{children}</div>;
}

export function TextArea({ label, value, onChange, rows = 3, required, hint, error, maxLength, className, placeholder, autoComplete }: { label: string; value: string; onChange: (v: string) => void; rows?: number; required?: boolean; hint?: ReactNode; error?: string | null; maxLength?: number; className?: string; placeholder?: string; autoComplete?: string }) {
  return (
    <Field label={label} required={required} hint={hint} error={error} className={className}>
      {(id) => <textarea id={id} rows={rows} className="input" value={value} required={required} maxLength={maxLength} placeholder={placeholder} autoComplete={autoComplete} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
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
