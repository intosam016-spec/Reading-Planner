/* =====================================================================
   Study Planner — timetable image recognition
   =====================================================================
   Two halves:

     1. PARSING  (pure, no DOM, no network) — turns recognised text
        lines into lecture rows: day, start, end, course, location.
        This is the part that is unit-tested.

     2. EXTRACTION — runs the image through Tesseract.js (WASM OCR,
        runs entirely in the browser, no API key, no server) and feeds
        the resulting lines into the parser.

   The parser is deliberately conservative. When it cannot work
   something out it leaves the field null and says so in `warnings`,
   so the UI can ask the student to fill the gap rather than inventing
   a lecture that is not on their timetable.
   ===================================================================== */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.TimetableOCR = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The factory runs with no `root` argument, so resolve the global once here.
  var GLOBAL = (typeof self !== "undefined" ? self
    : typeof window !== "undefined" ? window
    : typeof globalThis !== "undefined" ? globalThis : {});

  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Longest-first so "thursday" wins over "thu" and "tuesday" over "tue".
  var DAYS = [
    { day: 1, re: /\b(mon|monday)\b/i },
    { day: 2, re: /\b(tue|tues|tuesday)\b/i },
    { day: 3, re: /\b(wed|weds|wednesday)\b/i },
    { day: 4, re: /\b(thu|thur|thurs|thursday)\b/i },
    { day: 5, re: /\b(fri|friday)\b/i },
    { day: 6, re: /\b(sat|saturday)\b/i },
    { day: 0, re: /\b(sun|sunday)\b/i }
  ];

  // Words that mark a location rather than a course name.
  var LOCATION_RE = /\b(room|rm|hall|lab|laboratory|theatre|theater|auditorium|lecture hall|lt\d*|building|bldg|block|floor|level|campus|complex|centre|center)\b/i;
  // A whole location phrase, e.g. "Lecture Hall A", "Room 12", "Lab 3", "LT2".
  var LOCATION_PHRASE = /\b((?:lecture\s+(?:hall|theatre|theater)|room|rm\.?|hall|lab(?:oratory)?|theatre|theater|auditorium|building|bldg\.?|LT)\s*[A-Za-z0-9-]{0,12})\b/i;
  // Short course-code-like tokens, e.g. CSC101, MATH 201, PHY-110.
  var CODE_RE = /\b([A-Z]{2,5})[\s-]?(\d{3}[A-Z]?)\b/;

  /* ---------------------------------------------------------------- text */

  // OCR regularly swaps these inside numbers and times.
  function normalise(raw) {
    return String(raw || "")
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksLikeLocation(s) {
    return LOCATION_RE.test(s || "");
  }

  function toMinutes(h, m, meridiem) {
    if (meridiem) {
      var mer = meridiem.toLowerCase().replace(/\./g, "").trim();
      if (mer === "pm" && h < 12) h += 12;
      if (mer === "am" && h === 12) h = 0;
    }
    if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
    return h * 60 + m;
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(min) { return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60); }

  function buildRange(sH, sM, sMer, eH, eM, eMer) {
    if (sMer && !eMer) eMer = sMer;
    var s = toMinutes(sH, sM, sMer);
    var e = toMinutes(eH, eM, eMer);

    if (s < 0 || e < 0) return null;

    // A missing "pm" is common: "11:00 - 1:00" means 13:00. Only apply the
    // +12h fix when the result is a plausible session length, so a genuinely
    // backwards range like "10:30 - 09:00" is rejected instead of being
    // stretched into a ten-hour lecture.
    if (e <= s) {
      var shifted = e + 720;
      if (shifted <= 1440 && shifted - s >= 15 && shifted - s <= 360) e = shifted;
    }

    if (!(e > s && e <= 1440 && e - s >= 10 && e - s <= 480)) return null;
    return { start: fmt(s), end: fmt(e), startMin: s, endMin: e };
  }

  // Accepts 09:00-10:30, 9.00–10.30, 9am-10:30am, 0900-1030, 2:00pm to 3:30pm
  function parseTimeRange(raw) {
    var s = normalise(raw);
    if (!s) return null;

    var m;
    // hh:mm - hh:mm
    m = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\s*-\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/i);
    if (m) return buildRange(+m[1], +m[2], m[3], +m[4], +m[5], m[6]);

    // 9am - 10:30am  /  9 - 10am
    m = s.match(/(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\s*-\s*(\d{1,2})\s*(?::|\s)?\s*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i);
    if (m) return buildRange(+m[1], 0, m[2], +m[3], m[4] ? +m[4] : 0, m[5]);

    // 0900-1030 (military, no separators)
    m = s.match(/\b(\d{3,4})\s*-\s*(\d{3,4})\b/);
    if (m) {
      var a = m[1], b = m[2];
      var ah = a.length === 3 ? +a.slice(0, 1) : +a.slice(0, 2);
      var am2 = a.length === 3 ? +a.slice(1) : +a.slice(2);
      var bh = b.length === 3 ? +b.slice(0, 1) : +b.slice(0, 2);
      var bm = b.length === 3 ? +b.slice(1) : +b.slice(2);
      return buildRange(ah, am2, null, bh, bm, null);
    }

    // bare "9 - 11" (last resort, only when both look like clock hours)
    m = s.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
    if (m && +m[1] <= 23 && +m[2] <= 23) return buildRange(+m[1], 0, null, +m[2], 0, null);

    return null;
  }

  function parseDay(text) {
    var t = normalise(text);
    var best = null;
    DAYS.forEach(function (d) {
      var m = t.match(d.re);
      if (m && (!best || m[0].length > best.len)) best = { day: d.day, len: m[0].length, text: m[0] };
    });
    return best ? best.day : null;
  }

  // Strips the parts we already understood, leaving the course + location.
  function leftovers(text, range, dayWord) {
    var t = normalise(text);
    if (range && range.raw) t = t.replace(range.raw, " ");
    else {
      t = t.replace(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/gi, " ")
           .replace(/\b\d{3,4}\s*-\s*\d{3,4}\b/g, " ")
           .replace(/\b\d{1,2}\s*[-~]\s*\d{1,2}\s*(am|pm)?\b/gi, " ")
           .replace(/\b(am|pm|a\.m\.|p\.m\.)\b/gi, " ");
    }
    if (dayWord) t = t.replace(dayWord, " ");
    DAYS.forEach(function (d) { t = t.replace(d.re, " "); });
    return t.replace(/^[\s\-–—:|.,;·•]+|[\s\-–—:|.,;·•]+$/g, "").replace(/\s+/g, " ").trim();
  }

  // "Lecture Hall A" / "LT1" / "Room 12" → location. Everything else → course.
  // Matching a whole phrase (rather than a bare keyword) keeps "MATH101
  // Lecture Hall A" from losing the word "Lecture" into the course name.
  function splitCourseAndLocation(text) {
    var t = normalise(text);
    if (!t) return { course: "", location: "" };

    var m = t.match(LOCATION_PHRASE);
    if (m) {
      var location = normalise(m[1]);
      var rest = normalise(t.slice(0, m.index) + " " + t.slice(m.index + m[0].length));
      rest = rest.replace(/^[\s\-|·•,;:]+|[\s\-|·•,;:]+$/g, "").trim();
      if (!rest && location) return { course: "", location: location };
      return { course: rest, location: location };
    }

    // Fall back to a separator if the image used columns rather than words.
    var parts = t.split(/\s*[|·•]\s*/).filter(Boolean);
    if (parts.length > 1) {
      var loc = parts.filter(looksLikeLocation).join(" ");
      var rest2 = parts.filter(function (p) { return !looksLikeLocation(p); }).join(" ");
      if (loc) return { course: rest2, location: loc };
    }
    return { course: t, location: "" };
  }

  function courseCode(text) {
    var m = normalise(text).match(CODE_RE);
    return m ? (m[1] + m[2]) : "";
  }

  /* ------------------------------------------------------------- parsing */

  /* lines: [{ text, x?, y?, width?, words?: [{text, x, width}] }]
     Returns { ok, rows, warnings, stats }. */
  function parseLines(lines) {
    var warnings = [];
    var rows = [];
    var src = (lines || []).map(function (l) {
      if (typeof l === "string") return { text: normalise(l) };
      return { text: normalise(l.text), x: l.x, y: l.y, width: l.width, words: l.words || null };
    }).filter(function (l) { return l.text; });

    if (!src.length) {
      return { ok: false, rows: [], warnings: ["No text was found in the image."], stats: { lines: 0 } };
    }

    // ---- pass 1: day name and a time in the same line -------------------
    src.forEach(function (ln) {
      var range = parseTimeRange(ln.text);
      if (!range) return;
      var day = parseDay(ln.text);
      if (day === null) return;
      range.raw = range.raw || matchRawTime(ln.text);
      var rest = leftovers(ln.text, range, dayWordFor(ln.text));
      var split = splitCourseAndLocation(rest);
      rows.push({
        day: day, start: range.start, end: range.end,
        course: split.course, location: split.location, source: "line"
      });
    });

    // ---- pass 2: grid with a header row of day names --------------------
    if (!rows.length) {
      var header = findDayHeader(src);
      if (header) {
        src.forEach(function (ln) {
          if (ln === header.line) return;
          var range = parseTimeRange(ln.text);
          if (!range) return;
          range.raw = range.raw || matchRawTime(ln.text);
          var day = nearestColumnDay(header.columns, ln);
          if (day === null) return;
          var rest = leftovers(ln.text, range, null);
          var split = splitCourseAndLocation(rest);
          rows.push({
            day: day, start: range.start, end: range.end,
            course: split.course, location: split.location, source: "grid"
          });
        });
      }
    }

    // ---- pass 3: days written as row labels ----------------------------
    if (!rows.length) {
      var current = null;
      src.forEach(function (ln) {
        var only = ln.text.replace(/[^A-Za-z]/g, "");
        var day = parseDay(ln.text);
        if (day !== null && only.length <= 9) { current = day; return; }
        if (current === null) return;
        var range = parseTimeRange(ln.text);
        if (!range) return;
        range.raw = range.raw || matchRawTime(ln.text);
        var rest = leftovers(ln.text, range, dayWordFor(ln.text));
        var split = splitCourseAndLocation(rest);
        rows.push({
          day: current, start: range.start, end: range.end,
          course: split.course, location: split.location, source: "rowlabel"
        });
      });
    }

    // ---- nothing recognised -------------------------------------------
    if (!rows.length) {
      var hasTimes = src.some(function (l) { return !!parseTimeRange(l.text); });
      warnings.push(hasTimes
        ? "Times were found but no day could be matched. Pick the day for each row below."
        : "No lecture times could be read from this image.");
      return { ok: false, rows: [], warnings: warnings, stats: { lines: src.length } };
    }

    // ---- tidy ----------------------------------------------------------
    rows = dedupe(rows).map(function (r) {
      var code = courseCode(r.course);
      if (!r.course) {
        r.course = code || "";
        if (!r.course) warnings.push("A lecture at " + r.start + " has no readable course name — type it in.");
      }
      if (!r.location) r.location = "";
      r.code = code;
      return r;
    });

    var missingDay = rows.filter(function (r) { return r.day === null || r.day === undefined; }).length;
    if (missingDay) warnings.push(missingDay + " lecture(s) have no day — choose one for each.");

    var unknownCourse = rows.filter(function (r) { return !r.course; }).length;
    if (unknownCourse) warnings.push(unknownCourse + " lecture(s) need a course name.");

    return {
      ok: true, rows: rows, warnings: unique(warnings),
      stats: { lines: src.length, rows: rows.length }
    };
  }

  function matchRawTime(text) {
    var m = normalise(text).match(/\d{1,2}\s*[:.]\s*\d{2}\s*(?:am|pm)?\s*-\s*\d{1,2}\s*[:.]\s*\d{2}\s*(?:am|pm)?/i)
         || normalise(text).match(/\b\d{3,4}\s*-\s*\d{3,4}\b/)
         || normalise(text).match(/\d{1,2}\s*(?:am|pm)\s*-\s*\d{1,2}\s*(?::\s*\d{2})?\s*(?:am|pm)?/i);
    return m ? m[0] : null;
  }

  function dayWordFor(text) {
    var t = normalise(text), best = null;
    DAYS.forEach(function (d) {
      var m = t.match(d.re);
      if (m && (!best || m[0].length > best.length)) best = m[0];
    });
    return best;
  }

  function unique(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  function dedupe(rows) {
    var seen = {};
    return rows.filter(function (r) {
      var k = [r.day, r.start, r.end, (r.course || "").toLowerCase()].join("|");
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  function wordX(line, re) {
    if (line.words && line.words.length) {
      for (var i = 0; i < line.words.length; i++) {
        var w = line.words[i];
        if (re.test(w.text)) return (w.x != null) ? w.x + (w.width || 0) / 2 : null;
      }
    }
    return null;
  }

  // A header is a line holding two or more distinct day names, each with
  // an x coordinate. Days-as-columns timetables nearly always have one.
  function findDayHeader(lines) {
    var best = null;
    lines.forEach(function (ln) {
      var cols = [], used = {};
      DAYS.forEach(function (d) {
        var m = ln.text.match(d.re);
        if (!m || used[d.day]) return;
        var x = wordX(ln, d.re);
        if (x === null) return;
        used[d.day] = 1;
        cols.push({ day: d.day, x: x });
      });
      if (cols.length >= 2 && (!best || cols.length > best.columns.length)) {
        best = { line: ln, columns: cols };
      }
    });
    if (!best) return null;
    best.columns.sort(function (a, b) { return a.x - b.x; });
    return best;
  }

  function nearestColumnDay(columns, line) {
    var x = null;
    if (line.words && line.words.length) {
      var xs = line.words.map(function (w) { return (w.x != null) ? w.x + (w.width || 0) / 2 : null; })
        .filter(function (v) { return v !== null; });
      if (xs.length) x = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    }
    if (x === null && line.x != null) x = line.x;
    if (x === null) return null;

    var best = null, bestD = Infinity;
    columns.forEach(function (c) {
      var d = Math.abs(c.x - x);
      if (d < bestD) { bestD = d; best = c.day; }
    });
    return best;
  }

  /* ---------------------------------------------------------- extraction */

  var TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-ocr="1"]')) return resolve();
      var s = document.createElement("script");
      s.src = src; s.async = true; s.setAttribute("data-ocr", "1");
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load the text-recognition library. Check your connection and try again.")); };
      document.head.appendChild(s);
    });
  }

  var ACCEPTED = /^image\/(png|jpe?g)$/i;
  var MAX_BYTES = 10 * 1024 * 1024;

  function validateFile(file) {
    if (!file) return "Choose an image first.";
    if (!ACCEPTED.test(file.type || "")) {
      return "That file is not a PNG or JPG. Please choose a .png, .jpg or .jpeg image.";
    }
    if (file.size > MAX_BYTES) {
      return "That image is " + Math.round(file.size / 1048576) + " MB. Please use one under 10 MB.";
    }
    return null;
  }

  /* Runs OCR, then parses. `onProgress(0..1, label)` reports status. */
  function extractFromImage(file, onProgress) {
    var bad = validateFile(file);
    if (bad) return Promise.reject(new Error(bad));

    var report = onProgress || function () {};
    report(0.02, "Loading text recognition\u2026");

    return loadScript(TESSERACT_URL).then(function () {
      if (!GLOBAL.Tesseract) throw new Error("The text-recognition library did not start.");
      report(0.08, "Reading the image\u2026");
      return GLOBAL.Tesseract.recognize(file, "eng", {
        logger: function (m) {
          if (m.status === "recognizing text") report(0.1 + 0.8 * (m.progress || 0), "Reading the image\u2026");
        }
      });
    }).then(function (res) {
      report(0.94, "Working out the timetable\u2026");
      var data = res && res.data ? res.data : {};
      var lines = (data.lines && data.lines.length)
        ? data.lines.map(function (l) {
            return {
              text: l.text, x: l.bbox ? l.bbox.x0 : null, y: l.bbox ? l.bbox.y0 : null,
              width: l.bbox ? l.bbox.x1 - l.bbox.x0 : null,
              words: (l.words || []).map(function (w) {
                return { text: w.text, x: w.bbox ? w.bbox.x0 : null, width: w.bbox ? w.bbox.x1 - w.bbox.x0 : null };
              })
            };
          })
        : String(data.text || "").split(/\r?\n/).map(function (t) { return { text: t }; });

      var out = parseLines(lines);
      out.text = String(data.text || "");
      report(1, "Done");
      return out;
    });
  }

  return {
    DAY_NAMES: DAY_NAMES,
    parseLines: parseLines,
    parseTimeRange: parseTimeRange,
    parseDay: parseDay,
    splitCourseAndLocation: splitCourseAndLocation,
    courseCode: courseCode,
    validateFile: validateFile,
    extractFromImage: extractFromImage,
    MAX_BYTES: MAX_BYTES,
    ACCEPTED: ACCEPTED
  };
});
