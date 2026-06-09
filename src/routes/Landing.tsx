import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <section className="max-w-container-lg mx-auto px-6 py-20">
      <div className="grid md:grid-cols-2 gap-12 items-center">
        <div className="flex flex-col gap-6">
          <span className="pl-label text-mustard-soft">A custom paint-by-numbers lab</span>
          <h1 className="font-display font-black text-display-lg leading-none text-cream-50 tracking-display">
            Brew a kit from any photo.
          </h1>
          <p className="text-cream-200 text-lg max-w-md">
            Painto's Lab flattens your image into clean numbered regions, decides the palette, and
            mixes every shade from a tiny shelf of base paints. Tactile. Playful. Honest about the
            messy bits.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/app"
              className="font-display font-bold text-ink-900 bg-mustard border-thick border-ink-900 rounded-pill px-6 py-3 shadow-sticker hover:shadow-sticker-press hover:translate-x-[3px] hover:translate-y-[3px] transition-all duration-fast ease-squish"
            >
              Step into the lab
            </Link>
            <a
              href="#how"
              className="font-display font-bold text-cream-100 border-thick border-cream-200 rounded-pill px-6 py-3 hover:bg-swamp-600 transition-colors duration-fast"
            >
              How it works
            </a>
          </div>
        </div>

        <div className="relative">
          <div className="pl-paper pl-sticker p-8 rotate-[-2deg]">
            <span className="pl-label text-text-on-light-muted">Sample piece</span>
            <h3 className="font-display font-bold text-text-on-light text-h2 mt-2">
              Mossy heron, 16 colors
            </h3>
            <p className="text-text-on-light mt-3">
              A friendly mad painter pre-mixes your palette. Round up, never down. Two coats by
              default. Save the recipe once it looks right.
            </p>
            <div className="mt-5 flex gap-2">
              <span className="h-8 w-8 rounded-full border border-ink-900 bg-olive" />
              <span className="h-8 w-8 rounded-full border border-ink-900 bg-mustard" />
              <span className="h-8 w-8 rounded-full border border-ink-900 bg-terracotta" />
              <span className="h-8 w-8 rounded-full border border-ink-900 bg-teal" />
              <span className="h-8 w-8 rounded-full border border-ink-900 bg-plum" />
              <span className="h-8 w-8 rounded-full border border-ink-900 bg-clay-pink" />
            </div>
          </div>

          <div
            className="absolute -top-6 -right-6 h-24 w-24 bg-terracotta border-thick border-ink-900 grid place-items-center text-ink-900 font-display font-black text-h2 rotate-12"
            style={{ borderRadius: 'var(--blob-2)' }}
          >
            new!
          </div>
        </div>
      </div>
    </section>
  );
}
