import { readFileSync } from 'node:fs';

/**
 * The prices, from the same JSON file as the website (`PRICING_FILE`, kept
 * outside this public repository): value added tax excluded or included, and
 * the monthly and yearly price of each plan, as text in SAR, in plan order.
 *
 *   { "vat": "excluded", "founding_offer": true,
 *     "tiers": [{ "monthly": "499", "yearly": "4990" }, ...] }
 *
 * Money stays text and whole halalas (BigInt): never a JavaScript number.
 */
export const PLANS = ['follow_up', 'legal', 'najiz'] as const;
export type Plan = (typeof PLANS)[number];
export type Period = 'monthly' | 'yearly';

export interface Pricing {
  vat: 'excluded' | 'included';
  tiers: { monthly: string; yearly: string }[];
}

/** Value added tax in Saudi Arabia, in percent. */
export const VAT_PERCENT = 15n;

const AMOUNT = /^\d{1,7}(\.\d{2})?$/;

export function parsePricing(json: string): Pricing {
  const x = JSON.parse(json) as { vat?: unknown; tiers?: unknown };
  if (x.vat !== 'excluded' && x.vat !== 'included') throw new Error('pricing: vat must be "excluded" or "included"');
  const tiers = x.tiers as { monthly?: unknown; yearly?: unknown }[];
  if (!Array.isArray(tiers) || tiers.length !== PLANS.length) throw new Error(`pricing: tiers must list ${PLANS.length} plans`);
  return {
    vat: x.vat,
    tiers: tiers.map((t, i) => {
      if (typeof t.monthly !== 'string' || !AMOUNT.test(t.monthly) || typeof t.yearly !== 'string' || !AMOUNT.test(t.yearly)) {
        throw new Error(`pricing: plan ${i + 1} needs "monthly" and "yearly" as text amounts, for example "499"`);
      }
      if (toHalalas(t.monthly) === 0n || toHalalas(t.yearly) === 0n) throw new Error(`pricing: plan ${i + 1} has a zero price`);
      return { monthly: t.monthly, yearly: t.yearly };
    }),
  };
}

export function loadPricing(env: { PRICING_JSON?: string; PRICING_FILE?: string }): Pricing | null {
  if (env.PRICING_JSON) return parsePricing(env.PRICING_JSON);
  if (env.PRICING_FILE) return parsePricing(readFileSync(env.PRICING_FILE, 'utf8'));
  return null;
}

export function toHalalas(amount: string): bigint {
  const [whole, part = ''] = amount.split('.');
  return BigInt(whole!) * 100n + BigInt((part + '00').slice(0, 2));
}

export function fromHalalas(h: bigint): string {
  const s = h.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Rounds a / b to the nearest whole number, halves up (a, b positive). */
const divRound = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b);

export interface Price {
  /** What the card is charged, tax included. */
  amount: string;
  vat: string;
  net: string;
}

/** The price of one period of a plan, with the tax worked out in halalas. */
export function priceFor(pricing: Pricing, plan: Plan, period: Period): Price {
  const listed = toHalalas(pricing.tiers[PLANS.indexOf(plan)]![period]);
  if (pricing.vat === 'excluded') {
    const vat = vatOn(listed);
    return { amount: fromHalalas(listed + vat), vat: fromHalalas(vat), net: fromHalalas(listed) };
  }
  // The tax is always worked out from the net amount (as on the invoice), so with the tax
  // included the net is the largest one whose total is not more than the listed price.
  // Almost always that total is the listed price itself; otherwise it is a halala less.
  const s = splitTotal(listed) ?? splitBelow(listed);
  return { amount: fromHalalas(s.net + s.vat), vat: fromHalalas(s.vat), net: fromHalalas(s.net) };
}

/** The tax on a net amount, in halalas: 15%, rounded to the nearest halala, halves up. */
export function vatOn(net: bigint): bigint {
  return divRound(net * VAT_PERCENT, 100n);
}

/** The net amount and tax that make exactly this total (halalas), or null if no net amount does. */
export function splitTotal(total: bigint): { net: bigint; vat: bigint } | null {
  const guess = divRound(total * 100n, 100n + VAT_PERCENT);
  for (const net of [guess - 1n, guess, guess + 1n]) {
    if (net > 0n && net + vatOn(net) === total) return { net, vat: vatOn(net) };
  }
  return null;
}

function splitBelow(total: bigint): { net: bigint; vat: bigint } {
  let net = divRound(total * 100n, 100n + VAT_PERCENT) + 1n;
  while (net + vatOn(net) > total) net--;
  return { net, vat: vatOn(net) };
}
