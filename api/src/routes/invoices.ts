import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, tenantOf } from '../auth.js';
import type { BillingDeps } from '../billing/billing.js';
import { clientXml, fileName, invoicePdf, type PrintableInvoice } from '../billing/invoice-pdf.js';
import { buyerDetails, invoiceAfterDetails, invoicingOn, missingForInvoice } from '../billing/invoices.js';
import { withTenant, type Db } from '../db.js';
import type { PdfRenderer } from '../legal/pdf.js';
import { parseOr400 } from '../validation.js';

/**
 * Tax invoices (step 7.8), for owners and admins:
 *   GET   /api/billing/invoices            the company's invoices and credit notes, and its invoice details
 *   PATCH /api/billing/details             VAT number and national address, printed on its invoices
 *   GET   /api/billing/invoices/:id/pdf    the invoice to keep and print (with the XML inside)
 *   GET   /api/billing/invoices/:id/xml    the electronic invoice itself
 *
 * A document is given out only once it is ready: cleared by ZATCA, or made
 * while Talos is not connected to ZATCA yet. Another company's invoice is a 404.
 */

const ROLES = ['owner', 'admin'] as const;
const idParams = z.object({ id: z.uuid() });
const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
const detailsBody = z
  .object({
    vat_number: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^3\d{13}3$/.test(v), 'A VAT number has 15 digits and starts and ends with 3'),
    address_building: z.string().trim().regex(/^\d{4}$/, 'The building number has 4 digits'),
    address_street: text(200),
    address_district: text(127),
    address_city: text(127),
    address_postal: z.string().trim().regex(/^\d{5}$/, 'The postal code has 5 digits'),
  })
  .strict();

const READY = `status IN ('generated', 'cleared')`;

export async function invoiceList(db: Db) {
  return (
    await db.query(
      `SELECT i.id, i.kind, i.number, i.issued_at, i.total_amount, i.vat_amount, i.net_amount, i.charge_id,
              CASE WHEN i.status IN ('generated', 'cleared') THEN 'ready' WHEN i.status = 'pending' THEN 'waiting' ELSE 'checking' END AS state,
              o.number AS original_number
         FROM app.invoices i LEFT JOIN app.invoices o ON o.id = i.original_id
        ORDER BY i.icv DESC LIMIT 60`,
    )
  ).rows;
}

export async function invoiceDetails(db: Db, deps: BillingDeps) {
  const b = await buyerDetails(db);
  return {
    enabled: invoicingOn(deps.config),
    details: b,
    missing: missingForInvoice(b),
  };
}

export function invoiceRoutes(app: FastifyInstance, deps: BillingDeps & { pdf: PdfRenderer }) {
  const { pool } = deps;

  app.get('/api/billing/invoices', { preHandler: requireRole(ROLES) }, async (req) =>
    withTenant(pool, tenantOf(req.user!), async (db) => ({ ...(await invoiceDetails(db, deps)), invoices: await invoiceList(db) })),
  );

  app.patch('/api/billing/details', { preHandler: requireRole(ROLES) }, async (req, reply) => {
    const body = parseOr400(detailsBody, req.body, reply);
    if (!body) return;
    const user = req.user!;
    const saved = await withTenant(pool, tenantOf(user), async (db) => {
      await db.query(
        `UPDATE app.clients
            SET vat_number = $1, address_building = $2, address_street = $3, address_district = $4,
                address_city = $5, address_postal = $6, updated_at = now()
          WHERE id = app.current_client_id()`,
        [body.vat_number, body.address_building, body.address_street, body.address_district, body.address_city, body.address_postal],
      );
      return invoiceDetails(db, deps);
    });
    // Payments that waited for these details (or whose invoice ZATCA refused) get their invoice now.
    const issued = await invoiceAfterDetails(deps, user.clientId).catch((err) => {
      req.log.error({ err: (err as Error).message }, 'invoices after new details failed; the scheduler tries again');
      return 0;
    });
    return { ...saved, issued };
  });

  const loadReady = (db: Db, id: string) =>
    db
      .query<PrintableInvoice>(
        `SELECT i.kind, i.number, i.issued_at, to_char(i.supply_start, 'YYYY-MM-DD') AS supply_start,
                to_char(i.supply_end, 'YYYY-MM-DD') AS supply_end, i.net_amount, i.vat_amount, i.total_amount,
                o.number AS original_number, i.reason, i.xml, i.cleared_xml, i.qr
           FROM app.invoices i LEFT JOIN app.invoices o ON o.id = i.original_id
          WHERE i.id = $1 AND i.${READY}`,
        [id],
      )
      .then((r) => r.rows[0]);

  app.get('/api/billing/invoices/:id/pdf', { preHandler: requireRole(ROLES) }, async (req, reply) => {
    const params = parseOr400(idParams, req.params, reply);
    if (!params) return;
    const inv = await withTenant(pool, tenantOf(req.user!), (db) => loadReady(db, params.id));
    if (!inv) return reply.code(404).send({ error: 'not_found', message: 'Invoice not found' });
    const pdf = await invoicePdf(deps.pdf, inv);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${fileName(inv, 'pdf')}"`)
      .header('cache-control', 'private, no-store')
      .send(pdf);
  });

  app.get('/api/billing/invoices/:id/xml', { preHandler: requireRole(ROLES) }, async (req, reply) => {
    const params = parseOr400(idParams, req.params, reply);
    if (!params) return;
    const inv = await withTenant(pool, tenantOf(req.user!), (db) => loadReady(db, params.id));
    if (!inv) return reply.code(404).send({ error: 'not_found', message: 'Invoice not found' });
    return reply
      .header('content-type', 'application/xml; charset=utf-8')
      .header('content-disposition', `attachment; filename="${fileName(inv, 'xml')}"`)
      .header('cache-control', 'private, no-store')
      .send(clientXml(inv));
  });
}
