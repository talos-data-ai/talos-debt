/**
 * Builds the public website into site/dist: plain HTML pages with the styles
 * inside them, no script, so they load fast on phones and every word can be
 * read by search engines and AI assistants (steps 7.1 to 7.4).
 *
 *   /  and /en/                  home, in Arabic (the default) and English
 *   /pricing/ and /en/pricing/   the three plans
 *   /thanks/, /sorry/            after the contact form (not listed for search engines)
 *   /llms.txt                    plain facts for AI assistants, in English
 *   /sitemap.xml, /robots.txt
 *
 * Settings come from the environment, so no address, number or price is in
 * this public repository:
 *   SITE_URL          where the site is served (https://debt.talosksa.com in production)
 *   APP_URL           the dashboard, for "Sign in"
 *   FORM_URL          where the contact form is sent: the API's POST /api/public/contact
 *   CONTACT_WHATSAPP  the WhatsApp number, digits only with the country code (9665XXXXXXXX)
 *   CONTACT_PHONE     the phone number as people should read it (+966 5X XXX XXXX)
 *   PRICING_FILE      a JSON file with the prices (see `Pricing`), kept outside the repository
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copies, type Copy, type Lang } from './content.js';
import { icons, logo } from './icons.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const require = createRequire(import.meta.url);

/** Prices of the three plans, in the order of `pricing.tiers`, as text in SAR ("499" or "499.00"). */
export interface Pricing {
  vat: 'excluded' | 'included';
  /** Show the offer for the first 10 companies; turn it off once they have joined. */
  foundingOffer: boolean;
  tiers: { monthly: string; yearly: string }[];
}

export interface SiteConfig {
  siteUrl: string;
  appUrl: string;
  formUrl: string;
  whatsapp: string | null;
  phone: string | null;
  pricing: Pricing | null;
}

const AMOUNT = /^\d{1,7}(\.\d{2})?$/;

