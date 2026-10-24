// The ONLY file that talks to the AI model (Gemma 4 through Ollama).
// Works with local Ollama (http://localhost:11434) or Ollama cloud (https://ollama.com).

const { normRoom, normBuilding } = require('./format');

const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'gemma4:31b-cloud';
const API_KEY = process.env.OLLAMA_API_KEY || '';

class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (API_KEY) h.Authorization = `Bearer ${API_KEY}`; // only needed for Ollama cloud
  return h;
}

async function chat(messages, { json = false, timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: headers(),
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        ...(json ? { format: 'json' } : {}),
        options: { temperature: json ? 0 : 0.3 },
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new AIError('The AI model took too long to respond. Please try again.', 504);
    throw new AIError('Cannot reach the AI model. Check the internet and that Ollama is running.', 503);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Ollama error', res.status, detail.slice(0, 300));
    if (res.status === 404) throw new AIError(`Model "${MODEL}" was not found in Ollama.`, 503);
    if (res.status === 401 || res.status === 403) throw new AIError('The AI service rejected the API key or sign-in.', 503);
    if (res.status === 429) throw new AIError('The AI service is busy or the usage limit was reached. Please wait a moment.', 429);
    throw new AIError('The AI model returned an error.', 502);
  }
  const data = await res.json();
  const text = data && data.message && data.message.content;
  if (!text || !text.trim()) throw new AIError('The AI model returned an empty answer.', 502);
  return text.trim();
}

// ---------- helpers ----------
const BN = '০১২৩৪৫৬৭৮৯';
const enDigits = (s) => String(s).replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));

function parseJSON(text) {
  try { return JSON.parse(text); } catch (_) { /* try to cut out the JSON */ }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return JSON.parse(text.slice(a, b + 1)); } catch (_) { /* give up */ }
  }
  return null;
}

function clean(v, max = 120) {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).trim();
  if (!s || /^(null|n\/a|na|none|unknown|-|not given)$/i.test(s)) return null;
  return s.slice(0, max);
}

const DAY_MAP = [
  ['Sat', /^(sat|saturday|শনি)/i], ['Sun', /^(sun|sunday|রবি)/i], ['Mon', /^(mon|monday|সোম)/i],
  ['Tue', /^(tue|tues|tuesday|মঙ্গল)/i], ['Wed', /^(wed|wednesday|বুধ)/i], ['Thu', /^(thu|thur|thurs|thursday|বৃহঃ|বৃহস্পতি)/i],
  ['Fri', /^(fri|friday|শুক্র)/i],
];
function normDay(v) {
  const s = clean(v, 20);
  if (!s) return null;
  const hit = DAY_MAP.find(([, re]) => re.test(s));
  return hit ? hit[0] : null;
}

// "8.30", "8:30 AM", "1:30" (university hours -> 13:30), "১০:০০" -> "HH:MM"
function normTime(v) {
  const s = clean(v, 20);
  if (!s) return null;
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(enDigits(s));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 7) h += 12; // classes run roughly 8:00-18:00
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// ---------- 1. Read a routine photo ----------
const ROUTINE_PROMPT = (hint) => `You are reading a photo of a university class routine (timetable) from Bangladesh. It may be printed, handwritten, blurry, or in English/Bangla.
Read EVERY class in the table carefully. Return ONLY JSON:
{"section_hint":string|null,"classes":[{"day":string,"start":string,"end":string,"course":string,"title":string|null,"section":string|null,"room":string|null,"teacher":string|null,"confident":boolean,"unclear":string|null}]}

How routines are usually laid out:
- A grid: days down the side (Sat, Sun, Mon, Tue, Wed, Thu or Bangla শনি, রবি, সোম, মঙ্গল, বুধ, বৃহস্পতি) and time slots across the top (e.g. 8:30-9:50, 10:00-11:20), or the other way round.
- Each cell usually has a course code (e.g. CSE-1121), a room and teacher initials (e.g. SAR). A cell spanning two slots is one long class (often a lab).
- The campus has two buildings, "C" and "Cx". Rooms are written like C-102, C 304, Cx-304, CX304. Keep the building letters exactly (C or Cx) and the room number.
- The title often says the department, semester and section (e.g. "CSE 2nd Semester, Section 2BM"). If one section is shown for the whole table, put it in section_hint and in every class.
- A master routine can contain several sections; then read the section for each row/cell.

Rules:
- One entry per class meeting (a course that meets twice a week = two entries).
- Times in 24-hour HH:MM. Classes are between 08:00 and 18:00, so "1:30" means 13:30.
- Copy course codes, rooms and teacher initials exactly as written. Never invent a class, room or time.
- If a cell is hard to read, still include it with your best reading, set "confident": false and explain in "unclear".
- Empty cells are free periods: do not include them.
- If the image is not a routine, return {"section_hint":null,"classes":[]}.
${hint ? `The uploader says this routine is for: ${hint}.` : ''}`;

