/**
 * Export of a shareable object to a PNG, without libraries: the object is an SVG, so we serialise it (with the computed
 * styles written into the elements, because a standalone SVG image cannot see the page's CSS or `var()` tokens), draw it
 * as an image on a canvas and ask the canvas for a PNG.
 *
 * Limits: an SVG used as an image cannot load fonts from the page, so unless the caller passes `fontCss` (an
 * `@font-face` block with `data:` URLs) the text falls back to the system serif/sans. The shapes, colours and layout
 * are exact either way. Objects must be pure SVG (no `<foreignObject>`, no external `href`).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Presentation properties copied from the computed style onto each element. */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'stop-color',
  'stop-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variation-settings',
  'letter-spacing',
  'text-anchor',
  'text-transform',
  'dominant-baseline',
  'paint-order',
  'mix-blend-mode',
  'visibility',
] as const;

export interface ExportOptions {
  /** Pixels per SVG unit. Default 3 (a 300-wide object becomes 900 px). */
  scale?: number;
  /** Fill behind the object. Default none (transparent corners). */
  background?: string | null;
  /** `@font-face` CSS to embed (with `data:` URLs); see the limits above. */
  fontCss?: string;
  /** MIME type of the result. Default `image/png`. */
  type?: string;
  quality?: number;
}

export interface PreparedSvg {
  markup: string;
  width: number;
  height: number;
}

/** The exportable SVG inside a node: the node itself, or its `svg[data-export-root]`, or its first svg. */
export function findExportSvg(target: Element): SVGSVGElement | null {
  if (target.localName === 'svg') return target as SVGSVGElement;
  return target.querySelector<SVGSVGElement>('svg[data-export-root]') ?? target.querySelector<SVGSVGElement>('svg');
}

/** Width and height of the drawing in SVG units: from the viewBox, else the attributes, else the rendered size. */
export function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box && box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) return { width: box[2]!, height: box[3]! };
  const width = parseFloat(svg.getAttribute('width') ?? '');
  const height = parseFloat(svg.getAttribute('height') ?? '');
  if (width > 0 && height > 0) return { width, height };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 300, height: rect.height || 300 };
}

/**
 * Clones the SVG for export: computed presentation properties are written onto every element, hidden elements are
 * removed, the root gets explicit size and namespace. The original is untouched.
 */
export function prepareSvg(svg: SVGSVGElement, { fontCss }: Pick<ExportOptions, 'fontCss'> = {}): PreparedSvg {
  const { width, height } = svgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const view = svg.ownerDocument.defaultView;
  const sources = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];

  if (view) {
    const hidden: Element[] = [];
    sources.forEach((source, i) => {
      const copy = copies[i] as SVGElement | undefined;
      if (!copy || copy.localName === 'style' || copy.localName === 'script') return;
      const computed = view.getComputedStyle(source);
      if (computed.getPropertyValue('display') === 'none') {
        if (i > 0) hidden.push(copy);
        return;
      }
      for (const prop of STYLE_PROPS) {
        const value = computed.getPropertyValue(prop);
        if (value) copy.style.setProperty(prop, value);
      }
    });
    for (const el of hidden) el.remove();
  }
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    el.removeAttribute('class');
    el.removeAttribute('tabindex');
    el.removeAttribute('data-export-root');
  }
  clone.removeAttribute('style');
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (fontCss) {
    const style = svg.ownerDocument.createElementNS(SVG_NS, 'style');
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }
  const markup = new (view?.XMLSerializer ?? XMLSerializer)().serializeToString(clone);
  return { markup, width, height };
}

export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The SVG could not be rendered as an image'));
    image.src = url;
  });
}

/** Draws the SVG on a canvas. Throws when there is no 2D canvas (very old or locked-down browsers). */
export async function renderSvgToCanvas(target: Element, options: ExportOptions = {}): Promise<HTMLCanvasElement> {
  const svg = findExportSvg(target);
  if (!svg) throw new Error('Nothing to export: no <svg> found');
  const { markup, width, height } = prepareSvg(svg, options);
  const scale = options.scale ?? 3;
  const image = await loadImage(svgDataUrl(markup));
  const canvas = svg.ownerDocument.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** SVG → PNG blob. */
export async function exportToBlob(target: Element, options: ExportOptions = {}): Promise<Blob> {
  const canvas = await renderSvgToCanvas(target, options);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The canvas could not produce an image'))),
      options.type ?? 'image/png',
      options.quality,
    );
  });
}

/** Offers a blob as a file download (a temporary link). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One call for the "Сохранить картинку" button: export the object and download it. */
export async function saveAsImage(target: Element, filename: string, options: ExportOptions = {}): Promise<Blob> {
  const blob = await exportToBlob(target, options);
  downloadBlob(blob, filename);
  return blob;
}
