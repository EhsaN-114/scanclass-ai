// Data store for routines, rooms, sections, notices and CR updates.
//
// - With DATABASE_URL set (Render / Supabase / Neon Postgres): everything is saved in a
//   real database, so every CR's routine and notice is kept permanently and shared by
//   everyone using the same link.
// - Without DATABASE_URL (your laptop): saved in data/db.json.
// On the very first start both copy data/seed.json (made-up sample campus data).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DIR, 'db.json');
const SEED = path.join(DIR, 'seed.json');
const DATABASE_URL = process.env.DATABASE_URL || '';

let db = null;
let pool = null;
let saving = Promise.resolve();

async function init() {
  if (DATABASE_URL) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
    pool = new Pool({ connectionString: DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 3 });
    await pool.query('CREATE TABLE IF NOT EXISTS scanclass_store (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())');
    const { rows } = await pool.query("SELECT value FROM scanclass_store WHERE key = 'db'");
    if (rows.length) {
      db = rows[0].value;
    } else {
      db = JSON.parse(fs.readFileSync(SEED, 'utf8'));
      await pool.query("INSERT INTO scanclass_store (key, value) VALUES ('db', $1)", [JSON.stringify(db)]);
    }
    upgrade();
    console.log('Storage: Postgres database (permanent)');
    return db;
  }
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (_) {
    db = JSON.parse(fs.readFileSync(SEED, 'utf8'));
    writeFile();
  }
  upgrade();
  console.log('Storage: data/db.json (local file)');
  return db;
}

// Add lists that newer versions of the app need (keeps old saved data working)
function upgrade() {
  for (const k of ['rooms', 'sections', 'classes', 'announcements', 'overrides', 'syllabi']) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
}

function writeFile() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE); // atomic replace
}

// Save changes. Writes are queued so they never overlap.
function save() {
  if (!pool) {
    writeFile();
    return Promise.resolve();
  }
  const snapshot = JSON.stringify(db);
  saving = saving
    .then(() => pool.query("UPDATE scanclass_store SET value = $1, updated_at = now() WHERE key = 'db'", [snapshot]))
    .catch((e) => console.error('Database save failed:', e.message));
  return saving;
}

function get() {
  if (!db) throw new Error('Store not initialised');
  return db;
}

const newId = (prefix) => prefix + crypto.randomBytes(6).toString('hex');
const sectionKey = (s) => `${s.dept}|${s.semester}|${s.section}`;
const findSection = (key) => get().sections.find((s) => sectionKey(s) === key) || null;

// Public view of sections (never send PIN hashes to the browser)
function publicSections() {
  return get().sections.map((s) => ({ dept: s.dept, semester: s.semester, section: s.section, key: sectionKey(s) }));
}

function checkPin(key, pin) {
  const s = findSection(key);
  if (!s || !s.crPinHash || typeof pin !== 'string') return false;
  const hash = crypto.createHash('sha256').update(s.crPinSalt + pin).digest();
  const expected = Buffer.from(s.crPinHash, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// Give a section a new CR PIN (stored only as a salted hash)
function setPin(key, pin) {
  const s = findSection(key);
  if (!s) return false;
  s.crPinSalt = crypto.randomBytes(8).toString('hex');
  s.crPinHash = crypto.createHash('sha256').update(s.crPinSalt + pin).digest('hex');
  s.crPinDemo = false;
  s.crPinSetAt = new Date().toISOString();
  return true;
}

module.exports = { init, get, save, newId, sectionKey, findSection, publicSections, checkPin, setPin, usesDatabase: () => !!pool };
