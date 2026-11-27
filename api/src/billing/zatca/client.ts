import type { Config } from '../../config.js';
import { encodeTlv } from './qr.js';

/**
 * ZATCA's e-invoicing system (Fatoora), behind one small interface so tests
 * never call it (like `PaymentGateway`). Standard tax invoices are sent for
 * clearance; ZATCA checks them, stamps them and sends them back with its QR
 * code. Only a cleared invoice may be given to the client.
 *
 *   FatooraClient: ZATCA's sandbox, simulation or the real system (core).
 *   FakeZatca:     in memory, for development and tests.
 */

export type ZatcaMode = 'fake' | 'sandbox' | 'simulation' | 'core';

export interface ClearRequest {
  uuid: string;
  /** base64 of the SHA-256 of the canonical XML. */
  invoiceHash: string;
  /** The whole document, with its XML declaration. */
  xml: string;
}

export type Clearance =
  | { status: 'cleared'; clearedXml: string; warnings: string[] }
  | { status: 'rejected'; errors: string[]; warnings: string[] };

export interface ZatcaClient {
  readonly mode: ZatcaMode;
  /** Throws ZatcaUnavailable when the answer is unknown: the invoice is sent again later, unchanged. */
  clear(req: ClearRequest): Promise<Clearance>;
}

/** ZATCA could not be reached or did not give an answer: send the same invoice again later. */
export class ZatcaUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZatcaUnavailable';
  }
}

export const ZATCA_URLS: Record<Exclude<ZatcaMode, 'fake'>, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  core: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

interface ValidationMessage {
  type?: string;
  code?: string;
  category?: string;
  message?: string;
}
interface ZatcaReply {
  validationResults?: {
    warningMessages?: ValidationMessage[];
    errorMessages?: ValidationMessage[];
    status?: string;
  };
  clearanceStatus?: string;
  clearedInvoice?: string;
  message?: string;
}

const words = (list: ValidationMessage[] | undefined) =>
  (list ?? []).map((m) => [m.code, m.message].filter(Boolean).join(': ').slice(0, 500)).filter(Boolean);

export class FatooraClient implements ZatcaClient {
  constructor(
    readonly mode: Exclude<ZatcaMode, 'fake'>,
    private readonly opts: { token: string; secret: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch },
  ) {}

  async clear(req: ClearRequest): Promise<Clearance> {
    const base = (this.opts.baseUrl ?? ZATCA_URLS[this.mode]).replace(/\/+$/, '');
    const doFetch = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(`${base}/invoices/clearance/single`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'accept-language': 'en',
          'accept-version': 'V2',
          'clearance-status': '1',
          authorization: `Basic ${Buffer.from(`${this.opts.token}:${this.opts.secret}`).toString('base64')}`,
        },
        body: JSON.stringify({ invoiceHash: req.invoiceHash, uuid: req.uuid, invoice: Buffer.from(req.xml, 'utf8').toString('base64') }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      });
    } catch (err) {
      throw new ZatcaUnavailable(`ZATCA not reached: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as ZatcaReply;
    const warnings = words(body.validationResults?.warningMessages);
    if ((res.status === 200 || res.status === 202) && body.clearanceStatus === 'CLEARED' && body.clearedInvoice) {
      return { status: 'cleared', clearedXml: Buffer.from(body.clearedInvoice, 'base64').toString('utf8'), warnings };
    }
    if (res.status === 400 || (res.status < 300 && body.clearanceStatus === 'NOT_CLEARED')) {
      const errors = words(body.validationResults?.errorMessages);
      return { status: 'rejected', errors: errors.length ? errors : ['ZATCA did not clear the invoice'], warnings };
    }
    // 303: ZATCA has switched clearance off for now; 401: our credentials; 429 and 5xx: try later.
    throw new ZatcaUnavailable(`ZATCA answered ${res.status}${body.message ? `: ${String(body.message).slice(0, 200)}` : ''}`);
  }
}

/**
 * ZATCA in memory. Clears every invoice by adding a QR code, as the real
 * system does, unless told to refuse the next one or to be unreachable.
 */
export class FakeZatca implements ZatcaClient {
  readonly mode = 'fake' as const;
  sent: ClearRequest[] = [];
  private next: 'reject' | 'down' | null = null;
  private nextErrors: string[] = [];

  rejectNext(errors = ['BR-KSA-63: buyer address is incomplete']) {
    this.next = 'reject';
    this.nextErrors = errors;
  }
  downNext() {
    this.next = 'down';
  }

  async clear(req: ClearRequest): Promise<Clearance> {
    const now = this.next;
    this.next = null;
    if (now === 'down') throw new ZatcaUnavailable('fake ZATCA is down');
    this.sent.push(req);
    if (now === 'reject') return { status: 'rejected', errors: this.nextErrors, warnings: [] };
    const pick = (tag: string) => new RegExp(`<cbc:${tag}[^>]*>([^<]*)</cbc:${tag}>`).exec(req.xml)?.[1] ?? '';
    const seller = /<cac:AccountingSupplierParty>[\s\S]*?<cbc:RegistrationName>([^<]*)</.exec(req.xml)?.[1] ?? '';
    const vat = /<cac:AccountingSupplierParty>[\s\S]*?<cbc:CompanyID>([^<]*)</.exec(req.xml)?.[1] ?? '';
    const qr = encodeTlv([
      seller,
      vat,
      `${pick('IssueDate')}T${pick('IssueTime')}`,
      /<cbc:TaxInclusiveAmount[^>]*>([^<]*)</.exec(req.xml)?.[1] ?? '',
      /<cac:TaxTotal>\s*<cbc:TaxAmount[^>]*>([^<]*)</.exec(req.xml)?.[1] ?? '',
      req.invoiceHash,
      'fake-zatca-stamp',
    ]);
    const qrRef = [
      '    <cac:AdditionalDocumentReference>',
      '        <cbc:ID>QR</cbc:ID>',
      '        <cac:Attachment>',
      `            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject>`,
      '        </cac:Attachment>',
      '    </cac:AdditionalDocumentReference>',
      '    <cac:AccountingSupplierParty>',
    ].join('\n');
    return { status: 'cleared', clearedXml: req.xml.replace('    <cac:AccountingSupplierParty>', qrRef), warnings: [] };
  }
}

/** The configured ZATCA connection; null when invoices are made but not sent (ZATCA_MODE=off). */
export function createZatca(config: Config): ZatcaClient | null {
  if (config.ZATCA_MODE === 'off') return null;
  if (config.ZATCA_MODE === 'fake') return new FakeZatca();
  return new FatooraClient(config.ZATCA_MODE, {
    token: config.ZATCA_CSID_TOKEN!,
    secret: config.ZATCA_CSID_SECRET!,
    baseUrl: config.ZATCA_API_URL,
  });
}
