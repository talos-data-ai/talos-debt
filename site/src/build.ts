/**
 * Builds the public website into site/dist: plain HTML pages with the styles
 * inside them, no script, so they load fast on phones and every word can be
 * read by search engines and AI assistants (steps 7.1, 7.2, 7.3).
 *
 *   /            Arabic (the default for Saudi visitors)
 *   /en/         English
 *   /llms.txt    plain facts for AI assistants, in English
 *   /sitemap.xml, /robots.txt
 *
 * Settings come from the environment, so no address or contact is fixed in
 * this public repository:
 *   SITE_URL     where the site is served, for example https://example.com (required for production)
 *   APP_URL      the dashboard, for "Sign in"
 *   CONTACT_URL  where "Talk to us" goes (a WhatsApp link, a form or an email link)
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

export interface SiteConfig {
  siteUrl: string;
  appUrl: string;
  contactUrl: string;
}

export function loadConfig(env = process.env): SiteConfig {
  const production = env.NODE_ENV === 'production';
  const siteUrl = (env.SITE_URL ?? 'http://localhost:4321').replace(/\/+$/, '');
  const appUrl = (env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const contactUrl = env.CONTACT_URL ?? '#contact';
  if (production) {
    for (const [name, value] of [['SITE_URL', siteUrl], ['APP_URL', appUrl]] as const) {
      if (!value.startsWith('https://')) throw new Error(`${name} must be an https address in production`);
    }
    if (!env.CONTACT_URL) throw new Error('CONTACT_URL is required in production');
  }
  return { siteUrl, appUrl, contactUrl };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The address of a page in a language. Arabic is the root. */
export const pathOf = (lang: Lang) => (lang === 'ar' ? '/' : '/en/');

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

