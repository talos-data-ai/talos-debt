/**
 * The QR code on a tax invoice: tag, length, value (TLV), then base64.
 *
 * Tags 1 to 5 are the seller's name, its VAT number, the time of issue, the
 * total with tax and the tax. A standard invoice cleared by ZATCA carries
 * ZATCA's own QR code (with its stamp) inside the cleared XML: that one is
 * printed. Before Talos is connected to ZATCA (ZATCA_MODE=off), the invoice
 * carries tags 1 to 5 only.
 */

export interface QrFacts {
  sellerName: string;
  vatNumber: string;
  /** ISO time, for example 2026-11-27T09:30:00Z. */
  timestamp: string;
  total: string;
  vat: string;
}

export function encodeTlv(fields: (string | Buffer)[]): string {
  const parts: Buffer[] = [];
  fields.forEach((v, i) => {
    const value = typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
    if (value.length > 255) throw new Error(`QR field ${i + 1} is longer than 255 bytes`);
    parts.push(Buffer.from([i + 1, value.length]), value);
  });
  return Buffer.concat(parts).toString('base64');
}

/** The fields of a QR code, by tag. Throws if it is not well formed. */
export function decodeTlv(base64: string): Map<number, Buffer> {
  const bytes = Buffer.from(base64, 'base64');
  const out = new Map<number, Buffer>();
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i]!;
    const len = bytes[i + 1];
    if (len === undefined || i + 2 + len > bytes.length) throw new Error('QR code is not well formed');
    out.set(tag, bytes.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

export function basicQr(f: QrFacts): string {
  return encodeTlv([f.sellerName, f.vatNumber, f.timestamp, f.total, f.vat]);
}

/** ZATCA's QR code inside a cleared invoice, or null. */
export function qrFromXml(xml: string): string | null {
  const m = /<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([A-Za-z0-9+/=\s]+)<\/cbc:EmbeddedDocumentBinaryObject>/.exec(xml);
  return m ? m[1]!.replace(/\s+/g, '') : null;
}
