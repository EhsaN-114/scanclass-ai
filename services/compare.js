// Routine change detector: old routine vs new routine. Deterministic code, no AI.

const keyOf = (c) => `${c.dept}|${c.semester}|${c.section}|${String(c.course || '').toUpperCase().replace(/\s+/g, '')}`;
const FIELDS = ['day', 'start', 'end', 'room', 'teacher'];
const norm = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');

function diffRoutine(oldList, newList) {
  const groups = new Map();
  for (const c of oldList) {
    const k = keyOf(c);
    if (!groups.has(k)) groups.set(k, { old: [], neu: [] });
    groups.get(k).old.push(c);
  }
  for (const c of newList) {
    const k = keyOf(c);
    if (!groups.has(k)) groups.set(k, { old: [], neu: [] });
    groups.get(k).neu.push(c);
  }

  const changes = [];
  for (const { old, neu } of groups.values()) {
    const olds = old.map((c) => ({ c, used: false }));
    const news = neu.map((c) => ({ c, used: false }));

    // 1) identical entries -> no change
    for (const n of news) {
      const o = olds.find((x) => !x.used && FIELDS.every((f) => norm(x.c[f]) === norm(n.c[f])));
      if (o) o.used = n.used = true;
    }
    // 2) same day -> changed time / room / teacher
    for (const n of news) {
      if (n.used) continue;
      const o = olds.find((x) => !x.used && norm(x.c.day) === norm(n.c.day));
      if (o) {
        o.used = n.used = true;
        changes.push(changeItem(o.c, n.c));
      }
    }
    // 3) remaining pairs -> moved to another day
    for (const n of news) {
      if (n.used) continue;
      const o = olds.find((x) => !x.used);
      if (o) {
        o.used = n.used = true;
        changes.push(changeItem(o.c, n.c));
      } else {
        n.used = true;
        changes.push({ type: 'added', course: n.c.course, section: n.c.section, before: null, after: n.c, fields: [] });
      }
    }
    for (const o of olds) {
      if (!o.used) changes.push({ type: 'removed', course: o.c.course, section: o.c.section, before: o.c, after: null, fields: [] });
    }
  }
  return changes;
}

function changeItem(a, b) {
  const fields = FIELDS.filter((f) => norm(a[f]) !== norm(b[f]));
  return { type: 'changed', course: b.course, section: b.section, before: a, after: b, fields };
}

function describe(ch) {
  const slot = (c) => `${c.day} ${c.start}-${c.end}, Room ${c.room}`;
  if (ch.type === 'added') return `New class: ${ch.course} (${ch.section}) on ${slot(ch.after)}.`;
  if (ch.type === 'removed') return `Removed: ${ch.course} (${ch.section}) on ${slot(ch.before)}.`;
  const parts = [];
  if (ch.fields.includes('day') || ch.fields.includes('start') || ch.fields.includes('end')) {
    parts.push(`time ${ch.before.day} ${ch.before.start} → ${ch.after.day} ${ch.after.start}`);
  }
  if (ch.fields.includes('room')) parts.push(`room ${ch.before.room} → ${ch.after.room}`);
  if (ch.fields.includes('teacher')) parts.push(`teacher ${ch.before.teacher || '?'} → ${ch.after.teacher || '?'}`);
  return `${ch.course} (${ch.section}) changed: ${parts.join(', ')}.`;
}

module.exports = { diffRoutine, describe };