function jsonLd(c: Copy, cfg: SiteConfig): string {
  const url = cfg.siteUrl + pathOf(c.lang);
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${cfg.siteUrl}/#organization`,
      name: 'Talos AI Solutions',
      url: cfg.siteUrl + '/',
      logo: `${cfg.siteUrl}/favicon.svg`,
      address: { '@type': 'PostalAddress', addressLocality: 'Jeddah', addressCountry: 'SA' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: c.lang === 'ar' ? 'Talos لمتابعة المديونيات' : 'Talos Debt Follow-up',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: c.tag,
      url,
      description: c.meta.description,
      publisher: { '@id': `${cfg.siteUrl}/#organization` },
      areaServed: { '@type': 'Country', name: 'Saudi Arabia' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: c.tag,
      mainEntity: c.faq.items.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
    },
  ];
  // "<" is escaped so the JSON can never close the script tag.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function renderPage(c: Copy, cfg: SiteConfig, css: string): string {
  const other: Lang = c.lang === 'ar' ? 'en' : 'ar';
  const url = cfg.siteUrl + pathOf(c.lang);
  const contact = esc(cfg.contactUrl);
  const signIn = esc(`${cfg.appUrl}/login`);
  const arrow = icons.arrow.replace('class="icon"', 'class="icon flip"');
  const nav = `<a href="#how">${esc(c.nav.how)}</a><a href="#legal">${esc(c.nav.legal)}</a><a href="#trust">${esc(c.nav.trust)}</a><a href="#faq">${esc(c.nav.faq)}</a>`;
  const preload = FONTS.filter((f) => (c.lang === 'ar' ? f.family === 'IBM Plex Sans Arabic' && f.weight === 400 : f.family === 'IBM Plex Sans' && f.weight === 400))
    .map((f) => `<link rel="preload" href="/fonts/${fontName(f.file)}" as="font" type="font/woff2" crossorigin>`)
    .join('');
  const ch = c.chat;
  // In Arabic, Latin parts are isolated; English needs nothing.
  const isolate = c.lang === 'ar' ? isolateLatin : keepRefs;
  const hasArabic = (s: string) => /[\u0600-\u06ff]/.test(s);

  return `<!doctype html>
<html lang="${c.tag}" dir="${c.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.meta.title)}</title>
<meta name="description" content="${esc(c.meta.description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="ar" href="${cfg.siteUrl}/">
<link rel="alternate" hreflang="en" href="${cfg.siteUrl}/en/">
<link rel="alternate" hreflang="x-default" href="${cfg.siteUrl}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Talos">
<meta property="og:title" content="${esc(c.meta.title)}">
<meta property="og:description" content="${esc(c.meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${c.ogLocale}">
<meta property="og:locale:alternate" content="${copies[other].ogLocale}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0b1124">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/plain" href="/llms.txt" title="Facts for AI assistants">
${preload}
<style>${fontFaces()}${css}</style>
${jsonLd(c, cfg)}
</head>
<body>
<a class="skip" href="#main">${esc(c.skip)}</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="${pathOf(c.lang)}" aria-label="Talos">${logo}<span>Talos</span> <small>${c.lang === 'ar' ? 'لمتابعة المديونيات' : 'Debt Follow-up'}</small></a>
    <nav class="nav" aria-label="${esc(c.nav.menu)}">${nav}</nav>
    <div class="top-end">
      <a class="quiet lang-link" href="${pathOf(other)}" hreflang="${other}" lang="${other}">${esc(c.nav.other)}</a>
      <a class="quiet" href="${signIn}">${esc(c.nav.signIn)}</a>
      <a class="btn btn-primary btn-small" href="${contact}">${esc(c.nav.cta)}</a>
      <details class="menu"><summary>${esc(c.nav.menu)}</summary><nav aria-label="${esc(c.nav.menu)}">${nav}<a href="${signIn}">${esc(c.nav.signIn)}</a><a href="${pathOf(other)}" hreflang="${other}" lang="${other}">${esc(c.nav.other)}</a></nav></details>
    </div>
  </div>
</header>

<main id="main">
<section class="hero" aria-labelledby="hero-title">
  <div class="wrap hero-in">
    <div>
      <span class="eyebrow">${esc(c.hero.eyebrow)}</span>
      <h1 id="hero-title">${isolate(c.hero.title)}</h1>
      <p class="lead">${isolate(c.hero.lead)}</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${contact}">${esc(c.hero.cta)} ${arrow}</a>
        <a class="btn btn-ghost" href="#how">${esc(c.hero.secondary)}</a>
      </div>
      <ul class="points">${c.hero.points.map((p) => `<li>${icons.check}${esc(p)}</li>`).join('')}</ul>
    </div>
    <figure class="phone" role="img" aria-label="${esc(ch.label)}" style="margin:0">
      <span class="example-tag">${esc(ch.example)}</span>
      <div class="screen">
        <div class="chat-head"><span class="avatar">DL</span><div><strong>${isolate(ch.company)}</strong><span>${esc(ch.online)}</span></div></div>
        <div class="chat-body">
          <p class="bubble from-them">${isolate(ch.reminder)}<time>10:02</time></p>
          <p class="bubble from-me">${isolate(ch.question)}<time>10:15</time></p>
          <p class="bubble from-them">${isolate(ch.answer)}<time>10:15</time></p>
          <div class="bubble from-me"><span class="file">${icons.file}<bdi>${esc(ch.receiptFile)}</bdi></span>${esc(ch.receipt)}<time>10:31</time></div>
          <span class="to-approve">${icons.check}${esc(ch.toApprove)}</span>
        </div>
      </div>
    </figure>
  </div>
</section>

<section class="langs" aria-label="${esc(c.languages.title)}">
  <div class="wrap langs-in">
    <p>${isolate(c.languages.title)}</p>
    <ul>${c.languages.list
      .map((l, i) => `<li lang="${['ar', 'en', 'ur', 'bn', 'hi'][i]}">${esc(l)}</li>`)
      .join('')}</ul>
  </div>
</section>

<section class="section" aria-labelledby="who-title">
  <div class="wrap">
    <div class="section-head"><h2 id="who-title">${isolate(c.sectors.title)}</h2><p>${isolate(c.sectors.lead)}</p></div>
    <div class="cards">${c.sectors.items
      .map(
        (s, i) =>
          `<article class="card"><span class="badge">${[icons.truck, icons.users, icons.file][i]}</span><h3>${isolate(s.title)}</h3><p>${isolate(s.text)}</p><p class="debts">${isolate(s.debts)}</p></article>`,
      )
      .join('')}</div>
  </div>
</section>

<section class="section how" id="how" aria-labelledby="how-title">
  <div class="wrap">
    <div class="section-head"><span class="kicker">${esc(c.steps.eyebrow)}</span><h2 id="how-title">${isolate(c.steps.title)}</h2><p>${isolate(c.steps.lead)}</p></div>
    <ol class="steps">${c.steps.items.map((s) => `<li><h3>${isolate(s.title)}</h3><p>${isolate(s.text)}</p></li>`).join('')}</ol>
  </div>
</section>

<section class="section legal" id="legal" aria-labelledby="legal-title">
  <div class="wrap legal-in">
    <div>
      <div class="section-head"><span class="kicker">${esc(c.legal.eyebrow)}</span><h2 id="legal-title">${isolate(c.legal.title)}</h2><p>${isolate(c.legal.lead)}</p></div>
      <ul class="legal-points">${c.legal.points
        .map((p, i) => `<li><h3>${[icons.scale, icons.fileCheck, icons.shield, icons.scroll][i]}${isolate(p.title)}</h3><p>${isolate(p.text)}</p></li>`)
        .join('')}</ul>
    </div>
    <div class="request" role="group" aria-label="${esc(c.legal.card.title)}">
      <span class="example-tag">${esc(ch.example)}</span>
      <div class="request-head"><strong>${esc(c.legal.card.title)}</strong><span class="pill pill-green">${icons.check}${esc(c.legal.card.ready)}</span></div>
      <dl>${c.legal.card.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd${hasArabic(v) ? ' lang="ar"' : ''}>${isolate(v)}</dd></div>`).join('')}
        <div><dt>${esc(c.legal.card.status)}</dt><dd><span class="pill pill-legal" lang="ar">${esc(c.legal.card.statusValue)}</span></dd></div></dl>
      <div class="request-foot"><span class="nafath">${icons.shield}${esc(c.legal.card.nafath)}</span><span>${esc(c.legal.card.missing)}</span></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="board-title">
  <div class="wrap board">
    <div class="section-head" style="margin:0"><h2 id="board-title">${isolate(c.dashboard.title)}</h2><p>${isolate(c.dashboard.lead)}</p></div>
    <div class="tiles"><span class="example-tag">${esc(c.dashboard.example)}</span>${c.dashboard.tiles
      .map((t) => `<div class="tile tone-${t.tone}"><span>${esc(t.label)}</span><strong>${isolate(t.value)}</strong></div>`)
      .join('')}</div>
  </div>
