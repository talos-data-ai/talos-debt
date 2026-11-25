/**
 * Sign-up (7.5): a company starts its free trial. One page: the person
 * signing up (who becomes the owner's account), the company as on its
 * commercial registration, and the plan. The website's "Start your free
 * trial" buttons link here with the plan chosen (?plan=legal&period=yearly).
 */
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSource } from '../api/hooks';
import type { BillingPeriod, PlanKey, SignUpInput } from '../api/types';
import { Field, FormError, errorText } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { AuthLayout, PASSWORD_MIN, PasswordInput } from './Auth';

export const PLANS: PlanKey[] = ['follow_up', 'legal', 'najiz'];
const SITE = import.meta.env.VITE_SITE_URL ?? 'https://debt.talosksa.com';

type Errors = Partial<Record<keyof SignUpInput | 'form', string>>;

export function SignUpPage() {
  const { t, lang } = useI18n();
  const source = useSource();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const startPlan = PLANS.includes(params.get('plan') as PlanKey) ? (params.get('plan') as PlanKey) : 'legal';
  const [f, setF] = useState<SignUpInput>({
    full_name: '', phone: '', email: '', password: '', legal_name: '', cr_number: '',
    plan: startPlan, period: params.get('period') === 'yearly' ? 'yearly' : 'monthly',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SignUpInput>(k: K, v: SignUpInput[K]) => setF({ ...f, [k]: v });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!f.full_name.trim()) next.full_name = t('common.required');
    if (!/^(\+?966|0)?5\d{8}$/.test(f.phone.replace(/[\s-]/g, ''))) next.phone = t('signup.phoneBad');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) next.email = t('signup.emailBad');
    if (f.password.length < PASSWORD_MIN) next.password = t('reset.tooShort');
    if (!f.legal_name.trim()) next.legal_name = t('common.required');
    if (!/^\d{10}$/.test(f.cr_number.trim())) next.cr_number = t('signup.crBad');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await source.signUp({ ...f, full_name: f.full_name.trim(), email: f.email.trim(), legal_name: f.legal_name.trim(), cr_number: f.cr_number.trim() });
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
      <h1 className="auth-title">{t('signup.title')}</h1>
      <p className="auth-lead">{t('signup.lead')}</p>
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

        <fieldset className="form-section">
          <legend>{t('signup.plan')}</legend>
          <div className="plan-picks" role="radiogroup" aria-label={t('signup.plan')}>
            {PLANS.map((p) => (
              <label key={p} className={`plan-pick${f.plan === p ? ' is-on' : ''}${p === 'najiz' ? ' plan-pick-legal' : ''}`}>
                <input type="radio" name="plan" value={p} checked={f.plan === p} onChange={() => set('plan', p)} />
                <span className="plan-pick-name">{t(`plan.${p}` as MessageKey)}</span>
                <span className="plan-pick-for">{t(`plan.${p}.for` as MessageKey)}</span>
                {f.plan === p && <Check size={18} className="plan-pick-check" aria-hidden="true" />}
              </label>
            ))}
          </div>
          <div className="period-pick" role="radiogroup" aria-label={t('signup.period')}>
            {(['monthly', 'yearly'] as BillingPeriod[]).map((per) => (
              <label key={per} className={f.period === per ? 'is-on' : ''}>
                <input type="radio" name="period" value={per} checked={f.period === per} onChange={() => set('period', per)} />
                {t(`signup.${per}` as MessageKey)}
              </label>
            ))}
          </div>
          <p className="field-hint">
            {t('signup.planHint')}{' '}
            <a className="link" href={`${SITE}${lang === 'en' ? '/en' : ''}/pricing/`} target="_blank" rel="noreferrer">
              {t('signup.compare')}
            </a>
          </p>
        </fieldset>

        <ul className="signup-points">
          <li><Check size={16} aria-hidden="true" />{t('signup.trial')}</li>
          <li><Check size={16} aria-hidden="true" />{t('signup.noSetup')}</li>
        </ul>
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
