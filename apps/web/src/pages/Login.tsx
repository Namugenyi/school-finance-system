import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, ErrorBox, Notice, PageHeader, TextInput } from '../components/ui';

export function LoginPage() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { username, password });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <img src="/stja-logo.webp" alt="Supreme Tower Junior School logo" width={160} height={160} className="mx-auto mb-4 h-32 w-32 drop-shadow-lg sm:h-40 sm:w-40" />
          <h1 className="text-xl font-semibold">Supreme Tower Junior Academy</h1>
          <p className="text-sm text-brand-100">Finance &amp; Accounts</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <TextInput label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <ErrorBox error={error} />
          <Button type="submit" className="w-full" busy={busy}>Sign in</Button>
        </form>
        <p className="mt-4 text-center text-xs text-brand-100">Kasangati, Uganda · Authorised staff only</p>
      </div>
    </div>
  );
}

export function AccountPage({ forced }: { forced?: boolean }) {
  const { refresh, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError(new Error('The new passwords do not match'));
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-lg">
      <PageHeader title={forced ? 'Choose a new password' : 'Change password'} subtitle={forced ? 'You need to set your own password before using the system.' : undefined} />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <TextInput label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <TextInput label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required hint="At least 10 characters, with letters and numbers." />
          <TextInput label="Repeat new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <ErrorBox error={error} />
          {done && <Notice tone="success">Password changed. Other devices have been signed out.</Notice>}
          <div className="flex gap-2">
            <Button type="submit" busy={busy}>Change password</Button>
            {forced && <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>}
          </div>
        </form>
      </Card>
    </div>
  );
}
