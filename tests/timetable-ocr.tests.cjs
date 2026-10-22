/* Unit tests for the timetable OCR parser (pure functions, no browser). */
const T = require("../js/timetable-ocr.js");

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) { pass++; }
  else { fail++; console.log(`  FAIL ${msg}\n       expected ${sb}\n       got      ${sa}`); }
};
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("  FAIL " + msg); } };

console.log("\n[1] Time ranges");
const tr = (s) => { const r = T.parseTimeRange(s); return r ? [r.start, r.end] : null; };
eq(tr("09:00 - 10:30"), ["09:00", "10:30"], "HH:MM - HH:MM");
eq(tr("9:00-9:50"), ["09:00", "09:50"], "single-digit hour");
eq(tr("9.00 – 10.30"), ["09:00", "10:30"], "dots and en dash");
eq(tr("8:00am - 9:30am"), ["08:00", "09:30"], "am on both sides");
eq(tr("2:00pm - 3:30pm"), ["14:00", "15:30"], "pm on both sides");
eq(tr("11:00 - 1:00"), ["11:00", "13:00"], "crosses noon");
eq(tr("0900-1030"), ["09:00", "10:30"], "military without separator");
eq(tr("1400-1530"), ["14:00", "15:30"], "military afternoon");
eq(tr("9 - 11"), ["09:00", "11:00"], "bare hours");
eq(tr("no times here"), null, "no time range returns null");
eq(tr("10:30 - 09:00"), null, "backwards range rejected");
eq(tr("25:00 - 26:00"), null, "invalid hours rejected");

console.log("\n[2] Day names");
eq(T.parseDay("Monday"), 1, "full Monday");
eq(T.parseDay("MON"), 1, "short MON");
eq(T.parseDay("tues"), 2, "tues");
eq(T.parseDay("Thursday"), 4, "Thursday");
eq(T.parseDay("thurs"), 4, "thurs");
eq(T.parseDay("Sunday"), 0, "Sunday is 0");
eq(T.parseDay("Room 101"), null, "no day in random text");

console.log("\n[3] Course vs location");
let s = T.splitCourseAndLocation("MATH101  Lecture Hall A");
eq(s.course, "MATH101", "course before double space");
eq(s.location, "Lecture Hall A", "location recognised");
s = T.splitCourseAndLocation("Linear Algebra");
eq(s.course, "Linear Algebra", "plain course name");
eq(s.location, "", "no bogus location");
s = T.splitCourseAndLocation("Physics  Lab 3");
eq(s.location, "Lab 3", "lab recognised as location");
eq(T.courseCode("MATH101"), "MATH101", "course code extracted");
eq(T.courseCode("CSC 201"), "CSC201", "code with space");
eq(T.courseCode("Linear Algebra"), "", "no code when absent");

console.log("\n[4] Inline: day + time on the same line");
let r = T.parseLines([
  "Monday 9:00 - 10:30 MATH101 Lecture Hall A",
  "Tuesday 14:00 - 15:30 PHY110 Lab 2",
]);
ok(r.ok, "ok flagged");
eq(r.rows.length, 2, "two rows found");
eq([r.rows[0].day, r.rows[0].start, r.rows[0].end], [1, "09:00", "10:30"], "row 1 day/time");
eq(r.rows[0].course, "MATH101", "row 1 course");
eq(r.rows[0].location, "Lecture Hall A", "row 1 location");
eq([r.rows[1].day, r.rows[1].start], [2, "14:00"], "row 2 day/time");

console.log("\n[5] Grid: day names across a header row");
const words = (text, x0) => text.split(/\s+/).map((t, i) => ({ text: t, x: x0 + i * 40, width: 40 }));
r = T.parseLines([
  { text: "Monday Tuesday Wednesday", words: [
      { text: "Monday", x: 100, width: 60 },
      { text: "Tuesday", x: 300, width: 60 },
      { text: "Wednesday", x: 500, width: 60 }] },
  { text: "09:00-10:00 MATH101", words: [
      { text: "09:00-10:00", x: 95, width: 70 },
      { text: "MATH101", x: 110, width: 60 }] },
  { text: "11:00-12:00 PHY110", words: [
      { text: "11:00-12:00", x: 295, width: 70 },
      { text: "PHY110", x: 310, width: 60 }] },
  { text: "14:00-15:00 CSC201", words: [
      { text: "14:00-15:00", x: 495, width: 70 },
      { text: "CSC201", x: 510, width: 60 }] },
]);
ok(r.ok, "grid parsed");
eq(r.rows.length, 3, "three grid rows");
eq(r.rows.map(x => x.day), [1, 2, 3], "correct day per column");
eq(r.rows.map(x => x.course), ["MATH101", "PHY110", "CSC201"], "correct course per column");

