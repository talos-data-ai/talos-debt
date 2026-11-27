import { Check, CreditCard, FileText, Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/source';
import { useQueryClient } from '@tanstack/react-query';
import { useBilling, useInvoices, useMe, usePayNow, useSaveInvoiceDetails, useSetCancel, useSource } from '../api/hooks';
import type { Billing, BillingCharge, CardInput, InvoiceDetailsInput, InvoiceField, InvoiceItem, Invoices } from '../api/types';
import { ErrorState, Loading } from '../components/bits';
import { Dialog, Field, FormError, errorText, useToast } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { groupDigits } from '../lib/money';
import { sitePage } from './SignUp';

/**
 * Settings, then Billing (7.6): the plan and where the company is in its
 * period, the card, the payments, the tax invoices and the details printed
 * on them (7.8), and cancelling. For owners and admins.
 *
 * The card form sends the card straight to the payment provider from the
 * browser; the API only ever gets a token. One moment of motion: the line of
 * the period draws to today when the page opens (and a new card settles in).
 */

const DAY = 86_400_000;
/** Bank returns already handled in this tab. */
const CONFIRMED = new Set<string>();
const BRAND_NAME: Record<string, string> = { mada: 'mada', visa: 'Visa', master: 'Mastercard', mastercard: 'Mastercard', amex: 'American Express' };

export function BillingTab() {
  const { t } = useI18n();
  const me = useMe();
  const role = me.data?.user.role;
  const allowed = role === 'owner' || role === 'admin';
  const billing = useBilling(allowed);
  const invoices = useInvoices(allowed);
  const [params, setParams] = useSearchParams();
  const source = useSource();
  const qc = useQueryClient();
  const toast = useToast();
  const [justAdded, setJustAdded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  // Back from the bank: the card is confirmed and, if a payment is due, paid. A plain call
  // (not a mutation) guarded by the address, so it runs once even when React runs effects twice.
  const card = params.get('card') ?? '';
  const returning = card.startsWith('return');
  useEffect(() => {
    if (!allowed || !returning) return;
    const id = params.get('id') ?? /[?&]id=([^&]+)/.exec(card)?.[1];
    const key = `${card}|${id ?? ''}`;
    if (CONFIRMED.has(key)) return;
    CONFIRMED.add(key);
    setConfirming(true);
    source
      .confirmCard(id && /^token_[A-Za-z0-9_]+$/.test(id) ? id : undefined)
      .then((r) => {
        setJustAdded(true);
        toast(r.payment === 'paid' ? t('billing.cardSavedPaid') : r.payment === 'pending' ? t('billing.pending') : t('billing.cardSaved'));
      })
      .catch((err) => setReturnError(failureText(err, t)))
      .finally(async () => {
        await Promise.all(['billing', 'me', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
        setConfirming(false);
        setParams({}, { replace: true });
      });
  }, [allowed, returning, card, params, source, qc, setParams, t, toast]);

  if (me.data && !allowed) return <p className="panel callout">{t('billing.ownersOnly')}</p>;
  if (billing.isError) return <ErrorState onRetry={() => billing.refetch()} />;
  if (!billing.data) return <Loading rows={5} />;
  if (confirming) {
    return (
      <div className="panel billing-confirming" role="status">
        <span className="spinner" aria-hidden="true" />
        {t('billing.confirming')}
      </div>
    );
  }
  const b = billing.data;
  const inv = invoices.data?.enabled ? invoices.data : null;
  // Before the national address is given, its form comes first: a card cannot be added without it.
  const detailsFirst = inv !== null && inv.missing.length > 0;
  return (
    <div className="billing">
      <FormError message={returnError} />
      <PlanPanel b={b} />
      {detailsFirst && <DetailsPanel inv={inv} />}
      <CardPanel b={b} justAdded={justAdded} />
      <History charges={b.charges} />
      {inv && <InvoicesPanel inv={inv} />}
      {inv && !detailsFirst && <DetailsPanel inv={inv} />}
      <CancelPanel b={b} />
    </div>
  );
}

function failureText(err: unknown, t: ReturnType<typeof useI18n>['t']): string {
  if (err instanceof ApiError && err.code === 'payment_failed') return t('billing.failed', { reason: err.message });
  return errorText(err, t);
}

const money = (t: ReturnType<typeof useI18n>['t'], amount: string) => t('money.amount', { amount: groupDigits(amount, { decimals: true }) });

type Stage = 'trial' | 'trialOver' | 'active' | 'cancelling' | 'unpaid' | 'ended';

function stageOf(b: Billing, now: number): Stage {
  if (b.billing_status === 'unpaid') return 'unpaid';
  if (b.billing_status === 'cancelled') return 'ended';
  if (b.billing_status === 'trial') return b.free_until && new Date(b.free_until).getTime() <= now ? 'trialOver' : 'trial';
  return b.cancel_at_period_end ? 'cancelling' : 'active';
}

// ------------------------------------------------------------------ the plan and the period

function PlanPanel({ b }: { b: Billing }) {
  const { t, formatDate } = useI18n();
  const pay = usePayNow();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  const stage = stageOf(b, now);
  const day = (iso: string | null) => (iso ? formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const amount = b.price ? money(t, b.price.amount) : '';
  const last4 = b.card?.last_four ?? '';

  const lines: string[] = [];
  if (stage === 'trial') {
    lines.push(t('billing.line.trial', { date: day(b.free_until) }));
    lines.push(b.card && b.price ? t('billing.line.trialCard', { date: day(b.free_until), amount, last4 }) : t('billing.line.trialNoCard'));
  }
  if (stage === 'trialOver') lines.push(t('billing.line.trialOver'));
  if (stage === 'active' && b.price && b.card) lines.push(t('billing.line.active', { date: day(b.paid_until), amount, last4 }));
  if (stage === 'cancelling') lines.push(t('billing.line.cancelling', { date: day(b.paid_until ?? b.free_until) }));
  if (stage === 'unpaid') {
    lines.push(t('billing.line.unpaid'));
    if (b.next_charge_at) lines.push(t('billing.line.retry', { date: day(b.next_charge_at) }));
  }
  if (stage === 'ended') lines.push(t('billing.line.ended', { date: day(b.cancelled_at ?? b.paid_until) }));

  const stopped = stage === 'unpaid' || stage === 'ended' || stage === 'trialOver';
  const chip: { key: MessageKey; tone: string } =
    stage === 'trial' ? { key: 'billing.status.trial', tone: 'active' }
    : stage === 'active' ? { key: 'billing.status.active', tone: 'green' }
    : stage === 'cancelling' ? { key: 'billing.status.cancelling', tone: 'amber' }
    : stage === 'unpaid' ? { key: 'billing.status.unpaid', tone: 'red' }
    : stage === 'ended' ? { key: 'billing.status.cancelled', tone: 'muted' }
    : { key: 'billing.status.unpaid', tone: 'red' };

  const payNow = () => {
    setError(null);
    pay.mutate(undefined, {
      onSuccess: (r) => toast(r.payment === 'paid' ? t('billing.paid') : t('billing.pending')),
      onError: (err) => setError(failureText(err, t)),
    });
  };

  return (
    <section className={`panel billing-plan${stopped ? ' is-stopped' : ''}`} aria-labelledby="billing-plan-title">
      <div className="billing-plan-head">
        <div>
          <h2 id="billing-plan-title" className="billing-plan-name">{t('billing.planName', { plan: t(`plan.${b.plan}` as MessageKey) })}</h2>
          <p className="billing-chips">
            <span className={`badge badge-${chip.tone}`}><span className="badge-dot" aria-hidden="true" />{t(chip.key)}</span>
            <span className="badge badge-neutral">{t(b.billing_period === 'yearly' ? 'billing.yearly' : 'billing.monthly')}</span>
            {b.founding_member && stage === 'trial' && <span className="badge badge-legal">{t('billing.status.founding')}</span>}
          </p>
        </div>
        <div className="billing-price">
          {b.price ? (
            <>
              <span className="billing-price-amount">{money(t, b.price.amount)}</span>
              <span className="billing-price-per">{t(b.billing_period === 'yearly' ? 'billing.perYear' : 'billing.perMonth')}</span>
              <span className="billing-price-tax">{t('billing.taxPart', { amount: money(t, b.price.vat) })}</span>
            </>
          ) : (
            <span className="billing-price-per">{t('billing.noPrice')}</span>
          )}
        </div>
      </div>

      <PeriodLine b={b} stage={stage} />

      <div className="billing-lines">
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      <FormError message={error} />
      {(stage === 'unpaid' || stage === 'ended' || stage === 'trialOver') && b.card && b.can_pay && b.price && (
        <div className="billing-actions">
          <button type="button" className="btn btn-primary" onClick={payNow} disabled={pay.isPending}>
            {stage === 'ended' ? t('billing.subscribeAgain') : t('billing.payNow', { amount })}
          </button>
        </div>
      )}
      {!b.gateway && <p className="callout">{t('billing.notConfigured')}</p>}
    </section>
  );
}

/** Where the company is in its free time or paid period: drawn once, from the start to today. */
function PeriodLine({ b, stage }: { b: Billing; stage: Stage }) {
  const { t, formatDate, lang } = useI18n();
  const now = Date.now();
  let start: number | null = null;
  let end: number | null = null;
  const paid = b.charges.find((c) => c.status === 'paid');
  if (stage === 'trial') {
    end = b.free_until ? new Date(b.free_until).getTime() : null;
    start = b.trial_ends_at && end ? new Date(b.trial_ends_at).getTime() - 14 * DAY : null;
  } else if ((stage === 'active' || stage === 'cancelling') && b.paid_until) {
    end = new Date(b.paid_until).getTime();
    start = paid ? new Date(paid.period_start).getTime() : end - (b.billing_period === 'yearly' ? 365 : 30) * DAY;
  }
  if (start === null || end === null || end <= start) return null;
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  const left = Math.max(0, Math.ceil((end - now) / DAY));
  const short = { day: 'numeric', month: 'short' } as const;
  return (
    <div className="period-line" style={{ ['--done' as string]: `${pct.toFixed(1)}%` }}>
      <div className="period-track" role="img" aria-label={t('billing.daysLeft', { count: left })}>
        <span className="period-fill" />
        <span className="period-now" />
      </div>
      <div className="period-labels">
        <span>{formatDate(new Date(start), short)}</span>
        <span className="period-left" lang={lang}>{t('billing.daysLeft', { count: left })}</span>
        <span>{formatDate(new Date(end), short)}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the card

function CardPanel({ b, justAdded }: { b: Billing; justAdded: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const c = b.card;
  return (
    <section className="panel billing-card" aria-labelledby="billing-card-title">
      <div className="billing-card-head">
        <h2 id="billing-card-title" className="panel-title">{t('billing.card.title')}</h2>
        {b.gateway && !open && (
          <button type="button" className={`btn ${c ? 'btn-quiet' : 'btn-primary'} btn-small`} onClick={() => setOpen(true)}>
            {c ? t('billing.card.replace') : t('billing.card.add')}
          </button>
        )}
      </div>
      <div className="billing-card-body">
        {c ? <CardPlate card={c} settle={justAdded} /> : !open && <p className="card-plate is-empty"><CreditCard size={20} aria-hidden="true" />{t('billing.card.none')}</p>}
        {open && b.gateway && <CardForm b={b} onCancel={() => setOpen(false)} />}
      </div>
    </section>
  );
}

function CardPlate({ card, settle }: { card: NonNullable<Billing['card']>; settle: boolean }) {
  const { t } = useI18n();
  const exp = card.exp_month && card.exp_year ? `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year % 100).padStart(2, '0')}` : null;
  return (
    // A card reads the same in every language, so it is laid out left to right.
    <div dir="ltr" className={`card-plate${settle ? ' is-new' : ''}`} aria-label={t('billing.card.ending', { last4: card.last_four })} role="img">
      <span className="card-brand">{BRAND_NAME[card.brand ?? ''] ?? card.brand ?? ''}</span>
      <bdi dir="ltr" className="card-number">•••• {card.last_four}</bdi>
      {exp && <span className="card-exp"><bdi>{t('billing.card.expires')}</bdi> {exp}</span>}
      {settle && (
        <svg className="card-check" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </div>
  );
}

/** Luhn check: catches a mistyped digit before the card leaves the page. */
export function luhnOk(number: string): boolean {
  if (!/^\d{12,19}$/.test(number)) return false;
  let sum = 0;
  for (let i = 0; i < number.length; i++) {
    let d = Number(number[number.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

type CardErrors = Partial<Record<'name' | 'number' | 'expiry' | 'cvc' | 'form', string>>;

function CardForm({ b, onCancel }: { b: Billing; onCancel: () => void }) {
  const { t, formatDate } = useI18n();
  const source = useSource();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [errors, setErrors] = useState<CardErrors>({});
  const [busy, setBusy] = useState(false);
  const digits = number.replace(/\D/g, '');
  const dueNow = b.billing_status === 'unpaid' || b.billing_status === 'cancelled' || (b.free_until !== null && new Date(b.free_until).getTime() <= Date.now());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: CardErrors = {};
    if (!/^[\p{L} .'-]{2,}\s+[\p{L} .'-]+$/u.test(name.trim())) next.name = t('billing.form.badName');
    if (!luhnOk(digits)) next.number = t('billing.form.badNumber');
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiry.trim());
    const month = m ? Number(m[1]) : 0;
    const year = m ? Number(m[2]) : 0;
    const nowD = new Date();
    if (!m || month < 1 || month > 12 || 2000 + year < nowD.getFullYear() || (2000 + year === nowD.getFullYear() && month < nowD.getMonth() + 1)) {
      next.expiry = t('billing.form.badExpiry');
    }
    if (!/^\d{3,4}$/.test(cvc)) next.cvc = t('billing.form.badCvc');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const card: CardInput = { name: name.trim(), number: digits, month, year, cvc };
      const { token, verifyUrl } = await source.tokenizeCard(b.gateway!, card);
      setNumber('');
      setCvc('');
      await source.saveCard(token);
      // To the bank to confirm the card; it sends the person back to this page.
      if (verifyUrl.startsWith('/')) navigate(verifyUrl);
      else window.location.assign(verifyUrl);
    } catch (err) {
      setErrors({ form: errorText(err, t) });
      setBusy(false);
    }
  };

  const grouped = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  return (
    <form className="card-form" onSubmit={submit} noValidate autoComplete="on">
      <p className="card-form-note">
        <Lock size={15} aria-hidden="true" />
        <span>{t('billing.form.direct')}</span>
      </p>
      {b.gateway?.provider === 'fake' && <p className="callout">{t('billing.form.test')}</p>}
      <Field label={t('billing.form.name')} error={errors.name}>
        {(p) => <input {...p} name="ccname" autoComplete="cc-name" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label={t('billing.form.number')} error={errors.number}>
        {(p) => (
          <input
            {...p}
            name="cardnumber"
            dir="ltr"
            inputMode="numeric"
            autoComplete="cc-number"
            className="card-input-number"
            value={grouped}
            maxLength={23}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 19))}
          />
        )}
      </Field>
      <div className="form-row">
        <Field label={t('billing.form.expiry')} error={errors.expiry}>
          {(p) => (
            <input
              {...p}
              name="cc-exp"
              dir="ltr"
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="MM/YY"
              className="input-short"
              value={expiry}
              maxLength={5}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, '').slice(0, 4);
                setExpiry(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
              }}
            />
          )}
        </Field>
        <Field label={t('billing.form.cvc')} hint={t('billing.form.cvcHint')} error={errors.cvc}>
          {(p) => (
            <input
              {...p}
              name="cvc"
              dir="ltr"
              inputMode="numeric"
              autoComplete="cc-csc"
              className="input-short"
              value={cvc}
              maxLength={4}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          )}
        </Field>
      </div>
      <p className="field-hint">
        {dueNow && b.price
          ? t('billing.form.chargeNow', { amount: money(t, b.price.amount) })
          : t('billing.form.hold', { date: b.free_until ? formatDate(b.free_until, { day: 'numeric', month: 'long' }) : '' })}{' '}
        {t('billing.form.nextStep')}
      </p>
      <FormError message={errors.form} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('billing.form.submit')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ payments

function History({ charges }: { charges: BillingCharge[] }) {
  const { t, formatDate } = useI18n();
  const short = { day: 'numeric', month: 'short', year: 'numeric' } as const;
  return (
    <section className="panel billing-history" aria-labelledby="billing-history-title">
      <h2 id="billing-history-title" className="panel-title">{t('billing.history.title')}</h2>
      {charges.length === 0 ? (
        <p className="muted">{t('billing.history.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table className="table billing-table">
            <thead>
              <tr>
                <th scope="col">{t('billing.history.date')}</th>
                <th scope="col">{t('billing.history.period')}</th>
                <th scope="col" className="num">{t('billing.history.amount')}</th>
                <th scope="col">{t('billing.history.card')}</th>
                <th scope="col">{t('billing.history.status')}</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td>{formatDate(c.created_at, short)}</td>
                  <td>
                    {t('billing.history.range', { from: formatDate(c.period_start, { day: 'numeric', month: 'short' }), to: formatDate(c.period_end, short) })}
                  </td>
                  <td className="num">{money(t, c.amount)}</td>
                  <td>{c.last_four ? <bdi dir="ltr">•••• {c.last_four}</bdi> : ''}</td>
                  <td>
                    <span className={`badge badge-${c.status === 'paid' ? 'green' : c.status === 'failed' ? 'red' : 'amber'}`}>
                      <span className="badge-dot" aria-hidden="true" />
                      {t(`billing.charge.${c.status}` as MessageKey)}
                    </span>
                    {c.status === 'failed' && c.failure_message && <span className="billing-why">{c.failure_message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ tax invoices (7.8)

function InvoicesPanel({ inv }: { inv: Invoices }) {
  const { t, formatDate } = useI18n();
  const source = useSource();
  const toast = useToast();
  const short = { day: 'numeric', month: 'short', year: 'numeric' } as const;
  const file = (i: InvoiceItem, format: 'pdf' | 'xml') => {
    const url = source.invoiceUrl(i.id, format);
    const label = t('billing.invoices.download', { number: i.number, format: format.toUpperCase() });
    return url ? (
      <a className="link invoice-file" href={url} download aria-label={label}>{format.toUpperCase()}</a>
    ) : (
      <button type="button" className="link invoice-file" aria-label={label} onClick={() => toast(t('billing.invoices.sample'))}>
        {format.toUpperCase()}
      </button>
    );
  };
  return (
    <section className="panel billing-invoices" aria-labelledby="billing-invoices-title">
      <h2 id="billing-invoices-title" className="panel-title">{t('billing.invoices.title')}</h2>
      {inv.invoices.length === 0 ? (
        <p className="muted">{t('billing.invoices.empty')}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table billing-table">
              <thead>
                <tr>
                  <th scope="col">{t('billing.invoices.number')}</th>
                  <th scope="col">{t('billing.invoices.date')}</th>
                  <th scope="col" className="num">{t('billing.invoices.amount')}</th>
                  <th scope="col">{t('billing.invoices.state')}</th>
                  <th scope="col">{t('billing.invoices.files')}</th>
                </tr>
              </thead>
              <tbody>
                {inv.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className="invoice-number">
                        <FileText size={15} aria-hidden="true" />
                        <bdi dir="ltr">{i.number}</bdi>
                      </span>
                      {i.kind === 'credit_note' && i.original_number && (
                        <span className="billing-why">{t('billing.invoices.creditNote', { number: i.original_number })}</span>
                      )}
                    </td>
                    <td>{formatDate(i.issued_at, short)}</td>
                    <td className="num">{i.kind === 'credit_note' ? `−${money(t, i.total_amount)}` : money(t, i.total_amount)}</td>
                    <td>
                      <span className={`badge badge-${i.state === 'ready' ? 'green' : 'amber'}`}>
                        <span className="badge-dot" aria-hidden="true" />
                        {t(`billing.invoices.${i.state}` as MessageKey)}
                      </span>
                    </td>
                    <td>{i.state === 'ready' ? <span className="invoice-files">{file(i, 'pdf')}{file(i, 'xml')}</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-hint">{t('billing.invoices.note')}</p>
        </>
      )}
    </section>
  );
}

const ADDRESS_FIELDS: InvoiceField[] = ['address_building', 'address_street', 'address_district', 'address_city', 'address_postal'];
type DetailErrors = Partial<Record<InvoiceField | 'vat_number' | 'form', string>>;

function DetailsPanel({ inv }: { inv: Invoices }) {
  const { t, lang } = useI18n();
  const d = inv.details;
  const needed = inv.missing.length > 0;
  const [editing, setEditing] = useState(needed);
  const save = useSaveInvoiceDetails();
  const toast = useToast();
  const [f, setF] = useState<InvoiceDetailsInput>({
    vat_number: d.vat_number ?? '',
    address_building: d.address_building ?? '',
    address_street: d.address_street ?? '',
    address_district: d.address_district ?? '',
    address_city: d.address_city ?? '',
    address_postal: d.address_postal ?? '',
  });
  const [errors, setErrors] = useState<DetailErrors>({});
  const set = (k: keyof InvoiceDetailsInput, v: string) => setF({ ...f, [k]: v });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: DetailErrors = {};
    for (const k of ADDRESS_FIELDS) if (!f[k].trim()) next[k] = t('billing.details.required');
    if (f.address_building && !/^\d{4}$/.test(f.address_building)) next.address_building = t('billing.details.badBuilding');
    if (f.address_postal && !/^\d{5}$/.test(f.address_postal)) next.address_postal = t('billing.details.badPostal');
    if (f.vat_number && !/^3\d{13}3$/.test(f.vat_number)) next.vat_number = t('billing.details.badVat');
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate(f, {
      onSuccess: (r) => {
        setEditing(false);
        toast(r.issued > 0 ? t('billing.details.savedIssued') : t('billing.details.saved'));
      },
      onError: (err) => setErrors({ form: errorText(err, t) }),
    });
  };

  const address = [d.address_building, d.address_street, d.address_district, d.address_city].filter(Boolean).join(lang === 'ar' ? '، ' : ', ');
  const digits = (max: number) => (v: string) => v.replace(/\D/g, '').slice(0, max);
  return (
    <section className={`panel billing-details${needed ? ' is-needed' : ''}`} aria-labelledby="billing-details-title">
      <div className="billing-card-head">
        <h2 id="billing-details-title" className="panel-title">{t('billing.details.title')}</h2>
        {!editing && (
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>{t('billing.details.edit')}</button>
        )}
      </div>
      {needed ? <p className="callout">{t('billing.details.needed')}</p> : <p className="muted">{t('billing.details.lead')}</p>}
      <dl className="details-list">
        <div><dt>{t('billing.details.company')}</dt><dd><bdi>{d.legal_name}</bdi></dd></div>
        <div><dt>{t('billing.details.cr')}</dt><dd><bdi dir="ltr">{d.cr_number}</bdi></dd></div>
        {!editing && (
          <>
            <div><dt>{t('billing.details.vat')}</dt><dd>{d.vat_number ? <bdi dir="ltr">{d.vat_number}</bdi> : t('billing.details.vatNone')}</dd></div>
            <div><dt>{t('billing.details.address')}</dt><dd><bdi>{address}</bdi> <bdi dir="ltr">{d.address_postal}</bdi></dd></div>
          </>
        )}
      </dl>
      {editing && (
        <form className="details-form" onSubmit={submit} noValidate>
          <fieldset>
            <legend>{t('billing.details.address')}</legend>
            <p className="field-hint">{t('billing.details.where')}</p>
            <div className="form-row">
              <Field label={t('billing.details.building')} hint={t('billing.details.buildingHint')} error={errors.address_building}>
                {(p) => <input {...p} className="input-short" dir="ltr" inputMode="numeric" value={f.address_building} onChange={(e) => set('address_building', digits(4)(e.target.value))} />}
              </Field>
              <Field label={t('billing.details.postal')} hint={t('billing.details.postalHint')} error={errors.address_postal}>
                {(p) => <input {...p} className="input-short" dir="ltr" inputMode="numeric" autoComplete="postal-code" value={f.address_postal} onChange={(e) => set('address_postal', digits(5)(e.target.value))} />}
              </Field>
            </div>
            <Field label={t('billing.details.street')} error={errors.address_street}>
              {(p) => <input {...p} autoComplete="address-line1" value={f.address_street} onChange={(e) => set('address_street', e.target.value)} />}
            </Field>
            <div className="form-row">
              <Field label={t('billing.details.district')} error={errors.address_district}>
                {(p) => <input {...p} value={f.address_district} onChange={(e) => set('address_district', e.target.value)} />}
              </Field>
              <Field label={t('billing.details.city')} error={errors.address_city}>
                {(p) => <input {...p} autoComplete="address-level2" value={f.address_city} onChange={(e) => set('address_city', e.target.value)} />}
              </Field>
            </div>
          </fieldset>
          <Field label={t('billing.details.vat')} hint={t('billing.details.vatHint')} error={errors.vat_number}>
            {(p) => <input {...p} dir="ltr" inputMode="numeric" value={f.vat_number} onChange={(e) => set('vat_number', digits(15)(e.target.value))} />}
          </Field>
          <FormError message={errors.form} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>{t('billing.details.save')}</button>
            {!needed && (
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={save.isPending}>{t('common.cancel')}</button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ cancelling

function CancelPanel({ b }: { b: Billing }) {
  const { t, formatDate, lang } = useI18n();
  const set = useSetCancel();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (b.billing_status !== 'trial' && b.billing_status !== 'active') return null;
  const ends = b.paid_until ?? b.free_until;
  const date = ends ? formatDate(ends, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const change = (cancel: boolean) => {
    setError(null);
    set.mutate(cancel, {
      onSuccess: () => {
        setOpen(false);
        toast(cancel ? t('billing.cancel.done', { date }) : t('billing.cancel.undone'));
      },
      onError: (err) => setError(errorText(err, t)),
    });
  };
  return (
    <section className="panel billing-cancel" aria-labelledby="billing-cancel-title">
      <div>
        <h2 id="billing-cancel-title" className="panel-title">{t('billing.cancel.title')}</h2>
        <p className="muted">{t('billing.cancel.lead', { date })}</p>
        <a className="link" href={sitePage(lang, 'refunds')} target="_blank" rel="noreferrer">{t('billing.refunds')}</a>
      </div>
      <FormError message={error} />
      {b.cancel_at_period_end ? (
        <button type="button" className="btn btn-primary" onClick={() => change(false)} disabled={set.isPending}>
          <Check size={16} aria-hidden="true" /> {t('billing.keep')}
        </button>
      ) : (
        <button type="button" className="btn btn-quiet btn-quiet-danger" onClick={() => setOpen(true)}>
          {t('billing.cancel.title')}
        </button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('billing.cancel.title')}
        footer={
          <>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>{t('billing.keep')}</button>
            <button type="button" className="btn btn-danger" onClick={() => change(true)} disabled={set.isPending}>{t('billing.cancel.confirm')}</button>
          </>
        }
      >
        <p>{t('billing.cancel.lead', { date })}</p>
      </Dialog>
    </section>
  );
}
