/**
 * Sign-up and onboarding (step 7.5): a company signs up, is signed in at
 * once, sets itself up step by step, and only becomes active (so Talos may
 * message its debtors) once the needed steps are done.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { RateLimiter } from '../src/login/routes.js';
import { ibanOk, TERMS_VERSION } from '../src/routes/onboarding.js';
import { API_URL, CLIENT, fakeId, multipart, OWNER, PDF, PNG, staff, startApp, type TestApp } from './helpers.js';

let t: TestApp;
let app: FastifyInstance;

beforeAll(async () => {
  t = await startApp();
  // A second app in session mode: sign-up signs the person in with a cookie.
  app = buildApp(
    loadConfig({ NODE_ENV: 'test', DATABASE_URL: API_URL, AUTH_MODE: 'session', STORAGE_LOCAL_DIR: t.storageDir, FOUNDING_LIMIT: '2' }),
    t.pool,
    { storage: t.storage, signUpLimiter: new RateLimiter(1000, 60_000), loginLimiter: new RateLimiter(1000, 60_000) },
  );
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await t?.close();
});

const NEW = {
  full_name: 'Khalid Test Owner',
  phone: '0500000700',
  email: 'khalid@signup.example',
  password: 'a long enough password',
  legal_name: 'Signup Test Company',
  cr_number: '4030000700',
  plan: 'najiz',
  period: 'yearly',
  accepted_terms: true,
};
const csrf = { 'x-talos': '1' };
const signUp = (body: Record<string, unknown>, headers: Record<string, string> = csrf) =>
  app.inject({ method: 'POST', url: '/api/signup', headers, payload: body });
const cookieOf = (res: LightMyRequestResponse) => String(res.headers['set-cookie']).split(';')[0]!;

let cookie = '';
const as = () => ({ cookie, ...csrf });
const get = () => app.inject({ method: 'GET', url: '/api/onboarding', headers: as() });
const patch = (step: string, payload: Record<string, unknown>, headers: Record<string, string> = as()) =>
  app.inject({ method: 'PATCH', url: `/api/onboarding/${step}`, headers, payload });
const upload = (kind: string, file: { name: string; bytes: Buffer }, headers: Record<string, string> = as()) => {
  const body = multipart({ kind }, file);
  return app.inject({ method: 'POST', url: '/api/onboarding/files', headers: { ...headers, ...body.headers }, payload: body.payload });
};
const clientRow = async () =>
  (await t.admin.query(`SELECT * FROM app.clients WHERE cr_number = $1`, [NEW.cr_number])).rows[0];

describe('signing up', () => {
  it('checks every field and needs the terms accepted', async () => {
    const res = await signUp({ ...NEW, phone: '123', cr_number: '12', password: 'short', accepted_terms: false, plan: 'gold' });
    expect(res.statusCode).toBe(400);
    const fields = res.json().errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['phone', 'cr_number', 'password', 'accepted_terms', 'plan']));
  });

  it('is refused without the x-talos header, so another site cannot plant a session', async () => {
    expect((await signUp(NEW, {})).statusCode).toBe(403);
  });

  it('creates the company on its trial, makes the person its owner, and signs them in', async () => {
    const res = await signUp(NEW);
    expect(res.statusCode).toBe(201);
    cookie = cookieOf(res);
    expect(cookie).toMatch(/^talos_session=/);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { role: 'owner', fullName: NEW.full_name }, client: { plan: 'najiz', status: 'onboarding' } });

    const c = await clientRow();
    expect(c).toMatchObject({
      legal_name: NEW.legal_name, owner_phone: '+966500000700', owner_email: NEW.email, plan: 'najiz', billing_period: 'yearly',
      billing_status: 'trial', status: 'onboarding', terms_version: TERMS_VERSION, founding_member: true,
    });
    const days = (c.trial_ends_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    // The password is stored only as a scrypt hash.
    const cred = await t.admin.query(
      `SELECT password_hash FROM auth.credentials c JOIN app.users u ON u.id = c.user_id WHERE u.email = $1`, [NEW.email]);
    expect(cred.rows[0].password_hash).toMatch(/^scrypt\$/);
    // Recorded in the audit log, with the terms version.
    const log = await t.admin.query(`SELECT details FROM audit.activity_log WHERE client_id = $1 AND action = 'auth.sign_up'`, [c.id]);
    expect(log.rows[0].details).toMatchObject({ plan: 'najiz', terms_version: TERMS_VERSION });
  });

  it('the new owner can log in with the password chosen', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: NEW.email, password: NEW.password } });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a company or an email that already has an account', async () => {
    const again = await signUp({ ...NEW, email: 'someone.else@signup.example' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('company_exists');
    const email = await signUp({ ...NEW, cr_number: '4030000701', email: 'OWNER@demo.example' });
    expect(email.statusCode).toBe(409);
    expect(email.json().error).toBe('email_taken');
  });

  it('only the first companies (FOUNDING_LIMIT) are founding members', async () => {
    for (const n of [2, 3]) {
      const res = await signUp({ ...NEW, cr_number: `403000071${n}`, email: `f${n}@signup.example` });
      expect(res.statusCode).toBe(201);
    }
    const { rows } = await t.admin.query(
      `SELECT cr_number, founding_member FROM app.clients WHERE cr_number LIKE '40300007%' ORDER BY created_at`);
    expect(rows.map((r) => r.founding_member)).toEqual([true, true, false]);
  });
});

describe('setting up', () => {
  it('starts with the needed steps missing, and nothing may be sent', async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const o = res.json().onboarding;
    expect(o.steps).toEqual([
      { key: 'company', done: false, required: true },
      { key: 'owner', done: false, required: true },
      { key: 'bank', done: false, required: false },
      { key: 'authorization', done: false, required: true },
      { key: 'rules', done: false, required: false },
      { key: 'debtors', done: false, required: false },
    ]);
    expect(o).toMatchObject({ plan: 'najiz', period: 'yearly', status: 'onboarding', debtors: 0 });
    expect(o.trial_ends_at).toBeTruthy();
    const c = await clientRow();
    const block = await t.admin.query(`SELECT app.client_messaging_block($1) AS b`, [c.id]);
    expect(block.rows[0].b).toBe('setup_not_finished');
  });

  it('company: checks the unified number, and is done only with the commercial registration as a PDF', async () => {
    const bad = await patch('company', { unified_number: '123', sector: 'logistics' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0].field).toBe('unified_number');
    const vat = await patch('company', { unified_number: '7000000700', sector: 'logistics', vat_number: '12345' });
    expect(vat.json().errors[0].field).toBe('vat_number');

    const ok = await patch('company', { trade_name: 'Signup Co', unified_number: '7000000700', sector: 'construction', activity: 'Building', vat_number: '' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().onboarding.company).toMatchObject({ unified_number: '7000000700', sector: 'construction', vat_number: null });
    expect(ok.json().onboarding.steps[0].done).toBe(false); // the commercial registration is still missing

    expect((await upload('cr', { name: 'cr.png', bytes: PNG })).statusCode).toBe(415);
    const big = Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]);
    expect((await upload('cr', { name: 'cr.pdf', bytes: big })).statusCode).toBe(413);
    const up = await upload('cr', { name: 'السجل التجاري.pdf', bytes: PDF });
    expect(up.statusCode).toBe(201);
    expect(up.json().onboarding.company.cr_file).toMatchObject({ name: 'السجل التجاري.pdf' });
    expect(up.json().onboarding.steps[0]).toMatchObject({ key: 'company', done: true });
  });

  it('owner: checks the ID number, and only its last four digits come back', async () => {
    const id = fakeId('1', 700);
    const wrongType = await patch('owner', { name: 'Khalid Owner', id_type: 'iqama', id_number: id, phone: '0500000700', email: NEW.email });
    expect(wrongType.statusCode).toBe(400);
    const typo = await patch('owner', { name: 'Khalid Owner', id_type: 'national_id', id_number: `${id.slice(0, 9)}${(Number(id[9]) + 1) % 10}`, phone: '0500000700', email: NEW.email });
    expect(typo.statusCode).toBe(400);

    const ok = await patch('owner', { name: 'Khalid Owner', id_type: 'national_id', id_number: id, phone: '0500000701', email: NEW.email });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().onboarding.owner).toEqual({
      name: 'Khalid Owner', phone: '+966500000701', email: NEW.email, id_type: 'national_id', id_last4: id.slice(-4),
    });
    expect(ok.body).not.toContain(id);
    // Saving again without the number keeps it.
    const again = await patch('owner', { name: 'Khalid Owner', id_type: 'national_id', phone: '0500000701', email: NEW.email });
    expect(again.json().onboarding.owner.id_last4).toBe(id.slice(-4));
    expect((await clientRow()).owner_id_number).toBe(id);
    // The audit line never holds the number.
    const log = await t.admin.query(`SELECT details::text FROM audit.activity_log WHERE action = 'onboarding.owner'`);
    for (const r of log.rows) expect(r.details).not.toContain(id);
  });

  it('bank: the IBAN must pass the international check', async () => {
    expect(ibanOk('SA0380000000608010167519')).toBe(true);
    expect(ibanOk('SA0380000000608010167518')).toBe(false);
    const bad = await patch('bank', { bank_name: 'Al Rajhi', iban: 'SA03 8000 0000 6080 1016 7518' });
    expect(bad.statusCode).toBe(400);
    const ok = await patch('bank', { bank_name: 'Al Rajhi', iban: 'sa03 8000 0000 6080 1016 7519' });
    expect(ok.json().onboarding.bank).toMatchObject({ bank_name: 'Al Rajhi', iban: 'SA0380000000608010167519' });
    const letter = await upload('iban_letter', { name: 'iban.png', bytes: PNG });
    expect(letter.statusCode).toBe(201);
    expect(letter.json().onboarding.bank.letter).toMatchObject({ name: 'iban.png' });
  });

  it('rules and debtors can be marked done without data', async () => {
    expect((await patch('rules', {})).json().onboarding.steps[4].done).toBe(true);
    expect((await patch('debtors', {})).json().onboarding.steps[5].done).toBe(true);
    expect((await patch('nothing', {})).statusCode).toBe(404);
  });

  it('the signed authorization letter finishes setup: the company becomes active and may message', async () => {
    const before = await get();
    expect(before.json().onboarding.status).toBe('onboarding');
    const res = await upload('authorization', { name: 'authorization.pdf', bytes: PDF });
    expect(res.statusCode).toBe(201);
    const o = res.json().onboarding;
    expect(o.authorization.signed_at).toBeTruthy();
    expect(o.steps.every((s: { done: boolean }) => s.done)).toBe(true);
    expect(o.status).toBe('active');

    const c = await clientRow();
    const block = await t.admin.query(`SELECT app.client_messaging_block($1) AS b`, [c.id]);
    expect(block.rows[0].b).toBeNull();
    const note = await t.admin.query(`SELECT data FROM app.notifications WHERE client_id = $1`, [c.id]);
    expect(note.rows.map((r) => r.data.event)).toContain('setup_done');
  });
});

describe('who may set up', () => {
  it('staff can read where setup stands but cannot change it', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/onboarding', headers: staff })).statusCode).toBe(200);
    const res = await t.app.inject({ method: 'PATCH', url: '/api/onboarding/bank', headers: staff, payload: { bank_name: 'X', iban: 'SA0380000000608010167519' } });
    expect(res.statusCode).toBe(403);
  });

  it('each company sees only its own setup', async () => {
    const owner = { 'x-client-id': CLIENT, 'x-user-id': OWNER };
    const res = await t.app.inject({ method: 'GET', url: '/api/onboarding', headers: owner });
    expect(res.json().onboarding.company.legal_name).not.toBe(NEW.legal_name);
    expect(res.json().onboarding.status).toBe('active');
  });

  it('a change with the cookie needs the x-talos header', async () => {
    const res = await patch('rules', {}, { cookie });
    expect(res.statusCode).toBe(403);
  });
});
