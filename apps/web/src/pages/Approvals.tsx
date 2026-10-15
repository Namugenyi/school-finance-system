import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { Card, DecisionButtons, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';

interface Item { type: string; id: number; title: string; detail: string; amount: string | null; requestedBy: string; requestedAt: string; link: string; ownEntry: boolean; canDecide: boolean }

const ENDPOINT: Record<string, (id: number) => string> = {
  DISCOUNT: (id) => `/charges/discounts/${id}/decide`,
  EXPENSE: (id) => `/expenses/${id}/decide`,
  REVERSAL: (id) => `/payments/reversals/${id}/decide`,
  PAYROLL: (id) => `/payroll/runs/${id}/decide`,
  TERM_CLOSE: (id) => `/term-close/snapshots/${id}/decide`,
};
const TYPE_LABEL: Record<string, string> = { DISCOUNT: 'Discount or waiver', EXPENSE: 'Expense', REVERSAL: 'Payment reversal', PAYROLL: 'Payroll posting', TERM_CLOSE: 'Term close' };

export function ApprovalsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<Item[]>('/approvals') });
  const [error, setError] = useState<unknown>(null);
  const decide = useMutation({
    mutationFn: ({ item, approve, note }: { item: Item; approve: boolean; note: string }) => api.post(ENDPOINT[item.type](item.id), { approve, note: note || null }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries();
    },
    onError: setError,
  });
  const items = q.data ?? [];
  return (
    <div>
      <PageHeader title="Approvals" subtitle="Entries that need a second person before they count. Nobody can approve their own entry." />
      <ErrorBox error={error ?? q.error} />
      {q.isLoading && <Loading />}
      {q.data && items.length === 0 && <Empty title="Nothing is waiting for approval" />}
      <div className="mt-4 space-y-3">
        {items.map((i) => (
          <Card key={`${i.type}-${i.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{TYPE_LABEL[i.type]}</p>
                <Link to={i.link} className="link text-base">{i.title}</Link>
                <p className="mt-0.5 text-sm text-slate-600">{i.detail}</p>
                <p className="mt-1 text-xs text-slate-500">Entered by {i.requestedBy} on {formatDateTime(i.requestedAt)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {i.amount && <p className="text-lg font-semibold tabular-nums">UGX {formatMoney(i.amount)}</p>}
                <DecisionButtons
                  busy={decide.isPending}
                  disabledReason={i.ownEntry ? 'You entered this, so someone else must approve it.' : !i.canDecide ? 'Your role cannot approve this.' : null}
                  onDecide={(approve, note) => decide.mutate({ item: i, approve, note })}
                />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
