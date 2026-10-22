/* Engine tests — pure logic, no DOM. Run: node engine.tests.cjs */
const E = require("../js/engine.js");

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (e !== undefined ? "  -> " + e : "")); } };

function isoIn(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const baseProfile = () => ({
  courses: [
    { id: "c1", name: "Organic Chemistry", code: "CHEM201", units: 3, priority: "high", difficulty: 5,
      examDate: isoIn(5),
      topics: [{ id: "t1", name: "Ch 1" }, { id: "t2", name: "Ch 2" }, { id: "t3", name: "Ch 3" }],
      estimatedMinutes: 180 },
    { id: "c2", name: "World History", code: "HIST110", units: 3, priority: "low", difficulty: 2,
      examDate: isoIn(30), topics: [{ id: "t4", name: "Ch 1" }], estimatedMinutes: 60 },
  ],
  lectures: [
    { id: "l1", courseId: "c1", day: 1, start: "09:00", end: "11:00" },
    { id: "l2", courseId: "c2", day: 3, start: "13:00", end: "15:00" },
  ],
  availability: [
    { id: "a1", day: 1, start: "08:00", end: "18:00", kind: "study" },
    { id: "a2", day: 2, start: "08:00", end: "18:00", kind: "study" },
    { id: "a3", day: 3, start: "08:00", end: "18:00", kind: "study" },
    { id: "a4", day: 4, start: "08:00", end: "18:00", kind: "study" },
    { id: "b1", day: 1, start: "12:00", end: "13:00", kind: "blocked" },
  ],
  preferences: { sessionMinutes: 60, breakMinutes: 10, maxSessionsPerDay: 4, startDate: "2026-10-13" },
});

console.log("\n[T1] Time helpers");
{
  ok("toMin parses HH:MM", E.toMin("09:30") === 570);
  ok("toMin rejects junk", isNaN(E.toMin("9:3")) && isNaN(E.toMin("") ) && isNaN(E.toMin("25:00")));
  ok("toHHMM formats", E.toHHMM(570) === "09:30" && E.toHHMM(0) === "00:00");
  ok("round trips", E.toHHMM(E.toMin("23:45")) === "23:45");
  ok("fmtRange", E.fmtRange(540, 660) === "09:00\u201311:00");
}

console.log("\n[T2] Interval subtraction");
{
  const base = [{ start: 480, end: 1080 }];
  const out = E.subtract(base, [{ start: 540, end: 660 }]);
  ok("splits around a cut", out.length === 2 && out[0].start === 480 && out[0].end === 540 && out[1].start === 660 && out[1].end === 1080);
  ok("no cut leaves base intact", E.subtract(base, []).length === 1);
  ok("total overlap removes the interval", E.subtract(base, [{ start: 400, end: 1200 }]).length === 0);
  ok("non-overlapping cut is ignored", E.subtract(base, [{ start: 1200, end: 1300 }]).length === 1);
  ok("merges overlapping intervals", E.mergeOverlapping([{ start: 480, end: 600 }, { start: 540, end: 700 }]).length === 1);
}

console.log("\n[T3] Refuses to invent a timetable when input is missing");
{
  const empty = E.validatePlanInput({ courses: [], availability: [], preferences: {} });
  ok("flags missing courses", empty.missing.some(m => m.field === "courses"));
  ok("flags missing availability", empty.missing.some(m => m.field === "availability"));
  ok("flags missing session length", empty.missing.some(m => m.field === "preferences.sessionMinutes"));
  ok("reports not ok", empty.ok === false);

  const noTopics = baseProfile();
  noTopics.courses[0].topics = []; noTopics.courses[0].estimatedMinutes = 0;
  const r = E.validatePlanInput(noTopics);
  ok("flags a course with no topics or workload", r.missing.some(m => m.field === "topics"));
  ok("names the offending course", r.missing.find(m => m.field === "topics").message.includes("Organic Chemistry"));

  const badWindow = baseProfile();
  badWindow.availability[0].start = "18:00"; badWindow.availability[0].end = "08:00";
  ok("flags a backwards study window", E.validatePlanInput(badWindow).missing.some(m => m.field === "availability"));

  ok("accepts a complete profile", E.validatePlanInput(baseProfile()).ok === true);

  const res = E.generatePlan({ courses: [], availability: [], preferences: {} });
  ok("generate returns ok:false rather than guessing", res.ok === false && res.sessions.length === 0);
  ok("generate explains what is missing", res.missing.length > 0);
}

console.log("\n[T4] Free time excludes lectures and blocked periods");
{
  const free = E.freeIntervalsByDay(baseProfile());
  const mon = free[1];
  ok("Monday has three gaps", mon.length === 3, JSON.stringify(mon.map(i => [E.toHHMM(i.start), E.toHHMM(i.end)])));
  ok("gap before the 09:00 lecture", E.toHHMM(mon[0].start) === "08:00" && E.toHHMM(mon[0].end) === "09:00");
  ok("lecture 09:00-11:00 removed", !mon.some(i => i.start < 660 && i.end > 540));
  ok("blocked 12:00-13:00 removed", !mon.some(i => i.start < 780 && i.end > 720));
  ok("Tuesday is untouched", free[2].length === 1 && free[2][0].start === 480 && free[2][0].end === 1080);
  ok("Sunday has nothing", free[0].length === 0);

  const buf = baseProfile();
  buf.preferences.lectureBufferMinutes = 30;
  const b = E.freeIntervalsByDay(buf)[1];
  ok("lecture buffer shrinks the gaps", !b.some(i => i.start < 660 + 30 && i.end > 540 - 30));
}

console.log("\n[T5] Generation produces a valid plan");
{
  const p = baseProfile();
  const r = E.generatePlan(p, { today: isoIn(0), weeks: 1 });
  ok("succeeds", r.ok === true, JSON.stringify(r.missing));
  ok("produced sessions", r.sessions.length > 0, r.sessions.length);
  ok("every session is at least the minimum length", r.sessions.every(s => s.minutes >= E.MIN_SESSION));
  ok("every session has a date", r.sessions.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date)));
  ok("every session starts as pending", r.sessions.every(s => s.status === "pending"));
  ok("sessions are sorted by week/day/time", r.sessions.every((s, i) =>
    i === 0 || (r.sessions[i - 1].week < s.week) ||
    (r.sessions[i - 1].week === s.week && r.sessions[i - 1].day < s.day) ||
    (r.sessions[i - 1].week === s.week && r.sessions[i - 1].day === s.day && r.sessions[i - 1].startMin <= s.startMin)));

  console.log("\n[T6] ...and it never breaks a constraint");
  ok("zero conflicts reported", E.findConflicts(r.sessions, p).length === 0, JSON.stringify(E.findConflicts(r.sessions, p)));

  const free = E.freeIntervalsByDay(p);
  const outside = r.sessions.filter(s => !free[s.day].some(iv => s.startMin >= iv.start && s.endMin <= iv.end));
  ok("every session sits inside available study time", outside.length === 0, JSON.stringify(outside.map(s => [s.day, s.start, s.end])));

  const onLecture = r.sessions.filter(s => (p.lectures || []).some(l =>
    +l.day === s.day && s.startMin < E.toMin(l.end) && s.endMin > E.toMin(l.start)));
  ok("no session overlaps a lecture", onLecture.length === 0);

  const inBlocked = r.sessions.filter(s => (p.availability || []).some(a =>
    a.kind === "blocked" && +a.day === s.day && s.startMin < E.toMin(a.end) && s.endMin > E.toMin(a.start)));
  ok("no session lands in a blocked period", inBlocked.length === 0);

  const byDay = {};
  r.sessions.forEach(s => { (byDay[s.day] = byDay[s.day] || []).push(s); });
  let overlap = false;
  Object.keys(byDay).forEach(d => {
    const l = byDay[d].slice().sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < l.length; i++) if (l[i].startMin < l[i - 1].endMin) overlap = true;
  });
  ok("no two sessions overlap", overlap === false);

  ok("daily cap respected", Object.keys(byDay).every(d => byDay[d].length <= p.preferences.maxSessionsPerDay));
}

