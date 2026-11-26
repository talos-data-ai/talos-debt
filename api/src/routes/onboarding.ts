/**
 * Sign-up and onboarding (step 7.5).
 *
 *   POST  /api/signup              a company starts its free trial (no session needed)
 *   GET   /api/onboarding          where the company stands in setting up
 *   PATCH /api/onboarding/:step    save one step: company, owner, bank, rules, debtors
 *   POST  /api/onboarding/files    the company's papers: cr, establishment_contract,
 *                                  iban_letter, authorization (the signed letter)
 *
 * Sign-up goes through auth.sign_up (0010), the only door that may create a
 * company, its owner and the owner's password before anyone is signed in.
 * The company starts in `onboarding`: Talos sends nothing to its debtors
 * until the needed steps (company, owner, authorization) are done, then it
 * becomes `active` (app.setup_missing and app.client_messaging_block, 0010).
 *
 * Only the last four digits of the owner's ID number ever leave the API.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { requireRole, tenantOf, type AuthUser, type Role } from '../auth.js';
import type { Config } from '../config.js';
import { withTenant, type Db } from '../db.js';
import { NAJIZ_MAX_BYTES } from '../legal/readiness.js';
import { phone as normalizePhone, saudiIdCheckDigitOk } from '../intake/normalize.js';
import { PASSWORD_MAX, PASSWORD_MIN, hashPassword, newToken, tokenDigest } from '../login/password.js';
import { RateLimiter } from '../login/routes.js';
import { CSRF_HEADER, sessionCookie } from '../login/session.js';
import { cleanFileName, detectFileType, insertDocumentRow, storeFile, type NewDocument } from '../storage/documents.js';
import type { FileStorage } from '../storage/storage.js';
import { parseOr400 } from '../validation.js';
import { readUpload } from './upload.js';

/** The terms of use people accept at sign-up. Same value as TERMS_VERSION in site/src/legal.ts (a site test checks it). */
export const TERMS_VERSION = '2026-11-25';

const ADMINS: readonly Role[] = ['owner', 'admin'];
export const PLANS = ['follow_up', 'legal', 'najiz'] as const;
export const STEPS = ['company', 'owner', 'bank', 'authorization', 'rules', 'debtors'] as const;
const NEEDED = new Set(['company', 'owner', 'authorization']);
const FILE_KINDS = ['cr', 'establishment_contract', 'iban_letter', 'authorization'] as const;
type FileKind = (typeof FILE_KINDS)[number];
/** Najiz takes PDF files only; the bank letter may also be a photo. */
const PHOTO_OK = new Set<FileKind>(['iban_letter']);

// --------------------------------------------------------------- checks

const name = z.string().trim().min(2, 'Write the full name').max(120);
const email = z.string().trim().toLowerCase().email('Write a full email address').max(254);
const saudiMobile = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const r = normalizePhone(v);
    if (!r.ok || !/^\+9665\d{8}$/.test(r.value)) {
      ctx.addIssue({ code: 'custom', message: 'Write a Saudi mobile number, for example 0501234567' });
      return z.NEVER;
    }
    return r.value;
  });
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const signUpBody = z.object({
  full_name: name,
  phone: saudiMobile,
  email,
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX),
  legal_name: z.string().trim().min(2, 'Write the company name as on the commercial registration').max(200),
  cr_number: z.string().trim().regex(/^\d{10}$/, 'The commercial registration number has 10 digits'),
  plan: z.enum(PLANS),
  period: z.enum(['monthly', 'yearly']),
  accepted_terms: z.literal(true, { error: 'Agree to the terms of use to create your account' }),
});

const companyBody = z.object({
  trade_name: optionalText(200),
  unified_number: z.string().trim().regex(/^7\d{9}$/, 'The unified number has 10 digits and starts with 7'),
  sector: z.enum(['logistics', 'labor_services', 'construction', 'other']),
  activity: optionalText(300),
  vat_number: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^3\d{13}3$/.test(v), 'A VAT number has 15 digits and starts and ends with 3'),
});

const ownerBody = z
  .object({
    name,
    id_type: z.enum(['national_id', 'iqama']),
    id_number: z.string().trim().optional().transform((v) => (v ? v : undefined)),
    phone: saudiMobile,
    email,
  })
  .superRefine((b, ctx) => {
    if (b.id_number === undefined) return;
    const first = b.id_type === 'national_id' ? '1' : '2';
    if (!new RegExp(`^${first}\\d{9}$`).test(b.id_number)) {
      ctx.addIssue({
        code: 'custom',
        path: ['id_number'],
        message: b.id_type === 'national_id' ? 'A national ID number has 10 digits and starts with 1' : 'An iqama number has 10 digits and starts with 2',
      });
    } else if (!saudiIdCheckDigitOk(b.id_number)) {
      ctx.addIssue({ code: 'custom', path: ['id_number'], message: 'This ID number is not valid. Check that no digit is mistyped' });
    }
  });

