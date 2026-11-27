import type pg from 'pg';
import type { Config } from '../config.js';
import { withTenant, type Db } from '../db.js';
import type { Mailer } from '../login/mailer.js';
import { billingEmail, type BillingEmailFacts, type BillingEmailKind } from './emails.js';
import { GatewayRefused, GatewayUnavailable, type GatewayPayment, type PaymentGateway } from './gateway.js';
import { invoiceCharge } from './invoices.js';
import type { ZatcaClient } from './zatca/client.js';
import { priceFor, toHalalas, type Period, type Plan, type Pricing } from './pricing.js';

/**
 * Subscription payments (step 7.6).
 *
 * A company tries Talos free, adds a card (the browser sends it straight to
 * the provider; Talos keeps a token), and is charged:
 *   - when the free time ends (the trial, plus a month for founding members),
 *   - at the end of every paid period, until it cancels,
 *   - again after 1 and 3 days when a payment fails (messages stop at once),
 *   - when the owner or an admin presses pay.
 *
 * A charge is one row in app.billing_charges, saved as 'sending' before the
 * provider is called (outside any transaction) and finished after. Its id is
 * the provider's idempotency key, so a charge left 'sending' by a crash is
 * sent again with the same id and is never taken twice. Only one charge per
 * company can be 'sending' (a unique index).
 */

export interface BillingDeps {
  pool: pg.Pool;
  /** Worker connection: only to find companies with something due. */
  workerPool?: pg.Pool;
  config: Config;
  gateway: PaymentGateway | undefined;
  pricing: Pricing | null;
  mailer: Mailer;
  /** Tax invoices (7.8): ZATCA, or null when invoices are made but not sent (ZATCA_MODE=off). */
  zatca?: ZatcaClient | null;
  now: () => Date;
  log?: { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void };
}

export type ChargeReason = 'trial_end' | 'renewal' | 'retry' | 'pay_now';

export type ChargeOutcome =
  | { status: 'paid'; chargeId: string }
  | { status: 'failed'; chargeId: string; code: string; message: string | null }
  /** The provider could not be reached: the same charge is sent again later. */
  | { status: 'pending'; chargeId: string }
  | { status: 'not_due' | 'busy' | 'no_card' | 'not_configured' };

/** Days until the next automatic try after the 1st and the 2nd failed payment (1 day, then 3 days after the first). */
export const RETRY_AFTER_DAYS = [1, 2];
/** A charge still 'sending' after this long was stopped half way and is sent again. */
export const SENDING_STALE_MS = 2 * 60_000;

const DAY = 86_400_000;

export interface ChargeRow {
  id: string;
  client_id: string;
  card_id: string;
  reason: ChargeReason;
  plan: Plan;
  billing_period: Period;
  amount: string;
  vat_amount: string;
  period_start: Date;
  period_end: Date;
  status: 'sending' | 'paid' | 'failed';
  requested_by: string | null;
  gateway_payment_id?: string | null;
}

interface ClientBilling {
  id: string;
  plan: Plan;
  billing_period: Period;
  billing_status: 'trial' | 'active' | 'unpaid' | 'cancelled';
  free_until: Date | null;
  paid_until: Date | null;
  next_charge_at: Date | null;
  cancel_at_period_end: boolean;
  timezone: string;
}

export const billingLink = (config: Config) => `${config.APP_URL.replace(/\/+$/, '')}/settings/billing`;

async function loadClient(db: Db, lock = false): Promise<ClientBilling> {
  return (
    await db.query<ClientBilling>(
      `SELECT id, plan, billing_period, billing_status, paid_until, next_charge_at, cancel_at_period_end, timezone,
              CASE WHEN trial_ends_at IS NULL THEN NULL ELSE app.free_until(trial_ends_at, founding_member) END AS free_until
         FROM app.clients WHERE id = app.current_client_id() ${lock ? 'FOR UPDATE' : ''}`,
    )
  ).rows[0]!;
}

