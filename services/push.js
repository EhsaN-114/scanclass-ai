// Real phone notifications (Web Push): they appear in the phone's notification panel
// even when the app and browser are closed, like WhatsApp messages.
//
// - The server's push keys (VAPID) are created automatically once and saved in the database.
// - Each phone that turns on notifications saves a "subscription" for its section.
// - New notices are pushed instantly; a small scheduler sends today/tomorrow plans and
//   10-minutes-before-class reminders (Bangladesh time).

const webpush = require('web-push');
const store = require('./store');
const rooms = require('./rooms');

const TZ = 'Asia/Dhaka';
const MORNING = '07:00'; // "Today" plan, sent from 7 AM (until noon if the server was asleep)
const EVENING = '21:00'; // "Tomorrow" plan, sent from 9 PM
let publicKey = '';

function init() {
  const db = store.get();
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    db.vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else if (!db.vapid || !db.vapid.publicKey) {
    db.vapid = webpush.generateVAPIDKeys();
    store.save();
  }
  if (!Array.isArray(db.pushSubs)) db.pushSubs = [];
  if (!db.pushLog || typeof db.pushLog !== 'object') db.pushLog = {};
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:scanclass@example.com', db.vapid.publicKey, db.vapid.privateKey);
  publicKey = db.vapid.publicKey;
  setInterval(tick, 60 * 1000).unref();
  setTimeout(tick, 5000).unref();
}

const getPublicKey = () => publicKey;

function validSubscription(s) {
  return s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

function subscribe(subscription, section, lang, teacher = null) {
  const db = store.get();
  db.pushSubs = db.pushSubs.filter((x) => x.endpoint !== subscription.endpoint);
  db.pushSubs.push({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys.p256dh.slice(0, 200), auth: subscription.keys.auth.slice(0, 100) },
    section, teacher, lang: lang === 'bn' ? 'bn' : 'en', createdAt: new Date().toISOString(),
  });
  store.save();
}

function unsubscribe(endpoint) {
  const db = store.get();
  const before = db.pushSubs.length;
  db.pushSubs = db.pushSubs.filter((x) => x.endpoint !== endpoint);
  if (db.pushSubs.length !== before) store.save();
}

// Send one notification to every phone of a section. `make(lang)` returns { title, body, url, tag }.
async function sendToSection(sectionKey, make) {
  return sendTo((x) => x.section === sectionKey, make);
}
// Teachers subscribe with their courses + sections; send only to those who teach one of these classes.
// build(lang, theirClasses) returns { title, body }.
async function sendToTeachersOf(classes, build) {
  const db = store.get();
  const subs = db.pushSubs.filter((s) => s.teacher && classes.some((c) => rooms.isTeachersClass(c, s.teacher)));
  await Promise.all(subs.map((s) => {
    const mine = classes.filter((c) => rooms.isTeachersClass(c, s.teacher));
    const msg = build(s.lang, mine);
    return sendTo((x) => x.endpoint === s.endpoint, () => ({ ...msg, url: '/#home', tag: `t-${Date.now()}` }));
  }));
}
async function sendTo(match, make) {
  const db = store.get();
  const subs = db.pushSubs.filter(match);
  let removed = false;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(make(s.lang)), { TTL: 6 * 60 * 60 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { // phone unsubscribed or app removed
        db.pushSubs = db.pushSubs.filter((x) => x.endpoint !== s.endpoint);
        removed = true;
      } else {
        console.error('Push failed:', e.statusCode || e.message);
      }
    }
  }));
  if (removed) store.save();
  return subs.length;
}

// Push a CR notice
function notice(a) {
  const key = store.sectionKey(a);
  return sendToSection(key, (lang) => ({
    title: `📢 ${a.title}`,
    body: lang === 'bn' && a.body_bn ? a.body_bn : a.body_en,
    url: '/#notices',
    tag: a.id,
  })).catch((e) => console.error('Notice push failed:', e.message));
}

// ---------- scheduled reminders ----------
const BN = '০১২৩৪৫৬৭৮৯';
const bnNum = (s) => String(s).replace(/\d/g, (d) => BN[d]);
const DAY_EN = { Sat: 'Saturday', Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };
const DAY_BN = { Sat: 'শনিবার', Sun: 'রবিবার', Mon: 'সোমবার', Tue: 'মঙ্গলবার', Wed: 'বুধবার', Thu: 'বৃহস্পতিবার', Fri: 'শুক্রবার' };
function t12(t, lang) {
  const [h, m] = t.split(':').map(Number);
  const s = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return lang === 'bn' ? bnNum(s.replace('AM', 'এএম').replace('PM', 'পিএম')) : s;
}

