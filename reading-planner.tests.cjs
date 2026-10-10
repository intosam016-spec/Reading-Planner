/* Test harness for files/reading-planner.html — drives the real page with jsdom. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HTML = fs.readFileSync(
  path.join(__dirname, "reading-planner.html"),
  "utf8"
);

const STORE = "reading-planner-tasks-v1";
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
}

function boot(preSeed) {
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "https://example.test/planner",
    pretendToBeVisual: true,
    beforeParse(window) {
      if (preSeed !== undefined) window.localStorage.setItem(STORE, preSeed);
    },
  });
  return dom;
}

const pad = (n) => String(n).padStart(2, "0");
function localInput(offsetMs) {
  const d = new Date(Date.now() + offsetMs);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function setup(dom) {
  const w = dom.window, d = w.document;
  return {
    w, d,
    course: () => d.getElementById("course"),
    date: () => d.getElementById("date"),
    form: () => d.getElementById("form"),
    rows: () => Array.from(d.querySelectorAll("#list li.task")),
    stats: () => ({
      total: d.getElementById("stat-total").textContent,
      done: d.getElementById("stat-done").textContent,
      pending: d.getElementById("stat-pending").textContent,
    }),
    count: () => d.getElementById("count").textContent,
    emptyVisible: () => d.getElementById("empty").style.display !== "none",
    formError: () => d.getElementById("form-error").textContent,
    formErrorShown: () => d.getElementById("form-error").classList.contains("show"),
    eCourse: () => d.getElementById("e-course").textContent,
    eDate: () => d.getElementById("e-date").textContent,
    courseInvalid: () => d.getElementById("f-course").classList.contains("invalid"),
    dateInvalid: () => d.getElementById("f-date").classList.contains("invalid"),
    toast: () => d.getElementById("toast").textContent,
    stored: () => JSON.parse(w.localStorage.getItem(STORE) || "[]"),
    add(course, when) {
      d.getElementById("course").value = course;
      d.getElementById("date").value = when;
      d.getElementById("form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    },
  };
}

function rowIndexOf(t, course) {
  return t.rows().findIndex((_, i) => courseName(t, i) === course);
}

function clickBtn(t, rowIdx, selector) {
  const rows = t.rows();
  const btn = rows[rowIdx].querySelector(selector);
  if (!btn) throw new Error("button not found: " + selector + " in row " + rowIdx);
  btn.click();
  return btn;
}

const courseName = (t, i) => t.rows()[i].querySelector(".course").textContent.replace("Done", "").trim();

/* ============================== 1. ADD ============================== */
console.log("\n[1] Add reading tasks");
{
  const dom = boot();
  const t = setup(dom);

  t.add("Introduction to Psychology", localInput(24 * 3600e3));
  ok("valid task is added", t.rows().length === 1, "rows=" + t.rows().length);
  ok("task shows the course name", courseName(t, 0) === "Introduction to Psychology");
  ok("task shows a formatted date/time", /\d{4}/.test(t.rows()[0].querySelector(".when").textContent));
  ok("appears immediately (no reload)", t.rows().length === 1);
  ok("success toast shown", /Added: Introduction to Psychology/.test(t.toast()));
  ok("form cleared after add", t.course().value === "" && t.date().value === "");
  ok("persisted to localStorage", t.stored().length === 1);

  // multiple tasks, deliberately added out of order
  t.add("Linear Algebra", localInput(72 * 3600e3));
  t.add("Organic Chemistry", localInput(2 * 3600e3));
  t.add("World History", localInput(48 * 3600e3));
  ok("four tasks total", t.rows().length === 4, "rows=" + t.rows().length);

  /* ============================== 2. SORT ============================== */
  console.log("\n[2] Sort by date/time, earliest first");
  const order = t.rows().map((_, i) => courseName(t, i));
  ok("earliest first", order[0] === "Organic Chemistry", JSON.stringify(order));
  ok("latest last", order[3] === "Linear Algebra", JSON.stringify(order));
  ok("full order correct",
    JSON.stringify(order) === JSON.stringify(
      ["Organic Chemistry", "Introduction to Psychology", "World History", "Linear Algebra"]),
    JSON.stringify(order));

  /* ============================== 3. COUNTS ============================== */
  console.log("\n[3] Progress summary & count");
  ok("total stat = 4", t.stats().total === "4", t.stats().total);
  ok("completed stat = 0", t.stats().done === "0", t.stats().done);
  ok("pending stat = 4", t.stats().pending === "4", t.stats().pending);
  ok("list-head count text", t.count() === "0 of 4 done", t.count());
  ok("empty state hidden when tasks exist", t.emptyVisible() === false);
  dom.window.close();
}

