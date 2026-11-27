/**
 * Subscription payments (step 7.6): cards are added through the provider (a
 * fake here; tests never call Moyasar), the card is charged when the free
 * time ends and at every renewal, a failed payment stops Talos at once and is
 * tried again after 1 and 3 days, a charge left half way is never taken
 * twice, cancelling ends the service with the paid period, and the
 * provider's webhook is checked before anything changes.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { chargeClient, runBilling, type BillingDeps } from '../src/billing/billing.js';
import { FakeGateway, GatewayRefused, GatewayUnavailable } from '../src/billing/gateway.js';
import { MoyasarGateway } from '../src/billing/moyasar.js';
import { parsePricing, priceFor } from '../src/billing/pricing.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import type { Mail, Mailer } from '../src/login/mailer.js';
import { ADMIN_URL, API_URL, CLIENT, OTHER_CLIENT, OWNER, staff, viewer } from './helpers.js';
import pgLib from 'pg';

const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL ?? 'postgres://talos_jobs:talos_jobs_dev@localhost:5432/talos_test';
const PRICES = JSON.stringify({ vat: 'excluded', founding_offer: true, tiers: [{ monthly: '100', yearly: '1000' }, { monthly: '200', yearly: '2000' }, { monthly: '300', yearly: '3000.50' }] });
// Made-up prices: Talos's real prices never go in this public repository.
const SECRET = 'whsec_test_0123456789abcdefghij';
const owner = { 'x-client-id': CLIENT, 'x-user-id': OWNER };
const DAY = 86_400_000;

class FakeMailer implements Mailer {
  sent: Mail[] = [];
  async send(m: Mail) {
    this.sent.push(m);
  }
  take() {
    const s = this.sent;
    this.sent = [];
    return s;
  }
}

let app: FastifyInstance;
let pool: pg.Pool;
let worker: pg.Pool;
let admin: pg.Pool;
const gateway = new FakeGateway();
const mailer = new FakeMailer();
let clock = new Date();
let deps: BillingDeps;

const config = loadConfig({
  NODE_ENV: 'test', DATABASE_URL: API_URL, AUTH_MODE: 'dev', PAYMENT_DRIVER: 'fake', PRICING_JSON: PRICES,
  MOYASAR_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.talos.test',
});

const inject = (method: 'GET' | 'POST', url: string, payload?: object, headers: Record<string, string> = owner) =>
  app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
const client = async (id = CLIENT) => (await admin.query(`SELECT * FROM app.clients WHERE id = $1`, [id])).rows[0];
const charges = async (id = CLIENT) =>
  (await admin.query(`SELECT * FROM app.billing_charges WHERE client_id = $1 ORDER BY created_at, finished_at NULLS LAST`, [id])).rows;
const block = async (id = CLIENT) => (await admin.query(`SELECT app.client_messaging_block($1) AS b`, [id])).rows[0].b;
const setClient = (sql: string, id = CLIENT) =>
  admin.query(`UPDATE app.clients SET ${sql} WHERE id = $1`, [id]);

/** Adds a card the way the browser does: token at the provider, saved, then confirmed. */
async function addCard(number = '4201320111111010', headers = owner) {
  const { id } = FakeGateway.tokenFor(number, 12, 2030);
  const saved = await inject('POST', '/api/billing/cards', { token: id }, headers);
  expect(saved.statusCode).toBe(201);
  const res = await inject('POST', '/api/billing/cards/confirm', { token: id }, headers);
  return { token: id, res };
}

