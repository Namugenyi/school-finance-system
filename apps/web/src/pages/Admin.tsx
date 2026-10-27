import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { Button, Card, ErrorBox, Loading, Modal, Notice, PageHeader, Pagination, StatusBadge, TableWrap, Tabs, TextInput } from '../components/ui';
import type { Paged } from '../lib/types';

interface User { id: number; username: string; fullName: string; email: string | null; active: boolean; mustChangePassword: boolean; lastLoginAt: string | null; locked: boolean; roles: string[] }
interface Role { id: number; code: string; name: string; description: string | null; isSystem: boolean; userCount: number; permissions: string[] }

export function UsersPage() {
  const [tab, setTab] = useState('users');
  return (
    <div>
      <PageHeader title="Users and roles" subtitle="Who can sign in, and what each role is allowed to do. The server checks these permissions on every action." />
      <Tabs tabs={[{ key: 'users', label: 'Users' }, { key: 'roles', label: 'Roles and permissions' }]} active={tab} onChange={setTab} />
      {tab === 'users' ? <div className="space-y-4"><AccessRequests /><Users /></div> : <Roles />}
    </div>
  );
}

function Users() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/users/roles') });
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [f, setF] = useState({ username: '', fullName: '', email: '', password: '', roles: [] as string[], active: true });
  const open = (u: User | 'new') => {
    setF(u === 'new' ? { username: '', fullName: '', email: '', password: '', roles: [], active: true } : { username: u.username, fullName: u.fullName, email: u.email ?? '', password: '', roles: u.roles, active: u.active });
    setEditing(u);
  };
  const save = useMutation({
    mutationFn: () => editing === 'new'
      ? api.post('/users', { username: f.username, fullName: f.fullName, email: f.email || null, password: f.password, roles: f.roles })
      : api.patch(`/users/${(editing as User).id}`, { fullName: f.fullName, email: f.email || null, roles: f.roles, active: f.active, resetPassword: f.password || undefined }),
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
  });
  const unlock = useMutation({
    mutationFn: (id: number) => api.post(`/users/${id}/unlock`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const roleName = (code: string) => roles.data?.find((r) => r.code === code)?.name ?? code;
  return (
    <Card padded={false} title="Users" actions={<Button onClick={() => open('new')}>Add user</Button>}>
      {users.isLoading ? <Loading /> : (
        <TableWrap><table className="table">
          <thead><tr><th>Name</th><th>Username</th><th>Roles</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>{users.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.fullName}{u.id === me?.id && <span className="ml-1 text-xs text-slate-500">(you)</span>}</td>
              <td className="font-mono text-xs">{u.username}</td>
              <td className="whitespace-normal">{u.roles.map(roleName).join(', ')}</td>
              <td><StatusBadge status={u.active ? 'ACTIVE' : 'INACTIVE'} />{u.locked && <span className="ml-1 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-600/20">Locked</span>}{u.mustChangePassword && <span className="block text-xs text-amber-700">Must change password</span>}</td>
              <td className="text-xs">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</td>
              <td className="whitespace-nowrap">{u.locked && <Button variant="ghost" busy={unlock.isPending && unlock.variables === u.id} onClick={() => unlock.mutate(u.id)}>Unlock</Button>}<Button variant="ghost" onClick={() => open(u)}>Edit</Button></td>
            </tr>
          ))}</tbody>
        </table></TableWrap>
      )}
      <Modal open={!!editing} title={editing === 'new' ? 'Add user' : `Edit ${f.fullName}`} onClose={() => setEditing(null)}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button busy={save.isPending} disabled={!f.fullName || !f.roles.length || (editing === 'new' && (!f.username || !f.password))} onClick={() => save.mutate()}>Save</Button></>}>
        {editing === 'new' && <TextInput label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />}
        <TextInput label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
        <TextInput label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextInput label={editing === 'new' ? 'Temporary password' : 'Reset password (leave empty to keep)'} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })}
          hint="At least 10 characters with a letter and a number. They must change it when they first sign in." />
        <fieldset>
          <legend className="label">Roles</legend>
          <div className="grid gap-1 sm:grid-cols-2">{roles.data?.map((r) => (
            <label key={r.code} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.roles.includes(r.code)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r.code] : f.roles.filter((c) => c !== r.code) })} />{r.name}</label>
          ))}</div>
        </fieldset>
        {editing !== 'new' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Account active (unticking signs them out)</label>}
        <ErrorBox error={save.error} />
      </Modal>
    </Card>
  );
}

interface AccessRequest {
  id: number; username: string; reason: string; contactPhone: string | null; note: string | null; status: string;
  createdAt: string; resolvedAt: string | null; resolution: string | null; resolvedBy: string | null;
  account: { id: number; fullName: string; active: boolean; locked: boolean } | null;
}

const REASON_LABEL: Record<string, string> = { LOCKED_OUT: 'Account locked', FORGOT_PASSWORD: 'Forgot password', OTHER: 'Something else' };
const OUTCOME_LABEL: Record<string, string> = { UNLOCKED: 'Unlocked', PASSWORD_RESET: 'Temporary password set', DISMISSED: 'Dismissed' };

