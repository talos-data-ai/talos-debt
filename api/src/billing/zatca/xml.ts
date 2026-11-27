import { createHash } from 'node:crypto';

/**
 * Talos's tax invoices and credit notes as ZATCA wants them (step 7.8):
 * UBL 2.1 XML, "standard" documents (KSA-2 = 0100000), because Talos's
 * clients are companies. Standard documents are cleared by ZATCA, which adds
 * its own cryptographic stamp and QR code, so Talos does not sign them.
 *
 * The XML is written already in canonical form (C14N 1.1: no XML declaration
 * in the hashed part, attributes in order, no empty-element shorthand, only
 * &, <, > and carriage returns escaped in text), so the invoice hash is the
 * SHA-256 of exactly these bytes. A test checks this with a real
 * canonicaliser. Element order follows the UBL 2.1 schema.
 *
 * Amounts stay text ("1150.00"), never JavaScript numbers.
 */

/** The hash ZATCA uses before the first invoice of a unit: base64 of the SHA-256 of "0". */
export const FIRST_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

export interface Party {
  name: string;
  /** 15 digits, first and last 3. Required for the seller; optional for a buyer. */
  vat: string | null;
  /** Commercial registration number. */
  crn: string;
  building: string;
  street: string;
  district: string;
  city: string;
  postal: string;
}

export interface TaxDocument {
  /** Debit notes are only used for ZATCA's onboarding checks. */
  kind: 'invoice' | 'credit_note' | 'debit_note';
  number: string;
  uuid: string;
  icv: string;
  pih: string;
  /** Saudi time, YYYY-MM-DD and HH:MM:SS. */
  issueDate: string;
  issueTime: string;
  supplyStart: string;
  supplyEnd: string;
  seller: Party;
  buyer: Party;
  itemName: string;
  /** "1000.00": without tax, the tax, and with tax. */
  net: string;
  vat: string;
  total: string;
  /** Credit and debit notes: the invoice they correct and why (KSA-10, BR-KSA-17, BR-KSA-56). */
  originalNumber?: string;
  reason?: string;
}

const AMOUNT = /^\d{1,10}\.\d{2}$/;

/** Text in an element, escaped as canonical XML writes it. */
export function text(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/** Problems that would make ZATCA refuse the document, in plain words. Empty when it is fine. */
export function checkDocument(d: TaxDocument): string[] {
  const out: string[] = [];
  const party = (who: 'seller' | 'buyer', p: Party) => {
    if (!p.name.trim()) out.push(`${who} name is missing`);
    if (who === 'seller' && !p.vat) out.push('seller VAT number is missing');
    if (p.vat && !/^3\d{13}3$/.test(p.vat)) out.push(`${who} VAT number must have 15 digits and start and end with 3`);
    if (!/^[A-Za-z0-9]{1,20}$/.test(p.crn)) out.push(`${who} commercial registration is missing or not alphanumeric`);
    if (!/^\d{4}$/.test(p.building)) out.push(`${who} building number must have 4 digits`);
    if (!/^\d{5}$/.test(p.postal)) out.push(`${who} postal code must have 5 digits`);
    for (const [k, v] of [['street', p.street], ['district', p.district], ['city', p.city]] as const) {
      if (!v.trim()) out.push(`${who} ${k} is missing`);
    }
  };
  party('seller', d.seller);
  party('buyer', d.buyer);
  for (const [k, v] of [['net', d.net], ['vat', d.vat], ['total', d.total]] as const) {
    if (!AMOUNT.test(v)) out.push(`${k} must be an amount like 1000.00`);
  }
  if (AMOUNT.test(d.net) && AMOUNT.test(d.vat) && AMOUNT.test(d.total)) {
    const h = (a: string) => BigInt(a.replace('.', ''));
    if (h(d.net) + h(d.vat) !== h(d.total)) out.push('total must be net plus VAT');
    // BR-CO-17: the VAT is the net amount times the rate, rounded to two decimals.
    if ((h(d.net) * 15n * 2n + 100n) / 200n !== h(d.vat)) out.push('VAT must be 15% of the net amount');
    if (h(d.net) <= 0n) out.push('net must be more than zero');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d.uuid)) out.push('uuid is not a UUID');
  if (!/^[1-9]\d*$/.test(d.icv)) out.push('invoice counter must be a positive whole number');
  // ZATCA's starting hash is the base64 of the hex digest of "0"; every later one is the base64 of a digest.
  if (d.pih !== FIRST_PIH && !/^[A-Za-z0-9+/]{43}=$/.test(d.pih)) out.push('previous invoice hash must be base64 SHA-256');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.issueDate) || !/^\d{2}:\d{2}:\d{2}$/.test(d.issueTime)) out.push('issue date or time is badly formed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.supplyStart) || !/^\d{4}-\d{2}-\d{2}$/.test(d.supplyEnd) || d.supplyEnd < d.supplyStart) {
    out.push('supply dates are badly formed');
  }
  if (!/^[A-Za-z0-9-]{1,127}$/.test(d.number)) out.push('number must be letters, digits and dashes');
  if (d.kind !== 'invoice' && (!d.originalNumber || !d.reason?.trim())) out.push('a credit note needs the invoice it corrects and a reason');
  if (!d.itemName.trim()) out.push('item name is missing');
  return out;
}

