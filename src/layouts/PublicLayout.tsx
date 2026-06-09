import { Link, Outlet } from 'react-router-dom';

export default function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-container-lg mx-auto w-full">
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/assets/logo%20transparent.png"
            alt="Painto's Lab"
            className="h-16 w-auto select-none"
            draggable={false}
          />
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            to="/login"
            className="pl-label text-cream-200 hover:text-mustard-soft transition-colors"
          >
            Operator login
          </Link>
          <Link
            to="/app"
            className="font-display font-bold text-ink-900 bg-mustard border-thick border-ink-900 rounded-pill px-5 py-2 shadow-sticker hover:shadow-sticker-press hover:translate-x-[3px] hover:translate-y-[3px] transition-all duration-fast ease-squish"
          >
            Enter the lab
          </Link>
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="px-6 py-8 text-center pl-label text-text-on-dark-faint">
        Painto's Lab · brewed in the greenhouse
      </footer>
    </div>
  );
}
