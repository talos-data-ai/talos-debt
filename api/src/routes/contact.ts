/**
 * The contact form on the public website (Phase 7): POST /api/public/contact.
 *
 * The website has no script, so the form posts here as a plain HTML form
 * (application/x-www-form-urlencoded). The message is emailed to Talos
 * (CONTACT_INBOX) and nothing is stored. The visitor is sent back to the
 * website's thanks page, or to its sorry page if something went wrong.
 *
 * Against misuse: only from the website's own address (Origin), a hidden
 * field people never fill (bots do), a limit per address, and short fields.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { RateLimiter } from '../login/routes.js';
import type { Mailer } from '../login/mailer.js';

const DEBTORS = { under_250: 'Fewer than 250', '250_1000': '250 to 1,000', over_1000: 'More than 1,000', unknown: 'Not sure yet' } as const;
const WAYS = { whatsapp: 'WhatsApp', phone: 'Phone call', email: 'Email' } as const;

const form = z.object({
  lang: z.enum(['ar', 'en']).default('ar'),
  name: z.string().trim().min(1).max(100),
  company: z.string().trim().min(1).max(150),
  phone: z.string().trim().regex(/^[0-9+ ()-]{9,20}$/),
  email: z.union([z.literal(''), z.string().trim().email().max(200)]).default(''),
  debtors: z.enum(Object.keys(DEBTORS) as [keyof typeof DEBTORS]),
  contact_by: z.enum(Object.keys(WAYS) as [keyof typeof WAYS]),
  message: z.string().trim().max(2000).default(''),
  website: z.string().default(''),
});

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Keep each field on its own line in the subject and the text. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

export interface ContactDeps {
  config: Config;
  mailer: Mailer;
  limiter?: RateLimiter;
}

export function contactRoutes(app: FastifyInstance, deps: ContactDeps) {
  const { config, mailer } = deps;
  const limiter = deps.limiter ?? new RateLimiter(5, 60 * 60_000);
  const site = config.SITE_URL?.replace(/\/+$/, '');

  // Plain HTML forms: small bodies only.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.post('/api/public/contact', async (req, reply) => {
    const lang = (req.body as { lang?: string } | undefined)?.lang === 'en' ? 'en' : 'ar';
    const page = (kind: 'thanks' | 'sorry') => `${site}${lang === 'en' ? '/en' : ''}/${kind}/`;
    if (!site || !config.CONTACT_INBOX) {
      return reply.code(503).send({ error: 'contact_not_set_up', message: 'The contact form is not set up' });
    }
    // A browser always says where the form came from; only the website may post here.
    const origin = req.headers.origin;
    if (origin && origin !== new URL(site).origin) {
      return reply.code(403).send({ error: 'wrong_origin', message: 'This form only works from the website' });
    }
    if (!limiter.allow(`contact:${req.ip}`)) return reply.redirect(page('sorry'), 303);

    const parsed = form.safeParse(req.body ?? {});
    if (!parsed.success) return reply.redirect(page('sorry'), 303);
    const f = parsed.data;
    // The hidden field is filled: a bot. Say thanks and send nothing.
    if (f.website) return reply.redirect(page('thanks'), 303);

    const rows: [string, string][] = [
      ['Name', f.name],
      ['Company', f.company],
      ['Mobile', f.phone],
      ['Email', f.email || 'not given'],
      ['People who owe them money', DEBTORS[f.debtors]],
      ['Reach them by', WAYS[f.contact_by]],
      ['Website language', lang === 'ar' ? 'Arabic' : 'English'],
    ];
    try {
      await mailer.send({
        to: config.CONTACT_INBOX,
        subject: `Website contact: ${oneLine(f.company)}`,
        text: `${rows.map(([k, v]) => `${k}: ${oneLine(v)}`).join('\n')}\n\nMessage:\n${f.message || '(none)'}\n`,
        html: `<table>${rows.map(([k, v]) => `<tr><th align="left">${k}</th><td>${esc(v)}</td></tr>`).join('')}</table><p><strong>Message</strong></p><p style="white-space:pre-wrap">${esc(f.message || '(none)')}</p>`,
      });
    } catch (err) {
      req.log.error({ err: (err as Error).name }, 'contact: email not sent');
      return reply.redirect(page('sorry'), 303);
    }
    return reply.redirect(page('thanks'), 303);
  });
}