console.log("\n[T7] Breaks and session length");
{
  const p = baseProfile();
  p.courses = [p.courses[0]];
  p.lectures = [];
  p.availability = [{ id: "a", day: 1, start: "08:00", end: "14:00", kind: "study" }];
  p.preferences = { sessionMinutes: 60, breakMinutes: 15, maxSessionsPerDay: 10, startDate: "2026-10-13" };
  const r = E.generatePlan(p, { today: isoIn(0), weeks: 1 });
  const mon = r.sessions.filter(s => s.day === 1).sort((a, b) => a.startMin - b.startMin);
  ok("fills the window with 60-minute sessions", mon.length === 3, mon.length);
  ok("first starts at 08:00", mon[0].start === "08:00");
  ok("break honoured between sessions", mon.every((s, i) => i === 0 || s.startMin - mon[i - 1].endMin >= 15),
     JSON.stringify(mon.map(s => [s.start, s.end])));
  ok("all sessions are exactly 60 minutes here", mon.every(s => s.minutes === 60));

  const tiny = baseProfile();
  tiny.courses = [tiny.courses[0]];
  tiny.lectures = [];
  tiny.availability = [{ id: "a", day: 1, start: "08:00", end: "08:20", kind: "study" }];
  const t2 = E.generatePlan(tiny, { today: isoIn(0), weeks: 1 });
  ok("a 20-minute window yields no session (below the 30-minute floor)", t2.sessions.length === 0);
  ok("and it reports the shortfall", t2.unscheduled.length > 0 || t2.sessions.length === 0);
}