beforeAll(async () => {
  pool = createPool(API_URL);
  worker = createPool(WORKER_URL);
  admin = new pgLib.Pool({ connectionString: ADMIN_URL });
  await admin.query(
    `INSERT INTO app.clients (id, legal_name, cr_number, owner_name, owner_phone, owner_email, status, authorization_signed_at)
     VALUES ($1, 'Other Billing Client', '0000000088', 'Other', '+966500000288', 'p3@test.example', 'active', now())`,
    [OTHER_CLIENT],
  );
  await admin.query(
    `INSERT INTO app.users (id, client_id, full_name, email, role)
     VALUES ('cccccccc-cccc-4ccc-8ccc-000000000001', $1, 'Other Owner', 'p3@test.example', 'owner'),
            ('22222222-2222-4222-8222-0000000000ee', $2, 'Viewer', 'viewer3@demo.example', 'viewer')`,
    [OTHER_CLIENT, CLIENT],
  );
  app = buildApp(config, pool, { workerPool: worker, gateway, mailer, now: () => clock, pricing: parsePricing(PRICES) });
  await app.ready();
  deps = { pool, workerPool: worker, config, gateway, pricing: parsePricing(PRICES), mailer, now: () => clock };
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
  await worker?.end();
  await admin?.end();
});
beforeEach(() => {
  clock = new Date();
  mailer.take();
});

describe('prices', () => {
  it('adds the tax in halalas, or takes it out of a price that includes it, never as a float', () => {
    const p = parsePricing(PRICES);
    expect(priceFor(p, 'legal', 'monthly')).toEqual({ amount: '230.00', vat: '30.00', net: '200.00' });
    expect(priceFor(p, 'najiz', 'yearly')).toEqual({ amount: '3450.58', vat: '450.08', net: '3000.50' });
    const inc = parsePricing(PRICES.replace('excluded', 'included'));
    expect(priceFor(inc, 'legal', 'monthly')).toEqual({ amount: '200.00', vat: '26.09', net: '173.91' });
    expect(() => parsePricing(PRICES.replace('"100"', '"1,00"'))).toThrow(/plan 1/);
    expect(() => parsePricing(PRICES.replace('"100"', '"0"'))).toThrow(/zero/);
  });
});

describe('settings', () => {
  const base = { NODE_ENV: 'development', DATABASE_URL: API_URL, PRICING_JSON: PRICES, MOYASAR_WEBHOOK_SECRET: SECRET };
  it('real cards are charged only in production, with live keys; test keys only outside it', () => {
    expect(() => loadConfig({ ...base, PAYMENT_DRIVER: 'moyasar', MOYASAR_SECRET_KEY: 'sk_live_x', MOYASAR_PUBLISHABLE_KEY: 'pk_live_x' })).toThrow(/test keys/);
    expect(loadConfig({ ...base, PAYMENT_DRIVER: 'moyasar', MOYASAR_SECRET_KEY: 'sk_test_x', MOYASAR_PUBLISHABLE_KEY: 'pk_test_x' }).PAYMENT_DRIVER).toBe('moyasar');
    const prod = {
      ...base, NODE_ENV: 'production', AUTH_MODE: 'session', APP_URL: 'https://app.test', MAIL_DRIVER: 'smtp', SMTP_URL: 'smtp://x',
      STORAGE_DRIVER: 'gcs', GCS_BUCKET: 'b',
    };
    expect(() => loadConfig({ ...prod, PAYMENT_DRIVER: 'moyasar', MOYASAR_SECRET_KEY: 'sk_test_x', MOYASAR_PUBLISHABLE_KEY: 'pk_test_x' })).toThrow(/live keys/);
    expect(() => loadConfig({ ...prod, PAYMENT_DRIVER: 'fake' })).toThrow(/fake/);
    expect(() => loadConfig({ ...base, PAYMENT_DRIVER: 'fake', PRICING_JSON: undefined })).toThrow(/PRICING_FILE/);
    expect(() => loadConfig({ ...base, PAYMENT_DRIVER: 'moyasar', MOYASAR_SECRET_KEY: 'sk_test_x' })).toThrow(/MOYASAR_PUBLISHABLE_KEY/);
  });
});

