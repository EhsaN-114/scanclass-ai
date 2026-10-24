// Turns a parsed question into an exact answer from real data (English or Bangla).
// Gemma only understands the question; this code finds the facts.

const store = require('./store');
const rooms = require('./rooms');

const BN_DAY = { Sat: 'শনিবার', Sun: 'রবিবার', Mon: 'সোমবার', Tue: 'মঙ্গলবার', Wed: 'বুধবার', Thu: 'বৃহস্পতিবার', Fri: 'শুক্রবার' };
const EN_DAY = { Sat: 'Saturday', Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bnNum = (s) => String(s).replace(/\d/g, (d) => BN_DIGITS[d]);

function time12(t) {
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const T = (lang, t) => (lang === 'bn' ? bnNum(time12(t).replace('AM', 'এএম').replace('PM', 'পিএম')) : time12(t));
const D = (lang, d) => (lang === 'bn' ? BN_DAY[d] : EN_DAY[d]) || d;

// Classes of the person asking: a student's section or a teacher's own classes
function myClasses(ctx, day, date) {
  return ctx.teacher ? rooms.teacherClasses(ctx.teacher, day, date) : rooms.sectionClasses(ctx.sectionKey, day, date);
}

function noRoutine(ctx, bn) {
  if (ctx.teacher) {
    return bn ? 'তোমার কোর্স ও সেকশনের ক্লাস এখনো কোনো আপলোড করা রুটিনে পাওয়া যায়নি।' : "Your courses and sections aren't in any uploaded routine yet. They appear once those CRs scan their routines.";
  }
  return bn ? 'তোমার CR এখনো রুটিন আপলোড করেনি।' : "Your CR hasn't uploaded your routine yet.";
}

function answer(q, ctx) {
  const lang = q.lang;
  const day = q.day || ctx.day;
  const date = day === ctx.day ? ctx.date : null;
  const time = q.time || (day === ctx.day ? ctx.time : '09:00');
  const bn = lang === 'bn';

  switch (q.intent) {
    case 'free_rooms': {
      if (q.room) return answer({ ...q, intent: 'room_schedule' }, ctx);
      if (!store.get().classes.length) {
        return { lang, text: bn ? 'এখনো কোনো CR রুটিন আপলোড করেনি, তাই কোন রুম খালি তা নিশ্চিত বলা যাচ্ছে না।' : 'No CR has uploaded a routine yet, so I can\'t tell which rooms are free. Ask your CR to scan the routine.' };
      }
      const list = rooms.freeRooms({ day, time, date, building: q.building, floor: q.floor, minMinutes: q.minMinutes });
      const free = list.filter((r) => r.status === 'free');
      const maybe = list.filter((r) => r.status === 'probably');
      const where = [q.building ? (bn ? `বিল্ডিং ${q.building}` : `Building ${q.building}`) : '', q.floor ? (bn ? `${bnNum(q.floor)} তলা` : `floor ${q.floor}`) : ''].filter(Boolean).join(', ');
      const head = bn
        ? `${D(lang, day)} ${T(lang, time)}${where ? ` (${where})` : ''}: ${bnNum(free.length)}টি রুম খালি।`
        : `${D(lang, day)} ${T(lang, time)}${where ? ` (${where})` : ''}: ${free.length} room${free.length === 1 ? '' : 's'} free.`;
      const lines = free.slice(0, 6).map((r) => (r.until
        ? (bn ? `🟢 ${r.id}: ${T(lang, r.until)} পর্যন্ত খালি` : `🟢 ${r.id}: free until ${T(lang, r.until)}`)
        : (bn ? `🟢 ${r.id}: দিনের বাকি সময় খালি` : `🟢 ${r.id}: free for the rest of the day`)));
      if (maybe.length) lines.push(bn ? `🟡 সম্ভবত খালি (রুটিনে নেই): ${maybe.slice(0, 4).map((r) => r.id).join(', ')}` : `🟡 Probably free (not in any routine yet): ${maybe.slice(0, 4).map((r) => r.id).join(', ')}`);
      if (!free.length && !maybe.length) lines.push(bn ? 'এই সময়ে কোনো খালি রুম পাওয়া যায়নি।' : 'No free rooms found at this time.');
      return { lang, text: [head, ...lines].join('\n'), link: { view: 'rooms', day, time, building: q.building, floor: q.floor } };
    }
    case 'room_schedule': {
      if (q.room) {
        // Direct answer first: is this room free at that time?
        const info = rooms.freeRooms({ day, time, date }).find((r) => r.id === q.room);
        const blocks = rooms.roomDay(q.room, day, date);
        const when = q.time || day !== ctx.day ? `${D(lang, day)} ${T(lang, time)}` : (bn ? 'এখন' : 'now');
        let head;
        if (!info) {
          head = bn ? `${q.room} রুমটি কোনো রুটিনে বা রুমের তালিকায় পাওয়া যায়নি।` : `I couldn't find room ${q.room} in any routine or the room list.`;
        } else if (info.status === 'busy') {
          head = bn
            ? `🔴 ${q.room} ${when} খালি নেই: ${info.current.course} (${info.current.section}) চলছে, ${T(lang, info.until)} পর্যন্ত।`
            : `🔴 ${q.room} is busy ${when}: ${info.current.course} (${info.current.section}) until ${T(lang, info.until)}.`;
        } else {
          const until = info.until ? (bn ? `${T(lang, info.until)} পর্যন্ত` : `until ${T(lang, info.until)}`) : (bn ? 'দিনের বাকি সময়' : 'for the rest of the day');
          head = info.status === 'free'
            ? (bn ? `🟢 হ্যাঁ, ${q.room} ${when} খালি, ${until}।` : `🟢 Yes, ${q.room} is free ${when}, ${until}.`)
            : (bn ? `🟡 ${q.room} সম্ভবত খালি ${until} (কোনো আপলোড করা রুটিনে এই রুম নেই)।` : `🟡 ${q.room} is probably free ${until} (it is not in any uploaded routine yet).`);
        }
        const lines = blocks.map((b) => `• ${T(lang, b.start)}–${T(lang, b.end)}: ${b.course} (${b.section})${b.extra ? (bn ? ' — এক্সট্রা' : ' — extra') : ''}`);
        if (lines.length) lines.unshift(bn ? `${D(lang, day)} এই রুমের ক্লাস:` : `Classes in this room on ${D(lang, day)}:`);
        return { lang, text: [head, ...lines].join('\n'), link: { view: 'rooms', day, time } };
      }
      if (!q.room) return { lang, text: bn ? 'কোন রুমের কথা জানতে চান? যেমন: "C-302 তে আজ কী ক্লাস?"' : 'Which room? For example: "What is in Cx-304 today?"' };
      const blocks = rooms.roomDay(q.room, day, date);
      if (!blocks.length) return { lang, text: bn ? `${D(lang, day)} ${q.room} রুমে কোনো ক্লাস নেই — সারাদিন খালি।` : `${q.room} has no classes on ${D(lang, day)}. It is free all day.` };
      const lines = blocks.map((b) => `• ${T(lang, b.start)}–${T(lang, b.end)}: ${b.course} (${b.section})${b.extra ? (bn ? ' — এক্সট্রা ক্লাস' : ' — extra class') : ''}`);
      return { lang, text: [bn ? `${D(lang, day)} ${q.room} রুমের সময়সূচি:` : `${q.room} on ${D(lang, day)}:`, ...lines].join('\n'), link: { view: 'rooms', day, time } };
    }
    case 'next_class': {
      if (!myClasses(ctx).length) {
        return { lang, text: noRoutine(ctx, bn) };
      }
      const todayList = myClasses(ctx, ctx.day, ctx.date);
      const now = rooms.toMin(ctx.time);
      const current = todayList.find((c) => rooms.toMin(c.start) <= now && now < rooms.toMin(c.end));
      const next = todayList.find((c) => rooms.toMin(c.start) > now);
      const lines = [];
      if (current) lines.push(bn ? `এখন চলছে: ${current.course}, রুম ${current.room} (${T(lang, current.end)} পর্যন্ত)।` : `Now: ${current.course}${ctx.teacher ? ` (${current.section})` : ''} in Room ${current.room} (until ${T(lang, current.end)}).`);
      if (next) lines.push(bn ? `পরের ক্লাস: ${next.course}, ${T(lang, next.start)}, রুম ${next.room}।` : `Next: ${next.course}${ctx.teacher ? ` (${next.section})` : ''} at ${T(lang, next.start)} in Room ${next.room}.`);
      if (!current && !next) lines.push(bn ? 'আজ আপনার আর কোনো ক্লাস নেই। 🎉' : 'No more classes for you today. 🎉');
      return { lang, text: lines.join('\n'), link: { view: 'home' } };
    }
    case 'my_day': {
      const list = myClasses(ctx, day, date);
      if (!myClasses(ctx).length) {
        return { lang, text: noRoutine(ctx, bn) };
      }
      if (!list.length) return { lang, text: bn ? `${D(lang, day)} আপনার কোনো ক্লাস নেই।` : `You have no classes on ${D(lang, day)}.` };
      const lines = list.map((c) => `• ${T(lang, c.start)}: ${c.course}${ctx.teacher ? ` · ${c.dept} ${c.section}` : (c.title ? ` ${c.title}` : '')}, ${bn ? 'রুম' : 'Room'} ${c.room}`);
      return { lang, text: [bn ? `${D(lang, day)} আপনার ক্লাস:` : `Your classes on ${D(lang, day)}:`, ...lines].join('\n'), link: { view: 'home' } };
    }
    case 'course_when': {
      const all = store.get().classes;
      const code = (q.course || '').replace(/[^A-Z0-9]/g, '');
      let list = all.filter((c) => (ctx.teacher ? rooms.isTeachersClass(c, ctx.teacher) : store.sectionKey(c) === ctx.sectionKey) && c.course.replace(/[^A-Z0-9]/g, '') === code);
      if (!list.length) list = all.filter((c) => c.course.replace(/[^A-Z0-9]/g, '') === code);
      if (!code || !list.length) return { lang, text: bn ? 'এই কোর্সটি রুটিনে পাওয়া যায়নি। কোর্স কোড দিয়ে আবার জিজ্ঞেস করুন (যেমন CSE-1121)।' : 'I could not find that course in the routine. Try the course code, e.g. CSE-1121.' };
      const lines = list.slice(0, 8).map((c) => `• ${D(lang, c.day)} ${T(lang, c.start)}–${T(lang, c.end)}, ${bn ? 'রুম' : 'Room'} ${c.room} (${c.section})`);
      return { lang, text: [`${list[0].course}${list[0].title ? ` — ${list[0].title}` : ''}:`, ...lines].join('\n') };
    }
    case 'syllabus': {
      if (ctx.teacher) return { lang, text: bn ? 'সিলেবাস শিক্ষার্থীদের জন্য CR-রা শেয়ার করে। Free Rooms বা তোমার ক্লাস নিয়ে জিজ্ঞেস করো।' : 'Syllabus is shared by CRs for students. Ask me about your classes or free rooms.' };
      const all = store.get().syllabi.filter((s) => store.sectionKey(s) === ctx.sectionKey);
      const code = (q.course || '').replace(/[^A-Z0-9]/g, '');
      let list = all.filter((s) => (!code || s.course.replace(/[^A-Z0-9]/g, '') === code) && (!q.exam || s.exam === q.exam));
      if (!list.length && code) list = all.filter((s) => s.course.replace(/[^A-Z0-9]/g, '').includes(code));
      if (!list.length) {
        return { lang, text: bn ? 'এই কোর্স/পরীক্ষার সিলেবাস তোমার CR এখনো আপলোড করেনি।' : "Your CR hasn't uploaded that syllabus yet.", link: { view: 'syllabus' } };
      }
      const examName = (e) => (e === 'final' ? (bn ? 'ফাইনাল' : 'Final') : (bn ? 'মিড-টার্ম' : 'Mid-term'));
      const parts = list.slice(0, 3).map((s) => [
        `📘 ${s.course} — ${examName(s.exam)}${s.examDate ? ` (${s.examDate})` : ''}:`,
        ...s.topics.slice(0, 12).map((t, i) => `${bn ? bnNum(i + 1) : i + 1}. ${t}`),
      ].join('\n'));
      return { lang, text: parts.join('\n\n'), link: { view: 'syllabus' } };
    }
    case 'notices': {
      if (ctx.teacher) return { lang, text: bn ? 'নোটিশ শিক্ষার্থীদের সেকশনের জন্য। তোমার ক্লাস বা খালি রুম নিয়ে জিজ্ঞেস করো।' : 'Notices are for student sections. Ask me about your classes or free rooms.' };
      const list = store.get().announcements.filter((a) => store.sectionKey(a) === ctx.sectionKey).slice(-3).reverse();
      if (!list.length) return { lang, text: bn ? 'আপনার সেকশনে এখনো কোনো নোটিশ নেই।' : 'No announcements for your section yet.', link: { view: 'notices' } };
      const lines = list.map((a) => `📢 ${a.title}: ${bn && a.body_bn ? a.body_bn : a.body_en}`);
      return { lang, text: lines.join('\n'), link: { view: 'notices' } };
    }
    default:
      return { lang, text: q.answer || (bn ? 'আমি রুটিন, খালি রুম, পরের ক্লাস আর নোটিশ নিয়ে সাহায্য করতে পারি। যেমন: "এখন কোন রুম খালি?"' : 'I can help with your routine, free rooms, next class and notices. Try: "Which rooms are free now?"') };
  }
}

module.exports = { answer };
