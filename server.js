require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const store = require('./services/store');
const rooms = require('./services/rooms');
const gemma = require('./services/gemma');
const { diffRoutine, describe } = require('./services/compare');
const { answer } = require('./services/answer');
const { normRoom, normBuilding, roomParts } = require('./services/format');
const push = require('./services/push');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '300kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
// pdf.js (renders PDF pages to images in the browser, so Gemma can read them)
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist', 'build'), {
  setHeaders: (res, file) => { if (file.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); },
}));

// ---------- helpers ----------
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const upload = multer({
  storage: multer.memoryStorage(), // images are never written to disk
  limits: { fileSize: 8 * 1024 * 1024, files: 4, fields: 6 },
  fileFilter: (req, file, cb) => (ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new Error('BAD_TYPE'))),
});
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG';
  const webp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return jpg || png || webp;
}
// Accepts up to 4 images (a photo, or the pages of a PDF rendered in the browser)
function withImage(required) {
  return (req, res, next) => upload.array('image', 4)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image is too large. Maximum size is 8 MB.' });
      if (err.message === 'BAD_TYPE') return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP image, or a PDF.' });
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Up to 4 pages at a time.' });
      return res.status(400).json({ error: 'Upload failed. Please try again.' });
    }
    req.images = (req.files || []).map((f) => f.buffer);
    if (required && !req.images.length) return res.status(400).json({ error: 'No image was uploaded.' });
    if (req.images.some((b) => !looksLikeImage(b))) return res.status(400).json({ error: 'This file is not a valid image.' });
    res.on('finish', () => { req.images = null; req.files = null; }); // drop images from memory
    next();
  });
}

const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.route ? req.route.path : req.path}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Friendly dates/times for notices: "Saturday, 24 October" / "শনিবার, ২৪ অক্টোবর", "10:00 AM"
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bnNum = (s) => String(s).replace(/\d/g, (d) => BN_DIGITS[d]);
const BN_MONTH = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const BN_WEEK = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
function niceDate(iso, bn) {
  const d = new Date(iso + 'T12:00:00');
  if (bn) return `${BN_WEEK[d.getDay()]}, ${bnNum(d.getDate())} ${BN_MONTH[d.getMonth()]}`;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
function niceTime(t, bn) {
  const [h, m] = t.split(':').map(Number);
  const s = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return bn ? bnNum(s.replace('AM', 'এএম').replace('PM', 'পিএম')) : s;
}

// Current day/date/time from the student's phone, or Bangladesh time as fallback.
function nowContext(input) {
  const n = input || {};
  if (DAYS.includes(n.day) && isDate(n.date) && isTime(n.time)) return { day: n.day, date: n.date, time: n.time };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date()).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return { day: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Teacher details sent by the browser: { code, teaches: [{ key, course }] } (body object or JSON in the query)
function teacherFrom(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v.slice(0, 4000)); } catch (_) { v = null; }
  }
  return rooms.normalizeTeacher(v);
}

// Tell every teacher who teaches one of these classes (by course + section, or initials)
function notifyTeachers(classes, build) {
  push.sendToTeachersOf(classes, build).catch((e) => console.error('Teacher push failed:', e.message));
}

// Save a notice and push it to the phones of that section
function addNotice(a) {
  store.get().announcements.push(a);
  push.notice(a);
  return a;
}

// ---------- CR login (class code + PIN) ----------
const sessions = new Map(); // token -> { key, exp }
const adminSessions = new Map(); // token -> exp
const ADMIN_KEY = process.env.ADMIN_KEY || '';

function endCrSessions(key, except) {
  for (const [t, s] of sessions) if (s.key === key && t !== except) sessions.delete(t);
}
function adminAuth(req, res, next) {
  const exp = adminSessions.get(req.get('x-admin-token') || '');
  if (!exp || exp < Date.now()) return res.status(401).json({ error: 'Please log in as admin.' });
  next();
}
function crAuth(req, res, next) {
  const token = req.get('x-cr-token');
  const s = token && sessions.get(token);
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'Please log in as CR first.' });
  req.cr = store.findSection(s.key);
  req.crKey = s.key;
  next();
}