console.log("\n[T8] Priority and deadline weighting");
{
  const p = baseProfile();
  p.availability = [{ id: "a", day: 2, start: "08:00", end: "10:00", kind: "study" }];
  p.lectures = [];
  p.preferences = { sessionMinutes: 60, breakMinutes: 10, maxSessionsPerDay: 2, startDate: "2026-10-13" };
  const r = E.generatePlan(p, { today: isoIn(0), weeks: 1 });
  const chem = r.sessions.filter(s => s.courseId === "c1").length;
  const hist = r.sessions.filter(s => s.courseId === "c2").length;
  ok("scarce time goes to the urgent course first", chem > hist, "chem=" + chem + " hist=" + hist);

  const near = { priority: "medium", difficulty: 3, examDate: isoIn(1) };
  const far  = { priority: "medium", difficulty: 3, examDate: isoIn(60) };
  ok("imminent exam scores higher", E.urgency(near, isoIn(0)) > E.urgency(far, isoIn(0)));
  const hard = { priority: "medium", difficulty: 5 };
  const easy = { priority: "medium", difficulty: 1 };
  ok("harder course scores higher", E.urgency(hard, isoIn(0)) > E.urgency(easy, isoIn(0)));
  const hi = { priority: "high", difficulty: 3 };
  const lo = { priority: "low", difficulty: 3 };
  ok("higher priority scores higher", E.urgency(hi, isoIn(0)) > E.urgency(lo, isoIn(0)));
}

console.log("\n[T9] Spreading across the week");
{
  const p = baseProfile();
  p.lectures = [];
  p.courses = [{ id: "c1", name: "Only Course", priority: "medium", difficulty: 3,
    topics: [{ id: "t", name: "T" }], estimatedMinutes: 240 }];
  p.availability = [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: "a" + d, day: d, start: "08:00", end: "12:00", kind: "study" }));
  p.preferences = { sessionMinutes: 60, breakMinutes: 10, maxSessionsPerDay: 4, startDate: "2026-10-13" };
  const r = E.generatePlan(p, { today: isoIn(0), weeks: 1 });
  const days = new Set(r.sessions.map(s => s.day));
  ok("4 sessions land on 4 different days, not one", days.size === 4, "days=" + days.size);
  ok("all 240 minutes scheduled", r.sessions.reduce((a, s) => a + s.minutes, 0) === 240);
}

console.log("\n[T10] Multi-week distribution");
{
  const p = baseProfile();
  p.availability = [{ id: "a", day: 2, start: "08:00", end: "12:00", kind: "study" }];
  p.lectures = [];
  const r = E.generatePlan(p, { today: isoIn(0), weeks: 3 });
  const weeks = new Set(r.sessions.map(s => s.week));
  ok("sessions span multiple weeks", weeks.size > 1, "weeks=" + weeks.size);
  ok("each week carries a different date", new Set(r.sessions.map(s => s.date)).size === r.sessions.length ||
     r.sessions.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date)));
}

console.log("\n[T11] Determinism and shortfall reporting");
{
  const a = E.generatePlan(baseProfile(), { today: isoIn(0), weeks: 1 });
  const b = E.generatePlan(baseProfile(), { today: isoIn(0), weeks: 1 });
  ok("same input gives the same plan", JSON.stringify(a.sessions) === JSON.stringify(b.sessions));

  const p = baseProfile();
  p.courses[0].estimatedMinutes = 5000;
  p.availability = [{ id: "a", day: 1, start: "08:00", end: "09:00", kind: "study" }];
  p.lectures = [];
  const r = E.generatePlan(p, { today: isoIn(0), weeks: 1 });
  ok("reports what it could not fit", r.unscheduled.length > 0);
  ok("shortfall names the course", r.unscheduled[0].courseName.includes("Organic"));
  ok("shortfall has a human reason", typeof r.unscheduled[0].reason === "string" && r.unscheduled[0].reason.length > 10);
}

