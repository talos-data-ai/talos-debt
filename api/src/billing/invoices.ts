import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { withTenant, type Db } from '../db.js';
import { audit, billingLink, notify, recipients, sendMails, type BillingDeps, type PendingMail } from './billing.js';
import { PERIOD, PLAN } from './emails.js';
import { fromHalalas, splitTotal, toHalalas, type Period, type Plan } from './pricing.js';
import { ZatcaUnavailable } from './zatca/client.js';
import { basicQr, qrFromXml } from './zatca/qr.js';
import { documentXml, invoiceHash, withDeclaration, type Party, type TaxDocument } from './zatca/xml.js';

/**
 * Talos's tax invoices to its clients (step 7.8).
 *
 * Every paid subscription charge gets one standard tax invoice; a refund gets
 * a credit note. Each document takes the next link of one chain (counter and
 * previous hash, app.invoice_chain), is written as ZATCA's XML and saved in
 * the same transaction, so the chain never skips or repeats.
 *
 * Then, outside any transaction, it is sent to ZATCA for clearance. Only a
 * cleared document reaches the client (with ZATCA's QR code). If ZATCA cannot
 * be reached, the same document is sent again later; if ZATCA refuses it, it
 * stays refused, Talos is told, and a new one can be issued once the details
 * are fixed. With ZATCA_MODE=off (before Talos is connected to Fatoora) the
 * document is ready at once, with the basic QR code.
 *
 * Nothing here ever changes a payment: a payment is kept even if its invoice
 * cannot be made yet.
 */

export interface InvoiceRow {
  id: string;
  client_id: string;
  kind: 'invoice' | 'credit_note';
  number: string;
  icv: string;
  status: 'generated' | 'pending' | 'cleared' | 'rejected';
  total_amount: string;
  vat_amount: string;
  net_amount: string;
}

/** Invoices are made only once Talos's VAT number and details are set. */
export const invoicingOn = (config: Config) => Boolean(config.SELLER_VAT_NUMBER);

/** Paid charges older than this never get an invoice made late. */
const CATCH_UP_DAYS = 30;
/** Waiting time before sending a document again after ZATCA could not be reached: doubles, at most 6 hours. */
export const retryMinutes = (tries: number) => Math.min(2 ** Math.max(tries, 1), 360);

export function sellerOf(config: Config): Party {
  return {
    name: config.SELLER_NAME!,
    vat: config.SELLER_VAT_NUMBER!,
    crn: config.SELLER_CR!,
    building: config.SELLER_BUILDING!,
    street: config.SELLER_STREET!,
    district: config.SELLER_DISTRICT!,
    city: config.SELLER_CITY!,
    postal: config.SELLER_POSTAL!,
  };
}

export interface BuyerDetails {
  legal_name: string;
  cr_number: string;
  vat_number: string | null;
  address_building: string | null;
  address_street: string | null;
  address_district: string | null;
  address_city: string | null;
  address_postal: string | null;
}

/** What the client still has to give before its invoices can be made. */
export function missingForInvoice(b: BuyerDetails): string[] {
  const out: string[] = [];
  if (!/^\d{4}$/.test(b.address_building ?? '')) out.push('address_building');
  if (!b.address_street?.trim()) out.push('address_street');
  if (!b.address_district?.trim()) out.push('address_district');
  if (!b.address_city?.trim()) out.push('address_city');
  if (!/^\d{5}$/.test(b.address_postal ?? '')) out.push('address_postal');
  return out;
}

export async function buyerDetails(db: Db): Promise<BuyerDetails> {
  return (
    await db.query<BuyerDetails>(
      `SELECT legal_name, cr_number, vat_number, address_building, address_street, address_district, address_city, address_postal
         FROM app.clients WHERE id = app.current_client_id()`,
    )
  ).rows[0]!;
}

function buyerParty(b: BuyerDetails): Party {
  return {
    name: b.legal_name,
    vat: b.vat_number,
    crn: b.cr_number,
    building: b.address_building!,
    street: b.address_street!,
    district: b.address_district!,
    city: b.address_city!,
    postal: b.address_postal!,
  };
}