// ---------- read-only routes ----------
// Tiny endpoint for an uptime pinger (keeps the free server awake so scheduled reminders are sent)
app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, model: gemma.MODEL, storage: store.usesDatabase() ? 'database' : 'file', ...(await gemma.checkModel()) });
});

app.get('/api/meta', (req, res) => {
  const db = store.get();
  const buildings = [...new Set(db.rooms.map((r) => r.building))].sort();
  res.json({ term: db.term, days: db.days, sections: store.publicSections(), buildings, rooms: db.rooms, coverage: rooms.coverage() });
});

app.get('/api/classes', (req, res) => {
  const key = str(req.query.section, 60);
  if (!store.findSection(key)) return res.status(404).json({ error: 'Section not found.' });
  res.json({ classes: rooms.sectionClasses(key) });
});

app.get('/api/today', (req, res) => {
  const key = str(req.query.section, 60);
  if (!store.findSection(key)) return res.status(404).json({ error: 'Section not found.' });
  const ctx = nowContext({ day: req.query.day, date: req.query.date, time: req.query.time });
  const db = store.get();
  const cancelled = db.overrides.filter((o) => o.date === ctx.date && o.type === 'cancel').map((o) => o.classId);
  const list = db.classes.filter((c) => c.day === ctx.day && store.sectionKey(c) === key)
    .map((c) => ({ ...c, cancelled: cancelled.includes(c.id) }));
  const extras = db.overrides.filter((o) => o.date === ctx.date && o.type === 'extra' && store.sectionKey(o) === key)
    .map((o) => ({ id: o.id, day: ctx.day, start: o.start, end: o.end, course: o.course, title: 'Extra class', room: o.room, extra: true }));
  res.json({ ...ctx, classes: [...list, ...extras].sort((a, b) => rooms.toMin(a.start) - rooms.toMin(b.start)) });
});

// ---------- Teacher mode (no login: teachers only read their own schedule) ----------
app.get('/api/teachers', (req, res) => res.json({ teachers: rooms.teachers() }));

app.get('/api/teacher/classes', (req, res) => {
  const t = teacherFrom(req.query.t);
  if (!t) return res.status(400).json({ error: 'Add the courses and sections you teach.' });
  res.json({ classes: rooms.teacherClasses(t) });
});

app.get('/api/teacher/today', (req, res) => {
  const t = teacherFrom(req.query.t);
  if (!t) return res.status(400).json({ error: 'Add the courses and sections you teach.' });
  const ctx = nowContext({ day: req.query.day, date: req.query.date, time: req.query.time });
  const db = store.get();
  const cancelled = db.overrides.filter((o) => o.date === ctx.date && o.type === 'cancel').map((o) => o.classId);
  const mine = db.classes.filter((c) => rooms.isTeachersClass(c, t));
  const list = mine.filter((c) => c.day === ctx.day).map((c) => ({ ...c, cancelled: cancelled.includes(c.id) }));
  // Extra classes booked by CRs for a course this teacher teaches in that section
  const extras = db.overrides.filter((o) => o.type === 'extra' && o.date === ctx.date && (rooms.isTeachersClass(o, t) || mine.some((c) => c.dept === o.dept && c.section === o.section && rooms.normCourse(c.course) === rooms.normCourse(o.course))))
    .map((o) => ({ id: o.id, dept: o.dept, semester: o.semester, section: o.section, day: ctx.day, start: o.start, end: o.end, course: o.course, title: 'Extra class', room: o.room, extra: true }));
  res.json({ ...ctx, classes: [...list, ...extras].sort((a, b) => rooms.toMin(a.start) - rooms.toMin(b.start)) });
});

