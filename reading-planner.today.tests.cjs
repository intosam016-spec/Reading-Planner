/* Focused tests for the "Today" daily study progress bar. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HTML = fs.readFileSync(path.join(__dirname, "reading-planner.html"), "utf8");
const STORE = "reading-planner-tasks-v1";
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (e ? "  -> " + e : "")); } };

const pad = (n) => String(n).padStart(2, "0");

// a datetime-local string for a given local time today
function todayAt(h, m) {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(h) + ":" + pad(m);
}
function dayOffsetAt(days, h, m) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(h) + ":" + pad(m);
}

function boot(seed) {
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "https://example.test/planner",
    pretendToBeVisual: true,
    beforeParse(w) { if (seed !== undefined) w.localStorage.setItem(STORE, seed); },
  });
  const d = dom.window.document;
  return {
    dom, d,
    count: () => d.getElementById("today-count").textContent,
    width: () => d.getElementById("today-fill").style.width,
    aria: () => d.getElementById("today-bar").getAttribute("aria-valuenow"),
    rows: () => Array.from(d.querySelectorAll("#list li.task")),
    check: (i) => d.querySelectorAll("#list li.task .check")[i].click(),
    del: (i) => d.querySelectorAll("#list li.task .del")[i].click(),
    yes: () => d.querySelector(".btn-yes").click(),
  };
}

const mk = (course, when, done, i) => ({ id: "t" + i, course, when, done, created: i });

console.log("\n[T1] No tasks at all");
{
  const t = boot();
  ok("explains why the bar is empty", t.count() === "No tasks scheduled today — 0%", t.count());
  ok("still reports 0%", /0%$/.test(t.count()), t.count());
  ok("bar width is 0%", t.width() === "0%", t.width());
  ok("aria-valuenow is 0", t.aria() === "0", t.aria());
  ok("page still renders the empty state", t.d.getElementById("empty").style.display !== "none");
  t.dom.window.close();
}

console.log("\n[T2] The spec's example — 3 of 5 today");
{
  const seed = JSON.stringify([
    mk("A", todayAt(8, 0), true, 1),
    mk("B", todayAt(9, 0), true, 2),
    mk("C", todayAt(10, 0), true, 3),
    mk("D", todayAt(11, 0), false, 4),
    mk("E", todayAt(12, 0), false, 5),
  ]);
  const t = boot(seed);
  ok('renders "3 of 5 tasks completed — 60%"', t.count() === "3 of 5 tasks completed — 60%", t.count());
  ok("bar width is 60%", t.width() === "60%", t.width());
  ok("aria-valuenow is 60", t.aria() === "60", t.aria());
  t.dom.window.close();
}

console.log("\n[T3] Only today's tasks count");
{
  const seed = JSON.stringify([
    mk("today done", todayAt(8, 0), true, 1),
    mk("today pending", todayAt(9, 0), false, 2),
    mk("tomorrow done", dayOffsetAt(1, 9, 0), true, 3),
    mk("yesterday done", dayOffsetAt(-1, 9, 0), true, 4),
    mk("next week done", dayOffsetAt(7, 9, 0), true, 5),
  ]);
  const t = boot(seed);
  ok("ignores yesterday/tomorrow/next week", t.count() === "1 of 2 tasks completed — 50%", t.count());
  ok("all 5 tasks still listed", t.rows().length === 5, "rows=" + t.rows().length);
  t.dom.window.close();
}

console.log("\n[T3b] The reported bug — completed a task dated another day");
{
  // exactly the reported case: one task, scheduled for a future Saturday, now completed
  const seed = JSON.stringify([mk("SVG 514 — Research Methods", dayOffsetAt(4, 9, 0), true, 1)]);
  const t = boot(seed);
  ok("Today says nothing is scheduled today", t.count() === "No tasks scheduled today — 0%", t.count());
  ok("Today bar stays at 0% (correct — the task is not today)", t.width() === "0%", t.width());
  ok("but Completed still counts it", t.d.getElementById("stat-done").textContent === "1", t.d.getElementById("stat-done").textContent);
  ok("and the row is visibly ticked", t.rows()[0].className.indexOf("done") > -1, t.rows()[0].className);
  ok("and the checkbox is pressed for a11y", t.d.querySelector(".check").getAttribute("aria-pressed") === "true");
  t.dom.window.close();
}

console.log("\n[T3c] Completing a task scheduled for TODAY does move the bar");
{
  const seed = JSON.stringify([mk("Today task", todayAt(9, 0), false, 1)]);
  const t = boot(seed);
  ok("starts at 0 of 1", t.count() === "0 of 1 tasks completed — 0%", t.count());
  t.check(0);
  ok("ticking it moves Today to 100%", t.count() === "1 of 1 tasks completed — 100%", t.count());
  ok("and the bar fills", t.width() === "100%", t.width());
  t.dom.window.close();
}

console.log("\n[T4] Updates live when completing / un-completing");
{
  const seed = JSON.stringify([
    mk("A", todayAt(8, 0), false, 1),
    mk("B", todayAt(9, 0), false, 2),
  ]);
  const t = boot(seed);
  ok("starts at 0 of 2 — 0%", t.count() === "0 of 2 tasks completed — 0%", t.count());
  t.check(0);
  ok("after 1 completion -> 50%", t.count() === "1 of 2 tasks completed — 50%", t.count());
  ok("bar width tracks it", t.width() === "50%", t.width());
  t.check(1);
  ok("after 2 completions -> 100%", t.count() === "2 of 2 tasks completed — 100%", t.count());
  ok("aria updates to 100", t.aria() === "100", t.aria());
  t.check(0);
  ok("un-completing drops it to 50%", t.count() === "1 of 2 tasks completed — 50%", t.count());
  ok("aria follows back down", t.aria() === "50", t.aria());
  t.dom.window.close();
}

console.log("\n[T5] Updates when a today task is deleted");
{
  const seed = JSON.stringify([
    mk("A", todayAt(8, 0), true, 1),
    mk("B", todayAt(9, 0), false, 2),
  ]);
  const t = boot(seed);
  ok("starts 1 of 2 — 50%", t.count() === "1 of 2 tasks completed — 50%", t.count());
  t.del(0); t.yes();
  ok("deleting a completed today task -> 0 of 1 — 0%", t.count() === "0 of 1 tasks completed — 0%", t.count());
  t.del(0); t.yes();
  ok("deleting the last today task -> explains the empty bar", t.count() === "No tasks scheduled today — 0%", t.count());
  ok("no crash, bar back to 0%", t.width() === "0%", t.width());
  t.dom.window.close();
}

console.log("\n[T6] Rounding and boundaries");
{
  const three = JSON.stringify([mk("A", todayAt(8, 0), true, 1), mk("B", todayAt(9, 0), false, 2), mk("C", todayAt(10, 0), false, 3)]);
  const t1 = boot(three);
  ok("1 of 3 rounds to 33%", t1.count() === "1 of 3 tasks completed — 33%", t1.count());
  t1.dom.window.close();

  const six = JSON.stringify([1,2,3,4,5,6].map((n, i) => mk("T" + n, todayAt(7 + i, 0), i < 5, n)));
  const t2 = boot(six);
  ok("5 of 6 rounds to 83%", t2.count() === "5 of 6 tasks completed — 83%", t2.count());
  t2.dom.window.close();

  const allDone = JSON.stringify([mk("A", todayAt(8, 0), true, 1), mk("B", todayAt(9, 0), true, 2)]);
  const t3 = boot(allDone);
  ok("all done -> 100%", t3.count() === "2 of 2 tasks completed — 100%", t3.count());
  ok("bar width 100%", t3.width() === "100%", t3.width());
  t3.dom.window.close();
}

console.log("\n[T7] Hostile data does not break it");
{
  const junk = JSON.stringify([
    { id: "a", course: "Bad date", when: "not-a-date", done: true, created: 1 },
    null,
    { id: "b", course: "Today", when: todayAt(9, 0), done: false, created: 2 },
  ]);
  let crashed = null, t = null;
  try { t = boot(junk); } catch (e) { crashed = e.message; }
  ok("survives unparseable dates", crashed === null, crashed || "");
  if (t) {
    ok("counts only the valid today task", t.count() === "0 of 1 tasks completed — 0%", t.count());
    t.dom.window.close();
  }

  let crashed2 = null;
  try { const t2 = boot("<<<not json>>>"); t2.count(); t2.dom.window.close(); } catch (e) { crashed2 = e.message; }
  ok("survives corrupt storage entirely", crashed2 === null, crashed2 || "");
}

console.log("\n[T8] Structure & a11y");
{
  const t = boot();
  const bar = t.d.getElementById("today-bar");
  ok("progressbar role present", bar.getAttribute("role") === "progressbar");
  ok("aria-valuemin/max set", bar.getAttribute("aria-valuemin") === "0" && bar.getAttribute("aria-valuemax") === "100");
  ok("has an accessible name", !!bar.getAttribute("aria-labelledby"));
  ok("sits after the task summary",
    t.d.querySelector(".stats").compareDocumentPosition(t.d.querySelector(".today")) & 4 ? true : false);
  ok("existing stat IDs untouched",
    !!t.d.getElementById("stat-total") && !!t.d.getElementById("stat-done") && !!t.d.getElementById("stat-pending"));
  ok("How It Works still present", !!t.d.querySelector("section.how"));
  t.dom.window.close();
}

console.log("\n" + "=".repeat(46));
console.log("  " + pass + " passed, " + fail + " failed");
console.log("=".repeat(46));
process.exit(fail ? 1 : 0);
