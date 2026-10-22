/* =====================================================================
   Study Planner — bootstrap and router
   ===================================================================== */
(function () {
  "use strict";

  // `label` is shown on wide screens, `short` on narrow ones where the
  // full text would overflow. Both are real elements, so whichever is
  // visible is what assistive tech announces.
  var NAV = [
    { hash: "#/dashboard", label: "Dashboard",            short: "Home" },
    { hash: "#/courses",   label: "My Courses",           short: "Courses" },
    { hash: "#/timetable", label: "My Lecture Timetable", short: "Timetable" },
    { hash: "#/generate",  label: "Generate Study Plan",  short: "Generate" },
    { hash: "#/tasks",     label: "My Reading Tasks",     short: "Tasks" },
    { hash: "#/progress",  label: "Progress",             short: "Progress" }
  ];

  var PUBLIC_ROUTES = { "#/login": "login", "#/register": "register" };
  var root, navEl, whoEl, ctx;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function boot() {
    var cfg = window.STUDY_PLANNER_CONFIG || {};
    var hasSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

    var setup = Promise.resolve(null);
    if (hasSupabase && window.supabase) {
      var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      var driver = StudyStore.supabaseDriver(client);
      // Verify the backend is actually usable before trusting it. A project
      // whose schema was never applied would otherwise swallow every write
      // and look like it worked.
      setup = driver.probe().then(function (h) {
        StudyStore.setBackendStatus("supabase", h.ok, h.reason);
        if (!h.ok) console.error("Study Planner: Supabase backend is not usable — " + h.reason);
        return StudyAuth.configure(StudyAuth.supabaseAuthDriver(client, location.origin));
      }).then(function (user) {
        StudyStore.configure(driver, user ? user.id : null);
        return client;
      });
    } else {
      StudyStore.setBackendStatus("local", true, "");
      setup = StudyAuth.configure(StudyAuth.localAuthDriver())
        .then(function (user) {
          StudyStore.configure(StudyStore.localDriver(), user ? user.id : null);
          return null;
        });
    }

    return setup.then(function (client) {
      // keep the store's user in step when Supabase refreshes or ends a session
      if (client) {
        client.auth.onAuthStateChange(function (_event, session) {
          var u = session && session.user ? session.user : null;
          StudyStore.setUser(u ? u.id : null);
        });
      }
      StudyAuth.onChange(function (user) {
        StudyStore.setUser(user ? user.id : null);
        renderNav();
        if (!user) { location.hash = "#/login"; return; }
        if (PUBLIC_ROUTES[location.hash]) { location.hash = "#/dashboard"; return; }
        route();
      });
      renderNav();
      route();
    });
  }

  function renderNav() {
    var signedIn = StudyAuth.isSignedIn();
    navEl.style.display = signedIn ? "" : "none";
    if (!signedIn) { whoEl.innerHTML = ""; return; }
    var u = StudyAuth.current();
    whoEl.innerHTML = '<b>' + UI.esc(u.name || u.email) + "</b>" +
      '<button class="btn ghost small" id="signout" type="button">Sign out</button>';
    var out = whoEl.querySelector("#signout");
    if (out) out.addEventListener("click", function () {
      StudyAuth.logout().then(function () { UI.toast("Signed out"); });
    });

    var current = location.hash || "#/dashboard";
    navEl.innerHTML = '<div class="nav-in">' + NAV.map(function (n) {
      return '<a href="' + n.hash + '"' + (n.hash === current ? ' aria-current="page"' : "") + ">" +
        '<span class="nav-full">' + UI.esc(n.label) + "</span>" +
        '<span class="nav-short">' + UI.esc(n.short) + "</span>" +
        "</a>";
    }).join("") + "</div>";
  }

  function route() {
    var hash = location.hash || "#/dashboard";
    var signedIn = StudyAuth.isSignedIn();

    if (!signedIn) {
      if (hash === "#/register") { Views.register(ctx); return; }
      Views.login(ctx);
      return;
    }
    if (PUBLIC_ROUTES[hash]) { location.hash = "#/dashboard"; return; }

    renderNav();
    var name = hash.replace("#/", "");
    var view = Views[name];
    if (!view) { Views.dashboard(ctx); return; }
    window.scrollTo(0, 0);
    view(ctx);
  }

  document.addEventListener("DOMContentLoaded", function () {
    root = document.getElementById("view");
    navEl = document.getElementById("nav");
    whoEl = document.getElementById("who");
    ctx = {
      root: root,
      get user() { return StudyAuth.current() || {}; },
      navigate: function (h) { location.hash = h; },
      state: {},
      afterAuth: function () { location.hash = "#/dashboard"; }
    };

    window.addEventListener("hashchange", route);

    var cfg = window.STUDY_PLANNER_CONFIG || {};
    var needsSdk = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

    (needsSdk && !window.supabase
      ? loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js")
      : Promise.resolve()
    ).then(boot).catch(function (err) {
      root.innerHTML = '<div class="auth-wrap">' + UI.banner("err",
        "Could not start: " + UI.esc(err.message)) + "</div>";
    });
  });
})();
