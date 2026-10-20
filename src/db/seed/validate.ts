import { captureSpecs } from './captures';
import { captureCheckIns } from './content/checkins';
import { LINKS } from './content/links';
import { patternSpecs } from './content/patterns';
import { reviewContent } from './content/reviews';
import { DemoContentError } from './errors';
import { itemSpecs } from './items';

function duplicates(keys: readonly string[]): string[] {
  return keys.filter((key, index) => keys.indexOf(key) !== index);
}

/**
 * Checks the authored content for dangling keys, independent of the window: a reference to a capture
 * or item that does not exist is a bug in the content, not something a short window may excuse.
 */
export function validateContent(): void {
  const problems: string[] = [];
  const captures = captureSpecs();
  const items = itemSpecs();
  const captureKeys = new Set(captures.map((spec) => spec.key));
  const itemKeys = new Set(items.map((spec) => spec.key));

  for (const key of duplicates(captures.map((spec) => spec.key))) problems.push(`Capture ${key} is defined twice`);
  for (const key of duplicates(items.map((spec) => spec.key))) problems.push(`Item ${key} is defined twice`);

  const needCapture = (owner: string, key: string | undefined): void => {
    if (key !== undefined && !captureKeys.has(key)) problems.push(`${owner}: no capture ${key}`);
  };
  const needItem = (owner: string, key: string | undefined): void => {
    if (key !== undefined && !itemKeys.has(key)) problems.push(`${owner}: no item ${key}`);
  };

  for (const spec of items) {
    needCapture(spec.key, spec.cap);
    needItem(spec.key, spec.duplicateOf);
    if (spec.kind === 'idea') for (const key of spec.related ?? []) needItem(spec.key, key);
    if (spec.kind === 'fact') needItem(spec.key, spec.supersededBy);
  }
  for (const spec of patternSpecs()) for (const evidence of spec.evidence) needCapture(spec.key, evidence.cap);
  for (const spec of captureCheckIns()) needCapture(`check-in ${spec.cap}`, spec.cap);
  for (const link of LINKS) {
    needItem(`link ${link.from}`, link.from);
    needItem(`link ${link.from}`, link.to);
  }
  for (const content of reviewContent()) {
    needCapture(`review of week ${content.weeksBack}`, content.anchorCap);
    for (const answer of content.answers) {
      if (answer.question >= content.questions.length) problems.push(`review of week ${content.weeksBack}: no question ${answer.question}`);
    }
  }

  if (problems.length > 0) throw new DemoContentError(problems);
}
