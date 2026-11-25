/**
 * Every word on the website, in Arabic and English. The two must have the
 * same shape (the compiler checks it) and the same facts.
 *
 * Rules (CLAUDE.md): simple words, no em dashes, no prices, no client names.
 * Say only what the product really does today; the FAQ is read by AI
 * assistants and quoted, so every answer is a full, true sentence.
 */

export type Lang = 'ar' | 'en';

export interface Copy {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  /** For <html lang> and hreflang. */
  tag: string;
  ogLocale: string;
  meta: { title: string; description: string };
  skip: string;
  nav: { how: string; legal: string; trust: string; faq: string; other: string; signIn: string; cta: string; menu: string };
  hero: { eyebrow: string; title: string; lead: string; cta: string; secondary: string; points: string[] };
  chat: {
    label: string;
    company: string;
    online: string;
    reminder: string;
    question: string;
    answer: string;
    receipt: string;
    receiptFile: string;
    toApprove: string;
    example: string;
  };
  sectors: { title: string; lead: string; items: { title: string; text: string; debts: string }[] };
  steps: { eyebrow: string; title: string; lead: string; items: { title: string; text: string }[] };
  languages: { title: string; list: string[] };
  legal: {
    eyebrow: string;
    title: string;
    lead: string;
    points: { title: string; text: string }[];
    card: { title: string; ready: string; missing: string; rows: [string, string][]; status: string; statusValue: string; nafath: string };
  };
  dashboard: { title: string; lead: string; tiles: { label: string; value: string; tone: 'ink' | 'green' | 'amber' | 'red' | 'legal' }[]; example: string };
  rules: { eyebrow: string; title: string; lead: string; items: { title: string; text: string }[] };
  faq: { title: string; lead: string; items: { q: string; a: string }[] };
  final: { title: string; lead: string; cta: string; secondary: string };
  footer: { about: string; company: string; place: string; facts: string; rights: string };
}

