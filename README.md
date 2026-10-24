# ScanClass AI

**Scan once. Your whole class is sorted.** ScanClass turns a blurry class-routine photo into a personal timetable, a live free-room finder, reminders and CR announcements, for university students and their CRs. Powered by **Gemma 4**.

## The problem

At IIUC (and most universities in Bangladesh), class routines, room changes and notices are shared as **photos in Facebook and Messenger groups** or pinned on notice boards.

- Students screenshot the routine and zoom in every day to find their section's class and room.
- When a room or time changes, a new photo is posted and many students miss it.
- When students want an empty room for group study, they walk floor to floor checking doors.
- CRs answer the same "which room?" question again and again.

## The solution

1. **Scan a routine (photo, PDF or Google Drive link):** Gemma 4 reads the whole table (day, time, course, section, room, teacher) into an editable table. Unclear cells are flagged for the CR to check.
2. **Free Rooms:** combines every CR's uploaded routine (all departments, all semesters) to show which rooms in buildings **C** and **Cx** are free *right now* or at any day/time, and until when, by building and floor. Rooms that appear in no routine are honestly labelled "probably free".
3. **Teacher mode:** teachers choose "Teacher", enter their name and add the **courses and sections they teach** (e.g. CSE-1121 → CSE 2BM). ScanClass finds those classes in the uploaded routines (initials printed in the routine can be added as an optional extra match). Teachers see their next class with room and section, today's timeline including CR cancellations and extra classes, weekly routine, calendar reminders and free rooms, and get phone notifications when a CR cancels, adds or changes one of their classes. It's the same data the students see.
3. **My routine + reminders:** each student picks their section once, sees today's classes and their next class, and can add every class to their phone calendar with a 10-minute alert.
4. **CR panel:** the CR logs in with a PIN, types a quick message (or snaps a notice) and Gemma 4 writes a clean notice in **English and বাংলা**. Students get it as a notification. CRs can also cancel a class or book an extra class in a free room. When the CR uploads a new routine, ScanClass detects what changed and notifies the class automatically.
5. **Real phone notifications (Web Push):** students tap "Turn on notifications" once. New CR notices then appear in the phone's notification panel even when the app is closed, plus a morning "Today" plan, an evening "Tomorrow" plan (classes and exams) and a reminder 10 minutes before each class, in English or বাংলা. On iPhone the site must be added to the Home Screen first (it is an installable web app).
6. **CR PINs from an admin:** a department admin opens the Admin page (protected by a secret `ADMIN_KEY`), generates a private 6-digit PIN for each section and gives it to that section's CR. CRs can change their PIN; the admin can reset it any time, which logs out the old PIN immediately.
7. **Exam syllabus:** the CR types or photographs the mid-term / final syllabus for each course; Gemma 4 turns it into a clean topic list (with exam date and notes). Students see every course's syllabus in the Syllabus tab, get a notification when it's published, and can ask "CSE-1121 mid syllabus?".
8. **Ask in Bangla or English (or by voice):** "এখন কোন রুম খালি?", "Where is my next class?". Gemma 4 understands the question; the answer is calculated by code from the real routine, so it never invents a room or time.

## How it works

| Job | Done by |
|---|---|
| Reading routine photos and notice photos | **Gemma 4** (multimodal) |
| Writing bilingual announcements | **Gemma 4** |
| Turning a typed/photographed syllabus into a topic list | **Gemma 4** |
| Understanding free-form Bangla/English questions | **Gemma 4** (turns the question into a structured search) |
| Free rooms, next class, change detection, reminders | Plain JavaScript (deterministic, exact) |

