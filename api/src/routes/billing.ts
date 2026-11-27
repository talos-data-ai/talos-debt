import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireRole, tenantOf } from '../auth.js';
import {
  addPendingCard,
  cancelEmail,
  chargeClient,
  checkPayment,
  confirmCard,
  dueReason,
  finishCharge,
  sendMails,
  setCancel,
  type BillingDeps,
  type ChargeOutcome,
  type ChargeRow,
} from '../billing/billing.js';
import { FAKE_CARDS, FakeGateway } from '../billing/gateway.js';
import { buyerDetails, creditRefund, invoicingOn, missingForInvoice } from '../billing/invoices.js';
import { priceFor } from '../billing/pricing.js';
import { withTenant } from '../db.js';
import { parseOr400 } from '../validation.js';

/**
 * Billing (step 7.6), for owners and admins:
 *   GET  /api/billing                 plan, state, price, card, payments, and what the browser needs to add a card
 *   POST /api/billing/cards           save the token the browser just made at the provider
 *   POST /api/billing/cards/confirm   after the bank's confirmation: make it the company's card, and pay if due
 *   POST /api/billing/pay             pay now with the saved card (after a failed payment, or to subscribe again)
 *   POST /api/billing/cancel          cancel at the end of the period, or undo it ({ cancel: false })
 *
 * The card number never reaches this API: the browser sends it straight to
 * the provider. The token is never sent back to the browser.
 */

const BILLING_ROLES = ['owner', 'admin'] as const;
const tokenBody = z.object({ token: z.string().regex(/^token_[A-Za-z0-9_]{6,100}$/, 'not a card token') }).strict();
const confirmBody = z.object({ token: z.string().regex(/^token_[A-Za-z0-9_]{6,100}$/).optional() }).strict();
const cancelBody = z.object({ cancel: z.boolean() }).strict();

function chargeReply(out: ChargeOutcome): { code: number; body: object } {
  switch (out.status) {
    case 'paid':
      return { code: 200, body: { payment: 'paid' } };
    case 'failed':
      return { code: 402, body: { error: 'payment_failed', message: out.message ?? 'The card was declined', code: out.code } };
    case 'pending':
      return { code: 202, body: { payment: 'pending', message: 'The payment provider did not answer. We will check the payment and tell you.' } };
    case 'not_due':
      return { code: 409, body: { error: 'nothing_due', message: 'There is nothing to pay now' } };
    case 'busy':
      return { code: 409, body: { error: 'payment_in_progress', message: 'A payment is already in progress' } };
    case 'no_card':
      return { code: 409, body: { error: 'no_card', message: 'Add a card first' } };
    case 'not_configured':
      return { code: 503, body: { error: 'payments_not_configured', message: 'Payments are not set up yet' } };
  }
}

