/**
 * The terms of use, the privacy policy and the refund and cancellation policy,
 * in Arabic and English with the same shape (the compiler and a test check it).
 *
 * Written by Claude for Sal on 25 November 2026 from the Personal Data
 * Protection Law (PDPL), its Implementing Regulations and the Regulation on
 * Personal Data Transfer outside the Kingdom, and from what the product does
 * today. The terms and the privacy policy were approved by Sal's lawyer on
 * 26 November 2026. The refund and cancellation policy (written 26 November
 * 2026, with payments, step 7.6) and the line of the terms that points to it
 * wait for the lawyer.
 *
 * Any change to the meaning of these texts goes back to the lawyer: set that
 * page to false in `REVIEWED` until it is approved (the page then says it is a
 * draft, and a production build refuses to run), and change TERMS_VERSION
 * here and in api/src/routes/onboarding.ts so new sign-ups record it.
 *
 * Talos's legal name, commercial registration, address and privacy email are
 * settings (LEGAL_NAME, LEGAL_CR, LEGAL_ADDRESS, PRIVACY_EMAIL), never written
 * here: this repository is public. In the text they are {entity}, {cr},
 * {address} and {email}; {pricing} links to the pricing page and {refunds} to
 * the refund and cancellation policy.
 *
 * Say only what the product does today. When the product changes how it uses
 * personal data, change these pages in the same pull request.
 */
import type { Lang } from './content.js';

export type LegalKind = 'terms' | 'privacy' | 'refunds';
export const LEGAL_KINDS: LegalKind[] = ['terms', 'privacy', 'refunds'];

/** Which pages the lawyer has approved as they are written here. */
export const REVIEWED: Record<LegalKind, boolean> = { terms: false, privacy: true, refunds: false };
/** All of them: a production build needs this. */
export const LEGAL_REVIEWED = LEGAL_KINDS.every((k) => REVIEWED[k]);
/** The date of the last change, shown on every page. */
export const LEGAL_UPDATED = '2026-11-26';
/** Recorded with every sign-up, so we know which terms each company agreed to. */
export const TERMS_VERSION = '2026-11-26';

/** A paragraph, or a list of points. */
export type Block = string | { list: string[] };

export interface LegalPage {
  meta: { title: string; description: string };
  title: string;
  updated: string;
  intro: string;
  contents: string;
  sections: { id: string; title: string; body: Block[] }[];
}

export interface LegalCopy {
  draft: string;
  terms: LegalPage;
  privacy: LegalPage;
  refunds: LegalPage;
}

// ------------------------------------------------------------------ English

