/**
 * Sign-up (7.5): a company starts its free trial, in two steps.
 *
 *   1. Choose a plan: the three plans side by side, each with everything it
 *      includes (the features of the plans before it, then its own new ones,
 *      marked). Only one plan can be chosen, as radio buttons.
 *   2. The account: the person signing up (who becomes the owner's account)
 *      and the company as on its commercial registration, with the terms.
 *
 * The step is kept in the address (?step=details&plan=legal&period=yearly), so
 * the browser's back button returns to the plans, and the website's "Start
 * your free trial" buttons can open the plans with one already chosen.
 * No card is asked for: it is added before the trial ends (7.6).
 */
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CreditCard, FileText, Landmark, Layers, MessageCircle } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSource } from '../api/hooks';
import type { BillingPeriod, PlanKey, SignUpInput } from '../api/types';
import { LogoWordmark } from '../components/Logo';
import { Field, FormError, errorText } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { PLANS, planFeatures } from '../lib/plans';
import { AuthLayout, PASSWORD_MIN, PasswordInput } from './Auth';

export { PLANS };
const SITE = import.meta.env.VITE_SITE_URL ?? 'https://debt.talosksa.com';

/** A page of the public website in the reader's language. */
export function sitePage(lang: string, page: 'pricing' | 'terms' | 'privacy' | 'refunds'): string {
  return `${SITE}${lang === 'en' ? '/en' : ''}/${page}/`;
}

type Errors = Partial<Record<keyof SignUpInput | 'form', string>>;

function readPlan(params: URLSearchParams): { plan: PlanKey; period: BillingPeriod } {
  const p = params.get('plan') as PlanKey;
  return { plan: PLANS.includes(p) ? p : 'legal', period: params.get('period') === 'yearly' ? 'yearly' : 'monthly' };
}

export function SignUpPage() {
  const [params, setParams] = useSearchParams();
  const { lang, setLang } = useI18n();
  // The website sends its own language (?lang=ar), so the sign-up opens in it.
  const fromSite = params.get('lang');
  useEffect(() => {
    if ((fromSite === 'ar' || fromSite === 'en') && fromSite !== lang) setLang(fromSite);
    // Only once, when arriving from the website.
  }, []);
  const choice = readPlan(params);
  const go = (step: 'plan' | 'details', c = choice) =>
    setParams(step === 'details' ? { step, plan: c.plan, period: c.period } : { plan: c.plan, period: c.period });
  return params.get('step') === 'details' ? (
    <DetailsStep plan={choice.plan} period={choice.period} onBack={() => go('plan')} />
  ) : (
    <PlanStep initial={choice} onNext={(c) => go('details', c)} />
  );
}

// ------------------------------------------------------------- step 1: plan

function PeriodPick({ value, onChange }: { value: BillingPeriod; onChange: (p: BillingPeriod) => void }) {
  const { t } = useI18n();
  // The dark thumb slides under the chosen label.
  return (
    <div className="period-pick" role="radiogroup" aria-label={t('signup.period')} style={{ '--at': value === 'yearly' ? 1 : 0 } as CSSProperties}>
      {(['monthly', 'yearly'] as BillingPeriod[]).map((per) => (
        <label key={per} className={value === per ? 'is-on' : ''}>
          <input type="radio" name="period" value={per} checked={value === per} onChange={() => onChange(per)} />
          {t(`signup.${per}` as MessageKey)}
        </label>
      ))}
    </div>
  );
}

const STAGE_ICONS = [MessageCircle, FileText, Landmark];

/**
 * The path a debt takes, from WhatsApp follow-up to the legal file to Najiz,
 * drawn over the three plans. The line runs from the start to the chosen
 * plan, so it shows how far Talos goes on each one. It draws itself once
 * when the page opens, and moves when another plan is chosen.
 */
function PlanTrack({ plan }: { plan: PlanKey }) {
  const at = PLANS.indexOf(plan);
  return (
    <div className="plan-track" aria-hidden="true" style={{ '--at': at } as CSSProperties}>
      <span className="plan-track-line" />
      <span className="plan-track-fill" />
      {PLANS.map((p, i) => {
        const Icon = STAGE_ICONS[i]!;
        return (
          <span key={p} className={`plan-track-node${i <= at ? ' is-lit' : ''}${p === 'najiz' ? ' is-legal' : ''}`} style={{ '--i': i } as CSSProperties}>
            <Icon size={16} />
          </span>
        );
      })}
    </div>
  );
}