/** Saudi date and time, as printed and as written in the XML. */
export function saudiTime(d: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export function itemName(plan: Plan, period: Period): string {
  return `اشتراك تالوس لتحصيل الديون، باقة ${PLAN.ar[plan]}، ${PERIOD.ar[period]} | Talos Debt Collection subscription, ${PLAN.en[plan]} plan, ${PERIOD.en[period]}`;
}

interface NewDocument {
  kind: 'invoice' | 'credit_note';
  chargeId: string;
  original: { id: string; number: string } | null;
  reason: string | null;
  supplyStart: string;
  supplyEnd: string;
  buyer: Party;
  itemName: string;
  net: string;
  vat: string;
  total: string;
}

/** Takes the next link of the chain and saves the document. Inside a transaction, as the system. */
async function issueDocument(deps: BillingDeps, db: Db, d: NewDocument, now: Date): Promise<InvoiceRow> {
  const chain = (await db.query<{ icv: string; pih: string }>(`SELECT icv::text AS icv, pih FROM app.invoice_chain_next()`)).rows[0]!;
  const prefix = deps.config.INVOICE_PREFIX;
  const number = `${prefix}${d.kind === 'credit_note' ? '-CN' : ''}-${chain.icv.padStart(6, '0')}`;
  const { date, time } = saudiTime(now);
  const seller = sellerOf(deps.config);
  const doc: TaxDocument = {
    kind: d.kind,
    number,
    uuid: randomUUID(),
    icv: chain.icv,
    pih: chain.pih,
    issueDate: date,
    issueTime: time,
    supplyStart: d.supplyStart,
    supplyEnd: d.supplyEnd,
    seller,
    buyer: d.buyer,
    itemName: d.itemName,
    net: d.net,
    vat: d.vat,
    total: d.total,
    originalNumber: d.original?.number,
    reason: d.reason ?? undefined,
  };
  const xml = documentXml(doc);
  const hash = invoiceHash(xml);
  const zatca = deps.zatca ?? null;
  const qr = zatca ? null : basicQr({ sellerName: seller.name, vatNumber: seller.vat!, timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'), total: d.total, vat: d.vat });
  const row = (
    await db.query<InvoiceRow>(
      `INSERT INTO app.invoices (id, client_id, kind, number, icv, pih, invoice_hash, charge_id, original_id, reason, issued_at,
                                 supply_start, supply_end, net_amount, vat_amount, total_amount, buyer, xml, zatca_mode, status, qr)
       VALUES ($1, app.current_client_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id, client_id, kind, number, icv::text AS icv, status, total_amount, vat_amount, net_amount`,
      [
        doc.uuid, d.kind, number, chain.icv, chain.pih, hash, d.chargeId, d.original?.id ?? null, d.reason, now,
        d.supplyStart, d.supplyEnd, d.net, d.vat, d.total, JSON.stringify(d.buyer), xml,
        zatca?.mode ?? 'off', zatca ? 'pending' : 'generated', qr,
      ],
    )
  ).rows[0]!;
  await db.query(`SELECT app.invoice_chain_save($1, $2)`, [chain.icv, hash]);
  await audit(db, d.kind === 'invoice' ? 'invoice.issued' : 'invoice.credit_note', { invoice_id: row.id, number, icv: chain.icv, charge_id: d.chargeId });
  return row;
}

export type IssueOutcome =
  | { status: 'issued' | 'exists'; invoice: InvoiceRow }
  | { status: 'missing_details'; missing: string[] }
  | { status: 'off' | 'not_paid' | 'too_old' };

/**
 * Makes the tax invoice of a paid charge, then sends it to ZATCA. Safe to
 * call twice: a charge has one invoice (unless ZATCA refused it). With
 * `tellIfMissing`, a client without its national address is told once.
 */
export async function invoiceCharge(deps: BillingDeps, clientId: string, chargeId: string, tellIfMissing = false): Promise<IssueOutcome> {
  if (!invoicingOn(deps.config)) return { status: 'off' };
  const now = deps.now();
  const mails: PendingMail[] = [];
  const out = await withTenant(deps.pool, { clientId, actorType: 'system' }, async (db): Promise<IssueOutcome> => {
    // Locking the charge makes two workers wait for each other here.
    const ch = (
      await db.query<{ id: string; plan: Plan; billing_period: Period; amount: string; vat_amount: string; period_start: Date; period_end: Date; finished_at: Date }>(
        `SELECT id, plan, billing_period, amount, vat_amount, period_start, period_end, finished_at
           FROM app.billing_charges WHERE id = $1 AND status = 'paid' FOR UPDATE`,
        [chargeId],
      )
    ).rows[0];
    if (!ch) return { status: 'not_paid' };
    const existing = (
      await db.query<InvoiceRow>(
        `SELECT id, client_id, kind, number, icv::text AS icv, status, total_amount, vat_amount, net_amount
           FROM app.invoices WHERE charge_id = $1 AND kind = 'invoice' AND status <> 'rejected'`,
        [chargeId],
      )
    ).rows[0];
    if (existing) return { status: 'exists', invoice: existing };
    if (ch.finished_at.getTime() < now.getTime() - CATCH_UP_DAYS * 86_400_000) return { status: 'too_old' };

    const b = await buyerDetails(db);
    const missing = missingForInvoice(b);
    if (missing.length) {
      if (tellIfMissing) {
        await notify(db, now, 'Add your national address for your tax invoice', { event: 'invoice_details_needed', charge_id: chargeId });
        mails.push({ to: await recipients(db), kind: 'invoice_details_needed', facts: { link: billingLink(deps.config), timezone: 'Asia/Riyadh' } });
      }
      return { status: 'missing_details', missing };
    }
    const vat = ch.vat_amount;
    const net = fromHalalas(toHalalas(ch.amount) - toHalalas(vat));
    const start = saudiTime(ch.period_start).date;
    const end = saudiTime(new Date(ch.period_end.getTime() - 1000)).date;
    const invoice = await issueDocument(
      deps,
      db,
      {
        kind: 'invoice', chargeId, original: null, reason: null, supplyStart: start, supplyEnd: end < start ? start : end,
        buyer: buyerParty(b), itemName: itemName(ch.plan, ch.billing_period), net, vat, total: ch.amount,
      },
      now,
    );
    if (invoice.status === 'generated') await ready(deps, db, invoice, now, mails);
    return { status: 'issued', invoice };
  });
  await sendMails(deps, mails);
  if (out.status === 'issued' && out.invoice.status === 'pending') await submitInvoice(deps, clientId, out.invoice.id);
  return out;
}

/** The client's document is ready: a notification and an email. */
async function ready(deps: BillingDeps, db: Db, inv: InvoiceRow, now: Date, mails: PendingMail[]) {
  const credit = inv.kind === 'credit_note';
  await notify(db, now, `${credit ? 'Credit note' : 'Tax invoice'} ${inv.number}`, {
    event: credit ? 'credit_note_ready' : 'invoice_ready',
    number: inv.number,
    amount: inv.total_amount,
    invoice_id: inv.id,
  });
  mails.push({
    to: await recipients(db),
    kind: credit ? 'credit_note_ready' : 'invoice_ready',
    facts: { link: billingLink(deps.config), timezone: 'Asia/Riyadh', number: inv.number, amount: inv.total_amount },
  });
}

export type SubmitOutcome = 'cleared' | 'rejected' | 'pending' | 'not_pending' | 'off';

/** Sends a waiting document to ZATCA and saves the answer. Never inside a transaction. */
export async function submitInvoice(deps: BillingDeps, clientId: string, invoiceId: string): Promise<SubmitOutcome> {
  const zatca = deps.zatca;
  if (!zatca) return 'off';
  const ctx = { clientId, actorType: 'system' as const };
  const now = deps.now();
  // Claim it: another worker that sent it less than 2 minutes ago keeps it.
  const inv = await withTenant(deps.pool, ctx, async (db) =>
    (
      await db.query<{ id: string; xml: string; invoice_hash: string }>(
        `UPDATE app.invoices SET submitted_at = $2, submit_tries = submit_tries + 1
          WHERE id = $1 AND status = 'pending' AND (submitted_at IS NULL OR submitted_at < $2::timestamptz - interval '2 minutes')
          RETURNING id, xml, invoice_hash`,
        [invoiceId, now],
      )
    ).rows[0],
  );
  if (!inv) return 'not_pending';

  let answer;
  try {
    answer = await zatca.clear({ uuid: inv.id, invoiceHash: inv.invoice_hash, xml: withDeclaration(inv.xml) });
  } catch (err) {
    if (err instanceof ZatcaUnavailable) {
      deps.log?.error({ invoice: inv.id, err: err.message }, 'ZATCA not reached; the invoice will be sent again');
      return 'pending';
    }
    throw err;
  }

  const mails: PendingMail[] = [];
  const done = await withTenant(deps.pool, ctx, async (db): Promise<SubmitOutcome> => {
    if (answer.status === 'cleared') {
      const row = (
        await db.query<InvoiceRow>(
          `UPDATE app.invoices SET status = 'cleared', cleared_xml = $2, qr = $3, cleared_at = $4, zatca_messages = $5
            WHERE id = $1 AND status = 'pending'
            RETURNING id, client_id, kind, number, icv::text AS icv, status, total_amount, vat_amount, net_amount`,
          [inv.id, answer.clearedXml, qrFromXml(answer.clearedXml), deps.now(), JSON.stringify({ warnings: answer.warnings })],
        )
      ).rows[0];
      if (!row) return 'not_pending';
      if (!qrFromXml(answer.clearedXml)) deps.log?.error({ invoice: inv.id }, 'cleared invoice has no QR code');
      await ready(deps, db, row, deps.now(), mails);
      return 'cleared';
    }
    const row = (
      await db.query<{ number: string }>(
        `UPDATE app.invoices SET status = 'rejected', zatca_messages = $2 WHERE id = $1 AND status = 'pending' RETURNING number`,
        [inv.id, JSON.stringify({ errors: answer.errors, warnings: answer.warnings })],
      )
    ).rows[0];
    if (!row) return 'not_pending';
    await notify(db, deps.now(), `Tax invoice ${row.number} needs checking`, { event: 'invoice_rejected', number: row.number, invoice_id: inv.id });
    return 'rejected';
  });
  // Talos must look at every refused document: it is a mistake in the invoice or in the client's details.
  if (done === 'rejected') deps.log?.error({ invoice: inv.id, errors: answer.status === 'rejected' ? answer.errors : [] }, 'ZATCA refused an invoice');
  await sendMails(deps, mails);
  return done;
}

export type CreditOutcome = { status: 'issued'; invoice: InvoiceRow } | { status: 'nothing' | 'no_invoice' | 'off' | 'not_split' };

/**
 * A refund was made at the payment provider: issues a credit note for what
 * was given back and is not yet covered by an earlier credit note.
 */
export async function creditRefund(deps: BillingDeps, clientId: string, chargeId: string, refunded: bigint): Promise<CreditOutcome> {
  if (!invoicingOn(deps.config)) return { status: 'off' };
  const now = deps.now();
  const mails: PendingMail[] = [];
  const out = await withTenant(deps.pool, { clientId, actorType: 'system' }, async (db): Promise<CreditOutcome> => {
    await db.query(`SELECT 1 FROM app.billing_charges WHERE id = $1 FOR UPDATE`, [chargeId]);
    const inv = (
      await db.query<{ id: string; number: string; buyer: Party; supply_start: string; supply_end: string; plan: Plan; billing_period: Period }>(
        `SELECT i.id, i.number, i.buyer, to_char(i.supply_start, 'YYYY-MM-DD') AS supply_start, to_char(i.supply_end, 'YYYY-MM-DD') AS supply_end,
                ch.plan, ch.billing_period
           FROM app.invoices i JOIN app.billing_charges ch ON ch.id = i.charge_id
          WHERE i.charge_id = $1 AND i.kind = 'invoice' AND i.status IN ('generated', 'cleared')`,
        [chargeId],
      )
    ).rows[0];
    if (!inv) return { status: 'no_invoice' };
    const credited = (
      await db.query<{ total: string }>(
        `SELECT coalesce(sum(total_amount), 0)::text AS total FROM app.invoices
          WHERE original_id = $1 AND kind = 'credit_note' AND status <> 'rejected'`,
        [inv.id],
      )
    ).rows[0]!.total;
    const due = refunded - toHalalas(credited);
    if (due <= 0n) return { status: 'nothing' };
    const split = splitTotal(due);
    if (!split) return { status: 'not_split' };
    const note = await issueDocument(
      deps,
      db,
      {
        kind: 'credit_note', chargeId, original: { id: inv.id, number: inv.number },
        reason: `استرداد مبلغ من الاشتراك | Refund of subscription payment (${inv.number})`,
        supplyStart: inv.supply_start, supplyEnd: inv.supply_end, buyer: inv.buyer,
        itemName: itemName(inv.plan, inv.billing_period),
        net: fromHalalas(split.net), vat: fromHalalas(split.vat), total: fromHalalas(due),
      },
      now,
    );
    if (note.status === 'generated') await ready(deps, db, note, now, mails);
    return { status: 'issued', invoice: note };
  });
  await sendMails(deps, mails);
  if (out.status === 'not_split' || out.status === 'no_invoice') {
    deps.log?.error({ charge: chargeId, refunded: refunded.toString(), why: out.status }, 'refund needs a credit note made by hand');
  }
  if (out.status === 'issued' && out.invoice.status === 'pending') await submitInvoice(deps, clientId, out.invoice.id);
  return out;
}

export interface InvoiceRound {
  issued: number;
  sent: number;
}

/**
 * Run by the scheduler every round: makes invoices that were missed (a crash
 * after the payment, or a national address added later) and sends documents
 * still waiting for ZATCA again.
 */
export async function runInvoices(deps: BillingDeps): Promise<InvoiceRound> {
  const result: InvoiceRound = { issued: 0, sent: 0 };
  const worker = deps.workerPool;
  if (!worker || !invoicingOn(deps.config)) return result;
  const now = deps.now();

  const missed = (
    await worker.query<{ id: string; client_id: string }>(
      `SELECT ch.id, ch.client_id FROM app.billing_charges ch
        WHERE ch.status = 'paid' AND ch.finished_at > $1::timestamptz - make_interval(days => $2)
          AND NOT EXISTS (SELECT 1 FROM app.invoices i WHERE i.charge_id = ch.id AND i.kind = 'invoice')
          AND EXISTS (SELECT 1 FROM app.clients c WHERE c.id = ch.client_id AND c.address_postal IS NOT NULL)
        ORDER BY ch.finished_at LIMIT 50`,
      [now, CATCH_UP_DAYS],
    )
  ).rows;
  for (const m of missed) {
    try {
      const out = await invoiceCharge(deps, m.client_id, m.id);
      if (out.status === 'issued') result.issued++;
    } catch (err) {
      deps.log?.error({ charge: m.id, err: (err as Error).message }, 'invoice could not be made');
    }
  }

  if (deps.zatca) {
    const waiting = (
      await worker.query<{ id: string; client_id: string }>(
        `SELECT id, client_id FROM app.invoices
          WHERE status = 'pending'
            AND (submitted_at IS NULL OR submitted_at <= $1::timestamptz - make_interval(mins => least(power(2, greatest(submit_tries, 1)), 360)::int))
          ORDER BY icv LIMIT 50`,
        [now],
      )
    ).rows;
    for (const w of waiting) {
      try {
        const out = await submitInvoice(deps, w.client_id, w.id);
        if (out === 'cleared' || out === 'rejected') result.sent++;
      } catch (err) {
        deps.log?.error({ invoice: w.id, err: (err as Error).message }, 'invoice could not be sent');
      }
    }
  }
  return result;
}

/** After the client fixed its details: a new invoice for every payment whose invoice ZATCA refused or that has none yet. */
export async function invoiceAfterDetails(deps: BillingDeps, clientId: string): Promise<number> {
  if (!invoicingOn(deps.config)) return 0;
  const now = deps.now();
  const charges = await withTenant(deps.pool, { clientId, actorType: 'system' }, async (db) =>
    (
      await db.query<{ id: string }>(
        `SELECT ch.id FROM app.billing_charges ch
          WHERE ch.status = 'paid' AND ch.finished_at > $1::timestamptz - make_interval(days => $2)
            AND NOT EXISTS (SELECT 1 FROM app.invoices i WHERE i.charge_id = ch.id AND i.kind = 'invoice' AND i.status <> 'rejected')
          ORDER BY ch.finished_at`,
        [now, CATCH_UP_DAYS],
      )
    ).rows,
  );
  let n = 0;
  for (const c of charges) if ((await invoiceCharge(deps, clientId, c.id)).status === 'issued') n++;
  return n;
}