- **Model:** Gemma 4 31B, open-weight, by Google DeepMind
  - Local development: [`gemma4:31b-cloud`](https://ollama.com/library/gemma4) through Ollama (offline backup: `gemma4:e2b`)
  - Deployed version: `gemma4:31b` through the Ollama cloud API
  - Model page: https://ollama.com/library/gemma4 · Gemma docs: https://ai.google.dev/gemma
- **Uploads:** photos (JPG/PNG/WebP), PDFs (each page is rendered to an image in the browser with [pdf.js](https://mozilla.github.io/pdf.js/), up to 4 pages) and public Google Drive / Docs / Sheets links (downloaded by the server from Google only). Works for routines, syllabus and notices.
- **Tech stack:** Node.js + Express backend, vanilla HTML/CSS/JS frontend (mobile-first), Multer for in-memory image upload, Web Speech API for voice, `.ics` calendar files for reminders, a service worker for notifications.
- **Data:** one shared store for the whole campus. On the deployed site it is a **Postgres database** (`DATABASE_URL`), so every CR's routine, notice and class update is kept permanently and everyone using the same link sees the same data. Without `DATABASE_URL` (local laptop) it falls back to `data/db.json`. Room ids are normalised to `C-102` / `Cx-304` however they are typed or read. The app starts with no classes; the sample routine photos, room list and student IDs used for testing are **made up**. No real student information is used.
- **Other AI services:** none. **AI coding assistant:** Claude (Anthropic) helped write code during the hackathon.

### Project structure

```
server.js              Express server and all API routes
services/gemma.js      the only file that calls the model (routine reading, notices, question understanding)
services/rooms.js      free-room finder and timetable logic (no AI)
services/compare.js    routine change detection (no AI)
services/answer.js     turns a parsed question into an exact answer (EN/বাংলা)
services/store.js      data store: Postgres when DATABASE_URL is set, else a JSON file
services/format.js     room naming rules (C-102, Cx-304)
data/seed.json         starting data: rooms in buildings C and Cx and the section list (no classes)
public/                the web app (index.html, style.css, js/*)
public/sample/         sample routine photos to try the scanner
```

### Security notes
- The API key stays on the server (`.env` / Render environment) and is never sent to the browser.
- Uploaded images are checked by type, size (8 MB) and file signature, processed in memory and never saved.
- CR PINs are random per section, stored only as salted SHA-256 hashes and shown to the admin once. CR and admin actions need session tokens; resetting a PIN ends that section's CR sessions. The admin key lives only in the server environment. Rate limiting on logins and AI routes.
- All user content is HTML-escaped before display.

## How to run it

1. Install [Node.js 18+](https://nodejs.org) and [Ollama](https://ollama.com).
2. Get the model:
   ```
   ollama signin
   ollama pull gemma4:31b-cloud
   ```
3. Clone and install:
   ```
   git clone <this repo>
   cd scanclass-ai
   npm install
   ```
4. Copy `.env.example` to `.env` (defaults work with local Ollama).
5. Run:
   ```
   npm start
   ```
6. Open http://localhost:3000

**Try it:** the app starts **empty**: no classes, notices or syllabus until a CR uploads them. Pick *CSE · Semester 2 · 2BM* (sample student ID `C999001`), log in as CR with the demo PIN **`1234`** (or generate a private one on the Admin page at `/#admin`), and scan `public/sample/routine-cse-2bm.png` (made-up routine). Then scan `routine-cse-2bm-updated.png` to see change detection. Only the room list (buildings C and Cx) and the list of departments/semesters/sections are pre-filled.

**Deploy (Render):**
1. Render → **New → Postgres** → Free → Create. Copy its **Internal Database URL**.
2. Render → **New → Web Service** → this repo → Build `npm install`, Start `node server.js`, Free plan.
3. Environment variables: `OLLAMA_HOST=https://ollama.com`, `OLLAMA_MODEL=gemma4:31b`, `OLLAMA_API_KEY=<your key>`, `DATABASE_URL=<Internal Database URL>`, `ADMIN_KEY=<a long secret for the Admin page>`.
4. Deploy. `/api/health` shows `"storage":"database"` when the database is connected.
5. (For scheduled reminders) Render's free server sleeps after 15 minutes. Add a free uptime monitor (e.g. UptimeRobot or cron-job.org) that opens `https://<your-app>.onrender.com/api/ping` every 10 minutes. Push keys (VAPID) are created automatically and saved in the database.
(Any Postgres works, e.g. Supabase or Neon free tiers.)

## Screenshots / demo

_Add 2–3 screenshots here (Home, Free Rooms, CR notice) or a short video link._

## What's not done yet

- **Storage:** the whole campus is stored as one JSON document in Postgres. Fine for one university, but a larger version would use proper tables. Render's free Postgres has time limits.
- **Login:** student ID is only stored on the phone. Sections without a private PIN still accept the demo PIN `1234` until the admin generates one. A real version would connect to the university's student system.
- **Notifications:** Web Push works on Android Chrome/Edge/Firefox and desktop browsers. iPhone needs iOS 16.4+ and the site added to the Home Screen. Scheduled reminders need the server awake (uptime ping on the free plan).
- Free rooms are only as complete as the uploaded routines. Unscheduled use of a room (club meetings, make-up classes not entered by a CR) is not known.
- Gemma can misread very messy photos. That's why every row is editable and flagged rows must be checked by the CR before saving.
- Bangla voice depends on the phone having a Bangla voice installed (Chrome on Android works best).

## Credits

- [Gemma 4](https://ai.google.dev/gemma) by Google DeepMind, run with [Ollama](https://ollama.com)
- [pdf.js](https://github.com/mozilla/pdf.js) (Mozilla) for reading PDF pages
- [Express](https://expressjs.com), [Multer](https://github.com/expressjs/multer), [dotenv](https://github.com/motdotla/dotenv)
- Fonts: Plus Jakarta Sans and Hind Siliguri (Google Fonts)
- Built during Hacktoberfest Hack Day Chittagong × IEEE Computer Society IIUC SBC. Code written with help from Claude (Anthropic).

## License

MIT, see [LICENSE](LICENSE).
