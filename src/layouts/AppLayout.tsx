import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/intake', label: 'Intake' },
  { to: '/app/hub', label: 'The Hub' },
  { to: '/app/cart', label: 'Lab Cart' },
  { to: '/app/stock', label: 'Stock' },
];

export default function AppLayout() {
  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex w-64 shrink-0 flex-col gap-6 px-5 py-6 border-r border-hair">
        <div className="flex items-center gap-3">
          <img src="/assets/icon-pl.png" alt="" className="h-10 w-10 rounded-md" />
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
                  isActive
                    ? 'bg-mustard text-ink-900'
                    : 'text-cream-200 hover:bg-swamp-600 hover:text-cream-100',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-6 md:px-10 py-8">
        <Outlet />
      </main>
    </div>
  );
}
