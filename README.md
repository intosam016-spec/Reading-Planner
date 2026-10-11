# Reading Planner

A clean, mobile-friendly reading planner for students. Track what you need to read, and when.

**Live:** https://planner-tau-rust.vercel.app/

Built as a **single HTML file** — no build step, no framework, no bundler. The only external request is the **Geist** webfont from Google Fonts; remove the two `<link>` tags and the app still works on the system font stack.

**Palette:** navy `#1F3A5F` · warm cream `#F7F4EE` · coral `#E4572E`

Two derived steps exist purely for accessibility — same hues, no new colours:

| Token | Value | Why |
|---|---|---|
| `--navy-soft` | `#5A6B80` | Secondary text — 4.97:1 on cream |
| `--coral-deep` | `#B8411D` | Coral text and CTA fill — 5.51:1 with white |

The original `#E4572E` fails WCAG AA as text and as a button background (3.68:1), so it is reserved for fills and marks where only the 3:1 graphics threshold applies.

---

## Design system

- **Type:** Geist. Display `clamp(1.75rem → 2.375rem)` at `-0.035em` tracking; body `0.9375rem/1.6` capped at `65ch`; tabular numerals on every count and time.
- **Spacing:** a 4px scale (`--sp-1` … `--sp-7`) — no arbitrary values.
- **Shape lock:** surfaces `18px` · controls `10px` · micro-marks `6px`, applied consistently.
- **Elevation:** only the form and the task list are surfaces. Everything else is grouped with hairlines and whitespace instead of card-on-card.
- **States:** tactile `scale(.98)` on press, `:focus-visible` rings, inline errors, a composed empty state, and full `prefers-reduced-motion` support.
- **Touch:** every control is at least 44×44px, with the smaller artwork drawn inside.

---

## Features

| Feature | Behaviour |
|---|---|
| Add a task | Enter a course name, pick a date and time, click **Add Reading Task** |
| Immediate display | The task appears instantly, sorted into position |
| Sorting | Chronological by date and time, earliest first |
| Progress summary | Total / Completed / Pending, updated on every action |
| Daily progress bar | Today's completed ÷ today's total, shown as a bar and as `3 of 5 tasks completed — 60%`. Updates live; reads 0% when nothing is scheduled today |
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
| `reading-planner.today.tests.cjs` | 33-assertion suite (jsdom) for the daily progress bar — today-only counting, rounding, live updates, hostile data |
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
node reading-planner.tests.cjs          # 97 passed, 0 failed
node reading-planner.today.tests.cjs    # 33 passed, 0 failed
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
