/**
 * The website (7.1, 7.2, 7.3): both languages say the same things, nothing
 * forbidden is published, search engines and AI assistants get what they
 * need, and the pages pass accessibility checks in a real browser.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build, llmsTxt, loadConfig, renderPage, sitemap } from '../src/build.js';
import { ar, en, type Copy } from '../src/content.js';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const page = (path: string) => readFileSync(join(dist, path), 'utf8');

/** Every string inside a copy, for the text checks. */
const CODES = new Set(['lang', 'dir', 'tag', 'ogLocale', 'tone']);
function strings(x: unknown): string[] {
  if (typeof x === 'string') return [x];
  if (Array.isArray(x)) return x.flatMap(strings);
  if (x && typeof x === 'object') return Object.entries(x).flatMap(([k, v]) => (CODES.has(k) ? [] : strings(v)));
  return [];
}
/** The same shape: same keys, same list lengths. */
function shape(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(shape);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, shape(v)]));
  return typeof x;
}

describe('words', () => {
  it('Arabic and English have the same parts, item for item', () => {
    expect(shape(ar)).toEqual(shape(en));
  });

  it('no em dashes, and no prices (they stay out of the public repository)', () => {
    for (const c of [ar, en] as Copy[]) {
      for (const s of strings(c)) {
        expect(s, s).not.toMatch(/—/);
        expect(s, s).not.toMatch(/(per|a|\/)\s?month|شهري|monthly|plan|خطة|باقة/i);
      }
    }
  });

  it('the Arabic page is in Arabic: no English sentence left untranslated', () => {
    const allowed = /^(Talos( AI Solutions)?|English|Excel|DBT-\d{4}-\d{4}|receipt\.jpg|DL)$/;
    for (const s of strings(ar)) {
      for (const latin of s.match(/[A-Za-z][A-Za-z0-9.\- ]*[A-Za-z0-9]/g) ?? []) {
        expect(latin.trim(), s).toMatch(allowed);
      }
    }
  });
});

describe('the built site', () => {
  beforeAll(() => build(loadConfig({ SITE_URL: 'https://site.test', APP_URL: 'https://app.site.test', CONTACT_URL: 'https://wa.me/000' })));

  it('each language links to the other for search engines', () => {
    for (const [path, lang, url] of [['index.html', 'ar', 'https://site.test/'], ['en/index.html', 'en', 'https://site.test/en/']]) {
      const html = page(path!);
      expect(html).toContain(`<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">`);
      expect(html).toContain(`<link rel="canonical" href="${url}">`);
      expect(html).toContain('<link rel="alternate" hreflang="ar" href="https://site.test/">');
      expect(html).toContain('<link rel="alternate" hreflang="en" href="https://site.test/en/">');
      expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://site.test/">');
      expect(html).toMatch(/<meta name="description" content="[^"]{80,}">/);
    }
  });

  it('structured data for the company, the product and every question', () => {
    for (const [path, c] of [['index.html', ar], ['en/index.html', en]] as const) {
      const json = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page(path))![1]!;
      const data = JSON.parse(json) as { '@type': string; mainEntity?: { name: string }[] }[];
      expect(data.map((x) => x['@type'])).toEqual(['Organization', 'SoftwareApplication', 'FAQPage']);
      expect(data[2]!.mainEntity!.map((q) => q.name)).toEqual(c.faq.items.map((q) => q.q));
    }
  });

  it('no script runs, nothing is loaded from another site, and the pages stay small', () => {
    for (const path of ['index.html', 'en/index.html']) {
      const html = page(path);
      expect(html.match(/<script/g)).toHaveLength(1); // only the structured data
      const external = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1]!);
      for (const u of external) expect(u, u).toMatch(/^https:\/\/(site\.test|app\.site\.test|wa\.me)\//);
      expect(Buffer.byteLength(html)).toBeLessThan(80_000);
      expect(html).not.toContain('localhost');
    }
  });

  it('every word on the page is in the page itself, for search engines and AI assistants', () => {
    const html = page('en/index.html');
    for (const x of en.faq.items) expect(html).toContain(x.a.replace(/'/g, '&#39;'));
  });

  it('a sitemap with both languages, robots, and plain facts for AI assistants', () => {
    expect(page('sitemap.xml')).toBe(sitemap(loadConfig({ SITE_URL: 'https://site.test' })));
    expect(page('sitemap.xml')).toContain('<loc>https://site.test/en/</loc>');
    expect(page('robots.txt')).toContain('Sitemap: https://site.test/sitemap.xml');
    const llms = page('llms.txt');
    expect(llms.startsWith('# Talos Debt Follow-up\n\n> ')).toBe(true);
    for (const x of en.faq.items) expect(llms).toContain(x.a);
    expect(llms).toBe(llmsTxt(loadConfig({ SITE_URL: 'https://site.test' })));
  });

  it('production needs real https addresses and a contact', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SITE_URL/);
    expect(() => loadConfig({ NODE_ENV: 'production', SITE_URL: 'https://a.test', APP_URL: 'https://b.test' })).toThrow(/CONTACT_URL/);
    expect(loadConfig({ NODE_ENV: 'production', SITE_URL: 'https://a.test/', APP_URL: 'https://b.test', CONTACT_URL: 'https://wa.me/1' }).siteUrl).toBe('https://a.test');
  });

  it('text from settings is escaped', () => {
    const html = renderPage(en, { siteUrl: 'https://s.test', appUrl: 'https://a.test', contactUrl: 'https://x.test/?a="><script>' }, '');
    expect(html).not.toContain('"><script>');
  });
});

describe('in a real browser', () => {
  let server: Server;
  let browser: Browser;
  let base: string;
  const types: Record<string, string> = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', woff2: 'font/woff2' };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let p = (req.url ?? '/').split('?')[0]!;
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

  for (const path of ['/', '/en/']) {
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
});
