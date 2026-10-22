/* =====================================================================
   Study Planner — timetable generation engine
   Pure logic. No DOM, no storage, no network. Fully unit-testable.

   Loads as a classic <script> (global StudyEngine) and as a CommonJS
   module (require), so the browser and the test runner share one source.
   ===================================================================== */
var StudyEngine = (function () {
  "use strict";

  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  var PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3 };
  var MIN_SESSION = 30;        // never schedule a session shorter than this
  var MIN_SEGMENT = 15;        // discard free slivers below this
  var DEFAULT_SESSION = 60;
  var DEFAULT_BREAK = 10;
  var DEFAULT_MAX_PER_DAY = 4;

  /* ---------- time helpers ---------- */

  function toMin(hhmm) {
    if (typeof hhmm !== "string") return NaN;
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return NaN;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return NaN;
    return h * 60 + mi;
  }

  function toHHMM(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function fmtRange(a, b) { return toHHMM(a) + "\u2013" + toHHMM(b); }

  /* ---------- interval maths ---------- */

  // base: [{start,end}] ; cuts: [{start,end}] -> base minus every cut
  function subtract(base, cuts) {
    var out = base.slice();
    cuts.forEach(function (c) {
      var next = [];
      out.forEach(function (seg) {
        if (c.end <= seg.start || c.start >= seg.end) { next.push(seg); return; }
        if (c.start > seg.start) next.push({ start: seg.start, end: Math.min(c.start, seg.end) });
        if (c.end < seg.end) next.push({ start: Math.max(c.end, seg.start), end: seg.end });
      });
      out = next;
    });
    return out
      .filter(function (s) { return s.end - s.start >= MIN_SEGMENT; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  function mergeOverlapping(list) {
    var sorted = list.slice().sort(function (a, b) { return a.start - b.start; });
    var out = [];
    sorted.forEach(function (iv) {
      var last = out[out.length - 1];
      if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
      else out.push({ start: iv.start, end: iv.end });
    });
    return out;
  }

  /* ---------- dates ---------- */

  function daysUntil(dateStr, from) {
    if (!dateStr) return null;
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    var base = new Date(from || new Date());
    base.setHours(0, 0, 0, 0);
    return Math.round((d - base) / 86400000);
  }

  function dateForDay(startDate, dayIndex, weekday) {
    // first calendar date on/after startDate whose weekday matches
    var d = new Date(startDate + "T00:00:00");
    if (isNaN(d.getTime())) d = new Date();
    var shift = (weekday - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + shift + dayIndex * 7);
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

  /* ---------- urgency ---------- */

  // Higher = schedule earlier / more of it. Explainable, not a black box.
  function urgency(course, today) {
    var p = PRIORITY_WEIGHT[course.priority] || 2;
    var diff = Math.min(5, Math.max(1, +course.difficulty || 3));
    var exam = 0;
    var d = daysUntil(course.examDate, today);
    if (d !== null && d >= 0) exam = Math.max(0, 30 - d) / 10;      // 0..3
    var deadline = 0;
    (course.deadlines || []).forEach(function (dl) {
      var dd = daysUntil(dl.date, today);
      if (dd !== null && dd >= 0) deadline = Math.max(deadline, Math.max(0, 21 - dd) / 14); // 0..1.5
    });
    return p * 2 + diff + exam + deadline;
  }

  /* ---------- input validation ----------
     The spec is explicit: never invent a timetable. If something
     essential is missing we return it and make the UI ask.            */

  function validatePlanInput(profile) {
    var missing = [];
    var p = profile || {};
    var courses = (p.courses || []).filter(function (c) { return c && !c.archived; });

    if (courses.length === 0) {
      missing.push({ field: "courses", message: "Add at least one course before generating a timetable." });
    }

    var withoutTopics = courses.filter(function (c) {
      return !(c.topics || []).length && !(c.estimatedMinutes > 0);
    });
    if (withoutTopics.length) {
      missing.push({
        field: "topics",
        message: "These courses have no topics or estimated reading time yet: " +
                 withoutTopics.map(function (c) { return c.name || c.code || "Untitled"; }).join(", ") + ".",
        courses: withoutTopics.map(function (c) { return c.id; })
      });
    }

    var studyWindows = (p.availability || []).filter(function (a) { return a.kind === "study"; });
    if (studyWindows.length === 0) {
      missing.push({ field: "availability", message: "Set at least one available study period (days and times) so sessions have somewhere to go." });
    }

    var badWindow = studyWindows.filter(function (a) { return !(toMin(a.start) < toMin(a.end)); });
    if (badWindow.length) {
      missing.push({ field: "availability", message: "Some study periods end before they start. Please fix them." });
    }

    var prefs = p.preferences || {};
    var session = +prefs.sessionMinutes;
    if (!session || session < MIN_SESSION) {
      missing.push({ field: "preferences.sessionMinutes", message: "Choose a session length of at least " + MIN_SESSION + " minutes." });
    }

    return { ok: missing.length === 0, missing: missing };
  }

  /* ---------- free time ---------- */

  // Free study intervals per weekday, after removing lectures and blocked periods.
  function freeIntervalsByDay(profile) {
    var prefs = profile.preferences || {};
    var buffer = Math.max(0, +prefs.lectureBufferMinutes || 0);
    var byDay = {};

    for (var d = 0; d < 7; d++) {
      var windows = (profile.availability || [])
        .filter(function (a) { return +a.day === d && a.kind === "study"; })
        .map(function (a) { return { start: toMin(a.start), end: toMin(a.end) }; })
        .filter(function (a) { return a.start < a.end; });

      if (!windows.length) { byDay[d] = []; continue; }

      var cuts = [];
      (profile.lectures || []).forEach(function (l) {
        if (+l.day !== d) return;
        var s = toMin(l.start), e = toMin(l.end);
        if (s < e) cuts.push({ start: Math.max(0, s - buffer), end: e + buffer });
      });
      (profile.availability || []).forEach(function (a) {
        if (+a.day !== d || a.kind !== "blocked") return;
        var s = toMin(a.start), e = toMin(a.end);
        if (s < e) cuts.push({ start: s, end: e });
      });

      byDay[d] = subtract(mergeOverlapping(windows), mergeOverlapping(cuts));
    }
    return byDay;
  }

  /* ---------- automatic study windows ---------- */

  /* A student who has just uploaded a lecture timetable should not have to
     configure anything before getting a reading plan. These windows are
     derived from the lectures alone: the normal study day minus lecture
     times (plus an optional travel buffer). They are ordinary availability
     rows, so they stay visible and editable on the timetable page. */
  var DEFAULT_STUDY_BOUNDS = {
    0: ["10:00", "19:00"],   // Sunday
    1: ["08:00", "21:00"],
    2: ["08:00", "21:00"],
    3: ["08:00", "21:00"],
    4: ["08:00", "21:00"],
    5: ["08:00", "21:00"],
    6: ["09:00", "18:00"]    // Saturday
  };

  function deriveStudyWindows(lectures, options) {
    var o = options || {};
    var buffer = Math.max(0, +o.buffer || 0);
    var minLength = Math.max(MIN_SESSION, +o.minLength || MIN_SESSION);
    var bounds = o.bounds || DEFAULT_STUDY_BOUNDS;
    var out = [];

    for (var d = 0; d < 7; d++) {
      var b = bounds[d];
      if (!b) continue;
      var start = toMin(b[0]), end = toMin(b[1]);
      if (!(end > start)) continue;

      var cuts = (lectures || [])
        .filter(function (l) { return +l.day === d; })
        .map(function (l) { return { start: toMin(l.start), end: toMin(l.end) }; })
        .filter(function (c) { return c.start < c.end; })
        .map(function (c) { return { start: c.start - buffer, end: c.end + buffer }; });

      subtract([{ start: start, end: end }], cuts).forEach(function (seg) {
        if (seg.end - seg.start >= minLength) {
          out.push({
            day: d, start: toHHMM(seg.start), end: toHHMM(seg.end),
            kind: "study", label: "Free time"
          });
        }
      });
    }
    return out;
  }

  /* ---------- demand ---------- */

  function demandMinutes(course, sessionMinutes) {
    if (+course.estimatedMinutes > 0) return +course.estimatedMinutes;
    var topics = course.topics || [];
    if (!topics.length) return 0;
    return topics.reduce(function (sum, t) {
      return sum + (+t.minutes > 0 ? +t.minutes : sessionMinutes);
    }, 0);
  }

  /* ---------- generation ---------- */

  function generatePlan(profile, options) {
    var opts = options || {};
    var today = opts.today || new Date().toISOString().slice(0, 10);
    var check = validatePlanInput(profile);

    if (!check.ok) {
      return { ok: false, missing: check.missing, sessions: [], unscheduled: [], stats: null };
    }

    var prefs = profile.preferences || {};
    var sessionMinutes = Math.max(MIN_SESSION, +prefs.sessionMinutes || DEFAULT_SESSION);
    var breakMinutes = Math.max(0, +prefs.breakMinutes === 0 ? 0 : (+prefs.breakMinutes || DEFAULT_BREAK));
    var maxPerDay = Math.max(1, +prefs.maxSessionsPerDay || DEFAULT_MAX_PER_DAY);
    var weeks = Math.max(1, +opts.weeks || 1);
    var startDate = prefs.startDate || today;

    var courses = (profile.courses || [])
      .filter(function (c) { return c && !c.archived; })
      .map(function (c) {
        return {
          course: c,
          score: urgency(c, today),
          remaining: demandMinutes(c, sessionMinutes)
        };
      })
      .filter(function (c) { return c.remaining > 0; })
      .sort(function (a, b) { return b.score - a.score; });

    if (!courses.length) {
      return {
        ok: false,
        missing: [{ field: "topics", message: "None of your courses have any remaining reading to schedule." }],
        sessions: [], unscheduled: [], stats: null
      };
    }

    // Mutable copy of free time so placements consume it.
    var freeByDay = {};
    for (var d = 0; d < 7; d++) {
      freeByDay[d] = freeIntervalsByDay(profile)[d].map(function (iv) {
        return { start: iv.start, end: iv.end };
      });
    }

    var sessions = [];
    var perCourseDay = {};      // courseId -> { day -> count }
    var perDayCount = {};       // day -> total sessions
    var seq = 0;

    // Place one session into the best day for this course.
    // "Best" = fewest existing sessions for that course (spreads the load),
    // tie-broken by earliest day, then earliest time.
    function placeOne(entry, dayIndex, week) {
      var course = entry.course;
      var id = course.id;
      perCourseDay[id] = perCourseDay[id] || {};

      var candidates = [];
      for (var d = 0; d < 7; d++) {
        if ((perDayCount[d] || 0) >= maxPerDay) continue;
        freeByDay[d].forEach(function (iv, i) {
          var len = iv.end - iv.start;
          if (len < Math.min(MIN_SESSION, sessionMinutes)) return;
          var take = Math.min(sessionMinutes, len);
          if (take < MIN_SESSION) return;
          candidates.push({
            day: d, index: i, start: iv.start, end: iv.start + take,
            load: perCourseDay[id][d] || 0,
            dayLoad: perDayCount[d] || 0
          });
        });
      }
      if (!candidates.length) return null;

      candidates.sort(function (a, b) {
        if (a.load !== b.load) return a.load - b.load;           // spread across days
        if (a.dayLoad !== b.dayLoad) return a.dayLoad - b.dayLoad;
        if (a.day !== b.day) return a.day - b.day;
        return a.start - b.start;
      });

      var pick = candidates[0];
      var iv = freeByDay[pick.day][pick.index];
      var consumed = pick.end - iv.start;

      // consume from the interval, leaving a break before the next session
      var rest = iv.end - pick.end;
      if (rest > breakMinutes + MIN_SEGMENT) {
        iv.start = pick.end + breakMinutes;
      } else if (rest >= MIN_SEGMENT) {
        iv.start = pick.end;
      } else {
        freeByDay[pick.day].splice(pick.index, 1);
      }
      freeByDay[pick.day] = freeByDay[pick.day].filter(function (s) { return s.end - s.start >= MIN_SEGMENT; });

      perCourseDay[id][pick.day] = (perCourseDay[id][pick.day] || 0) + 1;
      perDayCount[pick.day] = (perDayCount[pick.day] || 0) + 1;

      seq += 1;
      return {
        id: "s" + seq + "-" + course.id + "-" + pick.day + "-" + pick.start,
        courseId: course.id,
        courseName: course.name || course.code || "Course",
        topicId: null,
        day: pick.day,
        date: dateForDay(startDate, week, pick.day),
        week: week,
        start: toHHMM(pick.start),
        end: toHHMM(pick.end),
        startMin: pick.start,
        endMin: pick.end,
        minutes: consumed,
        status: "pending",
        locked: false
      };
    }

    // Distribute each course's demand across the requested weeks.
    var perWeek = Math.max(1, weeks);
    courses.forEach(function (entry) {
      var share = Math.ceil(entry.remaining / perWeek);
      var placed = 0;
      for (var w = 0; w < perWeek && placed < entry.remaining; w++) {
        var budget = Math.min(share, entry.remaining - placed);
        while (budget >= MIN_SESSION) {
          var want = Math.min(sessionMinutes, budget);
          var before = sessions.length;
          var s = placeOne(entry, w, w);
          if (!s) break;
          // trim the last session to the exact remaining budget when it is still valid
          if (want < sessionMinutes && s.minutes > want && want >= MIN_SESSION) {
            s.endMin = s.startMin + want;
            s.end = toHHMM(s.endMin);
            s.minutes = want;
          }
          sessions.push(s);
          placed += s.minutes;
          budget -= s.minutes;
          if (sessions.length === before) break;
        }
      }
      entry.unscheduledMinutes = Math.max(0, entry.remaining - placed);
    });

    var unscheduled = courses
      .filter(function (e) { return e.unscheduledMinutes > 0; })
      .map(function (e) {
        return {
          courseId: e.course.id,
          courseName: e.course.name || e.course.code || "Course",
          minutes: e.unscheduledMinutes,
          reason: "Not enough free study time to fit " + Math.round(e.unscheduledMinutes) +
                  " more minutes for this course."
        };
      });

    sessions.sort(function (a, b) {
      if (a.week !== b.week) return a.week - b.week;
      if (a.day !== b.day) return a.day - b.day;
      return a.startMin - b.startMin;
    });

    return {
      ok: true,
      missing: [],
      sessions: sessions,
      unscheduled: unscheduled,
      stats: {
        sessions: sessions.length,
        minutes: sessions.reduce(function (s, x) { return s + x.minutes; }, 0),
        perCourse: courses.map(function (e) {
          return {
            courseId: e.course.id,
            courseName: e.course.name || e.course.code || "Course",
            scheduled: sessions.filter(function (s) { return s.courseId === e.course.id; })
                                .reduce(function (sum, s) { return sum + s.minutes; }, 0),
            requested: e.remaining
          };
        })
      }
    };
  }

  /* ---------- conflict checking (used by tests and by manual edits) ---------- */

  function findConflicts(sessions, profile) {
    var conflicts = [];
    var byDay = {};
    (sessions || []).forEach(function (s) {
      (byDay[s.day] = byDay[s.day] || []).push(s);
    });

    Object.keys(byDay).forEach(function (day) {
      var list = byDay[day].slice().sort(function (a, b) { return a.startMin - b.startMin; });
      for (var i = 1; i < list.length; i++) {
        if (list[i].startMin < list[i - 1].endMin) {
          conflicts.push({ type: "session-overlap", day: +day, a: list[i - 1].id, b: list[i].id });
        }
      }
      // sessions must not sit on top of a lecture
      (profile.lectures || []).forEach(function (l) {
        if (+l.day !== +day) return;
        var ls = toMin(l.start), le = toMin(l.end);
        list.forEach(function (s) {
          if (s.startMin < le && s.endMin > ls) {
            conflicts.push({ type: "session-overlaps-lecture", day: +day, session: s.id, lecture: l.id || l.courseId });
          }
        });
      });
      // and must not sit inside a blocked period
      (profile.availability || []).forEach(function (a) {
        if (+a.day !== +day || a.kind !== "blocked") return;
        var bs = toMin(a.start), be = toMin(a.end);
        list.forEach(function (s) {
          if (s.startMin < be && s.endMin > bs) {
            conflicts.push({ type: "session-in-blocked", day: +day, session: s.id });
          }
        });
      });
    });
    return conflicts;
  }

  /* ---------- regeneration ----------
     Rebuilds only what is still ahead, keeping anything the student
     locked or already completed exactly where it is.                  */

  function regenerateRemaining(profile, existing, options) {
    var opts = options || {};
    var today = opts.today || new Date().toISOString().slice(0, 10);
    var keep = (existing || []).filter(function (s) {
      return s.locked || s.status === "done" || s.status === "missed";
    });
    var fresh = generatePlan(profile, opts);
    if (!fresh.ok) return fresh;

    // reserve the kept slots so new sessions cannot land on them
    var reserved = keep.map(function (s) {
      return { day: s.day, start: s.startMin, end: s.endMin };
    });
    var placed = [];
    fresh.sessions.forEach(function (s) {
      var clash = reserved.some(function (r) {
        return r.day === s.day && s.startMin < r.end && s.endMin > r.start;
      });
      if (!clash) placed.push(s);
    });

    var all = keep.concat(placed).sort(function (a, b) {
      if (a.week !== b.week) return a.week - b.week;
      if (a.day !== b.day) return a.day - b.day;
      return a.startMin - b.startMin;
    });

    return {
      ok: true,
      missing: [],
      sessions: all,
      kept: keep.length,
      regenerated: placed.length,
      unscheduled: fresh.unscheduled,
      stats: fresh.stats
    };
  }

  /* ---------- progress ---------- */

  function progressFor(sessions, dateStr) {
    var list = (sessions || []).filter(function (s) { return s.date === dateStr; });
    return summarise(list);
  }

  function weeklyProgress(sessions, weekIndex) {
    var list = (sessions || []).filter(function (s) { return s.week === weekIndex; });
    return summarise(list);
  }

  function summarise(list) {
    var done = list.filter(function (s) { return s.status === "done"; }).length;
    var missed = list.filter(function (s) { return s.status === "missed"; }).length;
    var total = list.length;
    var pending = total - done - missed;
    var minutes = list.filter(function (s) { return s.status === "done"; })
                      .reduce(function (a, s) { return a + s.minutes; }, 0);
    return {
      total: total, done: done, missed: missed, pending: pending,
      minutes: minutes,
      percent: total === 0 ? 0 : Math.round((done / total) * 100)
    };
  }

  return {
    DAY_NAMES: DAY_NAMES,
    DAY_SHORT: DAY_SHORT,
    MIN_SESSION: MIN_SESSION,
    toMin: toMin,
    toHHMM: toHHMM,
    fmtRange: fmtRange,
    subtract: subtract,
    mergeOverlapping: mergeOverlapping,
    daysUntil: daysUntil,
    dateForDay: dateForDay,
    urgency: urgency,
    validatePlanInput: validatePlanInput,
    freeIntervalsByDay: freeIntervalsByDay,
    deriveStudyWindows: deriveStudyWindows,
    DEFAULT_STUDY_BOUNDS: DEFAULT_STUDY_BOUNDS,
    demandMinutes: demandMinutes,
    generatePlan: generatePlan,
    regenerateRemaining: regenerateRemaining,
    findConflicts: findConflicts,
    progressFor: progressFor,
    weeklyProgress: weeklyProgress,
    summarise: summarise
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = StudyEngine; }
