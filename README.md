# University Study Planner

Plan university reading around your lectures. Courses, a weekly lecture timetable,
automatic reading-session generation, progress tracking — per student account.

**Live:** https://planner-tau-rust.vercel.app/

---

## What it does

| Area | Behaviour |
|---|---|
| **Accounts** | Register / sign in / sign out. Email + password, and Google. Each student sees only their own data. |
| **Dashboard** | Courses, today's sessions, upcoming exams and deadlines, daily and weekly progress, and a button straight to plan generation. |
| **My Courses** | Add, edit and delete courses with name, code, credit units, priority, difficulty, exam date, assignment deadlines, and topics/chapters. |
| **My Lecture Timetable** | Weekly lectures plus the study periods you *can* use and the ones you *cannot*. Shown as a weekly grid. |
| **Generate Study Plan** | Builds reading sessions from your courses, lectures, availability, priorities and deadlines. Weekly calendar + daily agenda. |
| **My Reading Tasks** | Mark each session done / pending / missed, move it to another date, or delete it. |
| **Progress** | Daily, weekly and all-time completion, plus everything still outstanding. |

### The generator never invents a timetable

If something essential is missing — no courses, a course with no topics and no
estimated reading time, no study periods, a session length under 30 minutes — it
stops and tells you exactly what to add. It does not guess.

When it *can* build a plan it guarantees:

- sessions only inside your study periods
- never overlapping a lecture, a blocked period, or each other
- spread across days rather than piled onto one
- longer sessions for harder, higher-priority courses with nearer exams
- a configurable break between sessions, and no session shorter than 30 minutes
- anything you completed, missed or locked survives a regeneration untouched

---

## Architecture

No build step, no bundler, no framework. Plain ES5-compatible scripts loaded in
dependency order.

```
index.html          app shell: top bar, nav, view container
app.css             design system
js/config.js        ← Supabase URL + anon key go here
js/ui.js            escaping, dates, toast, field errors
js/engine.js        timetable generation — pure logic, no DOM
js/store.js         data layer + drivers (local | supabase)
js/auth.js          authentication + drivers (local | supabase)
js/views.js         the seven screens
js/app.js           bootstrap + hash router
supabase/schema.sql ← run this once in Supabase
tests/engine.tests.cjs   70 assertions on the generator
```

Views only ever talk to `StudyStore` and `StudyAuth`. Those talk to a *driver*.
Swapping `local` for `supabase` is one line in `js/app.js` — no view changes.

---

## Backend setup (required to go live)

The app ships working on a **local development driver**: accounts and data live in
the browser so every screen can be used and tested. That is **not** secure and
**not** shared between devices. To make it real:

### 1. Create a Supabase project

<https://supabase.com> → New project. Note the **Project URL** and the **anon public
key** from *Project Settings → API*.

### 2. Run the schema

Supabase Studio → **SQL Editor** → New query → paste all of
[`supabase/schema.sql`](supabase/schema.sql) → **Run**.

This creates the six tables, enables **row-level security** on each, and adds
policies pinning `user_id` to `auth.uid()`. That is the real security boundary: the
database refuses to return another student's rows even if the frontend is tampered
with.

### 3. Turn on Google sign-in (optional)

Supabase → **Authentication → Providers → Google**: enable it and paste a Google
OAuth client ID and secret. Then add your site URL under **Authentication → URL
Configuration**. Without this, the Google button will report that the provider is
not enabled.

Email + password works with no extra setup. If you leave *Confirm email* switched
on, new students must click the link in their inbox before signing in — the app
already handles that case and says so.

### 4. Paste your keys into `js/config.js`

```js
window.STUDY_PLANNER_CONFIG = {
  SUPABASE_URL: "https://yourproject.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

Both values are **safe to commit**. The anon key is a public key designed to sit in
frontend code; row-level security is what protects the data. The `service_role` key
is the dangerous one — never put it here or anywhere the browser can read.

Once those two strings are filled in, the app switches to Supabase automatically
and the yellow "Development mode" banner disappears.

---

## Running the tests

```bash
node tests/engine.tests.cjs      # 70 passed — generator logic
node test-study-app.cjs          # 61 passed — full app in Chromium
```

The generator suite covers interval maths, refusal-on-missing-input, free-time
calculation around lectures and blocked periods, no-overlap guarantees, break
enforcement, priority and deadline weighting, multi-week distribution, determinism,
regeneration-preserves-completed, and the progress maths.

The browser suite drives registration, validation, course CRUD, editing, lectures,
availability, generation, constraint checking on the *rendered* plan, saving,
progress, persistence across reload, per-user isolation, wrong-password rejection,
and mobile layout at 390×844.

---

## Design

Carries over the existing system: navy `#1F3A5F` · warm cream `#F7F4EE` · coral
`#E4572E`, Geist typeface, a 4px spacing scale, and the shape lock (surfaces 18px ·
controls 10px · micro-marks 6px). Two derived tokens exist purely for contrast:
`--navy-soft #5A6B80` and `--coral-deep #B8411D`.

---

## The original Reading Planner

`reading-planner.html` is the earlier single-file planner, kept intact and still
working. It has its own suites: `reading-planner.tests.cjs` (97 assertions) and
`reading-planner.today.tests.cjs` (42 assertions).
