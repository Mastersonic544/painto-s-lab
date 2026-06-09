// Hand-built demo SVGs for the landing page ComparisonSlider. Stand in for
// real engine output so the marketing page never depends on backend data.
// Each path carries the same data-facetId on both sides so the slider's
// click-delegation behaves like a real piece would.

const W = 800;
const H = 480;

function path(d: string, hex: string, id: number): { filled: string; outline: string } {
  return {
    filled: `<path data-facetId="${id}" d="${d}" style="fill: ${hex}; stroke: ${hex}; stroke-width:1px"/>`,
    outline: `<path data-facetId="${id}" d="${d}" style="fill: none; stroke: #14140F; stroke-width:1px"/>`,
  };
}

function label(id: number, n: number, x: number, y: number, w: number, h: number): string {
  return (
    `<g class="label" data-facetId="${id}" transform="translate(${x},${y})">` +
    `<svg width="${w}" height="${h}" overflow="visible" viewBox="-50 -50 100 100" preserveAspectRatio="xMidYMid meet">` +
    `<text font-family="Tahoma" font-size="50" dominant-baseline="middle" text-anchor="middle" fill="#14140F">${n}</text>` +
    `</svg></g>`
  );
}

// Abstract "swampy heron" — five regions painted with the brand palette.
const facets = [
  // Sky band
  path('M0 0 L800 0 L800 180 Q400 220 0 180 Z', '#EAE6DB', 1),
  // Hills
  path('M0 180 Q120 130 260 170 Q420 215 600 170 Q720 145 800 180 L800 290 L0 290 Z', '#8A9A47', 2),
  // Water
  path('M0 290 L800 290 L800 440 L0 440 Z', '#2FA39B', 3),
  // Heron body
  path('M300 220 Q380 200 420 250 Q460 295 420 340 Q380 360 320 340 Q280 310 300 220 Z', '#0D3D3A', 4),
  // Heron beak / accent
  path('M420 250 L500 240 L420 270 Z', '#E8B23C', 5),
  // Sun / accent dot
  path('M620 80 m -40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0', '#C8593A', 6),
];

const labels = [
  label(1, 1, 380, 80, 80, 60),
  label(2, 2, 380, 230, 80, 60),
  label(3, 3, 380, 360, 80, 60),
  label(4, 4, 360, 280, 70, 50),
  label(5, 5, 450, 250, 50, 40),
  label(6, 6, 600, 80, 60, 50),
];

const filledBody = facets.map((f) => f.filled).join('');
const outlineBody = facets.map((f) => f.outline).join('') + labels.join('');

export const DEMO_FILLED_SVG = `<?xml version="1.0" standalone="no"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${filledBody}</svg>`;

export const DEMO_OUTLINE_SVG = `<?xml version="1.0" standalone="no"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${outlineBody}</svg>`;

export const DEMO_ASPECT = W / H;