const enTerms: LegalPage = {
  meta: {
    title: 'Terms of use | Talos Debt Collection',
    description: 'The terms that apply when a company uses Talos Debt Collection: the trial, subscription and payment, what Talos does and does not do, Najiz filing, and data protection.',
  },
  title: 'Terms of use',
  updated: 'Last updated: {date}',
  intro: 'These terms are an agreement between {entity}, commercial registration {cr} ("Talos", "we"), and the company that creates an account ("the client", "you"). By creating an account, or by using Talos Debt Collection, you agree to them on behalf of your company. Please read them with our privacy policy.',
  contents: 'On this page',
  sections: [
    {
      id: 'words',
      title: '1. Words used in these terms',
      body: [
        {
          list: [
            'The service: Talos Debt Collection, its dashboard, its WhatsApp messages and everything else Talos provides with it.',
            'Debtor: a person or company that owes the client money and whose details the client adds to the service.',
            'Owner: the client’s owner or the person the client has authorized to act for it, who approves Najiz sign-ins through Nafath.',
            'Users: the client’s staff that the client invites to its account.',
            'Plan: one of the plans on the pricing page ({pricing}), with what it includes.',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: '2. Your account',
      body: [
        'The service is for companies and establishments with a valid commercial registration in Saudi Arabia. The person who creates the account confirms that they may act for the company.',
        'You give us true and complete details and keep them up to date: the company’s details, the owner’s details and the bank account where debtors pay.',
        'You decide who on your team has access and what they can do. You are responsible for what your users do in your account. Keep passwords private, and tell us at once if you think someone else has used your account.',
      ],
    },
    {
      id: 'trial',
      title: '3. Free trial, subscription and payment',
      body: [
        {
          list: [
            'Every plan can be tried free for 14 days. No card is needed to start the trial.',
            'To keep using the service after the trial, the owner or an admin adds a payment card before the trial ends. If no card is added, Talos stops sending messages to your debtors and stops filing on Najiz, and your data stays in your account until you subscribe or ask us to delete it.',
            'Each plan starts at 250 debtors and is paid monthly or yearly, in advance. Prices are on the pricing page and in your account, with value added tax as the law requires.',
            'Your subscription renews on its own at the end of each period, by charging the card you added, until you cancel it. We send an invoice for every payment.',
            'You may change your plan at any time. A higher plan starts at once; a lower plan starts at the next period.',
            'You may cancel at any time from your account. The cancellation takes effect at the end of the period you have paid for. Amounts already paid are not refunded, except as our refund and cancellation policy ({refunds}) says or where the law requires it.',
            'If a payment fails, Talos stops sending messages to your debtors and stops filing on Najiz at once, and tells the owner. Everything starts again as soon as the payment goes through. Your data stays in your account.',
            'We may change our prices. We tell you at least 30 days before a new price applies to you, and it applies from your next period.',
          ],
        },
      ],
    },
    {
      id: 'service',
      title: '4. What Talos does, and what it does not do',
      body: [
        'Talos is a software service that helps your company follow up with the people who owe it money. Talos sends messages in your company’s name, on the rules you set, and shows you every reply, promise, payment and dispute.',
        {
          list: [
            'Talos does not buy debts and does not collect money: debtors pay into your company’s own bank account. Talos never holds your money.',
            'Talos does not decide amounts. Amounts, dates and references come only from your records. Every reply written with the help of artificial intelligence is checked against your records before it is sent; when it cannot be checked, a safe reply is sent and the conversation is passed to your staff.',
            'Talos is not a law firm and does not give legal advice. The legal pages, the filing pack and the readiness checks help you prepare; the decision to take legal action is always yours.',
            'Talos does not promise that any debt will be paid.',
          ],
        },
      ],
    },
    {
      id: 'client',
      title: '5. What you promise',
      body: [
        {
          list: [
            'Every debt you add is real, due and supported by your records, and the amount is correct.',
            'You have the right under the Personal Data Protection Law to give Talos your debtors’ personal data and to contact them about their debts, and you have told them, as the law requires, that their data may be used for this.',
            'You sign the authorization letter that allows Talos to message your debtors in your company’s name, before the first message is sent.',
            'You follow the laws and rules that apply to your company and to collecting debts in your sector.',
            'You review payments, promises and disputes that Talos shows you, and you correct a wrong amount as soon as you know about it. When a debtor says an amount is wrong, Talos records a dispute and stops reminders until your staff resolve it.',
          ],
        },
      ],
    },
    {
      id: 'conduct',
      title: '6. How Talos messages your debtors',
      body: [
        'To protect your debtors and your company, Talos always keeps these rules, and you may not ask it to break them:',
        {
          list: [
            'Messages are sent only on your working days and hours.',
            'Messages state facts. The only consequence mentioned is that unpaid amounts may be referred for legal procedures.',
            'Talos never contacts a debtor’s family, employer or anyone else about the debt, and never mentions other debtors.',
            'Talos stops reminders when a debt is paid, when the debtor promises to pay, when there is an open dispute, when you pause it, or when the debtor asks not to be contacted.',
            'Talos uses only message templates approved by WhatsApp, and follows WhatsApp’s rules.',
          ],
        },
      ],
    },
    {
      id: 'najiz',
      title: '7. Filing on Najiz',
      body: [
        'On the plans that include it, Talos can file execution requests on Najiz for your company, as your company’s legal representative, and read their status.',
        {
          list: [
            'Your owner approves every sign-in through Nafath on their own phone. Talos never asks for or keeps a Nafath or Najiz password.',
            'You approve every filing in your account before it is sent, and you confirm the contact email and mobile sent with it each time.',
            'You are responsible for the content of each request and its documents. Before pressing send, Talos checks every value on Najiz against your records; if anything is different or unexpected, Talos stops and tells your staff, and does not guess.',
            'Talos keeps nothing about the Najiz session after the sign-in ends.',
            'Najiz is run by the Ministry of Justice. Talos does not control it, its decisions or how long it takes, and is not responsible when Najiz is unavailable or changes.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: '8. Using the service properly',
      body: [
        'You may not use the service to:',
        {
          list: [
            'follow up on a debt that is not real, not due or already paid;',
            'send messages that harass, threaten or mislead anyone;',
            'add data you have no right to use, or data of people who are not your debtors;',
            'try to reach another client’s data, test the security of the service without our written permission, or copy, resell or take apart the service.',
          ],
        },
      ],
    },
    {
      id: 'data',
      title: '9. Personal data',
      body: [
        'For your debtors’ data, your company decides why and how it is used (the controller), and Talos uses it only to provide the service, on your instructions (the processor). For this data, Talos:',
        {
          list: [
            'uses it only to provide the service to you, and never sells it or uses it for anything else;',
            'keeps it in Saudi Arabia, protected by technical and organizational measures;',
            'limits access to the staff who need it to run the service, under a duty of confidentiality;',
            'uses only the service providers listed in our privacy policy, under written terms that protect the data, and tells you before adding a new one so you can object;',
            'tells you without undue delay if your data is breached, so you can tell the Saudi Data and AI Authority (SDAIA) within the time the law sets;',
            'helps you answer your debtors’ requests to see, correct or delete their data;',
            'deletes your data when your account is closed, as described in our privacy policy, unless the law requires us to keep it.',
          ],
        },
        'For the data of your users and of our own contacts, Talos is the controller. Our privacy policy explains this in full.',
      ],
    },
    {
      id: 'ours',
      title: '10. What belongs to whom',
      body: [
        'Your data belongs to you. You may export it while your account is open.',
        'The service, its software, its design and the Talos name belong to Talos. You may use the service while your subscription is active; this does not give you any other right to it.',
      ],
    },
    {
      id: 'availability',
      title: '11. Availability and changes',
      body: [
        'We work to keep the service available at all times, but it may stop for maintenance or for reasons outside our control, including WhatsApp, Najiz, Nafath or the internet. We tell you in advance about planned maintenance when we can.',
        'We improve the service over time. If we remove something important that your plan includes, we tell you at least 30 days before.',
      ],
    },
    {
      id: 'liability',
      title: '12. Limits of responsibility',
      body: [
        'Talos is responsible for providing the service with reasonable care and skill. To the extent the law allows:',
        {
          list: [
            'Talos is not responsible for a debt that is not paid, for the outcome of a legal procedure, or for losses caused by wrong data you gave;',
            'Talos is not responsible for indirect losses, such as lost profit or lost business;',
            'the total that Talos pays for all claims is no more than what you paid Talos in the 12 months before the claim.',
          ],
        },
        'Nothing in these terms limits a responsibility that the law does not allow to be limited.',
      ],
    },
    {
      id: 'end',
      title: '13. Pausing and closing an account',
      body: [
        'You may close your account at any time. Talos may pause or close an account that breaks these terms or the law, or that puts debtors or other clients at risk. When we can, we tell you first and give you time to fix the problem.',
        'Before your account is closed you may export your data. After it is closed, your data is deleted as described in our privacy policy, including all your Najiz data. Talos keeps only a short record of your company, with no debtor data, as the privacy policy explains.',
      ],
    },
    {
      id: 'changes',
      title: '14. Changes to these terms',
      body: [
        'We may change these terms. We tell the owner by email at least 30 days before an important change takes effect. If you do not agree, you may cancel before it takes effect.',
      ],
    },
    {
      id: 'law',
      title: '15. Law and disputes',
      body: [
        'These terms follow the laws of the Kingdom of Saudi Arabia. If a disagreement cannot be settled between us within 30 days, it is decided by the competent courts in the Kingdom of Saudi Arabia. If the Arabic and English texts differ, the Arabic text applies.',
      ],
    },
    {
      id: 'contact',
      title: '16. Contact us',
      body: ['{entity}, {address}. Email: {email}.'],
    },
  ],
};

const enPrivacy: LegalPage = {
  meta: {
    title: 'Privacy policy | Talos Debt Collection',
    description: 'How Talos Debt Collection collects, uses, stores and protects personal data, under the Saudi Personal Data Protection Law, and how to use your rights.',
  },
  title: 'Privacy policy',
  updated: 'Last updated: {date}',
  intro: 'This policy explains how {entity}, commercial registration {cr} ("Talos", "we"), uses personal data in Talos Debt Collection and on this website, under the Personal Data Protection Law of the Kingdom of Saudi Arabia and its regulations.',
  contents: 'On this page',
  sections: [
    {
      id: 'who',
      title: '1. Who this policy is for',
      body: [
        {
          list: [
            'Visitors to this website, and people who contact us.',
            'Companies that use Talos (our clients), their owners and their staff.',
            'Debtors: people who owe money to one of our clients, whose details the client added to Talos.',
          ],
        },
      ],
    },
    {
      id: 'role',
      title: '2. Our role',
      body: [
        'For debtors’ data, the client company that is owed the money decides why and how the data is used: it is the controller. Talos uses that data only to provide the service to the client, on its instructions: Talos is the processor. If you are a debtor, the company you owe is the first place for questions about your data, and we help it answer them.',
        'For the data of website visitors, our clients’ owners and staff, and people who contact us, Talos is the controller.',
      ],
    },
    {
      id: 'what',
      title: '3. What we collect',
      body: [
        'From website visitors and people who contact us: the name, company, mobile, email and message written in the contact form, and the way you want us to reply. The form sends these to our inbox; the website does not store them. The website uses no cookies and no tracking.',
        'From our clients, their owners and staff:',
        {
          list: [
            'the company’s details: name, commercial registration, unified number, value added tax number, establishment contract and the bank account (IBAN) where debtors pay;',
            'the owner’s name, ID number, mobile and email, which Najiz asks for. After it is saved, the dashboard shows only the last four digits of the ID number;',
            'each user’s name, email, mobile and role, a password stored only in a form that cannot be turned back into the password, and records of sign-ins;',
            'one cookie that keeps a user signed in. It is needed for the service to work and is not used for anything else;',
            'payment details, which are handled by our payment provider. Talos does not store full card numbers.',
          ],
        },
        'About debtors, what the client gives us and what happens in the follow-up:',
        {
          list: [
            'name, mobile numbers, ID, iqama or passport number, nationality, national address and preferred language;',
            'each debt: amount, dates, reference, and the promissory note or other document behind it;',
            'every WhatsApp message to and from the debtor, promises to pay, receipts the debtor sends, payments, disputes and requests not to be contacted;',
            'when a debt goes to the execution court: the details Najiz asks for, the request number and its status.',
          ],
        },
      ],
    },
    {
      id: 'why',
      title: '4. Why we use it',
      body: [
        {
          list: [
            'To provide the service: send reminders on the client’s rules, reply to debtors from the client’s own records, record promises, receipts and disputes, and prepare and file legal requests the client approves. (For clients: our contract. For debtors: the client’s legal basis, such as collecting a debt owed to it under a contract.)',
            'To run our clients’ accounts, bill them and support them. (Our contract with the client.)',
            'To keep the service secure and keep a record of every action that cannot be edited. (Our legal duties and our legitimate interest in protecting the service and its users.)',
            'To reply to people who contact us. (Your request.)',
            'To meet legal duties, such as tax invoices and requests from the authorities. (The law.)',
          ],
        },
        'We do not sell personal data, we do not use it for advertising, and we do not use debtors’ data for anything other than the client’s follow-up.',
      ],
    },
    {
      id: 'ai',
      title: '5. Artificial intelligence',
      body: [
        'Talos uses artificial intelligence to read debtors’ messages and receipts and to write replies. It works only from the debtor’s own records and the client’s documents. It never decides an amount: every amount in a reply must match the client’s records, or the reply is not sent and a person takes over. Every use of artificial intelligence is recorded.',
        'We use artificial intelligence providers only under terms that do not let them use this data to train their models.',
      ],
    },
    {
      id: 'share',
      title: '6. Who we share it with',
      body: [
        {
          list: [
            'The client: everything about its own debtors, and nothing about other clients’ debtors.',
            'Service providers who help us run Talos, under written terms that protect the data: cloud hosting in Saudi Arabia, WhatsApp (Meta) to send and receive messages, an artificial intelligence provider, an email provider and a payment provider.',
            'Najiz (the Ministry of Justice), when the client approves a filing, through the owner’s Nafath sign-in.',
            'Authorities, when the law requires it.',
          ],
        },
        'We never contact a debtor’s family or employer, and we never share a debtor’s data with anyone else.',
      ],
    },
    {
      id: 'where',
      title: '7. Where it is kept',
      body: [
        'Our database and files are kept in Saudi Arabia. Some of our service providers, such as WhatsApp and the artificial intelligence provider, may handle data outside the Kingdom to deliver their service. We allow this only as the Regulation on Personal Data Transfer outside the Kingdom permits, with the safeguards it requires, and only the data needed for that service.',
      ],
    },
    {
      id: 'keep',
      title: '8. How long we keep it',
      body: [
        {
          list: [
            'Client and debtor data: while the client’s account is open. When an account is closed, we delete its data within 30 days, including all its debtors’ data and all its Najiz data.',
            'After that we keep only a short record of the client company for our own reference: its name, commercial registration, the plans it used and when, its invoices and payments, and when it accepted our terms and signed the authorization letter. We keep invoices as long as tax law requires, and the rest for up to 5 years, in case of a question or a dispute. This record holds no debtor data.',
            'Najiz sign-in data: only while the sign-in lasts. The Nafath number is kept only while it is shown. Request numbers and status history are deleted with the client’s account.',
            'Contact form messages: in our inbox for as long as we need to reply and follow up, and no longer than 2 years.',
            'A client may also ask us to delete one debtor’s data at any time, unless the law requires us to keep it.',
          ],
        },
      ],
    },
    {
      id: 'security',
      title: '9. How we protect it',
      body: [
        {
          list: [
            'Data is encrypted when it is sent and when it is stored.',
            'Each client’s data is kept apart from every other client’s by the database itself, not only by the software.',
            'Users see only what their role allows, and every change is written to a log that cannot be edited.',
            'Passwords and sign-in links are stored only in a form that cannot be turned back. Talos never holds a Nafath or Najiz password.',
            'Developers work only with made-up data, never real data.',
          ],
        },
        'If personal data is breached, we tell the Saudi Data and AI Authority (SDAIA) within 72 hours when the law requires it, and the people affected without undue delay when it may harm them. When the data belongs to a client, we tell the client at once so it can do the same.',
      ],
    },
    {
      id: 'rights',
      title: '10. Your rights',
      body: [
        'Under the Personal Data Protection Law, you have the right to:',
        {
          list: [
            'know how your data is used (this policy);',
            'see your data and get a copy of it;',
            'have wrong or incomplete data corrected;',
            'have your data deleted when it is no longer needed, unless the law requires keeping it;',
            'withdraw your consent where we rely on it.',
          ],
        },
        'Write to {email}. We reply within 30 days, or tell you within that time if we need up to 30 more. We may ask you to prove who you are. If you are a debtor, we pass your request to the company you owe, and help it answer.',
        'A debtor who does not want to receive more messages can reply to Talos on WhatsApp at any time and say so; reminders stop and the company is told.',
        'You may also complain to the Saudi Data and AI Authority (SDAIA).',
      ],
    },
    {
      id: 'children',
      title: '11. Children',
      body: ['The service is for companies. We do not knowingly collect data about anyone under 18.'],
    },
    {
      id: 'changes',
      title: '12. Changes to this policy',
      body: ['We may change this policy. The date at the top shows the last change. When a change is important, we tell our clients by email before it takes effect.'],
    },
    {
      id: 'contact',
      title: '13. Contact us',
      body: ['{entity}, {address}. Email: {email}.'],
    },
  ],
};

// ------------------------------------------------------------------- Arabic

const arTerms: LegalPage = {
  meta: {
    title: 'شروط الاستخدام | تالوس لتحصيل الديون',
    description: 'الشروط التي تنطبق عند استخدام الشركات لتالوس لتحصيل الديون: التجربة والاشتراك والدفع، وما تقوم به تالوس وما لا تقوم به، والتقديم في ناجز، وحماية البيانات.',
  },
  title: 'شروط الاستخدام',
  updated: 'آخر تحديث: {date}',
  intro: 'هذه الشروط اتفاق بين {entity}، سجل تجاري رقم {cr} («تالوس» أو «نحن»)، والشركة التي تنشئ حساباً («العميل» أو «أنت»). بإنشائك حساباً أو استخدامك تالوس لتحصيل الديون، فإنك توافق عليها نيابة عن شركتك. نرجو قراءتها مع سياسة الخصوصية.',
  contents: 'في هذه الصفحة',
  sections: [
    {
      id: 'words',
      title: '1. الكلمات المستخدمة في هذه الشروط',
      body: [
        {
          list: [
            'الخدمة: تالوس لتحصيل الديون، ولوحة التحكم، ورسائل واتساب، وكل ما تقدمه تالوس معها.',
            'المدين: شخص أو شركة عليه مال للعميل، ويضيف العميل بياناته إلى الخدمة.',
            'المالك: مالك العميل أو الشخص المفوض بالتصرف عنه، والذي يوافق على الدخول إلى ناجز عبر نفاذ.',
            'المستخدمون: موظفو العميل الذين يدعوهم إلى حسابه.',
            'الباقة: إحدى الباقات المعروضة في صفحة الأسعار ({pricing})، بما تشمله.',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: '2. حسابك',
      body: [
        'الخدمة للشركات والمؤسسات التي لديها سجل تجاري ساري في المملكة العربية السعودية. ويؤكد من ينشئ الحساب أنه يحق له التصرف عن الشركة.',
        'تعطينا بيانات صحيحة وكاملة وتُبقيها محدّثة: بيانات الشركة، وبيانات المالك، والحساب البنكي الذي يدفع فيه المدينون.',
        'أنت تقرر من يدخل إلى الحساب من فريقك وما يمكنه فعله، وأنت مسؤول عما يفعله مستخدموك في حسابك. احفظ كلمات المرور سرية، وأخبرنا فوراً إذا ظننت أن غيرك استخدم حسابك.',
      ],
    },
    {
      id: 'trial',
      title: '3. التجربة المجانية والاشتراك والدفع',
      body: [
        {
          list: [
            'يمكن تجربة كل باقة مجاناً لمدة 14 يوماً، دون الحاجة إلى بطاقة للبدء.',
            'لمواصلة استخدام الخدمة بعد التجربة، يضيف المالك أو المسؤول بطاقة دفع قبل نهاية التجربة. وإذا لم تُضف بطاقة، تتوقف تالوس عن مراسلة مدينيك وعن التقديم في ناجز، وتبقى بياناتك في حسابك حتى تشترك أو تطلب منا حذفها.',
            'تبدأ كل باقة من 250 مديناً، وتُدفع شهرياً أو سنوياً مقدماً. والأسعار معروضة في صفحة الأسعار وفي حسابك، مع ضريبة القيمة المضافة كما يقتضي النظام.',
            'يتجدد اشتراكك تلقائياً في نهاية كل مدة بالخصم من البطاقة التي أضفتها، حتى تلغيه. ونرسل فاتورة عن كل دفعة.',
            'يمكنك تغيير باقتك في أي وقت. الباقة الأعلى تبدأ فوراً، والباقة الأدنى تبدأ من المدة التالية.',
            'يمكنك الإلغاء في أي وقت من حسابك، ويسري الإلغاء في نهاية المدة التي دفعت عنها. ولا تُسترد المبالغ المدفوعة إلا كما تنص سياسة الاسترداد والإلغاء ({refunds}) أو إذا اقتضى النظام ذلك.',
            'إذا تعذّر الدفع، تتوقف تالوس فوراً عن مراسلة مدينيك وعن التقديم في ناجز، وتُخبر المالك. ويعود كل شيء للعمل بمجرد إتمام الدفع. وتبقى بياناتك في حسابك.',
            'قد نغيّر أسعارنا. ونخبرك قبل 30 يوماً على الأقل من تطبيق السعر الجديد عليك، ويُطبق من مدتك التالية.',
          ],
        },
      ],
    },
    {
      id: 'service',
      title: '4. ما تقوم به تالوس وما لا تقوم به',
      body: [
        'تالوس خدمة برمجية تساعد شركتك على متابعة من عليهم مال لها. ترسل تالوس الرسائل باسم شركتك وحسب القواعد التي تضعها، وتعرض لك كل رد ووعد ودفعة واعتراض.',
        {
          list: [
            'لا تشتري تالوس الديون ولا تحصّل المال: يدفع المدينون في حساب شركتك البنكي مباشرة، ولا تحتفظ تالوس بأموالك أبداً.',
            'لا تحدد تالوس المبالغ. فالمبالغ والتواريخ والمراجع تأتي من سجلاتك فقط. وكل رد يُكتب بمساعدة الذكاء الاصطناعي يُطابق مع سجلاتك قبل إرساله، وإذا تعذرت المطابقة يُرسل رد آمن وتُحال المحادثة إلى موظفيك.',
            'تالوس ليست مكتب محاماة ولا تقدم استشارات قانونية. والصفحات القانونية وملف التقديم وفحص الجاهزية تساعدك في الاستعداد، أما قرار اتخاذ الإجراء القانوني فهو قرارك دائماً.',
            'لا تضمن تالوس سداد أي دين.',
          ],
        },
      ],
    },
    {
      id: 'client',
      title: '5. ما تتعهد به',
      body: [
        {
          list: [
            'كل دين تضيفه حقيقي ومستحق وتثبته سجلاتك، ومبلغه صحيح.',
            'يحق لك وفق نظام حماية البيانات الشخصية أن تعطي تالوس البيانات الشخصية لمدينيك وأن تتواصل معهم بشأن ديونهم، وقد أبلغتهم كما يقتضي النظام بأن بياناتهم قد تُستخدم لذلك.',
            'توقّع خطاب التفويض الذي يسمح لتالوس بمراسلة مدينيك باسم شركتك، قبل إرسال أول رسالة.',
            'تلتزم بالأنظمة والقواعد التي تنطبق على شركتك وعلى تحصيل الديون في قطاعك.',
            'تراجع الدفعات والوعود والاعتراضات التي تعرضها تالوس، وتصحح أي مبلغ خاطئ فور علمك به. وعندما يقول المدين إن المبلغ خاطئ، تسجل تالوس اعتراضاً وتوقف التذكيرات حتى يحله موظفوك.',
          ],
        },
      ],
    },
    {
      id: 'conduct',
      title: '6. كيف تراسل تالوس مدينيك',
      body: [
        'حمايةً لمدينيك ولشركتك، تلتزم تالوس دائماً بهذه القواعد، ولا يحق لك أن تطلب منها مخالفتها:',
        {
          list: [
            'تُرسل الرسائل في أيام عملك وساعاته فقط.',
            'تذكر الرسائل الوقائع فقط، والعاقبة الوحيدة التي تُذكر هي أن المبالغ غير المدفوعة قد تُحال إلى الإجراءات النظامية.',
            'لا تتواصل تالوس أبداً مع أسرة المدين أو صاحب عمله أو أي شخص آخر بشأن الدين، ولا تذكر مدينين آخرين.',
            'توقف تالوس التذكيرات عند سداد الدين، أو وعد المدين بالسداد، أو وجود اعتراض مفتوح، أو إيقافك لها، أو طلب المدين عدم التواصل معه.',
            'تستخدم تالوس قوالب الرسائل المعتمدة من واتساب فقط، وتلتزم بقواعد واتساب.',
          ],
        },
      ],
    },
    {
      id: 'najiz',
      title: '7. التقديم في ناجز',
      body: [
        'في الباقات التي تشمله، يمكن لتالوس تقديم طلبات التنفيذ في ناجز عن شركتك، بصفتها ممثلاً نظامياً لشركتك، وقراءة حالتها.',
        {
          list: [
            'يوافق مالكك على كل دخول عبر نفاذ من جواله. ولا تطلب تالوس كلمة مرور نفاذ أو ناجز ولا تحتفظ بها أبداً.',
            'توافق على كل طلب في حسابك قبل إرساله، وتؤكد في كل مرة البريد والجوال المرسلين معه.',
            'أنت مسؤول عن محتوى كل طلب ومستنداته. وقبل الضغط على إرسال، تطابق تالوس كل قيمة في ناجز مع سجلاتك، وإذا اختلف أي شيء أو ظهر ما لم يكن متوقعاً، تتوقف تالوس وتخبر موظفيك ولا تخمّن.',
            'لا تحتفظ تالوس بأي شيء عن جلسة ناجز بعد انتهاء الدخول.',
            'ناجز منصة تديرها وزارة العدل. ولا تتحكم تالوس فيها ولا في قراراتها أو مددها، ولا تتحمل مسؤولية توقفها أو تغيّرها.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: '8. الاستخدام السليم للخدمة',
      body: [
        'لا يجوز استخدام الخدمة من أجل:',
        {
          list: [
            'متابعة دين غير حقيقي أو غير مستحق أو مدفوع؛',
            'إرسال رسائل فيها إزعاج أو تهديد أو تضليل لأي شخص؛',
            'إضافة بيانات لا يحق لك استخدامها، أو بيانات أشخاص ليسوا مدينين لك؛',
            'محاولة الوصول إلى بيانات عميل آخر، أو اختبار أمان الخدمة دون إذن مكتوب منا، أو نسخ الخدمة أو إعادة بيعها أو تفكيكها.',
          ],
        },
      ],
    },
    {
      id: 'data',
      title: '9. البيانات الشخصية',
      body: [
        'بالنسبة لبيانات مدينيك، فإن شركتك هي التي تحدد غرض استخدامها وطريقته (جهة التحكم)، وتستخدمها تالوس فقط لتقديم الخدمة وحسب تعليماتك (جهة المعالجة). وفيما يخص هذه البيانات، فإن تالوس:',
        {
          list: [
            'تستخدمها فقط لتقديم الخدمة لك، ولا تبيعها ولا تستخدمها لأي غرض آخر أبداً؛',
            'تحفظها داخل المملكة العربية السعودية، محمية بإجراءات تقنية وتنظيمية؛',
            'تقصر الوصول إليها على الموظفين الذين يحتاجونه لتشغيل الخدمة، مع التزامهم بالسرية؛',
            'لا تستعين إلا بمقدمي الخدمات المذكورين في سياسة الخصوصية، بشروط مكتوبة تحمي البيانات، وتخبرك قبل إضافة أي مقدم جديد ليكون لك حق الاعتراض؛',
            'تخبرك دون تأخير غير مبرر إذا تعرضت بياناتك لتسرب، لتتمكن من إبلاغ الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا) في المدة التي يحددها النظام؛',
            'تساعدك على الرد على طلبات مدينيك للاطلاع على بياناتهم أو تصحيحها أو حذفها؛',
            'تحذف بياناتك عند إغلاق حسابك كما توضح سياسة الخصوصية، ما لم يُلزمنا النظام بالاحتفاظ بها.',
          ],
        },
        'أما بيانات مستخدميك وجهات تواصلنا، فإن تالوس هي جهة التحكم فيها. وتشرح سياسة الخصوصية ذلك بالتفصيل.',
      ],
    },
    {
      id: 'ours',
      title: '10. الملكية',
      body: [
        'بياناتك ملك لك، ويمكنك تصديرها ما دام حسابك مفتوحاً.',
        'الخدمة وبرمجياتها وتصميمها واسم تالوس ملك لتالوس. ويحق لك استخدام الخدمة ما دام اشتراكك سارياً، ولا يمنحك ذلك أي حق آخر فيها.',
      ],
    },
    {
      id: 'availability',
      title: '11. توفر الخدمة وتغييرها',
      body: [
        'نعمل على إبقاء الخدمة متاحة في كل الأوقات، لكنها قد تتوقف للصيانة أو لأسباب خارجة عن إرادتنا، منها واتساب أو ناجز أو نفاذ أو الإنترنت. ونخبرك مسبقاً بالصيانة المخطط لها متى أمكن.',
        'نطوّر الخدمة باستمرار. وإذا أزلنا شيئاً مهماً تشمله باقتك، نخبرك قبل 30 يوماً على الأقل.',
      ],
    },
    {
      id: 'liability',
      title: '12. حدود المسؤولية',
      body: [
        'تتحمل تالوس مسؤولية تقديم الخدمة بعناية ومهارة معقولتين. وفي الحدود التي يسمح بها النظام:',
        {
          list: [
            'لا تتحمل تالوس مسؤولية عدم سداد أي دين، ولا نتيجة أي إجراء نظامي، ولا الخسائر الناتجة عن بيانات خاطئة قدمتها؛',
            'لا تتحمل تالوس مسؤولية الخسائر غير المباشرة، مثل فوات الربح أو خسارة الأعمال؛',
            'لا يزيد مجموع ما تدفعه تالوس عن كل المطالبات على ما دفعته لتالوس خلال 12 شهراً قبل المطالبة.',
          ],
        },
        'لا شيء في هذه الشروط يحدّ من مسؤولية لا يجيز النظام الحد منها.',
      ],
    },
    {
      id: 'end',
      title: '13. إيقاف الحساب وإغلاقه',
      body: [
        'يمكنك إغلاق حسابك في أي وقت. ويحق لتالوس إيقاف أو إغلاق الحساب الذي يخالف هذه الشروط أو النظام، أو يعرّض المدينين أو العملاء الآخرين للخطر. ونخبرك أولاً متى أمكن، ونمنحك وقتاً لمعالجة المشكلة.',
        'يمكنك تصدير بياناتك قبل إغلاق حسابك. وبعد إغلاقه تُحذف بياناتك كما توضح سياسة الخصوصية، بما فيها كل بياناتك في ناجز. ولا تحتفظ تالوس إلا بسجل مختصر عن شركتك دون أي بيانات عن المدينين، كما توضح سياسة الخصوصية.',
      ],
    },
    {
      id: 'changes',
      title: '14. تغيير هذه الشروط',
      body: [
        'قد نغيّر هذه الشروط. ونخبر المالك بالبريد قبل 30 يوماً على الأقل من سريان أي تغيير مهم. وإذا لم توافق، يمكنك الإلغاء قبل سريانه.',
      ],
    },
    {
      id: 'law',
      title: '15. النظام والنزاعات',
      body: [
        'تخضع هذه الشروط لأنظمة المملكة العربية السعودية. وإذا لم يُحل أي خلاف بيننا خلال 30 يوماً، تفصل فيه المحاكم المختصة في المملكة العربية السعودية. وعند اختلاف النصين العربي والإنجليزي، يُعمل بالنص العربي.',
      ],
    },
    {
      id: 'contact',
      title: '16. تواصل معنا',
      body: ['{entity}، {address}. البريد: {email}.'],
    },
  ],
};

const arPrivacy: LegalPage = {
  meta: {
    title: 'سياسة الخصوصية | تالوس لتحصيل الديون',
    description: 'كيف تجمع تالوس لتحصيل الديون البيانات الشخصية وتستخدمها وتحفظها وتحميها وفق نظام حماية البيانات الشخصية السعودي، وكيف تمارس حقوقك.',
  },
  title: 'سياسة الخصوصية',
  updated: 'آخر تحديث: {date}',
  intro: 'توضح هذه السياسة كيف تستخدم {entity}، سجل تجاري رقم {cr} («تالوس» أو «نحن»)، البيانات الشخصية في تالوس لتحصيل الديون وفي هذا الموقع، وفق نظام حماية البيانات الشخصية في المملكة العربية السعودية ولوائحه.',
  contents: 'في هذه الصفحة',
  sections: [
    {
      id: 'who',
      title: '1. لمن هذه السياسة',
      body: [
        {
          list: [
            'زوار هذا الموقع ومن يتواصل معنا.',
            'الشركات التي تستخدم تالوس (عملاؤنا)، وملاكها وموظفوها.',
            'المدينون: من عليهم مال لأحد عملائنا، وأضاف العميل بياناتهم إلى تالوس.',
          ],
        },
      ],
    },
    {
      id: 'role',
      title: '2. دورنا',
      body: [
        'بالنسبة لبيانات المدينين، فإن الشركة الدائنة هي التي تحدد غرض استخدام البيانات وطريقته، فهي جهة التحكم. وتستخدم تالوس هذه البيانات فقط لتقديم الخدمة للعميل وحسب تعليماته، فهي جهة المعالجة. وإذا كنت مديناً، فالشركة التي عليك مال لها هي أول جهة تسألها عن بياناتك، ونحن نساعدها في الرد.',
        'أما بيانات زوار الموقع، وملاك عملائنا وموظفيهم، ومن يتواصل معنا، فإن تالوس هي جهة التحكم فيها.',
      ],
    },
    {
      id: 'what',
      title: '3. ما نجمعه',
      body: [
        'من زوار الموقع ومن يتواصل معنا: الاسم والشركة والجوال والبريد والرسالة المكتوبة في نموذج التواصل، والطريقة التي تفضل أن نرد بها. يرسل النموذج هذه البيانات إلى بريدنا، ولا يحفظها الموقع. ولا يستخدم الموقع ملفات تعريف الارتباط ولا أي تتبع.',
        'من عملائنا وملاكهم وموظفيهم:',
        {
          list: [
            'بيانات الشركة: الاسم والسجل التجاري والرقم الموحد والرقم الضريبي وعقد التأسيس والحساب البنكي (الآيبان) الذي يدفع فيه المدينون؛',
            'اسم المالك ورقم هويته وجواله وبريده، وهي ما يطلبه ناجز. وبعد حفظ رقم الهوية لا تعرض لوحة التحكم إلا آخر أربعة أرقام منه؛',
            'اسم كل مستخدم وبريده وجواله ودوره، وكلمة مرور محفوظة بصيغة لا يمكن إرجاعها إلى كلمة المرور، وسجلات الدخول؛',
            'ملف تعريف ارتباط واحد يُبقي المستخدم داخلاً إلى حسابه، وهو ضروري لعمل الخدمة ولا يُستخدم لأي غرض آخر؛',
            'بيانات الدفع، ويتولاها مقدم خدمة الدفع. ولا تحفظ تالوس أرقام البطاقات كاملة.',
          ],
        },
        'عن المدينين، ما يعطينا إياه العميل وما يحدث أثناء المتابعة:',
        {
          list: [
            'الاسم وأرقام الجوال ورقم الهوية أو الإقامة أو الجواز والجنسية والعنوان الوطني واللغة المفضلة؛',
            'كل دين: مبلغه وتواريخه ومرجعه، والسند لأمر أو المستند الذي يثبته؛',
            'كل رسالة واتساب من المدين وإليه، ووعود السداد، والإيصالات التي يرسلها، والدفعات، والاعتراضات، وطلبات عدم التواصل؛',
            'عند إحالة الدين إلى محكمة التنفيذ: البيانات التي يطلبها ناجز، ورقم الطلب وحالته.',
          ],
        },
      ],
    },
    {
      id: 'why',
      title: '4. لماذا نستخدمها',
      body: [
        {
          list: [
            'لتقديم الخدمة: إرسال التذكيرات حسب قواعد العميل، والرد على المدينين من سجلات العميل نفسه، وتسجيل الوعود والإيصالات والاعتراضات، وإعداد الطلبات القانونية التي يوافق عليها العميل وتقديمها. (للعملاء: عقدنا معهم. وللمدينين: الأساس النظامي للعميل، مثل تحصيل دين مستحق له بموجب عقد.)',
            'لإدارة حسابات عملائنا وفوترتهم ودعمهم. (عقدنا مع العميل.)',
            'لحماية الخدمة والاحتفاظ بسجل لكل إجراء لا يمكن تعديله. (التزاماتنا النظامية ومصلحتنا المشروعة في حماية الخدمة ومستخدميها.)',
            'للرد على من يتواصل معنا. (طلبك.)',
            'للوفاء بالالتزامات النظامية، مثل الفواتير الضريبية وطلبات الجهات المختصة. (النظام.)',
          ],
        },
        'لا نبيع البيانات الشخصية، ولا نستخدمها للإعلان، ولا نستخدم بيانات المدينين في غير متابعة العميل.',
      ],
    },
    {
      id: 'ai',
      title: '5. الذكاء الاصطناعي',
      body: [
        'تستخدم تالوس الذكاء الاصطناعي لقراءة رسائل المدينين وإيصالاتهم وكتابة الردود. ويعمل فقط من سجلات المدين نفسه ومستندات العميل، ولا يحدد أي مبلغ أبداً: فكل مبلغ في الرد يجب أن يطابق سجلات العميل، وإلا لا يُرسل الرد ويتولى المحادثة شخص من الفريق. ويُسجل كل استخدام للذكاء الاصطناعي.',
        'لا نستخدم مقدمي خدمات الذكاء الاصطناعي إلا بشروط لا تسمح لهم باستخدام هذه البيانات لتدريب نماذجهم.',
      ],
    },
    {
      id: 'share',
      title: '6. مع من نشاركها',
      body: [
        {
          list: [
            'العميل: كل ما يخص مدينيه، ولا شيء عن مديني العملاء الآخرين.',
            'مقدمو الخدمات الذين يساعدوننا في تشغيل تالوس، بشروط مكتوبة تحمي البيانات: الاستضافة السحابية داخل المملكة، وواتساب (ميتا) لإرسال الرسائل واستقبالها، ومقدم خدمة الذكاء الاصطناعي، ومقدم خدمة البريد، ومقدم خدمة الدفع.',
            'ناجز (وزارة العدل)، عند موافقة العميل على تقديم طلب، عبر دخول المالك بنفاذ.',
            'الجهات المختصة، عندما يقتضي النظام ذلك.',
          ],
        },
        'لا نتواصل أبداً مع أسرة المدين أو صاحب عمله، ولا نشارك بيانات المدين مع أي جهة أخرى.',
      ],
    },
    {
      id: 'where',
      title: '7. أين تُحفظ',
      body: [
        'تُحفظ قاعدة بياناتنا وملفاتنا داخل المملكة العربية السعودية. وقد يعالج بعض مقدمي الخدمات، مثل واتساب ومقدم خدمة الذكاء الاصطناعي، البيانات خارج المملكة لتقديم خدمتهم. ولا نسمح بذلك إلا وفق لائحة نقل البيانات الشخصية خارج المملكة وبالضمانات التي تشترطها، وبقدر البيانات اللازمة لتلك الخدمة فقط.',
      ],
    },
    {
      id: 'keep',
      title: '8. مدة الاحتفاظ',
      body: [
        {
          list: [
            'بيانات العميل ومدينيه: ما دام حساب العميل مفتوحاً. وعند إغلاق الحساب نحذف بياناته خلال 30 يوماً، بما فيها كل بيانات مدينيه وكل بياناته في ناجز.',
            'وبعد ذلك نحتفظ فقط بسجل مختصر عن الشركة العميلة للرجوع إليه: اسمها وسجلها التجاري والباقات التي استخدمتها ومدتها وفواتيرها ومدفوعاتها، ووقت موافقتها على شروطنا وتوقيعها خطاب التفويض. ونحتفظ بالفواتير المدة التي يقتضيها النظام الضريبي، وبالباقي مدة لا تزيد على 5 سنوات، تحسباً لأي استفسار أو نزاع. ولا يتضمن هذا السجل أي بيانات عن المدينين.',
            'بيانات الدخول إلى ناجز: طوال مدة الدخول فقط. ويُحفظ رقم نفاذ فقط طوال مدة عرضه. وتُحذف أرقام الطلبات وسجل حالاتها مع حساب العميل.',
            'رسائل نموذج التواصل: في بريدنا ما دمنا نحتاجها للرد والمتابعة، ولمدة لا تزيد على سنتين.',
            'ويمكن للعميل أيضاً أن يطلب منا حذف بيانات أي مدين في أي وقت، ما لم يُلزمنا النظام بالاحتفاظ بها.',
          ],
        },
      ],
    },
    {
      id: 'security',
      title: '9. كيف نحميها',
      body: [
        {
          list: [
            'البيانات مشفرة أثناء نقلها وأثناء حفظها.',
            'بيانات كل عميل مفصولة عن بيانات غيره بقاعدة البيانات نفسها، لا بالبرمجيات وحدها.',
            'لا يرى المستخدم إلا ما يسمح به دوره، ويُكتب كل تغيير في سجل لا يمكن تعديله.',
            'تُحفظ كلمات المرور وروابط الدخول بصيغة لا يمكن إرجاعها. ولا تحتفظ تالوس أبداً بكلمة مرور نفاذ أو ناجز.',
            'يعمل المطورون ببيانات وهمية فقط، ولا يستخدمون بيانات حقيقية أبداً.',
          ],
        },
        'إذا تعرضت بيانات شخصية لتسرب، نبلغ الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا) خلال 72 ساعة متى اقتضى النظام ذلك، ونبلغ المتأثرين دون تأخير غير مبرر متى كان التسرب قد يضرهم. وإذا كانت البيانات تخص عميلاً، نبلغه فوراً ليقوم بالمثل.',
      ],
    },
    {
      id: 'rights',
      title: '10. حقوقك',
      body: [
        'وفق نظام حماية البيانات الشخصية، يحق لك:',
        {
          list: [
            'أن تعرف كيف تُستخدم بياناتك (هذه السياسة)؛',
            'أن تطّلع على بياناتك وتحصل على نسخة منها؛',
            'أن تُصحح البيانات الخاطئة أو الناقصة؛',
            'أن تُحذف بياناتك عندما لا تعود هناك حاجة إليها، ما لم يقتضِ النظام الاحتفاظ بها؛',
            'أن تسحب موافقتك متى كنا نعتمد عليها.',
          ],
        },
        'راسلنا على {email}. نرد خلال 30 يوماً، أو نخبرك خلالها إذا احتجنا إلى 30 يوماً أخرى بحد أقصى. وقد نطلب منك إثبات هويتك. وإذا كنت مديناً، نحيل طلبك إلى الشركة التي عليك مال لها ونساعدها في الرد.',
        'يمكن للمدين الذي لا يريد مزيداً من الرسائل أن يرد على تالوس في واتساب في أي وقت ويقول ذلك، فتتوقف التذكيرات وتُبلغ الشركة.',
        'ويمكنك أيضاً تقديم شكوى إلى الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا).',
      ],
    },
    {
      id: 'children',
      title: '11. الأطفال',
      body: ['الخدمة موجهة للشركات، ولا نجمع عن علم بيانات أي شخص دون 18 عاماً.'],
    },
    {
      id: 'changes',
      title: '12. تغيير هذه السياسة',
      body: ['قد نغيّر هذه السياسة، ويوضح التاريخ في أعلاها آخر تغيير. وعندما يكون التغيير مهماً، نخبر عملاءنا بالبريد قبل سريانه.'],
    },
    {
      id: 'contact',
      title: '13. تواصل معنا',
      body: ['{entity}، {address}. البريد: {email}.'],
    },
  ],
};

// ------------------------------------------------- Refunds and cancellation

const enRefunds: LegalPage = {
  meta: {
    title: 'Refund and cancellation policy | Talos Debt Collection',
    description: 'How the free trial, payments, renewals, cancelling and refunds work for Talos Debt Collection subscriptions.',
  },
  title: 'Refund and cancellation policy',
  updated: 'Last updated: {date}',
  intro: 'This policy explains how you pay for Talos Debt Collection, how to cancel, and when {entity}, commercial registration {cr} ("Talos", "we"), refunds a payment. It is part of our terms of use. Prices are on the pricing page ({pricing}).',
  contents: 'On this page',
  sections: [
    {
      id: 'short',
      title: '1. In short',
      body: [
        {
          list: [
            'The first 14 days are free, and no card is needed to start.',
            'You pay in advance, monthly or yearly, by card. Your subscription renews on its own until you cancel it.',
            'You can cancel at any time from your account. You keep the service until the end of the period you paid for, and you are not charged again.',
            'A period that has started is not refunded, except in the cases in section 5.',
            'Talos never receives the money your debtors pay you, so this policy covers only what you pay Talos.',
          ],
        },
      ],
    },
    {
      id: 'trial',
      title: '2. The free trial',
      body: [
        {
          list: [
            'Every plan can be tried free for 14 days. Nothing is charged during the trial.',
            'To keep the service after the trial, the owner or an admin adds a card in the account. To check the card, the payment provider holds 1 riyal and releases it at once; it is never taken.',
            'The first payment is taken from that card on the day the trial ends. If you are one of the first 10 companies that joined with the founding offer, your first month after the trial is also free, and the first payment is taken when that month ends.',
            'If no card is added by the end of the trial, nothing is charged, and Talos stops sending messages to your debtors and stops filing on Najiz until you add one.',
          ],
        },
      ],
    },
    {
      id: 'paying',
      title: '3. Paying and renewing',
      body: [
        {
          list: [
            'You pay in advance for one month or one year, as you chose, by mada, Visa or Mastercard. Prices include value added tax where the pricing page says so; otherwise tax is added as the law requires.',
            'Your card details go from your browser straight to the payment provider. Talos never receives or stores your card number; it keeps only the card type, its last four digits and its expiry date.',
            'At the end of each period, the same card is charged for the next one. For a yearly plan, we email the owner at least 7 days before the renewal.',
            'We email a receipt for every payment, and the invoice as the law requires.',
            'You can replace the card at any time from your account. The new card is used from the next payment.',
          ],
        },
      ],
    },
    {
      id: 'cancel',
      title: '4. Cancelling',
      body: [
        {
          list: [
            'The owner or an admin can cancel at any time from Settings, then Billing, or by emailing us at {email} from the owner’s email.',
            'Cancelling takes effect at the end of the period you have paid for. Until then the service works as usual, and nothing more is charged.',
            'You can undo the cancellation from the same place before the period ends.',
            'When the period ends, Talos stops sending messages to your debtors and stops filing on Najiz. Your data stays in your account until you subscribe again or ask us to close the account; closing the account deletes your data as our privacy policy explains.',
          ],
        },
      ],
    },
    {
      id: 'refunds',
      title: '5. Refunds',
      body: [
        'A period that has started is not refunded, including when you cancel during it, use the service less than planned or have fewer debtors than your plan allows. We refund in these cases:',
        {
          list: [
            'Charged by mistake: if you are charged twice for the same period, charged a wrong amount, or charged after you cancelled before the renewal date, we refund the amount charged by mistake in full.',
            'A new yearly plan: if you cancel within 14 days of the first payment of a yearly plan, we refund the yearly amount less the monthly price of each month that has started.',
            'A long stop on our side: if the service cannot be used for more than 3 days in a row because of a fault on Talos’s side, we refund the days it could not be used. This does not cover stops caused by WhatsApp, Najiz, Nafath, the internet or planned maintenance we told you about.',
            'Any other case where the law requires a refund.',
          ],
        },
        'To ask for a refund, email us at {email} within 30 days of the payment, with your company name and the date of the payment.',
      ],
    },
    {
      id: 'how',
      title: '6. How refunds are paid',
      body: [
        'We reply within 5 working days. An approved refund is sent to the same card within 14 days of our approval, through the payment provider; your bank may take a few more days to show it. The value added tax is refunded with the amount, and we issue a credit note as the law requires.',
      ],
    },
    {
      id: 'failed',
      title: '7. When a payment fails',
      body: [
        {
          list: [
            'If a payment fails, Talos stops sending messages to your debtors and stops filing on Najiz at once, and tells the owner and the admins by email and in the dashboard.',
            'We try the same card again after 1 day and after 3 days. You can also pay at any time from your account, with the same card or a new one.',
            'Everything starts again as soon as the payment goes through, and the new period starts on that day. There is no late fee.',
          ],
        },
      ],
    },
    {
      id: 'other',
      title: '8. Money that is not ours',
      body: [
        'Your debtors pay into your company’s own bank account. Talos never receives, holds or refunds that money; anything owed back to a debtor is between your company and the debtor. Fees charged by government bodies, such as courts, are not part of Talos’s prices, and Talos cannot refund them.',
      ],
    },
    {
      id: 'contact',
      title: '9. Changes and contact',
      body: [
        'We may change this policy as our terms of use explain, telling you at least 30 days before an important change. If the Arabic and English texts differ, the Arabic text applies.',
        '{entity}, {address}. Email: {email}.',
      ],
    },
  ],
};

const arRefunds: LegalPage = {
  meta: {
    title: 'سياسة الاسترداد والإلغاء | تالوس لتحصيل الديون',
    description: 'كيف تعمل التجربة المجانية والدفع والتجديد والإلغاء والاسترداد في اشتراكات تالوس لتحصيل الديون.',
  },
  title: 'سياسة الاسترداد والإلغاء',
  updated: 'آخر تحديث: {date}',
  intro: 'توضح هذه السياسة كيف تدفع مقابل تالوس لتحصيل الديون، وكيف تلغي اشتراكك، ومتى ترد {entity}، سجل تجاري رقم {cr} («تالوس» أو «نحن»)، مبلغاً مدفوعاً. وهي جزء من شروط الاستخدام. والأسعار معروضة في صفحة الأسعار ({pricing}).',
  contents: 'في هذه الصفحة',
  sections: [
    {
      id: 'short',
      title: '1. باختصار',
      body: [
        {
          list: [
            'أول 14 يوماً مجانية، دون الحاجة إلى بطاقة للبدء.',
            'تدفع مقدماً، شهرياً أو سنوياً، بالبطاقة. ويتجدد اشتراكك تلقائياً حتى تلغيه.',
            'يمكنك الإلغاء في أي وقت من حسابك. وتبقى الخدمة متاحة لك حتى نهاية المدة التي دفعت عنها، ولا يُخصم منك شيء بعدها.',
            'لا تُسترد مدة بدأت، إلا في الحالات الواردة في البند 5.',
            'لا تستلم تالوس أبداً الأموال التي يدفعها لك مدينوك، فهذه السياسة تخص فقط ما تدفعه لتالوس.',
          ],
        },
      ],
    },
    {
      id: 'trial',
      title: '2. التجربة المجانية',
      body: [
        {
          list: [
            'يمكن تجربة كل باقة مجاناً لمدة 14 يوماً، ولا يُخصم أي مبلغ خلال التجربة.',
            'لمواصلة الخدمة بعد التجربة، يضيف المالك أو المسؤول بطاقة في الحساب. وللتحقق من البطاقة، يحجز مزود الدفع ريالاً واحداً ثم يفكّه فوراً، ولا يُخصم أبداً.',
            'تُخصم الدفعة الأولى من هذه البطاقة في يوم انتهاء التجربة. وإذا كنت من أول 10 شركات انضمت بعرض المؤسسين، فالشهر الأول بعد التجربة مجاني أيضاً، وتُخصم الدفعة الأولى عند انتهائه.',
            'إذا لم تُضف بطاقة حتى نهاية التجربة، فلا يُخصم شيء، وتتوقف تالوس عن مراسلة مدينيك وعن التقديم في ناجز حتى تضيفها.',
          ],
        },
      ],
    },
    {
      id: 'paying',
      title: '3. الدفع والتجديد',
      body: [
        {
          list: [
            'تدفع مقدماً عن شهر أو سنة حسب اختيارك، ببطاقة مدى أو فيزا أو ماستركارد. وتشمل الأسعار ضريبة القيمة المضافة حيث تذكر صفحة الأسعار ذلك، وإلا تُضاف الضريبة كما يقتضي النظام.',
            'تذهب بيانات بطاقتك من متصفحك إلى مزود الدفع مباشرة. ولا تستلم تالوس رقم بطاقتك ولا تحفظه، وتحتفظ فقط بنوع البطاقة وآخر أربعة أرقام منها وتاريخ انتهائها.',
            'في نهاية كل مدة، تُخصم المدة التالية من البطاقة نفسها. وفي الباقة السنوية، نرسل إلى المالك بريداً قبل التجديد بسبعة أيام على الأقل.',
            'نرسل إيصالاً بالبريد عن كل دفعة، والفاتورة كما يقتضي النظام.',
            'يمكنك تغيير البطاقة في أي وقت من حسابك، وتُستخدم البطاقة الجديدة من الدفعة التالية.',
          ],
        },
      ],
    },
    {
      id: 'cancel',
      title: '4. الإلغاء',
      body: [
        {
          list: [
            'يمكن للمالك أو المسؤول الإلغاء في أي وقت من الإعدادات ثم الفوترة، أو بمراسلتنا على {email} من بريد المالك.',
            'يسري الإلغاء في نهاية المدة التي دفعت عنها. وحتى ذلك الحين تعمل الخدمة كالمعتاد، ولا يُخصم أي مبلغ آخر.',
            'يمكنك التراجع عن الإلغاء من المكان نفسه قبل نهاية المدة.',
            'عند انتهاء المدة، تتوقف تالوس عن مراسلة مدينيك وعن التقديم في ناجز. وتبقى بياناتك في حسابك حتى تشترك مرة أخرى أو تطلب منا إغلاق الحساب، وإغلاق الحساب يحذف بياناتك كما توضح سياسة الخصوصية.',
          ],
        },
      ],
    },
    {
      id: 'refunds',
      title: '5. الاسترداد',
      body: [
        'لا تُسترد مدة بدأت، ولو ألغيت خلالها أو استخدمت الخدمة أقل مما خططت أو كان عدد مدينيك أقل مما تسمح به باقتك. ونرد المبلغ في هذه الحالات:',
        {
          list: [
            'الخصم بالخطأ: إذا خُصمت منك المدة نفسها مرتين، أو خُصم مبلغ غير صحيح، أو خُصم منك بعد أن ألغيت قبل موعد التجديد، نرد المبلغ المخصوم بالخطأ كاملاً.',
            'باقة سنوية جديدة: إذا ألغيت خلال 14 يوماً من الدفعة الأولى لباقة سنوية، نرد المبلغ السنوي بعد خصم السعر الشهري عن كل شهر بدأ.',
            'توقف طويل من جهتنا: إذا تعذّر استخدام الخدمة أكثر من 3 أيام متتالية بسبب خلل من جهة تالوس، نرد قيمة الأيام التي تعذّر فيها الاستخدام. ولا يشمل ذلك التوقف بسبب واتساب أو ناجز أو نفاذ أو الإنترنت، أو الصيانة المجدولة التي أخبرناك بها.',
            'أي حالة أخرى يوجب فيها النظام الاسترداد.',
          ],
        },
        'لطلب الاسترداد، راسلنا على {email} خلال 30 يوماً من الدفعة، مع اسم شركتك وتاريخ الدفعة.',
      ],
    },
    {
      id: 'how',
      title: '6. كيف يُرد المبلغ',
      body: [
        'نرد عليك خلال 5 أيام عمل. ويُرسل المبلغ المعتمد إلى البطاقة نفسها خلال 14 يوماً من اعتمادنا له، عن طريق مزود الدفع، وقد يحتاج بنكك بضعة أيام أخرى لإظهاره. وتُرد ضريبة القيمة المضافة مع المبلغ، ونصدر إشعاراً دائناً كما يقتضي النظام.',
      ],
    },
    {
      id: 'failed',
      title: '7. عند تعذّر الدفع',
      body: [
        {
          list: [
            'إذا تعذّر الدفع، تتوقف تالوس فوراً عن مراسلة مدينيك وعن التقديم في ناجز، وتُخبر المالك والمسؤولين بالبريد وفي لوحة التحكم.',
            'نحاول الخصم من البطاقة نفسها مرة أخرى بعد يوم وبعد 3 أيام. ويمكنك أيضاً الدفع في أي وقت من حسابك، بالبطاقة نفسها أو ببطاقة جديدة.',
            'يعود كل شيء للعمل بمجرد إتمام الدفع، وتبدأ المدة الجديدة من ذلك اليوم. ولا توجد رسوم تأخير.',
          ],
        },
      ],
    },
    {
      id: 'other',
      title: '8. أموال ليست لنا',
      body: [
        'يدفع مدينوك في حساب شركتك البنكي مباشرة. ولا تستلم تالوس هذه الأموال ولا تحتفظ بها ولا تردها، وأي مبلغ يستحق للمدين هو بين شركتك والمدين. والرسوم التي تفرضها الجهات الحكومية، مثل المحاكم، ليست جزءاً من أسعار تالوس، ولا تستطيع تالوس ردها.',
      ],
    },
    {
      id: 'contact',
      title: '9. التغييرات والتواصل',
      body: [
        'قد نغيّر هذه السياسة كما توضح شروط الاستخدام، ونخبرك قبل 30 يوماً على الأقل من أي تغيير مهم. وإذا اختلف النص العربي عن الإنجليزي، يُعمل بالنص العربي.',
        '{entity}، {address}. البريد: {email}.',
      ],
    },
  ],
};

export const legalCopies: Record<Lang, LegalCopy> = {
  en: {
    draft: 'Draft for legal review. This page is not in force yet.',
    terms: enTerms,
    privacy: enPrivacy,
    refunds: enRefunds,
  },
  ar: {
    draft: 'مسودة للمراجعة القانونية. هذه الصفحة غير سارية بعد.',
    terms: arTerms,
    privacy: arPrivacy,
    refunds: arRefunds,
  },
};
