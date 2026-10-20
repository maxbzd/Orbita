import { z } from 'zod';
import type { ZodType } from 'zod';

/**
 * JSON Schema as the model should see it. `z.toJSONSchema` is the source; the result is then reshaped
 * so one schema works for every provider (Anthropic tools, OpenAI `json_schema` strict mode, a prompt
 * pasted into a chat): `oneOf` becomes `anyOf`, every property is required (absent values are `null`,
 * schemas use `.nullish()`), objects are closed, and validation keywords are dropped — zod validates
 * the answer anyway, and strict modes reject many of those keywords.
 */

/** Keywords that only constrain values; descriptions and structure stay. */
const VALIDATION_KEYWORDS = new Set([
  '$schema',
  'default',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
]);

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function reshape(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(reshape);
  if (!isRecord(node)) return node;

  const result: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (VALIDATION_KEYWORDS.has(key)) continue;
    if (key === 'properties' && isRecord(value)) {
      // Keys here are field names (a field may be called "default"), only the values are schemas.
      result.properties = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, reshape(schema)]));
    } else if (key === 'oneOf') {
      result.anyOf = reshape(value);
    } else {
      result[key] = reshape(value);
    }
  }
  if (isRecord(result.properties)) {
    result.required = Object.keys(result.properties);
    result.additionalProperties = false;
  }
  return result;
}

export function toModelJsonSchema(schema: ZodType): object {
  return reshape(z.toJSONSchema(schema, { io: 'output' })) as object;
}
