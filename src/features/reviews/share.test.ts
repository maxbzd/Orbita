import { describe, expect, it } from 'vitest';
import { SHARE_LIMITS, parseShare, safeHttpUrl, shareToCapture } from './share';

describe('parseShare', () => {
  it('reads title, text and url from the query', () => {
    const shared = parseShare('?title=Идея&text=Сделать%20курс&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1');
    expect(shared).toEqual({ title: 'Идея', text: 'Идея\n\nСделать курс\n\nhttps://example.com/a?b=1', url: 'https://example.com/a?b=1' });
  });

  it('finds the link inside the text when Android sends it there, and does not repeat it', () => {
    const shared = parseShare('?text=' + encodeURIComponent('Смотри https://example.com/post.'));
    expect(shared?.url).toBe('https://example.com/post');
    expect(shared?.text).toBe('Смотри https://example.com/post.');
  });

  it('keeps markup as plain text and never treats a script link as a link', () => {
    const shared = parseShare(new URLSearchParams({ text: '<img src=x onerror=alert(1)> привет', url: 'javascript:alert(1)' }));
    expect(shared?.url).toBeUndefined();
    expect(shared?.text).toContain('<img src=x onerror=alert(1)> привет');
    expect(shared?.text).toContain('javascript:alert(1)');
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeHttpUrl('data:text/html,hi')).toBeUndefined();
    expect(safeHttpUrl('not a url')).toBeUndefined();
  });

  it('strips control and direction characters and caps the length', () => {
    const shared = parseShare(new URLSearchParams({ title: 'a\u0000b‮c', text: 'x'.repeat(SHARE_LIMITS.text + 500) }));
    expect(shared?.title).toBe('abc');
    expect(Array.from(shared?.text ?? '').length).toBeLessThanOrEqual(SHARE_LIMITS.text);
  });

  it('returns null when nothing usable arrived, and reads the first query that has a value', () => {
    expect(parseShare('', undefined)).toBeNull();
    expect(parseShare('?text=%20%20&title=')).toBeNull();
    expect(parseShare('?text=из%20адреса', new URLSearchParams({ text: 'из хеша' }))?.text).toBe('из адреса');
    expect(parseShare('', new URLSearchParams({ text: 'из хеша' }))?.text).toBe('из хеша');
  });
});

describe('shareToCapture', () => {
  it('makes a text capture marked as imported by sharing', () => {
    expect(shareToCapture({ title: 'Идея', url: 'https://example.com/' }, '  Текст  ')).toMatchObject({
      kind: 'text',
      text: 'Текст',
      title: 'Идея',
      status: 'transcribed',
      source: { importedFrom: 'share', url: 'https://example.com/' },
    });
    expect(shareToCapture({ title: '' }, 'a').source).toEqual({ importedFrom: 'share' });
  });
});
