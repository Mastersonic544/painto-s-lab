import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';

type Phase = 'idle' | 'submitting' | 'error';

interface LocationState {
  from?: { pathname?: string };
}

export default function Login() {
  const { session, loading } = useSession();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from?.pathname ?? '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (loading) return null;
  if (session) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setPhase('submitting');
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setPhase('error');
      setErrorMsg(error.message);
      return;
    }
    // On success the session listener redirects via the <Navigate> above.
  }

  return (
    <section className="max-w-container-sm mx-auto px-6 py-20">
      <div className="pl-paper pl-sticker p-8 flex flex-col gap-4">
        {/* self-start + fixed square: the parent is a flex column, whose
            default align-items:stretch would otherwise stretch an auto-width
            image across the full card. */}
        <img
          src="/assets/logo-painto.png"
          alt="Painto's Lab"
          className="h-20 w-20 object-contain self-start"
        />
        <span className="pl-label text-text-on-light-muted">Operator login</span>
        <h1 className="font-display font-bold text-h1 text-text-on-light">
          Back to the greenhouse
        </h1>

        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Input
            type="email"
            label="Email"
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            type="password"
            label="Password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            error={phase === 'error' ? (errorMsg ?? 'Could not sign in.') : undefined}
          />
          <Button
            type="submit"
            loading={phase === 'submitting'}
            disabled={!email || !password}
          >
            Sign in
          </Button>
        </form>
      </div>
    </section>
  );
}
