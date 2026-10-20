import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BadResponseError } from './errors';
import {
  LIMITS,
  buildRepairUser,
  closeTruncatedJson,
  jsonCandidates,
  parseJsonLoose,
  parseModelText,
  repairJsonText,
  runStructured,
  sanitizeValue,
  validateValue,
} from './json';
import type { RawReply, RepairContext } from './json';

const Schema = z.object({
  title: z.string(),
  count: z.number(),
  items: z.array(z.object({ kind: z.string(), text: z.string() })),
});
const valid = { title: 'Итог', count: 2, items: [{ kind: 'task', text: 'позвонить' }] };

describe('parseJsonLoose', () => {
  it('parses clean JSON without any fixes', () => {
    expect(parseJsonLoose(JSON.stringify(valid))).toEqual({ value: valid, fixes: [] });
  });

  it('cuts ```json fences and surrounding chatter', () => {
    const answer = `Конечно! Вот результат:\n\`\`\`json\n${JSON.stringify(valid, null, 2)}\n\`\`\`\nЕсли нужно что-то поправить — скажите.`;
    expect(parseJsonLoose(answer)?.value).toEqual(valid);
  });

  it('reads a fenced block whose closing fence is missing', () => {
    expect(parseJsonLoose(`\`\`\`json\n${JSON.stringify(valid)}`)?.value).toEqual(valid);
  });

  it('finds the first balanced JSON in text without fences, braces in strings included', () => {
    const answer = `Ответ: ${JSON.stringify({ title: 'Скобки } и { внутри', count: 1, items: [] })} Готово.`;
    expect(parseJsonLoose(answer)?.value).toMatchObject({ title: 'Скобки } и { внутри' });
  });

  it('skips a stray brace in the prose before the real JSON', () => {
    const answer = `Вот {пример ответа: ${JSON.stringify(valid)}`;
    expect(parseJsonLoose(answer)?.value).toEqual(valid);
  });

  it('drops <think> blocks printed by reasoning models', () => {
    const answer = `<think>Сначала {неправильный} вариант</think>${JSON.stringify(valid)}`;
    expect(parseJsonLoose(answer)?.value).toEqual(valid);
  });

  it('returns nothing for an empty, blank or JSON-free answer', () => {
    expect(parseJsonLoose('')).toBeUndefined();
    expect(parseJsonLoose('   \n  ')).toBeUndefined();
    expect(parseJsonLoose('Извините, я не могу это сделать.')).toBeUndefined();
    expect(parseJsonLoose('{{{{')).toBeUndefined();
  });

  it('ignores answers that are absurdly long', () => {
    expect(jsonCandidates('x'.repeat(LIMITS.maxInput + 1))).toEqual([]);
  });

  it('stays fast on pathological input made of opening brackets', () => {
    const started = Date.now();
    expect(jsonCandidates('{'.repeat(200_000))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe('soft repair', () => {
  it('removes trailing commas', () => {
    const result = parseJsonLoose('{"title":"a","count":1,"items":[{"kind":"x","text":"y",},],}');
    expect(result?.value).toEqual({ title: 'a', count: 1, items: [{ kind: 'x', text: 'y' }] });
    expect(result?.fixes).toContain('removed trailing commas');
  });

  it('inserts commas the model forgot between values and properties', () => {
    const result = parseJsonLoose('{"title":"a"\n"count":1\n"items":[{"kind":"x","text":"y"}{"kind":"z","text":"w"}]}');
    expect(result?.value).toEqual({
      title: 'a',
      count: 1,
      items: [
        { kind: 'x', text: 'y' },
        { kind: 'z', text: 'w' },
      ],
    });
    expect(result?.fixes).toContain('inserted missing commas');
  });

  it('escapes raw line breaks inside strings', () => {
    const result = parseJsonLoose('{"title":"строка 1\nстрока 2","count":1,"items":[]}');
    expect(result?.value).toMatchObject({ title: 'строка 1\nстрока 2' });
  });

  it('replaces Python-style literals', () => {
    expect(parseJsonLoose('{"a": None, "b": True, "c": False}')?.value).toEqual({ a: null, b: true, c: false });
  });

  it('never touches the inside of strings', () => {
    const text = '{"a":"x, } ] y,  \\"z\\" None True"}';
    expect(repairJsonText(text).text).toBe(text);
    expect(repairJsonText(text).fixes).toEqual([]);
  });
});

describe('truncated answers', () => {
  it('closes the document at the last complete array element', () => {
    const cut = '{"title":"Итог","count":2,"items":[{"kind":"task","text":"полный"},{"kind":"task","text":"обрезан на полусл';
    const result = parseJsonLoose(cut);
    expect(result?.value).toEqual({ title: 'Итог', count: 2, items: [{ kind: 'task', text: 'полный' }] });
    expect(result?.fixes).toContain('closed a truncated answer');
  });

  it('keeps an empty array when the very first element is incomplete', () => {
    expect(closeTruncatedJson('{"items":[{"kind":"ta')).toBe('{"items":[]}');
  });

  it('drops the property that was being written in a plain object', () => {
    expect(JSON.parse(closeTruncatedJson('{"title":"ok","mood":{"valence":0.2,"energy":0.') ?? '')).toEqual({
      title: 'ok',
      mood: { valence: 0.2 },
    });
  });

  it('is not fooled by complete inner blocks of a truncated outer object', () => {
    const cut = '{"title":"t","items":[{"kind":"a","text":"1"},{"kind":"b","text":"2"},{"kind":"c"';
    const value = parseJsonLoose(cut)?.value as { title?: string; items: unknown[] };
    expect(value.title).toBe('t');
    expect(value.items).toHaveLength(2);
  });

  it('does not touch complete JSON and rejects mismatched brackets', () => {
    expect(closeTruncatedJson('{"a":1}')).toBeNull();
    expect(closeTruncatedJson('{"a":[1}')).toBeNull();
  });

  it('reports the output limit in the problem when the cut-off answer is unusable', async () => {
    const reply: RawReply = { text: '{"title":"x","count"', inputTokens: 1, outputTokens: 1, truncated: true };
    const calls: (RepairContext | undefined)[] = [];
    await expect(
      runStructured(Schema, async (repair) => {
        calls.push(repair);
        return reply;
      }),
    ).rejects.toBeInstanceOf(BadResponseError);
    expect(calls[1]?.problem).toContain('output token limit');
  });
});

describe('validation with zod', () => {
  it('accepts a valid answer and returns typed data', () => {
    const outcome = parseModelText(JSON.stringify(valid), Schema);
    expect(outcome).toEqual({ ok: true, data: valid, fixes: [] });
  });

  it('names the offending path when types are wrong', () => {
    const outcome = parseModelText(JSON.stringify({ title: 5, count: 'два', items: [{ kind: 'a' }] }), Schema);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.problem).toContain('title');
      expect(outcome.problem).toContain('count');
      expect(outcome.problem).toContain('items.0.text');
    }
  });

  it('prefers the first block that satisfies the schema over earlier decoys', () => {
    const answer = `Пример формата: {"title": "…"}\nИтог: ${JSON.stringify(valid)}`;
    const outcome = parseModelText(answer, Schema);
    expect(outcome.ok && outcome.data).toEqual(valid);
  });

  it('fails clearly on empty and JSON-free answers', () => {
    expect(parseModelText('', Schema)).toEqual({ ok: false, problem: 'The answer is empty' });
    expect(parseModelText('просто текст', Schema)).toEqual({ ok: false, problem: 'The answer contains no JSON object' });
  });

  it('validates already-structured values (tool input) and rejects non-objects', () => {
    expect(validateValue(valid, Schema).ok).toBe(true);
    expect(validateValue('строка', Schema).ok).toBe(false);
    expect(validateValue(null, Schema).ok).toBe(false);
  });
});

describe('untrusted content stays inert', () => {
  it('keeps HTML and scripts inside strings as plain text', () => {
    const title = '<script>globalThis.__pwned = 1</script><img src=x onerror="globalThis.__pwned = 2"> javascript:alert(1)';
    const outcome = parseModelText(JSON.stringify({ title, count: 1, items: [] }), Schema);
    expect(outcome.ok && outcome.data.title).toBe(title);
    expect((globalThis as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('drops keys that could poison prototypes', () => {
    const outcome = parseModelText('{"title":"t","count":1,"items":[],"__proto__":{"polluted":true},"constructor":{"x":1}}', z.looseObject({}));
    expect(outcome.ok).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (outcome.ok) expect(Object.keys(outcome.data)).toEqual(['title', 'count', 'items']);
  });

  it('strips control characters but keeps line breaks and tabs', () => {
    expect(sanitizeValue('a\u0000b\u0007c\nd\te')).toBe('abc\nd\te');
  });

  it('cuts very long strings with an ellipsis and caps arrays and depth', () => {
    const long = 'я'.repeat(50_000);
    const cut = sanitizeValue(long) as string;
    expect(Array.from(cut)).toHaveLength(LIMITS.maxString);
    expect(cut.endsWith('…')).toBe(true);

    const tooMany = sanitizeValue(Array.from({ length: 1_000 }, (_, index) => index)) as number[];
    expect(tooMany).toHaveLength(LIMITS.maxArray);

    let nested: unknown = 'deep';
    for (let level = 0; level < 30; level++) nested = { next: nested };
    let cursor = sanitizeValue(nested) as { next: unknown } | null;
    let depth = 0;
    while (cursor !== null && typeof cursor === 'object') {
      cursor = cursor.next as { next: unknown } | null;
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(LIMITS.maxDepth);
  });

  it('turns non-finite numbers into null', () => {
    expect(sanitizeValue(JSON.parse('{"x":1e999}'))).toEqual({ x: null });
  });
});

describe('runStructured: exactly one automatic repair', () => {
  const ok = (extra: Partial<RawReply> = {}): RawReply => ({ text: JSON.stringify(valid), inputTokens: 10, outputTokens: 5, ...extra });
  const garbage = (): RawReply => ({ text: 'Не могу.', inputTokens: 10, outputTokens: 3 });

  it('does not repair a good first answer', async () => {
    let calls = 0;
    const run = await runStructured(Schema, async () => {
      calls++;
      return ok();
    });
    expect(calls).toBe(1);
    expect(run).toMatchObject({ data: valid, repaired: false, inputTokens: 10, outputTokens: 5 });
  });

  it('repairs once, passes the problem on and sums the usage of both calls', async () => {
    const contexts: (RepairContext | undefined)[] = [];
    const run = await runStructured(Schema, async (repair) => {
      contexts.push(repair);
      return repair ? ok() : garbage();
    });
    expect(run).toMatchObject({ data: valid, repaired: true, inputTokens: 20, outputTokens: 8 });
    expect(contexts[0]).toBeUndefined();
    expect(contexts[1]).toEqual({ previous: 'Не могу.', problem: 'The answer contains no JSON object' });
  });

  it('gives up after the single repair with a BadResponseError', async () => {
    let calls = 0;
    const attempt = runStructured(Schema, async () => {
      calls++;
      return garbage();
    });
    await expect(attempt).rejects.toBeInstanceOf(BadResponseError);
    expect(calls).toBe(2);
  });

  it('validates tool-call values directly and quotes them in the repair context', async () => {
    const contexts: (RepairContext | undefined)[] = [];
    const run = await runStructured(Schema, async (repair) => {
      contexts.push(repair);
      return repair ? { value: valid, inputTokens: 1, outputTokens: 1 } : { value: { title: 1 }, inputTokens: 1, outputTokens: 1 };
    });
    expect(run.data).toEqual(valid);
    expect(contexts[1]?.previous).toBe('{"title":1}');
  });

  it('does not swallow transport errors from the repair call', async () => {
    const boom = new Error('network');
    await expect(
      runStructured(Schema, async (repair) => {
        if (repair) throw boom;
        return garbage();
      }),
    ).rejects.toBe(boom);
  });
});

describe('buildRepairUser', () => {
  it('keeps the original task, names the problem and shortens a huge previous answer', () => {
    const text = buildRepairUser('ЗАДАЧА', { previous: 'x'.repeat(20_000), problem: 'items.0.text: Required' });
    expect(text.startsWith('ЗАДАЧА')).toBe(true);
    expect(text).toContain('items.0.text: Required');
    expect(text.length).toBeLessThan(7_000);
  });
});