function partyXml(p: Party, role: 'AccountingSupplierParty' | 'AccountingCustomerParty'): string[] {
  return [
    `    <cac:${role}>`,
    '        <cac:Party>',
    '            <cac:PartyIdentification>',
    `                <cbc:ID schemeID="CRN">${text(p.crn)}</cbc:ID>`,
    '            </cac:PartyIdentification>',
    '            <cac:PostalAddress>',
    `                <cbc:StreetName>${text(p.street)}</cbc:StreetName>`,
    `                <cbc:BuildingNumber>${text(p.building)}</cbc:BuildingNumber>`,
    `                <cbc:CitySubdivisionName>${text(p.district)}</cbc:CitySubdivisionName>`,
    `                <cbc:CityName>${text(p.city)}</cbc:CityName>`,
    `                <cbc:PostalZone>${text(p.postal)}</cbc:PostalZone>`,
    '                <cac:Country>',
    '                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>',
    '                </cac:Country>',
    '            </cac:PostalAddress>',
    '            <cac:PartyTaxScheme>',
    ...(p.vat ? [`                <cbc:CompanyID>${text(p.vat)}</cbc:CompanyID>`] : []),
    '                <cac:TaxScheme>',
    '                    <cbc:ID>VAT</cbc:ID>',
    '                </cac:TaxScheme>',
    '            </cac:PartyTaxScheme>',
    '            <cac:PartyLegalEntity>',
    `                <cbc:RegistrationName>${text(p.name)}</cbc:RegistrationName>`,
    '            </cac:PartyLegalEntity>',
    '        </cac:Party>',
    `    </cac:${role}>`,
  ];
}

const NS =
  'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"';

