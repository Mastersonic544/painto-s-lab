import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';

type Phase = 'idle' | 'sending' | 'sent' | 'error';

interface LocationState {
  from?: { pathname?: string };
}

export default function Login() {
  const { session, loading } = useSession();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from?.pathname ?? '/app';
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (loading) return null;
  if (session) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email) return;
    setPhase('sending');
    setErrorMsg(null);
    const redirectTo = `${window.location.origin}/app`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setPhase('error');
      setErrorMsg(error.message);
      return;
    }
    setPhase('sent');
  }

  return (
    <section className="max-w-container-sm mx-auto px-6 py-20">
      <div className="pl-paper pl-sticker p-8 flex flex-col gap-4">
        <img src="/assets/logo-painto.png" alt="Painto's Lab" className="h-12 w-auto" />
        <span className="pl-label text-text-on-light-muted">Operator login</span>
        <h1 className="font-display font-bold text-h1 text-text-on-light">
          Back to the greenhouse
        </h1>

        {phase === 'sent' ? (
          <div className="flex flex-col gap-2">
            <p className="text-text-on-light">
              Magic link sent. Check <strong className="font-bold">{email}</strong> and click the
              link to step into the lab.
            </p>
            <Button variant="ghost" onClick={() => setPhase('idle')}>
              Use a different email
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <Input
              type="email"
              label="Email"
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              error={phase === 'error' ? (errorMsg ?? 'Could not send link.') : undefined}
            />
            <Button type="submit" loading={phase === 'sending'} disabled={!email}>
              Send magic link
            </Button>
            <p className="pl-label text-text-on-light-muted">
              We email a one-tap link. No password to remember.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
