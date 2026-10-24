/* Notices: CR announcements, Gemma-written drafts, cancel/extra class, notifications */

const Notices = (() => {
  let list = [];
  let polling = null;
  let swReg = null;
  let draftImages = [];
  let crTab = 'post';

  const lastSeen = () => store.get('seen.' + (state.profile && state.profile.section), '');
  const setSeen = (iso) => store.set('seen.' + state.profile.section, iso);

  async function fetchList() {
    if (!state.profile) return [];
    const data = await api(`/api/announcements?section=${encodeURIComponent(state.profile.section)}`);
    return data.announcements;
  }

  // Poll for new notices and notify
  async function refresh() {
    if (!state.profile || isTeacher()) return; // teachers get daily plans and class alerts by push
    try {
      const fresh = await fetchList();
      const seen = lastSeen();
      const newer = fresh.filter((a) => a.createdAt > seen);
      if (seen && newer.length) {
        newer.slice(0, 3).forEach(notify);
      }
      if (!seen && fresh[0]) setSeen(fresh[0].createdAt); // first visit: don't spam old notices
      list = fresh;
      $('#noticeBadge').hidden = !(list[0] && list[0].createdAt > lastSeen());
      if (!$('#view-notices').hidden) drawList();
    } catch (_) { /* offline: try again next time */ }
  }

  function textOf(a) { return state.lang === 'bn' && a.body_bn ? a.body_bn : a.body_en; }

  // Fallback for browsers without Web Push: show a notification while the app is open
  async function notify(a) {
    if (store.get('pushOn', false)) return; // real push already delivers it to the phone
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const body = textOf(a);
      if (swReg) await swReg.showNotification(`📢 ${a.title}`, { body, tag: a.id });
      else new Notification(`📢 ${a.title}`, { body, tag: a.id });
    } catch (_) { /* some browsers block notifications */ }
  }

  function urlB64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  // Real phone notifications (notification panel, even when the app is closed)
  async function subscribePush(silent) {
    if (!state.profile || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      let sub = await swReg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await api('/api/push/key');
        sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      }
      await api('/api/push/subscribe', { method: 'POST', json: { subscription: sub.toJSON(), section: state.profile.section, teacher: isTeacher() ? teacherSpec() : undefined, lang: state.lang } });
      store.set('pushOn', true);
      store.set('pushEndpoint', sub.endpoint);
      return true;
    } catch (e) {
      store.set('pushOn', false);
      if (!silent) toast('Phone notifications are not supported here. You will still see notices in the app.', 5000);
      return false;
    }
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  async function enableNotifications() {
    if (isIOS && !isStandalone) {
      openModal(`<h3>Add ScanClass to your Home Screen</h3>
        <p class="sub">On iPhone, notifications work after you install the app:</p>
        <div class="block-list"><div><span>1. Tap the <b>Share</b> button in Safari</span></div><div><span>2. Tap <b>Add to Home Screen</b></span></div><div><span>3. Open ScanClass from the Home Screen and turn on notifications</span></div></div>
        <button class="btn btn-primary btn-block" onclick="closeModal()">OK</button>`);
      return;
    }
    if (!('Notification' in window)) return toast('This browser does not support notifications.');
    const p = await Notification.requestPermission();
    if (p !== 'granted') return toast('Notifications are blocked. Allow them in your browser settings.', 5000);
    const ok = await subscribePush(false);
    if (!ok) { try { swReg = await navigator.serviceWorker.register('sw.js'); } catch (_) { /* page notifications only */ } }
    store.set('notify', true);
    drawNotifyBtn();
    if (ok) {
      toast('Notifications on ✓ Sending a test…');
      api('/api/push/test', { method: 'POST', json: { endpoint: store.get('pushEndpoint', '') } }).catch(() => {});
    }
  }

  function drawNotifyBtn() {
    const on = 'Notification' in window && Notification.permission === 'granted';
    const b = $('#notifyBtn');
    b.innerHTML = on ? '<svg><use href="#i-bell"/></svg> Notifications on' : '<svg><use href="#i-bell"/></svg> Turn on notifications';
    b.disabled = on;
  }

  function startPolling() {
    clearInterval(polling);
    polling = setInterval(refresh, 30000);
    // Keep the phone's subscription linked to the current section and language
    if ('Notification' in window && Notification.permission === 'granted') subscribePush(true);
  }

  // ---------- Feed ----------
  async function show() {
    drawNotifyBtn();
    if (!state.profile) {
      $('#noticeList').innerHTML = `<div class="card empty"><p>Set up your section to see notices.</p></div>`;
      $('#crPanel').innerHTML = '';
      return;
    }
    $('#noticeSub').textContent = `Announcements from the CR of ${sectionLabel(state.profile.section)}.`;
    drawCR();
    $('#noticeList').innerHTML = loadingHTML('Loading notices…');
    try {
      list = await fetchList();
      drawList();
    } catch (e) {
      $('#noticeList').innerHTML = errorHTML(e.message);
    }
  }

  function drawList() {
    const seen = lastSeen();
    $('#noticeList').innerHTML = list.length ? list.map((a) => `
      <article class="notice ${a.createdAt > seen ? 'fresh' : ''}">
        <div class="notice-top"><span class="ntag ${esc(a.tag)}">${esc(a.tag.replace('_', ' '))}</span><h4>${esc(a.title)}</h4></div>
        <p class="${state.lang === 'bn' && a.body_bn ? 'bn' : ''}">${esc(textOf(a))}</p>
        <span class="when">${a.auto ? '⚙️ Auto update · ' : '🛡️ CR · '}${esc(new Date(a.createdAt).toLocaleString())}</span>
        <div class="notice-actions">
          <button class="btn btn-ghost btn-sm" data-speak="${esc(a.id)}"><svg><use href="#i-speaker"/></svg> Listen</button>
          ${a.event ? `<button class="btn btn-ghost btn-sm" data-cal="${esc(a.id)}"><svg><use href="#i-cal"/></svg> Add to calendar</button>` : ''}
          ${state.crToken ? `<button class="btn btn-danger btn-sm" data-del="${esc(a.id)}"><svg><use href="#i-trash"/></svg></button>` : ''}
        </div>
      </article>`).join('') : `<div class="card empty"><svg><use href="#i-bell"/></svg><p>No notices yet.</p></div>`;
    if (list[0]) {
      setSeen(list[0].createdAt);
      $('#noticeBadge').hidden = true;
    }
  }

  $('#noticeList').addEventListener('click', async (e) => {
    const sp = e.target.closest('[data-speak]');
    const cal = e.target.closest('[data-cal]');
    const del = e.target.closest('[data-del]');
    if (sp) {
      const a = list.find((x) => x.id === sp.dataset.speak);
      Voice.speak(`${a.title}. ${textOf(a)}`, state.lang === 'bn' && a.body_bn ? 'bn' : 'en');
    }
    if (cal) addToCalendar(list.find((x) => x.id === cal.dataset.cal));
    if (del) {
      try {
        await api(`/api/announcements/${del.dataset.del}`, { method: 'DELETE' });
        list = list.filter((x) => x.id !== del.dataset.del);
        drawList();
        toast('Notice deleted.');
      } catch (err) { toast(err.message); }
    }
  });

  function addToCalendar(a) {
    const start = a.event.time || '09:00';
    const ymd = a.event.date.replace(/-/g, '');
    const [h, m] = start.split(':').map(Number);
    const endH = String(Math.min(23, h + 1)).padStart(2, '0');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ScanClass AI//EN', 'BEGIN:VEVENT', `UID:${a.id}@scanclass`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
      a.event.time ? `DTSTART:${ymd}T${start.replace(':', '')}00` : `DTSTART;VALUE=DATE:${ymd}`,
      a.event.time ? `DTEND:${ymd}T${endH}${String(m).padStart(2, '0')}00` : `DTEND;VALUE=DATE:${ymd}`,
      `SUMMARY:${a.title.replace(/[,;]/g, ' ')}`, `DESCRIPTION:${a.body_en.replace(/[,;]/g, ' ').replace(/\n/g, ' ')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    link.download = 'scanclass-notice.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('Calendar file downloaded. Open it to add the reminder.');
  }

  // ---------- CR panel ----------
  function drawCR() {
    const box = $('#crPanel');
    if (!state.crToken) {
      box.innerHTML = `<div class="card cr-card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><p style="margin:0;flex:1;min-width:200px;color:var(--text-2)">Are you the CR? Log in to post notices for your class.</p><button class="btn btn-ghost btn-sm" id="crOpen"><svg><use href="#i-shield"/></svg> CR login</button></div>`;
      $('#crOpen').addEventListener('click', () => openSetup(false));
      return;
    }
    box.innerHTML = `<div class="card cr-card">
      <div class="card-head"><h3>🛡️ CR panel · ${esc(sectionLabel(state.profile.section))}</h3></div>
      <div class="cr-tabs"><button class="chip ${crTab === 'post' ? 'active' : ''}" data-tab="post">✨ New notice</button><button class="chip ${crTab === 'class' ? 'active' : ''}" data-tab="class">Cancel / extra class</button></div>
      <div id="crBody"></div></div>`;
    $$('.cr-tabs .chip', box).forEach((b) => b.addEventListener('click', () => { crTab = b.dataset.tab; drawCR(); }));
    if (crTab === 'post') drawPost(); else drawClassTools();
  }

  function drawPost() {
    draftImages = [];
    $('#crBody').innerHTML = `
      <textarea id="crText" maxlength="1000" placeholder="Type quickly, e.g. kal CSE-1121 class 11:30 e hobe room 405 e"></textarea>
      <label class="photo-pick"><input type="file" id="crPhoto" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><svg><use href="#i-upload"/></svg><span id="crPhotoName">Or add a photo / PDF of a notice</span></label>
      ${driveRowHTML('crDrive')}
      <div class="actions-bar" style="border:0;padding-top:4px"><p>Gemma 4 turns it into a clean notice in English and বাংলা.</p>
        <button class="btn btn-primary" id="draftBtn"><svg><use href="#i-spark"/></svg> Write with Gemma</button></div>
      <div id="draftBox"></div>`;
    const takeFile = async (f) => {
      try {
        $('#crPhotoName').textContent = 'Preparing…';
        draftImages = await toUploadImages(f);
        $('#crPhotoName').textContent = `📎 ${f.name}${draftImages.length > 1 ? ` (${draftImages.length} pages)` : ''}`;
      } catch (err) {
        $('#crPhotoName').textContent = 'Or add a photo / PDF of a notice';
        toast(err.message, 5000);
      }
    };
    $('#crPhoto').addEventListener('change', (e) => e.target.files[0] && takeFile(e.target.files[0]));
    wireDriveRow('crDrive', takeFile);
    $('#draftBtn').addEventListener('click', makeDraft);
  }

  async function makeDraft() {
    const text = $('#crText').value.trim();
    if (!text && !draftImages.length) return toast('Type a message or add a notice photo.');
    const box = $('#draftBox');
    const btn = $('#draftBtn');
    btn.disabled = true;
    box.innerHTML = loadingHTML('Gemma is writing the notice…', 'Working 0s');
    const stop = startTimer(box, 'Working');
    try {
      const fd = new FormData();
      fd.append('text', text);
      draftImages.forEach((img) => fd.append('image', img));
      const { draft } = await api('/api/announce/draft', { method: 'POST', body: fd });
      drawDraft(draft);
    } catch (e) {
      box.innerHTML = errorHTML(e.message) + `<button class="btn btn-ghost btn-sm" style="margin-top:8px" id="manualBtn">Write it myself</button>`;
      $('#manualBtn').addEventListener('click', () => drawDraft({ title: '', body_en: text, body_bn: '', tag: 'info', event: null }));
    } finally {
      stop();
      btn.disabled = false;
    }
  }

  function drawDraft(d) {
    const tags = ['info', 'exam', 'class_change', 'cancel', 'assignment', 'event'];
    $('#draftBox').innerHTML = `<div class="draft">
      <label class="lbl">Title</label><input type="text" id="dTitle" maxlength="80" value="${esc(d.title)}">
      <label class="lbl">English</label><textarea id="dEn" maxlength="800">${esc(d.body_en)}</textarea>
      <label class="lbl">বাংলা</label><textarea id="dBn" class="bn" maxlength="1000">${esc(d.body_bn || '')}</textarea>
      <div class="grid-2"><div><label class="lbl">Type</label><select id="dTag">${tags.map((t) => `<option value="${t}" ${t === d.tag ? 'selected' : ''}>${t.replace('_', ' ')}</option>`).join('')}</select></div>
      <div><label class="lbl">Date (optional)</label><input type="date" id="dDate" value="${esc(d.event ? d.event.date : '')}"></div></div>
      <label class="lbl">Time (optional)</label><input type="time" id="dTime" value="${esc(d.event && d.event.time ? d.event.time : '')}">
      <p class="hint" style="text-align:left">Check the facts (course, room, date) before posting.</p>
      <button class="btn btn-primary btn-block" id="postBtn"><svg><use href="#i-send"/></svg> Post to class</button></div>`;
    $('#postBtn').addEventListener('click', async () => {
      const date = $('#dDate').value;
      const body = { title: $('#dTitle').value, body_en: $('#dEn').value, body_bn: $('#dBn').value, tag: $('#dTag').value, event: date ? { date, time: $('#dTime').value || null } : null };
      if (!body.body_en.trim()) return toast('The English text is empty.');
      $('#postBtn').disabled = true;
      try {
        await api('/api/announcements', { method: 'POST', json: body });
        toast('Posted ✓ Your class will be notified.');
        drawPost();
        list = await fetchList();
        drawList();
      } catch (e) {
        toast(e.message);
        $('#postBtn').disabled = false;
      }
    });
  }

  async function drawClassTools() {
    const n = nowCtx();
    $('#crBody').innerHTML = `
      <div class="grid-2"><div><label class="lbl">Date</label><input type="date" id="oDate" value="${n.date}"></div>
      <div><label class="lbl">Action</label><select id="oType"><option value="cancel">Cancel a class</option><option value="extra">Book an extra class</option></select></div></div>
      <div id="oFields"></div>
      <button class="btn btn-primary btn-block" id="oSave"><svg><use href="#i-send"/></svg> Save &amp; notify class</button>`;
    const fields = async () => {
      const date = $('#oDate').value;
      const day = DAY_NAMES[new Date(date + 'T12:00:00').getDay()];
      if ($('#oType').value === 'cancel') {
        const { classes } = await api(`/api/classes?section=${encodeURIComponent(state.profile.section)}`);
        const todays = classes.filter((c) => c.day === day);
        $('#oFields').innerHTML = `<label class="lbl">Class on ${DAY_FULL[day]}</label>${todays.length
          ? `<select id="oClass">${todays.map((c) => `<option value="${esc(c.id)}">${time12(c.start)} · ${esc(c.course)} · Room ${esc(c.room)}</option>`).join('')}</select>`
          : '<p class="hint" style="text-align:left">No classes on this day.</p>'}`;
      } else {
        $('#oFields').innerHTML = `
          <label class="lbl">Course</label><input type="text" id="oCourse" placeholder="CSE-1121" maxlength="30">
          <div class="grid-2"><div><label class="lbl">Start</label><input type="time" id="oStart" value="13:30"></div><div><label class="lbl">End</label><input type="time" id="oEnd" value="14:50"></div></div>
          <label class="lbl">Room</label><div style="display:flex;gap:8px"><select id="oRoom"><option value="">Find a free room →</option></select><button class="btn btn-ghost btn-sm" id="oFind" type="button">Find</button></div>`;
        $('#oFind').addEventListener('click', async () => {
          const s = $('#oStart').value;
          const e2 = $('#oEnd').value;
          if (!s || !e2) return toast('Set start and end time first.');
          const data = await api(`/api/rooms/free?day=${day}&time=${s}&date=${date}&min=${toMin(e2) - toMin(s)}`);
          const free = data.rooms.filter((r) => r.status !== 'busy');
          $('#oRoom').innerHTML = free.map((r) => `<option value="${esc(r.id)}">${esc(r.id)} · ${r.status === 'free' ? 'free' : 'probably free'}${r.until ? ' until ' + time12(r.until) : ''}</option>`).join('') || '<option value="">No free room</option>';
          toast(`${free.length} rooms are free for that slot.`);
        });
      }
    };
    $('#oType').addEventListener('change', fields);
    $('#oDate').addEventListener('change', fields);
    await fields();
    $('#oSave').addEventListener('click', async () => {
      const type = $('#oType').value;
      const body = { type, date: $('#oDate').value };
      if (type === 'cancel') {
        if (!$('#oClass')) return toast('No class to cancel on this day.');
        body.classId = $('#oClass').value;
      } else {
        Object.assign(body, { course: $('#oCourse').value, start: $('#oStart').value, end: $('#oEnd').value, room: $('#oRoom').value });
      }
      try {
        await api('/api/overrides', { method: 'POST', json: body });
        toast(type === 'cancel' ? 'Class cancelled ✓ Room is now free and the class is notified.' : 'Extra class booked ✓ Class notified.', 4500);
        list = await fetchList();
        drawList();
      } catch (e) {
        toast(e.message, 5000);
      }
    });
  }

  $('#notifyBtn').addEventListener('click', enableNotifications);
  langHooks.push(() => {
    if (!$('#view-notices').hidden) drawList();
    if ('Notification' in window && Notification.permission === 'granted') subscribePush(true); // notifications in the new language
  });
  return { show, refresh, startPolling, subscribePush, enable: enableNotifications };
})();
routeHooks.notices = () => Notices.show();