function PlanStep({ initial, onNext }: { initial: { plan: PlanKey; period: BillingPeriod }; onNext: (c: { plan: PlanKey; period: BillingPeriod }) => void }) {
  const { t, lang, setLang } = useI18n();
  const [plan, setPlan] = useState<PlanKey>(initial.plan);
  const [period, setPeriod] = useState<BillingPeriod>(initial.period);
  const Forward = lang === 'ar' ? ArrowLeft : ArrowRight;
  return (
    <div className="choose">
      <header className="choose-top">
        <LogoWordmark height={24} />
        <button type="button" className="lang-btn" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} aria-label={t('lang.switchLabel')} lang={lang === 'en' ? 'ar' : 'en'}>
          {t('lang.switch')}
        </button>
      </header>
      <main id="main" className="choose-main">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onNext({ plan, period });
          }}
        >
          <p className="choose-step">{t('signup.stepOf', { n: 1 })}</p>
          <h1 className="choose-title">{t('signup.chooseTitle')}</h1>
          <p className="choose-lead">{t('signup.chooseLead')}</p>
          <ul className="signup-points choose-points-phone">
            <li><Check size={16} aria-hidden="true" />{t('signup.trial')}</li>
            <li><Check size={16} aria-hidden="true" />{t('signup.noCard')}</li>
            <li><Check size={16} aria-hidden="true" />{t('signup.noSetup')}</li>
          </ul>
          <div className="choose-bar">
            <PeriodPick value={period} onChange={setPeriod} />
            <a className="link" href={sitePage(lang, 'pricing')} target="_blank" rel="noreferrer">{t('signup.seePrices')}</a>
          </div>

          <PlanTrack plan={plan} />
          <div className="plan-cards" role="radiogroup" aria-label={t('signup.plan')}>
            {PLANS.map((p) => {
              const on = plan === p;
              return (
                <label key={p} className={`plan-card${on ? ' is-on' : ''}${p === 'najiz' ? ' plan-card-legal' : ''}`}>
                  <span className="plan-card-head">
                    <input type="radio" name="plan" value={p} checked={on} onChange={() => setPlan(p)} aria-labelledby={`plan-${p}-name`} aria-describedby={`plan-${p}-for`} />
                    <span className="plan-radio" aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</span>
                    <span className="plan-card-name" id={`plan-${p}-name`}>{t(`plan.${p}` as MessageKey)}</span>
                    <span className={`plan-card-state${on ? ' is-on' : ''}`}>{t(on ? 'signup.selected' : 'signup.choose')}</span>
                  </span>
                  <span className="plan-card-for" id={`plan-${p}-for`}>{t(`plan.${p}.for` as MessageKey)}</span>
                  <span className="plan-card-debtors">{t('signup.fromDebtors')}</span>
                  <span className="plan-card-label">{t('signup.included')}</span>
                  <ul className="plan-card-features">
                    {planFeatures(p).map((f) => (
                      <li key={f.key} className={f.before ? 'is-all' : undefined}>
                        {f.before ? <Layers size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                        <span>{f.before ? t(f.key, { plan: t(`plan.${f.before}` as MessageKey) }) : t(f.key)}</span>
                      </li>
                    ))}
                  </ul>
                </label>
              );
            })}
          </div>

          <div className="choose-foot">
            <ul className="signup-points">
              <li><Check size={16} aria-hidden="true" />{t('signup.trial')}</li>
              <li><Check size={16} aria-hidden="true" />{t('signup.noCard')}</li>
              <li><Check size={16} aria-hidden="true" />{t('signup.noSetup')}</li>
            </ul>
            <button type="submit" className="btn btn-primary">
              {t('signup.continueWith', { plan: t(`plan.${plan}` as MessageKey) })}
              <Forward size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="auth-new">
            {t('signup.haveAccount')} <Link to="/login" className="link">{t('login.submit')}</Link>
          </p>
        </form>
      </main>
    </div>
  );
}

// ---------------------------------------------------------- step 2: details