describe('the billing page', () => {
  it('shows the plan, the price and what the browser needs, never a token, and only to owners and admins', async () => {
    await setClient(`billing_status = 'trial', trial_ends_at = now() + interval '10 days', founding_member = false, paid_until = NULL`);
    const res = await inject('GET', '/api/billing');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: 'legal', billing_status: 'trial', card: null, charges: [], can_pay: false,
      price: { amount: '230.00', vat: '30.00' },
      gateway: { provider: 'fake', publishable_key: 'pk_fake', callback_url: 'https://app.talos.test/settings/billing?card=return', metadata: { client_id: CLIENT } },
    });
    expect((await inject('GET', '/api/billing', undefined, staff)).statusCode).toBe(403);
    expect((await inject('GET', '/api/billing', undefined, viewer)).statusCode).toBe(403);
    expect((await inject('POST', '/api/billing/cards', { token: 'token_fake_visa_1111_paid_1230_aaaaaaaaaaaa' }, staff)).statusCode).toBe(403);
  });

  it('the stand-in card form takes only test cards (development)', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/billing/fake/tokens', payload: { name: 'A B', number: '4000000000000002', month: 1, year: 30, cvc: '123', callback_url: 'https://app.talos.test/x' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/billing/fake/tokens', payload: { name: 'A B', number: '4111111111111111', month: 1, year: 30, cvc: '123', callback_url: 'https://app.talos.test/x' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().verification_url).toContain(`id=${ok.json().id}`);
  });
});

describe('adding a card during the trial', () => {
  it('waits for the bank, then saves only the card type, last four digits and expiry; nothing is charged yet', async () => {
    const { id } = FakeGateway.tokenFor('4201320111111010', 12, 2030);
    gateway.unconfirmed.add(id);
    await inject('POST', '/api/billing/cards', { token: id });
    const waiting = await inject('POST', '/api/billing/cards/confirm', { token: id });
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json().error).toBe('card_not_confirmed');
    gateway.unconfirmed.delete(id);

    const res = await inject('POST', '/api/billing/cards/confirm', {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ card: { brand: 'mada', last_four: '1010', exp_month: 12, exp_year: 2030 } });
    expect(await charges()).toHaveLength(0);
    const page = await inject('GET', '/api/billing');
    expect(page.json().card).toMatchObject({ brand: 'mada', last_four: '1010' });
    expect(page.body).not.toContain('token_');
    // The audit log never holds the token.
    const log = await admin.query(`SELECT details::text AS d FROM audit.activity_log WHERE action = 'billing.card_added'`);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].d).not.toContain('token_');
  });

  it('a newer card replaces the old one, which the provider is asked to forget', async () => {
    const before = (await admin.query(`SELECT token FROM app.billing_cards WHERE client_id = $1 AND status = 'active'`, [CLIENT])).rows[0].token;
    const { res } = await addCard('4111111111111111');
    expect(res.json().card).toMatchObject({ brand: 'visa', last_four: '1111' });
    expect(gateway.deleted.has(before)).toBe(true);
    const cards = (await admin.query(`SELECT status FROM app.billing_cards WHERE client_id = $1 ORDER BY created_at`, [CLIENT])).rows;
    expect(cards.map((c) => c.status)).toEqual(['removed', 'active']);
  });

  it('a card the bank refused is not kept', async () => {
    const { id } = FakeGateway.tokenFor('4111111111111111', 1, 2031);
    await gateway.deleteToken(id); // the provider says inactive
    await inject('POST', '/api/billing/cards', { token: id });
    const res = await inject('POST', '/api/billing/cards/confirm', { token: id });
    expect(res.statusCode).toBe(422);
    expect((await admin.query(`SELECT status FROM app.billing_cards WHERE token = $1`, [id])).rows[0].status).toBe('failed');
  });
});

