/**
 * The first run against Moyasar's sandbox (step 7.6b), with test keys only.
 * Does not touch the database, and no real card is ever charged.
 *
 *   npm run moyasar:sandbox
 *   npm run moyasar:sandbox -- --webhook https://<the API's address>/webhooks/moyasar
 *
 * Reads from .env: MOYASAR_SECRET_KEY and MOYASAR_PUBLISHABLE_KEY (sk_test_, pk_test_),
 * MOYASAR_API_URL, APP_URL, and MOYASAR_WEBHOOK_SECRET for --webhook.
 *
 *   1. Checks both keys.
 *   2. Saves Moyasar's test Visa card as the browser would, and asks you to open
 *      the test bank page it gives (3D Secure), then press Enter.
 *   3. Charges the saved card 1 riyal, twice with the same id: the second time
 *      must give back the same payment (never charged twice).
 *   4. Forgets the card.
 *   5. With --webhook: adds the webhook for payment_paid and payment_failed. The API
 *      must be running at that address, so it can confirm the webhook with the
 *      code Moyasar sends to it.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { MoyasarGateway } from '../src/billing/moyasar.js';

const env = process.env;
const api = (env.MOYASAR_API_URL ?? 'https://api.moyasar.com/v1').replace(/\/+$/, '');
const sk = env.MOYASAR_SECRET_KEY ?? '';
const pk = env.MOYASAR_PUBLISHABLE_KEY ?? '';
const appUrl = (env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const hookAt = process.argv.indexOf('--webhook');
const webhookUrl = hookAt > 0 ? process.argv[hookAt + 1] : undefined;

const fail = (msg: string): never => {
  console.error(`\nStopped: ${msg}`);
  process.exit(1);
};
const ok = (msg: string) => console.log(`  ok   ${msg}`);

if (!sk.startsWith('sk_test_') || !pk.startsWith('pk_test_')) {
  fail('put Moyasar TEST keys in api/.env (MOYASAR_SECRET_KEY=sk_test_..., MOYASAR_PUBLISHABLE_KEY=pk_test_...). Live keys are never used here.');
}
if (webhookUrl && !/^https:\/\//.test(webhookUrl)) fail('the webhook address must start with https://');
if (webhookUrl && (env.MOYASAR_WEBHOOK_SECRET ?? '').length < 24) fail('set MOYASAR_WEBHOOK_SECRET (at least 24 characters) in api/.env first');

const basic = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
async function call(method: string, path: string, key: string, body?: object) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { authorization: basic(key), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch((err: Error) => fail(`Moyasar could not be reached (${err.name}). Check the internet connection.`));
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* not JSON */
  }
  return { status: res.status, data };
}

const gateway = new MoyasarGateway({ secretKey: sk, publishableKey: pk, apiUrl: api });
console.log('Moyasar sandbox run (test keys, no real money)\n');

// 1. Keys
const list = await call('GET', '/payments', sk);
if (list.status === 401) fail('the secret key was refused. Copy it again from Moyasar\'s dashboard (Settings, API keys, test mode).');
if (list.status !== 200) fail(`checking the secret key answered ${list.status}: ${JSON.stringify(list.data).slice(0, 200)}`);
ok('the secret key works');

// 2. A saved card, made the way the browser makes it (publishable key).
const tok = await call('POST', '/tokens', pk, {
  name: 'Talos Sandbox',
  number: '4111111111111111',
  month: '12',
  year: '30',
  cvc: '123',
  callback_url: `${appUrl}/settings/billing?card=return`,
  metadata: { client_id: 'sandbox' },
});
if (tok.status === 401) fail('the publishable key was refused. Copy it again from Moyasar\'s dashboard.');
const tokenId = String(tok.data.id ?? '');
const verify = String(tok.data.verification_url ?? '');
if (!tokenId.startsWith('token_') || !verify) fail(`saving the test card answered ${tok.status}: ${JSON.stringify(tok.data).slice(0, 300)}`);
ok(`the publishable key works, and the test card was sent for confirmation (${tokenId.slice(0, 12)}...)`);

console.log(`\n  Open this link, finish the test bank page, then come back here:\n  ${verify}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question('  Press Enter when the bank page is done... ');
rl.close();

const token = await gateway.fetchToken(tokenId);
if (!token) fail('Moyasar does not know the card');
if (token!.status !== 'active') fail(`the card is "${token!.status}", not active. Open the link again and finish the bank page, then run this again.`);
ok(`the card is confirmed: ${token!.brand} ending in ${token!.lastFour}, ${token!.month}/${token!.year}`);

// 3. Charge it 1 riyal, twice with the same id.
const givenId = randomUUID();
const req = {
  givenId,
  token: tokenId,
  amount: 100n,
  description: 'Talos sandbox check',
  callbackUrl: `${appUrl}/settings/billing`,
  metadata: { charge_id: givenId, client_id: 'sandbox' },
};
const first = await gateway.charge(req);
if (first.status !== 'paid') fail(`the charge is "${first.status}" (${first.message ?? 'no reason given'})`);
if (first.amount !== 100n || first.currency !== 'SAR') fail(`the charge came back as ${first.amount} ${first.currency}, not 100 halalas in SAR`);
ok(`1 riyal charged without asking the cardholder again (${first.id})`);
const again = await gateway.charge(req);
if (again.id !== first.id) fail(`charging again with the same id made a second payment (${again.id}). Ask Moyasar about given_id.`);
ok('the same id gives back the same payment: a charge is never taken twice');
const read = await gateway.fetchPayment(first.id);
if (read?.status !== 'paid' || read.metadata.charge_id !== givenId) fail('reading the payment back did not match');
ok('the payment reads back as paid, with our charge id');

// 4. Forget the card.
await gateway.deleteToken(tokenId);
ok('the card was forgotten');

// 5. The webhook.
if (webhookUrl) {
  const hook = await call('POST', '/webhooks', sk, {
    http_method: 'post',
    url: webhookUrl,
    shared_secret: env.MOYASAR_WEBHOOK_SECRET,
    events: ['payment_paid', 'payment_failed', 'payment_refunded'],
  });
  if (hook.status !== 200 && hook.status !== 201) fail(`adding the webhook answered ${hook.status}: ${JSON.stringify(hook.data).slice(0, 300)}`);
  ok(`webhook added (${String(hook.data.id)}), verified: ${String(hook.data.verified)}`);
  if (hook.data.verified === false) {
    console.log('  Moyasar sends a code to the webhook; the API confirms it on its own. If it was not running, ask Moyasar for a new code.');
  }
}

console.log('\nAll sandbox checks passed. Send Claude this output (it holds no keys).');
