/* Syllabus: CRs share mid-term / final syllabus per course; students read it */

const Syllabus = (() => {
  let exam = 'mid';
  let list = [];
  let courses = []; // { course, title } of the student's section
  let photos = [];

  $$('.exam-switch .chip').forEach((b) => b.addEventListener('click', () => {
    exam = b.dataset.exam;
    $$('.exam-switch .chip').forEach((x) => x.classList.toggle('active', x === b));
    draw();
    drawCR();
  }));

  async function show() {
    if (!state.profile) {
      $('#syllabusList').innerHTML = `<div class="card empty"><p>Set up your section to see the syllabus.</p></div>`;
      $('#syllabusCR').innerHTML = '';
      return;
    }
    $('#syllabusSub').textContent = `Mid-term and final syllabus for ${sectionLabel(state.profile.section)}, shared by your CR.`;
    $('#syllabusList').innerHTML = loadingHTML('Loading syllabus…');
    try {
      const key = encodeURIComponent(state.profile.section);
      const [s, c] = await Promise.all([api(`/api/syllabus?section=${key}`), api(`/api/classes?section=${key}`)]);
      list = s.syllabi;
      const seen = new Map();
      for (const x of c.classes) if (!seen.has(x.course)) seen.set(x.course, x.title || '');
      for (const x of list) if (!seen.has(x.course)) seen.set(x.course, '');
      courses = [...seen.entries()].map(([course, title]) => ({ course, title })).sort((a, b) => a.course.localeCompare(b.course));
      draw();
      drawCR();
    } catch (e) {
      $('#syllabusList').innerHTML = errorHTML(e.message);
    }
  }

  function niceDate(iso) {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function draw() {
    const items = courses.map(({ course, title }) => {
      const s = list.find((x) => x.course === course && x.exam === exam);
      if (!s) {
        return `<div class="syl missing"><span class="syl-icon"><svg><use href="#i-book"/></svg></span><div><b style="color:var(--text-2)">${esc(course)}</b> <small>${esc(title)}</small><br><small>Not uploaded by your CR yet</small></div></div>`;
      }
      return `<article class="syl">
        <div class="syl-head"><span class="syl-icon"><svg><use href="#i-book"/></svg></span>
          <div><h4>${esc(s.course)}</h4><small>${esc(title || '')}${title ? ' · ' : ''}${s.topics.length} topics · updated ${esc(new Date(s.createdAt).toLocaleDateString())}</small></div>
          ${s.examDate ? `<span class="syl-date">📅 ${esc(niceDate(s.examDate))}</span>` : ''}</div>
        <ol>${s.topics.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        ${s.notes ? `<div class="syl-note">📝 ${esc(s.notes)}</div>` : ''}
        <div class="syl-actions">
          <button class="btn btn-ghost btn-sm" data-speak="${esc(s.id)}"><svg><use href="#i-speaker"/></svg> Listen</button>
          ${state.crToken ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(s.id)}">Edit</button><button class="btn btn-danger btn-sm" data-del="${esc(s.id)}"><svg><use href="#i-trash"/></svg></button>` : ''}
        </div></article>`;
    });
    $('#syllabusList').innerHTML = courses.length
      ? `<div class="syl-grid">${items.join('')}</div>`
      : `<div class="card empty"><svg><use href="#i-book"/></svg><p>No courses found for your section yet.</p></div>`;
  }

  $('#syllabusList').addEventListener('click', async (e) => {
    const sp = e.target.closest('[data-speak]');
    const ed = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (sp) {
      const s = list.find((x) => x.id === sp.dataset.speak);
      Voice.speak(`${s.course} ${s.exam === 'final' ? 'final' : 'mid-term'} syllabus. ${s.topics.map((t, i) => `${i + 1}. ${t}`).join('. ')}`, 'en');
    }
    if (ed) {
      const s = list.find((x) => x.id === ed.dataset.edit);
      drawCR();
      drawForm({ course: s.course, topics: s.topics, examDate: s.examDate, notes: s.notes });
      $('#syllabusCR').scrollIntoView({ behavior: 'smooth' });
    }
    if (del) {
      try {
        await api(`/api/syllabus/${del.dataset.del}`, { method: 'DELETE' });
        toast('Syllabus removed.');
        show();
      } catch (err) { toast(err.message); }
    }
  });

  // ---------- CR: add / update a syllabus ----------
  function drawCR() {
    const box = $('#syllabusCR');
    if (!state.crToken) { box.innerHTML = ''; return; }
    photos = [];
    box.innerHTML = `<div class="card cr-card">
      <div class="card-head"><h3>🛡️ Add ${exam === 'final' ? 'final' : 'mid-term'} syllabus</h3></div>
      <label class="lbl" for="sylCourse">Course</label>
      ${courses.length
        ? `<select id="sylCourse">${courses.map((c) => `<option value="${esc(c.course)}">${esc(c.course)}${c.title ? ' · ' + esc(c.title) : ''}</option>`).join('')}<option value="__other">A course not in the routine…</option></select>`
        : '<select id="sylCourse" hidden><option value="__other"></option></select>'}
      <input type="text" id="sylOther" placeholder="Course code, e.g. CSE-1121" maxlength="30" ${courses.length ? 'hidden style="margin-top:8px"' : ''}>
      ${courses.length ? '' : '<p class="hint" style="text-align:left">Tip: after you scan the class routine, your courses appear here as a list.</p>'}
      <label class="lbl" for="sylText">Paste or type the syllabus</label>
      <textarea id="sylText" maxlength="3000" placeholder="e.g. Ch 1-3, loops, arrays, functions… or add a photo below"></textarea>
      <label class="photo-pick"><input type="file" id="sylPhoto" accept="image/jpeg,image/png,image/webp,application/pdf" hidden><svg><use href="#i-upload"/></svg><span id="sylPhotoName">Or add a photo / PDF of the syllabus</span></label>
      ${driveRowHTML('sylDrive')}
      <div class="actions-bar" style="border:0;padding-top:4px"><p>Gemma 4 turns it into a clean topic list.</p>
        <button class="btn btn-primary" id="sylRead"><svg><use href="#i-spark"/></svg> Read with Gemma</button></div>
      <div id="sylForm"></div></div>`;
    $('#sylCourse').addEventListener('change', (e) => { $('#sylOther').hidden = e.target.value !== '__other'; });
    const takeFile = async (f) => {
      try {
        $('#sylPhotoName').textContent = 'Preparing…';
        photos = await toUploadImages(f);
        $('#sylPhotoName').textContent = `📎 ${f.name}${photos.length > 1 ? ` (${photos.length} pages)` : ''}`;
      } catch (err) {
        $('#sylPhotoName').textContent = 'Or add a photo / PDF of the syllabus';
        toast(err.message, 5000);
      }
    };
    $('#sylPhoto').addEventListener('change', (e) => e.target.files[0] && takeFile(e.target.files[0]));
    wireDriveRow('sylDrive', takeFile);
    $('#sylRead').addEventListener('click', read);
  }

  function chosenCourse() {
    const v = $('#sylCourse').value;
    return v === '__other' ? $('#sylOther').value.trim().toUpperCase() : v;
  }

  async function read() {
    const text = $('#sylText').value.trim();
    if (!text && !photos.length) return toast('Type the syllabus or add a photo.');
    const box = $('#sylForm');
    const btn = $('#sylRead');
    btn.disabled = true;
    box.innerHTML = loadingHTML('Gemma is reading the syllabus…', 'Working 0s');
    const stop = startTimer(box, 'Working');
    try {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('exam', exam);
      photos.forEach((img) => fd.append('image', img));
      const { draft } = await api('/api/syllabus/extract', { method: 'POST', body: fd });
      if (!draft.topics.length) throw new Error('No topics were found. Try a clearer photo or type the topics.');
      drawForm({ course: draft.course || chosenCourse(), topics: draft.topics, examDate: draft.examDate, notes: draft.notes });
    } catch (e) {
      box.innerHTML = errorHTML(e.message) + `<button class="btn btn-ghost btn-sm" style="margin-top:8px" id="sylManual">Type topics myself</button>`;
      $('#sylManual').addEventListener('click', () => drawForm({ course: chosenCourse(), topics: text ? text.split(/\n|,/).map((t) => t.trim()).filter(Boolean) : [], examDate: null, notes: null }));
    } finally {
      stop();
      btn.disabled = false;
    }
  }

  function drawForm(d) {
    $('#sylForm').innerHTML = `<div class="draft">
      <label class="lbl">Course</label><input type="text" id="fCourse" maxlength="30" value="${esc(d.course || '')}">
      <label class="lbl">Topics (one per line)</label><textarea id="fTopics" rows="8">${esc((d.topics || []).join('\n'))}</textarea>
      <div class="grid-2"><div><label class="lbl">Exam date (optional)</label><input type="date" id="fDate" value="${esc(d.examDate || '')}"></div>
      <div><label class="lbl">Exam</label><input type="text" value="${exam === 'final' ? 'Final' : 'Mid-term'}" disabled></div></div>
      <label class="lbl">Note (optional)</label><input type="text" id="fNotes" maxlength="300" value="${esc(d.notes || '')}" placeholder="e.g. 1 hour, bring calculator">
      <p class="hint" style="text-align:left">Check every topic before sharing.</p>
      <button class="btn btn-primary btn-block" id="fSave"><svg><use href="#i-send"/></svg> Share with class</button></div>`;
    $('#fSave').addEventListener('click', async () => {
      const body = {
        course: $('#fCourse').value.trim(),
        exam,
        topics: $('#fTopics').value.split('\n').map((t) => t.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean),
        examDate: $('#fDate').value || null,
        notes: $('#fNotes').value.trim() || null,
      };
      if (!body.course) return toast('Enter the course code.');
      if (!body.topics.length) return toast('Add at least one topic.');
      $('#fSave').disabled = true;
      try {
        const r = await api('/api/syllabus', { method: 'POST', json: body });
        toast(r.updated ? 'Syllabus updated ✓ Class notified.' : 'Syllabus shared ✓ Class notified.');
        show();
      } catch (e) {
        toast(e.message);
        $('#fSave').disabled = false;
      }
    });
  }

  return { show };
})();
routeHooks.syllabus = () => Syllabus.show();