export function billingRoutes(app: FastifyInstance, deps: BillingDeps) {
  const { pool, config, gateway, pricing } = deps;

  app.get('/api/billing', { preHandler: requireRole(BILLING_ROLES) }, async (req) => {
    const user = req.user!;
    return withTenant(pool, tenantOf(user), async (db) => {
      const c = (
        await db.query(
          `SELECT plan, billing_period, billing_status, trial_ends_at, founding_member, paid_until, next_charge_at,
                  cancel_at_period_end, cancelled_at,
                  CASE WHEN trial_ends_at IS NULL THEN NULL ELSE app.free_until(trial_ends_at, founding_member) END AS free_until,
                  app.client_messaging_block(id) AS block
             FROM app.clients WHERE id = app.current_client_id()`,
        )
      ).rows[0];
      const card =
        (
          await db.query(`SELECT brand, last_four, exp_month, exp_year, activated_at FROM app.billing_cards WHERE status = 'active'`)
        ).rows[0] ?? null;
      const charges = (
        await db.query(
          `SELECT ch.id, ch.reason, ch.plan, ch.billing_period, ch.amount, ch.vat_amount, ch.period_start, ch.period_end,
                  ch.status, ch.failure_code, ch.failure_message, ch.created_at, k.brand, k.last_four
             FROM app.billing_charges ch JOIN app.billing_cards k ON k.id = ch.card_id
            ORDER BY ch.created_at DESC LIMIT 24`,
        )
      ).rows;
      const now = deps.now();
      return {
        ...c,
        price: pricing ? priceFor(pricing, c.plan, c.billing_period) : null,
        vat_included_in_list_price: pricing ? pricing.vat === 'included' : null,
        card,
        charges,
        can_pay: Boolean(card) && dueReason({ ...c, timezone: 'UTC', id: user.clientId }, now, 'pay_now') !== null,
        gateway: gateway
          ? {
              provider: gateway.browser.provider,
              publishable_key: gateway.browser.publishableKey,
              tokens_url: gateway.browser.tokensUrl,
              callback_url: `${config.APP_URL.replace(/\/+$/, '')}/settings/billing?card=return`,
              metadata: { client_id: user.clientId },
            }
          : null,
      };
    });
  });

  app.post('/api/billing/cards', { preHandler: requireRole(BILLING_ROLES) }, async (req, reply) => {
    const body = parseOr400(tokenBody, req.body, reply);
    if (!body) return;
    if (!gateway) return reply.code(503).send({ error: 'payments_not_configured', message: 'Payments are not set up yet' });
    const user = req.user!;
    const saved = await withTenant(pool, tenantOf(user), async (db) => {
      // Every payment gets a tax invoice (7.8), which needs the company's national address first.
      if (invoicingOn(config) && missingForInvoice(await buyerDetails(db)).length) return 'details' as const;
      return addPendingCard(deps, db, body.token, user.userId);
    });
    if (saved === 'details') {
      return reply.code(409).send({ error: 'invoice_details_missing', message: "Add your company's national address for its tax invoices first" });
    }
    if (!saved) return reply.code(409).send({ error: 'card_known', message: 'This card was already added' });
    return reply.code(201).send({ id: saved.id });
  });

  app.post('/api/billing/cards/confirm', { preHandler: requireRole(BILLING_ROLES) }, async (req, reply) => {
    const body = parseOr400(confirmBody, req.body ?? {}, reply);
    if (!body) return;
    const user = req.user!;
    const out = await confirmCard(deps, user.clientId, user.userId, body.token);
    switch (out.status) {
      case 'not_configured':
        return reply.code(503).send({ error: 'payments_not_configured', message: 'Payments are not set up yet' });
      case 'not_found':
        return reply.code(404).send({ error: 'card_not_found', message: 'No card is waiting for confirmation' });
      case 'waiting':
        return reply.code(409).send({ error: 'card_not_confirmed', message: 'The bank has not confirmed the card yet' });
      case 'failed':
        return reply.code(422).send({ error: 'card_refused', message: 'The bank did not confirm the card. Try again or use another card.' });
      case 'active': {
        if (!out.charge) return { card: out.card };
        const r = chargeReply(out.charge);
        return reply.code(r.code === 409 ? 200 : r.code).send({ card: out.card, ...r.body });
      }
    }
  });

  app.post('/api/billing/pay', { preHandler: requireRole(BILLING_ROLES) }, async (req, reply) => {
    const user = req.user!;
    const r = chargeReply(await chargeClient(deps, user.clientId, 'pay_now', user.userId));
    return reply.code(r.code).send(r.body);
  });

  app.post('/api/billing/cancel', { preHandler: requireRole(BILLING_ROLES) }, async (req, reply) => {
    const body = parseOr400(cancelBody, req.body, reply);
    if (!body) return;
    const user = req.user!;
    const out = await withTenant(pool, tenantOf(user), async (db) => {
      const r = await setCancel(deps, db, user.userId, body.cancel);
      return r.status === 'ok' && body.cancel ? { ...r, mail: await cancelEmail(deps, db, r.ends_at) } : r;
    });
    if (out.status !== 'ok') return reply.code(409).send({ error: 'not_allowed', message: 'There is no running subscription to change' });
    if ('mail' in out) await sendMails(deps, [out.mail]);
    return { cancel_at_period_end: body.cancel, ends_at: out.ends_at };
  });
}

/**
 * Development only (PAYMENT_DRIVER=fake): stands in for the provider's card
 * form, with the provider's test card numbers. Never mounted in production.
 */
export function fakeGatewayRoutes(app: FastifyInstance) {
  const card = z.object({
    name: z.string().min(1),
    number: z.string().regex(/^\d{12,19}$/),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(0).max(2200),
    cvc: z.string().regex(/^\d{3,4}$/),
    callback_url: z.url(),
    metadata: z.record(z.string(), z.string()).optional(),
  });
  app.post('/api/billing/fake/tokens', async (req, reply) => {
    const body = parseOr400(card, req.body, reply);
    if (!body) return;
    if (!FAKE_CARDS[body.number]) return reply.code(400).send({ type: 'invalid_request_error', message: 'Use one of the test cards' });
    const { id } = FakeGateway.tokenFor(body.number, body.month, body.year);
    const url = new URL(body.callback_url);
    url.searchParams.set('id', id);
    url.searchParams.set('status', 'active');
    return reply.code(201).send({ id, status: 'initiated', verification_url: url.toString() });
  });
}