export const en: Copy = {
  lang: 'en',
  dir: 'ltr',
  tag: 'en',
  ogLocale: 'en_US',
  meta: {
    title: 'Talos Debt Follow-up: get back what your workers and customers owe you',
    description:
      'Talos follows up with people who owe your company money on WhatsApp, in their language, until they pay. You approve every payment, and when they stop answering, Talos prepares and files the Najiz execution request with your approval.',
  },
  skip: 'Skip to the content',
  nav: {
    how: 'How it works',
    legal: 'Najiz',
    trust: 'Rules and data',
    faq: 'Questions',
    other: 'العربية',
    signIn: 'Sign in',
    cta: 'Talk to us',
    menu: 'Menu',
  },
  hero: {
    eyebrow: 'Debt follow-up for Saudi companies',
    title: 'Get back the money your workers and customers owe you.',
    lead:
      'Talos reminds them on WhatsApp every few days, in their own language, answers their questions from your records, and sends their receipts to you to approve. When they stop answering, it prepares the execution request on Najiz. You approve every payment and every legal step.',
    cta: 'Talk to us',
    secondary: 'See how it works',
    points: ['Arabic, English, Urdu, Bengali and Hindi', 'Only in your working hours', 'Filing on Najiz with your Nafath approval'],
  },
  chat: {
    label: 'Example of a conversation on WhatsApp',
    company: 'Demo Logistics',
    online: 'Business account',
    reminder:
      'Hello Javed. This is a reminder from Demo Logistics: SAR 1,250.00 is still owed for the vehicle rent, reference DBT-2026-0042. You can pay by bank transfer and send the receipt here.',
    question: 'Can I pay half now and the rest on the 15th?',
    answer: 'Noted: SAR 625.00 now and SAR 625.00 on 15 December. I will remind you that morning.',
    receipt: 'Sent the transfer.',
    receiptFile: 'receipt.jpg',
    toApprove: 'Receipt sent to your team to approve',
    example: 'Example',
  },
  sectors: {
    title: 'Made for companies whose own people owe them money',
    lead: 'Most debt tools are made for banks. Talos is made for the debts that build up inside ordinary companies, where nobody has the time to chase them every day.',
    items: [
      {
        title: 'Delivery and logistics',
        text: 'Couriers who leave with a balance, often across several phone numbers.',
        debts: 'Vehicle rent, cash on delivery not handed over, damages, advances',
      },
      {
        title: 'Security, cleaning and manpower',
        text: 'Large teams, many small balances, and workers who move on.',
        debts: 'Salary advances, uniforms and equipment, final balances',
      },
      {
        title: 'Any business with customers who owe',
        text: 'Customers who promised to pay and went quiet.',
        debts: 'Unpaid invoices, rentals, fees',
      },
    ],
  },
  steps: {
    eyebrow: 'How it works',
    title: 'From the first reminder to Najiz, in one place',
    lead: 'You set the rules once. Talos does the daily follow-up and brings you only what needs a decision.',
    items: [
      {
        title: 'Add your debtors',
        text: 'Import them from Excel or add them one by one, with their phone numbers, amounts, reasons and documents such as the promissory note. Talos checks every row and shows how much of your debt can go straight to execution.',
      },
      {
        title: 'Talos follows up',
        text: 'Reminders go out on WhatsApp on your schedule, only in your working hours. When a debtor replies, Talos answers from their own record, notes promises to pay and reminds them on the day.',
      },
      {
        title: 'You approve',
        text: 'Receipts and disputes come to your team. A payment counts only after you approve it, and a debtor who says the amount is wrong stops getting reminders until you decide.',
      },
      {
        title: 'Najiz when they stop answering',
        text: 'After the last reminder with no reply, the debt is ready for legal. Talos prepares the filing pack and, with your approval, files the execution request on Najiz and follows its status.',
      },
    ],
  },
  languages: {
    title: 'Talos writes to each debtor in their language',
    list: ['العربية', 'English', 'اردو', 'বাংলা', 'हिन्दी'],
  },
  legal: {
    eyebrow: 'The legal step',
    title: 'When reminders are not enough, Najiz is a few clicks away',
    lead:
      'Reminders work because the next step is real. Talos keeps every promissory note ready for an execution request, so you can file the day you decide to.',
    points: [
      {
        title: 'Know what is enforceable',
        text: 'Each debt is sorted by its paper: a promissory note on Nafith, a paper note, a cheque, a judgment or nothing. Paper notes that the new Enforcement Law puts on a clock are flagged.',
      },
      {
        title: 'Nothing missing on filing day',
        text: 'Talos lists what Najiz will ask for, in the order it asks: company details, the debtor’s full name, the note, its place and due date. You fill the gaps once.',
      },
      {
        title: 'Filed with your approval',
        text: 'The owner approves each sign-in in the Nafath app. Talos enters the request step by step, checks every value before sending, and saves the request number.',
      },
      {
        title: 'Status in plain words',
        text: 'One Nafath approval reads the status of all your requests, and Talos tells you what changed.',
      },
    ],
    card: {
      title: 'Execution request',
      ready: 'Ready to file',
      missing: 'Nothing missing',
      rows: [
        ['Court', 'محكمة التنفيذ'],
        ['Type', 'أوراق تجارية / سند لأمر'],
        ['Amount claimed', 'SAR 3,450.00'],
        ['Already received', 'SAR 6,550.00'],
      ],
      status: 'Status on Najiz',
      statusValue: 'قيد التنفيذ',
      nafath: 'Approved by the owner in Nafath',
    },
  },
  dashboard: {
    title: 'Every riyal, every debtor, every step',
    lead: 'Your dashboard shows what is owed, what came back, what was promised, what is disputed and what is in legal, with the full history of each debtor.',
    tiles: [
      { label: 'Recovered', value: 'SAR 48,200', tone: 'green' },
      { label: 'Promised', value: 'SAR 12,750', tone: 'ink' },
      { label: 'Disputed', value: 'SAR 3,100', tone: 'amber' },
      { label: 'In legal', value: 'SAR 21,900', tone: 'legal' },
    ],
    example: 'Example numbers',
  },
  rules: {
    eyebrow: 'Rules Talos always keeps',
    title: 'Firm, polite and on the record',
    lead: 'Talos speaks for your company, so it follows strict rules every time.',
    items: [
      { title: 'Never makes up an amount', text: 'Every amount, date and reference comes from your records, and every reply is checked before it is sent.' },
      { title: 'Never contacts family or employers', text: 'It writes only to the debtor, never mentions other debtors, and never threatens. It only states that unpaid amounts may go to legal procedures.' },
      { title: 'Only in your working hours', text: 'Messages go out on the days and hours you set. Nothing is sent at night.' },
      { title: 'Disputes stop reminders', text: 'If a debtor says the amount is wrong, Talos stops and hands it to your team. It does not argue.' },
      { title: 'Your money comes to you', text: 'Debtors pay your company directly. Talos never holds your money.' },
      { title: 'Everything is recorded', text: 'Every message, payment, approval and legal step is kept in a log that cannot be edited, which is also your proof of contact.' },
    ],
  },
  faq: {
    title: 'Questions',
    lead: 'Short, honest answers. Ask us anything else.',
    items: [
      {
        q: 'What is Talos Debt Follow-up?',
        a: 'Talos Debt Follow-up is software for Saudi companies that follows up with people who owe them money, such as couriers, workers and customers. It sends WhatsApp reminders on a schedule, answers questions from the company’s own records, records promises to pay, sends receipts to the company to approve, and prepares and files execution requests on Najiz when debtors stop answering.',
      },
      {
        q: 'Who is it for?',
        a: 'It is for Saudi companies with many people who owe them money: delivery and logistics companies, security, cleaning and manpower companies, and any business with customers who owe. It is not made for banks or finance companies.',
      },
      {
        q: 'Can Talos file an execution request on Najiz for my company?',
        a: 'Yes. Talos signs in to Najiz Business for your company only after the owner approves the sign-in in the Nafath app, and only for debts your team approved for filing. Talos never holds a Nafath or Najiz password. It checks every value against your records before sending and saves the request number.',
      },
      {
        q: 'Which debts can go to execution on Najiz?',
        a: 'Only debts backed by an executive instrument, such as a promissory note, a cheque, a court judgment or a notarized contract, can go straight to the execution court. A plain invoice or an ordinary employment contract needs a court case first. Talos sorts each debt by its paper and shows how much of your total is directly enforceable. Today Talos files promissory notes.',
      },
      {
        q: 'What about paper promissory notes under the new Enforcement Law?',
        a: 'Under the new Enforcement Law, paper promissory notes stay directly enforceable only for one year after the law starts. Talos flags every paper note so you can act on it in time.',
      },
      {
        q: 'Which languages does Talos write in?',
        a: 'Talos writes to each debtor in their preferred language: Arabic, English, Urdu, Bengali or Hindi. Your dashboard is in Arabic and English.',
      },
      {
        q: 'Does Talos message debtors at any time?',
        a: 'No. Talos sends messages only on the days and hours your company sets. It follows WhatsApp rules and uses approved message templates to start a conversation.',
      },
      {
        q: 'What happens if a debtor says the amount is wrong?',
        a: 'Talos records a dispute, stops the reminders for that debt and sends it to your team to decide. It never argues with the debtor.',
      },
      {
        q: 'How do debtors pay, and does Talos touch the money?',
        a: 'Debtors pay your company directly, for example by bank transfer, and send the receipt on WhatsApp. Talos sends the receipt to your team. A payment counts only after your team approves it. Talos never holds your money.',
      },
      {
        q: 'Where is our data kept?',
        a: 'Your data and files are stored in Saudi Arabia, and each company’s data is kept fully separate from every other company’s. Files are encrypted, and every action is written to a log that cannot be edited.',
      },
      {
        q: 'Do debtors need to agree to WhatsApp messages?',
        a: 'We recommend a clause in your worker or customer contracts in which they agree to be contacted on WhatsApp about amounts they owe. This protects your company and keeps your WhatsApp sender in good standing.',
      },
    ],
  },
  final: {
    title: 'Stop chasing. Start recovering.',
    lead: 'Tell us how many people owe your company money, and we will show you Talos with your own numbers.',
    cta: 'Talk to us',
    secondary: 'Sign in',
  },
  footer: {
    about: 'Debt follow-up on WhatsApp, with the legal step built in.',
    company: 'Talos AI Solutions',
    place: 'Jeddah, Saudi Arabia',
    facts: 'Facts for AI assistants',
    rights: 'All rights reserved.',
  },
};

