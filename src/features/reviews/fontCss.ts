import onestCyr from '@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2?url';
import onestLat from '@fontsource-variable/onest/files/onest-latin-wght-normal.woff2?url';
import literataCyr from '@fontsource-variable/literata/files/literata-cyrillic-wght-normal.woff2?url';
import literataLat from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import cormorantCyr from '@fontsource-variable/cormorant-garamond/files/cormorant-garamond-cyrillic-wght-italic.woff2?url';
import cormorantLat from '@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-italic.woff2?url';
import cormorantRomanCyr from '@fontsource-variable/cormorant-garamond/files/cormorant-garamond-cyrillic-wght-normal.woff2?url';
import cormorantRomanLat from '@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-normal.woff2?url';
import unboundedCyr from '@fontsource-variable/unbounded/files/unbounded-cyrillic-wght-normal.woff2?url';
import unboundedLat from '@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2?url';
import monoCyr from '@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-500-normal.woff2?url';
import monoLat from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url';

/**
 * Fonts for the exported picture. An SVG drawn as an image cannot load the page's fonts, so the faces the slide uses are
 * embedded as `data:` URLs (docs: `ExportOptions.fontCss`). Only the families found in the slide are fetched, once each.
 */

const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

interface Face {
  family: string;
  style: 'normal' | 'italic';
  weight: string;
  url: string;
  range: string;
  format: string;
  /** Matches the computed `font-family` of an exported element. */
  match: string;
}

const VARIABLE = 'woff2-variations';

const FACES: readonly Face[] = [
  { family: 'Onest Variable', style: 'normal', weight: '100 900', url: onestCyr, range: CYRILLIC, format: VARIABLE, match: 'Onest' },
  { family: 'Onest Variable', style: 'normal', weight: '100 900', url: onestLat, range: LATIN, format: VARIABLE, match: 'Onest' },
  { family: 'Literata Variable', style: 'normal', weight: '200 900', url: literataCyr, range: CYRILLIC, format: VARIABLE, match: 'Literata' },
  { family: 'Literata Variable', style: 'normal', weight: '200 900', url: literataLat, range: LATIN, format: VARIABLE, match: 'Literata' },
  { family: 'Cormorant Garamond Variable', style: 'italic', weight: '300 700', url: cormorantCyr, range: CYRILLIC, format: VARIABLE, match: 'Cormorant' },
  { family: 'Cormorant Garamond Variable', style: 'italic', weight: '300 700', url: cormorantLat, range: LATIN, format: VARIABLE, match: 'Cormorant' },
  { family: 'Cormorant Garamond Variable', style: 'normal', weight: '300 700', url: cormorantRomanCyr, range: CYRILLIC, format: VARIABLE, match: 'Cormorant' },
  { family: 'Cormorant Garamond Variable', style: 'normal', weight: '300 700', url: cormorantRomanLat, range: LATIN, format: VARIABLE, match: 'Cormorant' },
  { family: 'Unbounded Variable', style: 'normal', weight: '200 900', url: unboundedCyr, range: CYRILLIC, format: VARIABLE, match: 'Unbounded' },
  { family: 'Unbounded Variable', style: 'normal', weight: '200 900', url: unboundedLat, range: LATIN, format: VARIABLE, match: 'Unbounded' },
  { family: 'JetBrains Mono', style: 'normal', weight: '500', url: monoCyr, range: CYRILLIC, format: 'woff2', match: 'JetBrains' },
  { family: 'JetBrains Mono', style: 'normal', weight: '500', url: monoLat, range: LATIN, format: 'woff2', match: 'JetBrains' },
];

const cache = new Map<string, Promise<string>>();

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function faceRule(face: Face): Promise<string> {
  let data = cache.get(face.url);
  if (!data) {
    data = fetch(face.url)
      .then((response) => {
        if (!response.ok) throw new Error(`font ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => `data:font/woff2;base64,${toBase64(buffer)}`);
    cache.set(face.url, data);
    // A failed fetch must not stay cached.
    data.catch(() => cache.delete(face.url));
  }
  const url = await data;
  return `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};src:url(${url}) format('${face.format}');unicode-range:${face.range};}`;
}

/** The `font-family` values used by the text of an element. */
export function usedFontFamilies(root: Element): string {
  const families = new Set<string>();
  for (const text of Array.from(root.querySelectorAll('text, tspan'))) {
    families.add(getComputedStyle(text).fontFamily);
  }
  return [...families].join(',');
}

/**
 * `@font-face` CSS for the families the element uses; an empty string when none can be loaded, in which case the
 * picture is exported with system fonts (the layout stays exact).
 */
export async function exportFontCss(root: Element): Promise<string> {
  const used = usedFontFamilies(root);
  const wanted = FACES.filter((face) => used.includes(face.match));
  try {
    return (await Promise.all(wanted.map(faceRule))).join('\n');
  } catch {
    return '';
  }
}
