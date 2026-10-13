import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, ErrorBox, Notice, PageHeader, Select, TextArea, TextInput, Narrow } from '../components/ui';

export function LoginPage() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 px-4 py-8 sm:px-6 lg:py-12">
      <div className="grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
        <div className="text-center text-white lg:text-left">
          <img src="/stja-logo.webp" alt="Supreme Tower Junior School logo" width={256} height={256} className="mx-auto mb-5 h-32 w-32 drop-shadow-xl sm:h-44 sm:w-44 lg:mx-0 lg:mb-8 lg:h-64 lg:w-64" />
          <h1 className="text-2xl font-semibold sm:text-3xl lg:text-4xl">Supreme Tower Junior Academy</h1>
          <p className="mt-1 text-base text-brand-100 sm:text-lg">Finance &amp; Accounts</p>
          <p className="mt-6 hidden max-w-md text-sm leading-relaxed text-brand-100 lg:block">Fees, payments, receipts, expenses, payroll and term reports for the school, in one place.</p>
          <p className="mt-2 hidden text-xs text-brand-200 lg:block">Kasangati, Uganda · Authorised staff only</p>
        </div>
        <div className="mx-auto w-full max-w-xl">
          <form onSubmit={submit} className="card space-y-5 p-6 sm:p-10">
            <div>
              <h2 className="text-xl font-semibold text-brand-900">Sign in</h2>
              <p className="mt-1 text-sm text-slate-600">Use the username and password the school administrator gave you.</p>
            </div>
            <TextInput label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            <TextInput label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <ErrorBox error={error} />
            <Button type="submit" className="w-full py-2.5 text-base" busy={busy}>Sign in</Button>
            <div className="text-center">
              <button type="button" className="text-sm font-medium text-accent-700 underline-offset-2 hover:underline" aria-expanded={help} aria-controls="sign-in-help" onClick={() => setHelp(!help)}>
                {help ? 'Hide sign-in help' : 'Trouble signing in?'}
              </button>
            </div>
          </form>
          {help && <SignInHelp username={username} />}
          <p className="mt-4 text-center text-xs text-brand-100 lg:hidden">Kasangati, Uganda · Authorised staff only</p>
        </div>
      </div>
    </div>
  );
}

interface HelpContact { schoolName: string | null; contactName: string | null; phone: string | null; email: string | null }

const REASONS = [
  { value: 'LOCKED_OUT', label: 'My account is locked' },
  { value: 'FORGOT_PASSWORD', label: 'I forgot my password' },
  { value: 'OTHER', label: 'Something else' },
];

/** For staff who cannot get in: ask the administrator to unlock the account, or contact them directly. */
function SignInHelp({ username: typed }: { username: string }) {
  const [contact, setContact] = useState<HelpContact | null>(null);
  const [username, setUsername] = useState(typed);
  const [reason, setReason] = useState('LOCKED_OUT');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<HelpContact>('/auth/help').then(setContact).catch(() => setContact(null));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/access-requests', { username, reason, contactPhone: phone || null, note: note || null });
      setSent(res.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const hasContact = contact && (contact.phone || contact.email);
  return (
    <div id="sign-in-help" className="mt-4 space-y-4">
      <section className="card space-y-4 p-6 sm:p-10" aria-labelledby="unlock-heading">
        <div>
          <h2 id="unlock-heading" className="text-base font-semibold text-brand-900">Unlock account or reset password</h2>
          <p className="mt-1 text-sm text-slate-600">Send a request to the school administrator. They can unlock your account or give you a temporary password to change when you sign in.</p>
        </div>
        {sent ? (
          <Notice tone="success" title="Request sent">{sent}</Notice>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <TextInput label="Your username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <Select label="What is the problem?" options={REASONS} value={reason} onChange={(e) => setReason(e.target.value)} required />
            <TextInput label="Phone number to reach you" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} hint="Optional" />
            <TextArea label="Anything else the administrator should know" value={note} onChange={setNote} rows={2} hint="Optional. Never write your password here." />
            <ErrorBox error={error} />
            <Button type="submit" variant="secondary" className="w-full" busy={busy}>Send request to administrator</Button>
          </form>
        )}
      </section>
      <section className="card space-y-2 p-6 sm:px-10" aria-labelledby="contact-heading">
        <h2 id="contact-heading" className="text-base font-semibold text-brand-900">Contact the administrator</h2>
        {hasContact ? (
          <dl className="space-y-1 text-sm">
            {contact.contactName && <div><dt className="sr-only">Name</dt><dd className="font-medium">{contact.contactName}</dd></div>}
            {contact.phone && <div className="flex gap-2"><dt className="text-slate-500">Phone</dt><dd><a className="font-medium text-accent-700 hover:underline" href={`tel:${contact.phone.replace(/\s+/g, '')}`}>{contact.phone}</a></dd></div>}
            {contact.email && <div className="flex gap-2"><dt className="text-slate-500">Email</dt><dd><a className="font-medium text-accent-700 hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a></dd></div>}
          </dl>
        ) : (
          <p className="text-sm text-slate-600">Speak to the school administrator or the bursar's office in person.</p>
        )}
      </section>
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
    <Narrow width="lg">
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
    </Narrow>
  );
}