/* ============================== 4. EMPTY FORM ============================== */
console.log("\n[4] Empty form submission");
{
  const dom = boot();
  const t = setup(dom);

  t.form().dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  ok("nothing added", t.rows().length === 0);
  ok("course error shown", t.courseInvalid() && /course name/i.test(t.eCourse()), t.eCourse());
  ok("date error shown", t.dateInvalid() && /date and time/i.test(t.eDate()), t.eDate());
  ok("storage untouched", t.stored().length === 0);

  // only course filled
  t.course().value = "Astronomy";
  t.form().dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  ok("still blocked with only a course", t.rows().length === 0);
  ok("date error still shown", t.dateInvalid());
  ok("course error cleared", !t.courseInvalid());

  // whitespace-only course must not count as filled
  t.course().value = "     ";
  t.date().value = localInput(3600e3);
  t.form().dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  ok("whitespace-only course rejected", t.rows().length === 0);
  ok("course error re-shown", t.courseInvalid());
  dom.window.close();
}

/* ============================== 5. PAST DATE ============================== */
console.log("\n[5] Past date validation");
{
  const dom = boot();
  const t = setup(dom);

  ok("date input has a min attribute", !!t.date().min, "min=" + t.date().min);
  ok("min is not in the past", new Date(t.date().min).getTime() >= Date.now() - 65e3);

  t.add("Medieval History", localInput(-24 * 3600e3));
  ok("yesterday rejected", t.rows().length === 0);
  ok("past-date error shown", t.dateInvalid() && /future|passed/i.test(t.eDate()), t.eDate());

  t.add("Medieval History", localInput(-60e3));
  ok("one minute ago rejected", t.rows().length === 0);

  t.add("Medieval History", localInput(5 * 60e3));
  ok("future date accepted", t.rows().length === 1);
  dom.window.close();
}

/* ============================== 6. DUPLICATES ============================== */
console.log("\n[6] Duplicate prevention");
{
  const dom = boot();
  const t = setup(dom);
  const when = localInput(24 * 3600e3);

  t.add("Statistics", when);
  ok("first add succeeds", t.rows().length === 1);

  t.add("Statistics", when);
  ok("exact duplicate blocked", t.rows().length === 2 ? false : t.rows().length === 1, "rows=" + t.rows().length);
  ok("duplicate warning shown", t.formErrorShown() && /already added/i.test(t.formError()), t.formError());
  ok("duplicate not persisted", t.stored().length === 1, "stored=" + t.stored().length);

  t.add("statistics", when);
  ok("duplicate blocked case-insensitively", t.stored().length === 1);

  t.add("  Statistics  ", when);
  ok("duplicate blocked with padding whitespace", t.stored().length === 1);

  t.add("Statistics", localInput(48 * 3600e3));
  ok("same course, different time is allowed", t.stored().length === 2, "stored=" + t.stored().length);

  t.add("Microeconomics", when);
  ok("same time, different course is allowed", t.stored().length === 3, "stored=" + t.stored().length);
  dom.window.close();
}

/* ============================== 7. COMPLETE ============================== */
console.log("\n[7] Mark as completed");
{
  const dom = boot();
  const t = setup(dom);
  t.add("Physics", localInput(3600e3));
  t.add("Chemistry", localInput(7200e3));

  clickBtn(t, 0, ".check");
  ok("row gains .done class", t.rows()[0].classList.contains("done"));
  ok("course text is struck through via .done", t.rows()[0].classList.contains("done"));
  ok("checkmark svg present", !!t.rows()[0].querySelector(".check svg"));
  ok("done badge rendered", !!t.rows()[0].querySelector(".badge"));
  ok("completed stat updates to 1", t.stats().done === "1", t.stats().done);
  ok("pending stat updates to 1", t.stats().pending === "1", t.stats().pending);
  ok("count text updates", t.count() === "1 of 2 done", t.count());
  ok("completion toast", /Completed: Physics/.test(t.toast()), t.toast());
  ok("completion persisted", t.stored().find(x => x.course === "Physics").done === true);

  clickBtn(t, 0, ".check");
  ok("toggling back works", t.rows()[0].classList.contains("done") === false);
  ok("stat reverts to 0", t.stats().done === "0", t.stats().done);

  clickBtn(t, 0, ".check");
  ok("re-completing works", t.stats().done === "1", t.stats().done);
  dom.window.close();
}

