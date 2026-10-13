/* =====================================================================
   Study Planner — authentication

   Same shape as the store: the app talks to StudyAuth, StudyAuth talks
   to a driver.

     supabaseDriver : real accounts. Email+password and Google OAuth.
                      Sessions are JWTs issued by Supabase; the access
                      token is what row-level security checks.
     localDriver    : DEVELOPMENT ONLY. Keeps accounts in localStorage so
                      the screens can be built and tested before the
                      backend exists. Anybody using this device can read
                      the account list. The UI shows a warning banner and
                      Google sign-in is deliberately unavailable.
   ===================================================================== */
var StudyAuth = (function () {
  "use strict";

  var driver = null;
  var listeners = [];
  var cachedUser = null;

  function configure(d) {
    driver = d;
    return d.restore().then(function (user) {
      cachedUser = user;
      emit();
      return user;
    });
  }

  function emit() { listeners.forEach(function (fn) { try { fn(cachedUser); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function current() { return cachedUser; }
  function isSignedIn() { return !!cachedUser; }
  function driverName() { return driver ? driver.name : null; }
  function supportsGoogle() { return !!driver && driver.supportsGoogle === true; }

  function done(user) { cachedUser = user; emit(); return user; }

  function register(input) {
    if (!driver) return Promise.reject(new Error("Auth is not configured."));
    return driver.register(input).then(done);
  }
  function login(input) {
    if (!driver) return Promise.reject(new Error("Auth is not configured."));
    return driver.login(input).then(done);
  }
  function loginWithGoogle() {
    if (!driver) return Promise.reject(new Error("Auth is not configured."));
    if (!driver.supportsGoogle) {
      return Promise.reject(new Error(
        "Google sign-in needs the Supabase backend. It is unavailable while the app is running on the local development driver."
      ));
    }
    return driver.loginWithGoogle();
  }
  function logout() {
    if (!driver) return Promise.resolve(null);
    return driver.logout().then(function () { cachedUser = null; emit(); return null; });
  }
  function updateProfile(patch) {
    if (!driver) return Promise.reject(new Error("Auth is not configured."));
    return driver.updateProfile(patch).then(done);
  }

  /* ---------- shared validation ---------- */

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validateRegistration(input) {
    var errors = {};
    var name = (input.name || "").trim();
    var email = (input.email || "").trim();
    var password = input.password || "";
    var confirm = input.confirm || "";

    if (!name) errors.name = "Please enter your name.";
    else if (name.length > 80) errors.name = "That name is too long.";

    if (!email) errors.email = "Please enter your email address.";
    else if (!EMAIL_RE.test(email)) errors.email = "That does not look like a valid email address.";

    if (!password) errors.password = "Please choose a password.";
    else if (password.length < 8) errors.password = "Use at least 8 characters.";
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      errors.password = "Include at least one letter and one number.";
    }

    if (password !== confirm) errors.confirm = "The two passwords do not match.";

    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  function validateLogin(input) {
    var errors = {};
    var email = (input.email || "").trim();
    var password = input.password || "";
    if (!email) errors.email = "Please enter your email address.";
    else if (!EMAIL_RE.test(email)) errors.email = "That does not look like a valid email address.";
    if (!password) errors.password = "Please enter your password.";
    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  /* ---------- local development driver ---------- */

  function weakHash(text) {
    // FNV-1a. Not cryptography — this driver is a development fixture and
    // the UI says so. Real accounts never touch this path.
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  function localAuthDriver(namespace) {
    var NS = namespace || "study-planner-dev";
    var USERS = NS + ":users";
    var SESSION = NS + ":session";

    function readUsers() {
      try { return JSON.parse(localStorage.getItem(USERS) || "[]"); } catch (e) { return []; }
    }
    function writeUsers(rows) { localStorage.setItem(USERS, JSON.stringify(rows)); }
    function salt() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
    function publicUser(u) { return { id: u.id, email: u.email, name: u.name }; }

    return {
      name: "local",
      supportsGoogle: false,

      restore: function () {
        var id = localStorage.getItem(SESSION);
        if (!id) return Promise.resolve(null);
        var u = readUsers().find(function (x) { return x.id === id; });
        return Promise.resolve(u ? publicUser(u) : null);
      },

      register: function (input) {
        var check = validateRegistration(input);
        if (!check.ok) { var e = new Error("Please fix the highlighted fields."); e.fields = check.errors; return Promise.reject(e); }
        var email = input.email.trim().toLowerCase();
        var users = readUsers();
        if (users.some(function (u) { return u.email === email; })) {
          var dup = new Error("An account with that email already exists."); dup.fields = { email: dup.message }; return Promise.reject(dup);
        }
        var s = salt();
        var user = {
          id: "u_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
          email: email,
          name: input.name.trim(),
          salt: s,
          hash: weakHash(s + input.password),
          createdAt: new Date().toISOString()
        };
        users.push(user);
        writeUsers(users);
        localStorage.setItem(SESSION, user.id);
        return Promise.resolve(publicUser(user));
      },

      login: function (input) {
        var check = validateLogin(input);
        if (!check.ok) { var e = new Error("Please fix the highlighted fields."); e.fields = check.errors; return Promise.reject(e); }
        var email = input.email.trim().toLowerCase();
        var u = readUsers().find(function (x) { return x.email === email; });
        // same message either way, so the form never reveals which emails exist
        var bad = new Error("Email or password is incorrect.");
        if (!u) return Promise.reject(bad);
        if (u.hash !== weakHash(u.salt + input.password)) return Promise.reject(bad);
        localStorage.setItem(SESSION, u.id);
        return Promise.resolve(publicUser(u));
      },

      loginWithGoogle: function () {
        return Promise.reject(new Error("Google sign-in needs the Supabase backend."));
      },

      logout: function () {
        localStorage.removeItem(SESSION);
        return Promise.resolve(null);
      },

      updateProfile: function (patch) {
        var id = localStorage.getItem(SESSION);
        var users = readUsers();
        var u = users.find(function (x) { return x.id === id; });
        if (!u) return Promise.reject(new Error("Not signed in."));
        if (patch.name) u.name = patch.name.trim();
        writeUsers(users);
        return Promise.resolve(publicUser(u));
      }
    };
  }

  /* ---------- Supabase driver ---------- */

  function supabaseAuthDriver(client, redirectTo) {
    return {
      name: "supabase",
      supportsGoogle: true,

      restore: function () {
        return client.auth.getSession().then(function (res) {
          var session = res && res.data ? res.data.session : null;
          if (!session || !session.user) return null;
          var u = session.user;
          return { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email };
        });
      },

      register: function (input) {
        var check = validateRegistration(input);
        if (!check.ok) { var e = new Error("Please fix the highlighted fields."); e.fields = check.errors; return Promise.reject(e); }
        return client.auth.signUp({
          email: input.email.trim().toLowerCase(),
          password: input.password,
          options: { data: { full_name: input.name.trim() } }
        }).then(function (res) {
          if (res.error) throw new Error(res.error.message);
          if (!res.data.session) {
            // email confirmation is switched on for this project
            var e2 = new Error("Account created. Check your inbox to confirm your email, then sign in.");
            e2.needsConfirmation = true;
            throw e2;
          }
          var u = res.data.user;
          return { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || input.name.trim() };
        });
      },

      login: function (input) {
        var check = validateLogin(input);
        if (!check.ok) { var e = new Error("Please fix the highlighted fields."); e.fields = check.errors; return Promise.reject(e); }
        return client.auth.signInWithPassword({
          email: input.email.trim().toLowerCase(),
          password: input.password
        }).then(function (res) {
          if (res.error) {
            var err = new Error("Email or password is incorrect.");
            err.fields = { password: err.message };
            throw err;
          }
          var u = res.data.user;
          return { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email };
        });
      },

      loginWithGoogle: function () {
        return client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: redirectTo || window.location.origin }
        }).then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return null;   // the browser navigates away; the session arrives on return
        });
      },

      logout: function () {
        return client.auth.signOut().then(function () { return null; });
      },

      updateProfile: function (patch) {
        return client.auth.updateUser({ data: { full_name: patch.name } }).then(function (res) {
          if (res.error) throw new Error(res.error.message);
          var u = res.data.user;
          return { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email };
        });
      }
    };
  }

  return {
    configure: configure,
    onChange: onChange,
    current: current,
    isSignedIn: isSignedIn,
    driverName: driverName,
    supportsGoogle: supportsGoogle,
    register: register,
    login: login,
    loginWithGoogle: loginWithGoogle,
    logout: logout,
    updateProfile: updateProfile,
    validateRegistration: validateRegistration,
    validateLogin: validateLogin,
    localAuthDriver: localAuthDriver,
    supabaseAuthDriver: supabaseAuthDriver
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = StudyAuth; }
