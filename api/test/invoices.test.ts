/**
 * Talos's tax invoices (step 7.8): every paid subscription charge gets a
 * standard tax invoice in ZATCA's XML, in one unbroken chain (counter and
 * previous hash), cleared by ZATCA (a fake here; tests never call ZATCA)
 * before the client gets it. A refund gets a credit note. A company needs its
 * national address first; a refused invoice is never given out.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import type pg from 'pg';
import pgLib from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { C14nCanonicalization } from 'xml-crypto';
import { buildApp } from '../src/app.js';
import { chargeClient, type BillingDeps } from '../src/billing/billing.js';
import { FakeGateway } from '../src/billing/gateway.js';
import { invoiceHtml } from '../src/billing/invoice-pdf.js';
import { creditRefund, invoiceCharge, retryMinutes, runInvoices, saudiTime } from '../src/billing/invoices.js';
import { parsePricing, priceFor, splitTotal, vatOn } from '../src/billing/pricing.js';
import { FakeZatca, FatooraClient, ZatcaUnavailable } from '../src/billing/zatca/client.js';
import { basicQr, decodeTlv, encodeTlv, qrFromXml } from '../src/billing/zatca/qr.js';
import { checkDocument, documentXml, FIRST_PIH, invoiceHash, type TaxDocument } from '../src/billing/zatca/xml.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import type { PdfRenderer } from '../src/legal/pdf.js';
import type { Mail, Mailer } from '../src/login/mailer.js';
import { ADMIN_URL, API_URL, CLIENT, OTHER_CLIENT, OTHER_USER, OWNER, viewer } from './helpers.js';

const WORKER_URL = process.env.TEST_WORKER_DATABASE_URL ?? 'postgres://talos_jobs:talos_jobs_dev@localhost:5432/talos_test';
// Made-up prices and a made-up seller: real ones never go in this public repository.
const PRICES = JSON.stringify({ vat: 'excluded', founding_offer: true, tiers: [{ monthly: '100', yearly: '1000' }, { monthly: '200', yearly: '2000' }, { monthly: '300', yearly: '3000.50' }] });
const SELLER = {
  SELLER_NAME: 'Test Seller & Sons', SELLER_VAT_NUMBER: '300000000000003', SELLER_CR: '1010000000',
  SELLER_BUILDING: '1234', SELLER_STREET: 'Test Street', SELLER_DISTRICT: 'Test District', SELLER_CITY: 'Jeddah', SELLER_POSTAL: '23456',
};
const SECRET = 'whsec_test_0123456789abcdefghij';
const owner = { 'x-client-id': CLIENT, 'x-user-id': OWNER };
const otherOwner = { 'x-client-id': OTHER_CLIENT, 'x-user-id': OTHER_USER };
const ADDRESS = { address_building: '7788', address_street: 'شارع الأمير سلطان', address_district: 'الروضة', address_city: 'جدة', address_postal: '23435' };

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

/** A real PDF without a browser: the layout is checked through the HTML. */
class TinyPdf implements PdfRenderer {
  html: string[] = [];
  async htmlToPdf(html: string) {
    this.html.push(html);
    const d = await PDFDocument.create();
    d.addPage();
    return Buffer.from(await d.save());
  }
  async close() {}
}

let app: FastifyInstance;
let pool: pg.Pool;
let worker: pg.Pool;
let admin: pg.Pool;
const gateway = new FakeGateway();
const zatca = new FakeZatca();
const mailer = new FakeMailer();
const pdf = new TinyPdf();
let clock = new Date();
let deps: BillingDeps;

const config = loadConfig({
  NODE_ENV: 'test', DATABASE_URL: API_URL, AUTH_MODE: 'dev', PAYMENT_DRIVER: 'fake', PRICING_JSON: PRICES,
  MOYASAR_WEBHOOK_SECRET: SECRET, APP_URL: 'https://app.talos.test', ZATCA_MODE: 'fake', ...SELLER,
});

const inject = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, headers: Record<string, string> = owner) =>
  app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
const invoices = async (id = CLIENT) =>
  (await admin.query(`SELECT * FROM app.invoices WHERE client_id = $1 ORDER BY icv`, [id])).rows;
