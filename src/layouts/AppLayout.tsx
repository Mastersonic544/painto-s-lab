import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { CartProvider, useCart } from '../hooks/useCart';
import Button from '../components/ui/Button';

const navItems = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/intake', label: 'Intake' },
  { to: '/app/hub', label: 'The Hub' },
  { to: '/app/cart', label: 'Lab Cart', showCartCount: true },
  { to: '/app/stock', label: 'Stock' },
  { to: '/app/history', label: 'History' },
];

export default function AppLayout() {
  return (
    <CartProvider>
      <Shell />
    </CartProvider>
  );
}

function Shell() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { count } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const operatorName =
    (session?.user?.user_metadata?.display_name as string | undefined) ??
    session?.user?.email ??
    'operator';

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            [
              'font-display font-semibold text-lg px-3 py-2 rounded-md transition-colors duration-fast',
              'flex items-center justify-between gap-2',
              isActive
                ? 'bg-mustard text-ink-900'
                : 'text-cream-200 hover:bg-swamp-600 hover:text-cream-100',
            ].join(' ')
          }
        >
          <span>{item.label}</span>
          {item.showCartCount && count > 0 && (
            <span className="font-mono font-bold text-2xs leading-none px-2 py-1 rounded-pill border-thin border-ink-900 bg-terracotta text-cream-50">
              {count}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto flex flex-col gap-3">
      <div className="pl-label text-text-on-dark-faint">Signed in as</div>
      <div className="text-cream-200 font-body text-sm break-all">{operatorName}</div>
      <Button variant="ghost" size="sm" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Mobile top bar with hamburger */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 border-b border-hair bg-swamp-700">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="/assets/icon-pl.png"
            alt="Painto's Lab"
            className="h-9 w-9 object-contain shrink-0"
          />
          <span className="font-display font-bold text-cream-200 text-lg truncate">
            Painto's Lab
          </span>
        </div>
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="shrink-0 h-11 w-11 grid place-items-center rounded-md border-thick border-cream-200 text-cream-200"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M3 6h18M3 12h18M3 18h18"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-swamp-950/70 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85%] flex flex-col gap-6 px-5 py-6 bg-swamp-700 border-r border-hair overflow-auto pl-dialog-bloom">
            <div className="flex items-center justify-between">
              <span className="pl-label text-text-on-dark-faint">Operator console</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="h-9 w-9 grid place-items-center rounded-md border-thin border-cream-200 text-cream-200 text-xl leading-none"
              >
                ×
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col gap-6 px-5 py-6 border-r border-hair">
        <div className="flex items-center gap-3">
          <img
            src="/assets/icon-pl.png"
            alt="Painto's Lab"
            className="h-16 w-16 object-contain shrink-0"
          />
          <div>
            <div className="font-display font-bold text-cream-200 leading-none text-lg">
              Painto's Lab
            </div>
            <div className="pl-label text-text-on-dark-faint mt-1">Operator console</div>
          </div>
        </div>
        {nav}
        {footer}
      </aside>

      <main className="flex-1 min-w-0 px-4 sm:px-6 md:px-10 py-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
