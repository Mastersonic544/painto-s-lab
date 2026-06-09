import { useId, useState } from 'react';
import { cn } from '../../lib/cn';
import type { BasePaint, RecipeDisplay, RecipeKind } from '../../lib/recipes';
import type { ColorRecipe } from '../../lib/recipes';

export interface ColorChipProps {
  hex: string;
  /** Optional volume to render in the chip itself ("48ml"). */
  totalMl?: number;
  /** Resolved recipe display, including base paint joins. */
  recipe?: RecipeDisplay | null;
  /** Stored recipe row, used to show verified-ness and notes. */
  recipeRow?: ColorRecipe | null;
  /** Bases for showing the resolved breakdown without a recipe (eg. UI hover). */
  bases?: BasePaint[];
  /** Optional label like the engine's numeric index (eg. "12"). */
  label?: number | string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClick?: () => void;
}

const SIZES = {
  sm: 'h-10 w-10 text-2xs',
  md: 'h-14 w-14 text-sm',
  lg: 'h-20 w-20 text-base',
} as const;

/**
 * A color swatch with hover/tap recipe popover. The popover renders the
 * resolved recipe (base paints + ml) when one is known, or a "no recipe
 * yet" note otherwise — PRD §9.7 "hover or tap any color anywhere shows
 * its recipe formula".
 */
export default function ColorChip({
  hex,
  totalMl,
  recipe,
  recipeRow,
  label,
  size = 'md',
  className,
  onClick,
}: ColorChipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className={cn('relative inline-flex flex-col items-center gap-1', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={id}
        onClick={onClick ?? (() => setOpen((o) => !o))}
        className={cn(
          'rounded-md border-thick border-ink-900 grid place-items-center font-mono font-bold text-ink-900',
          'transition-all duration-fast ease-squish',
          'focus-visible:outline-none focus-visible:shadow-focus',
          'hover:shadow-sticker-press hover:translate-x-[1px] hover:translate-y-[1px]',
          SIZES[size],
        )}
        style={{ background: hex }}
      >
        {label != null ? label : ''}
      </button>
      {typeof totalMl === 'number' && (
        <span className="font-mono text-xs text-cream-200">{formatMl(totalMl)}</span>
      )}
      {open && (
        <RecipePopover
          id={id}
          hex={hex}
          totalMl={totalMl}
          recipe={recipe ?? null}
          recipeRow={recipeRow ?? null}
        />
      )}
    </span>
  );
}

function RecipePopover({
  id,
  hex,
  totalMl,
  recipe,
  recipeRow,
}: {
  id: string;
  hex: string;
  totalMl?: number;
  recipe: RecipeDisplay | null;
  recipeRow: ColorRecipe | null;
}) {
  const kind = recipe?.kind ?? (recipeRow?.is_verified ? 'verified-exact' : 'estimate');
  return (
    <div
      id={id}
      role="tooltip"
      className={cn(
        'absolute left-1/2 -translate-x-1/2 top-[calc(100%+8px)] z-30',
        'min-w-[240px] max-w-[300px]',
        'pl-paper pl-sticker p-3 text-text-on-light text-sm',
        'pl-toast-bloom',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="h-5 w-5 rounded-full border border-ink-900 shrink-0"
          style={{ background: hex }}
        />
        <span className="font-mono font-bold text-xs">{hex.toUpperCase()}</span>
        {typeof totalMl === 'number' && (
          <span className="font-mono text-xs ml-auto">{formatMl(totalMl)}</span>
        )}
        <RecipeKindBadge kind={kind} />
      </div>

      {recipe?.kind === 'verified-near' && recipe.matchedHex && (
        <div className="pl-label text-text-on-light-muted mb-2">
          matched on {recipe.matchedHex.toUpperCase()}
        </div>
      )}

      {recipe && recipe.steps.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {recipe.steps.map((s) => (
            <li key={s.base_paint_id} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full border border-ink-900"
                style={{ background: s.base?.rgb_hex ?? '#888' }}
              />
              <span className="flex-1 truncate">{s.base?.name ?? 'Unknown base'}</span>
              <span className="font-mono text-xs">{formatMl(s.ml)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pl-label text-text-on-light-muted">
          No base paints in stock yet. Add some so we can sketch a starting mix.
        </div>
      )}

      {kind === 'estimate' && (
        <p className="mt-2 text-text-on-light-muted text-xs italic">
          Starting point. Adjust by eye, then save to lock it in.
        </p>
      )}

      {recipeRow?.notes && (
        <div className="mt-2 text-text-on-light-muted text-xs italic">{recipeRow.notes}</div>
      )}
    </div>
  );
}

const KIND_TONE: Record<RecipeKind, string> = {
  'verified-exact': 'bg-teal text-cream-50',
  'verified-near': 'bg-teal-soft text-ink-900',
  'unverified-exact': 'bg-mustard-soft text-ink-900',
  estimate: 'bg-cream-300 text-ink-900',
};
const KIND_LABEL: Record<RecipeKind, string> = {
  'verified-exact': 'verified',
  'verified-near': 'near match',
  'unverified-exact': 'saved',
  estimate: 'estimate',
};

function RecipeKindBadge({ kind }: { kind: RecipeKind }) {
  return (
    <span
      className={cn(
        'pl-label rounded-pill px-2 py-0.5 border-thin border-ink-900 whitespace-nowrap',
        KIND_TONE[kind],
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

function formatMl(ml: number): string {
  if (ml >= 100) return `${Math.round(ml)}ml`;
  if (ml >= 10) return `${ml.toFixed(1)}ml`;
  return `${ml.toFixed(2)}ml`;
}