/**
 * The provider's webhook (POST /webhooks/moyasar). Moyasar sends the secret
 * we set on the webhook in every message; anything else is refused. Every
 * event is stored first (app.webhook_events, safe to receive twice), then the
 * payment is read back from the provider before anything changes.
 */
export function billingWebhookRoutes(app: FastifyInstance, deps: BillingDeps & { workerPool: pg.Pool }) {
  const { config, gateway, workerPool } = deps;
  const secret = config.MOYASAR_WEBHOOK_SECRET;

  app.post('/webhooks/moyasar', async (req: FastifyRequest, reply) => {
    if (!secret || !gateway) return reply.code(503).send({ error: 'not_configured' });
    const body = req.body as {
      id?: string;
      type?: string;
      secret_token?: string;
      live?: boolean;
      data?: { id?: string; webhook_id?: string; verification_code?: string; metadata?: { charge_id?: string; client_id?: string } };
    } | null;
    const given = Buffer.from(String(body?.secret_token ?? ''));
    const want = Buffer.from(secret);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return reply.code(401).send({ error: 'bad_secret' });
    // Test events never touch production, and live events never touch anything else.
    if (typeof body?.live === 'boolean' && body.live !== (config.NODE_ENV === 'production')) return { ignored: 'mode' };
    if (!body?.id || !body.type) return reply.code(400).send({ error: 'bad_event' });

    const { secret_token: _s, ...stored } = body;
    const inserted = await workerPool.query<{ id: string }>(
      `INSERT INTO app.webhook_events (provider, event_id, payload) VALUES ('payment_gateway', $1, $2)
       ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
      [`moyasar:${body.id}`, JSON.stringify(stored)],
    );
    const eventRow = inserted.rows[0];
    if (!eventRow) return { received: 0 };

    let note: string | null = null;
    try {
      if (body.type === 'webhook_verification') {
        // A new webhook gets nothing until it is confirmed with the code sent here (Moyasar, Verify Webhook).
        const code = String(body.data?.verification_code ?? '');
        const hook = String(body.data?.webhook_id ?? body.data?.id ?? '');
        if (!/^\d{6}$/.test(code) || !hook || !gateway.verifyWebhook) note = 'bad_verification';
        else await gateway.verifyWebhook(hook, code);
      } else {
        note = await handlePaymentEvent(deps, body.type, body.data?.id, body.data?.metadata?.charge_id);
      }
    } catch (err) {
      note = `error: ${String((err as Error).message).slice(0, 300)}`;
      req.log.error({ event: eventRow.id }, 'payment webhook failed');
    }
    await workerPool.query(`UPDATE app.webhook_events SET processed_at = now(), error = $2 WHERE id = $1`, [eventRow.id, note]);
    return { received: 1 };
  });
}

/** A payment changed at the provider: finish a charge left 'sending', or record a late success. */
async function handlePaymentEvent(
  deps: BillingDeps & { workerPool: pg.Pool },
  type: string,
  paymentId: string | undefined,
  chargeId: string | undefined,
): Promise<string | null> {
  if (type !== 'payment_paid' && type !== 'payment_failed' && type !== 'payment_refunded') return 'ignored';
  if (!paymentId || !chargeId || !/^[0-9a-f-]{36}$/.test(chargeId)) return 'not_ours';
  const found = (
    await deps.workerPool.query<{ client_id: string }>(`SELECT client_id FROM app.billing_charges WHERE id = $1`, [chargeId])
  ).rows[0];
  if (!found) return 'not_ours';
  const row = await withTenant(deps.pool, { clientId: found.client_id, actorType: 'system' }, async (db) =>
    (await db.query<ChargeRow>(`SELECT * FROM app.billing_charges WHERE id = $1`, [chargeId])).rows[0],
  );
  if (!row) return 'not_ours';
  if (type === 'payment_refunded') {
    // A refund made in the provider's dashboard: a credit note for what was given back (7.8).
    if (row.status !== 'paid') return 'not_paid';
    const payment = await deps.gateway!.fetchPayment(paymentId);
    if (!payment || payment.id !== row.gateway_payment_id) return 'payment_not_found';
    const out = await creditRefund(deps, row.client_id, row.id, payment.refunded);
    return out.status === 'issued' || out.status === 'nothing' ? null : `credit_note_${out.status}`;
  }
  if (row.status === 'paid') return null;
  // Never trust the message itself: ask the provider.
  const payment = await deps.gateway!.fetchPayment(paymentId);
  if (!payment) return 'payment_not_found';
  const r = checkPayment(row, payment);
  if (row.status === 'failed' && !r.ok) return null;
  await finishCharge(deps, row, r, true);
  return null;
}