describe('when the trial ends', () => {
  it('the card is charged the plan price with tax, the period starts at the end of the trial, and the owner gets a receipt', async () => {
    await setClient(`trial_ends_at = now() - interval '1 hour'`);
    const trialEnd = (await client()).trial_ends_at as Date;
    const round = await runBilling(deps);
    expect(round.charged).toBe(1);
    const [ch] = await charges();
    expect(ch).toMatchObject({ status: 'paid', reason: 'trial_end', amount: '230.00', vat_amount: '30.00', plan: 'legal', billing_period: 'monthly' });
    expect(ch.period_start.getTime()).toBe(trialEnd.getTime());
    // Sent with our charge id as the provider's idempotency key, and the amount in halalas.
    const sent = gateway.charges.at(-1)!;
    expect(sent).toMatchObject({ givenId: ch.id, amount: 23000n, metadata: { client_id: CLIENT, charge_id: ch.id } });
    const c = await client();
    expect(c).toMatchObject({ billing_status: 'active', next_charge_at: null });
    expect(c.paid_until.getTime()).toBe(ch.period_end.getTime());
    expect(await block()).toBeNull();
    const mail = mailer.take();
    expect(mail.map((m) => m.to)).toEqual(['owner@demo.example']);
    expect(mail[0]!.subject).toContain('Payment received: SAR 230.00');
    expect(mail[0]!.subject).toContain('230.00 ريال');
    const note = (await admin.query(`SELECT data FROM app.notifications WHERE client_id = $1 AND data->>'event' = 'billing_paid'`, [CLIENT])).rows;
    expect(note).toHaveLength(1);
    // Nothing more is due: a second round charges nothing.
    expect((await runBilling(deps)).charged).toBe(0);
  });
});

describe('when a payment fails', () => {
  let token: string;
  it('Talos stops at once, Najiz filing too, and the owner is told when the card is tried again', async () => {
    token = (await admin.query(`SELECT token FROM app.billing_cards WHERE client_id = $1 AND status = 'active'`, [CLIENT])).rows[0].token;
    gateway.next.set(token, 'insufficient');
    await setClient(`paid_until = now() - interval '1 hour'`);
    await runBilling(deps);
    const last = (await charges()).at(-1);
    expect(last).toMatchObject({ status: 'failed', reason: 'renewal', failure_code: 'declined', failure_message: 'Insufficient Funds' });
    const c = await client();
    expect(c.billing_status).toBe('unpaid');
    expect(c.next_charge_at.getTime()).toBe(clock.getTime() + DAY);
    expect(await block()).toBe('payment_needed');
    const najiz = await inject('POST', '/api/najiz/runs', { debt_ids: ['66666666-6666-4666-8666-000000000003'] });
    expect(najiz.statusCode).toBe(402);
    expect(najiz.json().error).toBe('payment_needed');
    const mail = mailer.take();
    expect(mail[0]!.subject).toContain('Your payment did not go through');
    expect(mail[0]!.text).toContain('Insufficient Funds');
  });

  it('is tried again after 1 day, then 2 more days, then no more on its own', async () => {
    // Not before its time.
    expect((await runBilling(deps)).charged).toBe(0);
    gateway.next.set(token, 'declined');
    await setClient(`next_charge_at = now() - interval '1 minute'`); // a day later
    await runBilling(deps);
    let c = await client();
    expect((await charges()).at(-1)).toMatchObject({ status: 'failed', reason: 'retry' });
    expect(c.next_charge_at.getTime()).toBe(clock.getTime() + 2 * DAY);

    gateway.next.set(token, 'declined');
    await setClient(`next_charge_at = now() - interval '1 minute'`); // 2 days later
    await runBilling(deps);
    c = await client();
    expect(c.next_charge_at).toBeNull();
    expect(await runBilling(deps)).toMatchObject({ charged: 0 });
  });

  it('staff can pay at once; the new period starts on the day of payment', async () => {
    expect((await inject('POST', '/api/billing/pay', undefined, staff)).statusCode).toBe(403);
    const res = await inject('POST', '/api/billing/pay');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ payment: 'paid' });
    const last = (await charges()).at(-1);
    expect(last).toMatchObject({ status: 'paid', reason: 'pay_now', requested_by: OWNER });
    expect(Math.abs(last.period_start.getTime() - clock.getTime())).toBeLessThan(1000);
    expect((await client()).billing_status).toBe('active');
    expect(await block()).toBeNull();
    // Nothing is due any more.
    expect((await inject('POST', '/api/billing/pay')).json().error).toBe('nothing_due');
  });
});

