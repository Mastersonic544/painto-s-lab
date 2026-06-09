import { SVGAttributes } from 'react';

export type SplatColor =
  | 'mustard'
  | 'teal'
  | 'terracotta'
  | 'olive'
  | 'plum'
  | 'clay-pink'
  | 'cream';

const colorVar: Record<SplatColor, string> = {
  mustard: 'var(--mustard)',
  teal: 'var(--teal)',
  terracotta: 'var(--terracotta)',
  olive: 'var(--olive)',
  plum: 'var(--plum)',
  'clay-pink': 'var(--clay-pink)',
  cream: 'var(--cream-200)',
};

export interface SplatProps extends Omit<SVGAttributes<SVGSVGElement>, 'color'> {
  color?: SplatColor;
  size?: number;
  outlined?: boolean;
}

// Decorative paint-splatter SVG. Hand-tuned organic shape with droplets, used
// as a section break or behind a sticker for tactile texture.
export default function Splat({
  color = 'terracotta',
  size = 180,
  outlined = true,
  ...rest
}: SplatProps) {
  const fill = colorVar[color];
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      width={size}
      height={size}
      {...rest}
    >
      <path
        d="M104 18c14 -6 30 4 33 18 4 16 -8 24 -4 38 4 14 22 16 28 30 8 18 -6 38 -22 44 -14 6 -28 -4 -42 -2 -16 2 -26 16 -42 18 -18 2 -34 -12 -38 -28 -4 -16 8 -28 6 -42 -2 -14 -18 -22 -16 -38 2 -16 18 -26 34 -28 16 -2 28 6 40 -2 8 -4 16 -10 23 -8z"
        fill={fill}
        stroke={outlined ? 'var(--ink-900)' : 'none'}
        strokeWidth={outlined ? 3 : 0}
        strokeLinejoin="round"
      />
      {/* Stray drops */}
      <circle cx="172" cy="46" r="8" fill={fill} stroke={outlined ? 'var(--ink-900)' : 'none'} strokeWidth={outlined ? 2 : 0} />
      <circle cx="22" cy="158" r="6" fill={fill} stroke={outlined ? 'var(--ink-900)' : 'none'} strokeWidth={outlined ? 2 : 0} />
      <circle cx="184" cy="172" r="4" fill={fill} stroke={outlined ? 'var(--ink-900)' : 'none'} strokeWidth={outlined ? 2 : 0} />
    </svg>
  );
}
