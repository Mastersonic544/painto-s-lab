import { Navigate, Route, Routes } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout';
import AppLayout from './layouts/AppLayout';
import Landing from './routes/Landing';
import Login from './routes/Login';
import Dashboard from './routes/Dashboard';
import Styleguide from './routes/Styleguide';
import RequireAuth from './components/RequireAuth';

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
      </Route>

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
      </Route>

      {/* Dev-only — Vite tree-shakes this in production builds. */}
      {import.meta.env.DEV && <Route path="/styleguide" element={<Styleguide />} />}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
