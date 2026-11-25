/**
 * Onboarding (7.5): a new company sets up, step by step, with a progress bar.
 * Each step saves on its own, so people can stop and come back. Three steps
 * are needed before Talos may message anyone: the company and its commercial
 * registration, the owner (for Najiz), and the signed authorization letter.
 */
import {
  Building2, CheckCircle2, Circle, Download, FileSpreadsheet, FileText, Landmark, PenLine, Settings2, Upload, UserPlus, UserRound, Users,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe, useOnboarding, useSaveOnboarding, useSource, useUploadOnboardingFile } from '../api/hooks';
import type { FileLite, Onboarding, OnboardingFileKind, OnboardingStep } from '../api/types';
import { ErrorState, Loading } from '../components/bits';
import { Field, FormError, errorText } from '../components/ui';
import { useI18n, type MessageKey } from '../i18n';
import { RulesForm } from './Settings';

const ICONS: Record<OnboardingStep, ReactNode> = {
  company: <Building2 size={18} />,
  owner: <UserRound size={18} />,
  bank: <Landmark size={18} />,
  authorization: <PenLine size={18} />,
  rules: <Settings2 size={18} />,
  debtors: <Users size={18} />,
};
/** Najiz takes PDFs of at most 0.95 MB; the same limit here, so the files are ready for filing. */
const MAX_BYTES = Math.floor(0.95 * 1024 * 1024);

