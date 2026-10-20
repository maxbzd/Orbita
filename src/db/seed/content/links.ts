import type { LinkSpec } from '../specs';

/** Hand-made links between demo items (item keys). Superseded facts are linked automatically. */
export const LINKS: readonly LinkSpec[] = [
  { from: 'd-contract', to: 'co-contract-draft', kind: 'caused' },
  { from: 'd-contract', to: 'd-marcus-first', kind: 'supersedes' },
  { from: 'd-ben-45', to: 'd-hire-ben', kind: 'follows' },
  { from: 'd-price-raise', to: 'p-conv30', kind: 'related' },
  { from: 'd-annual', to: 'q-annual-switch', kind: 'related' },
  { from: 'd-team-freeze', to: 'p-teams5', kind: 'related' },
  { from: 'd-cut-portal', to: 'co-marcus-v1b', kind: 'follows' },
  { from: 'd-sam-reco', to: 'q-teach', kind: 'related' },
  { from: 'd-no-late-code', to: 'l-late-work', kind: 'caused' },
  { from: 'd-focus-8w', to: 'p-1000', kind: 'related' },
  { from: 'co-hana-followup', to: 'p-hana-reply', kind: 'related' },
  { from: 'd-no-rewrite', to: 'i-rewrite', kind: 'related' },
  { from: 'i-intro-credit', to: 'i-referral', kind: 'duplicate' },
  { from: 'i-contractor-handbook', to: 'i-handover-doc', kind: 'duplicate' },
  { from: 'l-weekly-demo', to: 'co-marcus-v1b', kind: 'caused' },
];