function dhakaNow(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
  return { day: p.weekday, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function plan(sectionKey, day, date, teacher) {
  const db = store.get();
  if (teacher) return { classes: rooms.teacherClasses(teacher, day, date), extras: [] };
  const classes = rooms.classesOn(day, date)
    .filter((c) => store.sectionKey(c) === sectionKey)
    .sort((a, b) => rooms.toMin(a.start) - rooms.toMin(b.start));
  const exams = db.syllabi.filter((s) => store.sectionKey(s) === sectionKey && s.examDate === date)
    .map((s) => ({ en: `${s.course} ${s.exam === 'final' ? 'final' : 'mid-term'} exam`, bn: `${s.course} ${s.exam === 'final' ? 'ফাইনাল' : 'মিড-টার্ম'} পরীক্ষা` }));
  const events = db.announcements.filter((a) => store.sectionKey(a) === sectionKey && a.event && a.event.date === date && !a.auto)
    .map((a) => ({ en: a.title, bn: a.title }));
  return { classes, extras: [...exams, ...events].slice(0, 3) };
}

function planMessage(p, lang, when, day) {
  const bn = lang === 'bn';
  const n = p.classes.length;
  const head = bn
    ? `${when === 'today' ? '📚 আজ' : `📅 আগামীকাল (${DAY_BN[day]})`}: ${n ? `${bnNum(n)}টি ক্লাস` : 'কোনো ক্লাস নেই'}`
    : `${when === 'today' ? '📚 Today' : `📅 Tomorrow (${DAY_EN[day]})`}: ${n ? `${n} class${n > 1 ? 'es' : ''}` : 'no classes'}`;
  const parts = [];
  if (n) {
    const f = p.classes[0];
    parts.push(bn ? `প্রথম ক্লাস ${f.course}, ${t12(f.start, lang)}, রুম ${f.room}।` : `First: ${f.course} at ${t12(f.start, lang)} in ${f.room}.`);
    const rest = p.classes.slice(1, 4).map((c) => `${c.course} ${t12(c.start, lang)} (${c.room})`);
    if (rest.length) parts.push(bn ? `এরপর: ${rest.join(', ')}।` : `Then ${rest.join(', ')}.`);
  }
  for (const e of p.extras) parts.push(`📝 ${bn ? e.bn : e.en}`);
  return { title: head, body: parts.join(' ') || (bn ? 'উপভোগ করো! 🎉' : 'Enjoy your free day! 🎉'), url: '/#home' };
}

function once(key) {
  const db = store.get();
  if (db.pushLog[key]) return false;
  db.pushLog[key] = Date.now();
  return true;
}

async function tick() {
  let db;
  try { db = store.get(); } catch (_) { return; }
  if (!db.pushSubs.length) return;
  const now = dhakaNow();
  const tomorrow = dhakaNow(1);
  const nowMin = rooms.toMin(now.time);
  let changed = false;
  // Each target is a student section or a teacher
  const targets = [
    ...[...new Set(db.pushSubs.filter((s) => s.section).map((s) => s.section))].map((key) => ({ id: key, key, send: (m) => sendToSection(key, m) })),
    ...[...new Map(db.pushSubs.filter((s) => s.teacher).map((s) => [rooms.teacherId(s.teacher), s.teacher])).entries()]
      .map(([id, t]) => ({ id, teacher: t, send: (m) => sendTo((x) => x.teacher && rooms.teacherId(x.teacher) === id, m) })),
  ];

  for (const target of targets) {
    const key = target.id;
    const P = (day, date) => plan(target.key, day, date, target.teacher);
    // Morning: today's plan (only if there is something today)
    if (now.time >= MORNING && now.time < '12:00') {
      const p = P(now.day, now.date);
      if ((p.classes.length || p.extras.length) && once(`m|${key}|${now.date}`)) {
        changed = true;
        target.send((lang) => ({ ...planMessage(p, lang, 'today', now.day), tag: `today-${now.date}` }));
      }
    }
    // Evening: tomorrow's plan
    if (now.time >= EVENING) {
      const p = P(tomorrow.day, tomorrow.date);
      if ((p.classes.length || p.extras.length) && once(`e|${key}|${now.date}`)) {
        changed = true;
        target.send((lang) => ({ ...planMessage(p, lang, 'tomorrow', tomorrow.day), tag: `tomorrow-${tomorrow.date}` }));
      }
    }
    // 10 minutes before each class
    for (const c of P(now.day, now.date).classes) {
      const start = rooms.toMin(c.start);
      if (nowMin >= start - 10 && nowMin < start && once(`c|${key}|${now.date}|${c.id}`)) {
        changed = true;
        const mins = start - nowMin;
        target.send((lang) => (lang === 'bn'
          ? { title: `⏰ ${c.course} ${bnNum(mins)} মিনিট পরে`, body: `রুম ${c.room} · ${t12(c.start, lang)}${target.teacher ? ` · ${c.section}` : ''}`, url: '/#home', tag: `class-${c.id}` }
          : { title: `⏰ ${c.course} in ${mins} min`, body: `Room ${c.room} · ${t12(c.start, lang)}${target.teacher ? ` · ${c.section}` : ''}`, url: '/#home', tag: `class-${c.id}` }));
      }
    }
  }

  // forget log entries older than 3 days
  const cutoff = Date.now() - 3 * 86400000;
  for (const [k, v] of Object.entries(db.pushLog)) if (v < cutoff) { delete db.pushLog[k]; changed = true; }
  if (changed) store.save();
}

module.exports = { init, getPublicKey, validSubscription, subscribe, unsubscribe, notice, sendToSection, sendToTeachersOf, _test: { plan, planMessage } };