const allInvoices = async () => (await admin.query(`SELECT * FROM app.invoices ORDER BY icv`)).rows;
const events = async (event: string, id = CLIENT) =>
  (await admin.query(`SELECT data FROM app.notifications WHERE client_id = $1 AND data->>'event' = $2`, [id, event])).rows;

async function addCard(headers = owner) {
  const { id } = FakeGateway.tokenFor('4201320111111010', 12, 2030);
  const saved = await inject('POST', '/api/billing/cards', { token: id }, headers);
  if (saved.statusCode !== 201) return saved;
  return inject('POST', '/api/billing/cards/confirm', { token: id }, headers);
}

/** Ends the company's trial and charges its card, as the scheduler does. */
async function pay(clientId = CLIENT) {
  await admin.query(
    `UPDATE app.clients SET billing_status = 'trial', trial_ends_at = now() - interval '40 days', founding_member = false,
            paid_until = NULL, next_charge_at = NULL, cancel_at_period_end = false, cancelled_at = NULL WHERE id = $1`,
    [clientId],
  );
  const out = await chargeClient(deps, clientId, 'trial_end');
  expect(out.status).toBe('paid');
  return (out as { chargeId: string }).chargeId;
}

const doc = (over: Partial<TaxDocument> = {}): TaxDocument => ({
  kind: 'invoice', number: 'TLS-000001', uuid: '6f4d20e0-6bfe-4a80-9389-7dabe6620f12', icv: '1', pih: FIRST_PIH,
  issueDate: '2026-11-27', issueTime: '10:00:00', supplyStart: '2026-11-27', supplyEnd: '2026-12-26',
  seller: { name: 'Test Seller & Sons', vat: '300000000000003', crn: '1010000000', building: '1234', street: 'Test <Street>', district: 'D', city: 'Jeddah', postal: '23456' },
  buyer: { name: 'مؤسسة تجريبية', vat: null, crn: '0000000001', building: '7788', street: 'S', district: 'D', city: 'جدة', postal: '23435' },
  itemName: 'Subscription', net: '200.00', vat: '30.00', total: '230.00', ...over,
});