function normalizeClasses(parsed) {
  const list = parsed && Array.isArray(parsed.classes) ? parsed.classes : null;
  if (!list) return null;
  const hint = clean(parsed.section_hint, 20);
  return list
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const out = {
        day: normDay(c.day),
        start: normTime(c.start),
        end: normTime(c.end),
        course: clean(c.course, 30),
        title: clean(c.title, 60),
        section: (clean(c.section, 20) || hint || '').toUpperCase().replace(/^SECTION\s*/i, '') || null,
        room: clean(c.room, 20) ? normRoom(clean(c.room, 20)) : null,
        teacher: clean(c.teacher, 30),
        unclear: clean(c.unclear, 160),
      };
      if (out.course) out.course = out.course.toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
      out.confident = c.confident !== false && !!(out.day && out.start && out.end && out.course && out.room);
      return out;
    })
    .filter((c) => c.course || c.room)
    .slice(0, 200);
}

// images: one buffer per photo or PDF page (max 4)
async function extractRoutine(images, hint) {
  const pages = images.length > 1 ? `\nThere are ${images.length} images: they are pages of the same routine. Read all of them.` : '';
  const messages = [{ role: 'user', content: ROUTINE_PROMPT(hint) + pages, images: images.map((b) => b.toString('base64')) }];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await chat(messages, { json: true, timeoutMs: 240000 });
    const classes = normalizeClasses(parseJSON(text));
    if (classes) return classes;
    console.warn(`Routine extraction attempt ${attempt}: invalid JSON.`);
  }
  throw new AIError('The AI could not read this routine. Try a clearer, straight photo of the whole table.', 422);
}

// ---------- 2. Write a CR announcement ----------
const TAGS = ['exam', 'class_change', 'cancel', 'assignment', 'event', 'info'];

async function draftAnnouncement({ text, images = [], today, section }) {
  const imageBuffer = images.length > 0;
  const prompt = `You help a class representative (CR) at a Bangladeshi university write a clear announcement for their section (${section}).
Today is ${today}. The CR gave ${imageBuffer ? 'a photo of a notice' : 'a quick message'}${text ? `: "${text}"` : ''}.
Write a short, clear announcement. Return ONLY JSON:
{"title":string,"body_en":string,"body_bn":string,"tag":"exam"|"class_change"|"cancel"|"assignment"|"event"|"info","event_date":"YYYY-MM-DD"|null,"event_time":"HH:MM"|null}
Rules:
- title: max 8 words. body_en: 1-3 short sentences in simple English. body_bn: the same meaning in natural Bangla (বাংলা); keep course codes and room numbers in English.
- Keep every fact (course, room, date, time) exactly as given. Never add facts that are not there.
- event_date/event_time only if a specific date/time is mentioned (resolve "tomorrow", "next Sunday" from today's date); otherwise null.`;
  const msg = { role: 'user', content: prompt };
  if (images.length) msg.images = images.map((b) => b.toString('base64'));
  const raw = parseJSON(await chat([msg], { json: true, timeoutMs: 120000 }));
  if (!raw || !clean(raw.body_en, 600)) throw new AIError('The AI could not write this announcement. Please try again or write it yourself.', 422);
  const date = clean(raw.event_date, 10);
  return {
    title: clean(raw.title, 80) || 'Announcement',
    body_en: clean(raw.body_en, 600),
    body_bn: clean(raw.body_bn, 800),
    tag: TAGS.includes(raw.tag) ? raw.tag : 'info',
    event: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, time: normTime(raw.event_time) } : null,
  };
}

// ---------- 2b. Read an exam syllabus ----------
async function extractSyllabus({ text, images = [], courses, exam }) {
  const imageBuffer = images.length > 0;
  const prompt = `A class representative (CR) at a Bangladeshi university is sharing the ${exam === 'final' ? 'FINAL' : 'MID-TERM'} exam syllabus with classmates.
They gave ${imageBuffer ? 'a photo of the syllabus' : 'a typed message'}${text ? `: "${text}"` : ''}.
Courses of this section: ${courses.join(', ') || 'unknown'}.
Turn it into a clean topic list. Return ONLY JSON:
{"course":string|null,"topics":[string],"exam_date":"YYYY-MM-DD"|null,"notes":string|null}
Rules:
- course: the course code (e.g. CSE-1121). Pick from the course list when it matches; null if not stated.
- topics: one short topic per item, in the order given (chapters, sections, page ranges count as topics). Keep the original wording and chapter numbers. Never add topics that are not there.
- exam_date only if a date is written. notes: any extra instruction (marks, time, what to bring), else null.
- Handwriting, Bangla and English are all possible. If the content is not a syllabus, return {"course":null,"topics":[],"exam_date":null,"notes":null}.`;
  const msg = { role: 'user', content: prompt };
  if (images.length) msg.images = images.map((b) => b.toString('base64'));
  const raw = parseJSON(await chat([msg], { json: true, timeoutMs: 150000 }));
  if (!raw) throw new AIError('The AI could not read this syllabus. Try again or type the topics.', 422);
  const topics = (Array.isArray(raw.topics) ? raw.topics : []).map((t) => clean(t, 200)).filter(Boolean).slice(0, 60);
  const date = clean(raw.exam_date, 10);
  return {
    course: clean(raw.course, 30) ? clean(raw.course, 30).toUpperCase().replace(/\s+/g, '-') : null,
    topics,
    examDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    notes: clean(raw.notes, 300),
  };
}