/** A Saudi IBAN: SA, two check digits and 20 more, and the international check (mod 97) must pass. */
export function ibanOk(iban: string): boolean {
  if (!/^SA\d{22}$/.test(iban)) return false;
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  return BigInt(moved) % 97n === 1n;
}

const bankBody = z.object({
  bank_name: z.string().trim().min(2, 'Choose or write the bank').max(120),
  iban: z
    .string()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .refine((v) => /^SA\d{22}$/.test(v), 'A Saudi IBAN is SA followed by 22 digits')
    .refine(ibanOk, 'This IBAN is not valid. Check that no digit is mistyped'),
});

// ------------------------------------------------------------ the view

interface FileLite {
  name: string;
  size_bytes: string;
  uploaded_at: string;
}

export interface OnboardingView {
  steps: { key: (typeof STEPS)[number]; done: boolean; required: boolean }[];
  status: string;
  plan: string;
  period: string;
  trial_ends_at: string | null;
  company: {
    legal_name: string;
    cr_number: string;
    trade_name: string | null;
    unified_number: string | null;
    sector: string;
    activity: string | null;
    vat_number: string | null;
    cr_file: FileLite | null;
    contract_file: FileLite | null;
  };
  owner: { name: string; phone: string; email: string; id_type: string | null; id_last4: string | null };
  bank: { bank_name: string | null; iban: string | null; letter: FileLite | null };
  authorization: { file: FileLite | null; signed_at: string | null };
  debtors: number;
}

/** Where the company stands. Call inside withTenant. */
export async function loadOnboarding(db: Db): Promise<OnboardingView> {
  const c = (
    await db.query<{
      legal_name: string; cr_number: string; trade_name: string | null; unified_number: string | null; sector: string;
      activity: string | null; vat_number: string | null; owner_name: string; owner_phone: string; owner_email: string;
      owner_id_type: string | null; id_last4: string | null; bank_name: string | null; iban: string | null; plan: string;
      billing_period: string; billing_status: string; trial_ends_at: Date | null; authorization_signed_at: Date | null;
      setup_rules_at: Date | null; setup_debtors_later_at: Date | null; status: string; missing: string[]; debtors: string;
    }>(
      `SELECT c.legal_name, c.cr_number, c.trade_name, c.unified_number, c.sector, c.activity, c.vat_number,
              c.owner_name, c.owner_phone, c.owner_email::text, c.owner_id_type, right(c.owner_id_number, 4) AS id_last4,
              c.bank_name, c.iban, c.plan, c.billing_period, c.billing_status, c.trial_ends_at, c.authorization_signed_at,
              c.setup_rules_at, c.setup_debtors_later_at, c.status, app.setup_missing(c.id) AS missing,
              (SELECT count(*) FROM app.debtors)::text AS debtors
         FROM app.clients c
        WHERE c.id = app.current_client_id()`,
    )
  ).rows[0];
  if (!c) throw new Error('client not found');

  const files = new Map<string, FileLite>();
  const docs = await db.query<{ doc_type: string; file_name: string; size_bytes: string; created_at: Date }>(
    `SELECT DISTINCT ON (doc_type) doc_type, file_name, size_bytes::text, created_at
       FROM app.documents
      WHERE debtor_id IS NULL AND debt_id IS NULL AND instrument_id IS NULL
        AND doc_type = ANY($1::text[])
      ORDER BY doc_type, created_at DESC`,
    [FILE_KINDS],
  );
  for (const d of docs.rows) files.set(d.doc_type, { name: d.file_name, size_bytes: d.size_bytes, uploaded_at: d.created_at.toISOString() });

  const debtors = Number(c.debtors);
  const done: Record<(typeof STEPS)[number], boolean> = {
    company: !c.missing.includes('company'),
    owner: !c.missing.includes('owner'),
    bank: c.iban !== null,
    authorization: !c.missing.includes('authorization'),
    rules: c.setup_rules_at !== null,
    debtors: debtors > 0 || c.setup_debtors_later_at !== null,
  };
  return {
    steps: STEPS.map((key) => ({ key, done: done[key], required: NEEDED.has(key) })),
    status: c.status,
    plan: c.plan,
    period: c.billing_period,
    trial_ends_at: c.billing_status === 'trial' && c.trial_ends_at ? c.trial_ends_at.toISOString() : null,
    company: {
      legal_name: c.legal_name, cr_number: c.cr_number, trade_name: c.trade_name, unified_number: c.unified_number,
      sector: c.sector, activity: c.activity, vat_number: c.vat_number,
      cr_file: files.get('cr') ?? null, contract_file: files.get('establishment_contract') ?? null,
    },
    owner: { name: c.owner_name, phone: c.owner_phone, email: c.owner_email, id_type: c.owner_id_type, id_last4: c.id_last4 },
    bank: { bank_name: c.bank_name, iban: c.iban, letter: files.get('iban_letter') ?? null },
    authorization: { file: files.get('authorization') ?? null, signed_at: c.authorization_signed_at?.toISOString() ?? null },
    debtors,
  };
}