describe('a charge stopped half way', () => {
  it('is never taken twice: it is sent again later with the same id', async () => {
    const token = (await admin.query(`SELECT token FROM app.billing_cards WHERE client_id = $1 AND status = 'active'`, [CLIENT])).rows[0].token;
    await setClient(`paid_until = now() - interval '1 hour'`);
    gateway.next.set(token, 'down');
    const first = await chargeClient(deps, CLIENT, 'renewal');
    expect(first.status).toBe('pending');
    const sending = (await charges()).at(-1);
    expect(sending.status).toBe('sending');
    // Nobody can start a second charge meanwhile.
    expect(await chargeClient(deps, CLIENT, 'renewal')).toEqual({ status: 'busy' });
    expect((await runBilling(deps)).recovered).toBe(0); // too recent to touch

    await admin.query(`UPDATE app.billing_charges SET created_at = created_at - interval '3 minutes' WHERE id = $1`, [sending.id]);
    const round = await runBilling(deps);
    expect(round.recovered).toBe(1);
    expect((await charges()).find((c) => c.id === sending.id)).toMatchObject({ status: 'paid' });
    const sentWithId = gateway.charges.filter((c) => c.givenId === sending.id);
    expect(sentWithId).toHaveLength(2);
    expect([...gateway.payments.values()].filter((p) => p.givenId === sending.id)).toHaveLength(1);
  });
});

describe('cancelling', () => {
  it('keeps the service to the end of the period, then stops it without charging; paying again starts it again', async () => {
    expect((await inject('POST', '/api/billing/cancel', { cancel: true }, staff)).statusCode).toBe(403);
    const res = await inject('POST', '/api/billing/cancel', { cancel: true });
    expect(res.statusCode).toBe(200);
    expect(mailer.take()[0]!.subject).toContain('Your subscription is cancelled');
    expect(await block()).toBeNull();
    // Undo, then cancel again.
    expect((await inject('POST', '/api/billing/cancel', { cancel: false })).json().cancel_at_period_end).toBe(false);
    await inject('POST', '/api/billing/cancel', { cancel: true });
    mailer.take();

    const before = (await charges()).length;
    await setClient(`paid_until = now() - interval '1 minute'`);
    expect(await block()).toBe('subscription_ended');
    await runBilling(deps);
    expect((await charges()).length).toBe(before);
    const c = await client();
    expect(c.billing_status).toBe('cancelled');
    expect(mailer.take()[0]!.subject).toContain('Your subscription has ended');
    expect((await inject('POST', '/api/billing/cancel', { cancel: false })).statusCode).toBe(409);

    const again = await inject('POST', '/api/billing/pay');
    expect(again.json()).toEqual({ payment: 'paid' });
    expect(await client()).toMatchObject({ billing_status: 'active', cancel_at_period_end: false, cancelled_at: null });
  });
});

