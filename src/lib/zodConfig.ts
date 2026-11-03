import { z } from 'zod';

/**
 * zod 4 compiles each schema into a function with `new Function` when the browser allows it. The content policy does not
 * (no `unsafe-eval`, and Trusted Types refuse string-to-code), so zod would try, fail and leave a violation report on every
 * start. "jitless" makes it validate without generating code; the difference is not measurable for schemas this small.
 * Every module that makes a schema imports `z` from here rather than from 'zod', so that this runs before any schema is made
 * (the schemas are built when their module loads, which is earlier than the app's entry file runs).
 */
z.config({ jitless: true });

export { z };
export type { ZodType } from 'zod';