/** Once every needed step is done, the company becomes active and Talos may start messaging. */
async function activateIfReady(db: Db): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE app.clients SET status = 'active'
      WHERE id = app.current_client_id() AND status = 'onboarding' AND cardinality(app.setup_missing(id)) = 0`,
  );
  if (rowCount) {
    await audit(db, 'onboarding.finished', {});
    await db.query(
      `INSERT INTO app.notifications (client_id, kind, title, data)
       VALUES (app.current_client_id(), 'system', 'Setup finished: Talos can now message your debtors', jsonb_build_object('event', 'setup_done'))`,
    );
  }
}

/** Client changes are not covered by the audit triggers, so each step writes its own line. Never the ID number. */
async function audit(db: Db, action: string, details: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO audit.activity_log (client_id, actor_type, actor_id, action, target_table, target_id, details)
     VALUES (app.current_client_id(), 'user', app.current_user_id(), $1, 'app.clients', app.current_client_id(), $2)`,
    [action, details],
  );
}

// -------------------------------------------------------------- routes

export interface SignUpDeps {
  pool: pg.Pool;
  config: Config;
  limiter?: RateLimiter;
}

/** POST /api/signup: open to everyone, so it is limited per address. */
export function signUpRoutes(app: FastifyInstance, deps: SignUpDeps) {
  const { pool, config } = deps;
  const limiter = deps.limiter ?? new RateLimiter(5, 60 * 60_000);

  app.post('/api/signup', async (req, reply) => {
    // The cookie this sets must not be planted by another site.
    if (req.headers[CSRF_HEADER] !== '1') return reply.code(403).send({ error: 'missing_header', message: 'Send x-talos: 1' });
    if (!limiter.allow(req.ip)) return reply.code(429).send({ error: 'too_many', message: 'Too many sign-ups from this address. Try again later.' });
    const body = parseOr400(signUpBody, req.body ?? {}, reply);
    if (!body) return;

    const hash = await hashPassword(body.password);
    let created: { client_id: string; user_id: string };
    try {
      const { rows } = await pool.query<{ client_id: string; user_id: string }>(
        `SELECT client_id, user_id FROM auth.sign_up($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [body.full_name, body.phone, body.email, hash, body.legal_name, body.cr_number, body.plan, body.period,
         TERMS_VERSION, config.TRIAL_DAYS, config.FOUNDING_LIMIT],
      );
      created = rows[0]!;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'TL001') {
        return reply.code(409).send({ error: 'company_exists', message: 'This company already has an account. Ask its owner to invite you.' });
      }
      if (code === 'TL002') {
        return reply.code(409).send({ error: 'email_taken', message: 'This email already has an account. Log in instead.' });
      }
      throw err;
    }

    // Signed in at once, as after a login.
    const t = newToken();
    const maxAge = config.SESSION_MAX_DAYS * 86_400;
    await pool.query(`SELECT auth.create_session($1, $2, now() + make_interval(secs => $3), $4, $5)`, [
      created.user_id, tokenDigest(t), maxAge, req.ip || null, String(req.headers['user-agent'] ?? '').slice(0, 300),
    ]);
    reply.header('set-cookie', sessionCookie(config, t, maxAge));
    return reply.code(201).send({ ok: true });
  });
}

export function onboardingRoutes(app: FastifyInstance, deps: { pool: pg.Pool; storage: FileStorage }) {
  const { pool, storage } = deps;
  const admins = { preHandler: requireRole(ADMINS) };
  const view = (user: AuthUser) => withTenant(pool, tenantOf(user), (db) => loadOnboarding(db));
  const send = async (reply: FastifyReply, user: AuthUser) => reply.send({ onboarding: await view(user) });

  app.get('/api/onboarding', async (req, reply) => send(reply, req.user!));

  app.patch<{ Params: { step: string } }>('/api/onboarding/:step', admins, async (req, reply) => {
    const user = req.user!;
    const step = req.params.step;
    const save = (fn: (db: Db) => Promise<void>) =>
      withTenant(pool, tenantOf(user), async (db) => {
        await fn(db);
        await activateIfReady(db);
        return loadOnboarding(db);
      });

    if (step === 'company') {
      const b = parseOr400(companyBody, req.body ?? {}, reply);
      if (!b) return;
      const onboarding = await save(async (db) => {
        await db.query(
          `UPDATE app.clients SET trade_name = $1, unified_number = $2, sector = $3, activity = $4, vat_number = $5
            WHERE id = app.current_client_id()`,
          [b.trade_name, b.unified_number, b.sector, b.activity, b.vat_number],
        );
        await audit(db, 'onboarding.company', { unified_number: b.unified_number, sector: b.sector });
      });
      return { onboarding };
    }

    if (step === 'owner') {
      const b = parseOr400(ownerBody, req.body ?? {}, reply);
      if (!b) return;
      // Keeping the saved number while changing its type would break the pair.
      const current = await withTenant(pool, tenantOf(user), async (db) =>
        (await db.query<{ owner_id_type: string | null }>(`SELECT owner_id_type FROM app.clients WHERE id = app.current_client_id()`)).rows[0],
      );
      if (!b.id_number && current?.owner_id_type !== b.id_type) {
        return reply.code(400).send({ error: 'invalid', message: 'Write the ID number', errors: [{ field: 'id_number', message: 'Write the ID number' }] });
      }
      const onboarding = await save(async (db) => {
        await db.query(
          `UPDATE app.clients SET owner_name = $1, owner_phone = $2, owner_email = $3, owner_id_type = $4,
                                  owner_id_number = coalesce($5, owner_id_number)
            WHERE id = app.current_client_id()`,
          [b.name, b.phone, b.email, b.id_type, b.id_number ?? null],
        );
        await audit(db, 'onboarding.owner', { id_type: b.id_type, id_changed: Boolean(b.id_number) });
      });
      return { onboarding };
    }

    if (step === 'bank') {
      const b = parseOr400(bankBody, req.body ?? {}, reply);
      if (!b) return;
      const onboarding = await save(async (db) => {
        await db.query(`UPDATE app.clients SET bank_name = $1, iban = $2 WHERE id = app.current_client_id()`, [b.bank_name, b.iban]);
        await audit(db, 'onboarding.bank', { bank_name: b.bank_name, iban_last4: b.iban.slice(-4) });
      });
      return { onboarding };
    }

    if (step === 'rules' || step === 'debtors') {
      const column = step === 'rules' ? 'setup_rules_at' : 'setup_debtors_later_at';
      const onboarding = await save(async (db) => {
        await db.query(`UPDATE app.clients SET ${column} = coalesce(${column}, now()) WHERE id = app.current_client_id()`);
      });
      return { onboarding };
    }

    return reply.code(404).send({ error: 'not_found', message: 'Unknown setup step' });
  });

  app.post('/api/onboarding/files', admins, async (req, reply) => {
    // Read a little more than Najiz takes, so a file just over the limit gets a clear answer.
    const upload = await readUpload(req, reply, NAJIZ_MAX_BYTES * 4);
    if (!upload) return;
    const kind = upload.fields.kind as FileKind;
    if (!FILE_KINDS.includes(kind)) {
      return reply.code(400).send({ error: 'bad_request', message: `kind must be one of: ${FILE_KINDS.join(', ')}` });
    }
    const mime = detectFileType(upload.bytes);
    const allowed = PHOTO_OK.has(kind) ? ['application/pdf', 'image/jpeg', 'image/png'] : ['application/pdf'];
    if (!mime || !allowed.includes(mime)) {
      return reply.code(415).send({
        error: 'unsupported_type',
        message: PHOTO_OK.has(kind) ? 'Upload a PDF or a photo (JPEG or PNG)' : 'Upload a PDF file. Najiz takes PDF files only',
      });
    }
    if (upload.bytes.length > NAJIZ_MAX_BYTES) {
      return reply.code(413).send({ error: 'too_large', message: 'This file is larger than Najiz takes (0.95 MB). Upload a smaller file' });
    }

    const user = req.user!;
    const doc: NewDocument = {
      clientId: user.clientId,
      docType: kind,
      fileName: cleanFileName(upload.fileName, kind),
      mimeType: mime,
      bytes: upload.bytes,
      uploadedBy: user.userId,
    };
    const stored = await storeFile(storage, doc);
    try {
      const onboarding = await withTenant(pool, tenantOf(user), async (db) => {
        await insertDocumentRow(db, doc, stored);
        if (kind === 'authorization') {
          await db.query(`UPDATE app.clients SET authorization_signed_at = now() WHERE id = app.current_client_id()`);
          await audit(db, 'onboarding.authorization', { document_id: stored.id });
        }
        await activateIfReady(db);
        return loadOnboarding(db);
      });
      return reply.code(201).send({ onboarding });
    } catch (err) {
      await storage.remove(stored.storageKey).catch(() => undefined);
      throw err;
    }
  });
}
