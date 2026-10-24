/* Home: next class, today's timeline, weekly routine, reminders */

const Home = (() => {
  let week = [];
  let today = null;
  let selectedDay = null;
  let tick = null;

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  async function render() {
    const root = $('#homeBody');
    if (!state.profile) {
      root.innerHTML = `<div class="hello"><h1>Scan once. <span class="grad">Your whole class is sorted.</span></h1><p>Set up your section to see your timetable.</p></div>
        <button class="btn btn-primary" onclick="openSetup(true)">Get started</button>`;
      return;
    }
    if (!root.innerHTML) root.innerHTML = loadingHTML('Loading your day…');
    try {
      const ctx = nowCtx();
      let t, w, n;
      if (isTeacher()) {
        [t, w] = await Promise.all([
          api(`/api/teacher/today?${teacherQuery()}&day=${ctx.day}&date=${ctx.date}&time=${ctx.time}`),
          api(`/api/teacher/classes?${teacherQuery()}`),
        ]);
        n = { announcements: [] };
      } else {
        const key = encodeURIComponent(state.profile.section);
        [t, w, n] = await Promise.all([
          api(`/api/today?section=${key}&day=${ctx.day}&date=${ctx.date}&time=${ctx.time}`),
          api(`/api/classes?section=${key}`),
          api(`/api/announcements?section=${key}`),
        ]);
      }
      today = t;
      week = w.classes;
      selectedDay = selectedDay || ctx.day;
      draw(n.announcements.slice(0, 2));
    } catch (e) {
      root.innerHTML = errorHTML(e.message);
    }
  }

  function draw(notices) {
    const ctx = nowCtx();
    if (!week.length && !today.classes.length) return drawEmpty(notices);
    const now = toMin(ctx.time);
    const live = today.classes.filter((c) => !c.cancelled);
    const current = live.find((c) => toMin(c.start) <= now && now < toMin(c.end));
    const next = live.find((c) => toMin(c.start) > now);
    const days = (state.meta && state.meta.days) || ['Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
    if (!days.includes(selectedDay)) selectedDay = days[0];

    let hero;
    if (current || next) {
      const c = current || next;
      const mins = current ? toMin(c.end) - now : toMin(c.start) - now;
      hero = `<div class="next-card">
        <div class="next-label">${current ? '● Happening now' : 'Next class'}</div>
        <div class="next-course">${esc(c.course)}</div>
        <p class="next-title">${esc(c.title || '')}${c.extra ? ' · Extra class' : ''}</p>
        <div class="next-meta">
          <span><svg><use href="#i-pin"/></svg>Room ${esc(c.room)}</span>
          <span><svg><use href="#i-clock"/></svg>${time12(c.start)} – ${time12(c.end)}</span>
          ${isTeacher() ? `<span><svg><use href="#i-user"/></svg>${esc(c.dept)} · ${esc(c.section)}</span>` : (c.teacher ? `<span><svg><use href="#i-user"/></svg>${esc(c.teacher)}</span>` : '')}
        </div>
        <div class="countdown"><b id="cdNum">${mins}</b><small>${current ? 'min left' : 'min to go'}</small></div>
      </div>`;
    } else {
      const firstTomorrow = nextDayFirst(ctx.day);
      hero = `<div class="next-card">
        <div class="next-label">Today</div>
        <div class="next-course">${today.classes.length ? 'All done for today 🎉' : 'No classes today 🎉'}</div>
        <p class="next-title">${firstTomorrow ? `Next: ${esc(firstTomorrow.course)} on ${DAY_FULL[firstTomorrow.day]} at ${time12(firstTomorrow.start)}, Room ${esc(firstTomorrow.room)}` : 'Enjoy your free time.'}</p>
      </div>`;
    }

    const dayList = week.filter((c) => c.day === selectedDay);
    const isToday = selectedDay === ctx.day;
    const listToShow = isToday ? today.classes : dayList;

    $('#homeBody').innerHTML = `
      <div class="hello"><h1>${greeting()}${isTeacher() && state.profile.name ? ', ' + esc(state.profile.name) : ''} 👋</h1><p>${isTeacher() ? `Teacher · ${teachesLine()}` : esc(sectionLong(state.profile.section))} · ${DAY_FULL[ctx.day]}</p></div>
      ${hero}
      <div class="quick">
        <a href="#rooms"><span class="qi"><svg><use href="#i-door"/></svg></span><b>Free rooms now</b><small>${isTeacher() ? 'For an extra class or meeting' : 'Find a place to study'}</small></a>
        <button id="remindBtn"><span class="qi"><svg><use href="#i-cal"/></svg></span><b>Add reminders</b><small>10 min before each class</small></button>
        ${isTeacher()
          ? '<button id="tNotify"><span class="qi"><svg><use href="#i-bell"/></svg></span><b>Notifications</b><small>Daily plan + class alerts</small></button>'
          : '<a href="#notices"><span class="qi"><svg><use href="#i-bell"/></svg></span><b>Notices</b><small>From your CR</small></a>'}
        <a href="#ask"><span class="qi"><svg><use href="#i-mic"/></svg></span><b>Ask in বাংলা</b><small>Type or speak</small></a>
      </div>

      <div class="section-title"><h3>Weekly routine</h3><span class="muted" style="font-size:12.5px">${week.length} classes / week</span></div>
      <div class="day-tabs">${days.map((d) => `<button data-day="${d}" class="${d === selectedDay ? 'active' : ''}">${d}${d === ctx.day ? ' · Today' : ''}</button>`).join('')}</div>
      <div class="timeline">${listToShow.length ? listToShow.map((c) => tlItem(c, isToday, now)).join('') : `<div class="empty"><p>No classes on ${DAY_FULL[selectedDay]}.</p></div>`}</div>

      ${notices.length ? `<div class="section-title"><h3>Latest notices</h3><a href="#notices">See all</a></div>
      ${notices.map((a) => `<a class="notice" href="#notices" style="display:block"><div class="notice-top"><span class="ntag ${esc(a.tag)}">${esc(a.tag.replace('_', ' '))}</span><h4>${esc(a.title)}</h4></div><p class="${state.lang === 'bn' ? 'bn' : ''}">${esc(state.lang === 'bn' && a.body_bn ? a.body_bn : a.body_en)}</p></a>`).join('')}` : ''}`;

    $$('.day-tabs button').forEach((b) => b.addEventListener('click', () => { selectedDay = b.dataset.day; draw(notices); }));
    $('#remindBtn').addEventListener('click', downloadReminders);
    const tn = $('#tNotify');
    if (tn) tn.addEventListener('click', () => Notices.enable());
  }

  function myCoursesLine() {
    const t = state.profile.teaches || [];
    return t.length ? t.map((x) => `${x.course} ${sectionLabel(x.key).replace(' · ', ' ')}`).join(', ') : (state.profile.code || '');
  }

  function teachesLine() {
    const secs = [...new Set(week.map((c) => `${c.dept} ${c.section}`))];
    return secs.length ? `teaches ${secs.slice(0, 4).join(', ')}${secs.length > 4 ? '…' : ''}` : 'no classes found yet';
  }

  // Nothing uploaded yet for this section
  function drawEmpty(notices) {
    if (isTeacher()) {
      $('#homeBody').innerHTML = `
        <div class="hello"><h1>${greeting()}${state.profile.name ? ', ' + esc(state.profile.name) : ''} 👋</h1><p>Teacher · ${esc(myCoursesLine())}</p></div>
        <div class="next-card">
          <div class="next-label">Your classes</div>
          <div class="next-course" style="padding-right:0">None found yet</div>
          <p class="next-title">Your courses (${esc(myCoursesLine())}) aren't in any uploaded routine yet. They appear automatically as soon as those sections' CRs scan their routines.</p>
        </div>
        <div class="quick">
          <a href="#rooms"><span class="qi"><svg><use href="#i-door"/></svg></span><b>Free rooms now</b><small>For an extra class or meeting</small></a>
          <a href="#ask"><span class="qi"><svg><use href="#i-mic"/></svg></span><b>Ask in বাংলা</b><small>Type or speak</small></a>
        </div>`;
      return;
    }
    $('#homeBody').innerHTML = `
      <div class="hello"><h1>${greeting()} 👋</h1><p>${esc(sectionLong(state.profile.section))}</p></div>
      <div class="next-card">
        <div class="next-label">Your routine</div>
        <div class="next-course" style="padding-right:0">Not uploaded yet</div>
        <p class="next-title">Your CR hasn't shared the class routine for ${esc(sectionLabel(state.profile.section))} yet. Once they scan it, your timetable, next class and reminders appear here automatically.</p>
        <div class="next-meta"><a href="#scan" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.18);font-weight:700;font-size:13.5px">${state.crToken ? 'Scan the routine now →' : 'I\'m the CR, scan it →'}</a></div>
      </div>
      <div class="quick">
        <a href="#rooms"><span class="qi"><svg><use href="#i-door"/></svg></span><b>Free rooms now</b><small>From other classes' routines</small></a>
        <a href="#syllabus"><span class="qi"><svg><use href="#i-book"/></svg></span><b>Syllabus</b><small>Mid-term and final</small></a>
        <a href="#notices"><span class="qi"><svg><use href="#i-bell"/></svg></span><b>Notices</b><small>From your CR</small></a>
        <a href="#ask"><span class="qi"><svg><use href="#i-mic"/></svg></span><b>Ask in বাংলা</b><small>Type or speak</small></a>
      </div>
      ${notices.length ? `<div class="section-title"><h3>Latest notices</h3><a href="#notices">See all</a></div>
      ${notices.map((a) => `<a class="notice" href="#notices" style="display:block"><div class="notice-top"><span class="ntag ${esc(a.tag)}">${esc(a.tag.replace('_', ' '))}</span><h4>${esc(a.title)}</h4></div><p>${esc(state.lang === 'bn' && a.body_bn ? a.body_bn : a.body_en)}</p></a>`).join('')}` : ''}`;
  }

  function tlItem(c, isToday, now) {
    const past = isToday && toMin(c.end) <= now;
    const isNow = isToday && toMin(c.start) <= now && now < toMin(c.end) && !c.cancelled;
    return `<div class="tl-item ${past ? 'past' : ''} ${isNow ? 'now' : ''} ${c.cancelled ? 'cancelled' : ''}">
      <div class="tl-time">${time12(c.start).replace(' ', '&nbsp;')}<small>${time12(c.end)}</small></div>
      <div><div class="tl-course">${esc(c.course)}${c.extra ? '<span class="tag-mini">EXTRA</span>' : ''}${c.cancelled ? '<span class="tag-mini">CANCELLED</span>' : ''}</div>
        <div class="tl-sub">${isTeacher() ? `${esc(c.dept)} · ${esc(c.section)}${c.title ? ' · ' + esc(c.title) : ''}` : `${esc(c.title || '')}${c.teacher ? ' · ' + esc(c.teacher) : ''}`}</div></div>
      <span class="room-tag">${esc(c.room)}</span>
    </div>`;
  }

  function nextDayFirst(day) {
    const order = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    for (let i = 1; i <= 7; i++) {
      const d = order[(order.indexOf(day) + i) % 7];
      const list = week.filter((c) => c.day === d).sort((a, b) => toMin(a.start) - toMin(b.start));
      if (list.length) return list[0];
    }
    return null;
  }

  // ---------- Calendar reminders (.ics) ----------
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n'); }
  function fold(line) {
    const chars = Array.from(line);
    const out = [];
    for (let i = 0; i < chars.length; i += 60) out.push((i ? ' ' : '') + chars.slice(i, i + 60).join(''));
    return out.join('\r\n');
  }
  function downloadReminders() {
    if (!week.length) return toast('No classes to add yet.');
    const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byday = { Sun: 'SU', Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA' };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ScanClass AI//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:ScanClass ' + (isTeacher() ? state.profile.name : sectionLabel(state.profile.section))];
    for (const c of week) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      while (DAY_NAMES[d.getDay()] !== c.day) d.setDate(d.getDate() + 1);
      const ymd = isoDate(d).replace(/-/g, '');
      lines.push('BEGIN:VEVENT',
        `UID:${c.id}-${ymd}@scanclass`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${ymd}T${c.start.replace(':', '')}00`,
        `DTEND:${ymd}T${c.end.replace(':', '')}00`,
        `RRULE:FREQ=WEEKLY;BYDAY=${byday[c.day]};COUNT=14`,
        fold(`SUMMARY:${icsEscape(`📚 ${c.course}${isTeacher() ? ` · ${c.section}` : ""} · Room ${c.room}`)}`),
        fold(`DESCRIPTION:${icsEscape(`${c.title || ''} ${c.teacher ? '· ' + c.teacher : ''}\nFrom ScanClass AI. Check Notices for changes.`)}`),
        fold(`LOCATION:${icsEscape('Room ' + c.room)}`),
        'BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${icsEscape(`${c.course} in Room ${c.room} in 10 minutes`)}`), 'TRIGGER:-PT10M', 'END:VALARM',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scanclass-${isTeacher() ? 'teacher' : state.profile.section.split('|')[2]}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    openModal(`<h3>Reminders downloaded 📅</h3>
      <p class="sub">Open the file to add all ${week.length} weekly classes to your calendar for the semester (14 weeks). Your phone alerts you 10 minutes before each class.</p>
      <div class="block-list"><div><b>iPhone</b><span>Tap the file → Add All</span></div><div><b>Android</b><span>Open with Samsung Calendar, or import at calendar.google.com → Settings → Import</span></div></div>
      <button class="btn btn-primary btn-block" onclick="closeModal()">Got it</button>`);
  }

  function startTick() {
    clearInterval(tick);
    tick = setInterval(() => { if (!$('#view-home').hidden) render(); }, 60000);
  }

  langHooks.push(() => { if (!$('#view-home').hidden) render(); });
  return { render, startTick };
})();
routeHooks.home = () => { Home.render(); Home.startTick(); };
