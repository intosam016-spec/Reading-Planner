# Reading Planner

A clean, mobile-friendly reading planner for students. Track what you need to read, and when.

**Live:** https://planner-tau-rust.vercel.app/

Built as a **single self-contained HTML file** — no build step, no framework, no dependencies, no network requests. Open it in a browser and it works.

**Palette:** navy `#1F3A5F` · warm cream `#F7F4EE` · coral `#E4572E`

---

## Features

| Feature | Behaviour |
|---|---|
| Add a task | Enter a course name, pick a date and time, click **Add Reading Task** |
| Immediate display | The task appears instantly, sorted into position |
| Sorting | Chronological by date and time, earliest first |
| Progress summary | Total / Completed / Pending, updated on every action |
| Mark complete | Checkbox toggles a navy checkmark, strikethrough and dimmed row |
| Delete | Requires inline confirmation — **Yes** / **Cancel** — before removal |
| Duplicate prevention | Same course at the same date/time is blocked, case-insensitively |
| Past-date validation | Dates before the current minute are rejected with an inline error |
| Empty-form validation | Clear per-field messages; whitespace-only input is rejected |
| Persistence | Saved to `localStorage`; tasks and completion state survive a refresh |
| Corrupt-data recovery | Malformed stored data is dropped and the cleaned version written back |
| Feedback | A toast confirms every add, completion and deletion |
| Responsive | Single column, tested at 390×844 and 1280×900 |
| Touch targets | All controls are at least 44×44 px on mobile |

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Entry point for static hosting — identical to `reading-planner.html` |
| `reading-planner.html` | The entire application — markup, styles and logic in one file |
| `reading-planner.tests.cjs` | 97-assertion test suite (jsdom) covering logic, validation and persistence |
| `planner-mobile.png` | Screenshot — mobile with tasks |
| `planner-mobile-empty.png` | Screenshot — mobile empty state |
| `planner-desktop.png` | Screenshot — desktop |

---

## Running it

Open `reading-planner.html` in any modern browser. That's it.

For the full experience (persistent storage), serve it over HTTP rather than opening it from disk:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/reading-planner.html
```

---

## Running the tests

The suite drives the real page with jsdom — it does not re-implement the logic.

```bash
npm install jsdom
node reading-planner.tests.cjs
```

Expected output ends with:

```
  97 passed, 0 failed
```

The suite covers: adding tasks, chronological sorting, empty and whitespace-only submissions, past-date rejection, duplicate detection (exact, case-insensitive and padded), completion toggling, delete confirmation *and* cancellation, refresh persistence across a separate document instance, and seven classes of corrupt stored data.

---

## Notes on design decisions

**Inline delete confirmation instead of `confirm()`.** Native modal dialogs are blocked in sandboxed iframes, so the confirmation is rendered inside the task row. Nothing is deleted until the user presses **Yes**.

**Touch targets are real 44×44 elements.** A `::after` pseudo-element with a negative inset does *not* extend the hit area in Chromium — `elementFromPoint` still returns the parent. So the buttons are genuinely 44px, with the smaller 26px visuals drawn by an inner element and negative margins keeping the layout pixel-identical.

**Course names are escaped before rendering**, so text like `<img src=x onerror=...>` displays literally rather than executing.

**Stored data is validated on load.** Anything missing an id, course or parseable date is discarded rather than allowed to break the render, and the sanitised array is written back so bad data isn't re-parsed on every load.

---

## Browser support

Any browser with `localStorage`, `Array.prototype.filter`, `String.prototype.padStart` and `Element.closest` — Chrome, Firefox, Safari and Edge, desktop and mobile. No polyfills required.