console.log("\n[6] Days as row labels");
r = T.parseLines([
  "Wednesday",
  "08:00 - 09:00 ECO101 Room 12",
  "10:00 - 11:00 ECO102 Room 12",
]);
ok(r.ok, "row-label layout parsed");
eq(r.rows.map(x => x.day), [3, 3], "both rows inherit Wednesday");
eq(r.rows[0].course, "ECO101", "course read");

console.log("\n[7] Failure is reported, not invented");
r = T.parseLines(["some unrelated words", "no times at all"]);
ok(!r.ok, "not ok when nothing recognised");
eq(r.rows.length, 0, "no fabricated rows");
ok(r.warnings.length > 0, "a warning is given");
ok(/no lecture times/i.test(r.warnings[0]), "warning mentions times");

r = T.parseLines(["09:00 - 10:00 MATH101"]);
ok(!r.ok, "times without a day is not silently accepted");
ok(r.warnings.some(w => /no day/i.test(w)), "asks for the day");

console.log("\n[8] Empty and junk input");
ok(!T.parseLines([]).ok, "empty input not ok");
ok(!T.parseLines(null).ok, "null input not ok");
ok(!T.parseLines([""]).ok, "blank line not ok");

console.log("\n[9] Duplicates removed");
r = T.parseLines([
  "Monday 9:00 - 10:00 MATH101",
  "Monday 9:00 - 10:00 MATH101",
]);
eq(r.rows.length, 1, "identical lecture collapsed to one");

console.log("\n[10] File validation");
ok(T.validateFile(null) !== null, "no file is rejected");
ok(T.validateFile({ type: "image/gif", size: 100 }) !== null, "gif rejected");
ok(/PNG or JPG/.test(T.validateFile({ type: "image/gif", size: 100 })), "gif message mentions formats");
ok(T.validateFile({ type: "image/png", size: 12 * 1024 * 1024 }) !== null, "oversized rejected");
ok(/under 10 MB/.test(T.validateFile({ type: "image/png", size: 12 * 1024 * 1024 })), "size message is specific");
eq(T.validateFile({ type: "image/png", size: 1000 }), null, "valid png accepted");
eq(T.validateFile({ type: "image/jpeg", size: 1000 }), null, "valid jpeg accepted");
eq(T.validateFile({ type: "image/jpg", size: 1000 }), null, "jpg alias accepted");

console.log("\n[11] Real OCR text from a dark-background timetable");
const REAL = [
  "300-Level Sample Balanced Timetable",
  "\u2022 Monday",
  "\u25e6 08:00 AM - 11:00 AM: SVG 311 Geodetic Surveying I",
  "\u25e6 02:00 PM - 05:00 PM: SVG 313 Photogrammetry I",
  "\u2022 Tuesday",
  "\u25e6 09:00 AM - 12:00 PM: SVG 315 Cartography & Map Production",
];
r = T.parseLines(REAL);
ok(r.ok, "parsed a day-labelled list");
eq(r.rows.length, 3, "3 lectures found");
eq(r.rows[0].day, 1, "first row is Monday");
eq([r.rows[0].start, r.rows[0].end], ["08:00", "11:00"], "08:00 AM - 11:00 AM read");
eq(r.rows[1].day, 1, "second row stays Monday");
eq([r.rows[1].start, r.rows[1].end], ["14:00", "17:00"], "02:00 PM - 05:00 PM read");
eq(r.rows[2].day, 2, "third row is Tuesday");
ok(r.rows[0].course.indexOf("SVG 311") === 0, "course name kept (" + r.rows[0].course + ")");
ok(!/^[\u00a9\u25e6:;\s]/.test(r.rows[0].course), "no bullet or colon left in the course");

console.log("\n[12] Grid with a left-hand time column");
r = T.parseLines([
  { text: "Monday Tuesday Wednesday", words: [
      { text: "Monday", x: 100, width: 60 }, { text: "Tuesday", x: 300, width: 60 },
      { text: "Wednesday", x: 500, width: 60 }] },
  { text: "0800 MATH101 csc201", words: [
      { text: "0800", x: 10, width: 40 }, { text: "MATH101", x: 110, width: 60 },
      { text: "csc201", x: 310, width: 60 }] },
  { text: "10:00 PHY110", words: [
      { text: "10:00", x: 10, width: 40 }, { text: "PHY110", x: 310, width: 60 }] },
]);
ok(r.ok, "grid time-band layout parsed");
eq(r.rows.length, 3, "one row per cell");
eq(r.rows.map(x => x.day).sort(), [1, 2, 2], "days taken from columns");
eq(r.rows[0].course, "MATH101", "band label stripped from the course (got " + r.rows[0].course + ")");
eq(r.rows[0].start, "08:00", "band start is the row time");
eq(r.rows[2].start, "10:00", "second band starts at 10:00");

console.log("\n" + "=".repeat(46));
console.log(`  ${pass} passed, ${fail} failed`);
console.log("=".repeat(46));
process.exit(fail ? 1 : 0);