beforeAll(async () => {
  pool = createPool(API_URL);
  worker = createPool(WORKER_URL);
  admin = new pgLib.Pool({ connectionString: ADMIN_URL });
  await admin.query(
    `INSERT INTO app.clients (id, legal_name, cr_number, owner_name, owner_phone, owner_email, status, authorization_signed_at, plan)
     VALUES ($1, 'Other Invoice Client', '0000000077', 'Other', '+966500000277', 'p4@test.example', 'active', now(), 'najiz')`,
    [OTHER_CLIENT],
  );
  await admin.query(
    `INSERT INTO app.users (id, client_id, full_name, email, role)
     VALUES ($1, $2, 'Other Owner', 'p4@test.example', 'owner'), ('22222222-2222-4222-8222-0000000000ee', $3, 'Viewer', 'viewer4@demo.example', 'viewer')`,
    [OTHER_USER, OTHER_CLIENT, CLIENT],
  );
  app = buildApp(config, pool, { workerPool: worker, gateway, mailer, zatca, pdf, now: () => clock, pricing: parsePricing(PRICES) });
  await app.ready();
  deps = { pool, workerPool: worker, config, gateway, pricing: parsePricing(PRICES), mailer, zatca, now: () => clock };
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

// ------------------------------------------------------------------ the document itself

describe('the XML', () => {
  it('is already in canonical form, so the hash is the SHA-256 of exactly its bytes', () => {
    const xml = documentXml(doc());
    const parsed = new DOMParser().parseFromString(xml, 'text/xml');
    const canonical = new C14nCanonicalization().process(parsed.documentElement as unknown as Node, {});
    expect(canonical).toBe(xml);
    expect(invoiceHash(xml)).toBe(createHash('sha256').update(xml, 'utf8').digest('base64'));
    expect(xml).toContain('Test &lt;Street&gt;');
    expect(xml).toContain('Test Seller &amp; Sons');
    // A standard tax invoice, not signed by Talos: ZATCA stamps it at clearance.
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(xml).not.toContain('UBLExtensions');
    expect(xml).not.toContain('<cac:Signature>');
    // A buyer with no VAT number has no CompanyID; its commercial registration identifies it.
    const buyer = /<cac:AccountingCustomerParty>[\s\S]*<\/cac:AccountingCustomerParty>/.exec(xml)![0];
    expect(buyer).not.toContain('CompanyID');
    expect(buyer).toContain('<cbc:ID schemeID="CRN">0000000001</cbc:ID>');
  });

  it('the hash before the first invoice is that of "0", as ZATCA says', () => {
    expect(FIRST_PIH).toBe(Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64'));
  });

  it('a credit note names the invoice it corrects and why', () => {
    const xml = documentXml(doc({ kind: 'credit_note', number: 'TLS-CN-000002', icv: '2', originalNumber: 'TLS-000001', reason: 'Refund' }));
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">381</cbc:InvoiceTypeCode>');
    expect(xml).toMatch(/<cac:BillingReference>\s*<cac:InvoiceDocumentReference>\s*<cbc:ID>TLS-000001<\/cbc:ID>/);
    expect(xml).toContain('<cbc:InstructionNote>Refund</cbc:InstructionNote>');
  });

  it('refuses what ZATCA would refuse, in plain words', () => {
    expect(checkDocument(doc())).toEqual([]);
    expect(checkDocument(doc({ vat: '29.99', total: '229.99' }))).toContain('VAT must be 15% of the net amount');
    expect(checkDocument(doc({ total: '231.00' }))).toContain('total must be net plus VAT');
    expect(checkDocument(doc({ buyer: { ...doc().buyer, building: '12', postal: '1234' } }))).toEqual([
      'buyer building number must have 4 digits', 'buyer postal code must have 5 digits',
    ]);
    expect(checkDocument(doc({ buyer: { ...doc().buyer, vat: '123' } }))).toContain('buyer VAT number must have 15 digits and start and end with 3');
    expect(checkDocument(doc({ kind: 'credit_note' }))).toContain('a credit note needs the invoice it corrects and a reason');
    expect(() => documentXml(doc({ net: '200' }))).toThrow(/net must be an amount/);
  });

  it('passes the UBL 2.1 schema (when ZATCA’s schema files are on this machine)', () => {
    const xsd = process.env.ZATCA_UBL_XSD ?? '/tmp/ext/zatca/einvoicing-sdk/Data/Schemas/xsds/UBL2.1/xsd/maindoc/UBL-Invoice-2.1.xsd';
    if (!existsSync(xsd)) return;
    const dir = mkdtempSync(path.join(tmpdir(), 'inv-'));
    for (const [name, d] of [['inv.xml', doc()], ['cn.xml', doc({ kind: 'credit_note', originalNumber: 'TLS-000001', reason: 'Refund' })]] as const) {
      writeFileSync(path.join(dir, name), documentXml(d));
      execFileSync('xmllint', ['--noout', '--schema', xsd, path.join(dir, name)], { stdio: 'pipe' });
    }
  });
});

describe('amounts', () => {
  it('the tax is 15% of the net amount in halalas; a price with tax included always splits exactly', () => {
    expect(vatOn(20000n)).toBe(3000n);
    expect(vatOn(17391n)).toBe(2609n);
    for (let total = 100n; total < 3000n; total += 7n) {
      const s = splitTotal(total);
      if (s) expect(s.net + vatOn(s.net)).toBe(total);
    }
    // No net amount makes 0.27 with its tax: the listed price is then a halala lower, and still adds up.
    const inc = parsePricing(JSON.stringify({ vat: 'included', tiers: [{ monthly: '0.27', yearly: '10' }, { monthly: '2', yearly: '20' }, { monthly: '3', yearly: '30' }] }));
    expect(splitTotal(27n)).toBeNull();
    expect(priceFor(inc, 'follow_up', 'monthly')).toEqual({ amount: '0.26', net: '0.23', vat: '0.03' });
  });
});

describe('the QR code', () => {
  it('is tag, length, value in base64, read back the same', () => {
    const qr = basicQr({ sellerName: 'تالوس', vatNumber: '300000000000003', timestamp: '2026-11-27T07:00:00Z', total: '230.00', vat: '30.00' });
    const f = decodeTlv(qr);
    expect(f.get(1)!.toString('utf8')).toBe('تالوس');
    expect([2, 3, 4, 5].map((t) => f.get(t)!.toString())).toEqual(['300000000000003', '2026-11-27T07:00:00Z', '230.00', '30.00']);
    expect(() => encodeTlv(['x'.repeat(256)])).toThrow(/255/);
    expect(qrFromXml(`<cac:AdditionalDocumentReference>\n<cbc:ID>QR</cbc:ID>\n<cac:Attachment>\n<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject>`)).toBe(qr);
  });
});

// ------------------------------------------------------------------ the flow

describe('before the first payment', () => {
  it("a card is refused until the company's national address is given", async () => {
    const res = await addCard();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('invoice_details_missing');
    const page = await inject('GET', '/api/billing/invoices');
    expect(page.json()).toMatchObject({ enabled: true, missing: ['address_building', 'address_street', 'address_district', 'address_city', 'address_postal'], invoices: [] });
  });

  it('the address is checked, saved by owners and admins only, and then a card can be added', async () => {
    const bad = await inject('PATCH', '/api/billing/details', { ...ADDRESS, address_building: '77', vat_number: '123' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toMatch(/4 digits/);
    expect((await inject('PATCH', '/api/billing/details', ADDRESS, viewer)).statusCode).toBe(403);
    const ok = await inject('PATCH', '/api/billing/details', { ...ADDRESS, vat_number: '' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ missing: [], details: { address_city: 'جدة', vat_number: null } });
    expect((await addCard()).statusCode).toBe(200);
  });
});

describe('a payment', () => {
  it('gets a tax invoice, cleared by ZATCA, first in the chain, and the owner is told', async () => {
    const chargeId = await pay();
    const [inv] = await invoices();
    expect(inv).toMatchObject({
      kind: 'invoice', number: 'TLS-000001', icv: '1', pih: FIRST_PIH, charge_id: chargeId, status: 'cleared',
      net_amount: '200.00', vat_amount: '30.00', total_amount: '230.00', zatca_mode: 'fake',
    });
    expect(inv.invoice_hash).toBe(invoiceHash(inv.xml));
    expect(inv.xml).toContain(`<cbc:UUID>${inv.id}</cbc:UUID>`);
    expect(inv.xml).toContain('<cbc:RegistrationName>مؤسسة النخبة التجريبية للتوصيل</cbc:RegistrationName>');
    expect(inv.xml).toContain('<cbc:BuildingNumber>7788</cbc:BuildingNumber>');
    // ZATCA got the declaration plus the hashed bytes, and its QR code is what the client gets.
    expect(zatca.sent.at(-1)).toMatchObject({ uuid: inv.id, invoiceHash: inv.invoice_hash });
    expect(zatca.sent.at(-1)!.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice')).toBe(true);
    expect(inv.qr).toBe(qrFromXml(inv.cleared_xml));
    expect(decodeTlv(inv.qr).get(6)!.toString()).toBe(inv.invoice_hash);
    // The supply period is the paid month, in Saudi dates.
    const ch = (await admin.query(`SELECT * FROM app.billing_charges WHERE id = $1`, [chargeId])).rows[0];
    expect(inv.xml).toContain(`<cbc:ActualDeliveryDate>${saudiTime(ch.period_start).date}</cbc:ActualDeliveryDate>`);

    expect(await events('invoice_ready')).toEqual([{ data: expect.objectContaining({ number: 'TLS-000001', amount: '230.00' }) }]);
    const mail = mailer.take().map((m) => m.subject);
    expect(mail).toEqual([expect.stringContaining('Payment received'), expect.stringContaining('Your tax invoice TLS-000001 is ready')]);
    // Doing it again changes nothing: one invoice per payment.
    expect((await invoiceCharge(deps, CLIENT, chargeId)).status).toBe('exists');
    expect((await runInvoices(deps)).issued).toBe(0);
    expect(await invoices()).toHaveLength(1);
  });

  it('can be downloaded as a PDF with the XML inside, and as the XML ZATCA stamped', async () => {
    const list = (await inject('GET', '/api/billing/invoices')).json().invoices;
    expect(list).toEqual([expect.objectContaining({ number: 'TLS-000001', state: 'ready', total_amount: '230.00', kind: 'invoice' })]);
    const res = await inject('GET', `/api/billing/invoices/${list[0].id}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('TLS-000001.pdf');
    const doc = await PDFDocument.load(res.rawPayload);
    expect(doc.getTitle()).toBe('Tax invoice TLS-000001');
    expect(res.rawPayload.toString('latin1')).toContain('TLS-000001.xml');
    const html = pdf.html.at(-1)!;
    expect(html).toContain('فاتورة ضريبية');
    expect(html).toContain('Tax invoice');
    expect(html).toContain('<svg');
    expect(html).toContain('Test Seller &amp; Sons');
    expect(html).toContain('300000000000003');
    expect(html).toContain('<bdi dir="ltr">230.00</bdi>');

    const xml = await inject('GET', `/api/billing/invoices/${list[0].id}/xml`);
    expect(xml.statusCode).toBe(200);
    expect(xml.body).toContain('<cbc:ID>QR</cbc:ID>');
  });

  it('only owners and admins see invoices; another company gets 404', async () => {
    const [inv] = await invoices();
    expect((await inject('GET', '/api/billing/invoices', undefined, viewer)).statusCode).toBe(403);
    expect((await inject('GET', `/api/billing/invoices/${inv.id}/pdf`, undefined, otherOwner)).statusCode).toBe(404);
    expect((await inject('GET', `/api/billing/invoices/${inv.id}/xml`, undefined, otherOwner)).statusCode).toBe(404);
    expect((await inject('GET', '/api/billing/invoices', undefined, otherOwner)).json().invoices).toEqual([]);
  });
});

describe('when ZATCA', () => {
  it('cannot be reached, the same invoice waits and is sent again later, unchanged', async () => {
    zatca.downNext();
    await pay();
    const inv = (await invoices()).at(-1);
    expect(inv).toMatchObject({ status: 'pending', icv: '2', submit_tries: 1 });
    expect(inv.pih).toBe((await invoices())[0].invoice_hash);
    // Not given out while it waits.
    expect((await inject('GET', `/api/billing/invoices/${inv.id}/pdf`)).statusCode).toBe(404);
    expect((await inject('GET', '/api/billing/invoices')).json().invoices[0]).toMatchObject({ number: 'TLS-000002', state: 'waiting' });
    // Too soon: nothing is sent.
    expect((await runInvoices(deps)).sent).toBe(0);
    clock = new Date(Date.now() + retryMinutes(1) * 60_000 + 1000);
    expect((await runInvoices(deps)).sent).toBe(1);
    const again = (await invoices()).at(-1);
    expect(again).toMatchObject({ id: inv.id, status: 'cleared', xml: inv.xml, submit_tries: 2 });
  });

  it('refuses an invoice, it is never given out, Talos is told, and a fixed address issues a new one in the chain', async () => {
    zatca.rejectNext(['BR-KSA-63: district is wrong']);
    await pay();
    const rejected = (await invoices()).at(-1);
    expect(rejected).toMatchObject({ status: 'rejected', icv: '3', zatca_messages: { errors: ['BR-KSA-63: district is wrong'], warnings: [] } });
    expect(await events('invoice_rejected')).toHaveLength(1);
    expect((await inject('GET', `/api/billing/invoices/${rejected.id}/pdf`)).statusCode).toBe(404);
    expect(mailer.take().some((m) => m.subject.includes('tax invoice'))).toBe(false);
    // The scheduler does not issue it again on its own (the same mistake would repeat).
    expect((await runInvoices(deps)).issued).toBe(0);

    const fixed = await inject('PATCH', '/api/billing/details', { ...ADDRESS, address_district: 'الشاطئ' });
    expect(fixed.json().issued).toBe(1);
    const next = (await invoices()).at(-1);
    expect(next).toMatchObject({ status: 'cleared', icv: '4', charge_id: rejected.charge_id, pih: rejected.invoice_hash });
    expect(next.xml).toContain('الشاطئ');
  });
});

describe('the chain', () => {
  it('never skips or repeats, even with several invoices made at once', async () => {
    const charges: string[] = [];
    for (let i = 0; i < 4; i++) {
      await admin.query(
        `UPDATE app.clients SET billing_status = 'trial', trial_ends_at = now() - interval '40 days', paid_until = NULL WHERE id = $1`,
        [CLIENT],
      );
      // Pay without the invoice, as if the process stopped right after the payment.
      const card = (await admin.query(`SELECT id FROM app.billing_cards WHERE client_id = $1 AND status = 'active'`, [CLIENT])).rows[0].id;
      const ch = await admin.query(
        `INSERT INTO app.billing_charges (client_id, card_id, reason, plan, billing_period, amount, vat_amount, period_start, period_end,
                                          status, gateway_payment_id, finished_at)
         VALUES ($1, $2, 'renewal', 'legal', 'monthly', 230, 30, now(), now() + interval '1 month', 'paid', $3, now()) RETURNING id`,
        [CLIENT, card, `pay_chain_${i}`],
      );
      charges.push(ch.rows[0].id);
    }
    const outs = await Promise.all(charges.map((c) => invoiceCharge(deps, CLIENT, c)));
    expect(outs.map((o) => o.status)).toEqual(['issued', 'issued', 'issued', 'issued']);
    const all = await allInvoices();
    all.forEach((inv, i) => {
      expect(Number(inv.icv)).toBe(i + 1);
      expect(inv.pih).toBe(i === 0 ? FIRST_PIH : all[i - 1].invoice_hash);
      expect(inv.invoice_hash).toBe(invoiceHash(inv.xml));
    });
    const chain = (await admin.query(`SELECT last_icv::text, last_hash FROM app.invoice_chain`)).rows[0];
    expect(chain).toEqual({ last_icv: String(all.length), last_hash: all.at(-1).invoice_hash });
  });

  it('is shared by every company, each seeing only its own invoices', async () => {
    await admin.query(`UPDATE app.clients SET address_building = '1111', address_street = 'S', address_district = 'D', address_city = 'Riyadh', address_postal = '11564' WHERE id = $1`, [OTHER_CLIENT]);
    expect((await addCard(otherOwner)).statusCode).toBe(200);
    await pay(OTHER_CLIENT);
    const theirs = await invoices(OTHER_CLIENT);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ icv: String((await allInvoices()).length), total_amount: '345.00', status: 'cleared' });
    const mine = (await inject('GET', '/api/billing/invoices')).json().invoices;
    expect(mine.some((i: { id: string }) => i.id === theirs[0].id)).toBe(false);
  });
});

describe('a refund', () => {
  it('in the provider’s dashboard gets a credit note for what was given back, once, through the webhook', async () => {
    const first = (await invoices())[0];
    const ch = (await admin.query(`SELECT * FROM app.billing_charges WHERE id = $1`, [first.charge_id])).rows[0];
    gateway.refund(ch.gateway_payment_id, 11500n);
    const hook = (id: string) =>
      app.inject({
        method: 'POST', url: '/webhooks/moyasar',
        payload: { id, type: 'payment_refunded', secret_token: SECRET, live: false, data: { id: ch.gateway_payment_id, metadata: { charge_id: ch.id, client_id: CLIENT } } },
      });
    expect((await hook('evt_refund_1')).statusCode).toBe(200);
    const notes = (await invoices()).filter((i) => i.kind === 'credit_note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ original_id: first.id, total_amount: '115.00', net_amount: '100.00', vat_amount: '15.00', status: 'cleared' });
    expect(notes[0].number).toMatch(/^TLS-CN-\d{6}$/);
    expect(notes[0].xml).toContain('<cbc:ID>TLS-000001</cbc:ID>');
    expect(await events('credit_note_ready')).toHaveLength(1);
    // The same event twice, or the same refund told again, makes no second note.
    await hook('evt_refund_1');
    await hook('evt_refund_2');
    expect((await invoices()).filter((i) => i.kind === 'credit_note')).toHaveLength(1);

    // The rest of it, later: a second note for the difference only.
    gateway.refund(ch.gateway_payment_id, 11500n);
    await hook('evt_refund_3');
    const all = (await invoices()).filter((i) => i.kind === 'credit_note');
    expect(all.map((n) => n.total_amount)).toEqual(['115.00', '115.00']);
    const pdfRes = await inject('GET', `/api/billing/invoices/${all[1].id}/pdf`);
    expect(pdfRes.statusCode).toBe(200);
    expect(pdf.html.at(-1)).toContain('إشعار دائن');
    expect(pdf.html.at(-1)).toContain('TLS-000001');
  });

  it('that cannot be split into net and 15% exactly is left for a person', async () => {
    const [, second] = await invoices();
    expect((await creditRefund(deps, CLIENT, second.charge_id, 11n)).status).toBe('not_split');
  });
});

describe('a company without its address', () => {
  it('is told once after paying, and its invoice comes as soon as the address is added', async () => {
    const card = (await admin.query(`SELECT id FROM app.billing_cards WHERE client_id = $1 AND status = 'active'`, [OTHER_CLIENT])).rows[0];
    expect(card).toBeTruthy();
    await admin.query(`UPDATE app.clients SET address_building = NULL, address_postal = NULL WHERE id = $1`, [OTHER_CLIENT]);
    const before = (await invoices(OTHER_CLIENT)).length;
    await pay(OTHER_CLIENT);
    expect(await invoices(OTHER_CLIENT)).toHaveLength(before);
    expect(await events('invoice_details_needed', OTHER_CLIENT)).toHaveLength(1);
    expect(mailer.take().map((m) => m.subject)).toContain("أكمل عنوان شركتك لفاتورتك الضريبية | Add your company's address for your tax invoice");
    // The scheduler waits for the address rather than telling again.
    await runInvoices(deps);
    expect(await events('invoice_details_needed', OTHER_CLIENT)).toHaveLength(1);
    const res = await inject('PATCH', '/api/billing/details', { address_building: '2222', address_street: 'S', address_district: 'D', address_city: 'Riyadh', address_postal: '11564' }, otherOwner);
    expect(res.json().issued).toBe(1);
    expect(await invoices(OTHER_CLIENT)).toHaveLength(before + 1);
  });
});

describe('before Talos is connected to ZATCA (ZATCA_MODE=off)', () => {
  it('the invoice is ready at once, with the basic QR code', async () => {
    const off = { ...deps, zatca: null };
    await admin.query(`UPDATE app.clients SET billing_status = 'trial', trial_ends_at = now() - interval '40 days', paid_until = NULL WHERE id = $1`, [CLIENT]);
    const out = await chargeClient(off, CLIENT, 'trial_end');
    expect(out.status).toBe('paid');
    const inv = (await invoices()).at(-1);
    expect(inv).toMatchObject({ status: 'generated', zatca_mode: 'off', cleared_xml: null });
    const qr = decodeTlv(inv.qr);
    expect(qr.get(1)!.toString()).toBe('Test Seller & Sons');
    expect(qr.get(4)!.toString()).toBe('230.00');
    expect((await inject('GET', `/api/billing/invoices/${inv.id}/xml`)).body.startsWith('<?xml')).toBe(true);
  });
});

describe('settings', () => {
  const base = { NODE_ENV: 'development', DATABASE_URL: API_URL };
  const prod = {
    ...base, NODE_ENV: 'production', AUTH_MODE: 'session', APP_URL: 'https://app.test', MAIL_DRIVER: 'smtp', SMTP_URL: 'smtp://x',
    STORAGE_DRIVER: 'gcs', GCS_BUCKET: 'b',
  };
  it('the real ZATCA only in production, its test systems only outside it, always with all of Talos’s details', () => {
    expect(() => loadConfig({ ...base, ...SELLER, ZATCA_MODE: 'core', ZATCA_CSID_TOKEN: 't', ZATCA_CSID_SECRET: 's' })).toThrow(/only in production/);
    expect(() => loadConfig({ ...prod, ...SELLER, ZATCA_MODE: 'fake' })).toThrow(/not allowed in production/);
    expect(() => loadConfig({ ...prod, ...SELLER, ZATCA_MODE: 'simulation', ZATCA_CSID_TOKEN: 't', ZATCA_CSID_SECRET: 's' })).toThrow(/not allowed in production/);
    expect(loadConfig({ ...prod, ...SELLER, ZATCA_MODE: 'core', ZATCA_CSID_TOKEN: 't', ZATCA_CSID_SECRET: 's' }).ZATCA_MODE).toBe('core');
    expect(() => loadConfig({ ...base, ...SELLER, ZATCA_MODE: 'sandbox' })).toThrow(/ZATCA_CSID_TOKEN/);
    expect(() => loadConfig({ ...base, ...SELLER, SELLER_POSTAL: undefined })).toThrow(/SELLER_POSTAL missing/);
    expect(() => loadConfig({ ...base, ZATCA_MODE: 'fake' })).toThrow(/SELLER_VAT_NUMBER/);
    expect(() => loadConfig({ ...base, ...SELLER, SELLER_VAT_NUMBER: '312345678901234' })).toThrow(/start and end with 3/);
    // Without a VAT number there are no tax invoices, and nothing else is refused.
    expect(loadConfig(base).ZATCA_MODE).toBe('off');
  });
});

describe('the Fatoora client', () => {
  let server: Server;
  let url: string;
  let seen: { headers: Record<string, string | string[] | undefined>; body: Record<string, string>; path: string }[] = [];
  let answer: { status: number; body: object } = { status: 200, body: {} };
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ headers: req.headers, body: JSON.parse(raw || '{}'), path: req.url ?? '' });
        res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/e-invoicing/simulation`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    seen = [];
  });
  const client = () => new FatooraClient('simulation', { token: 'TOKEN', secret: 'SECRET', baseUrl: url });
  const req = { uuid: '6f4d20e0-6bfe-4a80-9389-7dabe6620f12', invoiceHash: 'abc=', xml: '<?xml version="1.0" encoding="UTF-8"?>\n<Invoice/>' };

  it('asks for clearance with the CSID, version 2 and the invoice in base64; a cleared answer is ZATCA’s stamped XML', async () => {
    answer = { status: 200, body: { clearanceStatus: 'CLEARED', clearedInvoice: Buffer.from('<Invoice>stamped</Invoice>').toString('base64'), validationResults: { warningMessages: [] } } };
    expect(await client().clear(req)).toEqual({ status: 'cleared', clearedXml: '<Invoice>stamped</Invoice>', warnings: [] });
    const s = seen[0]!;
    expect(s.path).toBe('/e-invoicing/simulation/invoices/clearance/single');
    expect(s.headers).toMatchObject({ 'accept-version': 'V2', 'clearance-status': '1', authorization: `Basic ${Buffer.from('TOKEN:SECRET').toString('base64')}` });
    expect(s.body).toEqual({ invoiceHash: 'abc=', uuid: req.uuid, invoice: Buffer.from(req.xml).toString('base64') });
    answer = { status: 202, body: { clearanceStatus: 'CLEARED', clearedInvoice: Buffer.from('<x/>').toString('base64'), validationResults: { warningMessages: [{ code: 'W1', message: 'careful' }] } } };
    expect(await client().clear(req)).toMatchObject({ status: 'cleared', warnings: ['W1: careful'] });
  });

  it('a refusal comes back with ZATCA’s reasons; anything else means try again later', async () => {
    answer = { status: 400, body: { clearanceStatus: 'NOT_CLEARED', validationResults: { errorMessages: [{ code: 'BR-KSA-63', message: 'address' }] } } };
    expect(await client().clear(req)).toEqual({ status: 'rejected', errors: ['BR-KSA-63: address'], warnings: [] });
    for (const status of [500, 503, 429, 401, 303]) {
      answer = { status, body: {} };
      await expect(client().clear(req)).rejects.toBeInstanceOf(ZatcaUnavailable);
    }
    await expect(new FatooraClient('simulation', { token: 't', secret: 's', baseUrl: 'http://127.0.0.1:1' }).clear(req)).rejects.toBeInstanceOf(ZatcaUnavailable);
  });
});

describe('the printed invoice', () => {
  it('reads every fact back from the XML it shows', async () => {
    const xml = documentXml(doc());
    const html = await invoiceHtml({
      kind: 'invoice', number: 'TLS-000001', issued_at: new Date('2026-11-27T07:00:00Z'), supply_start: '2026-11-27', supply_end: '2026-12-26',
      net_amount: '200.00', vat_amount: '30.00', total_amount: '230.00', original_number: null, reason: null, xml, cleared_xml: null, qr: null,
    });
    expect(html).toContain('<bdi dir="ltr">2026-11-27 10:00:00</bdi>');
    expect(html).toContain('مؤسسة تجريبية');
    expect(html).toContain('Test &lt;Street&gt;');
    expect(html).not.toContain('<svg');
  });
});
