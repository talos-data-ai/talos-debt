import type { Mail } from '../login/mailer.js';

/**
 * Billing emails to the owner and the admins, Arabic first then English, in
 * the same frame as the login emails. Plain words, no em dashes. Amounts stay
 * text; dates are shown in the company's time zone with Western digits.
 */

export type BillingEmailKind = 'trial_ending' | 'trial_ended' | 'paid' | 'failed' | 'renewal_soon' | 'cancelled' | 'ended';

export interface BillingEmailFacts {
  link: string;
  timezone: string;
  /** "1149.00" */
  amount?: string;
  plan?: 'follow_up' | 'legal' | 'najiz';
  period?: 'monthly' | 'yearly';
  /** The date the email is about: trial end, renewal, end of the paid period... */
  date?: Date;
  periodStart?: Date;
  periodEnd?: Date;
  brand?: string | null;
  lastFour?: string | null;
  /** Next automatic try after a failed payment. */
  retryAt?: Date | null;
  reason?: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PLAN = {
  ar: { follow_up: 'المتابعة', legal: 'القانونية', najiz: 'ناجز' },
  en: { follow_up: 'Follow-up', legal: 'Legal', najiz: 'Najiz' },
};
const PERIOD = { ar: { monthly: 'شهري', yearly: 'سنوي' }, en: { monthly: 'monthly', yearly: 'yearly' } };
const BRAND: Record<string, string> = { mada: 'mada', visa: 'Visa', master: 'Mastercard', mastercard: 'Mastercard', amex: 'American Express' };

/** "12,500.00": grouped from the text, never as a number. */
export function groupAmount(amount: string): string {
  const [whole, part] = amount.split('.') as [string, string | undefined];
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (part ? `.${part}` : '');
}

export function formatDay(lang: 'ar' | 'en', d: Date, timezone: string): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(d);
}

