/* =====================================================================
   Study Planner — views
   Each view renders into ctx.root and wires its own events.
   ctx = { root, user, navigate, state, refreshNav }
   ===================================================================== */
var Views = (function () {
  "use strict";
  var E = StudyEngine, S = StudyStore, A = StudyAuth, U = UI;

  /* ---------- shared fragments ---------- */

  function courseOptions(courses, selected) {
    if (!courses.length) return '<option value="">No courses yet</option>';
    return courses.map(function (c) {
      return '<option value="' + U.esc(c.id) + '"' + (c.id === selected ? " selected" : "") + ">" +
        U.esc(c.name) + (c.code ? " (" + U.esc(c.code) + ")" : "") + "</option>";
    }).join("");
  }

  function dayOptions(selected) {
    return E.DAY_NAMES.map(function (n, i) {
      return '<option value="' + i + '"' + (+selected === i ? " selected" : "") + ">" + n + "</option>";
    }).join("");
  }

  // Compact weekly grid used by the timetable and the generated plan.
  function weekGrid(byDay, title) {
    var cols = "";
    for (var d = 0; d < 7; d++) {
      var items = (byDay[d] || []).slice().sort(function (a, b) { return a.startMin - b.startMin; });
      cols += '<div class="day-col"><h3>' + E.DAY_SHORT[d] + "</h3>" +
        (items.length ? items.map(function (it) {
          return '<div class="slot ' + it.kind + (it.status ? " " + it.status : "") + '">' +
            "<b>" + U.esc(it.title) + "</b>" +
            "<time>" + U.esc(it.start) + "\u2013" + U.esc(it.end) + "</time>" +
            (it.note ? '<div class="muted" style="font-size:.6875rem">' + U.esc(it.note) + "</div>" : "") +
          "</div>";
        }).join("") : '<p class="muted" style="font-size:.75rem">\u2014</p>') +
      "</div>";
    }
    return (title ? "<h2>" + U.esc(title) + "</h2>" : "") + '<div class="week"><div class="week-grid">' + cols + "</div></div>";
  }

  function progressBar(done, total, label) {
    var pct = total === 0 ? 0 : Math.round((done / total) * 100);
    var text = total === 0 ? "No sessions scheduled \u2014 0%" : done + " of " + total + " sessions completed \u2014 " + pct + "%";
    return '<div class="bar-head"><span class="l">' + U.esc(label) + '</span><span class="c">' + U.esc(text) + "</span></div>" +
      '<div class="bar" role="progressbar" aria-label="' + U.esc(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
      '<div class="bar-fill" style="width:' + pct + '%"></div></div>';
  }

  /* =====================================================================
     Auth
     ===================================================================== */

  function authShell(inner) {
    return '<div class="auth-wrap">' +
      '<div class="auth-head"><h1>Study Planner</h1>' +
      "<p>Plan your reading around your lectures.</p></div>" +
      '<div class="surface">' + inner + "</div>" +
      (A.isSignedIn() ? "" : devBanner()) +
    "</div>";
  }

  function devBanner() {
    var b = S.backendStatus ? S.backendStatus() : { mode: "local", healthy: true, reason: "" };
    // Local-only mode is deliberately silent. The banner is reserved for a
    // *configured* backend that is failing, which is a real fault worth
    // reporting rather than a notice about where data is kept.
    if (b.mode === "supabase" && !b.healthy) {
      return U.banner("err",
        "<b>Database not ready.</b> Supabase is configured but its tables could not be read — " +
        U.esc(b.reason) + ". Run <code>supabase/schema.sql</code> in your project's SQL Editor, then reload.");
    }
    return "";
  }

  function googleButton() {
    if (!A.supportsGoogle()) return "";
    return '<div class="divider">or</div>' +
      '<button class="btn ghost wide" type="button" data-act="google">Continue with Google</button>';
  }

  function login(ctx) {
    ctx.root.innerHTML = authShell(
      '<form id="login-form" novalidate>' +
        '<div class="field" data-field="email"><label for="l-email">Email</label>' +
          '<input id="l-email" name="email" type="email" autocomplete="email" required>' +
          '<div class="err"></div></div>' +
        '<div class="field" data-field="password"><label for="l-password">Password</label>' +
          '<input id="l-password" name="password" type="password" autocomplete="current-password" required>' +
          '<div class="err"></div></div>' +
        '<div id="login-msg"></div>' +
        '<button class="btn wide" type="submit">Sign in</button>' +
        googleButton() +
      "</form>" +
      '<p class="auth-switch">New here? <button type="button" data-act="go-register">Create an account</button></p>'
    );

    var form = ctx.root.querySelector("#login-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      U.clearErrors(form);
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      A.login({ email: form.email.value, password: form.password.value })
        .then(function () { U.toast("Signed in"); ctx.afterAuth(); })
        .catch(function (err) {
          if (err.fields) U.applyErrors(form, err.fields);
          else form.querySelector("#login-msg").innerHTML = U.banner("err", U.esc(err.message));
          btn.disabled = false;
        });
    });

    ctx.root.querySelector('[data-act="go-register"]').addEventListener("click", function () { ctx.navigate("#/register"); });
    var g = ctx.root.querySelector('[data-act="google"]');
    if (g) g.addEventListener("click", function () {
      A.loginWithGoogle().catch(function (err) { form.querySelector("#login-msg").innerHTML = U.banner("err", U.esc(err.message)); });
    });
  }

  function register(ctx) {
    ctx.root.innerHTML = authShell(
      '<form id="reg-form" novalidate>' +
        '<div class="field" data-field="name"><label for="r-name">Full name</label>' +
          '<input id="r-name" name="name" type="text" autocomplete="name" required><div class="err"></div></div>' +
        '<div class="field" data-field="email"><label for="r-email">Email</label>' +
          '<input id="r-email" name="email" type="email" autocomplete="email" required><div class="err"></div></div>' +
        '<div class="field" data-field="password"><label for="r-password">Password</label>' +
          '<input id="r-password" name="password" type="password" autocomplete="new-password" required>' +
          '<div class="hint">At least 8 characters, with a letter and a number.</div><div class="err"></div></div>' +
        '<div class="field" data-field="confirm"><label for="r-confirm">Confirm password</label>' +
          '<input id="r-confirm" name="confirm" type="password" autocomplete="new-password" required><div class="err"></div></div>' +
        '<div id="reg-msg"></div>' +
        '<button class="btn wide" type="submit">Create account</button>' +
        googleButton() +
      "</form>" +
      '<p class="auth-switch">Already have an account? <button type="button" data-act="go-login">Sign in</button></p>'
    );

    var form = ctx.root.querySelector("#reg-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      U.clearErrors(form);
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      A.register({
        name: form.name.value, email: form.email.value,
        password: form.password.value, confirm: form.confirm.value
      }).then(function () {
        U.toast("Account created");
        ctx.afterAuth();
      }).catch(function (err) {
        if (err.fields) U.applyErrors(form, err.fields);
        else form.querySelector("#reg-msg").innerHTML = U.banner(err.needsConfirmation ? "ok" : "err", U.esc(err.message));
        btn.disabled = false;
      });
    });

    ctx.root.querySelector('[data-act="go-login"]').addEventListener("click", function () { ctx.navigate("#/login"); });
    var g = ctx.root.querySelector('[data-act="google"]');
    if (g) g.addEventListener("click", function () {
      A.loginWithGoogle().catch(function (err) { form.querySelector("#reg-msg").innerHTML = U.banner("err", U.esc(err.message)); });
    });
  }

  /* =====================================================================
     Dashboard
     ===================================================================== */

  function dashboard(ctx) {
    ctx.root.innerHTML = '<div class="page-head"><h1>Hello, ' + U.esc((ctx.user.name || "").split(" ")[0]) + "</h1>" +
      "<p>Here is where your week stands.</p></div>" + devBanner() + '<div id="dash"><p class="empty">Loading\u2026</p></div>';

    Promise.all([S.courses.list(), S.sessions.list(), S.settings.get()]).then(function (r) {
      var courses = r[0], sessions = r[1], prefs = r[2];
      var today = U.todayISO();
      var todaySessions = sessions.filter(function (s) { return s.date === today; });
      var daily = E.progressFor(sessions, today);
      var weekly = E.weeklyProgress(sessions, 0);

      var upcomingExams = courses.filter(function (c) {
        var d = E.daysUntil(c.examDate, today); return d !== null && d >= 0;
      }).sort(function (a, b) { return new Date(a.examDate) - new Date(b.examDate); });

      var upcomingDeadlines = [];
      courses.forEach(function (c) {
        (c.deadlines || []).forEach(function (dl) {
          var d = E.daysUntil(dl.date, today);
          if (d !== null && d >= 0) upcomingDeadlines.push({ course: c, dl: dl, days: d });
        });
      });
      upcomingDeadlines.sort(function (a, b) { return a.days - b.days; });

      var html =
        '<div class="grid three" style="margin-bottom:24px">' +          '<div class="tile"><div class="n">' + courses.length + '</div><div class="l">Courses</div></div>' +
          '<div class="tile"><div class="n">' + todaySessions.length + '</div><div class="l">Reading sessions today</div></div>' +
          '<div class="tile"><div class="n">' + upcomingExams.length + '</div><div class="l">Upcoming exams</div></div>' +
          '<div class="tile"><div class="n">' + upcomingDeadlines.length + '</div><div class="l">Upcoming deadlines</div></div>' +
        "</div>" +

        '<div class="surface">' + progressBar(daily.done, daily.total, "Today\u2019s progress") +
          '<div style="height:16px"></div>' + progressBar(weekly.done, weekly.total, "This week\u2019s progress") + "</div>" +

        '<div class="surface"><h2>Today</h2>' +
          (todaySessions.length
            ? '<ul class="list">' + todaySessions.sort(function (a, b) { return a.startMin - b.startMin; }).map(function (s) {
                return "<li><div class=\"grow\"><div class=\"title\">" + U.esc(s.start) + "\u2013" + U.esc(s.end) + " \u00b7 " +
                  U.esc(courseName(courses, s.courseId)) + "</div>" +
                  '<div class="sub">' + U.esc(s.status) + "</div></div></li>";
              }).join("") + "</ul>"
            : U.empty("No reading sessions scheduled for today.")) +
        "</div>" +

        '<div class="surface"><h2>Exams and deadlines</h2>' +
          (upcomingExams.length || upcomingDeadlines.length
            ? '<ul class="list">' +
                upcomingExams.map(function (c) {
                  return "<li><div class=\"grow\"><div class=\"title\">" + U.esc(c.name) + ' <span class="tag high">Exam</span></div>' +
                    '<div class="sub">' + U.fmtDate(c.examDate) + " \u00b7 " + E.daysUntil(c.examDate, today) + " days</div></div></li>";
                }).join("") +
                upcomingDeadlines.map(function (x) {
                  return "<li><div class=\"grow\"><div class=\"title\">" + U.esc(x.dl.title || "Deadline") + "</div>" +
                    '<div class="sub">' + U.esc(x.course.name) + " \u00b7 " + U.fmtDate(x.dl.date) + " \u00b7 " + x.days + " days</div></div></li>";
                }).join("") + "</ul>"
            : U.empty("No exams or deadlines recorded yet.")) +
        "</div>" +

        '<button class="btn coral" type="button" data-act="go-generate">Generate my reading timetable</button>';

      var host = ctx.root.querySelector("#dash");
      host.innerHTML = html;
      host.querySelector('[data-act="go-generate"]').addEventListener("click", function () { ctx.navigate("#/generate"); });

      var snap = offerableImport(ctx, courses);
      if (snap) {
        var card = document.createElement("div");
        card.className = "surface";
        card.innerHTML = U.banner("dev",
          "<b>Data found in this browser.</b> " + snap.count + " item(s) were saved by a previous " +
          "local account (" + U.esc(snap.email) + "). Import them into your real account?") +
          '<button class="btn" type="button" data-act="import">Import ' + snap.count + " item(s)</button>";
        host.appendChild(card);
        var imp = card.querySelector('[data-act="import"]');
        imp.addEventListener("click", function () {
          imp.disabled = true;
          imp.textContent = "Importing\u2026";
          S.importLocalSnapshot(ctx.user.id, snap).then(function (n) {
            UI.toast("Imported " + n + " item(s)");
            dashboard(ctx);
          }).catch(function (e) {
            imp.disabled = false;
            imp.textContent = "Retry import";
            UI.toast("Import failed: " + e.message);
          });
        });
      }
    }).catch(showError(ctx));
  }

  // Offers a one-time import when the real backend is live but this browser
  // still holds data from the old local driver. Only ever on an empty
  // account, so it cannot overwrite data that already exists.
  function offerableImport(ctx, courses) {
    if (!S.localSnapshot || !S.backendStatus) return null;
    if (S.backendStatus().mode !== "supabase") return null;
    if (courses.length) return null;
    return S.localSnapshot(ctx.user.email);
  }

  function courseName(courses, id) {
    var c = (courses || []).find(function (x) { return x.id === id; });
    return c ? c.name : "Course";
  }

  /* =====================================================================
     Courses
     ===================================================================== */

  function courses(ctx) {
    ctx.root.innerHTML = '<div class="page-head"><h1>My Courses</h1>' +
      "<p>Add each course with its exam date and the reading you need to cover. " +
      "The generator uses this to decide what to schedule first.</p></div>" +
      '<div id="courses-host"><p class="empty">Loading\u2026</p></div>';

    function render() {
      S.courses.list().then(function (list) {
        var host = ctx.root.querySelector("#courses-host");
        host.innerHTML =
          '<div class="surface"><h2>' + (ctx.state.editingCourse ? "Edit course" : "Add a course") + "</h2>" +
            courseForm(ctx.state.editingCourse) + "</div>" +
          '<div class="surface"><h2>Your courses (' + list.length + ")</h2>" +
            (list.length ? '<ul class="list">' + list.map(function (c) {
              var topics = (c.topics || []).length;
              return '<li><div class="grow">' +
                '<div class="title">' + U.esc(c.name) + (c.code ? " \u00b7 " + U.esc(c.code) : "") +
                  (c.priority === "high" ? ' <span class="tag high">High priority</span>' : "") + "</div>" +
                '<div class="sub">' + [
                  c.units ? c.units + " units" : null,
                  "difficulty " + (c.difficulty || 3) + "/5",
                  c.examDate ? "exam " + U.fmtDate(c.examDate) : null,
                  topics ? topics + " topic" + (topics === 1 ? "" : "s") : null,
                  (c.deadlines || []).length ? (c.deadlines || []).length + " deadline(s)" : null
                ].filter(Boolean).join(" \u00b7 ") + "</div></div>" +
                '<button class="btn ghost small" type="button" data-edit="' + U.esc(c.id) + '">Edit</button>' +
                '<button class="btn ghost small" type="button" data-del="' + U.esc(c.id) + '">Delete</button>' +
              "</li>";
            }).join("") + "</ul>" : U.empty("No courses yet. Add your first one above.")) +
          "</div>";

        wireCourseForm(ctx, render);
        host.querySelectorAll("[data-edit]").forEach(function (b) {
          b.addEventListener("click", function () {
            ctx.state.editingCourse = list.find(function (c) { return c.id === b.getAttribute("data-edit"); });
            render();
            ctx.root.querySelector("#course-form").scrollIntoView({ block: "center" });
          });
        });
        host.querySelectorAll("[data-del]").forEach(function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-del");
            var c = list.find(function (x) { return x.id === id; });
            if (!confirm('Delete "' + (c ? c.name : "this course") + '"? Its lectures and reading sessions will go too.')) return;
            Promise.all([
              S.lectures.list().then(function (ls) {
                return Promise.all(ls.filter(function (l) { return l.courseId === id; }).map(function (l) { return S.lectures.remove(l.id); }));
              }),
              S.sessions.list().then(function (ss) {
                return Promise.all(ss.filter(function (s) { return s.courseId === id; }).map(function (s) { return S.sessions.remove(s.id); }));
              })
            ]).then(function () { return S.courses.remove(id); })
              .then(function () { U.toast("Course deleted"); render(); })
              .catch(showError(ctx));
          });
        });
      }).catch(showError(ctx));
    }
    render();
  }

  function courseForm(c) {
    c = c || {};
    var topics = (c.topics || []).map(function (t) { return t.name + (t.minutes ? " | " + t.minutes : ""); }).join("\n");
    var deadlines = (c.deadlines || []).map(function (d) { return (d.title || "") + " | " + (d.date || ""); }).join("\n");
    return '<form id="course-form" novalidate>' +
      '<div class="row">' +
        '<div class="field" data-field="name"><label for="c-name">Course name</label>' +
          '<input id="c-name" name="name" type="text" value="' + U.esc(c.name || "") + '" required><div class="err"></div></div>' +
        '<div class="field" data-field="code"><label for="c-code">Course code</label>' +
          '<input id="c-code" name="code" type="text" value="' + U.esc(c.code || "") + '" placeholder="e.g. CHEM201"><div class="err"></div></div>' +
      "</div>" +
      '<div class="row">' +
        '<div class="field" data-field="units"><label for="c-units">Credit units</label>' +
          '<input id="c-units" name="units" type="number" min="0" step="0.5" value="' + U.esc(c.units || "") + '"><div class="err"></div></div>' +
        '<div class="field" data-field="priority"><label for="c-priority">Priority</label>' +
          '<select id="c-priority" name="priority">' +
            ["low", "medium", "high"].map(function (p) {
              return '<option value="' + p + '"' + ((c.priority || "medium") === p ? " selected" : "") + ">" + p + "</option>";
            }).join("") +
          "</select><div class=\"err\"></div></div>" +
        '<div class="field" data-field="difficulty"><label for="c-difficulty">Difficulty</label>' +
          '<select id="c-difficulty" name="difficulty">' +
            [1, 2, 3, 4, 5].map(function (n) {
              return '<option value="' + n + '"' + ((+c.difficulty || 3) === n ? " selected" : "") + ">" + n + " of 5</option>";
            }).join("") +
          "</select><div class=\"err\"></div></div>" +
      "</div>" +
      '<div class="row">' +
        '<div class="field" data-field="examDate"><label for="c-exam">Exam date</label>' +
          '<input id="c-exam" name="examDate" type="date" value="' + U.esc(c.examDate || "") + '"><div class="err"></div></div>' +
        '<div class="field" data-field="estimatedMinutes"><label for="c-est">Estimated reading (minutes)</label>' +
          '<input id="c-est" name="estimatedMinutes" type="number" min="0" step="15" value="' + U.esc(c.estimatedMinutes || "") + '">' +
          '<div class="hint">Total reading you owe this course. Used when topics have no individual time.</div><div class="err"></div></div>' +
      "</div>" +
      '<div class="field" data-field="topics"><label for="c-topics">Topics or chapters</label>' +
        '<textarea id="c-topics" name="topics" placeholder="One per line, optionally with minutes:\nChapter 1 | 60\nChapter 2 | 90">' + U.esc(topics) + "</textarea>" +
        '<div class="hint">One per line. Add <code>| minutes</code> if you want to control the time.</div><div class="err"></div></div>' +
      '<div class="field" data-field="deadlines"><label for="c-deadlines">Assignment deadlines</label>' +
        '<textarea id="c-deadlines" name="deadlines" placeholder="One per line:\nEssay 1 | 2026-11-20">' + U.esc(deadlines) + "</textarea>" +
        '<div class="hint">One per line as <code>title | YYYY-MM-DD</code>.</div><div class="err"></div></div>' +
      '<div id="course-msg"></div>' +
      '<div class="row" style="flex:0 1 auto">' +
        '<button class="btn" type="submit">' + (c.id ? "Save changes" : "Add course") + "</button>" +
        (c.id ? '<button class="btn ghost" type="button" id="course-cancel">Cancel</button>' : "") +
      "</div>" +
    "</form>";
  }

  function parseLines(text, withDate) {
    return String(text || "").split("\n").map(function (line) {
      var t = line.trim();
      if (!t) return null;
      var parts = t.split("|").map(function (s) { return s.trim(); });
      if (withDate) {
        if (!parts[0]) return null;
        return { id: S.uid("dl"), title: parts[0], date: parts[1] || "" };
      }
      var name = parts[0];
      if (!name) return null;
      var mins = parts[1] ? parseInt(parts[1], 10) : 0;
      return { id: S.uid("tp"), name: name, minutes: isNaN(mins) ? 0 : mins, done: false };
    }).filter(Boolean);
  }

  function wireCourseForm(ctx, after) {
    var form = ctx.root.querySelector("#course-form");
    if (!form) return;
    var cancel = form.querySelector("#course-cancel");
    if (cancel) cancel.addEventListener("click", function () { ctx.state.editingCourse = null; after(); });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      U.clearErrors(form);
      var name = form.name.value.trim();
      var errors = {};
      if (!name) errors.name = "Please enter the course name.";
      if (form.estimatedMinutes.value && +form.estimatedMinutes.value < 0) errors.estimatedMinutes = "Cannot be negative.";
      var topics = parseLines(form.topics.value, false);
      var est = form.estimatedMinutes.value ? +form.estimatedMinutes.value : 0;
      if (!topics.length && !est) {
        errors.topics = "Add at least one topic, or an estimated reading time.";
      }
      if (Object.keys(errors).length) { U.applyErrors(form, errors); return; }

      var payload = {
        name: name,
        code: form.code.value.trim(),
        units: form.units.value ? +form.units.value : null,
        priority: form.priority.value,
        difficulty: +form.difficulty.value,
        examDate: form.examDate.value || null,
        estimatedMinutes: est,
        topics: topics,
        deadlines: parseLines(form.deadlines.value, true)
      };

      var op = ctx.state.editingCourse
        ? S.courses.update(ctx.state.editingCourse.id, payload)
        : S.courses.create(payload);

      op.then(function () {
        U.toast(ctx.state.editingCourse ? "Course updated" : "Course added");
        ctx.state.editingCourse = null;
        after();
      }).catch(function (err) {
        form.querySelector("#course-msg").innerHTML = U.banner("err", U.esc(err.message));
      });
    });
  }

  /* =====================================================================
     Lecture timetable + availability
     ===================================================================== */

  /* =====================================================================
     Timetable image upload
     ===================================================================== */

  function timetableUpload(ctx, mount, refresh) {
    var O = window.TimetableOCR;

    if (!O) {
      mount.innerHTML = '<div class="surface"><h2>Upload Your Timetable</h2>' +
        UI.banner("err", "The timetable reader could not be loaded. Check your connection and reload the page.") + "</div>";
      return;
    }

    var st = {
      dataUrl: null, fileName: "", rows: [], warnings: [], error: null,
      busy: false, progress: 0, label: "", notice: "", saved: 0
    };

    function shell() {
      mount.innerHTML =
        '<div class="surface">' +
          "<h2>Upload Your Timetable</h2>" +
          '<p class="sub">Upload a photo or screenshot of your timetable and we will read the course names, ' +
            "days, times and rooms from it. You can correct anything before saving.</p>" +
          '<div class="drop" id="drop">' +
            '<input id="tt-file" type="file" accept="image/png,image/jpeg" hidden>' +
            '<button class="btn" type="button" id="tt-pick">Upload Timetable Image</button>' +
            '<p class="sub">PNG, JPG or JPEG \u00b7 up to 10 MB \u00b7 or drop the file here</p>' +
          "</div>" +
          '<div id="up-status"></div>' +
          '<div id="up-preview"></div>' +
          '<div id="up-rows"></div>' +
          '<div id="up-actions"></div>' +
        "</div>";

      var input = mount.querySelector("#tt-file");
      mount.querySelector("#tt-pick").addEventListener("click", function () { input.click(); });
      input.addEventListener("change", function () { if (input.files && input.files[0]) handleFile(input.files[0]); });

      var drop = mount.querySelector("#drop");
      ["dragenter", "dragover"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
      });
      drop.addEventListener("drop", function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
      });
    }

    function status() {
      var host = mount.querySelector("#up-status");
      if (!host) return;
      if (st.busy) {
        host.innerHTML = '<div class="up-progress">' +
          '<div class="bar"><span style="width:' + Math.round(st.progress * 100) + '%"></span></div>' +
          '<p class="sub">' + UI.esc(st.label) + "</p></div>";
        return;
      }
      var html = "";
      if (st.error) {
        html += UI.banner("err", "<b>Could not read that timetable.</b> " + UI.esc(st.error) +
          "<br>You can still add lectures one at a time using the form below.");
      }
      if (st.warnings && st.warnings.length) {
        html += UI.banner("dev", "<b>Please check these before saving.</b><ul style=\"margin:8px 0 0 18px\">" +
          st.warnings.map(function (w) { return "<li>" + UI.esc(w) + "</li>"; }).join("") + "</ul>");
      }
      if (st.notice) html += UI.banner("ok", st.notice);
      host.innerHTML = html;
    }

    function preview() {
      var host = mount.querySelector("#up-preview");
      if (!host) return;
      host.innerHTML = st.dataUrl
        ? '<figure class="up-figure"><img src="' + st.dataUrl + '" alt="Uploaded timetable preview">' +
          '<figcaption class="sub">' + UI.esc(st.fileName) + "</figcaption></figure>"
        : "";
    }

    function rowsHtml(courses) {
      if (!st.rows.length) return "";
      var names = courses.map(function (c) { return c.name; });
      return '<datalist id="up-courses">' + names.map(function (n) {
        return '<option value="' + UI.esc(n) + '">';
      }).join("") + "</datalist>" +
      '<h3 class="up-h3">Check the ' + st.rows.length + " lecture" + (st.rows.length === 1 ? "" : "s") + " we found</h3>" +
      '<div class="ocr-rows">' + st.rows.map(function (r, i) {
        return '<div class="ocr-row" data-i="' + i + '">' +
          '<div class="field"><label>Course</label>' +
            '<input class="ocr-course" list="up-courses" value="' + UI.esc(r.course || "") + '" placeholder="Course name"></div>' +
          '<div class="field"><label>Day</label><select class="ocr-day">' + dayOptions(r.day) + "</select></div>" +
          '<div class="field"><label>Start</label><input class="ocr-start" type="time" value="' + UI.esc(r.start || "") + '"></div>' +
          '<div class="field"><label>End</label><input class="ocr-end" type="time" value="' + UI.esc(r.end || "") + '"></div>' +
          '<div class="field"><label>Location</label><input class="ocr-loc" value="' + UI.esc(r.location || "") + '" placeholder="Optional"></div>' +
          '<button class="btn ghost small ocr-remove" type="button">Remove</button>' +
        "</div>";
      }).join("") + "</div>";
    }

    function renderRows(courses) {
      var host = mount.querySelector("#up-rows");
      if (!host) return;
      host.innerHTML = rowsHtml(courses);
      host.querySelectorAll(".ocr-remove").forEach(function (b) {
        b.addEventListener("click", function () {
          syncRows();
          st.rows.splice(+b.closest(".ocr-row").getAttribute("data-i"), 1);
          renderRows(courses);
          actions(courses);
        });
      });
    }

    // Read back whatever the student typed, without re-rendering (which
    // would steal focus mid-edit).
    function syncRows() {
      mount.querySelectorAll(".ocr-row").forEach(function (el, i) {
        if (!st.rows[i]) return;
        st.rows[i].course = el.querySelector(".ocr-course").value.trim();
        st.rows[i].day = +el.querySelector(".ocr-day").value;
        st.rows[i].start = el.querySelector(".ocr-start").value;
        st.rows[i].end = el.querySelector(".ocr-end").value;
        st.rows[i].location = el.querySelector(".ocr-loc").value.trim();
      });
    }

    function actions(courses) {
      var host = mount.querySelector("#up-actions");
      if (!host) return;
      if (!st.rows.length) { host.innerHTML = ""; return; }
      host.innerHTML = '<div id="up-msg"></div>' +
        '<div class="up-actions-row">' +
          '<button class="btn coral" type="button" id="up-save">Confirm and Save Timetable</button>' +
          '<button class="btn ghost" type="button" id="up-generate">Generate my study plan</button>' +
        "</div>";
      host.querySelector("#up-save").addEventListener("click", function () { save(courses); });
      host.querySelector("#up-generate").addEventListener("click", function () { ctx.navigate("#/generate"); });
    }

    function save(courses) {
      syncRows();
      var msg = mount.querySelector("#up-msg");
      var problems = [];
      st.rows.forEach(function (r, i) {
        var n = i + 1;
        if (!r.course) problems.push("Row " + n + " has no course name.");
        if (!r.start || !r.end) problems.push("Row " + n + " needs a start and end time.");
        else if (r.start >= r.end) problems.push("Row " + n + ": the end time must be after the start time.");
      });
      if (!st.rows.length) problems.push("There is nothing to save.");
      if (problems.length) {
        msg.innerHTML = UI.banner("err", "<b>Fix these first.</b><ul style=\"margin:8px 0 0 18px\">" +
          problems.map(function (p) { return "<li>" + UI.esc(p) + "</li>"; }).join("") + "</ul>");
        return;
      }

      var btn = mount.querySelector("#up-save");
      btn.disabled = true;
      btn.textContent = "Saving\u2026";

      var pool = courses.slice();
      var created = 0;
      var jobs = st.rows.map(function (r) {
        return resolveCourse(pool, r).then(function (c) {
          if (c.__created) created++;
          return S.lectures.create({
            courseId: c.id, day: r.day, start: r.start, end: r.end, location: r.location || ""
          });
        });
      });

      Promise.all(jobs).then(function () {
        st.saved = st.rows.length;
        st.rows = [];
        st.dataUrl = null;
        st.warnings = [];
        st.notice = "<b>Saved." + "</b> " + st.saved + " lecture" + (st.saved === 1 ? "" : "s") +
          " added to your timetable" + (created ? " and " + created + " new course" + (created === 1 ? "" : "s") +
          " created with a default 2-hour reading estimate (adjust on My Courses)" : "") +
          ". Reading sessions will now avoid these lecture times.";
        UI.toast("Timetable saved");
        shell();
        status();
        refresh();
      }).catch(function (err) {
        msg.innerHTML = UI.banner("err", UI.esc(err.message));
        btn.disabled = false;
        btn.textContent = "Confirm and Save Timetable";
      });
    }

    // Match an extracted name to an existing course, or create one.
    function resolveCourse(pool, r) {
      var want = String(r.course || "").trim().toLowerCase();
      var match = pool.filter(function (c) {
        var name = String(c.name || "").trim().toLowerCase();
        var code = String(c.code || "").trim().toLowerCase().replace(/\s+/g, "");
        return name === want || (code && (code === want || code === want.replace(/\s+/g, "")));
      })[0];
      if (match) return Promise.resolve(match);

      return S.courses.create({
        name: r.course, code: r.code || "", units: null,
        priority: "medium", difficulty: 3, examDate: null,
        // A course with no topics and no estimate cannot be scheduled, so
        // imported courses get a modest default the student can edit.
        estimatedMinutes: 120, topics: [], deadlines: []
      }).then(function (c) { c.__created = true; pool.push(c); return c; });
    }

    function handleFile(file) {
      var bad = O.validateFile(file);
      st.error = bad;
      st.rows = [];
      st.warnings = [];
      st.notice = "";
      if (bad) {
        st.dataUrl = null;
        shell(); status(); return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        st.dataUrl = reader.result;
        st.fileName = file.name || "timetable";
        preview();
        runOcr(file);
      };
      reader.onerror = function () {
        st.error = "That image could not be read from your device.";
        shell(); status();
      };
      reader.readAsDataURL(file);
    }

    function runOcr(file) {
      st.busy = true; st.progress = 0; st.label = "Starting\u2026"; st.error = null;
      shell(); preview(); status();
      O.extractFromImage(file, function (p, label) {
        st.progress = p; st.label = label;
        var el = mount.querySelector("#up-status .bar span");
        var lab = mount.querySelector("#up-status .sub");
        if (el) el.style.width = Math.round(p * 100) + "%";
        if (lab && label) lab.textContent = label;
      }).then(function (res) {
        st.busy = false;
        if (!res.ok || !res.rows.length) {
          st.error = (res.warnings && res.warnings.length)
            ? res.warnings.join(" ")
            : "No lectures could be recognised in that image. Try a sharper photo, or enter lectures manually below.";
          st.rows = [];
          status();
          return;
        }
        st.rows = res.rows.map(function (r) {
          return {
            course: r.course || "", code: r.code || "",
            day: (r.day === null || r.day === undefined) ? 1 : r.day,
            start: r.start, end: r.end, location: r.location || ""
          };
        });
        st.warnings = res.warnings || [];
        S.courses.list().then(function (courses) {
          status(); renderRows(courses); actions(courses);
        });
      }).catch(function (err) {
        st.busy = false;
        st.error = err && err.message ? err.message : String(err);
        status();
      });
    }

    shell();
    status();
  }

  function timetable(ctx) {
    ctx.root.innerHTML = '<div class="page-head"><h1>My Lecture Timetable</h1>' +
      "<p>Enter your weekly lectures, then mark the periods you can study and the ones you cannot. " +
      "Reading sessions are only ever placed inside your study periods.</p></div>" +
      '<div id="tt-upload"></div>' +
      '<div id="tt-host"><p class="empty">Loading\u2026</p></div>';

    function render() {
      Promise.all([S.courses.list(), S.lectures.list(), S.availability.list()]).then(function (r) {
        var courses = r[0], lectures = r[1], avail = r[2];

        var byDay = {};
        lectures.forEach(function (l) {
          var s = U.toMin(l.start), e = U.toMin(l.end);
          (byDay[l.day] = byDay[l.day] || []).push({
            kind: "lecture", title: courseName(courses, l.courseId),
            start: l.start, end: l.end, startMin: s, note: l.location || ""
          });
        });
        avail.forEach(function (a) {
          (byDay[a.day] = byDay[a.day] || []).push({
            kind: a.kind === "blocked" ? "blocked" : "study",
            title: a.kind === "blocked" ? (a.label || "Unavailable") : (a.label || "Available to study"),
            start: a.start, end: a.end, startMin: U.toMin(a.start), note: ""
          });
        });

        var host = ctx.root.querySelector("#tt-host");
        host.innerHTML =
          (courses.length ? "" : U.banner("err", "Add a course first \u2014 lectures belong to a course.")) +

          '<div class="surface"><h2>Add a lecture</h2>' +
            '<form id="lec-form" novalidate>' +
              '<div class="row">' +
                '<div class="field" data-field="courseId"><label for="l-course">Course</label>' +
                  '<select id="l-course" name="courseId">' + courseOptions(courses) + "</select><div class=\"err\"></div></div>" +
                '<div class="field" data-field="day"><label for="l-day">Day</label>' +
                  '<select id="l-day" name="day">' + dayOptions(1) + "</select><div class=\"err\"></div></div>" +
              "</div>" +
              '<div class="row">' +
                '<div class="field" data-field="start"><label for="l-start">Start</label>' +
                  '<input id="l-start" name="start" type="time" value="09:00" required><div class="err"></div></div>' +
                '<div class="field" data-field="end"><label for="l-end">End</label>' +
                  '<input id="l-end" name="end" type="time" value="11:00" required><div class="err"></div></div>' +
                '<div class="field" data-field="location"><label for="l-loc">Location</label>' +
                  '<input id="l-loc" name="location" type="text" placeholder="Optional"><div class="err"></div></div>' +
              "</div>" +
              '<div id="lec-msg"></div><button class="btn" type="submit">Add lecture</button>' +
            "</form>" +
          "</div>" +

          '<div class="surface"><h2>Add a study period or blocked time</h2>' +
            '<form id="av-form" novalidate>' +
              '<div class="row">' +
                '<div class="field" data-field="kind"><label for="a-kind">Type</label>' +
                  '<select id="a-kind" name="kind">' +
                    '<option value="study">Available to study</option>' +
                    '<option value="blocked">Unavailable</option>' +
                  "</select><div class=\"err\"></div></div>" +
                '<div class="field" data-field="day"><label for="a-day">Day</label>' +
                  '<select id="a-day" name="day">' + dayOptions(1) + "</select><div class=\"err\"></div></div>" +
              "</div>" +
              '<div class="row">' +
                '<div class="field" data-field="start"><label for="a-start">From</label>' +
                  '<input id="a-start" name="start" type="time" value="18:00" required><div class="err"></div></div>' +
                '<div class="field" data-field="end"><label for="a-end">To</label>' +
                  '<input id="a-end" name="end" type="time" value="21:00" required><div class="err"></div></div>' +
                '<div class="field" data-field="label"><label for="a-label">Label</label>' +
                  '<input id="a-label" name="label" type="text" placeholder="Optional"><div class="err"></div></div>' +
              "</div>" +
              '<div id="av-msg"></div><button class="btn" type="submit">Add</button>' +
            "</form>" +
          "</div>" +

          '<div class="surface">' + weekGrid(byDay, "Your week") + "</div>" +

          '<div class="surface"><h2>Lectures (' + lectures.length + ")</h2>" +
            (lectures.length ? '<ul class="list">' + lectures.map(function (l) {
              return '<li><div class="grow"><div class="title">' + U.esc(courseName(courses, l.courseId)) + "</div>" +
                '<div class="sub">' + U.dayName(l.day) + " \u00b7 " + U.esc(l.start) + "\u2013" + U.esc(l.end) +
                (l.location ? " \u00b7 " + U.esc(l.location) : "") + "</div></div>" +
                '<button class="btn ghost small" data-del-lec="' + U.esc(l.id) + '">Delete</button></li>';
            }).join("") + "</ul>" : U.empty("No lectures yet.")) +
          "</div>" +

          '<div class="surface"><h2>Study and blocked periods (' + avail.length + ")</h2>" +
            (avail.length ? '<ul class="list">' + avail.map(function (a) {
              return '<li><div class="grow"><div class="title">' +
                (a.kind === "blocked" ? "Unavailable" : "Available to study") +
                (a.label ? " \u00b7 " + U.esc(a.label) : "") + "</div>" +
                '<div class="sub">' + U.dayName(a.day) + " \u00b7 " + U.esc(a.start) + "\u2013" + U.esc(a.end) + "</div></div>" +
                '<button class="btn ghost small" data-del-av="' + U.esc(a.id) + '">Delete</button></li>';
            }).join("") + "</ul>" : U.empty("No study periods yet \u2014 the generator needs at least one.")) +
          "</div>";

        // lectures
        var lf = host.querySelector("#lec-form");
        lf.addEventListener("submit", function (e) {
          e.preventDefault();
          U.clearErrors(lf);
          var errs = {};
          if (!lf.courseId.value) errs.courseId = "Choose a course.";
          if (lf.start.value >= lf.end.value) errs.end = "The end time must be after the start time.";
          if (Object.keys(errs).length) { U.applyErrors(lf, errs); return; }
          S.lectures.create({
            courseId: lf.courseId.value, day: +lf.day.value,
            start: lf.start.value, end: lf.end.value, location: lf.location.value.trim()
          }).then(function () { U.toast("Lecture added"); render(); }).catch(showError(ctx));
        });

        // availability
        var af = host.querySelector("#av-form");
        af.addEventListener("submit", function (e) {
          e.preventDefault();
          U.clearErrors(af);
          var errs = {};
          if (af.start.value >= af.end.value) errs.end = "The end time must be after the start time.";
          if (Object.keys(errs).length) { U.applyErrors(af, errs); return; }
          S.availability.create({
            day: +af.day.value, start: af.start.value, end: af.end.value,
            kind: af.kind.value, label: af.label.value.trim()
          }).then(function () { U.toast("Added"); render(); }).catch(showError(ctx));
        });

        host.querySelectorAll("[data-del-lec]").forEach(function (b) {
          b.addEventListener("click", function () {
            S.lectures.remove(b.getAttribute("data-del-lec")).then(render).catch(showError(ctx));
          });
        });
        host.querySelectorAll("[data-del-av]").forEach(function (b) {
          b.addEventListener("click", function () {
            S.availability.remove(b.getAttribute("data-del-av")).then(render).catch(showError(ctx));
          });
        });
      }).catch(showError(ctx));
    }
    timetableUpload(ctx, ctx.root.querySelector("#tt-upload"), render);
    render();
  }

  function generate(ctx) {
    ctx.root.innerHTML = '<div class="page-head"><h1>Generate Study Plan</h1>' +
      "<p>Reading sessions are fitted around your lectures and only inside the study periods you set. " +
      "If something essential is missing, you will be asked for it rather than given a made-up timetable.</p></div>" +
      '<div id="gen-host"><p class="empty">Loading\u2026</p></div>';

    function render() {
      Promise.all([S.courses.list(), S.lectures.list(), S.availability.list(), S.settings.get(), S.sessions.list()])
        .then(function (r) {
          var courses = r[0], lectures = r[1], availability = r[2], prefs = r[3], existing = r[4];
          var profile = { courses: courses, lectures: lectures, availability: availability, preferences: prefs };
          var check = E.validatePlanInput(profile);

          var host = ctx.root.querySelector("#gen-host");
          host.innerHTML =
            (existing.length
              ? '<div class="surface"><h2>You already have a plan</h2>' +
                "<p class=\"muted\" style=\"margin-bottom:16px\">" + existing.length + " sessions saved. " +
                "Regenerating keeps anything you completed, missed or locked exactly where it is.</p>" +
                '<div class="row" style="flex:0 1 auto">' +
                  '<button class="btn" data-act="regen" type="button">Regenerate remaining only</button>' +
                  '<button class="btn ghost" data-act="clear" type="button">Delete the whole plan</button>' +
                "</div></div>"
              : "") +

            (check.ok ? "" : U.banner("err", "<b>Before a timetable can be generated:</b><ul style=\"margin:8px 0 0 18px\">" +
              check.missing.map(function (m) { return "<li>" + U.esc(m.message) + "</li>"; }).join("") + "</ul>")) +

            '<div class="surface"><h2>Preferences</h2>' +
              '<form id="pref-form" novalidate>' +
                '<div class="row">' +
                  '<div class="field" data-field="sessionMinutes"><label for="p-session">Session length (minutes)</label>' +
                    '<input id="p-session" name="sessionMinutes" type="number" min="30" step="15" value="' + U.esc(prefs.sessionMinutes) + '"><div class="err"></div></div>' +
                  '<div class="field" data-field="breakMinutes"><label for="p-break">Break between sessions (minutes)</label>' +
                    '<input id="p-break" name="breakMinutes" type="number" min="0" step="5" value="' + U.esc(prefs.breakMinutes) + '"><div class="err"></div></div>' +
                  '<div class="field" data-field="maxSessionsPerDay"><label for="p-max">Max sessions per day</label>' +
                    '<input id="p-max" name="maxSessionsPerDay" type="number" min="1" max="12" value="' + U.esc(prefs.maxSessionsPerDay) + '"><div class="err"></div></div>' +
                "</div>" +
                '<div class="row">' +
                  '<div class="field" data-field="weeks"><label for="p-weeks">Weeks to plan</label>' +
                    '<input id="p-weeks" name="weeks" type="number" min="1" max="12" value="' + U.esc(prefs.weeks || 1) + '"><div class="err"></div></div>' +
                  '<div class="field" data-field="startDate"><label for="p-start">Starting from</label>' +
                    '<input id="p-start" name="startDate" type="date" value="' + U.esc(prefs.startDate || U.todayISO()) + '"><div class="err"></div></div>' +
                  '<div class="field" data-field="lectureBufferMinutes"><label for="p-buffer">Travel buffer after lectures</label>' +
                    '<input id="p-buffer" name="lectureBufferMinutes" type="number" min="0" step="5" value="' + U.esc(prefs.lectureBufferMinutes || 0) + '"><div class="err"></div></div>' +
                "</div>" +
                '<div id="pref-msg"></div>' +
                '<button class="btn coral" type="submit"' + (check.ok ? "" : " disabled") + ">Generate timetable</button>" +
              "</form>" +
            "</div>" +

            '<div id="plan-host"></div>';

          var pf = host.querySelector("#pref-form");
          pf.addEventListener("submit", function (e) {
            e.preventDefault();
            U.clearErrors(pf);
            var errs = {};
            if (+pf.sessionMinutes.value < 30) errs.sessionMinutes = "Sessions must be at least 30 minutes.";
            if (+pf.weeks.value < 1) errs.weeks = "Plan at least one week.";
            if (Object.keys(errs).length) { U.applyErrors(pf, errs); return; }

            var next = {
              sessionMinutes: +pf.sessionMinutes.value,
              breakMinutes: +pf.breakMinutes.value,
              maxSessionsPerDay: +pf.maxSessionsPerDay.value,
              weeks: +pf.weeks.value,
              startDate: pf.startDate.value,
              lectureBufferMinutes: +pf.lectureBufferMinutes.value
            };
            S.settings.set(next).then(function (saved) {
              var p = { courses: courses, lectures: lectures, availability: availability, preferences: saved };
              var result = E.generatePlan(p, { weeks: saved.weeks, today: saved.startDate });
              showPlan(ctx, result, p, courses, host.querySelector("#plan-host"));
            }).catch(showError(ctx));
          });

          var regen = host.querySelector('[data-act="regen"]');
          if (regen) regen.addEventListener("click", function () {
            var p = { courses: courses, lectures: lectures, availability: availability, preferences: prefs };
            var result = E.regenerateRemaining(p, existing, { weeks: prefs.weeks || 1, today: prefs.startDate });
            showPlan(ctx, result, p, courses, host.querySelector("#plan-host"), existing.length);
          });

          var clr = host.querySelector('[data-act="clear"]');
          if (clr) clr.addEventListener("click", function () {
            if (!confirm("Delete every saved reading session? This cannot be undone.")) return;
            S.sessions.replaceAll([]).then(function () { U.toast("Plan deleted"); render(); }).catch(showError(ctx));
          });
        }).catch(showError(ctx));
    }

    function showPlan(ctx, result, profile, courses, host, keptCount) {
      if (!result.ok) {
        host.innerHTML = '<div class="surface">' + U.banner("err",
          "<b>Cannot generate a timetable yet:</b><ul style=\"margin:8px 0 0 18px\">" +
          result.missing.map(function (m) { return "<li>" + U.esc(m.message) + "</li>"; }).join("") + "</ul>") + "</div>";
        return;
      }

      var byDay = {};
      result.sessions.forEach(function (s) {
        (byDay[s.day] = byDay[s.day] || []).push({
          kind: "study", title: courseName(courses, s.courseId),
          start: s.start, end: s.end, startMin: s.startMin, status: s.status, note: U.fmtDate(s.date)
        });
      });

      var byDate = {};
      result.sessions.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });

      host.innerHTML =
        '<div class="surface"><h2>' + (keptCount ? "Regenerated plan" : "Your new plan") + "</h2>" +
          "<p class=\"muted\" style=\"margin-bottom:16px\">" +
            result.sessions.length + " sessions \u00b7 " + Math.round(result.stats.minutes / 60) + " hours" +
            (keptCount ? " \u00b7 kept " + keptCount + " existing session(s)" : "") + "</p>" +
          weekGrid(byDay) +
        "</div>" +

        (result.unscheduled.length
          ? '<div class="surface">' + U.banner("dev",
              "<b>Not everything fitted.</b><ul style=\"margin:8px 0 0 18px\">" +
              result.unscheduled.map(function (u) { return "<li>" + U.esc(u.reason) + "</li>"; }).join("") +
              "</ul> Add more study periods if you want it all scheduled.") + "</div>"
          : "") +

        '<div class="surface"><h2>Daily agenda</h2>' +
          Object.keys(byDate).sort().map(function (date) {
            var list = byDate[date].sort(function (a, b) { return a.startMin - b.startMin; });
            return '<div style="margin-bottom:20px"><div class="bar-head"><span class="l">' + U.fmtDateLong(date) + "</span>" +
              '<span class="c">' + list.length + " session" + (list.length === 1 ? "" : "s") + "</span></div>" +
              '<ul class="list">' + list.map(function (s) {
                return '<li><div class="grow"><div class="title">' + U.esc(s.start) + "\u2013" + U.esc(s.end) + " \u00b7 " +
                  U.esc(courseName(courses, s.courseId)) + "</div></div></li>";
              }).join("") + "</ul></div>";
          }).join("") +
        "</div>" +

        '<div class="row" style="flex:0 1 auto">' +
          '<button class="btn coral" id="save-plan" type="button">Save this timetable</button>' +
        "</div>";

      host.querySelector("#save-plan").addEventListener("click", function () {
        var btn = this;
        btn.disabled = true;
        var rows = result.sessions.map(function (s) {
          return {
            id: s.id, courseId: s.courseId, topicId: s.topicId, day: s.day, date: s.date,
            week: s.week, start: s.start, end: s.end, startMin: s.startMin, endMin: s.endMin,
            minutes: s.minutes, status: s.status || "pending", locked: !!s.locked
          };
        });
        S.sessions.replaceAll(rows).then(function () {
          U.toast("Timetable saved");
          render();
        }).catch(function (err) { btn.disabled = false; showError(ctx)(err); });
      });
    }
    render();
  }

  /* =====================================================================
     Reading tasks
     ===================================================================== */

  function tasks(ctx) {
    ctx.root.innerHTML = '<div class="page-head"><h1>My Reading Tasks</h1>' +
      "<p>Mark sessions as you go. Anything you miss stays visible so you can move it.</p></div>" +
      '<div id="task-host"><p class="empty">Loading\u2026</p></div>';

    function render() {
      Promise.all([S.sessions.list(), S.courses.list()]).then(function (r) {
        var sessions = r[0], courses = r[1];
        var today = U.todayISO();
        var byDate = {};
        sessions.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });

        var host = ctx.root.querySelector("#task-host");
        if (!sessions.length) {
          host.innerHTML = '<div class="surface">' + U.empty("No reading sessions yet. Generate a timetable first.") + "</div>";
          return;
        }

        host.innerHTML = Object.keys(byDate).sort().map(function (date) {
          var list = byDate[date].sort(function (a, b) { return a.startMin - b.startMin; });
          var isPast = date < today;
          return '<div class="surface"><div class="bar-head"><span class="l">' + U.fmtDateLong(date) +
            (date === today ? ' <span class="tag">Today</span>' : (isPast ? ' <span class="tag missed">Past</span>' : "")) +
            '</span><span class="c">' + list.length + " session" + (list.length === 1 ? "" : "s") + "</span></div>" +
            '<ul class="list">' + list.map(function (s) {
              var tag = s.status === "done" ? '<span class="tag done">Done</span>'
                      : s.status === "missed" ? '<span class="tag missed">Missed</span>'
                      : '<span class="tag">Pending</span>';
              return '<li><div class="grow">' +
                '<div class="title">' + U.esc(s.start) + "\u2013" + U.esc(s.end) + " \u00b7 " + U.esc(courseName(courses, s.courseId)) + " " + tag + "</div>" +
                '<div class="sub">' + s.minutes + " minutes" + (s.locked ? " \u00b7 locked" : "") + "</div></div>" +
                '<button class="btn ghost small" data-st="done" data-id="' + U.esc(s.id) + '">Done</button>' +
                '<button class="btn ghost small" data-st="pending" data-id="' + U.esc(s.id) + '">Pending</button>' +
                '<button class="btn ghost small" data-st="missed" data-id="' + U.esc(s.id) + '">Missed</button>' +
                '<button class="btn ghost small" data-move="' + U.esc(s.id) + '">Move</button>' +
                '<button class="btn ghost small" data-rm="' + U.esc(s.id) + '">Delete</button>' +
              "</li>";
            }).join("") + "</ul></div>";
        }).join("");

        host.querySelectorAll("[data-st]").forEach(function (b) {
          b.addEventListener("click", function () {
            S.sessions.update(b.getAttribute("data-id"), { status: b.getAttribute("data-st") })
              .then(function () { U.toast("Updated"); render(); }).catch(showError(ctx));
          });
        });
        host.querySelectorAll("[data-rm]").forEach(function (b) {
          b.addEventListener("click", function () {
            S.sessions.remove(b.getAttribute("data-rm")).then(render).catch(showError(ctx));
          });
        });
        host.querySelectorAll("[data-move]").forEach(function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-move");
            var s = sessions.find(function (x) { return x.id === id; });
            var newDate = prompt("Move this session to which date? (YYYY-MM-DD)", s.date);
            if (!newDate) return;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { U.toast("Use the format YYYY-MM-DD", "error"); return; }
            var d = new Date(newDate + "T00:00:00");
            if (isNaN(d.getTime())) { U.toast("That date is not valid", "error"); return; }
            S.sessions.update(id, { date: newDate, day: d.getDay() })
              .then(function () { U.toast("Session moved"); render(); }).catch(showError(ctx));
          });
        });
      }).catch(showError(ctx));
    }
    render();
  }

  /* =====================================================================
     Progress
     ===================================================================== */

  function progress(ctx) {
    ctx.root.innerHTML = '<div class="page-head"><h1>Progress</h1>' +
      "<p>Daily and weekly completion, and everything still outstanding.</p></div>" +
      '<div id="prog-host"><p class="empty">Loading\u2026</p></div>';

    Promise.all([S.sessions.list(), S.courses.list()]).then(function (r) {
      var sessions = r[0], courses = r[1];
      var today = U.todayISO();
      var daily = E.progressFor(sessions, today);
      var weekly = E.weeklyProgress(sessions, 0);
      var all = E.summarise(sessions);

      var outstanding = sessions.filter(function (s) {
        return s.status !== "done" && s.date <= today;
      }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });

      var byDate = {};
      sessions.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });

      ctx.root.querySelector("#prog-host").innerHTML =
        '<div class="surface">' + progressBar(daily.done, daily.total, "Today") +
          '<div style="height:20px"></div>' + progressBar(weekly.done, weekly.total, "This week") +
          '<div style="height:20px"></div>' + progressBar(all.done, all.total, "All time") + "</div>" +

        '<div class="grid three" style="margin-bottom:24px">' +
          '<div class="tile"><div class="n">' + all.done + '</div><div class="l">Completed</div></div>' +
          '<div class="tile"><div class="n">' + all.pending + '</div><div class="l">Pending</div></div>' +
          '<div class="tile"><div class="n">' + all.missed + '</div><div class="l">Missed</div></div>' +
          '<div class="tile"><div class="n">' + Math.round(all.minutes / 60) + '</div><div class="l">Hours completed</div></div>' +
        "</div>" +

        '<div class="surface"><h2>Still outstanding</h2>' +
          (outstanding.length
            ? '<ul class="list">' + outstanding.map(function (s) {
                return '<li><div class="grow"><div class="title">' + U.esc(courseName(courses, s.courseId)) + "</div>" +
                  '<div class="sub">' + U.fmtDate(s.date) + " \u00b7 " + U.esc(s.start) + "\u2013" + U.esc(s.end) + " \u00b7 " + U.esc(s.status) + "</div></div>" +
                  '<button class="btn ghost small" data-go="tasks">Reschedule</button></li>';
              }).join("") + "</ul>"
            : U.empty("Nothing outstanding \u2014 you are up to date.")) +
        "</div>" +

        '<div class="surface"><h2>Daily breakdown</h2>' +
          (Object.keys(byDate).length
            ? Object.keys(byDate).sort().map(function (date) {
                var s = E.progressFor(sessions, date);
                return '<div style="margin-bottom:14px">' + progressBar(s.done, s.total, U.fmtDateLong(date)) + "</div>";
              }).join("")
            : U.empty("No sessions yet.")) +
        "</div>";

      ctx.root.querySelectorAll("[data-go]").forEach(function (b) {
        b.addEventListener("click", function () { ctx.navigate("#/" + b.getAttribute("data-go")); });
      });
    }).catch(showError(ctx));
  }

  /* ---------- error helper ---------- */
  function showError(ctx) {
    return function (err) {
      var msg = (err && err.message) || "Something went wrong.";
      U.toast(msg, "error");
      var host = ctx.root.querySelector(".page-head");
      if (host) {
        var b = document.createElement("div");
        b.innerHTML = U.banner("err", U.esc(msg));
        host.parentNode.insertBefore(b.firstChild, host.nextSibling);
      }
    };
  }

  return {
    login: login, register: register, dashboard: dashboard,
    courses: courses, timetable: timetable, generate: generate,
    tasks: tasks, progress: progress
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = Views; }
