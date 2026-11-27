import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import { fontFaces } from '../legal/pack.js';
import type { PdfRenderer } from '../legal/pdf.js';
import { groupAmount } from './emails.js';
import { saudiTime } from './invoices.js';
import { withDeclaration, type Party } from './zatca/xml.js';

/**
 * The tax invoice (or credit note) as a PDF the client can keep and print:
 * Arabic first with English beside it, the QR code (ZATCA's, once cleared),
 * and the XML itself attached inside the PDF. The XML is the legal document;
 * the PDF shows exactly what it says, read back from it.
 */

export interface PrintableInvoice {
  kind: 'invoice' | 'credit_note';
  number: string;
  issued_at: Date;
  supply_start: string;
  supply_end: string;
  net_amount: string;
  vat_amount: string;
  total_amount: string;
  original_number: string | null;
  reason: string | null;
  xml: string;
  cleared_xml: string | null;
  qr: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#xD;/g, '\r').replace(/&amp;/g, '&');

/** A party as written in the document's own XML. */
export function partyFromXml(xml: string, role: 'AccountingSupplierParty' | 'AccountingCustomerParty'): Party {
  const block = new RegExp(`<cac:${role}>([\\s\\S]*?)</cac:${role}>`).exec(xml)?.[1] ?? '';
  const get = (tag: string) => unxml(new RegExp(`<cbc:${tag}[^>]*>([^<]*)</cbc:${tag}>`).exec(block)?.[1] ?? '');
  return {
    name: get('RegistrationName'),
    vat: get('CompanyID') || null,
    crn: /<cbc:ID schemeID="CRN">([^<]*)</.exec(block)?.[1] ?? '',
    building: get('BuildingNumber'),
    street: get('StreetName'),
    district: get('CitySubdivisionName'),
    city: get('CityName'),
    postal: get('PostalZone'),
  };
}

export function itemFromXml(xml: string): string {
  return unxml(/<cac:Item>\s*<cbc:Name>([^<]*)<\/cbc:Name>/.exec(xml)?.[1] ?? '');
}

export function fileName(inv: Pick<PrintableInvoice, 'number'>, ext: 'pdf' | 'xml') {
  return `${inv.number}.${ext}`;
}

/** The XML the client keeps: ZATCA's stamped copy once cleared, else ours. */
export function clientXml(inv: Pick<PrintableInvoice, 'xml' | 'cleared_xml'>): string {
  return inv.cleared_xml ?? withDeclaration(inv.xml);
}

export async function invoiceHtml(inv: PrintableInvoice): Promise<string> {
  const xml = inv.cleared_xml ?? inv.xml;
  const seller = partyFromXml(xml, 'AccountingSupplierParty');
  const buyer = partyFromXml(xml, 'AccountingCustomerParty');
  const [itemAr, itemEn] = itemFromXml(xml).split(' | ');
  const credit = inv.kind === 'credit_note';
  const issued = saudiTime(inv.issued_at);
  const qr = inv.qr ? await QRCode.toString(inv.qr, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) : '';
  const sar = (a: string) => `<bdi dir="ltr">${groupAmount(a)}</bdi>`;
  const ltr = (s: string) => `<bdi dir="ltr">${esc(s)}</bdi>`;
  const party = (p: Party, ar: string, en: string) => `
    <section class="party">
      <h2>${ar} <span class="en">${en}</span></h2>
      <p class="name">${esc(p.name)}</p>
      <table class="facts">
        ${p.vat ? `<tr><th>الرقم الضريبي <span class="en">VAT number</span></th><td>${ltr(p.vat)}</td></tr>` : ''}
        <tr><th>السجل التجاري <span class="en">Commercial registration</span></th><td>${ltr(p.crn)}</td></tr>
        <tr><th>العنوان الوطني <span class="en">National address</span></th>
            <td>${esc(p.building)}، ${esc(p.street)}، ${esc(p.district)}، ${esc(p.city)} ${ltr(p.postal)}</td></tr>
      </table>
    </section>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
<style>
${fontFaces()}
@page { size: A4; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
body { font-family: 'Plex Arabic', sans-serif; color: #121b33; font-size: 10pt; line-height: 1.5; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #121b33; padding-bottom: 10px; margin-bottom: 14px; gap: 16px; }
h1 { font-size: 19pt; margin: 0; font-weight: 600; }
h1 .en { font-size: 11pt; }
.qr svg { width: 34mm; height: 34mm; display: block; }
.qr p { margin: 4px 0 0; font-size: 7.5pt; color: #646d84; text-align: center; }
h2 { font-size: 10.5pt; font-weight: 600; margin: 0 0 4px; color: #0b7f58; }
.en { font-size: 8pt; color: #646d84; font-weight: 400; }
.meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
.meta td { padding: 3px 8px 3px 0; vertical-align: top; }
.meta th { text-align: start; font-weight: 600; padding: 3px 0; width: 30%; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.party { border: 1px solid #e2e6ee; border-radius: 6px; padding: 10px 12px; }
.party .name { font-weight: 600; margin: 0 0 4px; }
.facts { width: 100%; border-collapse: collapse; font-size: 9pt; }
.facts th { text-align: start; font-weight: 400; color: #47516b; padding: 2px 0; width: 42%; vertical-align: top; }
.facts td { padding: 2px 0; }
.lines { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
.lines th { background: #121b33; color: #fff; font-weight: 600; text-align: start; padding: 6px 8px; }
.lines td { padding: 8px; border-bottom: 1px solid #e2e6ee; vertical-align: top; }
.num { text-align: end; white-space: nowrap; }
.totals { width: 52%; margin-inline-start: auto; border-collapse: collapse; margin-top: 10px; }
.totals th { text-align: start; font-weight: 400; padding: 4px 8px; }
.totals td { text-align: end; padding: 4px 8px; white-space: nowrap; }
.totals tr.grand th, .totals tr.grand td { font-weight: 600; font-size: 11pt; border-top: 2px solid #121b33; }
.note { margin-top: 18px; font-size: 8.5pt; color: #47516b; }
</style></head><body>
<header>
  <div>
    <h1>${credit ? 'إشعار دائن' : 'فاتورة ضريبية'} <span class="en">${credit ? 'Credit note' : 'Tax invoice'}</span></h1>
    <table class="meta">
      <tr><th>الرقم <span class="en">Number</span></th><td>${ltr(inv.number)}</td></tr>
      <tr><th>تاريخ الإصدار <span class="en">Issue date</span></th><td>${ltr(`${issued.date} ${issued.time}`)}</td></tr>
      <tr><th>مدة الخدمة <span class="en">Supply period</span></th><td>${ltr(`${inv.supply_start} to ${inv.supply_end}`)}</td></tr>
      ${credit && inv.original_number ? `<tr><th>الفاتورة الأصلية <span class="en">Original invoice</span></th><td>${ltr(inv.original_number)}</td></tr>` : ''}
      ${credit && inv.reason ? `<tr><th>السبب <span class="en">Reason</span></th><td>${esc(inv.reason)}</td></tr>` : ''}
    </table>
  </div>
  ${qr ? `<div class="qr">${qr}<p>رمز الفاتورة | Invoice QR code</p></div>` : ''}
</header>
<div class="parties">
  ${party(seller, 'البائع', 'Seller')}
  ${party(buyer, 'المشتري', 'Buyer')}
</div>
<table class="lines">
  <thead><tr>
    <th>الوصف <span class="en">Description</span></th>
    <th class="num">الكمية <span class="en">Qty</span></th>
    <th class="num">سعر الوحدة <span class="en">Unit price</span></th>
    <th class="num">الضريبة <span class="en">VAT</span></th>
    <th class="num">المبلغ دون ضريبة <span class="en">Net</span></th>
  </tr></thead>
  <tbody><tr>
    <td>${esc(itemAr ?? '')}<span class="en">${esc(itemEn ?? '')}</span></td>
    <td class="num">1</td>
    <td class="num">${sar(inv.net_amount)}</td>
    <td class="num">15%</td>
    <td class="num">${sar(inv.net_amount)}</td>
  </tr></tbody>
</table>
<table class="totals">
  <tr><th>الإجمالي دون ضريبة <span class="en">Total without VAT</span></th><td>${sar(inv.net_amount)} SAR</td></tr>
  <tr><th>ضريبة القيمة المضافة 15% <span class="en">VAT 15%</span></th><td>${sar(inv.vat_amount)} SAR</td></tr>
  <tr class="grand"><th>${credit ? 'إجمالي المبلغ المسترد' : 'الإجمالي شامل الضريبة'} <span class="en">${credit ? 'Total refunded' : 'Total with VAT'}</span></th><td>${sar(inv.total_amount)} SAR</td></tr>
</table>
<p class="note">${credit ? 'هذا الإشعار يخفض مبلغ الفاتورة الأصلية.' : 'دُفعت هذه الفاتورة بالبطاقة.'} <span class="en">${credit ? 'This credit note reduces the original invoice.' : 'This invoice was paid by card.'} The XML file attached to this PDF is the electronic invoice.</span></p>
</body></html>`;
}

export async function invoicePdf(render: PdfRenderer, inv: PrintableInvoice): Promise<Buffer> {
  const pdf = await PDFDocument.load(await render.htmlToPdf(await invoiceHtml(inv)));
  pdf.setTitle(`${inv.kind === 'credit_note' ? 'Credit note' : 'Tax invoice'} ${inv.number}`);
  pdf.setProducer('Talos');
  pdf.setCreationDate(inv.issued_at);
  pdf.setModificationDate(inv.issued_at);
  await pdf.attach(Buffer.from(clientXml(inv), 'utf8'), fileName(inv, 'xml'), {
    mimeType: 'application/xml',
    description: 'Electronic invoice (UBL 2.1, ZATCA)',
    creationDate: inv.issued_at,
    modificationDate: inv.issued_at,
  });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