/** Is a payment due now, and why? Null when nothing is due. */
export function dueReason(c: ClientBilling, now: Date, asked: ChargeReason): ChargeReason | null {
  const freeOver = c.billing_status === 'trial' && c.free_until !== null && c.free_until <= now;
  const periodOver = c.billing_status === 'active' && c.paid_until !== null && c.paid_until <= now;
  switch (asked) {
    case 'trial_end':
      return freeOver && !c.cancel_at_period_end ? 'trial_end' : null;
    case 'renewal':
      return periodOver && !c.cancel_at_period_end ? 'renewal' : null;
    case 'retry':
      return c.billing_status === 'unpaid' && c.next_charge_at !== null && c.next_charge_at <= now ? 'retry' : null;
    case 'pay_now':
      return c.billing_status === 'unpaid' || c.billing_status === 'cancelled' || freeOver || periodOver ? 'pay_now' : null;
  }
}

/** Owners and admins: who gets billing emails. */
export async function recipients(db: Db): Promise<string[]> {
  return (
    await db.query<{ email: string }>(`SELECT email FROM app.users WHERE role IN ('owner', 'admin') AND is_active ORDER BY role DESC, email`)
  ).rows.map((r) => r.email);
}

export async function notify(db: Db, now: Date, title: string, data: Record<string, unknown>) {
  await db.query(
    `INSERT INTO app.notifications (client_id, kind, title, target_table, created_at, data)
     VALUES (app.current_client_id(), 'system', $1, 'billing', $2, $3)`,
    [title, now, JSON.stringify(data)],
  );
}

export async function audit(db: Db, action: string, details: Record<string, unknown>, userId?: string | null) {
  await db.query(
    `INSERT INTO audit.activity_log (client_id, actor_type, actor_id, action, target_table, target_id, details)
     VALUES (app.current_client_id(), $1, $2, $3, 'app.clients', app.current_client_id(), $4)`,
    [userId ? 'user' : 'system', userId ?? null, action, JSON.stringify(details)],
  );
}

export interface PendingMail {
  to: string[];
  kind: BillingEmailKind;
  facts: BillingEmailFacts;
}

/** Emails go out after the transaction, and a failed email never undoes a payment. */
async function sendMails(deps: BillingDeps, mails: PendingMail[]) {
  for (const m of mails) {
    for (const to of m.to) {
      try {
        await deps.mailer.send(billingEmail(to, m.kind, m.facts));
      } catch (err) {
        deps.log?.error({ err: (err as Error).message, kind: m.kind }, 'billing email failed');
      }
    }
  }
}

// ------------------------------------------------------------------ charging

/**
 * Charges a company's card if a payment is due for `asked`. `by` is the person
 * who pressed pay (null for the scheduler). Safe to call from several places
 * at once: only one charge per company can be in progress.
 */
export async function chargeClient(
  deps: BillingDeps,
  clientId: string,
  asked: ChargeReason,
  by: string | null = null,
): Promise<ChargeOutcome> {
  const { gateway, pricing } = deps;
  if (!gateway || !pricing) return { status: 'not_configured' };
  const now = deps.now();

  const started = await withTenant(deps.pool, { clientId, userId: by ?? undefined, actorType: 'system' }, async (db) => {
    const c = await loadClient(db, true);
    const reason = dueReason(c, now, asked);
    if (!reason) return { status: 'not_due' as const };
    const card = (
      await db.query<{ id: string; token: string }>(`SELECT id, token FROM app.billing_cards WHERE status = 'active'`)
    ).rows[0];
    if (!card) return { status: 'no_card' as const };

    // A period starts when the last one ended (or the free time), unless the company has
    // gone without the service for more than a day: then it starts now.
    const dueAt = c.billing_status === 'active' ? c.paid_until : c.billing_status === 'trial' ? c.free_until : null;
    const start = dueAt && dueAt.getTime() > now.getTime() - DAY ? dueAt : now;
    const price = priceFor(pricing, c.plan, c.billing_period);
    const row = (
      await db.query<ChargeRow>(
        `INSERT INTO app.billing_charges (client_id, card_id, reason, plan, billing_period, amount, vat_amount,
                                          period_start, period_end, requested_by, created_at)
         VALUES (app.current_client_id(), $1, $2, $3, $4, $5, $6, $7,
                 $7::timestamptz + CASE WHEN $4 = 'yearly' THEN interval '1 year' ELSE interval '1 month' END, $8, $9)
         ON CONFLICT (client_id) WHERE status = 'sending' DO NOTHING
         RETURNING *`,
        [card.id, reason, c.plan, c.billing_period, price.amount, price.vat, start, by, now],
      )
    ).rows[0];
    if (!row) return { status: 'busy' as const };
    return { status: 'started' as const, row, token: card.token };
  });
  if (started.status !== 'started') return started;
  return sendCharge(deps, started.row, started.token);
}