/* ============================== 8. DELETE ============================== */
console.log("\n[8] Delete with confirmation");
{
  const dom = boot();
  const t = setup(dom);
  t.add("Biology", localInput(3600e3));
  t.add("Geology", localInput(7200e3));
  ok("two tasks before delete", t.rows().length === 2);

  clickBtn(t, 0, ".del");
  ok("confirmation prompt appears", !!t.rows()[0].querySelector(".confirm"));
  ok("confirmation wording is clear", /Delete this task\?/.test(t.rows()[0].querySelector(".ask").textContent));
  ok("task NOT deleted yet", t.rows().length === 2, "rows=" + t.rows().length);
  ok("storage unchanged before confirm", t.stored().length === 2);

  clickBtn(t, 0, ".btn-no");
  ok("cancel dismisses the prompt", !t.rows()[0].querySelector(".confirm"));
  ok("cancel keeps the task", t.rows().length === 2);

  clickBtn(t, 0, ".del");
  clickBtn(t, 0, ".btn-yes");
  ok("confirm removes the task", t.rows().length === 1, "rows=" + t.rows().length);
  ok("the right task was removed", courseName(t, 0) === "Geology", courseName(t, 0));
  ok("removal persisted", t.stored().length === 1 && t.stored()[0].course === "Geology");
  ok("delete toast", /Deleted: Biology/.test(t.toast()), t.toast());
  ok("stats update after delete", t.stats().total === "1" && t.stats().pending === "1",
    JSON.stringify(t.stats()));

  clickBtn(t, 0, ".del");
  clickBtn(t, 0, ".btn-yes");
  ok("deleting the last task restores empty state", t.emptyVisible() === true);
  ok("count cleared on empty", t.count() === "", "count=" + t.count());
  ok("all stats zero", JSON.stringify(t.stats()) === JSON.stringify({ total: "0", done: "0", pending: "0" }),
    JSON.stringify(t.stats()));
  dom.window.close();
}

/* ============================== 9. PERSISTENCE ============================== */
console.log("\n[9] Save / restore across refresh");
{
  const dom1 = boot();
  const t1 = setup(dom1);
  t1.add("Shakespeare", localInput(24 * 3600e3));
  t1.add("Calculus", localInput(48 * 3600e3));
  t1.add("Botany", localInput(12 * 3600e3));
  // complete "Calculus" by name — sorted order is Botany, Shakespeare, Calculus
  const calcIdx = rowIndexOf(t1, "Calculus");
  ok("found Calculus at its sorted position", calcIdx === 2, "index=" + calcIdx);
  clickBtn(t1, calcIdx, ".check");
  ok("Calculus is marked done before refresh", t1.rows()[calcIdx].classList.contains("done"));
  const snapshot = dom1.window.localStorage.getItem(STORE);
  const beforeStats = t1.stats();
  dom1.window.close();

  // simulated page refresh: brand-new document, same stored data
  const dom2 = boot(snapshot);
  const t2 = setup(dom2);
  ok("tasks restored after refresh", t2.rows().length === 3, "rows=" + t2.rows().length);
  ok("order still sorted", courseName(t2, 0) === "Botany" && courseName(t2, 2) === "Calculus",
    t2.rows().map((_, i) => courseName(t2, i)).join(" | "));
  ok("completion status preserved on the right task",
    t2.rows()[rowIndexOf(t2, "Calculus")].classList.contains("done"));
  ok("uncompleted tasks stay uncompleted",
    !t2.rows()[rowIndexOf(t2, "Shakespeare")].classList.contains("done"));
  ok("stats preserved", JSON.stringify(t2.stats()) === JSON.stringify(beforeStats),
    JSON.stringify(t2.stats()) + " vs " + JSON.stringify(beforeStats));
  ok("still usable after restore (add works)", (t2.add("Ethics", localInput(96 * 3600e3)), t2.rows().length === 4));
  dom2.window.close();
}

