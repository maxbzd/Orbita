/** The authored demo content is inconsistent (a quote that is not in its capture, a dangling key, …). */
export class DemoContentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The demo content is inconsistent:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
    this.name = 'DemoContentError';
  }
}
