// English / Hindi for the screens volunteers and runners use. The choice is remembered on the phone.
const STRINGS = {
  en: {
    youAreAt: 'You are at',
    zone: 'Zone: {zone}',
    runner: 'Runner',
    jarSwapped: 'Jar swapped',
    jarSwappedHint: 'Tap each time you put a new jar on',
    lastJar: 'Last jar',
    lastJarHint: 'Tap when the jar on the tap is your last full one',
    cupsLow: 'Cups low',
    stocked: 'Stocked',
    beforeGates: 'Before the gates open',
    countHint: 'Count the full jars at your station, including the one on the tap, and the cups.',
    countHintPlan: 'Count the full jars at your station, including the one on the tap, and the cups. The plan expects about {jars} jars for the whole event.',
    fullJars: 'Full jars',
    cups: 'Cups',
    confirmStock: 'Confirm stock',
    yourTaps: 'Your taps',
    noneYet: 'None yet.',
    recountHint: 'Count again if jars or cups were added or taken away without a runner.',
    countAgain: 'Count again',
    stockedAt: 'Stocked at {time}: {jars} jars, {cups} cups',
    stockedTap: 'Stocked ({jars} jars, {cups} cups)',
    saved: 'Saved:',
    savedStock: '{jars} jars and {cups} cups at {time}',
    savedTap: '{label} at {time}',
    alreadyCounted: 'Already counted that tap.',
    noSignal: 'No signal right now. Keep tapping: taps are saved on this phone and sent later.',
    allSent: 'All taps sent.',
    waiting: '{n} tap saved on this phone, waiting to send.',
    waitingMany: '{n} taps saved on this phone, waiting to send.',
    failed: '{n} tap could not be saved. Tell the organiser.',
    failedMany: '{n} taps could not be saved. Tell the organiser.',
    st_pending: 'waiting to send',
    st_sent: 'sent',
    st_failed: 'not saved',
    noJob: 'No job right now',
    noJobHint: 'Stay near the store. When a station needs jars, the job appears here. This page checks every few seconds.',
    newJob: 'New job',
    onYourWay: 'On your way',
    take: 'Take {n} jar',
    takeMany: 'Take {n} jars',
    andCups: ' and {n} cups',
    to: 'to {station} ({zone})',
    whyLastJar: 'The volunteer there is on the last jar.',
    whyDry: 'It is expected to run dry about {time}.',
    onMyWay: 'On my way',
    onMyWayHint: 'Tap when you pick up the jars',
    delivered: 'Delivered',
    jarsDelivered: 'Jars delivered',
    cupsDelivered: 'Cups delivered',
    thanksOnWay: 'Thanks. The organiser can see you are on your way.',
    thanksDelivered: 'Delivered {jars} jars. Thank you!',
    lastJobLine: 'Last job: {station}, {state} at {time}',
    switchTo: 'हिंदी',
  },
  hi: {
    youAreAt: 'आप यहाँ हैं',
    zone: 'ज़ोन: {zone}',
    runner: 'रनर',
    jarSwapped: 'जार बदला',
    jarSwappedHint: 'हर बार नया जार लगाने पर दबाएँ',
    lastJar: 'आख़िरी जार',
    lastJarHint: 'जब नल पर लगा जार आपका आख़िरी भरा जार हो, तब दबाएँ',
    cupsLow: 'कप कम हैं',
    stocked: 'गिनती',
    beforeGates: 'गेट खुलने से पहले',
    countHint: 'अपने स्टेशन पर भरे जार (नल पर लगे जार समेत) और कप गिनें।',
    countHintPlan: 'अपने स्टेशन पर भरे जार (नल पर लगे जार समेत) और कप गिनें। योजना के हिसाब से पूरे कार्यक्रम में लगभग {jars} जार लगेंगे।',
    fullJars: 'भरे जार',
    cups: 'कप',
    confirmStock: 'गिनती पक्की करें',
    yourTaps: 'आपके टैप',
    noneYet: 'अभी कोई नहीं।',
    recountHint: 'अगर बिना रनर के जार या कप जोड़े या हटाए गए हों, तो फिर से गिनें।',
    countAgain: 'फिर से गिनें',
    stockedAt: '{time} पर गिनती: {jars} जार, {cups} कप',
    stockedTap: 'गिनती ({jars} जार, {cups} कप)',
    saved: 'सेव हुआ:',
    savedStock: '{time} पर {jars} जार और {cups} कप',
    savedTap: '{label}, {time}',
    alreadyCounted: 'यह टैप पहले ही गिना जा चुका है।',
    noSignal: 'अभी नेटवर्क नहीं है। टैप करते रहें: टैप इस फ़ोन में सेव होंगे और बाद में भेजे जाएँगे।',
    allSent: 'सभी टैप भेज दिए गए।',
    waiting: '{n} टैप इस फ़ोन में सेव है, भेजना बाकी है।',
    waitingMany: '{n} टैप इस फ़ोन में सेव हैं, भेजना बाकी है।',
    failed: '{n} टैप सेव नहीं हो पाया। आयोजक को बताएँ।',
    failedMany: '{n} टैप सेव नहीं हो पाए। आयोजक को बताएँ।',
    st_pending: 'भेजना बाकी',
    st_sent: 'भेजा गया',
    st_failed: 'सेव नहीं हुआ',
    noJob: 'अभी कोई काम नहीं',
    noJobHint: 'स्टोर के पास रहें। जब किसी स्टेशन को जार चाहिए होंगे, काम यहाँ दिखेगा। यह पेज हर कुछ सेकंड में जाँचता है।',
    newJob: 'नया काम',
    onYourWay: 'आप रास्ते में हैं',
    take: '{n} जार ले जाएँ',
    takeMany: '{n} जार ले जाएँ',
    andCups: ' और {n} कप',
    to: '{station} ({zone}) तक',
    whyLastJar: 'वहाँ आख़िरी जार चल रहा है।',
    whyDry: 'लगभग {time} तक पानी ख़त्म होने का अनुमान है।',
    onMyWay: 'रास्ते में हूँ',
    onMyWayHint: 'जार उठाते ही दबाएँ',
    delivered: 'पहुँचा दिए',
    jarsDelivered: 'पहुँचाए गए जार',
    cupsDelivered: 'पहुँचाए गए कप',
    thanksOnWay: 'धन्यवाद। आयोजक देख सकते हैं कि आप रास्ते में हैं।',
    thanksDelivered: '{jars} जार पहुँचा दिए। धन्यवाद!',
    lastJobLine: 'पिछला काम: {station}, {time} पर ({state})',
    switchTo: 'English',
  },
};

const KEY = 'qs-lang';
// Saved choice first; otherwise Hindi if the phone is set to Hindi; otherwise English.
let saved = null;
try { saved = localStorage.getItem(KEY); } catch {}
let lang = saved || ((navigator.language || '').startsWith('hi') ? 'hi' : 'en');
if (!STRINGS[lang]) lang = 'en';

export const currentLang = () => lang;

// t('waiting', { n: 3 }) -> "3 taps saved on this phone, waiting to send." (picks the plural key when n !== 1)
export function t(key, vars = {}) {
  const table = STRINGS[lang];
  const k = vars.n !== undefined && vars.n !== 1 && table[`${key}Many`] ? `${key}Many` : key;
  const text = table[k] ?? STRINGS.en[k] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, v) => (vars[v] ?? `{${v}}`));
}

// Fills every element with data-i18n="key" (text) in the page.
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

// A small button that switches language and re-renders.
export function languageButton(el, onChange) {
  el.textContent = t('switchTo');
  el.addEventListener('click', () => {
    lang = lang === 'en' ? 'hi' : 'en';
    try { localStorage.setItem(KEY, lang); } catch {}
    el.textContent = t('switchTo');
    applyStatic();
    onChange?.();
  });
}
