import { randomUUID } from 'node:crypto';

/**
 * The payment provider, behind one small interface so it can be swapped and
 * so tests never call it (like `WhatsAppSender`). Moyasar today
 * (`moyasar.ts`); `FakeGateway` in tests and in development.
 *
 * Talos never sees a card number: the browser sends it straight to the
 * provider and gets a token back (`browser`). Talos keeps the token and
 * charges it with its secret key.
 */

export type TokenStatus = 'initiated' | 'active' | 'inactive';

export interface GatewayToken {
  id: string;
  status: TokenStatus;
  /** mada, visa, master, amex... in lower case. */
  brand: string | null;
  lastFour: string | null;
  month: number | null;
  year: number | null;
  metadata: Record<string, string>;
}

export type PaymentStatus = 'initiated' | 'paid' | 'failed' | 'authorized' | 'captured' | 'refunded' | 'voided' | 'verified';

export interface GatewayPayment {
  id: string;
  status: PaymentStatus;
  /** Whole halalas. */
  amount: bigint;
  currency: string;
  /** The provider's words when it failed (for staff). */
  message: string | null;
  metadata: Record<string, string>;
}

export interface ChargeRequest {
  /** Our charge id: the provider's idempotency key (given_id). The same id never charges twice. */
  givenId: string;
  token: string;
  /** Whole halalas. */
  amount: bigint;
  description: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

/** What the browser needs to turn a card into a token, without the card ever reaching Talos. */
export interface BrowserGateway {
  provider: 'moyasar' | 'fake';
  publishableKey: string;
  /** Where the browser posts the card. */
  tokensUrl: string;
}

export interface PaymentGateway {
  readonly name: 'moyasar' | 'fake';
  readonly browser: BrowserGateway;
  /** Null when the provider does not know the token. */
  fetchToken(id: string): Promise<GatewayToken | null>;
  deleteToken(id: string): Promise<void>;
  /**
   * Charges a saved card. Answers paid or failed (or initiated if the bank
   * unexpectedly asks the cardholder to confirm). Throws GatewayUnavailable
   * when the outcome is unknown (network, timeout, provider error): the
   * charge is then tried again later with the same givenId.
   */
  charge(req: ChargeRequest): Promise<GatewayPayment>;
  fetchPayment(id: string): Promise<GatewayPayment | null>;
}

/** The provider could not be reached or answered with an error: the outcome is unknown. */
export class GatewayUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayUnavailable';
  }
}

/** The provider refused the request itself (a mistake on our side, never retried as is). */
export class GatewayRefused extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GatewayRefused';
  }
}

// ---------------------------------------------------------------------- Fake

/**
 * Cards for the fake provider, with the same numbers as Moyasar's test cards
 * so the same steps work in the sandbox later. Any other number is declined.
 */
export const FAKE_CARDS: Record<string, { brand: string; outcome: 'paid' | 'insufficient' | 'declined' }> = {
  '4201320111111010': { brand: 'mada', outcome: 'paid' },
  '4111111111111111': { brand: 'visa', outcome: 'paid' },
  '5421080101000000': { brand: 'master', outcome: 'paid' },
  '4201320000311101': { brand: 'mada', outcome: 'insufficient' },
  '4123120001090000': { brand: 'visa', outcome: 'insufficient' },
  '4201321234411220': { brand: 'mada', outcome: 'declined' },
};

const FAKE_TOKEN = /^token_fake_([a-z]+)_(\d{4})_(paid|insufficient|declined)_(\d{2})(\d{2})_([a-f0-9]{12})$/;

/**
 * A provider that lives in memory, for tests and development. Its tokens
 * carry the card's details in their name, so the API and the scheduler (two
 * processes) read them the same way. Outcomes can be changed per token.
 */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake' as const;
  readonly payments = new Map<string, GatewayPayment & { givenId: string; token: string }>();
  readonly deleted = new Set<string>();
  /** Tokens whose bank confirmation (3D Secure) is not finished yet. */
  readonly unconfirmed = new Set<string>();
  /** Force the next charge of a token: an outcome, or 'down' (the provider cannot be reached). */
  readonly next = new Map<string, 'paid' | 'insufficient' | 'declined' | 'down'>();
  readonly charges: ChargeRequest[] = [];

  constructor(readonly browser: BrowserGateway = { provider: 'fake', publishableKey: 'pk_fake', tokensUrl: '/api/billing/fake/tokens' }) {}

  /** Makes a token as the provider would, from a test card number. */
  static tokenFor(number: string, month: number, year: number, metadata?: Record<string, string>): { id: string; known: boolean } {
    const card = FAKE_CARDS[number];
    const id = `token_fake_${card?.brand ?? 'visa'}_${number.slice(-4)}_${card?.outcome ?? 'declined'}_${String(month).padStart(2, '0')}${String(year % 100).padStart(2, '0')}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    void metadata;
    return { id, known: Boolean(card) };
  }

  async fetchToken(id: string): Promise<GatewayToken | null> {
    const m = FAKE_TOKEN.exec(id);
    if (!m) return null;
    return {
      id,
      status: this.deleted.has(id) ? 'inactive' : this.unconfirmed.has(id) ? 'initiated' : 'active',
      brand: m[1]!,
      lastFour: m[2]!,
      month: Number(m[4]),
      year: 2000 + Number(m[5]),
      metadata: {},
    };
  }

  async deleteToken(id: string): Promise<void> {
    this.deleted.add(id);
  }

  async charge(req: ChargeRequest): Promise<GatewayPayment> {
    this.charges.push(req);
    for (const p of this.payments.values()) if (p.givenId === req.givenId) return p; // idempotent, like given_id
    const forced = this.next.get(req.token);
    if (forced) this.next.delete(req.token);
    if (forced === 'down') throw new GatewayUnavailable('fake provider is down');
    const m = FAKE_TOKEN.exec(req.token);
    const outcome = forced ?? (m && !this.deleted.has(req.token) ? (m[3] as 'paid' | 'insufficient' | 'declined') : 'declined');
    const p = {
      id: `pay_fake_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      status: (outcome === 'paid' ? 'paid' : 'failed') as PaymentStatus,
      amount: req.amount,
      currency: 'SAR',
      message: outcome === 'paid' ? null : outcome === 'insufficient' ? 'Insufficient Funds' : 'Declined',
      metadata: req.metadata,
      givenId: req.givenId,
      token: req.token,
    };
    this.payments.set(p.id, p);
    return p;
  }

  async fetchPayment(id: string): Promise<GatewayPayment | null> {
    return this.payments.get(id) ?? null;
  }
}