function DetailsStep({ plan, period, onBack }: { plan: PlanKey; period: BillingPeriod; onBack: () => void }) {
  const { t, lang } = useI18n();
  const source = useSource();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState<Omit<SignUpInput, 'plan' | 'period'>>({
    full_name: '', phone: '', email: '', password: '', legal_name: '', cr_number: '', accepted_terms: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!f.full_name.trim()) next.full_name = t('common.required');
    if (!/^(\+?966|0)?5\d{8}$/.test(f.phone.replace(/[\s-]/g, ''))) next.phone = t('signup.phoneBad');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) next.email = t('signup.emailBad');
    if (f.password.length < PASSWORD_MIN) next.password = t('reset.tooShort');
    if (!f.legal_name.trim()) next.legal_name = t('common.required');
    if (!/^\d{10}$/.test(f.cr_number.trim())) next.cr_number = t('signup.crBad');
    if (!f.accepted_terms) next.accepted_terms = t('signup.acceptNeeded');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await source.signUp({
        ...f, plan, period,
        full_name: f.full_name.trim(), email: f.email.trim(), legal_name: f.legal_name.trim(), cr_number: f.cr_number.trim(),
      });
      qc.clear();
      navigate('/welcome', { replace: true });
    } catch (err) {
      setErrors({ form: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout wide>
      <p className="choose-step">{t('signup.stepOf', { n: 2 })}</p>
      <h1 className="auth-title">{t('signup.detailsTitle')}</h1>
      <div className={`plan-chosen${plan === 'najiz' ? ' plan-chosen-legal' : ''}`}>
        <span>
          <span className="plan-chosen-label">{t('signup.yourPlan')}</span>
          <strong>{t('signup.planPeriod', { plan: t(`plan.${plan}` as MessageKey), period: t(`signup.${period}` as MessageKey) })}</strong>
        </span>
        <button type="button" className="btn btn-quiet btn-small" onClick={onBack}>{t('signup.change')}</button>
      </div>
      <form className="form signup" onSubmit={submit} noValidate>
        <fieldset className="form-section">
          <legend>{t('signup.you')}</legend>
          <Field label={t('signup.fullName')} error={errors.full_name}>
            {(p) => <input {...p} value={f.full_name} onChange={(e) => set('full_name', e.target.value)} autoComplete="name" required autoFocus />}
          </Field>
          <div className="form-row">
            <Field label={t('signup.phone')} hint={t('signup.phoneHint')} error={errors.phone}>
              {(p) => <input {...p} type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" dir="ltr" required />}
            </Field>
            <Field label={t('signup.email')} error={errors.email}>
              {(p) => <input {...p} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" dir="ltr" required />}
            </Field>
          </div>
          <Field label={t('login.password')} hint={t('reset.hint')} error={errors.password}>
            {(p) => <PasswordInput {...p} value={f.password} onChange={(v) => set('password', v)} autoComplete="new-password" />}
          </Field>
        </fieldset>

        <fieldset className="form-section">
          <legend>{t('signup.company')}</legend>
          <Field label={t('signup.legalName')} hint={t('signup.legalNameHint')} error={errors.legal_name}>
            {(p) => <input {...p} value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} autoComplete="organization" required />}
          </Field>
          <Field label={t('signup.cr')} error={errors.cr_number}>
            {(p) => <input {...p} inputMode="numeric" value={f.cr_number} onChange={(e) => set('cr_number', e.target.value.replace(/\D/g, '').slice(0, 10))} dir="ltr" className="input-short" required />}
          </Field>
        </fieldset>

        <div className="card-later">
          <CreditCard size={20} aria-hidden="true" />
          <p><strong>{t('signup.noCard')}.</strong> {t('signup.cardLater')}</p>
        </div>

        <div className="accept">
          <label className={`check pledge${errors.accepted_terms ? " pledge-error" : ""}`}>
            <input
              type="checkbox"
              checked={f.accepted_terms}
              onChange={(e) => set('accepted_terms', e.target.checked)}
              aria-invalid={errors.accepted_terms ? true : undefined}
              aria-describedby={errors.accepted_terms ? 'accept-error' : undefined}
            />
            <span>
              {t('signup.accept1')}{' '}
              <a className="link" href={sitePage(lang, 'terms')} target="_blank" rel="noreferrer">{t('signup.terms')}</a>{' '}
              {t('signup.accept2')}{' '}
              <a className="link" href={sitePage(lang, 'privacy')} target="_blank" rel="noreferrer">{t('signup.privacy')}</a>
              .
            </span>
          </label>
          {errors.accepted_terms && <p className="field-msg" id="accept-error">{errors.accepted_terms}</p>}
        </div>

        <FormError message={errors.form} />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy}>
          {t('signup.submit')}
        </button>
      </form>
      <p className="auth-new">
        {t('signup.haveAccount')} <Link to="/login" className="link">{t('login.submit')}</Link>
      </p>
    </AuthLayout>
  );
}
