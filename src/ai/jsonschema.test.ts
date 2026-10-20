import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toModelJsonSchema } from './jsonschema';

describe('toModelJsonSchema', () => {
  const schema = z.object({
    title: z.string().max(60).describe('Short title'),
    score: z.number().min(0).max(1).nullish(),
    default: z.string().catch('x'),
    items: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), text: z.string() }),
        z.object({ kind: z.literal('b'), tags: z.array(z.string()).max(3), level: z.enum(['low', 'high']).nullish() }),
      ]),
    ),
  });
  const json = toModelJsonSchema(schema) as Record<string, any>;

  it('requires every property and closes every object, nullable ones included', () => {
    expect(json.required).toEqual(['title', 'score', 'default', 'items']);
    expect(json.additionalProperties).toBe(false);
    const variantB = json.properties.items.items.anyOf[1];
    expect(variantB.required).toEqual(['kind', 'tags', 'level']);
    expect(variantB.additionalProperties).toBe(false);
  });

  it('turns oneOf into anyOf, which strict providers accept', () => {
    expect(JSON.stringify(json)).not.toContain('oneOf');
    expect(json.properties.items.items.anyOf).toHaveLength(2);
    expect(json.properties.items.items.anyOf[0].properties.kind).toEqual({ type: 'string', const: 'a' });
  });

  it('keeps descriptions and enums but drops validation keywords and $schema', () => {
    expect(json.properties.title).toEqual({ type: 'string', description: 'Short title' });
    expect(JSON.stringify(json)).not.toMatch(/maxLength|maxItems|minimum|maximum|\$schema/);
    expect(JSON.stringify(json.properties.items.items.anyOf[1].properties.level)).toContain('"enum":["low","high"]');
  });

  it('keeps a field that happens to be named like a keyword', () => {
    expect(json.properties.default).toEqual({ type: 'string' });
  });
});
