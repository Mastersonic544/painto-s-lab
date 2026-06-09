import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import Spinner from './ui/Spinner';

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