</section>

<section class="section rules" id="trust" aria-labelledby="rules-title">
  <div class="wrap">
    <div class="section-head"><span class="kicker">${esc(c.rules.eyebrow)}</span><h2 id="rules-title">${isolate(c.rules.title)}</h2><p>${isolate(c.rules.lead)}</p></div>
    <ul class="rule-grid">${c.rules.items
      .map(
        (r, i) =>
          `<li><span class="badge">${[icons.fileCheck, icons.ban, icons.clock, icons.hand, icons.wallet, icons.lock][i]}</span><h3>${isolate(r.title)}</h3><p>${isolate(r.text)}</p></li>`,
      )
      .join('')}</ul>
  </div>
</section>

<section class="section" id="faq" aria-labelledby="faq-title">
  <div class="wrap faq-in">
    <div class="section-head"><h2 id="faq-title">${esc(c.faq.title)}</h2><p>${isolate(c.faq.lead)}</p></div>
    <div class="faq-list">${c.faq.items
      .map((x, i) => `<details${i === 0 ? ' open' : ''}><summary>${isolate(x.q)}${icons.plus}</summary><p>${isolate(x.a)}</p></details>`)
      .join('')}</div>
  </div>
</section>

<section class="final" id="contact" aria-labelledby="final-title">
  <div class="wrap">
    <h2 id="final-title">${isolate(c.final.title)}</h2>
    <p>${isolate(c.final.lead)}</p>
    <div class="cta-row"><a class="btn btn-primary" href="${contact}">${esc(c.final.cta)} ${arrow}</a><a class="btn btn-ghost" href="${signIn}">${esc(c.final.secondary)}</a></div>
  </div>
</section>
</main>

<footer class="foot">
  <div class="wrap foot-in">
    <div><a class="brand" href="${pathOf(c.lang)}">${logo}<span>Talos</span></a><p style="margin-block-start:10px">${isolate(c.footer.about)}</p></div>
    <div><p>${esc(c.footer.company)}, ${esc(c.footer.place)}</p><p>&copy; ${new Date().getFullYear()} ${esc(c.footer.company)}. ${esc(c.footer.rights)}</p></div>
    <nav aria-label="${esc(c.footer.facts)}"><a href="${pathOf(other)}" hreflang="${other}" lang="${other}">${esc(c.nav.other)}</a><a href="/llms.txt">${esc(c.footer.facts)}</a></nav>
  </div>
</footer>
</body>
</html>
`;
}

/** Plain facts for AI assistants (llmstxt.org): what the product is and does, in full sentences. */
export function llmsTxt(cfg: SiteConfig): string {
  const c = copies.en;
  return `# Talos Debt Follow-up

> ${c.meta.description}

Talos Debt Follow-up is made by Talos AI Solutions, a software company in Jeddah, Saudi Arabia. The website is in Arabic (${cfg.siteUrl}/) and English (${cfg.siteUrl}/en/).

## What it does

${c.steps.items.map((s) => `- ${s.title}: ${s.text}`).join('\n')}

## Rules it always keeps

${c.rules.items.map((r) => `- ${r.title}: ${r.text}`).join('\n')}

## Questions and answers

${c.faq.items.map((x) => `### ${x.q}\n\n${x.a}`).join('\n\n')}

## Pages

- [Talos Debt Follow-up, in English](${cfg.siteUrl}/en/)
- [Talos لمتابعة المديونيات، بالعربية](${cfg.siteUrl}/)
`;
}

export function sitemap(cfg: SiteConfig): string {
  const alt = `<xhtml:link rel="alternate" hreflang="ar" href="${cfg.siteUrl}/"/><xhtml:link rel="alternate" hreflang="en" href="${cfg.siteUrl}/en/"/><xhtml:link rel="alternate" hreflang="x-default" href="${cfg.siteUrl}/"/>`;
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>${cfg.siteUrl}/</loc><lastmod>${today}</lastmod>${alt}</url>
<url><loc>${cfg.siteUrl}/en/</loc><lastmod>${today}</lastmod>${alt}</url>
</urlset>
`;
}

export function build(cfg = loadConfig()) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'en'), { recursive: true });
  mkdirSync(join(dist, 'fonts'), { recursive: true });
  const css = minifyCss(readFileSync(join(here, 'site.css'), 'utf8'));
  writeFileSync(join(dist, 'index.html'), renderPage(copies.ar, cfg, css));
  writeFileSync(join(dist, 'en', 'index.html'), renderPage(copies.en, cfg, css));
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
