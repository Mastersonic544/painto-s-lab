import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { CartProvider, useCart } from '../hooks/useCart';
import Button from '../components/ui/Button';

const navItems = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/intake', label: 'Intake' },
  { to: '/app/hub', label: 'The Hub' },
  { to: '/app/cart', label: 'Lab Cart', showCartCount: true },
  { to: '/app/stock', label: 'Stock' },
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
  const { count } = useCart();
  const operatorName =
    (session?.user?.user_metadata?.display_name as string | undefined) ??
    session?.user?.email ??
    'operator';

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex">
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
        <div className="mt-auto flex flex-col gap-3">
          <div className="pl-label text-text-on-dark-faint">Signed in as</div>
          <div className="text-cream-200 font-body text-sm break-all">{operatorName}</div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 px-6 md:px-10 py-8">
        <Outlet />
      </main>
    </div>
  );
}