console.log("\n[T12] Regenerating only the remaining schedule");
{
  const p = baseProfile();
  const first = E.generatePlan(p, { today: isoIn(0), weeks: 1 });
  const sessions = first.sessions.map((s, i) => {
    if (i === 0) return Object.assign({}, s, { status: "done" });
    if (i === 1) return Object.assign({}, s, { locked: true });
    return s;
  });
  const doneId = sessions[0].id, lockedId = sessions[1].id;
  const again = E.regenerateRemaining(p, sessions, { today: isoIn(0), weeks: 1 });
  ok("regeneration succeeds", again.ok === true);
  ok("completed session is preserved", again.sessions.some(s => s.id === doneId && s.status === "done"));
  ok("locked session is preserved", again.sessions.some(s => s.id === lockedId && s.locked === true));
  ok("it reports what it kept", again.kept === 2, again.kept);
  ok("still no conflicts after regeneration", E.findConflicts(again.sessions, p).length === 0);
  ok("no new session lands on a kept one", (() => {
    const kept = again.sessions.filter(s => s.locked || s.status === "done");
    const fresh = again.sessions.filter(s => !s.locked && s.status !== "done");
    return !fresh.some(f => kept.some(k => k.day === f.day && f.startMin < k.endMin && f.endMin > k.startMin));
  })());
}

console.log("\n[T13] Progress maths");
{
  const s = [
    { status: "done", minutes: 60, date: "2026-10-13", week: 0 },
    { status: "done", minutes: 30, date: "2026-10-13", week: 0 },
    { status: "pending", minutes: 60, date: "2026-10-13", week: 0 },
    { status: "missed", minutes: 60, date: "2026-10-14", week: 0 },
  ];
  const d = E.progressFor(s, "2026-10-13");
  ok("daily totals", d.total === 3 && d.done === 2 && d.pending === 1 && d.missed === 0);
  ok("daily percent", d.percent === 67, d.percent);
  ok("counts completed minutes only", d.minutes === 90, d.minutes);
  const w = E.weeklyProgress(s, 0);
  ok("weekly totals include missed", w.total === 4 && w.done === 2 && w.missed === 1);
  ok("weekly percent", w.percent === 50, w.percent);
  ok("empty day is 0% and not NaN", E.summarise([]).percent === 0);
  ok("all-done day is 100%", E.summarise([{ status: "done", minutes: 10 }]).percent === 100);
}

console.log("\n[deriveStudyWindows] automatic study periods");
{
  const { deriveStudyWindows } = E;
  const T = require("../js/engine.js");

  // no lectures: the full default day is free
  let w = T.deriveStudyWindows([]);
  ok(w.length === 7, "one window per day when there are no lectures (got " + w.length + ")");
  ok(w.every(x => x.kind === "study"), "all derived rows are study periods");
  ok(w.some(x => x.day === 1 && x.start === "08:00" && x.end === "21:00"), "Monday covers the default day");

  // a lecture carves Monday
  w = T.deriveStudyWindows([{ day: 1, start: "08:00", end: "11:00" }]);
  const mon = w.filter(x => x.day === 1).sort((a, b) => a.start < b.start ? -1 : 1);
  ok(mon.length === 1 && mon[0].start === "11:00" && mon[0].end === "21:00",
     "Monday free time starts after the lecture (" + JSON.stringify(mon) + ")");

  // a mid-day lecture splits the day
  w = T.deriveStudyWindows([{ day: 2, start: "10:00", end: "12:00" }]);
  const tue = w.filter(x => x.day === 2).sort((a, b) => a.start < b.start ? -1 : 1);
  ok(tue.length === 2, "Tuesday split into two windows (got " + tue.length + ")");
  ok(tue[0].start === "08:00" && tue[0].end === "10:00", "morning window before the lecture");
  ok(tue[1].start === "12:00" && tue[1].end === "21:00", "afternoon window after the lecture");

  // buffer widens the cut
  w = T.deriveStudyWindows([{ day: 2, start: "10:00", end: "12:00" }], { buffer: 15 });
  const tue2 = w.filter(x => x.day === 2).sort((a, b) => a.start < b.start ? -1 : 1);
  ok(tue2[0].end === "09:45", "buffer trims before the lecture (got " + tue2[0].end + ")");
  ok(tue2[1].start === "12:15", "buffer trims after the lecture (got " + tue2[1].start + ")");

  // never overlaps a lecture
  const lecs = [
    { day: 1, start: "08:00", end: "11:00" }, { day: 1, start: "14:00", end: "17:00" },
    { day: 3, start: "09:00", end: "12:00" },
  ];
  const mine = T.deriveStudyWindows(lecs);
  const overlaps = mine.filter(x => lecs.some(l => {
    if (l.day !== x.day) return false;
    const xs = T.toMin(x.start), xe = T.toMin(x.end);
    const ls = T.toMin(l.start), le = T.toMin(l.end);
    return xs < le && xe > ls;
  }));
  ok(overlaps.length === 0, "no derived window overlaps a lecture (" + overlaps.length + ")");
}

console.log("\n" + "=".repeat(46));
console.log("  " + pass + " passed, " + fail + " failed");
console.log("=".repeat(46));
process.exit(fail ? 1 : 0);