describe('notices and the founding month', () => {
  it('a trial ending in 3 days with no card gets one notice; the end gets another; founding members get a month more', async () => {
    await setClient(`billing_status = 'trial', trial_ends_at = now() + interval '2 days', founding_member = false, paid_until = NULL`, OTHER_CLIENT);
    await runBilling(deps);
    await runBilling(deps);
    let mail = mailer.take().filter((m) => m.to === 'p3@test.example');
    expect(mail.map((m) => m.subject.split(' | ')[1])).toEqual([expect.stringMatching(/^Your free trial ends on /)]);

    // A founding member's trial that just ended still has its free month: nothing yet.
    await setClient(`trial_ends_at = now() - interval '1 hour', founding_member = true`, OTHER_CLIENT);
    await runBilling(deps);
    expect(mailer.take()).toHaveLength(0);
    expect(await block(OTHER_CLIENT)).toBeNull();

    await setClient(`founding_member = false`, OTHER_CLIENT);
    await runBilling(deps);
    await runBilling(deps);
    mail = mailer.take();
    expect(mail.map((m) => m.subject.split(' | ')[1])).toEqual(['Your free trial has ended']);
    expect(await block(OTHER_CLIENT)).toBe('trial_ended');
  });

  it('a yearly plan gets a notice 7 days before it renews, once', async () => {
    await admin.query(`UPDATE app.clients SET billing_period = 'yearly', paid_until = now() + interval '5 days', cancel_at_period_end = false WHERE id = $1`, [CLIENT]);
    await runBilling(deps);
    await runBilling(deps);
    const mail = mailer.take().filter((m) => m.to === 'owner@demo.example');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toMatch(/Your yearly plan renews on /);
    expect(mail[0]!.text).toContain('2,300.00'); // the Legal plan's 2,000 a year, with 15% tax
  });
});

describe("the provider's webhook", () => {
  const event = (over: object = {}) => ({ id: `evt_${Math.random().toString(16).slice(2)}`, type: 'payment_paid', secret_token: SECRET, live: false, ...over });

  it('is refused without the secret', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhooks/moyasar', payload: event({ secret_token: 'nope' }) });
    expect(res.statusCode).toBe(401);
  });

  it('finishes a charge left half way, after asking the provider, and ignores the same event twice', async () => {
    await setClient(`billing_period = 'monthly', paid_until = now() - interval '1 hour'`);
    const token = (await admin.query(`SELECT token FROM app.billing_cards WHERE client_id = $1 AND status = 'active'`, [CLIENT])).rows[0].token;
    gateway.next.set(token, 'down');
    await chargeClient(deps, CLIENT, 'renewal');
    const row = (await charges()).at(-1);
    expect(row.status).toBe('sending');
    // Meanwhile the provider did take it (the answer was lost on the way back).
    const paid = await gateway.charge({ givenId: row.id, token, amount: 23000n, description: 'x', callbackUrl: 'x', metadata: { charge_id: row.id } });
    const ev = event({ data: { id: paid.id, metadata: { charge_id: row.id, client_id: CLIENT } } });
    const res = await app.inject({ method: 'POST', url: '/webhooks/moyasar', payload: ev });
    expect(res.json()).toEqual({ received: 1 });
    expect((await charges()).at(-1)).toMatchObject({ id: row.id, status: 'paid', gateway_payment_id: paid.id });
    expect((await client()).billing_status).toBe('active');
    expect((await app.inject({ method: 'POST', url: '/webhooks/moyasar', payload: ev })).json()).toEqual({ received: 0 });
    const stored = (await admin.query(`SELECT payload::text AS p FROM app.webhook_events WHERE provider = 'payment_gateway'`)).rows;
    expect(stored[0].p).not.toContain(SECRET);
  });

  it('confirms a new webhook with the code the provider sends to it', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhooks/moyasar', payload: event({ type: 'webhook_verification', data: { id: 'wh_1', verification_code: '482913' } }) });
    expect(res.json()).toEqual({ received: 1 });
    expect(gateway.verified).toEqual([{ webhookId: 'wh_1', code: '482913' }]);
  });

  it('ignores live events outside production, and payments that are not ours', async () => {
    expect((await app.inject({ method: 'POST', url: '/webhooks/moyasar', payload: event({ live: true }) })).json()).toEqual({ ignored: 'mode' });
    await app.inject({ method: 'POST', url: '/webhooks/moyasar', payload: event({ id: 'evt_x1', data: { id: 'pay_x', metadata: { charge_id: '00000000-0000-4000-8000-000000000000' } } }) });
    const ev = (await admin.query(`SELECT error FROM app.webhook_events WHERE event_id = 'moyasar:evt_x1'`)).rows[0];
    expect(ev.error).toBe('not_ours');
  });
});