/** Requests sent from "Trouble signing in?" on the login page. */
function AccessRequests() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['access-requests'], queryFn: () => api.get<AccessRequest[]>('/users/access-requests') });
  const [acting, setActing] = useState<{ req: AccessRequest; action: 'UNLOCK' | 'RESET' | 'DISMISS' } | null>(null);
  const [note, setNote] = useState('');
  const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
  const resolve = useMutation({
    mutationFn: () => api.post<{ temporaryPassword: string | null }>(`/users/access-requests/${acting!.req.id}/resolve`, { action: acting!.action, note: note || null }),
    onSuccess: (res) => {
      if (res.temporaryPassword) setIssued({ name: acting!.req.account?.fullName ?? acting!.req.username, password: res.temporaryPassword });
      setActing(null);
      void qc.invalidateQueries({ queryKey: ['access-requests'] });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const start = (req: AccessRequest, action: 'UNLOCK' | 'RESET' | 'DISMISS') => { setNote(''); resolve.reset(); setActing({ req, action }); };
  const pending = q.data?.filter((r) => r.status === 'PENDING') ?? [];
  const done = q.data?.filter((r) => r.status !== 'PENDING') ?? [];
  const actionText = { UNLOCK: 'Unlock account', RESET: 'Set temporary password', DISMISS: 'Dismiss request' };
  return (
    <Card padded={false} title={<>Sign-in help requests{pending.length > 0 && <span className="ml-2 rounded-full bg-accent-600 px-2 py-0.5 text-xs font-semibold text-white">{pending.length}</span>}</>}>
      {q.isLoading ? <Loading /> : !q.data?.length ? (
        <p className="px-4 py-3 text-sm text-slate-600">No requests. Staff who cannot sign in can send one from "Trouble signing in?" on the sign-in page.</p>
      ) : (
        <TableWrap><table className="table">
          <thead><tr><th>Sent</th><th>Username</th><th>Account</th><th>Problem</th><th>Contact and note</th><th>Outcome</th><th /></tr></thead>
          <tbody>{[...pending, ...done].map((r) => (
            <tr key={r.id} className={r.status === 'PENDING' ? 'bg-amber-50/60' : undefined}>
              <td className="text-xs">{formatDateTime(r.createdAt)}</td>
              <td className="font-mono text-xs">{r.username}</td>
              <td className="whitespace-normal">{r.account ? <>{r.account.fullName}{r.account.locked && <span className="ml-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Locked</span>}{!r.account.active && <span className="block text-xs text-slate-500">Account inactive</span>}</> : <span className="text-xs text-slate-500">No account with this username</span>}</td>
              <td>{REASON_LABEL[r.reason] ?? r.reason}</td>
              <td className="whitespace-normal text-xs">{r.contactPhone && <span className="block">{r.contactPhone}</span>}{r.note && <span className="block text-slate-600">{r.note}</span>}</td>
              <td className="whitespace-normal text-xs">{r.status === 'PENDING' ? <StatusBadge status="PENDING" label="Waiting" /> : <>{OUTCOME_LABEL[r.status] ?? r.status}{r.resolvedBy && <span className="block text-slate-500">by {r.resolvedBy}, {formatDateTime(r.resolvedAt!)}</span>}{r.resolution && <span className="block text-slate-500">{r.resolution}</span>}</>}</td>
              <td className="whitespace-nowrap">{r.status === 'PENDING' && <>
                {r.account && <Button variant="ghost" onClick={() => start(r, 'UNLOCK')}>Unlock</Button>}
                {r.account && <Button variant="ghost" onClick={() => start(r, 'RESET')}>Reset password</Button>}
                <Button variant="ghost" onClick={() => start(r, 'DISMISS')}>Dismiss</Button>
              </>}</td>
            </tr>
          ))}</tbody>
        </table></TableWrap>
      )}
      <Modal open={!!acting} title={acting ? `${actionText[acting.action]}: ${acting.req.account?.fullName ?? acting.req.username}` : ''} onClose={() => setActing(null)}
        footer={<><Button variant="secondary" onClick={() => setActing(null)}>Cancel</Button><Button busy={resolve.isPending} onClick={() => resolve.mutate()}>{acting ? actionText[acting.action] : ''}</Button></>}>
        {acting?.action === 'UNLOCK' && <p className="text-sm">This clears the lock so they can sign in again with their own password.</p>}
        {acting?.action === 'RESET' && <p className="text-sm">This gives them a new temporary password, signs them out everywhere and asks them to choose their own password when they next sign in. Confirm who you are speaking to before you pass it on.</p>}
        {acting?.action === 'DISMISS' && <p className="text-sm">Close the request without changing the account.</p>}
        <TextInput label="Note for the audit log" value={note} onChange={(e) => setNote(e.target.value)} hint="Optional, for example how you confirmed who they are" />
        <ErrorBox error={resolve.error} />
      </Modal>
      <Modal open={!!issued} title="Temporary password" onClose={() => setIssued(null)} footer={<Button onClick={() => setIssued(null)}>Done</Button>}>
        <p className="text-sm">Give this password to {issued?.name} in person or by phone. It is shown only once and is not kept in the audit log.</p>
        <p className="rounded-md border border-cream-300 bg-cream-50 px-4 py-3 text-center font-mono text-lg tracking-wider" data-testid="temporary-password">{issued?.password}</p>
        <p className="text-sm text-slate-600">They will be asked to choose their own password when they sign in.</p>
      </Modal>
    </Card>
  );
}

function Roles() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/users/roles') });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<Array<{ key: string; label: string }>>('/users/permissions') });
  const [sel, setSel] = useState<number | null>(null);
  const role = roles.data?.find((r) => r.id === sel) ?? roles.data?.[0];
  const [granted, setGranted] = useState<string[]>([]);
  useEffect(() => { if (role) setGranted(role.permissions); }, [role]);
  const save = useMutation({ mutationFn: () => api.put(`/users/roles/${role!.id}`, { name: role!.name, description: role!.description, permissions: granted }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['roles'] }) });
  const dirty = role && (granted.length !== role.permissions.length || granted.some((p) => !role.permissions.includes(p)));
  const groups = new Map<string, Array<{ key: string; label: string }>>();
  for (const p of perms.data ?? []) groups.set(p.key.split('.')[0], [...(groups.get(p.key.split('.')[0]) ?? []), p]);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Roles" padded={false}>
        <ul className="divide-y divide-slate-100">{roles.data?.map((r) => (
          <li key={r.id}><button type="button" onClick={() => setSel(r.id)} className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${r.id === role?.id ? 'bg-brand-50 font-medium text-brand-900' : ''}`}>{r.name}<span className="block text-xs font-normal text-slate-500">{r.userCount} user{r.userCount === 1 ? '' : 's'} · {r.permissions.length} permissions</span></button></li>
        ))}</ul>
      </Card>
      {role && (
        <Card className="lg:col-span-2" title={`Permissions: ${role.name}`} actions={<Button disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()}>Save permissions</Button>}>
          {role.description && <p className="mb-3 text-sm text-slate-600">{role.description}</p>}
          <Notice>Approvals always need a different person from whoever entered the item, whatever the permissions say.</Notice>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[...groups.entries()].map(([g, ps]) => (
              <fieldset key={g} className="rounded border border-slate-200 p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</legend>
                {ps.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" className="mt-1" checked={granted.includes(p.key)} onChange={(e) => setGranted(e.target.checked ? [...granted, p.key] : granted.filter((x) => x !== p.key))} />{p.label}</label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="mt-3"><ErrorBox error={save.error} /></div>
        </Card>
      )}
    </div>
  );
}

interface Audit { id: number; at: string; username: string | null; action: string; entityType: string; entityId: string | null; reason: string | null; before: unknown; after: unknown; ip: string | null }

export function AuditPage() {
  const [filters, setFilters] = useState({ username: '', action: '', entityType: '', entityId: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Audit | null>(null);
  useEffect(() => setPage(1), [filters]);
  const q = useQuery({ queryKey: ['audit', filters, page], queryFn: () => api.get<Paged<Audit>>(`/audit${qs({ ...filters, page })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every change, who made it and when. Entries cannot be edited or deleted." />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-4">
          <TextInput label="Username" value={filters.username} onChange={(e) => setFilters({ ...filters, username: e.target.value })} />
          <TextInput label="Action contains" placeholder="e.g. payment" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} />
          <TextInput label="Record type" placeholder="e.g. Receipt" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })} />
          <TextInput label="Record ID" value={filters.entityId} onChange={(e) => setFilters({ ...filters, entityId: e.target.value })} />
        </div>
        <ErrorBox error={q.error} />
        {q.isLoading ? <Loading /> : (
          <TableWrap><table className="table">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Reason</th><th /></tr></thead>
            <tbody>{q.data?.items.map((a) => (
              <tr key={a.id}><td className="text-xs">{formatDateTime(a.at)}</td><td>{a.username}</td><td className="font-mono text-xs">{a.action}</td><td className="text-xs">{a.entityType} {a.entityId}</td><td className="max-w-xs whitespace-normal text-xs">{a.reason}</td>
                <td>{(a.before || a.after) ? <Button variant="ghost" onClick={() => setOpen(a)}>Details</Button> : null}</td></tr>
            ))}</tbody>
          </table></TableWrap>
        )}
        {q.data && <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />}
      </Card>
      <Modal wide open={!!open} title={open ? `${open.action} · ${open.entityType} ${open.entityId ?? ''}` : ''} onClose={() => setOpen(null)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><p className="label">Before</p><pre className="max-h-96 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(open?.before ?? null, null, 2)}</pre></div>
          <div><p className="label">After</p><pre className="max-h-96 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(open?.after ?? null, null, 2)}</pre></div>
        </div>
      </Modal>
    </div>
  );
}