/** Reads and checks the prices. A mistake stops the build: a wrong price must never be published. */
export function parsePricing(json: string): Pricing {
  const x = JSON.parse(json) as { vat?: unknown; founding_offer?: unknown; tiers?: unknown };
  if (x.vat !== 'excluded' && x.vat !== 'included') throw new Error('pricing: vat must be "excluded" or "included"');
  if (typeof x.founding_offer !== 'boolean') throw new Error('pricing: founding_offer must be true or false');
  const tiers = x.tiers as { monthly?: unknown; yearly?: unknown }[];
  if (!Array.isArray(tiers) || tiers.length !== copies.en.pricing.tiers.length) {
    throw new Error(`pricing: tiers must list ${copies.en.pricing.tiers.length} plans`);
  }
  return {
    vat: x.vat,
    foundingOffer: x.founding_offer,
    tiers: tiers.map((t, i) => {
      if (typeof t.monthly !== 'string' || !AMOUNT.test(t.monthly) || typeof t.yearly !== 'string' || !AMOUNT.test(t.yearly)) {
        throw new Error(`pricing: plan ${i + 1} needs "monthly" and "yearly" as text amounts, for example "499"`);
      }
      return { monthly: t.monthly, yearly: t.yearly };
    }),
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): SiteConfig {
  const production = env.NODE_ENV === 'production';
  const trim = (u: string) => u.replace(/\/+$/, '');
  const siteUrl = trim(env.SITE_URL ?? 'http://localhost:4321');
  const appUrl = trim(env.APP_URL ?? 'http://localhost:5173');
  const formUrl = env.FORM_URL ?? 'http://localhost:3000/api/public/contact';
  const whatsapp = env.CONTACT_WHATSAPP?.replace(/\D/g, '') || null;
  const phone = env.CONTACT_PHONE?.trim() || null;
  const pricing = env.PRICING_JSON
    ? parsePricing(env.PRICING_JSON)
    : env.PRICING_FILE
      ? parsePricing(readFileSync(env.PRICING_FILE, 'utf8'))
      : null;
  if (production) {
    for (const [name, value] of [['SITE_URL', siteUrl], ['APP_URL', appUrl], ['FORM_URL', formUrl]] as const) {
      if (!value.startsWith('https://')) throw new Error(`${name} must be an https address in production`);
    }
    if (!whatsapp || !phone) throw new Error('CONTACT_WHATSAPP and CONTACT_PHONE are required in production');
    if (!pricing) throw new Error('PRICING_FILE is required in production');
  }
  return { siteUrl, appUrl, formUrl, whatsapp, phone, pricing };
}

export type PageKind = 'home' | 'pricing' | 'thanks' | 'sorry';

/** The address of a page in a language. Arabic is the root. */
export function pathOf(lang: Lang, kind: PageKind = 'home'): string {
  const base = lang === 'ar' ? '/' : '/en/';
  return kind === 'home' ? base : `${base}${kind}/`;
}

/** "12500.00" to "12,500" and "99.50" to "99.50": grouped from the text, never as a number. */
export function formatAmount(amount: string): string {
  const [whole, part] = amount.split('.') as [string, string | undefined];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return part && part !== '00' ? `${grouped}.${part}` : grouped;
}

const halalas = (amount: string) => {
  const [w, p = '00'] = amount.split('.');
  return BigInt(w!) * 100n + BigInt(p.padEnd(2, '0'));
};
/** What a year costs less than twelve months, as text, or null when it does not. */
export function yearlySaving(t: { monthly: string; yearly: string }): string | null {
  const diff = halalas(t.monthly) * 12n - halalas(t.yearly);
  if (diff <= 0n) return null;
  return `${diff / 100n}.${String(diff % 100n).padStart(2, '0')}`;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);


/** Latin parts (product names, references, amounts) inside Arabic text keep their own direction. */
const isolateLatin = (s: string) =>
  esc(s).replace(/(DBT-\d{4}-\d{4})|([A-Za-z][A-Za-z0-9.\-/ ]*[A-Za-z0-9])/g, (_m, ref, latin) =>
    ref ? `<bdi class="nb">${ref}</bdi>` : `<bdi>${latin}</bdi>`);
/** References never break across lines. */
const keepRefs = (s: string) => esc(s).replace(/(DBT-\d{4}-\d{4})/g, '<span class="nb">$1</span>');

const FONTS: { family: string; file: string; weight: number; range: string }[] = [
  { family: 'IBM Plex Sans Arabic', file: 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2', weight: 400, range: 'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC' },
  { family: 'IBM Plex Sans Arabic', file: 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2', weight: 600, range: 'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC' },
  { family: 'IBM Plex Sans Arabic', file: 'ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2', weight: 700, range: 'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC' },
  { family: 'IBM Plex Sans', file: 'ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', weight: 400, range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  { family: 'IBM Plex Sans', file: 'ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', weight: 600, range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
  { family: 'Space Grotesk', file: 'space-grotesk/files/space-grotesk-latin-700-normal.woff2', weight: 700, range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' },
];
const fontName = (file: string) => file.split('/').pop()!;

function fontFaces(): string {
  return FONTS.map(
    (f) =>
      `@font-face{font-family:'${f.family}';font-style:normal;font-display:swap;font-weight:${f.weight};src:url(/fonts/${fontName(f.file)}) format('woff2');unicode-range:${f.range}}`,
  ).join('');
}

/** Light minifying: drop comments and extra spaces. */
function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

const sar = (c: Copy, amount: string) => (c.lang === 'ar' ? `${formatAmount(amount)} ريال` : `SAR ${formatAmount(amount)}`);

interface PageParts {
  kind: PageKind;
  title: string;
  description: string;
  body: string;
  /** Thanks and sorry pages are not for search engines. */
  index: boolean;
  data: object[];
}

function organization(cfg: SiteConfig) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${cfg.siteUrl}/#organization`,
    name: 'Talos AI Solutions',
    url: cfg.siteUrl + '/',
    logo: `${cfg.siteUrl}/favicon.svg`,
    address: { '@type': 'PostalAddress', addressLocality: 'Jeddah', addressCountry: 'SA' },
    ...(cfg.phone ? { contactPoint: { '@type': 'ContactPoint', telephone: cfg.phone, contactType: 'sales', availableLanguage: ['ar', 'en'] } } : {}),
  };
}

function product(c: Copy, cfg: SiteConfig) {
  const p = cfg.pricing;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: c.product,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    inLanguage: c.tag,
    url: cfg.siteUrl + pathOf(c.lang),
    description: c.meta.description,
    publisher: { '@id': `${cfg.siteUrl}/#organization` },
    areaServed: { '@type': 'Country', name: 'Saudi Arabia' },
    ...(p
      ? {
          offers: c.pricing.tiers.map((t, i) => ({
            '@type': 'Offer',
            name: t.name,
            price: p.tiers[i]!.monthly,
            priceCurrency: 'SAR',
            url: cfg.siteUrl + pathOf(c.lang, 'pricing'),
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: p.tiers[i]!.monthly,
              priceCurrency: 'SAR',
              billingDuration: 'P1M',
              valueAddedTaxIncluded: p.vat === 'included',
            },
          })),
        }
      : {}),
  };
}

const faqData = (c: Copy, items: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  inLanguage: c.tag,
  mainEntity: items.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
});

/** The parts every page shares: head, header, footer. */
function layout(c: Copy, cfg: SiteConfig, css: string, page: PageParts): string {
  const other: Lang = c.lang === 'ar' ? 'en' : 'ar';
  const url = cfg.siteUrl + pathOf(c.lang, page.kind);
  const home = pathOf(c.lang);
  const signIn = esc(`${cfg.appUrl}/login`);
  const at = (hash: string) => (page.kind === 'home' ? `#${hash}` : `${home}#${hash}`);
  const nav = `<a href="${at('how')}">${esc(c.nav.how)}</a><a href="${at('legal')}">${esc(c.nav.legal)}</a><a href="${pathOf(c.lang, 'pricing')}"${page.kind === 'pricing' ? ' aria-current="page"' : ''}>${esc(c.nav.pricing)}</a><a href="${at('faq')}">${esc(c.nav.faq)}</a>`;
  const otherHref = pathOf(other, page.kind);
  const preload = FONTS.filter((f) => (c.lang === 'ar' ? f.family === 'IBM Plex Sans Arabic' && f.weight === 400 : f.family === 'IBM Plex Sans' && f.weight === 400))
    .map((f) => `<link rel="preload" href="/fonts/${fontName(f.file)}" as="font" type="font/woff2" crossorigin>`)
    .join('');
  const alternates = page.index
    ? `<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="ar" href="${cfg.siteUrl}${pathOf('ar', page.kind)}">
<link rel="alternate" hreflang="en" href="${cfg.siteUrl}${pathOf('en', page.kind)}">
<link rel="alternate" hreflang="x-default" href="${cfg.siteUrl}${pathOf('ar', page.kind)}">`
    : '<meta name="robots" content="noindex">';
  const data = page.data.length
    ? // "<" is escaped so the JSON can never close the script tag.
      `<script type="application/ld+json">${JSON.stringify(page.data).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html>
<html lang="${c.tag}" dir="${c.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
${alternates}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Talos">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${c.ogLocale}">
<meta property="og:locale:alternate" content="${copies[other].ogLocale}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0b1124">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Facts for AI assistants">
${preload}
<style>${fontFaces()}${css}</style>
${data}
</head>
<body>
<a class="skip" href="#main">${esc(c.skip)}</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="${home}">${logo}<span>Talos</span> <small>${esc(c.brandSub)}</small></a>
    <nav class="nav" aria-label="${esc(c.nav.menu)}">${nav}</nav>
    <div class="top-end">
      <a class="quiet lang-link" href="${otherHref}" hreflang="${other}" lang="${other}">${esc(c.nav.other)}</a>
      <a class="quiet" href="${signIn}">${esc(c.nav.signIn)}</a>
      <a class="btn btn-primary btn-small" href="${at('contact')}">${esc(c.nav.cta)}</a>
      <details class="menu"><summary>${esc(c.nav.menu)}</summary><nav aria-label="${esc(c.nav.menu)}">${nav}<a href="${signIn}">${esc(c.nav.signIn)}</a><a href="${otherHref}" hreflang="${other}" lang="${other}">${esc(c.nav.other)}</a></nav></details>
    </div>
  </div>
</header>
<main id="main">
${page.body}
</main>
<footer class="foot">
  <div class="wrap foot-in">
    <div><a class="brand" href="${home}">${logo}<span>Talos</span></a><p style="margin-block-start:10px">${isolate(c, c.footer.about)}</p></div>
    <div><p>${isolate(c, c.footer.company)}${c.lang === 'ar' ? '، ' : ', '}${esc(c.footer.place)}</p><p>&copy; ${new Date().getFullYear()} ${isolate(c, c.footer.company)}. ${esc(c.footer.rights)}</p></div>
    <nav aria-label="${esc(c.footer.facts)}"><a href="${pathOf(c.lang, 'pricing')}">${esc(c.nav.pricing)}</a><a href="${otherHref}" hreflang="${other}" lang="${other}">${esc(c.nav.other)}</a><a href="/llms.txt">${esc(c.footer.facts)}</a></nav>
  </div>
</footer>
</body>
</html>
`;
}

/** In Arabic, Latin parts are isolated; English only keeps references whole. */
const isolate = (c: Copy, s: string) => (c.lang === 'ar' ? isolateLatin(s) : keepRefs(s));
const hasArabic = (s: string) => /[\u0600-\u06ff]/.test(s);

/** 966512345678 as +966 51 234 5678; other numbers as +digits. */
export function readableNumber(digits: string): string {
  const m = /^(966)(5\d)(\d{3})(\d{4})$/.exec(digits);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${digits}`;
}

/** The contact form and the direct ways to reach Talos. Sent to the API, no script needed. */
function contactSection(c: Copy, cfg: SiteConfig): string {
  const k = c.contact;
  const req = `<span class="req" aria-hidden="true">*</span>`;
  const opt = `<span class="opt">(${esc(k.optional)})</span>`;
  const direct = [
    cfg.whatsapp
      ? `<a class="direct" href="https://wa.me/${cfg.whatsapp}">${icons.message}<span><strong>${esc(k.whatsapp)}</strong><bdi dir="ltr">${esc(readableNumber(cfg.whatsapp))}</bdi></span></a>`
      : '',
    cfg.phone
      ? `<a class="direct" href="tel:${esc(cfg.phone.replace(/[^\d+]/g, ''))}">${icons.phone}<span><strong>${esc(k.call)}</strong><bdi dir="ltr">${esc(cfg.phone)}</bdi></span></a>`
      : '',
  ].join('');
  return `<section class="contact" id="contact" aria-labelledby="contact-title">
  <div class="wrap contact-in">
    <div class="contact-text">
      <h2 id="contact-title">${isolate(c, c.final.title)}</h2>
      <p>${isolate(c, c.final.lead)}</p>
      ${direct ? `<p class="direct-title">${esc(k.direct)}</p><div class="directs">${direct}</div>` : ''}
    </div>
    <form class="contact-form" method="post" action="${esc(cfg.formUrl)}" accept-charset="utf-8" aria-labelledby="form-title">
      <h3 id="form-title">${esc(k.form)}</h3>
      <input type="hidden" name="lang" value="${c.lang}">
      <div class="two">
        <div class="field"><label for="cf-name">${esc(k.name)} ${req}</label><input id="cf-name" name="name" required maxlength="100" autocomplete="name"></div>
        <div class="field"><label for="cf-company">${esc(k.company)} ${req}</label><input id="cf-company" name="company" required maxlength="150" autocomplete="organization"></div>
      </div>
      <div class="two">
        <div class="field"><label for="cf-phone">${esc(k.phone)} ${req}</label><input id="cf-phone" name="phone" type="tel" required minlength="9" maxlength="20" autocomplete="tel" inputmode="tel" dir="ltr" pattern="[0-9+ ()\\-]{9,20}"></div>
        <div class="field"><label for="cf-email">${esc(k.email)} ${opt}</label><input id="cf-email" name="email" type="email" maxlength="200" autocomplete="email" dir="ltr"></div>
      </div>
      <div class="field"><label for="cf-debtors">${esc(k.debtors)} ${req}</label><select id="cf-debtors" name="debtors" required><option value="" disabled selected></option>${k.debtorOptions
        .map(([v, l]) => `<option value="${v}">${isolate(c, l)}</option>`)
        .join('')}</select></div>
      <fieldset class="field ways"><legend>${esc(k.way)} ${req}</legend>${k.ways
        .map(([v, l], i) => `<label class="way"><input type="radio" name="contact_by" value="${v}"${i === 0 ? ' checked required' : ''}> <span>${esc(l)}</span></label>`)
        .join('')}</fieldset>
      <div class="field"><label for="cf-message">${esc(k.message)} ${opt}</label><textarea id="cf-message" name="message" rows="3" maxlength="2000" aria-describedby="cf-hint"></textarea><small id="cf-hint">${esc(k.messageHint)}</small></div>
      <div class="hp" aria-hidden="true"><label for="cf-website">Website</label><input id="cf-website" name="website" tabindex="-1" autocomplete="off"></div>
      <button class="btn btn-primary" type="submit">${esc(k.send)} ${icons.arrow.replace('class="icon"', 'class="icon flip"')}</button>
      <p class="privacy"><span aria-hidden="true">*</span> ${esc(k.required)}. ${esc(k.privacy)}</p>
    </form>
  </div>
</section>`;
}

function homeBody(c: Copy, cfg: SiteConfig): string {
  const ch = c.chat;
  const iso = (s: string) => isolate(c, s);
  const arrow = icons.arrow.replace('class="icon"', 'class="icon flip"');
  return `<section class="hero" aria-labelledby="hero-title">
  <div class="wrap hero-in">
    <div>
      <span class="eyebrow">${esc(c.hero.eyebrow)}</span>
      <h1 id="hero-title">${iso(c.hero.title)}</h1>
      <p class="lead">${iso(c.hero.lead)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="#contact">${esc(c.hero.cta)} ${arrow}</a>
        <a class="btn btn-ghost" href="#how">${esc(c.hero.secondary)}</a>
      </div>
      <ul class="points">${c.hero.points.map((p) => `<li>${icons.check}${esc(p)}</li>`).join('')}</ul>
    </div>
    <figure class="phone" role="img" aria-label="${esc(ch.label)}" style="margin:0">
      <span class="example-tag">${esc(ch.example)}</span>
      <div class="screen">
        <div class="chat-head"><span class="avatar">DL</span><div><strong>${iso(ch.company)}</strong><span>${esc(ch.online)}</span></div></div>
        <div class="chat-body">
          <p class="bubble from-them">${iso(ch.reminder)}<time>10:02</time></p>
          <p class="bubble from-me">${iso(ch.question)}<time>10:15</time></p>
          <p class="bubble from-them">${iso(ch.answer)}<time>10:15</time></p>
          <div class="bubble from-me"><span class="file">${icons.file}<bdi>${esc(ch.receiptFile)}</bdi></span>${esc(ch.receipt)}<time>10:31</time></div>
          <span class="to-approve">${icons.check}${esc(ch.toApprove)}</span>
        </div>
      </div>
    </figure>
  </div>
</section>

<section class="langs" aria-label="${esc(c.languages.title)}">
  <div class="wrap langs-in">
    <p>${iso(c.languages.title)}</p>
    <ul>${c.languages.list.map((l, i) => `<li lang="${['ar', 'en', 'ur', 'bn', 'hi'][i]}">${esc(l)}</li>`).join('')}</ul>
  </div>
</section>

<section class="section" aria-labelledby="who-title">
  <div class="wrap">
    <div class="section-head"><h2 id="who-title">${iso(c.sectors.title)}</h2><p>${iso(c.sectors.lead)}</p></div>
    <div class="cards">${c.sectors.items
      .map((s, i) => `<article class="card"><span class="badge">${[icons.truck, icons.users, icons.file][i]}</span><h3>${iso(s.title)}</h3><p>${iso(s.text)}</p><p class="debts">${iso(s.debts)}</p></article>`)
      .join('')}</div>
  </div>
</section>

<section class="section how" id="how" aria-labelledby="how-title">
  <div class="wrap">
    <div class="section-head"><span class="kicker">${esc(c.steps.eyebrow)}</span><h2 id="how-title">${iso(c.steps.title)}</h2><p>${iso(c.steps.lead)}</p></div>
    <ol class="steps">${c.steps.items.map((s) => `<li><h3>${iso(s.title)}</h3><p>${iso(s.text)}</p></li>`).join('')}</ol>
  </div>
</section>

<section class="section legal" id="legal" aria-labelledby="legal-title">
  <div class="wrap legal-in">
    <div>
      <div class="section-head"><span class="kicker">${esc(c.legal.eyebrow)}</span><h2 id="legal-title">${iso(c.legal.title)}</h2><p>${iso(c.legal.lead)}</p></div>
      <ul class="legal-points">${c.legal.points
        .map((p, i) => `<li><h3>${[icons.scale, icons.fileCheck, icons.shield, icons.scroll][i]}${iso(p.title)}</h3><p>${iso(p.text)}</p></li>`)
        .join('')}</ul>
    </div>
    <div class="request" role="group" aria-label="${esc(c.legal.card.title)}">
      <span class="example-tag">${esc(ch.example)}</span>
      <div class="request-head"><strong>${esc(c.legal.card.title)}</strong><span class="pill pill-green">${icons.check}${esc(c.legal.card.ready)}</span></div>
      <dl>${c.legal.card.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd${hasArabic(v) && c.lang === 'en' ? ' lang="ar"' : ''}>${iso(v)}</dd></div>`).join('')}
        <div><dt>${esc(c.legal.card.status)}</dt><dd><span class="pill pill-legal" lang="ar">${esc(c.legal.card.statusValue)}</span></dd></div></dl>
      <div class="request-foot"><span class="nafath">${icons.shield}${esc(c.legal.card.nafath)}</span><span>${esc(c.legal.card.missing)}</span></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="board-title">
  <div class="wrap board">
    <div class="section-head" style="margin:0"><h2 id="board-title">${iso(c.dashboard.title)}</h2><p>${iso(c.dashboard.lead)}</p></div>
    <div class="tiles"><span class="example-tag">${esc(c.dashboard.example)}</span>${c.dashboard.tiles
      .map((t) => `<div class="tile tone-${t.tone}"><span>${esc(t.label)}</span><strong>${iso(t.value)}</strong></div>`)
      .join('')}</div>
  </div>
</section>

<section class="section rules" id="trust" aria-labelledby="rules-title">
  <div class="wrap">
    <div class="section-head"><span class="kicker">${esc(c.rules.eyebrow)}</span><h2 id="rules-title">${iso(c.rules.title)}</h2><p>${iso(c.rules.lead)}</p></div>
    <ul class="rule-grid">${c.rules.items
      .map((r, i) => `<li><span class="badge">${[icons.fileCheck, icons.ban, icons.clock, icons.hand, icons.wallet, icons.lock][i]}</span><h3>${iso(r.title)}</h3><p>${iso(r.text)}</p></li>`)
      .join('')}</ul>
  </div>
</section>

<section class="section" id="faq" aria-labelledby="faq-title">
  <div class="wrap faq-in">
    <div class="section-head"><h2 id="faq-title">${esc(c.faq.title)}</h2><p>${iso(c.faq.lead)}</p><p class="faq-more"><a href="${pathOf(c.lang, 'pricing')}">${esc(c.nav.pricing)} ${arrow}</a></p></div>
    <div class="faq-list">${c.faq.items
      .map((x, i) => `<details${i === 0 ? ' open' : ''}><summary>${iso(x.q)}${icons.plus}</summary><p>${iso(x.a)}</p></details>`)
      .join('')}</div>
  </div>
</section>

${contactSection(c, cfg)}`;
}

/** The plans. Monthly and yearly switch with two radio buttons and CSS, no script. */
function pricingBody(c: Copy, cfg: SiteConfig): string {
  const pr = c.pricing;
  const p = cfg.pricing;
  const iso = (s: string) => isolate(c, s);
  const price = (i: number, period: 'monthly' | 'yearly') => {
    if (!p) return `<span class="amount">${esc(pr.onRequest)}</span>`;
    const t = p.tiers[i]!;
    return `<span class="amount">${esc(sar(c, t[period]))}</span><span class="per">${esc(period === 'monthly' ? pr.perMonth : pr.perYear)}</span>`;
  };
  const cards = pr.tiers
    .map((t, i) => {
      const saving = p ? yearlySaving(p.tiers[i]!) : null;
      const last = i === pr.tiers.length - 1;
      return `<article class="plan${last ? ' plan-legal' : ''}" aria-labelledby="plan-${i}">
        <h2 id="plan-${i}">${iso(t.name)}</h2>
        <p class="plan-for">${iso(t.for)}</p>
        <p class="price m">${price(i, 'monthly')}</p>
        <p class="price y">${price(i, 'yearly')}${saving ? `<span class="save">${esc(pr.save.replace('{amount}', sar(c, saving)))}</span>` : ''}</p>
        <p class="plan-debtors">${icons.users}${esc(pr.debtors)}</p>
        <a class="btn ${last ? 'btn-primary' : 'btn-outline'}" href="${pathOf(c.lang)}#contact">${esc(pr.cta)}</a>
        ${i > 0 ? `<p class="plan-plus">${iso(pr.everything.replace('{plan}', pr.tiers[i - 1]!.name))}</p>` : ''}
        <ul class="plan-features">${t.features.map((f) => `<li>${icons.check}<span>${iso(f)}</span></li>`).join('')}</ul>
      </article>`;
    })
    .join('');
  const offers = [pr.trial, ...(p?.foundingOffer !== false ? [pr.founding] : []), pr.noSetup];
  return `<section class="hero hero-small" aria-labelledby="pricing-title">
  <div class="wrap">
    <span class="eyebrow">${esc(pr.eyebrow)}</span>
    <h1 id="pricing-title">${iso(pr.title)}</h1>
    <p class="lead">${iso(pr.lead)}</p>
    <ul class="points">${offers.map((o) => `<li>${icons.check}${esc(o)}</li>`).join('')}</ul>
  </div>
</section>
<section class="section pricing-section">
  <div class="wrap">
    <div class="pricing">
      <input class="period-input" type="radio" name="period" id="period-m" checked aria-label="${esc(pr.monthly)}">
      <input class="period-input" type="radio" name="period" id="period-y" aria-label="${esc(pr.yearly)}">
      <div class="period" aria-hidden="true"><label for="period-m">${esc(pr.monthly)}</label><label for="period-y">${esc(pr.yearly)}</label></div>
      <div class="plans">${cards}</div>
    </div>
    <p class="plans-note">${esc(pr.moreDebtors)} ${p ? esc(p.vat === 'included' ? pr.vatIncluded : pr.vatExcluded) : ''}</p>
  </div>
</section>
<section class="section how" aria-labelledby="pfaq-title">
  <div class="wrap faq-in">
    <div class="section-head"><h2 id="pfaq-title">${esc(c.faq.title)}</h2></div>
    <div class="faq-list">${pr.faq.map((x) => `<details open><summary>${iso(x.q)}${icons.plus}</summary><p>${iso(x.a)}</p></details>`).join('')}</div>
  </div>
</section>
${contactSection(c, cfg)}`;
}

function messageBody(c: Copy, m: { title: string; text: string; back: string }, back: string, ok: boolean): string {
  return `<section class="hero hero-message" aria-labelledby="msg-title">
  <div class="wrap message">
    <span class="message-icon ${ok ? 'ok' : 'bad'}">${ok ? icons.check : icons.ban}</span>
    <h1 id="msg-title">${isolate(c, m.title)}</h1>
    <p class="lead">${isolate(c, m.text)}</p>
    <div class="cta-row"><a class="btn btn-primary" href="${back}">${esc(m.back)}</a></div>
  </div>
</section>`;
}

export function renderPage(c: Copy, cfg: SiteConfig, css: string, kind: PageKind = 'home'): string {
  const parts: PageParts =
    kind === 'pricing'
      ? {
          kind,
          title: c.pricing.meta.title,
          description: c.pricing.meta.description,
          body: pricingBody(c, cfg),
          index: true,
          data: [organization(cfg), product(c, cfg), faqData(c, c.pricing.faq)],
        }
      : kind === 'thanks' || kind === 'sorry'
        ? {
            kind,
            title: `${c[kind].title} | Talos`,
            description: c[kind].text,
            body: messageBody(c, c[kind], kind === 'thanks' ? pathOf(c.lang) : `${pathOf(c.lang)}#contact`, kind === 'thanks'),
            index: false,
            data: [],
          }
        : {
            kind,
            title: c.meta.title,
            description: c.meta.description,
            body: homeBody(c, cfg),
            index: true,
            data: [organization(cfg), product(c, cfg), faqData(c, c.faq.items)],
          };
  return layout(c, cfg, css, parts);
}

/** Plain facts for AI assistants (llmstxt.org): what the product is and does, in full sentences. */
export function llmsTxt(cfg: SiteConfig): string {
  const c = copies.en;
  const pr = c.pricing;
  const p = cfg.pricing;
  const plans = pr.tiers
    .map((t, i) => {
      const cost = p ? ` It costs ${sar(c, p.tiers[i]!.monthly)} a month or ${sar(c, p.tiers[i]!.yearly)} a year${p.vat === 'excluded' ? ', not including 15% VAT' : ', including 15% VAT'}.` : '';
      return `### ${t.name}\n\n${t.for}${i > 0 ? ` It includes everything in ${pr.tiers[i - 1]!.name}, and:` : ''}\n\n${t.features.map((f) => `- ${f}`).join('\n')}\n\nFrom 250 debtors.${cost}`;
    })
    .join('\n\n');
  return `# ${c.product}

> ${c.meta.description}

${c.product} (in Arabic: ${copies.ar.product}) is made by Talos AI Solutions, a software company in Jeddah, Saudi Arabia. The website is in Arabic (${cfg.siteUrl}/) and English (${cfg.siteUrl}/en/).

## What it does

${c.steps.items.map((s) => `- ${s.title}: ${s.text}`).join('\n')}

## Rules it always keeps

${c.rules.items.map((r) => `- ${r.title}: ${r.text}`).join('\n')}

## Plans and prices

There are three plans. Each starts at 250 debtors and can be paid monthly or yearly. Every plan can be tried free for 14 days, and there is no setup fee.${p?.foundingOffer !== false ? ' The first 10 companies to join get their first month free.' : ''}

${plans}

## Questions and answers

${[...c.faq.items, ...pr.faq].map((x) => `### ${x.q}\n\n${x.a}`).join('\n\n')}

## Pages

- [${c.product}, in English](${cfg.siteUrl}/en/)
- [Pricing, in English](${cfg.siteUrl}/en/pricing/)
- [${copies.ar.product}، بالعربية](${cfg.siteUrl}/)
- [الأسعار، بالعربية](${cfg.siteUrl}/pricing/)
`;
}

export function sitemap(cfg: SiteConfig): string {
  const today = new Date().toISOString().slice(0, 10);
  const entries = (['home', 'pricing'] as const).flatMap((kind) => {
    const alt = `<xhtml:link rel="alternate" hreflang="ar" href="${cfg.siteUrl}${pathOf('ar', kind)}"/><xhtml:link rel="alternate" hreflang="en" href="${cfg.siteUrl}${pathOf('en', kind)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${cfg.siteUrl}${pathOf('ar', kind)}"/>`;
    return (['ar', 'en'] as const).map((lang) => `<url><loc>${cfg.siteUrl}${pathOf(lang, kind)}</loc><lastmod>${today}</lastmod>${alt}</url>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
}

export const PAGES: PageKind[] = ['home', 'pricing', 'thanks', 'sorry'];

export function build(cfg = loadConfig()) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'fonts'), { recursive: true });
  const css = minifyCss(readFileSync(join(here, 'site.css'), 'utf8'));
  for (const lang of ['ar', 'en'] as const) {
    for (const kind of PAGES) {
      const dir = join(dist, pathOf(lang, kind));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), renderPage(copies[lang], cfg, css, kind));
    }
  }
  writeFileSync(join(dist, 'llms.txt'), llmsTxt(cfg));
  writeFileSync(join(dist, 'sitemap.xml'), sitemap(cfg));
  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
  copyFileSync(join(root, 'public', 'favicon.svg'), join(dist, 'favicon.svg'));
  for (const f of FONTS) copyFileSync(require.resolve(`@fontsource/${f.file}`), join(dist, 'fonts', fontName(f.file)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  build();
  console.log(`Built the site into ${dist}`);
}