/* ============================== 10. BAD DATA ============================== */
console.log("\n[10] Corrupt / missing stored data must not crash");
{
  const cases = [
    ["not JSON at all", "<<<not json>>>"],
    ["JSON but not an array", '{"a":1}'],
    ["array of junk", '[null, 42, "hello", {}, {"id":"x"}]'],
    ["missing when field", '[{"id":"a","course":"Math","done":false}]'],
    ["unparseable date", '[{"id":"a","course":"Math","when":"not-a-date","done":false,"created":1}]'],
    ["empty course", '[{"id":"a","course":"   ","when":"2099-01-01T10:00","done":false,"created":1}]'],
    ["done is a string", '[{"id":"a","course":"Math","when":"2099-01-01T10:00","done":"yes","created":1}]'],
  ];

  cases.forEach(([label, raw]) => {
    let crashed = null, t = null;
    try {
      const dom = boot(raw);
      t = setup(dom);
      t.rows();
      t.stats();
      t.add("Recovery Test", localInput(3600e3));
      dom.window.close();
    } catch (e) { crashed = e.message; }
    ok("survives " + label, crashed === null, crashed || "");
  });

  // a mixed payload should keep the good rows and drop the bad ones
  const mixed = JSON.stringify([
    { id: "good1", course: "Valid Course", when: "2099-05-01T09:00", done: true, created: 1 },
    { id: "bad1", course: "", when: "2099-05-01T09:00", done: false, created: 2 },
    { id: "bad2", course: "No Date", when: "garbage", done: false, created: 3 },
    null,
  ]);
  const dom = boot(mixed);
  const t = setup(dom);
  ok("keeps only the valid row", t.rows().length === 1, "rows=" + t.rows().length);
  ok("kept row is the valid one", courseName(t, 0) === "Valid Course", courseName(t, 0));
  // a string "done" must not be treated as completed, and the blob must self-heal
  const dom3 = boot('[{"id":"a","course":"M","when":"2099-01-01T10:00","done":"yes","created":1}]');
  const t3 = setup(dom3);
  ok("string 'done' is not treated as completed", !t3.rows()[0].classList.contains("done"));
  ok("completed stat stays 0 for string 'done'", t3.stats().done === "0", t3.stats().done);
  ok("stored blob is rewritten as a real boolean", t3.stored()[0].done === false,
    JSON.stringify(t3.stored()[0]));
  dom3.window.close();

  const dom4 = boot('[null, {"id":"a","course":"Math","when":"2099-01-01T10:00","done":false,"created":1}]');
  const t4 = setup(dom4);
  ok("junk rows purged from storage after load", t4.stored().length === 1, "stored=" + t4.stored().length);
  dom4.window.close();

  dom.window.close();
}

/* ============================== 11. XSS / UX ============================== */
console.log("\n[11] Safety & UX details");
{
  const dom = boot();
  const t = setup(dom);
  t.add('<img src=x onerror="window.__pwned=1">', localInput(3600e3));
  ok("no HTML injected from course name",
    !t.rows()[0].querySelector(".course img") && dom.window.__pwned === undefined);
  ok("name rendered as literal text",
    t.rows()[0].querySelector(".course").textContent.includes("<img"), 
    t.rows()[0].querySelector(".course").textContent);
  ok("long course name rejected",
    (t.add("x".repeat(81), localInput(7200e3)), t.rows().length === 1));
  dom.window.close();
}

/* ============================== 12. STRUCTURE ============================== */
console.log("\n[12] Required sections present");
{
  const dom = boot();
  const d = dom.window.document;
  const how = Array.from(d.querySelectorAll("section")).find(s => /How It Works/i.test(s.textContent));
  ok("'How It Works' section exists", !!how);
  ok("has exactly 3 numbered steps", how && how.querySelectorAll("ol.steps li").length === 3,
    how ? String(how.querySelectorAll("ol.steps li").length) : "none");
  ok("step 1 text correct", how && /Add a course and choose a reading date/i.test(how.textContent));
  ok("step 2 text correct", how && /Organize your reading tasks/i.test(how.textContent));
  ok("step 3 text correct", how && /Track your progress by completing tasks/i.test(how.textContent));
  ok("three summary stats exist", d.querySelectorAll(".stat").length === 3);
  ok("palette unchanged", /#1F3A5F/.test(HTML) && /#F7F4EE/.test(HTML) && /#E4572E/.test(HTML));
  dom.window.close();
}

console.log("\n" + "=".repeat(46));
console.log("  " + pass + " passed, " + fail + " failed");
console.log("=".repeat(46));
process.exit(fail ? 1 : 0);
