/* ScanClass AI — shared helpers, state and router */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('scanclass.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('scanclass.' + key, JSON.stringify(value)); } catch (_) { /* private mode */ }
  },
  del(key) {
    try { localStorage.removeItem('scanclass.' + key); } catch (_) { /* ignore */ }
  },
};

const state = {
  meta: null,                                   // sections, rooms, buildings
  profile: store.get('profile', null),          // { studentId, section }
  crToken: store.get('crToken', null),
  lang: store.get('lang', 'en'),
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = { Sat: 'Saturday', Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };
const DAY_BN = { Sat: 'শনিবার', Sun: 'রবিবার', Mon: 'সোমবার', Tue: 'মঙ্গলবার', Wed: 'বুধবার', Thu: 'বৃহস্পতিবার', Fri: 'শুক্রবার' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
function time12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// The phone's current day/date/time (sent to the server so answers match the student's clock)
function nowCtx() {
  const d = new Date();
  return { day: DAY_NAMES[d.getDay()], date: isoDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
const isTeacher = () => !!(state.profile && state.profile.role === 'teacher');
// What the server needs to find a teacher's classes
function teacherSpec() {
  const p = state.profile || {};
  return { code: p.code || '', teaches: (p.teaches || []).map((t) => ({ key: t.key, course: t.course })) };
}
const teacherQuery = () => `t=${encodeURIComponent(JSON.stringify(teacherSpec()))}`;
function profileLabel() {
  if (!state.profile) return 'Set up';
  if (isTeacher()) return `${state.profile.name || state.profile.code || 'Teacher'} · Teacher`;
  return `${sectionLabel(state.profile.section)}${state.crToken ? ' · CR' : ''}`;
}
function sectionLabel(key) {
  if (!key) return '';
  const [dept, sem, sec] = key.split('|');
  return `${dept} · ${sec}`;
}
function sectionLong(key) {
  const [dept, sem, sec] = (key || '||').split('|');
  return `${dept} · Semester ${sem} · Section ${sec}`;
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.crToken) headers['x-cr-token'] = state.crToken;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (_) {
    throw new Error('Cannot reach the ScanClass server. Check your internet.');
  }
  let data = {};
  try { data = await res.json(); } catch (_) { /* not JSON */ }
  if (res.status === 401 && state.crToken && url !== '/api/cr/login') {
    state.crToken = null;
    store.del('crToken');
    if (window.renderProfileChip) renderProfileChip();
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

const loadingHTML = (title, sub = '') => `<div class="loading"><div class="orb"></div><b>${esc(title)}</b><small class="elapsed">${esc(sub)}</small></div>`;
const errorHTML = (msg) => `<div class="error-box"><span>⚠️</span><div>${esc(msg)}</div></div>`;
function startTimer(root, prefix) {
  const t0 = Date.now();
  const id = setInterval(() => {
    const el = root.querySelector('.elapsed');
    if (!el) return;
    const s = Math.round((Date.now() - t0) / 1000);
    el.textContent = `${prefix} ${s}s${s > 25 ? ' · big routines can take up to a minute' : ''}`;
  }, 1000);
  return () => clearInterval(id);
}

// ---------- Modal ----------
function openModal(html, { closable = true } = {}) {
  $('#modalBody').innerHTML = html;
  $('#modalClose').hidden = !closable;
  $('#modal').hidden = false;
  $('#modal').dataset.closable = closable ? '1' : '';
}
function closeModal() { $('#modal').hidden = true; }
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && $('#modal').dataset.closable) closeModal(); });

// ---------- Language (content language: notices, answers, voice) ----------
const langHooks = [];
function setLang(lang) {
  state.lang = lang;
  store.set('lang', lang);
  $$('#langToggle button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  langHooks.forEach((fn) => fn(lang));
}
$$('#langToggle button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ---------- Router ----------
const ROUTES = ['home', 'rooms', 'scan', 'syllabus', 'notices', 'ask', 'admin'];
const routeHooks = {};
const STUDENT_ONLY = ['scan', 'syllabus', 'notices'];
function route() {
  let name = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  if (isTeacher() && STUDENT_ONLY.includes(name)) name = 'home'; // teachers use Home, Free Rooms and Ask
  document.body.classList.toggle('teacher', isTeacher());
  for (const r of ROUTES) $(`#view-${r}`).hidden = r !== name;
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  if (routeHooks[name]) routeHooks[name]();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- Uploads: images, PDFs and Google Drive links ----------
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const FILE_TYPES = [...IMG_TYPES, 'application/pdf'];
const FILE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_PAGES = 4;

// Shrink big phone photos before upload (faster on mobile data, same text quality)
async function prepareImage(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = 2000;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 2.5 * 1024 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch (_) {
    return file;
  }
}

// pdf.js is loaded only when someone picks a PDF
let pdfReady = null;
function loadPdfJs() {
  if (!pdfReady) {
    pdfReady = import('/vendor/pdfjs/pdf.min.mjs')
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
        return pdfjs;
      })
      .catch(() => {
        pdfReady = null;
        throw new Error('Could not load the PDF reader. Check your internet and try again.');
      });
  }
  return pdfReady;
}

// Each PDF page becomes a sharp JPEG image that Gemma can read (first 4 pages)
async function pdfToImages(file) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1800 / Math.max(base.width, base.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    out.push(new File([blob], `page-${i}.jpg`, { type: 'image/jpeg' }));
  }
  if (doc.numPages > MAX_PAGES) toast(`Only the first ${MAX_PAGES} pages of the PDF are read.`);
  return out;
}

// Any picked file -> list of images ready to upload
async function toUploadImages(file) {
  if (!FILE_TYPES.includes(file.type)) throw new Error('Please choose a photo (JPG, PNG, WebP) or a PDF.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That file is too large (max 15 MB).');
  if (file.type === 'application/pdf') {
    const pages = await pdfToImages(file);
    if (!pages.length) throw new Error('This PDF has no pages.');
    return pages;
  }
  return [await prepareImage(file)];
}

// Download a public Google Drive / Docs / Sheets file through our server
async function fileFromDrive(link) {
  let res;
  try {
    res = await fetch(`/api/import/drive?url=${encodeURIComponent(link)}`);
  } catch (_) {
    throw new Error('Cannot reach the ScanClass server.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not import that link.');
  }
  const blob = await res.blob();
  const type = blob.type || 'application/pdf';
  return new File([blob], type === 'application/pdf' ? 'drive.pdf' : 'drive-image', { type });
}

// Small "paste a Drive link" row used under every uploader
function driveRowHTML(id) {
  return `<div class="drive-row"><input type="text" id="${id}" placeholder="Or paste a Google Drive / Docs link" autocomplete="off">
    <button class="btn btn-ghost btn-sm" type="button" id="${id}Btn">Import</button></div>`;
}
function wireDriveRow(id, onFile) {
  const btn = $(`#${id}Btn`);
  btn.addEventListener('click', async () => {
    const link = $(`#${id}`).value.trim();
    if (!link) return toast('Paste a Google Drive link first.');
    btn.disabled = true;
    btn.textContent = 'Importing…';
    try {
      await onFile(await fileFromDrive(link));
      $(`#${id}`).value = '';
    } catch (e) {
      toast(e.message, 5000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  });
}

// ---------- Dropzone ----------
function setupDropzone(zone, onImages) {
  const input = $('input[type=file]', zone);
  input.setAttribute('accept', FILE_ACCEPT);
  const preview = $('.dz-preview', zone);
  const empty = $('.dz-empty', zone);
  const label = $('b', empty).textContent;
  const take = async (file) => {
    if (!file) return;
    $('b', empty).textContent = file.type === 'application/pdf' ? 'Reading PDF pages…' : 'Preparing photo…';
    try {
      const images = await toUploadImages(file);
      if (preview.src) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(images[0]);
      preview.hidden = false;
      empty.hidden = true;
      onImages(images, file);
      if (images.length > 1) toast(`${images.length} PDF pages ready.`);
    } catch (e) {
      toast(e.message, 5000);
    } finally {
      $('b', empty).textContent = label;
    }
  };
  input.addEventListener('change', () => take(input.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag'); take(e.dataTransfer.files[0]); });
  return take;
}