// ---------- 3. Understand a student's question ----------
const INTENTS = ['free_rooms', 'room_schedule', 'next_class', 'my_day', 'course_when', 'syllabus', 'notices', 'other'];

async function parseQuestion({ question, context }) {
  const prompt = `You are the question understander for ScanClass, a campus app for university students in Bangladesh.
Turn the student's question into a search. Do NOT answer schedule questions yourself; the app's code will answer from real data.
Context: today is ${context.day} ${context.date}, time now ${context.time}. Student's section: ${context.section}. Buildings: ${context.buildings.join(' and ')} (room ids look like C-102, Cx-304; "Cx" and "C" are different buildings). Example rooms: ${context.rooms.slice(0, 12).join(', ')}. Days: Sat, Sun, Mon, Tue, Wed, Thu, Fri.
Return ONLY JSON:
{"intent":"free_rooms"|"room_schedule"|"next_class"|"my_day"|"course_when"|"syllabus"|"notices"|"other","exam":"mid"|"final"|null,"day":string|null,"time":"HH:MM"|null,"building":"C"|"Cx"|null,"floor":number|null,"room":string|null,"course":string|null,"min_minutes":number|null,"reply_language":"en"|"bn","answer":string|null}
Meaning:
- free_rooms: empty/free/khali room questions ("এখন কোন রুম খালি?", "free room 4th floor at 2pm").
- If the question asks whether ONE specific room is free/busy ("is C-302 free now?", "Cx-304 ki ekhon khali?", "C-102 রুম কি খালি?"), use intent room_schedule and set room.
- room_schedule: is a specific room free, or what is happening in it. next_class: my next class / where is my class now.
- my_day: my classes on a day ("aaj ki class ache", "tomorrow's classes"). course_when: when/where is a course (e.g. CSE-1121).
- syllabus: exam syllabus / topics questions ("CSE-1121 mid syllabus?", "physics final e ki ache?", "মিডের সিলেবাস কী?"). exam: "mid" for mid/midterm/মিড, "final" for final/ফাইনাল, else null. Set course if a course code or subject is named.
- notices: announcements / CR updates. other: anything else.
- day: resolve "today/aaj", "tomorrow/kal/আগামীকাল" to a day name. time: "now/ekhon/এখন" = current time; "2pm"/"দুপুর ২টা" = 14:00.
- floor: "4th floor"/"৪ তলা" = 4. min_minutes: "for 1 hour" = 60.
- reply_language: "bn" if the question is written in Bangla script or Banglish (Bangla in English letters), else "en".
- answer: ONLY for intent "other": a short helpful reply (max 60 words) in reply_language about using the app or general study tips. Never invent class times, rooms or notices. For other intents set null.
Question: "${question}"`;
  const raw = parseJSON(await chat([{ role: 'user', content: prompt }], { json: true, timeoutMs: 60000 }));
  if (!raw) throw new AIError('The AI could not understand the question. Try asking in a different way.', 422);
  const room = clean(raw.room, 20);
  return {
    intent: INTENTS.includes(raw.intent) ? raw.intent : 'other',
    day: normDay(raw.day),
    time: normTime(raw.time),
    building: normBuilding(clean(raw.building, 12)),
    floor: Number.isFinite(Number(raw.floor)) && raw.floor !== null ? Number(raw.floor) : null,
    room: room ? normRoom(room) : null,
    course: clean(raw.course, 30) ? clean(raw.course, 30).toUpperCase().replace(/\s+/g, '-') : null,
    minMinutes: Number(raw.min_minutes) > 0 ? Math.min(600, Number(raw.min_minutes)) : 0,
    exam: raw.exam === 'final' ? 'final' : (raw.exam === 'mid' ? 'mid' : null),
    lang: raw.reply_language === 'bn' ? 'bn' : 'en',
    answer: clean(raw.answer, 600),
  };
}

// ---------- health ----------
async function checkModel() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${HOST}/api/tags`, { headers: headers(), signal: controller.signal });
    if (!res.ok) return { reachable: false, modelFound: false };
    const data = await res.json();
    const names = (data.models || []).map((m) => m.name || m.model);
    return { reachable: true, modelFound: names.includes(MODEL) || names.includes(`${MODEL}:latest`) };
  } catch (_) {
    return { reachable: false, modelFound: false };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { extractRoutine, draftAnnouncement, extractSyllabus, parseQuestion, checkModel, normTime, normDay, AIError, MODEL, HOST };