// Courses taught in a section (helps teachers pick theirs)
app.get('/api/section/courses', (req, res) => {
  const key = str(req.query.section, 60);
  const map = new Map();
  for (const c of store.get().classes) if (store.sectionKey(c) === key && !map.has(c.course)) map.set(c.course, c.title || '');
  res.json({ courses: [...map.entries()].map(([course, title]) => ({ course, title })).sort((a, b) => a.course.localeCompare(b.course)) });
});

app.get('/api/rooms/free', (req, res) => {
  const ctx = nowContext({ day: req.query.day, date: req.query.date, time: req.query.time });
  const day = DAYS.includes(req.query.day) ? req.query.day : ctx.day;
  const time = isTime(req.query.time) ? req.query.time : ctx.time;
  const date = isDate(req.query.date) ? req.query.date : (day === ctx.day ? ctx.date : null);
  const list = rooms.freeRooms({
    day, time, date,
    building: normBuilding(str(req.query.building, 12)),
    floor: str(req.query.floor, 2) || null,
    minMinutes: Math.min(600, Number(req.query.min) || 0),
  });
  res.json({ day, time, date, rooms: list, coverage: rooms.coverage() });
});

app.get('/api/rooms/:id/day', (req, res) => {
  const day = DAYS.includes(req.query.day) ? req.query.day : nowContext().day;
  const date = isDate(req.query.date) ? req.query.date : null;
  const id = normRoom(str(req.params.id, 20));
  res.json({ room: id, day, blocks: rooms.roomDay(id, day, date) });
});