/** Asks the provider, then saves the answer. Called again with the same row after a crash. */
export async function sendCharge(deps: BillingDeps, row: ChargeRow, token: string): Promise<ChargeOutcome> {
  const gateway = deps.gateway!;
  let payment: GatewayPayment;
  try {
    payment = await gateway.charge({
      givenId: row.id,
      token,
      amount: toHalalas(row.amount),
      description: `Talos Debt Collection: ${row.plan} plan, ${row.billing_period}`,
      callbackUrl: billingLink(deps.config),
      metadata: { client_id: row.client_id, charge_id: row.id },
    });
  } catch (err) {
    if (err instanceof GatewayUnavailable) {
      deps.log?.error({ charge: row.id, err: err.message }, 'payment provider not reached; the charge will be sent again');
      return { status: 'pending', chargeId: row.id };
    }
    if (err instanceof GatewayRefused) return finishCharge(deps, row, { ok: false, code: err.code, message: err.message, paymentId: null });
    throw err;
  }
  return finishCharge(deps, row, checkPayment(row, payment));
}

type Result = { ok: true; paymentId: string } | { ok: false; code: string; message: string | null; paymentId: string | null };

/** Paid only if the provider says paid for exactly our amount, in riyals, for this charge. */
export function checkPayment(row: ChargeRow, p: GatewayPayment): Result {
  const paid = p.status === 'paid' || p.status === 'captured';
  if (paid && p.amount === toHalalas(row.amount) && p.currency === 'SAR' && (p.metadata.charge_id ?? row.id) === row.id) {
    return { ok: true, paymentId: p.id };
  }
  if (paid) return { ok: false, code: 'amount_mismatch', message: 'The amount paid does not match the charge', paymentId: p.id };
  if (p.status === 'failed') return { ok: false, code: 'declined', message: p.message, paymentId: p.id };
  return { ok: false, code: 'needs_authentication', message: p.message ?? `Payment ${p.status}`, paymentId: p.id };
}

/**
 * Saves the provider's answer, once. `late` lets a payment the provider
 * confirmed later (webhook) turn a failed charge into paid.
 */
