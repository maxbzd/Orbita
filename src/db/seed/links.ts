import type { Item, Link } from '../../domain/types';
import { LINKS } from './content/links';
import { ids } from './context';
import type { SeedContext } from './context';
import type { LinkSpec } from './specs';

const MS_PER_MINUTE = 60_000;

/**
 * Links between the demo items: the hand-made ones whose both ends are present, plus a `supersedes`
 * link for every fact that was replaced by a newer one.
 */
export function buildLinks(ctx: SeedContext, items: readonly Item[]): Link[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const specs: { from: string; to: string; kind: LinkSpec['kind'] }[] = LINKS.map((link) => ({
    from: ids.item(link.from),
    to: ids.item(link.to),
    kind: link.kind,
  }));
  for (const item of items) {
    if (item.kind === 'fact' && item.supersededBy) specs.push({ from: item.supersededBy, to: item.id, kind: 'supersedes' });
  }

  const links: Link[] = [];
  for (const spec of specs) {
    const from = byId.get(spec.from);
    const to = byId.get(spec.to);
    if (!from || !to) continue;
    const later = from.createdAt > to.createdAt ? from.createdAt : to.createdAt;
    const createdMs = Math.min(new Date(later).getTime() + MS_PER_MINUTE, ctx.clock.now.getTime() - MS_PER_MINUTE);
    links.push({
      id: ids.link(`${spec.from}>${spec.to}:${spec.kind}`),
      from: spec.from,
      to: spec.to,
      kind: spec.kind,
      createdAt: new Date(createdMs).toISOString(),
    });
  }
  return links;
}
