/**
 * The website's contact form (Phase 7): POST /api/public/contact. A plain
 * HTML form, emailed to Talos, nothing stored, and the visitor sent back to
 * the website's thanks or sorry page.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { RateLimiter } from '../src/login/routes.js';
import type { Mail, Mailer } from '../src/login/mailer.js';
import { API_URL } from './helpers.js';

class FakeMailer implements Mailer {
  sent: Mail[] = [];
  fail = false;
  async send(mail: Mail) {
    if (this.fail) throw new Error('smtp down');
    this.sent.push(mail);
  }
}

const SITE = 'https://debt.example.test';
const mailer = new FakeMailer();
const pool = new pg.Pool({ connectionString: API_URL });
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: API_URL, SITE_URL: SITE, CONTACT_INBOX: 'sales@example.test' });
const app = buildApp(config, pool, { mailer, contactLimiter: new RateLimiter(1000, 60_000) });

const good = {
  lang: 'en', name: 'Huda', company: 'Demo Couriers', phone: '0500000123', email: '',
  debtors: '250_1000', contact_by: 'whatsapp', message: 'Mostly vehicle rent.\nCall after 4.', website: '',
};
const post = (fields: Record<string, string>, headers: Record<string, string> = { origin: SITE }, a = app) =>
  a.inject({
    method: 'POST',
    url: '/api/public/contact',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams(fields).toString(),
  });

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('contact form', () => {
  it('emails the message to Talos and sends the visitor to the thanks page in their language', async () => {
    const res = await post(good);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`${SITE}/en/thanks/`);
    const mail = mailer.sent.at(-1)!;
    expect(mail.to).toBe('sales@example.test');
    expect(mail.subject).toBe('Website contact: Demo Couriers');
    expect(mail.text).toContain('Mobile: 0500000123');
    expect(mail.text).toContain('People who owe them money: 250 to 1,000');
    expect(mail.text).toContain('Reach them by: WhatsApp');
    expect(mail.text).toContain('Email: not given');
    expect(mail.text).toContain('Mostly vehicle rent.\nCall after 4.');
    const ar = await post({ ...good, lang: 'ar' });
    expect(ar.headers.location).toBe(`${SITE}/thanks/`);
  });

  it('escapes what visitors type in the email, and keeps the subject on one line', async () => {
    await post({ ...good, company: 'Evil\r\nBcc: x@y.z', message: '<img src=x onerror=alert(1)>' });
    const mail = mailer.sent.at(-1)!;
    expect(mail.subject).toBe('Website contact: Evil Bcc: x@y.z');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('wrong or missing fields go to the sorry page and send nothing', async () => {
    const before = mailer.sent.length;
    for (const bad of [{ name: '' }, { phone: 'call me' }, { debtors: 'lots' }, { contact_by: 'pigeon' }, { email: 'not-an-email' }, { message: 'x'.repeat(2001) }]) {
      const res = await post({ ...good, ...bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(303);
      expect(res.headers.location).toBe(`${SITE}/en/sorry/`);
    }
    expect(mailer.sent.length).toBe(before);
  });

  it('a bot that fills the hidden field is thanked, and nothing is sent', async () => {
    const before = mailer.sent.length;
    const res = await post({ ...good, website: 'http://spam.example' });
    expect(res.headers.location).toBe(`${SITE}/en/thanks/`);
    expect(mailer.sent.length).toBe(before);
  });

  it('only the website may post the form', async () => {
    const res = await post(good, { origin: 'https://elsewhere.example' });
    expect(res.statusCode).toBe(403);
  });

  it('too many messages from one address go to the sorry page', async () => {
    const limited = buildApp(config, pool, { mailer, contactLimiter: new RateLimiter(2, 60_000) });
    await limited.ready();
    expect((await post(good, { origin: SITE }, limited)).headers.location).toBe(`${SITE}/en/thanks/`);
    expect((await post(good, { origin: SITE }, limited)).headers.location).toBe(`${SITE}/en/thanks/`);
    expect((await post(good, { origin: SITE }, limited)).headers.location).toBe(`${SITE}/en/sorry/`);
    await limited.close();
  });

  it('when the email cannot be sent, the visitor is told, so they can call instead', async () => {
    mailer.fail = true;
    const res = await post(good);
    mailer.fail = false;
    expect(res.headers.location).toBe(`${SITE}/en/sorry/`);
  });

  it('is turned off until the website address and the inbox are set', async () => {
    const off = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: API_URL }), pool, { mailer });
    await off.ready();
    const res = await post(good, {}, off);
    expect(res.statusCode).toBe(503);
    await off.close();
  });
});