export async function finishCharge(deps: BillingDeps, row: ChargeRow, r: Result, late = false): Promise<ChargeOutcome> {
  const now = deps.now();
  const mails: PendingMail[] = [];
  const outcome = await withTenant(
    deps.pool,
    { clientId: row.client_id, userId: row.requested_by ?? undefined, actorType: 'system' },
    async (db): Promise<ChargeOutcome> => {
      const c = await loadClient(db, true);
      const updated = (
        await db.query<ChargeRow>(
          `UPDATE app.billing_charges
              SET status = $2, gateway_payment_id = coalesce($3, gateway_payment_id), failure_code = $4,
                  failure_message = $5, finished_at = $6
            WHERE id = $1 AND (status = 'sending' OR ($7 AND status = 'failed' AND $2 = 'paid'))
            RETURNING *`,
          [row.id, r.ok ? 'paid' : 'failed', r.paymentId, r.ok ? null : r.code, r.ok ? null : (r.message?.slice(0, 300) ?? null), now, late],
        )
      ).rows[0];
      if (!updated) {
        const current = (await db.query<{ status: string }>(`SELECT status FROM app.billing_charges WHERE id = $1`, [row.id])).rows[0];
        return current?.status === 'paid' ? { status: 'paid', chargeId: row.id } : { status: 'not_due' };
      }
      const card = (
        await db.query<{ brand: string | null; last_four: string | null }>(`SELECT brand, last_four FROM app.billing_cards WHERE id = $1`, [row.card_id])
      ).rows[0];
      const to = await recipients(db);
      const facts: BillingEmailFacts = {
        link: billingLink(deps.config),
        timezone: c.timezone,
        amount: row.amount,
        plan: row.plan,
        period: row.billing_period,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        brand: card?.brand,
        lastFour: card?.last_four,
      };

      if (r.ok) {
        await db.query(
          `UPDATE app.clients
              SET billing_status = 'active', paid_until = $1, next_charge_at = NULL,
                  cancel_at_period_end = false, cancelled_at = NULL
            WHERE id = app.current_client_id()`,
          [row.period_end],
        );
        await audit(db, 'billing.paid', { charge_id: row.id, amount: row.amount, paid_until: row.period_end }, row.requested_by);
        await notify(db, now, `Payment received: SAR ${row.amount}`, {
          event: 'billing_paid', amount: row.amount, period_end: row.period_end, charge_id: row.id,
        });
        mails.push({ to, kind: 'paid', facts });
        return { status: 'paid', chargeId: row.id };
      }

      // Failed: messages stop at once. Automatic tries after 1 and 3 days; staff may pay at any time.
      const failures = Number(
        (
          await db.query<{ n: string }>(
            `SELECT count(*) AS n FROM app.billing_charges
              WHERE status = 'failed' AND reason <> 'pay_now'
                AND created_at > coalesce((SELECT max(created_at) FROM app.billing_charges WHERE status = 'paid'), '-infinity')`,
          )
        ).rows[0]!.n,
      );
      const days = row.reason === 'pay_now' ? undefined : RETRY_AFTER_DAYS[failures - 1];
      const retryAt = row.reason === 'pay_now' ? c.next_charge_at : days ? new Date(now.getTime() + days * DAY) : null;
      await db.query(
        `UPDATE app.clients
            SET billing_status = CASE WHEN billing_status = 'cancelled' THEN 'cancelled' ELSE 'unpaid' END,
                next_charge_at = $1
          WHERE id = app.current_client_id()`,
        [retryAt],
      );
      await audit(db, 'billing.failed', { charge_id: row.id, amount: row.amount, code: r.code, retry_at: retryAt }, row.requested_by);
      await notify(db, now, `Payment failed: SAR ${row.amount}`, {
        event: 'billing_failed', amount: row.amount, code: r.code, retry_at: retryAt, charge_id: row.id,
      });
      // The customer's own card was refused: tell them. A mistake on our side (amount, a refused request) goes to the logs too.
      if (r.code !== 'declined') deps.log?.error({ charge: row.id, code: r.code }, 'charge failed');
      mails.push({ to, kind: 'failed', facts: { ...facts, retryAt, reason: r.message } });
      return { status: 'failed', chargeId: row.id, code: r.code, message: r.message };
    },
  );
  await sendMails(deps, mails);
  // The tax invoice (7.8) comes after the payment is saved: a problem with it never undoes a payment.
  if (outcome.status === 'paid' && mails.some((m) => m.kind === 'paid')) {
    await invoiceCharge(deps, row.client_id, row.id, true).catch((err) =>
      deps.log?.error({ charge: row.id, err: (err as Error).message }, 'invoice could not be made; the scheduler tries again'),
    );
  }
  return outcome;
}

// ------------------------------------------------------------------ cards

export type CardOutcome =
  | { status: 'active'; card: { brand: string | null; last_four: string; exp_month: number | null; exp_year: number | null }; charge?: ChargeOutcome }
  | { status: 'waiting' }
  | { status: 'failed' }
  | { status: 'not_found' | 'not_configured' };

/** Saves a token the browser just made, before the cardholder confirms it with their bank. */
export async function addPendingCard(deps: BillingDeps, db: Db, token: string, userId: string): Promise<{ id: string } | null> {
  if (!deps.gateway) return null;
  return (
    (
      await db.query<{ id: string }>(
        `INSERT INTO app.billing_cards (client_id, gateway, token, added_by, created_at)
         VALUES (app.current_client_id(), $1, $2, $3, $4)
         ON CONFLICT (gateway, token) DO NOTHING RETURNING id`,
        [deps.gateway.name, token, userId, deps.now()],
      )
    ).rows[0] ?? null
  );
}