export function billingEmail(to: string, kind: BillingEmailKind, f: BillingEmailFacts): Mail {
  const day = (lang: 'ar' | 'en', d?: Date | null) => (d ? formatDay(lang, d, f.timezone) : '');
  const money = (lang: 'ar' | 'en') => (f.amount ? (lang === 'ar' ? `${groupAmount(f.amount)} ريال` : `SAR ${groupAmount(f.amount)}`) : '');
  const card = (lang: 'ar' | 'en') =>
    f.lastFour
      ? lang === 'ar'
        ? `بطاقة ${BRAND[f.brand ?? ''] ?? ''} المنتهية بـ ${f.lastFour}`.replace('  ', ' ')
        : `the ${BRAND[f.brand ?? ''] ?? ''} card ending in ${f.lastFour}`.replace('  ', ' ')
      : lang === 'ar'
        ? 'بطاقتك'
        : 'your card';
  const plan = (lang: 'ar' | 'en') => (f.plan ? PLAN[lang][f.plan] : '');
  const period = (lang: 'ar' | 'en') => (f.period ? PERIOD[lang][f.period] : '');

  type T = { subject: string; body: string[]; button: string };
  const texts: Record<BillingEmailKind, { ar: T; en: T }> = {
    trial_ending: {
      ar: {
        subject: `تنتهي تجربتك المجانية في ${day('ar', f.date)}`,
        body: [
          `لتواصل تالوس متابعة مدينيك بعد ${day('ar', f.date)}، أضف بطاقة من الإعدادات ثم الفوترة.`,
          'لا يُخصم أي مبلغ قبل نهاية التجربة.',
        ],
        button: 'إضافة بطاقة',
      },
      en: {
        subject: `Your free trial ends on ${day('en', f.date)}`,
        body: [
          `To keep Talos following up with your debtors after ${day('en', f.date)}, add a card in Settings, then Billing.`,
          'Nothing is charged before the trial ends.',
        ],
        button: 'Add a card',
      },
    },
    trial_ended: {
      ar: {
        subject: 'انتهت تجربتك المجانية',
        body: ['توقفت تالوس عن مراسلة مدينيك وعن التقديم في ناجز.', 'أضف بطاقة ليعود كل شيء للعمل. بياناتك محفوظة في حسابك.'],
        button: 'إضافة بطاقة',
      },
      en: {
        subject: 'Your free trial has ended',
        body: ['Talos has stopped sending messages to your debtors and filing on Najiz.', 'Add a card to start again. Your data is safe in your account.'],
        button: 'Add a card',
      },
    },
    paid: {
      ar: {
        subject: `تم استلام دفعتك: ${money('ar')}`,
        body: [
          `استلمنا ${money('ar')} من ${card('ar')}، عن باقة ${plan('ar')} (${period('ar')})، للمدة من ${day('ar', f.periodStart)} إلى ${day('ar', f.periodEnd)}.`,
          'هذا البريد إيصال بالدفعة.',
        ],
        button: 'عرض الفوترة',
      },
      en: {
        subject: `Payment received: ${money('en')}`,
        body: [
          `We received ${money('en')} from ${card('en')} for the ${plan('en')} plan (${period('en')}), from ${day('en', f.periodStart)} to ${day('en', f.periodEnd)}.`,
          'This email is your receipt.',
        ],
        button: 'View billing',
      },
    },
    failed: {
      ar: {
        subject: 'لم تتم دفعتك',
        body: [
          `لم نتمكن من خصم ${money('ar')} من ${card('ar')}${f.reason ? ` (${f.reason})` : ''}.`,
          'توقفت تالوس عن مراسلة مدينيك وعن التقديم في ناجز حتى تتم الدفعة.',
          ...(f.retryAt ? [`سنحاول الخصم من البطاقة مرة أخرى في ${day('ar', f.retryAt)}.`] : []),
          'يمكنك الدفع الآن بالبطاقة نفسها أو ببطاقة جديدة.',
        ],
        button: 'الدفع الآن',
      },
      en: {
        subject: 'Your payment did not go through',
        body: [
          `We could not charge ${money('en')} to ${card('en')}${f.reason ? ` (${f.reason})` : ''}.`,
          'Talos has stopped sending messages to your debtors and filing on Najiz until the payment goes through.',
          ...(f.retryAt ? [`We will try the card again on ${day('en', f.retryAt)}.`] : []),
          'You can pay now with the same card or a new one.',
        ],
        button: 'Pay now',
      },
    },
    renewal_soon: {
      ar: {
        subject: `يتجدد اشتراكك السنوي في ${day('ar', f.date)}`,
        body: [
          `سنخصم ${money('ar')} من ${card('ar')} في ${day('ar', f.date)}، عن سنة أخرى من باقة ${plan('ar')}.`,
          'لتغيير البطاقة أو الإلغاء، افتح الإعدادات ثم الفوترة.',
        ],
        button: 'عرض الفوترة',
      },
      en: {
        subject: `Your yearly plan renews on ${day('en', f.date)}`,
        body: [
          `We will charge ${money('en')} to ${card('en')} on ${day('en', f.date)} for another year of the ${plan('en')} plan.`,
          'To change the card or cancel, open Settings, then Billing.',
        ],
        button: 'View billing',
      },
    },
    cancelled: {
      ar: {
        subject: 'تم إلغاء اشتراكك',
        body: [
          `ينتهي اشتراكك في ${day('ar', f.date)}. وحتى ذلك الحين تعمل تالوس كالمعتاد، ولا يُخصم أي مبلغ آخر.`,
          `يمكنك التراجع عن الإلغاء قبل ${day('ar', f.date)}.`,
        ],
        button: 'عرض الفوترة',
      },
      en: {
        subject: 'Your subscription is cancelled',
        body: [
          `Your subscription ends on ${day('en', f.date)}. Until then Talos works as usual, and nothing more is charged.`,
          `You can undo this before ${day('en', f.date)}.`,
        ],
        button: 'View billing',
      },
    },
    ended: {
      ar: {
        subject: 'انتهى اشتراكك',
        body: ['توقفت تالوس عن مراسلة مدينيك وعن التقديم في ناجز. بياناتك محفوظة في حسابك.', 'يمكنك الاشتراك مرة أخرى في أي وقت من الإعدادات ثم الفوترة.'],
        button: 'الاشتراك مرة أخرى',
      },
      en: {
        subject: 'Your subscription has ended',
        body: ['Talos has stopped sending messages to your debtors and filing on Najiz. Your data is safe in your account.', 'You can subscribe again at any time from Settings, then Billing.'],
        button: 'Subscribe again',
      },
    },
  };

  const { ar, en } = texts[kind];
  const text = [...ar.body, f.link, '', '---', '', ...en.body, f.link].join('\n');
  const block = (t: T, dir: 'rtl' | 'ltr', font: string) => `
    <div dir="${dir}" style="font-family:${font};text-align:${dir === 'rtl' ? 'right' : 'left'};color:#121B33;line-height:1.7">
      <p style="margin:0 0 12px;font-weight:600">${esc(t.subject)}</p>
      ${t.body.map((b) => `<p style="margin:0 0 12px">${esc(b)}</p>`).join('')}
      <p style="margin:8px 0 0"><a href="${esc(f.link)}" style="display:inline-block;background:#0B7F58;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${esc(t.button)}</a></p>
    </div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#F2F4F8;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E6EE">
    <div style="background:#121B33;color:#ffffff;padding:20px 28px;font-family:Arial,sans-serif;font-weight:700;letter-spacing:1px">TALOS</div>
    <div style="padding:28px">
      ${block(ar, 'rtl', "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif")}
      <hr style="border:0;border-top:1px solid #E2E6EE;margin:28px 0">
      ${block(en, 'ltr', "'IBM Plex Sans',Arial,sans-serif")}
    </div>
  </div></body></html>`;
  return { to, subject: `${ar.subject} | ${en.subject}`, text, html };
}
