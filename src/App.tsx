import { Navigate, Route, Routes } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout';
import AppLayout from './layouts/AppLayout';
import Landing from './routes/Landing';
import Login from './routes/Login';
import Dashboard from './routes/Dashboard';
import Hub from './routes/Hub';
import Intake from './routes/Intake';
import Lab from './routes/Lab';
import LabCart from './routes/LabCart';
import PieceJob from './routes/PieceJob';
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
        <Route path="intake" element={<Intake />} />
        <Route path="hub" element={<Hub />} />
        <Route path="cart" element={<LabCart />} />
        <Route path="lab/:cartId" element={<Lab />} />
        <Route path="piece/:id" element={<PieceJob />} />
      </Route>

      {/* Dev-only — Vite tree-shakes this in production builds. */}
      {import.meta.env.DEV && <Route path="/styleguide" element={<Styleguide />} />}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