/** The document's canonical bytes: what is hashed. Throws if ZATCA would refuse it. */
export function documentXml(d: TaxDocument): string {
  const problems = checkDocument(d);
  if (problems.length) throw new Error(`invoice ${d.number}: ${problems.join('; ')}`);
  const sar = (tag: string, amount: string) => `<cbc:${tag} currencyID="SAR">${amount}</cbc:${tag}>`;
  const credit = d.kind !== 'invoice';
  const code = d.kind === 'invoice' ? '388' : d.kind === 'credit_note' ? '381' : '383';
  const L = [
    `<Invoice ${NS}>`,
    '    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>',
    `    <cbc:ID>${text(d.number)}</cbc:ID>`,
    `    <cbc:UUID>${d.uuid}</cbc:UUID>`,
    `    <cbc:IssueDate>${d.issueDate}</cbc:IssueDate>`,
    `    <cbc:IssueTime>${d.issueTime}</cbc:IssueTime>`,
    `    <cbc:InvoiceTypeCode name="0100000">${code}</cbc:InvoiceTypeCode>`,
    '    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>',
    '    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>',
    ...(credit
      ? [
          '    <cac:BillingReference>',
          '        <cac:InvoiceDocumentReference>',
          `            <cbc:ID>${text(d.originalNumber!)}</cbc:ID>`,
          '        </cac:InvoiceDocumentReference>',
          '    </cac:BillingReference>',
        ]
      : []),
    '    <cac:AdditionalDocumentReference>',
    '        <cbc:ID>ICV</cbc:ID>',
    `        <cbc:UUID>${d.icv}</cbc:UUID>`,
    '    </cac:AdditionalDocumentReference>',
    '    <cac:AdditionalDocumentReference>',
    '        <cbc:ID>PIH</cbc:ID>',
    '        <cac:Attachment>',
    `            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${d.pih}</cbc:EmbeddedDocumentBinaryObject>`,
    '        </cac:Attachment>',
    '    </cac:AdditionalDocumentReference>',
    ...partyXml(d.seller, 'AccountingSupplierParty'),
    ...partyXml(d.buyer, 'AccountingCustomerParty'),
    '    <cac:Delivery>',
    `        <cbc:ActualDeliveryDate>${d.supplyStart}</cbc:ActualDeliveryDate>`,
    `        <cbc:LatestDeliveryDate>${d.supplyEnd}</cbc:LatestDeliveryDate>`,
    '    </cac:Delivery>',
    '    <cac:PaymentMeans>',
    // 48: bank card (UNTDID 4461), as subscriptions are paid by card.
    '        <cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>',
    ...(credit ? [`        <cbc:InstructionNote>${text(d.reason!)}</cbc:InstructionNote>`] : []),
    '    </cac:PaymentMeans>',
    '    <cac:TaxTotal>',
    `        ${sar('TaxAmount', d.vat)}`,
    '    </cac:TaxTotal>',
    '    <cac:TaxTotal>',
    `        ${sar('TaxAmount', d.vat)}`,
    '        <cac:TaxSubtotal>',
    `            ${sar('TaxableAmount', d.net)}`,
    `            ${sar('TaxAmount', d.vat)}`,
    '            <cac:TaxCategory>',
    '                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID>',
    '                <cbc:Percent>15.00</cbc:Percent>',
    '                <cac:TaxScheme>',
    '                    <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>',
    '                </cac:TaxScheme>',
    '            </cac:TaxCategory>',
    '        </cac:TaxSubtotal>',
    '    </cac:TaxTotal>',
    '    <cac:LegalMonetaryTotal>',
    `        ${sar('LineExtensionAmount', d.net)}`,
    `        ${sar('TaxExclusiveAmount', d.net)}`,
    `        ${sar('TaxInclusiveAmount', d.total)}`,
    `        ${sar('AllowanceTotalAmount', '0.00')}`,
    `        ${sar('PrepaidAmount', '0.00')}`,
    `        ${sar('PayableAmount', d.total)}`,
    '    </cac:LegalMonetaryTotal>',
    '    <cac:InvoiceLine>',
    '        <cbc:ID>1</cbc:ID>',
    '        <cbc:InvoicedQuantity unitCode="PCE">1.000000</cbc:InvoicedQuantity>',
    `        ${sar('LineExtensionAmount', d.net)}`,
    '        <cac:TaxTotal>',
    `            ${sar('TaxAmount', d.vat)}`,
    `            ${sar('RoundingAmount', d.total)}`,
    '        </cac:TaxTotal>',
    '        <cac:Item>',
    `            <cbc:Name>${text(d.itemName)}</cbc:Name>`,
    '            <cac:ClassifiedTaxCategory>',
    '                <cbc:ID>S</cbc:ID>',
    '                <cbc:Percent>15.00</cbc:Percent>',
    '                <cac:TaxScheme>',
    '                    <cbc:ID>VAT</cbc:ID>',
    '                </cac:TaxScheme>',
    '            </cac:ClassifiedTaxCategory>',
    '        </cac:Item>',
    '        <cac:Price>',
    `            ${sar('PriceAmount', d.net)}`,
    '        </cac:Price>',
    '    </cac:InvoiceLine>',
    '</Invoice>',
  ];
  return L.join('\n');
}

/** The invoice hash (KSA-13 of the next invoice): base64 of the SHA-256 of the canonical bytes. */
export function invoiceHash(canonicalXml: string): string {
  return createHash('sha256').update(canonicalXml, 'utf8').digest('base64');
}

/** The document as a file: the XML declaration, then the canonical bytes. */
export function withDeclaration(canonicalXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${canonicalXml}`;
}
