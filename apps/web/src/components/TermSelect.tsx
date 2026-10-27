import { useEffect } from 'react';
import { useLookups } from '../lib/auth';

const KEY = 'stja.termId';

export function rememberedTermId(currentTermId: number | null): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v || currentTermId;
  } catch {
    return currentTermId;
  }
}

/** Academic year + term picker. Remembers the last choice in this browser only. */
export function TermSelect({ value, onChange, label = 'Year and term', allowAll, allowYear, className }: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  allowAll?: boolean;
  allowYear?: boolean;
  className?: string;
}) {
  const { lookups } = useLookups();
  useEffect(() => {
    if (!value && !allowAll && lookups) {
      const id = rememberedTermId(lookups.currentTermId) ?? lookups.terms[0]?.id;
      if (id && lookups.terms.some((t) => t.id === id)) onChange(`t:${id}`);
    }
  }, [lookups, value, allowAll, onChange]);
  return (
    <div className={className}>
      <label className="label" htmlFor="term-select">{label}</label>
      <select
        id="term-select"
        className="input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.startsWith('t:')) try { localStorage.setItem(KEY, e.target.value.slice(2)); } catch { /* storage unavailable */ }
        }}
      >
        {allowAll && <option value="">All terms</option>}
        {lookups?.years.map((y) => (
          <optgroup key={y.id} label={String(y.year)}>
            {allowYear && <option value={`y:${y.id}`}>Whole of {y.year}</option>}
            {y.terms.map((t) => (
              <option key={t.id} value={`t:${t.id}`}>{t.label}{t.status === 'CLOSED' ? ' (closed)' : ''}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** Turn a TermSelect value into API scope parameters. */
export function scopeParams(v: string): { termId?: number; academicYearId?: number } {
  if (v.startsWith('t:')) return { termId: Number(v.slice(2)) };
  if (v.startsWith('y:')) return { academicYearId: Number(v.slice(2)) };
  return {};
}