/**
 * After the bank's confirmation: asks the provider whether the card is
 * confirmed and belongs to this company, makes it the company's card, and
 * charges it at once if a payment is due.
 */
export async function confirmCard(deps: BillingDeps, clientId: string, userId: string, token?: string): Promise<CardOutcome> {
  const gateway = deps.gateway;
  if (!gateway) return { status: 'not_configured' };
  const ctx = { clientId, userId, actorType: 'system' as const };
  const pending = await withTenant(deps.pool, ctx, async (db) =>
    (
      await db.query<{ id: string; token: string }>(
        `SELECT id, token FROM app.billing_cards
          WHERE status = 'pending' AND gateway = $1 AND ($2::text IS NULL OR token = $2)
            AND created_at > $3::timestamptz - interval '1 day'
          ORDER BY created_at DESC LIMIT 1`,
        [gateway.name, token ?? null, deps.now()],
      )
    ).rows[0],
  );
  if (!pending) return { status: 'not_found' };

  const t = await gateway.fetchToken(pending.token);
  // The provider's own record must say the card was added for this company.
  const forUs = t && (t.metadata.client_id === undefined || t.metadata.client_id === clientId);
  if (t && forUs && t.status === 'initiated') return { status: 'waiting' };
  if (!t || !forUs || t.status !== 'active' || !t.lastFour) {
    await withTenant(deps.pool, ctx, async (db) => {
      await db.query(`UPDATE app.billing_cards SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [pending.id]);
    });
    return { status: 'failed' };
  }

  const now = deps.now();
  const old = await withTenant(deps.pool, ctx, async (db) => {
    await db.query(`SELECT 1 FROM app.clients WHERE id = app.current_client_id() FOR UPDATE`);
    const previous = (
      await db.query<{ id: string; token: string }>(
        `UPDATE app.billing_cards SET status = 'removed', removed_at = $1
          WHERE status = 'active' AND id <> $2 RETURNING id, token`,
        [now, pending.id],
      )
    ).rows;
    await db.query(
      `UPDATE app.billing_cards
          SET status = 'active', brand = $2, last_four = $3, exp_month = $4, exp_year = $5, activated_at = $6
        WHERE id = $1 AND status = 'pending'`,
      [pending.id, t.brand?.replace(/[^a-z_]/g, '') || null, t.lastFour, t.month, t.year, now],
    );
    await audit(db, 'billing.card_added', { card_id: pending.id, brand: t.brand, last_four: t.lastFour }, userId);
    return previous;
  });
  // The old card is no use to anyone: ask the provider to forget it (best effort).
  for (const o of old) await gateway.deleteToken(o.token).catch(() => undefined);

  const card = { brand: t.brand, last_four: t.lastFour, exp_month: t.month, exp_year: t.year };
  const charge = await chargeClient(deps, clientId, 'pay_now', userId);
  return { status: 'active', card, ...(charge.status === 'not_due' ? {} : { charge }) };
}

// ------------------------------------------------------------------ the scheduler's round

type Action = 'trial_end' | 'renewal' | 'retry' | 'no_card' | 'end' | 'trial_notice' | 'trial_ended_notice' | 'renewal_notice';

export interface BillingRound {
  recovered: number;
  charged: number;
  notices: number;
}

/**
 * Run by the scheduler every round: sends charges left half way again,
 * charges what is due, ends cancelled subscriptions, and sends the notices.
 */
export async function runBilling(deps: BillingDeps): Promise<BillingRound> {
  const result: BillingRound = { recovered: 0, charged: 0, notices: 0 };
  const worker = deps.workerPool;
  if (!worker) return result;
  const now = deps.now();

  if (deps.gateway) {
    const stale = (
      await worker.query<{ id: string; client_id: string }>(
        `SELECT id, client_id FROM app.billing_charges WHERE status = 'sending' AND created_at < $1 ORDER BY created_at`,
        [new Date(now.getTime() - SENDING_STALE_MS)],
      )
    ).rows;
    for (const s of stale) {
      const found = await withTenant(deps.pool, { clientId: s.client_id, actorType: 'system' }, async (db) =>
        (
          await db.query<ChargeRow & { token: string }>(
            `SELECT ch.*, k.token FROM app.billing_charges ch JOIN app.billing_cards k ON k.id = ch.card_id
              WHERE ch.id = $1 AND ch.status = 'sending'`,
            [s.id],
          )
        ).rows[0],
      );
      if (!found) continue;
      const out = await sendCharge(deps, found, found.token);
      if (out.status !== 'pending') result.recovered++;
    }
  }

  const due = (
    await worker.query<{ id: string; action: Action }>(
      `SELECT c.id,
              CASE
                WHEN c.cancel_at_period_end AND c.billing_status IN ('trial', 'active')
                 AND coalesce(c.paid_until, f.free_until) <= $1                                         THEN 'end'
                WHEN c.billing_status = 'trial' AND f.free_until <= $1 AND k.has                       THEN 'trial_end'
                WHEN c.billing_status = 'active' AND c.paid_until <= $1 AND k.has                       THEN 'renewal'
                WHEN c.billing_status = 'active' AND c.paid_until <= $1                                 THEN 'no_card'
                WHEN c.billing_status = 'unpaid' AND c.next_charge_at <= $1 AND k.has                   THEN 'retry'
                WHEN c.billing_status = 'trial' AND NOT k.has AND f.free_until <= $1
                 AND c.trial_ended_notice_at IS NULL                                                     THEN 'trial_ended_notice'
                WHEN c.billing_status = 'trial' AND NOT k.has AND f.free_until > $1
                 AND f.free_until <= $1::timestamptz + interval '3 days' AND c.trial_notice_at IS NULL   THEN 'trial_notice'
                WHEN c.billing_status = 'active' AND c.billing_period = 'yearly' AND NOT c.cancel_at_period_end
                 AND c.paid_until > $1 AND c.paid_until <= $1::timestamptz + interval '7 days'
                 AND c.renewal_notice_for IS DISTINCT FROM c.paid_until                                  THEN 'renewal_notice'
              END AS action
         FROM app.clients c
         CROSS JOIN LATERAL (SELECT CASE WHEN c.trial_ends_at IS NULL THEN NULL
                                         ELSE app.free_until(c.trial_ends_at, c.founding_member) END AS free_until) f
         CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM app.billing_cards b
                                             WHERE b.client_id = c.id AND b.status = 'active') AS has) k
        WHERE c.status IN ('onboarding', 'active')
          AND NOT EXISTS (SELECT 1 FROM app.billing_charges s WHERE s.client_id = c.id AND s.status = 'sending')
        ORDER BY c.id`,
      [now],
    )
  ).rows.filter((r) => r.action);

  for (const { id, action } of due) {
    try {
      if (action === 'trial_end' || action === 'renewal' || action === 'retry') {
        const out = await chargeClient(deps, id, action);
        if (out.status === 'paid' || out.status === 'failed') result.charged++;
      } else if (await applyNotice(deps, id, action)) {
        result.notices++;
      }
    } catch (err) {
      deps.log?.error({ client: id, action, err: (err as Error).message }, 'billing step failed');
    }
  }
  return result;
}

/** A state change or a notice that needs no payment. Each happens once, even with several workers. */
async function applyNotice(deps: BillingDeps, clientId: string, action: Exclude<Action, 'trial_end' | 'renewal' | 'retry'>): Promise<boolean> {
  const now = deps.now();
  const mails: PendingMail[] = [];
  const done = await withTenant(deps.pool, { clientId, actorType: 'system' }, async (db) => {
    const c = await loadClient(db, true);
    const to = await recipients(db);
    const facts: BillingEmailFacts = { link: billingLink(deps.config), timezone: c.timezone, plan: c.plan, period: c.billing_period };
    const set = async (sql: string, params: unknown[] = [], where = '') =>
      (await db.query(`UPDATE app.clients SET ${sql} WHERE id = app.current_client_id() ${where} RETURNING id`, params)).rowCount === 1;

    switch (action) {
      case 'end': {
        if (!c.cancel_at_period_end || (c.billing_status !== 'trial' && c.billing_status !== 'active')) return false;
        const endAt = c.paid_until ?? c.free_until;
        if (!endAt || endAt > now) return false;
        await set(`billing_status = 'cancelled', cancelled_at = $1, next_charge_at = NULL`, [now]);
        await audit(db, 'billing.ended', { at: now });
        await notify(db, now, 'Your subscription has ended', { event: 'subscription_ended' });
        mails.push({ to, kind: 'ended', facts });
        return true;
      }
      case 'no_card': {
        if (c.billing_status !== 'active' || !c.paid_until || c.paid_until > now) return false;
        await set(`billing_status = 'unpaid', next_charge_at = NULL`);
        await audit(db, 'billing.failed', { code: 'no_card' });
        await notify(db, now, 'Payment needed: no card', { event: 'billing_failed', code: 'no_card' });
        mails.push({ to, kind: 'failed', facts });
        return true;
      }
      case 'trial_notice': {
        if (c.billing_status !== 'trial' || !(await set(`trial_notice_at = $1`, [now], 'AND trial_notice_at IS NULL'))) return false;
        await notify(db, now, 'Your free trial ends soon', { event: 'trial_ending', date: c.free_until });
        mails.push({ to, kind: 'trial_ending', facts: { ...facts, date: c.free_until! } });
        return true;
      }
      case 'trial_ended_notice': {
        if (c.billing_status !== 'trial' || !(await set(`trial_ended_notice_at = $1`, [now], 'AND trial_ended_notice_at IS NULL'))) return false;
        await notify(db, now, 'Your free trial has ended', { event: 'trial_ended' });
        mails.push({ to, kind: 'trial_ended', facts });
        return true;
      }
      case 'renewal_notice': {
        if (c.billing_status !== 'active' || !c.paid_until || !deps.pricing) return false;
        if (!(await set(`renewal_notice_for = paid_until`, [], 'AND renewal_notice_for IS DISTINCT FROM paid_until'))) return false;
        const card = (await db.query<{ brand: string; last_four: string }>(`SELECT brand, last_four FROM app.billing_cards WHERE status = 'active'`)).rows[0];
        const amount = priceFor(deps.pricing, c.plan, c.billing_period).amount;
        await notify(db, now, 'Your yearly plan renews soon', { event: 'renewal_soon', date: c.paid_until, amount });
        mails.push({ to, kind: 'renewal_soon', facts: { ...facts, date: c.paid_until, amount, brand: card?.brand, lastFour: card?.last_four } });
        return true;
      }
    }
  });
  if (done) await sendMails(deps, mails);
  return done;
}

// ------------------------------------------------------------------ cancel

/** Cancel at the end of the period (or undo it). Staff may do this; the state change at the end is the system's. */
export async function setCancel(
  deps: BillingDeps,
  db: Db,
  userId: string,
  cancel: boolean,
): Promise<{ status: 'ok'; ends_at: Date | null } | { status: 'not_allowed' }> {
  const c = await loadClient(db, true);
  if (c.billing_status !== 'trial' && c.billing_status !== 'active') return { status: 'not_allowed' };
  if (c.cancel_at_period_end === cancel) return { status: 'ok', ends_at: c.paid_until ?? c.free_until };
  await db.query(`UPDATE app.clients SET cancel_at_period_end = $1 WHERE id = app.current_client_id()`, [cancel]);
  const endsAt = c.paid_until ?? c.free_until;
  await audit(db, cancel ? 'billing.cancel' : 'billing.resume', { ends_at: endsAt }, userId);
  if (cancel) {
    await notify(db, deps.now(), 'Subscription cancelled', { event: 'subscription_cancelled', date: endsAt });
  }
  return { status: 'ok', ends_at: endsAt };
}

/** The cancellation email, sent by the route after its transaction. */
export async function cancelEmail(deps: BillingDeps, db: Db, endsAt: Date | null): Promise<PendingMail> {
  const c = await loadClient(db);
  return { to: await recipients(db), kind: 'cancelled', facts: { link: billingLink(deps.config), timezone: c.timezone, date: endsAt ?? undefined } };
}

export { sendMails };
