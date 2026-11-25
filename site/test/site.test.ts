/**
 * The website (7.1 to 7.4): both languages say the same things, nothing
 * forbidden is published, prices come only from settings, search engines and
 * AI assistants get what they need, the contact form works without script,
 * and the pages pass accessibility checks in a real browser.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, formatAmount, llmsTxt, loadConfig, parsePricing, renderPage, sitemap, yearlySaving, type SiteConfig } from '../src/build.js';
import { ar, en, type Copy } from '../src/content.js';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const page = (path: string) => readFileSync(join(dist, path), 'utf8');

// Fake prices for the tests only. Real prices are never in the repository.
const PRICES = JSON.stringify({
  vat: 'excluded',
  founding_offer: true,
  tiers: [
    { monthly: '111', yearly: '1110' },
    { monthly: '2222.50', yearly: '26670' },
    { monthly: '3333', yearly: '33330' },
  ],
});
const ENV = {
  SITE_URL: 'https://site.test',
  APP_URL: 'https://app.site.test',
  FORM_URL: 'https://api.site.test/api/public/contact',
  CONTACT_WHATSAPP: '966 500 000 000',
  CONTACT_PHONE: '+966 50 000 0000',
  PRICING_JSON: PRICES,
};

const CODES = new Set(['lang', 'dir', 'tag', 'ogLocale', 'tone', 'debtorOptions', 'ways']);
function strings(x: unknown, skip = CODES): string[] {
  if (typeof x === 'string') return [x];
  if (Array.isArray(x)) return x.flatMap((v) => strings(v, skip));
  if (x && typeof x === 'object') return Object.entries(x).flatMap(([k, v]) => (skip.has(k) ? [] : strings(v, skip)));
  return [];
}
function shape(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(shape);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, shape(v)]));
  return typeof x;
}

describe('words', () => {
  it('Arabic and English have the same parts, item for item', () => {
    expect(shape(ar)).toEqual(shape(en));
  });

  it('no em dashes anywhere, and no price written in the words (prices come from settings)', () => {
    for (const c of [ar, en] as Copy[]) {
      for (const s of strings(c, new Set())) expect(s, s).not.toMatch(/—/);
      for (const s of strings(c.pricing)) expect(s, s).not.toMatch(/SAR|ريال|\d{3,}(?!\s?(debtors|مدين))/);
    }
  });

  it('the product is "تالوس لتحصيل الديون" in Arabic and "Talos Debt Collection" in English', () => {
    expect(ar.product).toBe('تالوس لتحصيل الديون');
    expect(en.product).toBe('Talos Debt Collection');
    // In Arabic the name is written تالوس; only the company name stays in Latin letters.
    for (const s of strings(ar)) expect(s.replace('Talos AI Solutions', ''), s).not.toMatch(/Talos/);
  });

  it('the Arabic page is in Arabic: no English sentence left untranslated', () => {
    const allowed = /^(Talos AI Solutions|English|Excel|PDF|DBT-\d{4}-\d{4}|receipt\.jpg|DL)$/;
    for (const s of strings(ar)) {
      for (const latin of s.replace(/{\w+}/g, '').match(/[A-Za-z][A-Za-z0-9.\- ]*[A-Za-z0-9]/g) ?? []) expect(latin.trim(), s).toMatch(allowed);
    }
  });
});

describe('prices', () => {
  it('are read from settings and checked; a wrong file stops the build', () => {
    expect(parsePricing(PRICES).tiers[1]).toEqual({ monthly: '2222.50', yearly: '26670' });
    expect(() => parsePricing('{"vat":"maybe","founding_offer":true,"tiers":[]}')).toThrow(/vat/);
    expect(() => parsePricing('{"vat":"excluded","founding_offer":true,"tiers":[{"monthly":"1","yearly":"2"}]}')).toThrow(/3 plans/);
    expect(() =>
      parsePricing('{"vat":"excluded","founding_offer":true,"tiers":[{"monthly":1,"yearly":"2"},{"monthly":"1","yearly":"2"},{"monthly":"1","yearly":"2"}]}'),
    ).toThrow(/text amounts/);
    expect(() =>
      parsePricing('{"vat":"excluded","founding_offer":true,"tiers":[{"monthly":"1,000","yearly":"2"},{"monthly":"1","yearly":"2"},{"monthly":"1","yearly":"2"}]}'),
    ).toThrow(/text amounts/);
  });

  it('amounts are grouped and the yearly saving is worked out from the text, never as a number', () => {
    expect(formatAmount('1110')).toBe('1,110');
    expect(formatAmount('2222.50')).toBe('2,222.50');
    expect(formatAmount('26670.00')).toBe('26,670');
    expect(yearlySaving({ monthly: '111', yearly: '1110' })).toBe('222.00');
    expect(yearlySaving({ monthly: '2222.50', yearly: '26670' })).toBeNull(); // 12 months cost exactly the same
    expect(yearlySaving({ monthly: '0.10', yearly: '1.19' })).toBe('0.01');
  });
});

describe('the built site', () => {
  beforeAll(() => build(loadConfig(ENV)));

  const indexed = [
    ['index.html', 'ar', 'https://site.test/', 'https://site.test/', 'https://site.test/en/'],
    ['en/index.html', 'en', 'https://site.test/en/', 'https://site.test/', 'https://site.test/en/'],
    ['pricing/index.html', 'ar', 'https://site.test/pricing/', 'https://site.test/pricing/', 'https://site.test/en/pricing/'],
    ['en/pricing/index.html', 'en', 'https://site.test/en/pricing/', 'https://site.test/pricing/', 'https://site.test/en/pricing/'],
  ] as const;

  it('each page links to its other language for search engines', () => {
    for (const [path, lang, url, arUrl, enUrl] of indexed) {
      const html = page(path);
      expect(html).toContain(`<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`);
      expect(html).toContain(`<link rel="canonical" href="${url}">`);
      expect(html).toContain(`<link rel="alternate" hreflang="ar" href="${arUrl}">`);
      expect(html).toContain(`<link rel="alternate" hreflang="en" href="${enUrl}">`);
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${arUrl}">`);
      expect(html).toMatch(/<meta name="description" content="[^"]{80,}">/);
    }
  });

  it('the thanks and sorry pages are kept out of search engines', () => {
    for (const path of ['thanks/index.html', 'en/thanks/index.html', 'sorry/index.html', 'en/sorry/index.html']) {
      expect(page(path)).toContain('<meta name="robots" content="noindex">');
      expect(page(path)).not.toContain('rel="canonical"');
    }
    expect(page('en/thanks/index.html')).toContain(en.thanks.title.replace(/\./g, '.'));
  });

  it('structured data for the company, the product with its three prices, and every question', () => {
    const data = (path: string) => JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page(path))![1]!) as {
      '@type': string;
      mainEntity?: { name: string }[];
      offers?: { name: string; price: string; priceCurrency: string }[];
      contactPoint?: { telephone: string };
    }[];
    const home = data('en/index.html');
    expect(home.map((x) => x['@type'])).toEqual(['Organization', 'SoftwareApplication', 'FAQPage']);
    expect(home[0]!.contactPoint!.telephone).toBe('+966 50 000 0000');
    expect(home[2]!.mainEntity!.map((q) => q.name)).toEqual(en.faq.items.map((q) => q.q));
    expect(home[1]!.offers!.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
      ['Follow-up', '111', 'SAR'], ['Legal', '2222.50', 'SAR'], ['Najiz', '3333', 'SAR'],
    ]);
    const pricing = data('pricing/index.html');
    expect(pricing[2]!.mainEntity!.map((q) => q.name)).toEqual(ar.pricing.faq.map((q) => q.q));
  });

  it('the pricing page shows each plan monthly and yearly, the saving, the offers and VAT', () => {
    const html = page('en/pricing/index.html');
    for (const t of en.pricing.tiers) expect(html).toContain(`>${t.name}</h2>`);
    expect(html).toContain('<span class="amount">SAR 111</span><span class="per">a month</span>');
    expect(html).toContain('<span class="amount">SAR 1,110</span><span class="per">a year</span>');
    expect(html).toContain('Save SAR 222 a year');
    expect(html).toContain('<span class="amount">SAR 2,222.50</span>');
    expect(html.match(/class="save"/g)).toHaveLength(2); // the Legal plan saves nothing
    for (const s of [en.pricing.trial, en.pricing.founding, en.pricing.noSetup, en.pricing.vatExcluded, en.pricing.debtors]) expect(html).toContain(s);
    expect(page('pricing/index.html')).toContain('<span class="amount">1,110 ريال</span>');
  });

  it('without prices the plans say "Ask us", and the offer for the first companies can be turned off', () => {
    const none = renderPage(en, loadConfig({ ...ENV, PRICING_JSON: undefined }), '', 'pricing');
    expect(none).toContain('<span class="amount">Ask us</span>');
    expect(none).not.toContain('SAR');
    const off = renderPage(en, loadConfig({ ...ENV, PRICING_JSON: PRICES.replace('"founding_offer":true', '"founding_offer":false') }), '', 'pricing');
    expect(off).not.toContain(en.pricing.founding);
  });

  it('the contact form posts to the API with every field, and works without script', () => {
    for (const [path, lang] of [['index.html', 'ar'], ['en/pricing/index.html', 'en']] as const) {
      const html = page(path);
      expect(html).toContain('<form class="contact-form" method="post" action="https://api.site.test/api/public/contact"');
      expect(html).toContain(`<input type="hidden" name="lang" value="${lang}">`);
      for (const name of ['name', 'company', 'phone']) expect(html).toMatch(new RegExp(`name="${name}" [^>]*required`));
      expect(html).toContain('name="email" type="email"');
      for (const v of ['under_250', '250_1000', 'over_1000', 'unknown']) expect(html).toContain(`<option value="${v}">`);
      for (const v of ['whatsapp', 'phone', 'email']) expect(html).toContain(`name="contact_by" value="${v}"`);
      expect(html).toContain('<div class="hp" aria-hidden="true"><label for="cf-website">Website</label><input id="cf-website" name="website" tabindex="-1" autocomplete="off"></div>');
      expect(html).toContain('href="https://wa.me/966500000000"');
      expect(html).toContain('<bdi dir="ltr">+966 50 000 0000</bdi>');
      expect(html).toContain('href="tel:+966500000000"');
    }
  });

  it('no script runs, nothing loads from another site, and the pages stay small', () => {
    for (const [path] of indexed) {
      const html = page(path);
      expect(html.match(/<script/g)).toHaveLength(1); // only the structured data
      const external = [...html.matchAll(/(?:href|src|action)="(https?:[^"]+)"/g)].map((m) => m[1]!);
      for (const u of external) expect(u, u).toMatch(/^https:\/\/((app\.|api\.)?site\.test|wa\.me)\//);
      expect(Buffer.byteLength(html)).toBeLessThan(90_000);
      expect(html).not.toContain('localhost');
    }
  });

  it('every answer is in the page itself, for search engines and AI assistants', () => {
    const html = page('en/index.html');
    for (const x of en.faq.items) expect(html).toContain(x.a.replace(/'/g, '&#39;'));
  });

  it('a sitemap with both pages in both languages, robots, and plain facts with the plans', () => {
    const map = page('sitemap.xml');
    expect(map).toBe(sitemap(loadConfig(ENV)));
    for (const u of ['/', '/en/', '/pricing/', '/en/pricing/']) expect(map).toContain(`<loc>https://site.test${u}</loc>`);
    expect(map).not.toContain('thanks');
    expect(page('robots.txt')).toContain('Sitemap: https://site.test/sitemap.xml');
    const llms = page('llms.txt');
    expect(llms.startsWith('# Talos Debt Collection\n\n> ')).toBe(true);
    for (const x of [...en.faq.items, ...en.pricing.faq]) expect(llms).toContain(x.a);
    expect(llms).toContain('It costs SAR 111 a month or SAR 1,110 a year, not including 15% VAT.');
    expect(llms).toContain('The first 10 companies to join get their first month free.');
    expect(llms).toBe(llmsTxt(loadConfig(ENV)));
  });

  it('production needs https addresses, the contact numbers and the prices', () => {
    const prod = { NODE_ENV: 'production', ...ENV };
    expect(() => loadConfig({ ...prod, SITE_URL: 'http://a.test' })).toThrow(/SITE_URL/);
    expect(() => loadConfig({ ...prod, FORM_URL: 'http://a.test/x' })).toThrow(/FORM_URL/);
    expect(() => loadConfig({ ...prod, CONTACT_PHONE: undefined })).toThrow(/CONTACT_PHONE/);
    expect(() => loadConfig({ ...prod, PRICING_JSON: undefined })).toThrow(/PRICING_FILE/);
    expect(loadConfig({ ...prod, SITE_URL: 'https://debt.talosksa.com/' }).siteUrl).toBe('https://debt.talosksa.com');
  });

  it('text from settings is escaped', () => {
    const cfg: SiteConfig = { ...loadConfig(ENV), formUrl: 'https://x.test/?a="><script>', phone: '<b>1</b>' };
    const html = renderPage(en, cfg, '');
    expect(html).not.toContain('"><script>');
    expect(html).not.toContain('<b>1</b>');
  });
});

describe('in a real browser', () => {
  let server: Server;
  let browser: Browser;
  let base: string;
  const types: Record<string, string> = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', woff2: 'font/woff2' };

  beforeAll(async () => {
    build(loadConfig(ENV));
    server = createServer((req, res) => {
      let p = (req.url ?? '/').split(/[?#]/)[0]!;
      if (p.endsWith('/')) p += 'index.html';
      try {
        const body = readFileSync(join(dist, p));
        res.writeHead(200, { 'content-type': types[p.split('.').pop()!] ?? 'text/plain' });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  for (const path of ['/', '/en/', '/pricing/', '/en/pricing/', '/thanks/', '/en/sorry/']) {
    for (const width of [1366, 390]) {
      it(`${path} at ${width}px: no accessibility problems, no failed loads, nothing wider than the screen`, async () => {
        const p = await browser.newPage({ viewport: { width, height: 900 } });
        const failed: string[] = [];
        p.on('requestfailed', (r) => failed.push(r.url()));
        p.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
        await p.goto(base + path, { waitUntil: 'networkidle' });
        expect(failed).toEqual([]);
        await p.addScriptTag({ path: fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)) });
        const result = await p.evaluate(async () => {
          // @ts-expect-error axe is added to the page above
          const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] });
          return r.violations.map((v: { id: string; nodes: { target: string[] }[] }) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        });
        expect(result).toEqual([]);
        const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(wide).toBeLessThanOrEqual(0);
        await p.close();
      }, 30_000);
    }
  }

  it('the monthly and yearly switch works with the mouse and the keyboard, without script', async () => {
    const p = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await p.goto(base + '/en/pricing/');
    const monthly = p.getByText('SAR 111', { exact: true });
    const yearly = p.getByText('SAR 1,110', { exact: true });
    expect(await monthly.isVisible()).toBe(true);
    expect(await yearly.isVisible()).toBe(false);
    await p.locator('label[for="period-y"]').click();
    expect(await yearly.isVisible()).toBe(true);
    expect(await monthly.isVisible()).toBe(false);
    await p.locator('#period-y').focus();
    await p.keyboard.press('ArrowLeft');
    expect(await monthly.isVisible()).toBe(true);
    await p.close();
  });

  it('the form will not send without the required fields', async () => {
    const p = await browser.newPage();
    await p.goto(base + '/en/');
    const sent: string[] = [];
    p.on('request', (r) => r.method() === 'POST' && sent.push(r.url()));
    await p.getByRole('button', { name: en.contact.send }).click();
    expect(sent).toEqual([]);
    expect(await p.locator('#cf-name').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    await p.close();
  });
});
