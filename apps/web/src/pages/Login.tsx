import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card, ErrorBox, Notice, PageHeader, Select, TextArea, TextInput, Narrow } from '../components/ui';

const loginInput =
  'block h-11 w-full rounded-md border border-slate-500 bg-white px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-500 ' +
  'focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700 focus:ring-offset-0 ' +
  'aria-[invalid=true]:border-red-700 aria-[invalid=true]:focus:ring-red-700 sm:text-sm';

/** One labelled sign-in field with an inline message; the message is linked to the input for screen readers. */
function LoginField({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">{label}</label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 flex items-center gap-1.5 text-sm text-red-700">
          <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
          {error}
        </p>
      )}
    </div>
  );
}

export function LoginPage() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = {
      username: username.trim() ? undefined : 'Enter your username',
      password: password ? undefined : 'Enter your password',
    };
    setFieldErrors(missing);
    setError(null);
    if (missing.username) return usernameRef.current?.focus();
    if (missing.password) return passwordRef.current?.focus();
    setBusy(true);
    setShowPassword(false);
    try {
      await api.post('/auth/login', { username, password });
      await refresh();
    } catch (err) {
      // The server sends one message for every failed sign-in, so nothing here reveals whether a username exists.
      setError(err instanceof ApiError ? err.message : 'We could not reach the server. Check your connection and try again.');
      setPassword('');
      setBusy(false);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  };
  const onCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 px-4 py-8 sm:px-8 lg:py-12">
      <div className={`grid w-full max-w-6xl items-center gap-8 md:gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 ${help ? 'lg:items-start' : ''}`}>
        <header className={`text-center text-white lg:text-left ${help ? 'lg:sticky lg:top-12' : ''}`}>
          <img src="/stja-logo.webp" alt="Supreme Tower Junior School logo" width={256} height={256} className="mx-auto mb-5 h-28 w-28 drop-shadow-xl sm:h-40 sm:w-40 lg:mx-0 lg:mb-8 lg:h-60 lg:w-60" />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl lg:leading-tight">Supreme Tower Junior Academy</h1>
          <p className="mt-2 text-base font-medium text-brand-100 sm:text-lg">Finance &amp; Accounts</p>
          <p className="mt-6 hidden text-sm text-brand-200 lg:block">Kasangati, Uganda · Authorised staff only</p>
        </header>
        <div className="mx-auto w-full max-w-lg">
          <form onSubmit={submit} noValidate aria-labelledby="sign-in-heading" className="card space-y-5 border-white/10 p-6 shadow-xl sm:p-10">
            <div>
              <h2 id="sign-in-heading" className="text-2xl font-semibold tracking-tight text-brand-900">Sign in</h2>
              <p className="mt-1.5 text-sm text-slate-600">Use the username and password from the school administrator.</p>
            </div>
            {error && (
              <div ref={errorRef} tabIndex={-1} role="alert" className="flex gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 focus:outline-none">
                <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0 text-red-700"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
                <p>{error}</p>
              </div>
            )}
            <LoginField id="login-username" label="Username" error={fieldErrors.username}>
              <input
                ref={usernameRef} id="login-username" name="username" className={loginInput} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={username} onChange={(e) => { setUsername(e.target.value); setFieldErrors((f) => ({ ...f, username: undefined })); }}
                required aria-required="true" aria-invalid={!!fieldErrors.username} aria-describedby={fieldErrors.username ? 'login-username-error' : undefined} autoFocus
              />
            </LoginField>
            <LoginField id="login-password" label="Password" error={fieldErrors.password}>
              <div className="relative">
                <input
                  ref={passwordRef} id="login-password" name="password" type={showPassword ? 'text' : 'password'} className={`${loginInput} pr-20`} autoComplete="current-password"
                  value={password} onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: undefined })); }}
                  onKeyUp={onCaps} onKeyDown={onCaps} onBlur={() => setCapsLock(false)}
                  required aria-required="true" aria-invalid={!!fieldErrors.password}
                  aria-describedby={[fieldErrors.password && 'login-password-error', capsLock && 'login-caps'].filter(Boolean).join(' ') || undefined}
                />
                <button
                  type="button" onClick={() => setShowPassword((v) => !v)} aria-controls="login-password" aria-pressed={showPassword}
                  className="absolute inset-y-1 right-1 inline-flex min-w-[4.25rem] items-center justify-center gap-1.5 rounded px-2 text-sm font-medium text-brand-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-0"
                >
                  <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    {showPassword
                      ? <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.75-1.75A10 10 0 0019.4 10.6a1.6 1.6 0 000-1.2A10 10 0 008.02 3.9L3.28 2.22zM7.75 6.69l1.2 1.2a2.5 2.5 0 013.16 3.16l1.2 1.2A4 4 0 007.75 6.69zM10.75 15.95A10 10 0 01.6 10.6a1.6 1.6 0 010-1.2 10 10 0 012.6-3.77l2.2 2.2a4 4 0 005.18 5.18l1.6 1.6c-.47.14-.94.25-1.43.34z" />
                      : <><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /><path fillRule="evenodd" d="M.66 10.59a1.65 1.65 0 010-1.19A10 10 0 0110 3a10 10 0 019.34 6.41c.15.38.15.8 0 1.19A10 10 0 0110 17 10 10 0 01.66 10.59zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></>}
                  </svg>
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                  <span className="sr-only"> password</span>
                </button>
              </div>
              {capsLock && <p id="login-caps" className="mt-1.5 text-sm text-amber-800">Caps Lock is on.</p>}
            </LoginField>
            <button
              type="submit" disabled={busy} aria-disabled={busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent-600 px-4 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 active:bg-accent-800 focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-accent-700/80"
            >
              {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none" aria-hidden />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
              <p>Locked out or forgot your password?</p>
              <button
                type="button" aria-expanded={help} aria-controls="sign-in-help" onClick={() => setHelp(!help)}
                className="mt-1 inline-flex min-h-[2rem] items-center rounded px-2 font-semibold text-accent-700 underline underline-offset-4 hover:text-accent-800 focus-visible:ring-2 focus-visible:ring-accent-600"
              >
                {help ? 'Hide sign-in help' : 'Trouble signing in?'}
              </button>
            </div>
          </form>
          {help && <SignInHelp username={username} />}
          <p className="mt-4 text-center text-sm text-brand-100 lg:hidden">Kasangati, Uganda · Authorised staff only</p>
        </div>
      </div>
    </main>
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Move focus to the panel when it opens, so keyboard and screen-reader users land on it.
  useEffect(() => headingRef.current?.focus(), []);
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
    <div id="sign-in-help" className="login-help mt-4 space-y-4">
      <section className="card space-y-4 p-6 sm:p-10" aria-labelledby="unlock-heading">
        <div>
          <h2 id="unlock-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-brand-900 focus:outline-none">Unlock account or reset password</h2>
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
        <h2 id="contact-heading" className="text-lg font-semibold text-brand-900">Contact the administrator</h2>
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
