import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, exportToBlob, findExportSvg, prepareSvg, saveAsImage, svgDataUrl, svgSize } from './exportImage';

const NS = 'http://www.w3.org/2000/svg';

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 300 400');
  svg.setAttribute('class', 'frame');
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('class', 'card');
  rect.setAttribute('style', 'fill: rgb(255, 0, 0); stroke-width: 2');
  const hidden = document.createElementNS(NS, 'g');
  hidden.setAttribute('style', 'display: none');
  const text = document.createElementNS(NS, 'text');
  text.textContent = 'Привет';
  text.setAttribute('style', 'font-size: 20px; font-weight: 700');
  svg.append(rect, hidden, text);
  document.body.append(svg);
  return svg;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('findExportSvg / svgSize', () => {
  it('finds the svg itself, a marked one, or the first inside', () => {
    const svg = makeSvg();
    expect(findExportSvg(svg)).toBe(svg);
    const wrap = document.createElement('div');
    const first = document.createElementNS(NS, 'svg');
    const marked = document.createElementNS(NS, 'svg');
    marked.setAttribute('data-export-root', '');
    wrap.append(first, marked);
    expect(findExportSvg(wrap)).toBe(marked);
    marked.removeAttribute('data-export-root');
    expect(findExportSvg(wrap)).toBe(first);
    expect(findExportSvg(document.createElement('div'))).toBeNull();
  });

  it('reads the size from the viewBox, then from attributes', () => {
    expect(svgSize(makeSvg())).toEqual({ width: 300, height: 400 });
    const plain = document.createElementNS(NS, 'svg');
    plain.setAttribute('width', '120');
    plain.setAttribute('height', '80');
    expect(svgSize(plain)).toEqual({ width: 120, height: 80 });
  });
});

describe('prepareSvg', () => {
  it('writes computed styles, drops hidden nodes and classes, sets size and namespace', () => {
    const svg = makeSvg();
    const { markup, width, height } = prepareSvg(svg);
    expect(width).toBe(300);
    expect(height).toBe(400);
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('width="300"');
    expect(markup).toContain('rgb(255, 0, 0)');
    expect(markup).toContain('font-size: 20px');
    expect(markup).toContain('Привет');
    expect(markup).not.toContain('display: none');
    expect(markup).not.toContain('class=');
    // the original keeps its classes
    expect(svg.getAttribute('class')).toBe('frame');
    expect(svg.querySelector('g')).not.toBeNull();
  });

  it('embeds font CSS when given', () => {
    const { markup } = prepareSvg(makeSvg(), { fontCss: '@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}' });
    expect(markup).toContain('<style');
    expect(markup).toContain('@font-face');
  });

  it('produces a data URL that survives round trip', () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><text>Привет #1</text></svg>');
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1]!)).toContain('Привет #1');
  });
});

describe('exportToBlob', () => {
  beforeEach(() => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
  });

  it('draws the image scaled and returns the canvas blob', async () => {
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) {
      cb(new Blob([`${this.width}x${this.height}`], { type: 'image/png' }));
    });
    const blob = await exportToBlob(makeSvg(), { scale: 2, background: '#07080F' });
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('600x800');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 600, 800);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
  });

  it('rejects when there is nothing to export or no canvas', async () => {
    await expect(exportToBlob(document.createElement('div'))).rejects.toThrow(/no <svg>/);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(exportToBlob(makeSvg())).rejects.toThrow(/Canvas/);
  });

  it('rejects when the canvas yields no blob', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(exportToBlob(makeSvg())).rejects.toThrow(/image/);
  });

  it('saveAsImage downloads the blob under the given name', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'], { type: 'image/png' })));
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await saveAsImage(makeSvg(), 'zvezda.png');
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('downloadBlob', () => {
  it('uses a temporary link with the file name', () => {
    Object.assign(URL, { createObjectURL: () => 'blob:abc', revokeObjectURL: () => undefined });
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    downloadBlob(new Blob(['x']), 'bilet.png');
    expect(name).toBe('bilet.png');
    expect(document.querySelector('a')).toBeNull();
  });
});