app.get('/api/announcements', (req, res) => {
  const key = str(req.query.section, 60);
  const list = store.get().announcements.filter((a) => store.sectionKey(a) === key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  res.json({ announcements: list });
});

// ---------- CR routes ----------
app.post('/api/cr/login', rateLimit(10, 60000), (req, res) => {
  const key = str(req.body && req.body.section, 60);
  const pin = str(req.body && req.body.pin, 20);
  if (!store.checkPin(key, pin)) return res.status(401).json({ error: 'Wrong section or PIN.' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { key, exp: Date.now() + 12 * 60 * 60 * 1000 });
  res.json({ token, section: key });
});

// CR changes their own PIN
app.post('/api/cr/pin', crAuth, rateLimit(10, 60000), (req, res) => {
  const current = str(req.body && req.body.current, 20);
  const next = str(req.body && req.body.next, 20);
  if (!store.checkPin(req.crKey, current)) return res.status(401).json({ error: 'Your current PIN is wrong.' });
  if (!/^\d{4,8}$/.test(next)) return res.status(400).json({ error: 'The new PIN must be 4 to 8 digits.' });
  if (next === '1234' || /^(\d)\1+$/.test(next)) return res.status(400).json({ error: 'Choose a less easy PIN.' });
  store.setPin(req.crKey, next);
  endCrSessions(req.crKey, req.get('x-cr-token')); // log out other devices
  store.save();
  res.json({ ok: true });
});

// ---------- Admin: give each CR a private PIN ----------
app.post('/api/admin/login', rateLimit(5, 60000), (req, res) => {
  if (!ADMIN_KEY) return res.status(503).json({ error: 'Admin is not set up. Add ADMIN_KEY to the server settings.' });
  const key = str(req.body && req.body.key, 200);
  const a = crypto.createHash('sha256').update(key).digest();
  const b = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong admin key.' });
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, Date.now() + 4 * 60 * 60 * 1000);
  res.json({ token });
});

app.get('/api/admin/sections', adminAuth, (req, res) => {
  res.json({
    sections: store.get().sections.map((s) => ({
      key: store.sectionKey(s), dept: s.dept, semester: s.semester, section: s.section,
      pin: !s.crPinHash ? 'none' : (s.crPinDemo ? 'demo' : 'private'), setAt: s.crPinSetAt || null,
    })),
  });
});

app.post('/api/admin/pin', adminAuth, (req, res) => {
  const key = str(req.body && req.body.section, 60);
  if (!store.findSection(key)) return res.status(404).json({ error: 'Section not found.' });
  const pin = String(crypto.randomInt(100000, 1000000)); // random 6 digits
  store.setPin(key, pin);
  endCrSessions(key); // the old PIN and its logins stop working now
  store.save();
  res.json({ section: key, pin });
});

app.post('/api/admin/logout', (req, res) => {
  adminSessions.delete(req.get('x-admin-token'));
  res.json({ ok: true });
});

app.post('/api/cr/logout', (req, res) => {
  sessions.delete(req.get('x-cr-token'));
  res.json({ ok: true });
});

// Gemma reads a routine photo (anyone can preview; only CRs can save)
app.post('/api/routine/extract', rateLimit(10, 60000), withImage(true), async (req, res) => {
  try {
    const started = Date.now();
    const classes = await gemma.extractRoutine(req.images, str(req.body.hint, 60));
    res.json({ classes, model: gemma.MODEL, seconds: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    console.error('Routine extract failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Clean + validate rows sent by the CR. Rows belong to the CR's department.
function cleanRows(rows, cr) {
  const db = store.get();
  const out = [];
  const problems = [];
  rows.slice(0, 300).forEach((r, i) => {
    const row = {
      day: DAYS.includes(r && r.day) ? r.day : null,
      start: isTime(r && r.start) ? r.start : null,
      end: isTime(r && r.end) ? r.end : null,
      course: str(r && r.course, 30).toUpperCase(),
      title: str(r && r.title, 60),
      section: (str(r && r.section, 20) || cr.section).toUpperCase(),
      room: normRoom(str(r && r.room, 20)),
      teacher: str(r && r.teacher, 30),
    };
    if (!row.day || !row.start || !row.end || !row.course || !row.room || rooms.toMin(row.end) <= rooms.toMin(row.start)) {
      problems.push(i + 1);
      return;
    }
    const known = db.sections.find((s) => s.dept === cr.dept && s.section === row.section);
    row.dept = cr.dept;
    row.semester = known ? known.semester : (/^\d+/.exec(row.section) || [cr.semester])[0];
    out.push(row);
  });
  return { rows: out, problems };
}

function routineChanges(rows) {
  const db = store.get();
  const keys = new Set(rows.map((r) => store.sectionKey(r)));
  const old = db.classes.filter((c) => keys.has(store.sectionKey(c)));
  return { keys, changes: diffRoutine(old, rows) };
}

app.post('/api/routine/preview', crAuth, (req, res) => {
  const { rows, problems } = cleanRows(Array.isArray(req.body.classes) ? req.body.classes : [], req.cr);
  if (problems.length) return res.status(400).json({ error: `Rows ${problems.join(', ')} are incomplete (day, start, end, course and room are needed).`, problems });
  const { keys, changes } = routineChanges(rows);
  res.json({ sections: [...keys], changes: changes.map((c) => ({ ...c, text: describe(c) })) });
});

app.post('/api/routine/save', crAuth, (req, res) => {
  const { rows, problems } = cleanRows(Array.isArray(req.body.classes) ? req.body.classes : [], req.cr);
  if (problems.length) return res.status(400).json({ error: `Rows ${problems.join(', ')} are incomplete.`, problems });
  if (!rows.length) return res.status(400).json({ error: 'No classes to save.' });
  const db = store.get();
  const { keys, changes } = routineChanges(rows);
  const hadOld = new Set(db.classes.filter((c) => keys.has(store.sectionKey(c))).map((c) => store.sectionKey(c)));

  db.classes = db.classes.filter((c) => !keys.has(store.sectionKey(c)));
  for (const r of rows) {
    db.classes.push({ id: store.newId('c'), ...r });
    if (!db.rooms.some((x) => x.id === r.room)) {
      db.rooms.push({ id: r.room, ...roomParts(r.room), type: /LAB/i.test(r.room) ? 'Lab' : 'Classroom' });
    }
  }
  for (const k of keys) {
    const [dept, semester, section] = k.split('|');
    if (!db.sections.some((s) => store.sectionKey(s) === k)) db.sections.push({ dept, semester, section });
  }

  // One simple notice per section: "published" the first time, "updated" when something changed
  const created = [];
  if (req.body.announce !== false) {
    const changedSections = new Set(changes.map((c) => store.sectionKey(c.after || c.before)));
    for (const k of keys) {
      const first = !hadOld.has(k);
      if (!first && !changedSections.has(k)) continue; // re-saved with no changes: don't notify
      const [dept, semester, section] = k.split('|');
      const a = {
        id: store.newId('a'), dept, semester, section, tag: 'class_change',
        title: first ? 'Class routine published' : 'Class routine updated',
        body_en: first
          ? 'Your CR has shared the class routine. Open Home to see your timetable and next class.'
          : 'Your class routine has been updated by your CR. Please check your timetable for the latest class times and rooms.',
        body_bn: first
          ? 'তোমার CR ক্লাস রুটিন শেয়ার করেছে। টাইমটেবিল আর পরের ক্লাস দেখতে Home খোলো।'
          : 'তোমার CR ক্লাস রুটিন আপডেট করেছে। সর্বশেষ ক্লাসের সময় ও রুম জানতে টাইমটেবিল দেখো।',
        event: null, createdAt: new Date().toISOString(), by: 'CR', auto: true,
      };
      addNotice(a);
      created.push(a);
    }
  }
  store.save();
  // Teachers whose classes changed get their own notification
  const changedClasses = changes.flatMap((ch) => [ch.before, ch.after]).filter(Boolean);
  if (changedClasses.length) {
    notifyTeachers(changedClasses, (lang, mine) => {
      const list = [...new Set(mine.map((c) => `${c.course} (${c.section})`))].join(', ');
      return lang === 'bn'
        ? { title: 'তোমার ক্লাস রুটিন বদলেছে', body: `আপডেট: ${list}। নতুন সময় ও রুম দেখতে ScanClass খোলো।` }
        : { title: 'Your class routine changed', body: `Updated: ${list}. Open ScanClass to see the new times and rooms.` };
    });
  }
  res.json({ saved: rows.length, sections: [...keys], changes: changes.map(describe), announcements: created.length });
});

app.post('/api/announce/draft', crAuth, rateLimit(15, 60000), withImage(false), async (req, res) => {
  const text = str(req.body.text, 1000);
  if (!text && !req.images.length) return res.status(400).json({ error: 'Type a message or add a notice photo.' });
  try {
    const ctx = nowContext();
    const draft = await gemma.draftAnnouncement({ text, images: req.images, today: `${ctx.day} ${ctx.date}`, section: `${req.cr.dept} ${req.cr.section}` });
    res.json({ draft, model: gemma.MODEL });
  } catch (e) {
    console.error('Draft failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/announcements', crAuth, (req, res) => {
  const b = req.body || {};
  const body_en = str(b.body_en, 800);
  if (!body_en) return res.status(400).json({ error: 'The announcement text is empty.' });
  const ev = b.event && isDate(b.event.date) ? { date: b.event.date, time: isTime(b.event.time) ? b.event.time : null } : null;
  const a = {
    id: store.newId('a'), dept: req.cr.dept, semester: req.cr.semester, section: req.cr.section,
    tag: ['exam', 'class_change', 'cancel', 'assignment', 'event', 'info'].includes(b.tag) ? b.tag : 'info',
    title: str(b.title, 80) || 'Announcement', body_en, body_bn: str(b.body_bn, 1000) || null,
    event: ev, createdAt: new Date().toISOString(), by: 'CR',
  };
  addNotice(a);
  store.save();
  res.json({ announcement: a });
});

app.delete('/api/announcements/:id', crAuth, (req, res) => {
  const db = store.get();
  const i = db.announcements.findIndex((a) => a.id === req.params.id && store.sectionKey(a) === req.crKey);
  if (i === -1) return res.status(404).json({ error: 'Announcement not found.' });
  db.announcements.splice(i, 1);
  store.save();
  res.json({ ok: true });
});

// Cancel a class or book an extra class for a date (updates free rooms + notifies)
app.post('/api/overrides', crAuth, (req, res) => {
  const b = req.body || {};
  const db = store.get();
  if (!isDate(b.date)) return res.status(400).json({ error: 'Pick a date.' });
  let o;
  let text;
  if (b.type === 'cancel') {
    const c = db.classes.find((x) => x.id === b.classId && store.sectionKey(x) === req.crKey);
    if (!c) return res.status(404).json({ error: 'Class not found in your section.' });
    o = { id: store.newId('o'), type: 'cancel', classId: c.id, date: b.date, dept: c.dept, semester: c.semester, section: c.section };
    text = {
      title: `${c.course} class cancelled`,
      en: `The ${c.course} class on ${niceDate(b.date)} at ${niceTime(c.start)} in Room ${c.room} has been cancelled.`,
      bn: `${niceDate(b.date, true)} ${niceTime(c.start, true)}-এর ${c.course} ক্লাস (রুম ${c.room}) বাতিল করা হয়েছে।`,
      tag: 'cancel',
    };
  } else if (b.type === 'extra') {
    const start = isTime(b.start) ? b.start : null;
    const end = isTime(b.end) ? b.end : null;
    const room = normRoom(str(b.room, 20));
    const course = str(b.course, 30).toUpperCase();
    if (!start || !end || !room || !course || rooms.toMin(end) <= rooms.toMin(start)) return res.status(400).json({ error: 'Fill in course, room, start and end time.' });
    const day = rooms.dayOfDate(b.date);
    const clash = rooms.classesOn(day, b.date).find((c) => c.room === room && rooms.toMin(c.start) < rooms.toMin(end) && rooms.toMin(start) < rooms.toMin(c.end));
    if (clash) return res.status(409).json({ error: `Room ${room} is busy then (${clash.course}, ${clash.start}-${clash.end}). Pick a free room.` });
    o = { id: store.newId('o'), type: 'extra', date: b.date, start, end, room, course, dept: req.cr.dept, semester: req.cr.semester, section: req.cr.section };
    text = {
      title: `Extra class: ${course}`,
      en: `There will be an extra ${course} class on ${niceDate(b.date)} from ${niceTime(start)} to ${niceTime(end)} in Room ${room}.`,
      bn: `${niceDate(b.date, true)} ${niceTime(start, true)} থেকে ${niceTime(end, true)} পর্যন্ত রুম ${room}-এ ${course}-এর একটি এক্সট্রা ক্লাস হবে।`,
      tag: 'class_change',
    };
  } else {
    return res.status(400).json({ error: 'Unknown action.' });
  }
  db.overrides.push(o);
  // The teacher of that class is told too
  const affected = b.type === 'cancel' ? db.classes.filter((x) => x.id === o.classId) : [o];
  notifyTeachers(affected, (lang) => ({ title: `📢 ${text.title} (${o.section})`, body: lang === 'bn' ? text.bn : text.en }));
  addNotice({
    id: store.newId('a'), dept: req.cr.dept, semester: req.cr.semester, section: req.cr.section, tag: text.tag,
    title: text.title, body_en: text.en, body_bn: text.bn, event: { date: b.date, time: o.start || null }, createdAt: new Date().toISOString(), by: 'CR', auto: true,
  });
  store.save();
  res.json({ override: o });
});

// ---------- Exam syllabus (CR uploads, students read) ----------
app.get('/api/syllabus', (req, res) => {
  const key = str(req.query.section, 60);
  const list = store.get().syllabi.filter((s) => store.sectionKey(s) === key)
    .sort((a, b) => a.course.localeCompare(b.course) || a.exam.localeCompare(b.exam));
  res.json({ syllabi: list });
});

app.post('/api/syllabus/extract', crAuth, rateLimit(15, 60000), withImage(false), async (req, res) => {
  const text = str(req.body.text, 3000);
  if (!text && !req.images.length) return res.status(400).json({ error: 'Type the syllabus or add a photo of it.' });
  try {
    const courses = [...new Set(store.get().classes.filter((c) => store.sectionKey(c) === req.crKey).map((c) => c.course))];
    const draft = await gemma.extractSyllabus({ text, images: req.images, courses, exam: req.body.exam === 'final' ? 'final' : 'mid' });
    res.json({ draft, model: gemma.MODEL });
  } catch (e) {
    console.error('Syllabus extract failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/syllabus', crAuth, (req, res) => {
  const b = req.body || {};
  const course = str(b.course, 30).toUpperCase().replace(/\s+/g, '-');
  const exam = b.exam === 'final' ? 'final' : 'mid';
  const topics = (Array.isArray(b.topics) ? b.topics : []).map((t) => str(t, 200)).filter(Boolean).slice(0, 60);
  if (!course) return res.status(400).json({ error: 'Choose the course.' });
  if (!topics.length) return res.status(400).json({ error: 'Add at least one topic.' });
  const db = store.get();
  const existing = db.syllabi.find((s) => store.sectionKey(s) === req.crKey && s.course === course && s.exam === exam);
  const item = {
    id: existing ? existing.id : store.newId('s'), dept: req.cr.dept, semester: req.cr.semester, section: req.cr.section,
    course, exam, topics, examDate: isDate(b.examDate) ? b.examDate : null, notes: str(b.notes, 300) || null,
    createdAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, item);
  else db.syllabi.push(item);
  const examEn = exam === 'final' ? 'final exam' : 'mid-term exam';
  const examBn = exam === 'final' ? 'ফাইনাল পরীক্ষার' : 'মিড-টার্ম পরীক্ষার';
  addNotice({
    id: store.newId('a'), dept: req.cr.dept, semester: req.cr.semester, section: req.cr.section, tag: 'exam',
    title: `${course} ${exam === 'final' ? 'final' : 'mid-term'} syllabus ${existing ? 'updated' : 'published'}`,
    body_en: `The ${examEn} syllabus for ${course} is now available. Open the Syllabus tab to see all topics.`,
    body_bn: `${course} কোর্সের ${examBn} সিলেবাস দেওয়া হয়েছে। সব টপিক দেখতে Syllabus ট্যাব খোলো।`,
    event: item.examDate ? { date: item.examDate, time: null } : null, createdAt: new Date().toISOString(), by: 'CR', auto: true,
  });
  store.save();
  res.json({ syllabus: item, updated: !!existing });
});

app.delete('/api/syllabus/:id', crAuth, (req, res) => {
  const db = store.get();
  const i = db.syllabi.findIndex((s) => s.id === req.params.id && store.sectionKey(s) === req.crKey);
  if (i === -1) return res.status(404).json({ error: 'Syllabus not found.' });
  db.syllabi.splice(i, 1);
  store.save();
  res.json({ ok: true });
});

// ---------- Import a file from a Google Drive / Docs / Sheets link ----------
// We only ever build Google download URLs from the file id, so this cannot be used to fetch other sites.
function driveDownloadUrl(link) {
  let u;
  try { u = new URL(link); } catch (_) { return null; }
  if (!/^(drive|docs)\.google\.com$/.test(u.hostname)) return null;
  const id = (/\/d\/([\w-]{10,})/.exec(u.pathname) || [])[1] || u.searchParams.get('id');
  if (!id || !/^[\w-]{10,}$/.test(id)) return null;
  if (u.hostname === 'docs.google.com') {
    if (u.pathname.startsWith('/document/')) return `https://docs.google.com/document/d/${id}/export?format=pdf`;
    if (u.pathname.startsWith('/spreadsheets/')) return `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`;
    if (u.pathname.startsWith('/presentation/')) return `https://docs.google.com/presentation/d/${id}/export/pdf`;
    return null;
  }
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

app.get('/api/import/drive', rateLimit(10, 60000), async (req, res) => {
  const url = driveDownloadUrl(str(req.query.url, 500));
  if (!url) return res.status(400).json({ error: 'Paste a Google Drive, Docs or Sheets link.' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!r.ok) return res.status(400).json({ error: 'Could not open that link. Is it shared with "Anyone with the link"?' });
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      return res.status(400).json({ error: 'That link is not a public image or PDF. In Google Drive set sharing to "Anyone with the link", or download the file and upload it.' });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'That file is too large (max 10 MB).' });
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: e.name === 'AbortError' ? 'Google Drive took too long. Try again.' : 'Could not download from Google Drive.' });
  } finally {
    clearTimeout(timer);
  }
});

// ---------- Phone notifications (Web Push) ----------
app.get('/api/push/key', (req, res) => res.json({ publicKey: push.getPublicKey() }));

app.post('/api/push/subscribe', rateLimit(20, 60000), (req, res) => {
  const b = req.body || {};
  const section = str(b.section, 60);
  const teacher = teacherFrom(b.teacher);
  if (!teacher && !store.findSection(section)) return res.status(400).json({ error: 'Choose your section first.' });
  if (!push.validSubscription(b.subscription)) return res.status(400).json({ error: 'Invalid notification subscription.' });
  push.subscribe(b.subscription, teacher ? null : section, b.lang, teacher || null);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const endpoint = str(req.body && req.body.endpoint, 1000);
  if (endpoint) push.unsubscribe(endpoint);
  res.json({ ok: true });
});

app.post('/api/push/test', rateLimit(5, 60000), async (req, res) => {
  const endpoint = str(req.body && req.body.endpoint, 1000);
  const sub = store.get().pushSubs.find((x) => x.endpoint === endpoint);
  if (!sub) return res.status(404).json({ error: 'This phone is not subscribed yet.' });
  try {
    await require('web-push').sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify({
      title: '✅ ScanClass notifications are on', body: sub.lang === 'bn' ? 'তোমার CR-এর নোটিশ আর ক্লাসের রিমাইন্ডার এখানে আসবে।' : "Your CR's notices and class reminders will appear here.", url: '/#notices', tag: 'test',
    }));
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'Could not send a test notification.' });
  }
});

// ---------- Ask (Gemma understands, code answers) ----------
app.post('/api/ask', rateLimit(20, 60000), async (req, res) => {
  const question = str(req.body && req.body.question, 400);
  const key = str(req.body && req.body.section, 60);
  const teacher = teacherFrom(req.body && req.body.teacher);
  if (!question) return res.status(400).json({ error: 'Type or say a question.' });
  if (!teacher && !store.findSection(key)) return res.status(400).json({ error: 'Choose your section first.' });
  const ctx = { ...nowContext(req.body.now), sectionKey: teacher ? null : key, teacher: teacher || null };
  const db = store.get();
  try {
    const q = await gemma.parseQuestion({
      question,
      context: { ...ctx, section: teacher ? 'a teacher (asks about their own classes)' : key.replace(/\|/g, ' '), buildings: [...new Set(db.rooms.map((r) => r.building))], rooms: db.rooms.map((r) => r.id) },
    });
    if (/[ঀ-৿]/.test(question)) q.lang = 'bn';
    res.json({ ...answer(q, ctx), intent: q.intent, model: gemma.MODEL });
  } catch (e) {
    console.error('Ask failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Load the data (database or local file), then start the server
store.init()
  .then(() => {
    push.init();
    app.listen(PORT, () => {
      console.log(`ScanClass AI running at http://localhost:${PORT}`);
      console.log(`AI model: ${gemma.MODEL} via ${gemma.HOST}`);
    });
  })
  .catch((e) => {
    console.error('Could not load data:', e.message);
    process.exit(1);
  });