export function WelcomePage() {
  const { t, formatDate } = useI18n();
  const me = useMe();
  const setup = useOnboarding();
  const [step, setStep] = useState<OnboardingStep | 'done' | null>(null);
  const o = setup.data;

  // Open the first step that is not done yet.
  useEffect(() => {
    if (o && step === null) setStep(o.steps.find((s) => !s.done)?.key ?? 'done');
  }, [o, step]);

  if (setup.isError) return <ErrorState onRetry={() => setup.refetch()} />;
  if (!o || !step) return <Loading rows={6} />;

  const done = o.steps.filter((s) => s.done).length;
  const requiredLeft = o.steps.filter((s) => s.required && !s.done);
  const next = (from: OnboardingStep) => {
    const order = o.steps.map((s) => s.key);
    const after = order.slice(order.indexOf(from) + 1).concat(order.slice(0, order.indexOf(from)));
    // The latest data decides: the step just saved counts as done.
    setStep(after.find((k) => !o.steps.find((s) => s.key === k)?.done && k !== from) ?? 'done');
  };
  const days = Math.max(0, Math.ceil((new Date(o.trial_ends_at).getTime() - Date.now()) / 86_400_000));
  const isOwner = me.data?.user.role === 'owner' || me.data?.user.role === 'admin';

  return (
    <div className="page welcome">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('welcome.title')}</h1>
          <p className="page-sub">{t('welcome.lead')}</p>
        </div>
        <p className="trial-chip">
          {t('welcome.trial', { count: days })}
          <span className="muted"> {t('welcome.trialEnds', { date: formatDate(o.trial_ends_at) })}</span>
        </p>
      </header>

      <div className="setup-progress" role="group" aria-label={t('welcome.progress', { done, total: o.steps.length })}>
        <div className="setup-progress-text">
          <strong>{t('welcome.progress', { done, total: o.steps.length })}</strong>
          <span className="muted">
            {requiredLeft.length ? t('welcome.requiredLeft', { count: requiredLeft.length }) : t('welcome.requiredDone')}
          </span>
        </div>
        <div className="setup-bar" aria-hidden="true">
          <span style={{ inlineSize: `${(done / o.steps.length) * 100}%` }} />
        </div>
      </div>

      {!isOwner && <p className="callout">{t('welcome.ownerOnly')}</p>}

      <div className="setup">
        <nav className="setup-steps" aria-label={t('welcome.stepsLabel')}>
          <ol>
            {o.steps.map((s) => (
              <li key={s.key}>
                <button type="button" className={`setup-step${step === s.key ? ' is-on' : ''}${s.done ? ' is-done' : ''}`} aria-current={step === s.key ? 'step' : undefined} onClick={() => setStep(s.key)}>
                  <span className="setup-step-icon" aria-hidden="true">
                    {s.done ? <CheckCircle2 size={20} /> : ICONS[s.key]}
                  </span>
                  <span className="setup-step-text">
                    <span>{t(`welcome.step.${s.key}` as MessageKey)}</span>
                    <small>{s.done ? t('welcome.done') : s.required ? t('welcome.required') : t('welcome.optional')}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="panel setup-panel" aria-labelledby="setup-title">
          {step === 'done' ? (
            <AllSet o={o} />
          ) : (
            <>
              <h2 className="panel-title" id="setup-title">
                {ICONS[step]}
                {t(`welcome.step.${step}` as MessageKey)}
              </h2>
              <p className="panel-hint">{t(`welcome.hint.${step}` as MessageKey)}</p>
              {step === 'company' && <CompanyStep o={o} canEdit={isOwner} onDone={() => next('company')} />}
              {step === 'owner' && <OwnerStep o={o} canEdit={isOwner} onDone={() => next('owner')} />}
              {step === 'bank' && <BankStep o={o} canEdit={isOwner} onDone={() => next('bank')} />}
              {step === 'authorization' && <AuthorizationStep o={o} canEdit={isOwner} onDone={() => next('authorization')} />}
              {step === 'rules' && <RulesStep onDone={() => next('rules')} />}
              {step === 'debtors' && <DebtorsStep onDone={() => next('debtors')} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ files

function FileUpload({ kind, file, required, accept = 'application/pdf', canEdit }: { kind: OnboardingFileKind; file: FileLite | null; required?: boolean; accept?: string; canEdit: boolean }) {
  const { t, formatDate } = useI18n();
  const upload = useUploadOnboardingFile();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    const pdfOnly = accept === 'application/pdf';
    if (pdfOnly && f.type !== 'application/pdf') return setError(t('welcome.pdfOnly'));
    if (f.size > MAX_BYTES) return setError(t('welcome.tooBig'));
    upload.mutate({ kind, file: f }, { onError: (err) => setError(errorText(err, t)) });
  };
  return (
    <div className={`setup-file${file ? ' has-file' : ''}`}>
      <span className="setup-file-icon" aria-hidden="true">{file ? <CheckCircle2 size={20} /> : <FileText size={20} />}</span>
      <div className="setup-file-text">
        <strong>
          {t(`welcome.file.${kind}` as MessageKey)}
          {!required && <span className="muted"> ({t('welcome.optional')})</span>}
        </strong>
        {file ? (
          <span className="muted">
            <bdi dir="ltr">{file.name}</bdi> · {formatDate(file.uploaded_at)}
          </span>
        ) : (
          <span className="muted">{t(accept === 'application/pdf' ? 'welcome.pdfHint' : 'welcome.pdfOrPhoto')}</span>
        )}
        {error && <span className="field-msg" role="alert">{error}</span>}
      </div>
      {canEdit && (
        <>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => input.current?.click()} disabled={upload.isPending} aria-busy={upload.isPending}>
            <Upload size={16} aria-hidden="true" />
            {file ? t('welcome.replace') : t('welcome.upload')}
          </button>
          <input
            ref={input}
            type="file"
            accept={accept}
            hidden
            aria-label={t(`welcome.file.${kind}` as MessageKey)}
            onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))}
          />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ steps

function StepForm({ children, onSubmit, busy, error, canEdit, label }: { children: ReactNode; onSubmit: () => void; busy: boolean; error: string | null; canEdit: boolean; label?: string }) {
  const { t } = useI18n();
  return (
    <form
      className="form setup-form"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={!canEdit} className="setup-fields">
        {children}
      </fieldset>
      <FormError message={error} />
      {canEdit && (
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
            {label ?? t('welcome.saveNext')}
          </button>
        </div>
      )}
    </form>
  );
}

function CompanyStep({ o, canEdit, onDone }: { o: Onboarding; canEdit: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const save = useSaveOnboarding();
  const c = o.company;
  const [f, setF] = useState({ trade_name: c.trade_name ?? '', unified_number: c.unified_number ?? '', sector: c.sector, activity: c.activity ?? '', vat_number: c.vat_number ?? '' });
  const [errors, setErrors] = useState<{ unified?: string; cr?: string; form?: string }>({});
  const submit = () => {
    const next: typeof errors = {};
    if (!/^7\d{9}$/.test(f.unified_number)) next.unified = t('welcome.unifiedBad');
    if (!c.cr_file) next.cr = t('welcome.crNeeded');
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate({ step: 'company', ...f }, { onSuccess: onDone, onError: (err) => setErrors({ form: errorText(err, t) }) });
  };
  return (
    <StepForm onSubmit={submit} busy={save.isPending} error={errors.form ?? errors.cr ?? null} canEdit={canEdit}>
      <dl className="mini-facts setup-facts">
        <div><dt>{t('signup.legalName')}</dt><dd>{c.legal_name}</dd></div>
        <div><dt>{t('signup.cr')}</dt><dd><bdi dir="ltr" className="code">{c.cr_number}</bdi></dd></div>
      </dl>
      <div className="form-row">
        <Field label={t('welcome.unified')} hint={t('welcome.unifiedHint')} error={errors.unified}>
          {(p) => <input {...p} inputMode="numeric" dir="ltr" value={f.unified_number} onChange={(e) => setF({ ...f, unified_number: e.target.value.replace(/\D/g, '').slice(0, 10) })} required />}
        </Field>
        <Field label={t('welcome.tradeName')} hint={t('welcome.optional')}>
          {(p) => <input {...p} value={f.trade_name} onChange={(e) => setF({ ...f, trade_name: e.target.value })} />}
        </Field>
      </div>
      <div className="form-row">
        <Field label={t('welcome.sector')}>
          {(p) => (
            <select {...p} value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value as typeof f.sector })}>
              {(['logistics', 'labor_services', 'construction', 'other'] as const).map((s) => (
                <option key={s} value={s}>{t(`sector.${s}` as MessageKey)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('welcome.vat')} hint={t('welcome.optional')}>
          {(p) => <input {...p} inputMode="numeric" dir="ltr" value={f.vat_number} onChange={(e) => setF({ ...f, vat_number: e.target.value.replace(/\D/g, '').slice(0, 15) })} />}
        </Field>
      </div>
      <Field label={t('welcome.activity')} hint={t('welcome.activityHint')}>
        {(p) => <input {...p} value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} />}
      </Field>
      <div className="setup-files">
        <FileUpload kind="cr" file={c.cr_file} required canEdit={canEdit} />
        <FileUpload kind="establishment_contract" file={c.contract_file} canEdit={canEdit} />
      </div>
    </StepForm>
  );
}

function OwnerStep({ o, canEdit, onDone }: { o: Onboarding; canEdit: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const save = useSaveOnboarding();
  const w = o.owner;
  const [f, setF] = useState({ name: w.name, id_type: w.id_type ?? ('national_id' as const), id_number: '', phone: w.phone, email: w.email });
  const [errors, setErrors] = useState<{ id?: string; form?: string }>({});
  const submit = () => {
    if (!w.id_last4 || f.id_number) {
      const first = f.id_type === 'national_id' ? '1' : '2';
      if (!new RegExp(`^${first}\\d{9}$`).test(f.id_number)) return setErrors({ id: t(f.id_type === 'national_id' ? 'welcome.idBadNational' : 'welcome.idBadIqama') });
    }
    setErrors({});
    save.mutate(
      { step: 'owner', name: f.name, id_type: f.id_type, ...(f.id_number ? { id_number: f.id_number } : {}), phone: f.phone, email: f.email },
      { onSuccess: onDone, onError: (err) => setErrors({ form: errorText(err, t) }) },
    );
  };
  return (
    <StepForm onSubmit={submit} busy={save.isPending} error={errors.form ?? null} canEdit={canEdit}>
      <Field label={t('welcome.ownerName')} hint={t('welcome.ownerNameHint')}>
        {(p) => <input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}
      </Field>
      <fieldset className="choice">
        <legend>{t('welcome.idType')}</legend>
        {(['national_id', 'iqama'] as const).map((k) => (
          <label key={k} className="choice-item">
            <input type="radio" name="id_type" checked={f.id_type === k} onChange={() => setF({ ...f, id_type: k })} />
            {t(`idtype.${k}` as MessageKey)}
          </label>
        ))}
      </fieldset>
      <Field
        label={t('welcome.idNumber')}
        hint={w.id_last4 ? t('welcome.idSaved', { last4: w.id_last4 }) : t('welcome.idHint')}
        error={errors.id}
      >
        {(p) => <input {...p} inputMode="numeric" dir="ltr" autoComplete="off" value={f.id_number} onChange={(e) => setF({ ...f, id_number: e.target.value.replace(/\D/g, '').slice(0, 10) })} className="input-short" />}
      </Field>
      <div className="form-row">
        <Field label={t('signup.phone')}>
          {(p) => <input {...p} type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
        </Field>
        <Field label={t('signup.email')}>
          {(p) => <input {...p} type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
        </Field>
      </div>
    </StepForm>
  );
}

function BankStep({ o, canEdit, onDone }: { o: Onboarding; canEdit: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const save = useSaveOnboarding();
  const [f, setF] = useState({ bank_name: o.bank.bank_name ?? '', iban: o.bank.iban ?? '' });
  const [errors, setErrors] = useState<{ bank?: string; iban?: string; form?: string }>({});
  const submit = () => {
    const next: typeof errors = {};
    if (!f.bank_name.trim()) next.bank = t('common.required');
    if (!/^SA\d{22}$/.test(f.iban.replace(/\s/g, '').toUpperCase())) next.iban = t('welcome.ibanBad');
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate({ step: 'bank', ...f }, { onSuccess: onDone, onError: (err) => setErrors({ form: errorText(err, t) }) });
  };
  return (
    <StepForm onSubmit={submit} busy={save.isPending} error={errors.form ?? null} canEdit={canEdit}>
      <div className="form-row">
        <Field label={t('welcome.bankName')} error={errors.bank}>
          {(p) => <input {...p} value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />}
        </Field>
        <Field label={t('welcome.iban')} hint={t('welcome.ibanHint')} error={errors.iban}>
          {(p) => <input {...p} dir="ltr" value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value.toUpperCase() })} placeholder="SA00 0000 0000 0000 0000 0000" />}
        </Field>
      </div>
      <div className="setup-files">
        <FileUpload kind="iban_letter" file={o.bank.letter} accept="application/pdf,image/png,image/jpeg" canEdit={canEdit} />
      </div>
    </StepForm>
  );
}

function AuthorizationStep({ o, canEdit, onDone }: { o: Onboarding; canEdit: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const source = useSource();
  const url = source.authorizationTemplateUrl();
  return (
    <div className="setup-form">
      <ol className="setup-how">
        <li>{t('welcome.auth1')}</li>
        <li>{t('welcome.auth2')}</li>
        <li>{t('welcome.auth3')}</li>
      </ol>
      {url ? (
        <a className="btn btn-quiet" href={url} download>
          <Download size={17} aria-hidden="true" />
          {t('welcome.authDownload')}
        </a>
      ) : (
        <p className="callout">{t('welcome.authSoon')}</p>
      )}
      <div className="setup-files">
        <FileUpload kind="authorization" file={o.authorization.file} required canEdit={canEdit} />
      </div>
      {o.authorization.file && canEdit && (
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={onDone}>
            {t('welcome.next')}
          </button>
        </div>
      )}
    </div>
  );
}

function RulesStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const save = useSaveOnboarding();
  return <RulesForm doneLabel={t('welcome.rulesKeep')} onDone={() => save.mutate({ step: 'rules' }, { onSuccess: onDone })} />;
}

function DebtorsStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const save = useSaveOnboarding();
  return (
    <div className="setup-form">
      <div className="setup-choices">
        <Link className="setup-choice" to="/import">
          <FileSpreadsheet size={24} aria-hidden="true" />
          <strong>{t('welcome.importExcel')}</strong>
          <span className="muted">{t('welcome.importExcelHint')}</span>
        </Link>
        <Link className="setup-choice" to="/debtors?add=1">
          <UserPlus size={24} aria-hidden="true" />
          <strong>{t('welcome.addOne')}</strong>
          <span className="muted">{t('welcome.addOneHint')}</span>
        </Link>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-quiet" onClick={() => save.mutate({ step: 'debtors' }, { onSuccess: onDone })}>
          {t('welcome.later')}
        </button>
      </div>
    </div>
  );
}

function AllSet({ o }: { o: Onboarding }) {
  const { t } = useI18n();
  const left = o.steps.filter((s) => !s.done);
  return (
    <div className="setup-done">
      <CheckCircle2 size={40} aria-hidden="true" />
      <h2 className="panel-title" id="setup-title">{t(left.some((s) => s.required) ? 'welcome.almost' : 'welcome.ready')}</h2>
      <p>{t(left.some((s) => s.required) ? 'welcome.almostText' : 'welcome.readyText')}</p>
      {left.length > 0 && (
        <ul className="setup-left">
          {left.map((s) => (
            <li key={s.key}>
              <Circle size={14} aria-hidden="true" />
              {t(`welcome.step.${s.key}` as MessageKey)}
            </li>
          ))}
        </ul>
      )}
      <Link className="btn btn-primary" to="/">{t('welcome.toDashboard')}</Link>
    </div>
  );
}