describe('tenant isolation', () => {
  it("another company sees none of this company's cards or payments", async () => {
    const res = await inject('GET', '/api/billing', undefined, { 'x-client-id': OTHER_CLIENT, 'x-user-id': 'cccccccc-cccc-4ccc-8ccc-000000000001' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ card: null, charges: [] });
  });
});

describe('the Moyasar client', () => {
  let server: Server;
  let url = '';
  const seen: { method: string; path: string; auth: string; body: string }[] = [];
  let answer: { status: number; body: unknown } = { status: 201, body: {} };
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method!, path: req.url!, auth: req.headers.authorization ?? '', body });
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => server.close());
  const mk = () => new MoyasarGateway({ secretKey: 'sk_test_abc', publishableKey: 'pk_test_abc', apiUrl: url, timeoutMs: 2000 });

  it('charges a token with the secret key, our id as given_id and the amount in halalas', async () => {
    answer = { status: 201, body: { id: 'pay_1', status: 'paid', amount: 12345, currency: 'SAR', metadata: { charge_id: 'c1' } } };
    const p = await mk().charge({ givenId: 'c1', token: 'token_abcdefgh', amount: 12345n, description: 'd', callbackUrl: 'https://a.test/b', metadata: { charge_id: 'c1' } });
    expect(p).toMatchObject({ id: 'pay_1', status: 'paid', amount: 12345n });
    const req = seen.at(-1)!;
    expect(req).toMatchObject({ method: 'POST', path: '/v1/payments', auth: `Basic ${Buffer.from('sk_test_abc:').toString('base64')}` });
    expect(JSON.parse(req.body)).toEqual({
      given_id: 'c1', amount: 12345, currency: 'SAR', description: 'd', callback_url: 'https://a.test/b',
      metadata: { charge_id: 'c1' }, source: { type: 'token', token: 'token_abcdefgh' },
    });
  });

  it('a declined card is a failed payment with the bank’s words; a refused request and an outage are told apart', async () => {
    answer = { status: 201, body: { id: 'pay_2', status: 'failed', amount: 100, currency: 'SAR', source: { message: 'Insufficient Funds' } } };
    expect(await mk().charge({ givenId: 'c2', token: 'token_abcdefgh', amount: 100n, description: 'd', callbackUrl: 'x', metadata: {} })).toMatchObject({ status: 'failed', message: 'Insufficient Funds' });
    answer = { status: 400, body: { type: 'invalid_request_error', message: 'Token is inactive' } };
    await expect(mk().charge({ givenId: 'c3', token: 'token_abcdefgh', amount: 100n, description: 'd', callbackUrl: 'x', metadata: {} })).rejects.toBeInstanceOf(GatewayRefused);
    answer = { status: 502, body: {} };
    await expect(mk().fetchPayment('pay_2')).rejects.toBeInstanceOf(GatewayUnavailable);
    const down = new MoyasarGateway({ secretKey: 'sk_test_abc', publishableKey: 'pk_test_abc', apiUrl: 'http://127.0.0.1:9/v1', timeoutMs: 500 });
    await expect(down.fetchToken('token_abcdefgh')).rejects.toBeInstanceOf(GatewayUnavailable);
  });

  it('reads a token: status, brand, last four digits and a two-digit year', async () => {
    answer = { status: 200, body: { id: 'token_abcdefgh', status: 'active', brand: 'Mada', last_four: '1010', month: '12', year: '30', metadata: { client_id: CLIENT } } };
    expect(await mk().fetchToken('token_abcdefgh')).toEqual({ id: 'token_abcdefgh', status: 'active', brand: 'mada', lastFour: '1010', month: 12, year: 2030, metadata: { client_id: CLIENT } });
    answer = { status: 404, body: {} };
    expect(await mk().fetchToken('token_zzzzzzzz')).toBeNull();
    expect(mk().browser).toEqual({ provider: 'moyasar', publishableKey: 'pk_test_abc', tokensUrl: `${url}/tokens` });
  });
});
