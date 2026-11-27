/**
 * Connects Talos to ZATCA's e-invoicing system (Fatoora) as one invoicing
 * unit (step 7.8b). Run it once per system, on a machine that can reach
 * ZATCA, with Talos's details in the environment (SELLER_*):
 *
 *   npm run zatca:onboard -- --mode sandbox
 *   npm run zatca:onboard -- --mode simulation --otp 123456
 *   npm run zatca:onboard -- --mode core --otp 123456
 *
 * The OTP comes from the Fatoora portal (fatoora.zatca.gov.sa, "Onboard new
 * solution unit"); it lasts one hour. The sandbox needs none.
 *
 * Steps: a new private key and a certificate request (openssl), the
 * compliance certificate (with the OTP), ZATCA's compliance checks (a
 * standard invoice, a credit note and a debit note, made by the same code as
 * the real ones), then the production certificate. At the end it prints
 * ZATCA_CSID_TOKEN and ZATCA_CSID_SECRET once: put them straight into the
 * secret manager. The private key is written to --out (only readable by you);
 * keep it in the secret manager too, and delete the folder.
 *
 * Nothing is written to the database, and nothing here is a real invoice.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZATCA_URLS } from '../src/billing/zatca/client.js';
import { documentXml, FIRST_PIH, invoiceHash, withDeclaration, type Party, type TaxDocument } from '../src/billing/zatca/xml.js';

type Mode = keyof typeof ZATCA_URLS;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const mode = (arg('mode') ?? 'sandbox') as Mode;
if (!(mode in ZATCA_URLS)) throw new Error('--mode must be sandbox, simulation or core');
// ZATCA's sandbox takes a fixed OTP; the others need the one from the Fatoora portal.
const otp = arg('otp') ?? (mode === 'sandbox' ? '123345' : undefined);
if (!otp || !/^\d{6}$/.test(otp)) throw new Error('--otp with the 6 digits from the Fatoora portal is required');
const base = (process.env.ZATCA_API_URL ?? ZATCA_URLS[mode]).replace(/\/+$/, '');

const env = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} is missing: set Talos's details (SELLER_*) first`);
  return v;
};
const seller: Party = {
  name: env('SELLER_NAME'), vat: env('SELLER_VAT_NUMBER'), crn: env('SELLER_CR'), building: env('SELLER_BUILDING'),
  street: env('SELLER_STREET'), district: env('SELLER_DISTRICT'), city: env('SELLER_CITY'), postal: env('SELLER_POSTAL'),
};
if (!/^3\d{13}3$/.test(seller.vat!)) throw new Error('SELLER_VAT_NUMBER must have 15 digits and start and end with 3');

const out = arg('out') ?? mkdtempSync(path.join(tmpdir(), 'zatca-'));
mkdirSync(out, { recursive: true });
chmodSync(out, 0o700);

// ------------------------------------------------------------------ 1. key and certificate request
const template = { sandbox: 'TSTZATCA-Code-Signing', simulation: 'PREZATCA-Code-Signing', core: 'ZATCA-Code-Signing' }[mode];
const unit = randomUUID();
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '').trim() || 'Talos';
const cnf = `oid_section = OIDs
[OIDs]
certificateTemplateName = 1.3.6.1.4.1.311.20.2

[req]
default_md = sha256
prompt = no
utf8 = yes
distinguished_name = dn
req_extensions = req_ext

[dn]
C = SA
OU = ${ascii(seller.name)}
O = ${ascii(seller.name)}
CN = Talos-Debt-${unit.slice(0, 8)}

[req_ext]
certificateTemplateName = ASN1:PRINTABLESTRING:${template}
subjectAltName = dirName:alt_names

[alt_names]
SN = 1-Talos|2-Debt|3-${unit}
UID = ${seller.vat}
title = 1000
registeredAddress = ${ascii(`${seller.building} ${seller.street} ${seller.city}`)}
businessCategory = Software services
`;
writeFileSync(path.join(out, 'csr.cnf'), cnf);
const key = path.join(out, 'private-key.pem');
execFileSync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', key]);
chmodSync(key, 0o600);
execFileSync('openssl', ['req', '-new', '-sha256', '-key', key, '-config', path.join(out, 'csr.cnf'), '-out', path.join(out, 'request.csr')]);
const csr = Buffer.from(readFileSync(path.join(out, 'request.csr'))).toString('base64');
console.log(`1. Key and certificate request made in ${out} (unit ${unit}, template ${template}).`);

// ------------------------------------------------------------------ helpers
async function call(p: string, body: object, headers: Record<string, string>) {
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'accept-version': 'V2', 'accept-language': 'en', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}
const basic = (token: string, secret: string) => ({ authorization: `Basic ${Buffer.from(`${token}:${secret}`).toString('base64')}` });
const fail = (step: string, r: { status: number; data: unknown }) => {
  console.error(`${step} failed (${r.status}):\n${JSON.stringify(r.data, null, 2).slice(0, 3000)}`);
  process.exit(1);
};

// ------------------------------------------------------------------ 2. compliance certificate
const compliance = await call('/compliance', { csr }, { otp });
if (compliance.status !== 200 || !compliance.data.binarySecurityToken) fail('2. Compliance certificate', compliance);
const cToken = String(compliance.data.binarySecurityToken);
const cSecret = String(compliance.data.secret);
const requestId = String(compliance.data.requestID);
console.log(`2. Compliance certificate received (request ${requestId}).`);

// ------------------------------------------------------------------ 3. compliance checks
const buyer: Party = { name: 'شركة اختبار', vat: null, crn: '1010101010', building: '7788', street: 'شارع الاختبار', district: 'الروضة', city: 'جدة', postal: '23435' };
const now = new Date(Date.now() - 60_000);
const day = now.toISOString().slice(0, 10);
const time = new Date(now.getTime() + 3 * 3600_000).toISOString().slice(11, 19); // Saudi time
let pih = FIRST_PIH;
const kinds: TaxDocument['kind'][] = ['invoice', 'credit_note', 'debit_note'];
for (const [i, kind] of kinds.entries()) {
  const d: TaxDocument = {
    kind, number: `TEST-${i + 1}`, uuid: randomUUID(), icv: String(i + 1), pih, issueDate: day, issueTime: time,
    supplyStart: day, supplyEnd: day, seller, buyer, itemName: 'اشتراك تجريبي | Test subscription',
    net: '100.00', vat: '15.00', total: '115.00',
    ...(kind === 'invoice' ? {} : { originalNumber: 'TEST-1', reason: 'تعديل | Correction' }),
  };
  const xml = documentXml(d);
  const hash = invoiceHash(xml);
  const r = await call('/compliance/invoices', { invoiceHash: hash, uuid: d.uuid, invoice: Buffer.from(withDeclaration(xml)).toString('base64') }, basic(cToken, cSecret));
  const v = r.data.validationResults as { status?: string; warningMessages?: unknown[] } | undefined;
  if (r.status !== 200 && r.status !== 202) fail(`3. Compliance check of the ${kind.replace('_', ' ')}`, r);
  console.log(`3. ${kind.replace('_', ' ')}: ${String(r.data.clearanceStatus ?? v?.status)}${v?.warningMessages?.length ? ` with ${v.warningMessages.length} warning(s)` : ''}`);
  pih = hash;
}

// ------------------------------------------------------------------ 4. production certificate
const production = await call('/production/csids', { compliance_request_id: requestId }, basic(cToken, cSecret));
if (production.status !== 200 || !production.data.binarySecurityToken) fail('4. Production certificate', production);
console.log('4. Production certificate received. Put these two values in the secret manager now; they are not shown again:\n');
console.log(`ZATCA_MODE=${mode}`);
console.log(`ZATCA_CSID_TOKEN=${String(production.data.binarySecurityToken)}`);
console.log(`ZATCA_CSID_SECRET=${String(production.data.secret)}`);
console.log(`\nThe private key is in ${key}: keep it in the secret manager too, then delete ${out}.`);
