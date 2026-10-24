/* First-time setup, profile and CR login */

function sectionPickerHTML(selected) {
  const secs = state.meta ? state.meta.sections : [];
  const depts = [...new Set(secs.map((s) => s.dept))];
  const [d0, s0, x0] = (selected || '').split('|');
  const dept = d0 || depts[0] || '';
  const sems = [...new Set(secs.filter((s) => s.dept === dept).map((s) => s.semester))];
  const sem = s0 && sems.includes(s0) ? s0 : sems[0];
  const sections = secs.filter((s) => s.dept === dept && s.semester === sem);
  return `
    <div class="grid-2">
      <div><label class="lbl" for="pDept">Department</label>
        <select id="pDept">${depts.map((d) => `<option ${d === dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
      <div><label class="lbl" for="pSem">Semester</label>
        <select id="pSem">${sems.map((s) => `<option value="${esc(s)}" ${s === sem ? 'selected' : ''}>Semester ${esc(s)}</option>`).join('')}</select></div>
    </div>
    <label class="lbl" for="pSec">Section</label>
    <select id="pSec">${sections.map((s) => `<option value="${esc(s.key)}" ${s.section === x0 ? 'selected' : ''}>${esc(s.section)}</option>`).join('')}</select>`;
}

function wirePicker(root) {
  const redraw = (key) => {
    const box = $('#pickerBox', root);
    box.innerHTML = sectionPickerHTML(key);
    wirePicker(root);
  };
  $('#pDept', root).addEventListener('change', (e) => redraw(`${e.target.value}||`));
  $('#pSem', root).addEventListener('change', (e) => redraw(`${$('#pDept', root).value}|${e.target.value}|`));
}

function openSetup(force, role) {
  const p = state.profile || {};
  role = role || (p.role === 'teacher' ? 'teacher' : 'student');
  const roleSwitch = `<div class="role-switch" role="group" aria-label="I am a">
      <button data-role="student" class="${role === 'student' ? 'active' : ''}">🎓 Student / CR</button>
      <button data-role="teacher" class="${role === 'teacher' ? 'active' : ''}">👩‍🏫 Teacher</button></div>`;
  if (role === 'teacher') return openTeacherSetup(force, roleSwitch);
  openModal(`
    <div class="welcome-art"><svg><use href="#i-scan"/></svg></div>
    <h3 id="modalTitle">${force ? 'Welcome to ScanClass' : 'My profile'}</h3>
    ${roleSwitch}
    <p class="sub">Pick your section once. You'll only see your classes and your CR's notices.</p>
    <label class="lbl" for="pId">Student ID</label>
    <input type="text" id="pId" placeholder="e.g. C999001" value="${esc(p.studentId || '')}" maxlength="12" autocomplete="off">
    <div id="pickerBox">${sectionPickerHTML(p.section)}</div>
    <button class="btn btn-primary btn-block" id="pSave">Continue</button>
    <p class="hint">Your ID stays on this phone. Use a sample ID for demos.</p>
    ${!force && p.role !== 'teacher' && p.section ? `<div class="divider"></div>${crBlockHTML()}` : ''}`, { closable: !force });
  const body = $('#modalBody');
  wireRoleSwitch(body, force);
  wirePicker(body);
  $('#pSave').addEventListener('click', () => {
    const id = $('#pId').value.trim().toUpperCase();
    const section = $('#pSec').value;
    if (!/^[A-Z]{0,3}\d{4,9}$/.test(id)) return toast('Enter a valid student ID, e.g. C999001.');
    if (!section) return toast('Choose your section.');
    const changed = !state.profile || state.profile.section !== section;
    state.profile = { role: 'student', studentId: id, section };
    store.set('profile', state.profile);
    if (changed && state.crToken) logoutCR(true);
    closeModal();
    renderProfileChip();
    toast(`Welcome! Showing ${sectionLabel(section)}.`);
    route();
    if (window.Notices) { Notices.refresh(); Notices.startPolling(); }
  });
  wireCR(body);
}

function wireRoleSwitch(root, force) {
  $$('.role-switch button', root).forEach((b) => b.addEventListener('click', () => openSetup(force, b.dataset.role)));
}

// Teachers add the courses + sections they teach (e.g. CSE-1121 → CSE 2BM).
// Initials from the routine are optional extra matching.
async function openTeacherSetup(force, roleSwitch) {
  const p = state.profile && state.profile.role === 'teacher' ? state.profile : {};
  let teaches = (p.teaches || []).slice();
  openModal(`
    <div class="welcome-art"><svg><use href="#i-user"/></svg></div>
    <h3 id="modalTitle">${force ? 'Welcome to ScanClass' : 'My profile'}</h3>
    ${roleSwitch}
    <p class="sub">Add the courses you teach and their sections. ScanClass finds those classes in the routine.</p>
    <label class="lbl" for="tName">Your name</label>
    <input type="text" id="tName" maxlength="40" placeholder="e.g. Dr. Rahman" value="${esc(p.name || '')}">
    <label class="lbl">My courses and sections</label>
    <div id="tList"></div>
    <div class="card" style="padding:12px;margin-top:8px">
      <div id="tPicker">${sectionPickerHTML('')}</div>
      <label class="lbl" for="tCourse">Course code</label>
      <input type="text" id="tCourse" list="tCourseList" maxlength="20" placeholder="e.g. CSE-1121" autocomplete="off">
      <datalist id="tCourseList"></datalist>
      <button class="btn btn-ghost btn-block" id="tAdd" style="margin-top:10px"><svg><use href="#i-plus"/></svg> Add this course</button>
    </div>
    <details class="pin-change"><summary>Optional: my initials in the routine</summary>
      <input type="text" id="tCode" maxlength="12" placeholder="e.g. ABM" value="${esc(p.code || '')}" autocomplete="off" style="margin-top:10px">
      <p class="hint" style="text-align:left">Also shows classes printed with these initials.</p>
    </details>
    <button class="btn btn-primary btn-block" id="tSave">Continue</button>`, { closable: !force });
  const body = $('#modalBody');
  wireRoleSwitch(body, force);

  const drawList = () => {
    $('#tList').innerHTML = teaches.length
      ? teaches.map((t, i) => `<span class="sec-chip">${esc(t.course)} · ${esc(sectionLabel(t.key))} <button class="icon-btn" data-rm="${i}" aria-label="Remove" style="padding:0 0 0 4px">✕</button></span>`).join('')
      : '<p class="hint" style="text-align:left;margin:0">No courses added yet.</p>';
  };
  $('#tList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { teaches.splice(+b.dataset.rm, 1); drawList(); }
  });
  const loadCourses = async () => {
    const key = $('#pSec', body).value;
    try {
      const { courses } = await api(`/api/section/courses?section=${encodeURIComponent(key)}`);
      $('#tCourseList').innerHTML = courses.map((c) => `<option value="${esc(c.course)}">${esc(c.title)}</option>`).join('');
    } catch (_) { /* suggestions only */ }
  };
  // Re-wire the department/semester/section picker inside the teacher box
  const wireTPicker = () => {
    const redraw = (key) => { $('#tPicker').innerHTML = sectionPickerHTML(key); wireTPicker(); loadCourses(); };
    $('#pDept', body).addEventListener('change', (e) => redraw(`${e.target.value}||`));
    $('#pSem', body).addEventListener('change', (e) => redraw(`${$('#pDept', body).value}|${e.target.value}|`));
    $('#pSec', body).addEventListener('change', loadCourses);
  };
  wireTPicker();
  loadCourses();
  drawList();

  $('#tAdd').addEventListener('click', () => {
    const key = $('#pSec', body).value;
    const course = $('#tCourse').value.trim().toUpperCase().replace(/\s+/g, '-');
    if (!key) return toast('Choose the section.');
    if (!/^[A-Z]{2,5}-?\d{3,4}[A-Z]?$/.test(course)) return toast('Enter a course code like CSE-1121.');
    if (teaches.some((t) => t.key === key && t.course === course)) return toast('Already added.');
    teaches.push({ key, course });
    $('#tCourse').value = '';
    drawList();
  });

  $('#tSave').addEventListener('click', () => {
    const name = $('#tName').value.trim().slice(0, 40);
    const code = $('#tCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!name) return toast('Enter your name.');
    if (!teaches.length && !code) return toast('Add at least one course and section.');
    if (state.crToken) logoutCR(true);
    state.profile = { role: 'teacher', name, code, teaches };
    store.set('profile', state.profile);
    closeModal();
    renderProfileChip();
    toast(`Welcome, ${name}!`);
    route();
    if (window.Notices) Notices.startPolling();
  });
}

function crBlockHTML() {
  if (state.crToken) {
    return `<p class="sub">🛡️ You are logged in as <b>CR of ${esc(sectionLabel(state.profile.section))}</b>.</p>
      <details class="pin-change"><summary>Change my CR PIN</summary>
        <label class="lbl" for="pinCur">Current PIN</label><input type="password" id="pinCur" inputmode="numeric" maxlength="8">
        <label class="lbl" for="pinNew">New PIN (4–8 digits)</label><input type="password" id="pinNew" inputmode="numeric" maxlength="8">
        <label class="lbl" for="pinNew2">New PIN again</label><input type="password" id="pinNew2" inputmode="numeric" maxlength="8">
        <button class="btn btn-ghost btn-block" id="pinSave">Save new PIN</button>
      </details>
      <button class="btn btn-ghost btn-block" id="crLogout"><svg><use href="#i-logout"/></svg> Log out as CR</button>`;
  }
  return `<h3 style="font-size:17px">Are you the CR?</h3>
    <p class="sub">Log in to post notices, upload the routine and mark cancelled or extra classes.</p>
    <label class="lbl" for="crPin">CR PIN for ${esc(sectionLabel(state.profile && state.profile.section))}</label>
    <input type="password" id="crPin" inputmode="numeric" maxlength="12" placeholder="PIN">
    <button class="btn btn-ghost btn-block" id="crLogin"><svg><use href="#i-shield"/></svg> Log in as CR</button>
    <p class="hint">CRs get their PIN from the department admin. <a class="link" href="#admin" onclick="closeModal()">Admin page</a></p>`;
}

function wireCR(root) {
  const login = $('#crLogin', root);
  if (login) {
    login.addEventListener('click', async () => {
      const pin = $('#crPin', root).value.trim();
      if (!pin) return toast('Enter the CR PIN.');
      login.disabled = true;
      try {
        const data = await api('/api/cr/login', { method: 'POST', json: { section: state.profile.section, pin } });
        state.crToken = data.token;
        store.set('crToken', data.token);
        closeModal();
        renderProfileChip();
        toast('Logged in as CR ✓');
        route();
      } catch (e) {
        toast(e.message);
      } finally {
        login.disabled = false;
      }
    });
  }
  const pinSave = $('#pinSave', root);
  if (pinSave) {
    pinSave.addEventListener('click', async () => {
      const cur = $('#pinCur', root).value.trim();
      const nw = $('#pinNew', root).value.trim();
      if (nw !== $('#pinNew2', root).value.trim()) return toast('The new PINs do not match.');
      pinSave.disabled = true;
      try {
        await api('/api/cr/pin', { method: 'POST', json: { current: cur, next: nw } });
        toast('PIN changed ✓ Other devices were logged out.');
        closeModal();
      } catch (e) {
        toast(e.message);
      } finally {
        pinSave.disabled = false;
      }
    });
  }
  const out = $('#crLogout', root);
  if (out) out.addEventListener('click', () => { logoutCR(); closeModal(); route(); });
}

async function logoutCR(silent) {
  try { await api('/api/cr/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  state.crToken = null;
  store.del('crToken');
  renderProfileChip();
  if (!silent) toast('Logged out as CR.');
}

function renderProfileChip() {
  const chip = $('#profileBtn');
  $('#profileLabel').textContent = profileLabel();
  chip.classList.toggle('cr', !!state.crToken);
}
window.renderProfileChip = renderProfileChip;

$('#profileBtn').addEventListener('click', () => openSetup(!state.profile));
