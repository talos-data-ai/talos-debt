/**
 * The three plans and what each includes (Sal, 25 November 2026). Each plan
 * has everything in the plan before it, and more. A plan's card says so in
 * one line ("Everything in Follow-up"), then lists only what it adds, to keep
 * the cards short (Sal, 26 November 2026). The same lists are on the website
 * (site/src/content.ts, `pricing.tiers`): change both.
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

/** What a plan's card lists: the plan before it in one line (if any), then what this plan adds. */
export function planFeatures(plan: PlanKey): { key: MessageKey; before?: PlanKey }[] {
  const i = PLANS.indexOf(plan);
  const before = i > 0 ? [{ key: 'signup.everythingIn' as MessageKey, before: PLANS[i - 1]! }] : [];
  return [...before, ...NEW_IN_PLAN[plan].map((key) => ({ key }))];
}