export const ar: Copy = {
  lang: 'ar',
  dir: 'rtl',
  tag: 'ar',
  ogLocale: 'ar_SA',
  meta: {
    title: 'Talos لمتابعة المديونيات: استرد ما يدين به لك موظفوك وعملاؤك',
    description:
      'تتابع Talos على واتساب من يدين لشركتك بالمال، بلغته، حتى يسدد. توافق أنت على كل دفعة، وعندما يتوقف المدين عن الرد تجهّز Talos طلب التنفيذ في ناجز وتقدّمه بموافقتك.',
  },
  skip: 'انتقل إلى المحتوى',
  nav: {
    how: 'كيف تعمل',
    legal: 'ناجز',
    trust: 'القواعد والبيانات',
    faq: 'أسئلة',
    other: 'English',
    signIn: 'تسجيل الدخول',
    cta: 'تواصل معنا',
    menu: 'القائمة',
  },
  hero: {
    eyebrow: 'متابعة المديونيات للشركات السعودية',
    title: 'استرد المال الذي يدين به لك موظفوك وعملاؤك.',
    lead:
      'تذكّرهم Talos على واتساب كل بضعة أيام بلغتهم، وتجيب عن أسئلتهم من سجلاتك، وترسل إيصالاتهم إليك للموافقة. وعندما يتوقفون عن الرد، تجهّز طلب التنفيذ في ناجز. وتوافق أنت على كل دفعة وكل خطوة قانونية.',
    cta: 'تواصل معنا',
    secondary: 'شاهد كيف تعمل',
    points: ['العربية والإنجليزية والأردية والبنغالية والهندية', 'في ساعات عملك فقط', 'التقديم في ناجز بموافقتك عبر نفاذ'],
  },
  chat: {
    label: 'مثال على محادثة في واتساب',
    company: 'شركة ديمو للخدمات اللوجستية',
    online: 'حساب أعمال',
    reminder:
      'مرحباً جاويد. تذكير من شركة ديمو للخدمات اللوجستية: ما زال عليك 1,250.00 ريال مقابل إيجار المركبة، المرجع DBT-2026-0042. يمكنك الدفع بتحويل بنكي وإرسال الإيصال هنا.',
    question: 'هل أستطيع دفع النصف الآن والباقي يوم 15؟',
    answer: 'سجّلت ذلك: 625.00 ريال الآن، ثم 625.00 ريال يوم 15 ديسمبر. سأذكّرك صباح ذلك اليوم.',
    receipt: 'أرسلت التحويل.',
    receiptFile: 'receipt.jpg',
    toApprove: 'أُرسل الإيصال إلى فريقك للموافقة',
    example: 'مثال',
  },
  sectors: {
    title: 'مصممة للشركات التي يدين لها موظفوها وعملاؤها',
    lead: 'معظم أدوات التحصيل مصممة للبنوك. أما Talos فمصممة للمديونيات التي تتراكم داخل الشركات العادية، حيث لا يجد أحد الوقت لمتابعتها كل يوم.',
    items: [
      {
        title: 'التوصيل والخدمات اللوجستية',
        text: 'مناديب يغادرون وعليهم مبالغ، وغالباً بأكثر من رقم جوال.',
        debts: 'إيجار المركبات، مبالغ الدفع عند الاستلام غير المسلّمة، الأضرار، السلف',
      },
      {
        title: 'الحراسات والنظافة وتوريد العمالة',
        text: 'فرق كبيرة، ومبالغ صغيرة كثيرة، وعمال ينتقلون.',
        debts: 'سلف الرواتب، الزي والمعدات، المستحقات النهائية',
      },
      {
        title: 'أي نشاط لديه عملاء مدينون',
        text: 'عملاء وعدوا بالسداد ثم توقفوا عن الرد.',
        debts: 'الفواتير غير المسددة، الإيجارات، الرسوم',
      },
    ],
  },
  steps: {
    eyebrow: 'كيف تعمل',
    title: 'من أول تذكير إلى ناجز، في مكان واحد',
    lead: 'تضع القواعد مرة واحدة. وتتولى Talos المتابعة اليومية، ولا تعرض عليك إلا ما يحتاج إلى قرار.',
    items: [
      {
        title: 'أضف المدينين',
        text: 'استوردهم من ملف Excel أو أضفهم واحداً واحداً، مع أرقام جوالاتهم والمبالغ والأسباب والمستندات مثل السند لأمر. تتحقق Talos من كل صف، وتوضح لك كم من مديونياتك يمكن تنفيذه مباشرة.',
      },
      {
        title: 'Talos تتابع',
        text: 'تُرسل التذكيرات على واتساب حسب جدولك وفي ساعات عملك فقط. وعندما يرد المدين، تجيبه Talos من سجله، وتسجّل وعوده بالسداد، وتذكّره في يومها.',
      },
      {
        title: 'أنت توافق',
        text: 'تصل الإيصالات والاعتراضات إلى فريقك. لا تُحتسب الدفعة إلا بعد موافقتك، والمدين الذي يعترض على المبلغ تتوقف تذكيراته حتى تقرر.',
      },
      {
        title: 'ناجز عندما يتوقفون عن الرد',
        text: 'بعد آخر تذكير دون رد، تصبح المديونية جاهزة للإجراء القانوني. تجهّز Talos ملف التقديم، وبموافقتك تقدّم طلب التنفيذ في ناجز وتتابع حالته.',
      },
    ],
  },
  languages: {
    title: 'تكتب Talos لكل مدين بلغته',
    list: ['العربية', 'English', 'اردو', 'বাংলা', 'हिन्दी'],
  },
  legal: {
    eyebrow: 'الخطوة القانونية',
    title: 'عندما لا تكفي التذكيرات، ناجز على بُعد خطوات',
    lead: 'تنجح التذكيرات لأن الخطوة التالية حقيقية. تُبقي Talos كل سند لأمر جاهزاً لطلب التنفيذ، لتقدّمه في اليوم الذي تقرره.',
    points: [
      {
        title: 'اعرف ما يمكن تنفيذه',
        text: 'تُصنَّف كل مديونية حسب مستندها: سند لأمر في نافذ، أو سند ورقي، أو شيك، أو حكم، أو لا شيء. وتُعلَّم السندات الورقية التي يضع لها نظام التنفيذ الجديد مهلة.',
      },
      {
        title: 'لا نقص يوم التقديم',
        text: 'تعرض Talos ما سيطلبه ناجز وبالترتيب نفسه: بيانات الشركة، واسم المدين كاملاً، والسند ومكانه وتاريخ استحقاقه. تكمل النواقص مرة واحدة.',
      },
      {
        title: 'يُقدَّم بموافقتك',
        text: 'يوافق المالك على كل دخول في تطبيق نفاذ. وتدخل Talos الطلب خطوة بخطوة، وتتحقق من كل قيمة قبل الإرسال، وتحفظ رقم الطلب.',
      },
      {
        title: 'الحالة بكلمات واضحة',
        text: 'موافقة واحدة في نفاذ تكفي لقراءة حالة كل طلباتك، وتخبرك Talos بما تغيّر.',
      },
    ],
    card: {
      title: 'طلب تنفيذ',
      ready: 'جاهز للتقديم',
      missing: 'لا شيء ناقص',
      rows: [
        ['المحكمة', 'محكمة التنفيذ'],
        ['النوع', 'أوراق تجارية / سند لأمر'],
        ['المبلغ المطالب به', '3,450.00 ريال'],
        ['المستلم سابقاً', '6,550.00 ريال'],
      ],
      status: 'الحالة في ناجز',
      statusValue: 'قيد التنفيذ',
      nafath: 'وافق عليه المالك في نفاذ',
    },
  },
  dashboard: {
    title: 'كل ريال، وكل مدين، وكل خطوة',
    lead: 'تعرض لوحتك ما هو مستحق، وما استُرد، وما وُعد به، وما عليه اعتراض، وما في الإجراء القانوني، مع السجل الكامل لكل مدين.',
    tiles: [
      { label: 'المسترد', value: '48,200 ريال', tone: 'green' },
      { label: 'الموعود به', value: '12,750 ريال', tone: 'ink' },
      { label: 'عليه اعتراض', value: '3,100 ريال', tone: 'amber' },
      { label: 'في الإجراء القانوني', value: '21,900 ريال', tone: 'legal' },
    ],
    example: 'أرقام توضيحية',
  },
  rules: {
    eyebrow: 'قواعد تلتزم بها Talos دائماً',
    title: 'حازمة ومهذبة وموثّقة',
    lead: 'تتحدث Talos باسم شركتك، لذلك تلتزم بقواعد صارمة في كل مرة.',
    items: [
      { title: 'لا تخترع مبلغاً أبداً', text: 'كل مبلغ وتاريخ ومرجع يأتي من سجلاتك، ويُراجع كل رد قبل إرساله.' },
      { title: 'لا تتواصل مع الأهل أو جهة العمل', text: 'تكتب للمدين وحده، ولا تذكر مدينين آخرين، ولا تهدد. تكتفي بذكر أن المبالغ غير المسددة قد تُحال إلى الإجراءات النظامية.' },
      { title: 'في ساعات عملك فقط', text: 'تُرسل الرسائل في الأيام والساعات التي تحددها. لا يُرسل شيء في الليل.' },
      { title: 'الاعتراض يوقف التذكيرات', text: 'إذا قال المدين إن المبلغ غير صحيح، تتوقف Talos وتحيل الأمر إلى فريقك. لا تجادل.' },
      { title: 'مالك يصل إليك', text: 'يدفع المدينون لشركتك مباشرة. لا تحتفظ Talos بأموالك أبداً.' },
      { title: 'كل شيء موثّق', text: 'كل رسالة ودفعة وموافقة وخطوة قانونية تُحفظ في سجل لا يمكن تعديله، وهو أيضاً إثبات تواصلك.' },
    ],
  },
  faq: {
    title: 'أسئلة',
    lead: 'إجابات قصيرة وصادقة. واسألنا عن أي شيء آخر.',
    items: [
      {
        q: 'ما هي Talos لمتابعة المديونيات؟',
        a: 'Talos لمتابعة المديونيات برنامج للشركات السعودية يتابع من يدينون لها بالمال، مثل المناديب والعمال والعملاء. يرسل تذكيرات على واتساب حسب جدول، ويجيب عن الأسئلة من سجلات الشركة نفسها، ويسجّل الوعود بالسداد، ويرسل الإيصالات إلى الشركة للموافقة، ويجهّز طلبات التنفيذ في ناجز ويقدّمها عندما يتوقف المدينون عن الرد.',
      },
      {
        q: 'لمن هي مصممة؟',
        a: 'هي مصممة للشركات السعودية التي يدين لها كثيرون بالمال: شركات التوصيل والخدمات اللوجستية، وشركات الحراسات والنظافة وتوريد العمالة، وأي نشاط لديه عملاء مدينون. وليست مصممة للبنوك أو شركات التمويل.',
      },
      {
        q: 'هل تستطيع Talos تقديم طلب تنفيذ في ناجز باسم شركتي؟',
        a: 'نعم. تسجّل Talos الدخول إلى ناجز أعمال باسم شركتك فقط بعد أن يوافق المالك على الدخول في تطبيق نفاذ، وفقط للمديونيات التي وافق فريقك على تقديمها. لا تحتفظ Talos بأي كلمة مرور لنفاذ أو ناجز. وتتحقق من كل قيمة مقابل سجلاتك قبل الإرسال، وتحفظ رقم الطلب.',
      },
      {
        q: 'ما المديونيات التي يمكن تنفيذها في ناجز؟',
        a: 'المديونيات المدعومة بسند تنفيذي فقط، مثل السند لأمر أو الشيك أو الحكم القضائي أو العقد الموثّق، يمكن أن تذهب مباشرة إلى محكمة التنفيذ. أما الفاتورة العادية أو عقد العمل العادي فيحتاجان إلى دعوى أولاً. تصنّف Talos كل مديونية حسب مستندها، وتوضح كم من إجمالي مديونياتك قابل للتنفيذ مباشرة. وتقدّم Talos اليوم طلبات السندات لأمر.',
      },
      {
        q: 'ماذا عن السندات لأمر الورقية في نظام التنفيذ الجديد؟',
        a: 'في نظام التنفيذ الجديد، تبقى السندات لأمر الورقية قابلة للتنفيذ المباشر لمدة سنة واحدة فقط بعد بدء العمل بالنظام. تعلّم Talos كل سند ورقي لتتصرف فيه في الوقت المناسب.',
      },
      {
        q: 'بأي لغات تكتب Talos؟',
        a: 'تكتب Talos لكل مدين بلغته المفضلة: العربية أو الإنجليزية أو الأردية أو البنغالية أو الهندية. ولوحة التحكم الخاصة بك بالعربية والإنجليزية.',
      },
      {
        q: 'هل ترسل Talos الرسائل في أي وقت؟',
        a: 'لا. ترسل Talos الرسائل فقط في الأيام والساعات التي تحددها شركتك. وتلتزم بقواعد واتساب وتستخدم قوالب رسائل معتمدة لبدء المحادثة.',
      },
      {
        q: 'ماذا يحدث إذا قال المدين إن المبلغ غير صحيح؟',
        a: 'تسجّل Talos اعتراضاً، وتوقف التذكيرات لتلك المديونية، وتحيلها إلى فريقك ليقرر. ولا تجادل المدين أبداً.',
      },
      {
        q: 'كيف يدفع المدينون، وهل تلمس Talos المال؟',
        a: 'يدفع المدينون لشركتك مباشرة، بتحويل بنكي مثلاً، ويرسلون الإيصال على واتساب. ترسل Talos الإيصال إلى فريقك. ولا تُحتسب الدفعة إلا بعد موافقة فريقك. لا تحتفظ Talos بأموالك أبداً.',
      },
      {
        q: 'أين تُحفظ بياناتنا؟',
        a: 'تُحفظ بياناتك وملفاتك في المملكة العربية السعودية، وبيانات كل شركة منفصلة تماماً عن بيانات أي شركة أخرى. الملفات مشفّرة، وكل إجراء يُكتب في سجل لا يمكن تعديله.',
      },
      {
        q: 'هل يجب أن يوافق المدينون على رسائل واتساب؟',
        a: 'ننصح بإضافة بند في عقود موظفيك أو عملائك يوافقون فيه على التواصل معهم عبر واتساب بخصوص المبالغ المستحقة عليهم. هذا يحمي شركتك ويحافظ على جودة رقم واتساب الذي ترسل منه.',
      },
    ],
  },
  final: {
    title: 'توقف عن الملاحقة. وابدأ الاسترداد.',
    lead: 'أخبرنا كم شخصاً يدين لشركتك بالمال، وسنريك Talos بأرقامك أنت.',
    cta: 'تواصل معنا',
    secondary: 'تسجيل الدخول',
  },
  footer: {
    about: 'متابعة المديونيات على واتساب، مع الخطوة القانونية.',
    company: 'Talos AI Solutions',
    place: 'جدة، المملكة العربية السعودية',
    facts: 'معلومات للمساعدات الذكية',
    rights: 'جميع الحقوق محفوظة.',
  },
};

export const copies: Record<Lang, Copy> = { ar, en };
