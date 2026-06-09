import { Link } from 'react-router-dom';

export default function Login() {
  return (
    <section className="max-w-container-sm mx-auto px-6 py-20">
      <div className="pl-paper pl-sticker p-8">
        <span className="pl-label text-text-on-light-muted">Operator login</span>
        <h1 className="font-display font-bold text-h1 text-text-on-light mt-2">
          Back to the greenhouse
        </h1>
        <p className="text-text-on-light mt-3">
          Email + Supabase auth lands with the auth module. This is the placeholder shell.
        </p>
        <Link
          to="/app"
          className="inline-block mt-6 font-display font-bold text-ink-900 bg-mustard border-thick border-ink-900 rounded-pill px-5 py-2 shadow-sticker-sm hover:shadow-sticker-press hover:translate-x-[2px] hover:translate-y-[2px] transition-all duration-fast ease-squish"
        >
          Skip to the lab
        </Link>
      </div>
    </section>
  );
}
