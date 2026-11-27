import {
  GatewayRefused,
  GatewayUnavailable,
  type BrowserGateway,
  type ChargeRequest,
  type GatewayPayment,
  type GatewayToken,
  type PaymentGateway,
  type PaymentStatus,
  type TokenStatus,
} from './gateway.js';

/**
 * Moyasar (https://docs.moyasar.com), a Saudi payment provider licensed by
 * the Saudi Central Bank. Basic auth with the key as the user name and an
 * empty password. Amounts are whole halalas.
 *
 *   POST   /v1/payments      charge a saved card: source { type: 'token', token }, given_id
 *   GET    /v1/payments/:id
 *   GET    /v1/tokens/:id    is the card confirmed (active)?
 *   DELETE /v1/tokens/:id
 *   POST   /v1/webhooks/:id/verify   confirm a new webhook with the code sent to it
 *
 * The browser creates the token itself (POST /v1/tokens with the publishable
 * key); the card number never reaches Talos. A token payment does not ask the
 * cardholder to confirm again (3D Secure was done when the card was saved).
 */

interface MoyasarPayment {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  refunded?: number | null;
  message?: string | null;
  metadata?: Record<string, string> | null;
  source?: { message?: string | null } | null;
}

interface MoyasarToken {
  id: string;
  status: TokenStatus;
  brand?: string | null;
  last_four?: string | null;
  month?: string | number | null;
  year?: string | number | null;
  metadata?: Record<string, string> | null;
}

export interface MoyasarOptions {
  secretKey: string;
  publishableKey: string;
  /** https://api.moyasar.com/v1; tests point it at a local server. */
  apiUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class MoyasarGateway implements PaymentGateway {
  readonly name = 'moyasar' as const;
  readonly browser: BrowserGateway;
  private readonly auth: string;
  private readonly http: typeof fetch;

  constructor(private readonly opts: MoyasarOptions) {
    this.auth = `Basic ${Buffer.from(`${opts.secretKey}:`).toString('base64')}`;
    this.http = opts.fetch ?? fetch;
    this.browser = { provider: 'moyasar', publishableKey: opts.publishableKey, tokensUrl: `${opts.apiUrl}/tokens` };
  }

  private async call<T>(method: string, path: string, body?: object): Promise<{ status: number; data: T | null }> {
    let res: Response;
    try {
      res = await this.http(`${this.opts.apiUrl}${path}`, {
        method,
        headers: { authorization: this.auth, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (err) {
      // Never the request: it holds the token.
      throw new GatewayUnavailable(`payment provider not reached: ${(err as Error).name}`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.status >= 500 || res.status === 429) throw new GatewayUnavailable(`payment provider answered ${res.status}`);
    return { status: res.status, data: data as T | null };
  }

  private static payment(p: MoyasarPayment): GatewayPayment {
    return {
      id: p.id,
      status: p.status,
      amount: BigInt(p.amount),
      currency: p.currency,
      refunded: BigInt(p.refunded ?? 0),
      message: p.source?.message ?? p.message ?? null,
      metadata: p.metadata ?? {},
    };
  }

  async fetchToken(id: string): Promise<GatewayToken | null> {
    const { status, data } = await this.call<MoyasarToken>('GET', `/tokens/${encodeURIComponent(id)}`);
    if (status === 404) return null;
    if (status !== 200 || !data) throw new GatewayRefused(`token check answered ${status}`, 'token_check_failed');
    const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
    const year = num(data.year);
    return {
      id: data.id,
      status: data.status,
      brand: data.brand ? data.brand.toLowerCase() : null,
      lastFour: data.last_four ?? null,
      month: num(data.month),
      year: year !== null && year < 100 ? 2000 + year : year,
      metadata: data.metadata ?? {},
    };
  }

  async deleteToken(id: string): Promise<void> {
    const { status } = await this.call('DELETE', `/tokens/${encodeURIComponent(id)}`);
    if (status !== 204 && status !== 200 && status !== 404) throw new GatewayRefused(`token delete answered ${status}`, 'token_delete_failed');
  }

  async charge(req: ChargeRequest): Promise<GatewayPayment> {
    const { status, data } = await this.call<MoyasarPayment & { type?: string; message?: string }>('POST', '/payments', {
      given_id: req.givenId,
      amount: Number(req.amount), // halalas, a whole number well inside the safe range
      currency: 'SAR',
      description: req.description,
      callback_url: req.callbackUrl,
      metadata: req.metadata,
      source: { type: 'token', token: req.token },
    });
    if ((status === 200 || status === 201) && data?.id) return MoyasarGateway.payment(data);
    // A refused request (bad token, used given_id with other details...): nothing was charged.
    const d = data as { type?: string; message?: string } | null;
    throw new GatewayRefused(d?.message ?? `payment answered ${status}`, d?.type ?? `http_${status}`);
  }

  async verifyWebhook(webhookId: string, code: string): Promise<void> {
    const { status } = await this.call('POST', `/webhooks/${encodeURIComponent(webhookId)}/verify`, { code });
    if (status !== 200 && status !== 201 && status !== 204) throw new GatewayRefused(`webhook verify answered ${status}`, 'webhook_verify_failed');
  }

  async fetchPayment(id: string): Promise<GatewayPayment | null> {
    const { status, data } = await this.call<MoyasarPayment>('GET', `/payments/${encodeURIComponent(id)}`);
    if (status === 404) return null;
    if (status !== 200 || !data) throw new GatewayRefused(`payment check answered ${status}`, 'payment_check_failed');
    return MoyasarGateway.payment(data);
  }
}
