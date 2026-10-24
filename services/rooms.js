// Free-room finder and timetable logic. Pure code, no AI: answers are exact
// for whatever routines have been uploaded.

const store = require('./store');
const { roomParts } = require('./format');

const DAY_END = '17:00';
const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOfDate = (iso) => DAY_NAMES[new Date(iso + 'T12:00:00').getDay()];

// All classes happening on a day, with CR overrides for that exact date applied.
function classesOn(day, date) {
  const db = store.get();
  const overrides = date ? db.overrides.filter((o) => o.date === date) : [];
  const cancelled = new Set(overrides.filter((o) => o.type === 'cancel').map((o) => o.classId));
  const list = db.classes.filter((c) => c.day === day && !cancelled.has(c.id));
  for (const o of overrides) {
    if (o.type === 'extra') {
      list.push({ id: o.id, dept: o.dept, semester: o.semester, section: o.section, day, start: o.start, end: o.end, course: o.course, title: 'Extra class', room: o.room, teacher: '', extra: true });
    }
  }
  return list;
}

function roomInfo(id) {
  const db = store.get();
  const r = db.rooms.find((x) => x.id === id);
  if (r) return r;
  return { id, ...roomParts(id), type: /LAB/i.test(id) ? 'Lab' : 'Classroom' };
}

function allRoomIds() {
  const db = store.get();
  const ids = new Set(db.rooms.map((r) => r.id));
  for (const c of db.classes) if (c.room) ids.add(c.room);
  return [...ids].sort();
}

// Main feature: which rooms are free at a given day + time
function freeRooms({ day, time, date, building, floor, minMinutes = 0 }) {
  const db = store.get();
  const t = toMin(time);
  const end = toMin(DAY_END);
  const knownRooms = new Set(db.classes.map((c) => c.room)); // rooms that appear in uploaded routines
  const todays = classesOn(day, date);

  const rows = allRoomIds().map((id) => {
    const info = roomInfo(id);
    const inRoom = todays.filter((c) => c.room === id).sort((a, b) => toMin(a.start) - toMin(b.start));
    const current = inRoom.find((c) => toMin(c.start) <= t && t < toMin(c.end));
    if (current) {
      return { ...info, status: 'busy', until: current.end, current: { course: current.course, section: current.section, extra: !!current.extra }, freeMinutes: 0 };
    }
    const next = inRoom.find((c) => toMin(c.start) > t);
    const untilMin = next ? toMin(next.start) : end;
    return {
      ...info,
      status: knownRooms.has(id) ? 'free' : 'probably',
      until: next ? next.start : null,
      next: next ? { course: next.course, section: next.section } : null,
      freeMinutes: Math.max(0, untilMin - t),
    };
  });

  let list = rows;
  if (building) list = list.filter((r) => r.building === building);
  if (floor) list = list.filter((r) => String(r.floor) === String(floor));
  if (minMinutes) list = list.filter((r) => r.status === 'busy' || r.freeMinutes >= minMinutes);

  const order = { free: 0, probably: 1, busy: 2 };
  list.sort((a, b) => order[a.status] - order[b.status] || b.freeMinutes - a.freeMinutes || a.id.localeCompare(b.id));
  return list;
}

function roomDay(roomId, day, date) {
  return classesOn(day, date)
    .filter((c) => c.room === roomId)
    .sort((a, b) => toMin(a.start) - toMin(b.start))
    .map((c) => ({ start: c.start, end: c.end, course: c.course, section: c.section, extra: !!c.extra }));
}

function coverage() {
  const db = store.get();
  const withClasses = new Set(db.classes.map((c) => store.sectionKey(c)));
  const known = new Set(db.classes.map((c) => c.room));
  const buildings = {};
  for (const id of allRoomIds()) {
    const b = roomInfo(id).building;
    buildings[b] = buildings[b] || { total: 0, known: 0 };
    buildings[b].total++;
    if (known.has(id)) buildings[b].known++;
  }
  return { sections: withClasses.size, totalSections: db.sections.length, buildings };
}

function sectionClasses(key, day, date) {
  const list = day ? classesOn(day, date) : store.get().classes;
  return list.filter((c) => store.sectionKey(c) === key).sort((a, b) => toMin(a.start) - toMin(b.start));
}

// ---------- Teachers ----------
// A teacher is described by the courses + sections they teach (e.g. CSE-1121 in CSE 2BM),
// optionally plus their initials/name as printed in the routine (e.g. ABM).
const teacherCode = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normCourse = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Clean whatever the browser sent into { code, teaches: [{ key, course }] } (or null)
function normalizeTeacher(input) {
  if (!input || typeof input !== 'object') return null;
  const code = teacherCode(input.code).slice(0, 20);
  const teaches = (Array.isArray(input.teaches) ? input.teaches : [])
    .slice(0, 30)
    .map((p) => ({ key: String((p && p.key) || '').slice(0, 60), course: normCourse(p && p.course).slice(0, 20) }))
    .filter((p) => p.course && store.findSection(p.key));
  if (!code && !teaches.length) return null;
  return { code, teaches };
}
const teacherId = (t) => `T:${t.code}|${t.teaches.map((p) => `${p.key}~${p.course}`).sort().join(',')}`;

function isTeachersClass(cls, t) {
  if (t.code && teacherCode(cls.teacher) === t.code) return true;
  const key = store.sectionKey(cls);
  return t.teaches.some((p) => p.key === key && p.course === normCourse(cls.course));
}

function teacherClasses(t, day, date) {
  if (!t) return [];
  const mine = store.get().classes.filter((x) => isTeachersClass(x, t));
  if (!day) return mine.sort((a, b) => toMin(a.start) - toMin(b.start));
  // Same data as students: the day's classes minus cancellations, plus CR extra classes for this teacher's courses
  return classesOn(day, date)
    .filter((x) => isTeachersClass(x, t) || (x.extra && mine.some((m) => m.dept === x.dept && m.section === x.section && normCourse(m.course) === normCourse(x.course))))
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

function teachers() {
  const map = new Map();
  for (const c of store.get().classes) {
    const code = teacherCode(c.teacher);
    if (!code) continue;
    if (!map.has(code)) map.set(code, { code, label: c.teacher, sections: new Set(), courses: new Set(), count: 0 });
    const t = map.get(code);
    t.sections.add(`${c.dept} ${c.section}`);
    t.courses.add(c.course);
    t.count++;
  }
  return [...map.values()].map((t) => ({ ...t, sections: [...t.sections].sort(), courses: [...t.courses].sort() })).sort((a, b) => a.code.localeCompare(b.code));
}

module.exports = { teacherCode, normCourse, normalizeTeacher, teacherId, isTeachersClass, teacherClasses, teachers, freeRooms, roomDay, coverage, sectionClasses, classesOn, toMin, toHHMM, dayOfDate, DAY_NAMES };
