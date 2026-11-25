/**
 * The three plans and what each includes (Sal, 25 November 2026). Each plan
 * has everything in the plan before it, and more, so the list of a plan is
 * every earlier plan's features followed by its own new ones. The same lists
 * are on the website (site/src/content.ts, `pricing.tiers`): change both.
 */
import type { PlanKey } from '../api/types';
import type { MessageKey } from '../i18n';

export const PLANS: PlanKey[] = ['follow_up', 'legal', 'najiz'];

/** Only what each plan adds to the one before it. */
export const NEW_IN_PLAN: Record<PlanKey, MessageKey[]> = {
  follow_up: ['planf.reminders', 'planf.replies', 'planf.promises', 'planf.receipts', 'planf.dashboard', 'planf.summary'],
  legal: ['planf.enforceable', 'planf.paperNotes', 'planf.najizCheck', 'planf.pack', 'planf.caseStatus'],
  najiz: ['planf.najizFiling', 'planf.manyNotes', 'planf.checkValues', 'planf.statusRound'],
};

/** Everything a plan includes, in order, with the features new in it marked. */
export function planFeatures(plan: PlanKey): { key: MessageKey; isNew: boolean }[] {
  const upTo = PLANS.slice(0, PLANS.indexOf(plan) + 1);
  return upTo.flatMap((p) => NEW_IN_PLAN[p].map((key) => ({ key, isNew: p === plan && p !== 'follow_up' })));
}
