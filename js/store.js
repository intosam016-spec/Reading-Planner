/* =====================================================================
   Study Planner — data layer

   The app talks ONLY to this module. The module talks to a "driver".
   Two drivers ship:
     - localDriver   : localStorage, per-user namespaced. Development only.
     - supabaseDriver: Postgres + row-level security. Production.

   Swapping drivers is a one-line call to StudyStore.configure(). No view
   code changes. Every method returns a Promise, so both drivers behave
   identically from the caller's point of view.
   ===================================================================== */
var StudyStore = (function () {
  "use strict";

  var COLLECTIONS = ["courses", "lectures", "availability", "sessions", "settings"];
  var current = null;          // active driver
  var currentUserId = null;

  // Whether the backend is not just *configured* but actually answering.
  // The UI keys its warning banner off this, so a Supabase project whose
  // tables are missing keeps warning the user instead of silently failing.
  var backend = { mode: "local", healthy: true, reason: "" };

  function setBackendStatus(mode, healthy, reason) {
    backend = { mode: mode, healthy: !!healthy, reason: reason || "" };
  }
  function backendStatus() { return backend; }

  function configure(driver, userId) {
    current = driver;
    currentUserId = userId || null;
  }

  function setUser(userId) { currentUserId = userId; }
  function getUser() { return currentUserId; }
  function driverName() { return current ? current.name : null; }
  function isProduction() { return !!current && current.name === "supabase"; }

  function requireReady() {
    if (!current) throw new Error("StudyStore: no driver configured.");
    if (!currentUserId) throw new Error("StudyStore: no signed-in user.");
  }

  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 10);
    return (prefix || "id") + "_" + Date.now().toString(36) + "_" + rnd;
  }

  /* ---------- generic collection API ---------- */

  function list(collection, filter) {
    requireReady();
    return Promise.resolve(current.list(currentUserId, collection, filter || null));
  }

  function get(collection, id) {
    requireReady();
    return Promise.resolve(current.get(currentUserId, collection, id));
  }

  function create(collection, row) {
    requireReady();
    var record = Object.assign({}, row);
    if (!record.id) record.id = uid(collection.slice(0, 3));
    record.userId = currentUserId;
    record.createdAt = record.createdAt || new Date().toISOString();
    record.updatedAt = record.createdAt;
    return Promise.resolve(current.insert(currentUserId, collection, record));
  }

  function update(collection, id, patch) {
    requireReady();
    var clean = Object.assign({}, patch, { updatedAt: new Date().toISOString() });
    delete clean.id;
    delete clean.userId;
    return Promise.resolve(current.update(currentUserId, collection, id, clean));
  }

  function remove(collection, id) {
    requireReady();
    return Promise.resolve(current.remove(currentUserId, collection, id));
  }

  /* ---------- convenience wrappers ---------- */

  var api = {
    configure: configure,
    setUser: setUser,
    getUser: getUser,
    driverName: driverName,
    isProduction: isProduction,
    uid: uid,
    COLLECTIONS: COLLECTIONS,

    list: list,
    get: get,
    create: create,
    update: update,
    remove: remove,

    courses: {
      list: function () { return list("courses"); },
      create: function (c) { return create("courses", c); },
      update: function (id, p) { return update("courses", id, p); },
      remove: function (id) { return remove("courses", id); }
    },
    lectures: {
      list: function () { return list("lectures"); },
      create: function (l) { return create("lectures", l); },
      update: function (id, p) { return update("lectures", id, p); },
      remove: function (id) { return remove("lectures", id); }
    },
    availability: {
      list: function () { return list("availability"); },
      create: function (a) { return create("availability", a); },
      update: function (id, p) { return update("availability", id, p); },
      remove: function (id) { return remove("availability", id); }
    },
    sessions: {
      list: function () { return list("sessions"); },
      create: function (s) { return create("sessions", s); },
      update: function (id, p) { return update("sessions", id, p); },
      remove: function (id) { return remove("sessions", id); },
      // replace the whole plan in one go — used by the generator.
      // Every row must be stamped with the owner, or the per-user filter
      // (and Postgres RLS) will not see it.
      replaceAll: function (rows) {
        requireReady();
        var now = new Date().toISOString();
        var stamped = (rows || []).map(function (r) {
          var rec = Object.assign({}, r, { userId: currentUserId });
          rec.createdAt = rec.createdAt || now;
          rec.updatedAt = now;
          return rec;
        });
        return Promise.resolve(current.replaceAll(currentUserId, "sessions", stamped));
      }
    },
    settings: {
      get: function () {
        requireReady();
        return Promise.resolve(current.getSettings(currentUserId));
      },
      set: function (patch) {
        requireReady();
        return Promise.resolve(current.saveSettings(currentUserId, patch));
      }
    },

    // everything the generator needs, in one round trip
    loadProfile: function () {
      requireReady();
      return Promise.all([list("courses"), list("lectures"), list("availability"), api.settings.get()])
        .then(function (r) {
          return { courses: r[0], lectures: r[1], availability: r[2], preferences: r[3] };
        });
    }
  };

  /* =====================================================================
     Driver 1 — localStorage (DEVELOPMENT ONLY)

     This exists so the UI can be built and tested before the backend is
     wired up. It is NOT secure: data sits in the browser and any user of
     this device can read it. The app shows a visible warning banner while
     this driver is active, and it must never be the only storage.
     ===================================================================== */
  function localDriver(namespace) {
    var NS = namespace || "study-planner-dev";
    function key(collection) { return NS + ":" + collection; }
    function readAll(collection) {
      try { return JSON.parse(localStorage.getItem(key(collection)) || "[]"); }
      catch (e) { return []; }
    }
    function writeAll(collection, rows) {
      localStorage.setItem(key(collection), JSON.stringify(rows));
    }
    function scoped(userId, collection) {
      return readAll(collection).filter(function (r) { return r.userId === userId; });
    }

    return {
      name: "local",
      list: function (userId, collection) { return scoped(userId, collection); },
      get: function (userId, collection, id) {
        return scoped(userId, collection).find(function (r) { return r.id === id; }) || null;
      },
      insert: function (userId, collection, row) {
        var rows = readAll(collection);
        rows.push(row);
        writeAll(collection, rows);
        return row;
      },
      update: function (userId, collection, id, patch) {
        var rows = readAll(collection), found = null;
        rows = rows.map(function (r) {
          if (r.id !== id || r.userId !== userId) return r;
          found = Object.assign({}, r, patch);
          return found;
        });
        writeAll(collection, rows);
        if (!found) throw new Error("Not found: " + collection + "/" + id);
        return found;
      },
      remove: function (userId, collection, id) {
        var rows = readAll(collection).filter(function (r) { return !(r.id === id && r.userId === userId); });
        writeAll(collection, rows);
        return true;
      },
      replaceAll: function (userId, collection, newRows) {
        var kept = readAll(collection).filter(function (r) { return r.userId !== userId; });
        writeAll(collection, kept.concat(newRows));
        return newRows;
      },
      getSettings: function (userId) {
        var rows = readAll("settings");
        var found = rows.find(function (r) { return r.userId === userId; });
        return found ? found.value : defaultPreferences();
      },
      saveSettings: function (userId, patch) {
        var rows = readAll("settings");
        var found = rows.find(function (r) { return r.userId === userId; });
        var value = Object.assign({}, found ? found.value : defaultPreferences(), patch);
        if (found) found.value = value;
        else rows.push({ id: "set_" + userId, userId: userId, value: value });
        writeAll("settings", rows);
        return value;
      },
      wipeUser: function (userId) {
        COLLECTIONS.forEach(function (c) {
          writeAll(c, readAll(c).filter(function (r) { return r.userId !== userId; }));
        });
      }
    };
  }

  function defaultPreferences() {
    return {
      sessionMinutes: 60,
      breakMinutes: 10,
      maxSessionsPerDay: 4,
      lectureBufferMinutes: 15,
      preferredStart: "08:00",
      preferredEnd: "22:00",
      weeks: 1,
      startDate: new Date().toISOString().slice(0, 10)
    };
  }

  /* =====================================================================
     Driver 2 — Supabase

     Expects a client created with the PUBLIC anon key. Row-level security
     policies (see supabase/schema.sql) are what actually enforce that a
     student can only ever read and write their own rows — the client-side
     userId filter below is a convenience, not the security boundary.
     ===================================================================== */
  function supabaseDriver(client) {
    function table(collection) { return client.from(collection); }
    function unwrap(res) {
      if (res.error) throw new Error(res.error.message || "Supabase error");
      return res.data;
    }
    return {
      name: "supabase",
      // Cheap round-trip proving the tables exist AND the API can see
      // them. A table that was never created, or that the API roles have
      // no privilege on, comes back as PGRST205.
      probe: function () {
        return table("courses").select("id").limit(1).then(function (res) {
          if (res.error) {
            var code = res.error.code ? res.error.code + ": " : "";
            return { ok: false, reason: code + (res.error.message || "unknown error") };
          }
          return { ok: true };
        }).catch(function (e) {
          return { ok: false, reason: e && e.message ? e.message : String(e) };
        });
      },
      list: function (userId, collection, filter) {
        var q = table(collection).select("*").eq("user_id", userId);
        if (filter) Object.keys(filter).forEach(function (k) { q = q.eq(k, filter[k]); });
        return q.then(unwrap).then(function (rows) { return (rows || []).map(fromRow); });
      },
      get: function (userId, collection, id) {
        return table(collection).select("*").eq("user_id", userId).eq("id", id).maybeSingle().then(unwrap);
      },
      insert: function (userId, collection, row) {
        return table(collection).insert(toRow(userId, row)).select().single().then(unwrap).then(fromRow);
      },
      update: function (userId, collection, id, patch) {
        return table(collection).update(toRow(userId, patch)).eq("user_id", userId).eq("id", id)
          .select().single().then(unwrap).then(fromRow);
      },
      remove: function (userId, collection, id) {
        return table(collection).delete().eq("user_id", userId).eq("id", id).then(unwrap);
      },
      replaceAll: function (userId, collection, rows) {
        return table(collection).delete().eq("user_id", userId)
          .then(function () {
            if (!rows.length) return [];
            return table(collection).insert(rows.map(function (r) { return toRow(userId, r); })).select().then(unwrap);
          })
          .then(function (data) { return (data || []).map(fromRow); });
      },
      getSettings: function (userId) {
        return table("settings").select("*").eq("user_id", userId).maybeSingle()
          .then(unwrap)
          .then(function (row) { return row ? row.value : defaultPreferences(); });
      },
      saveSettings: function (userId, patch) {
        return this.getSettings(userId).then(function (existing) {
          var value = Object.assign({}, defaultPreferences(), existing, patch);
          return table("settings").upsert({ user_id: userId, value: value }).select().single()
            .then(unwrap).then(function (row) { return row.value; });
        });
      }
    };
  }

  // snake_case in Postgres, camelCase in the app
  var FIELD_MAP = {
    userId: "user_id", courseId: "course_id", examDate: "exam_date",
    estimatedMinutes: "estimated_minutes", createdAt: "created_at", updatedAt: "updated_at",
    startMin: "start_min", endMin: "end_min", topicId: "topic_id"
  };
  function toRow(userId, obj) {
    var out = { user_id: userId };
    Object.keys(obj).forEach(function (k) {
      if (k === "userId") return;
      out[FIELD_MAP[k] || k] = obj[k];
    });
    return out;
  }
  function fromRow(row) {
    if (!row) return row;
    var out = {};
    var rev = {};
    Object.keys(FIELD_MAP).forEach(function (camel) { rev[FIELD_MAP[camel]] = camel; });
    Object.keys(row).forEach(function (k) { out[rev[k] || k] = row[k]; });
    return out;
  }

  /* ---------- one-time import of data left in this browser ---------- */

  // Reads back whatever a legacy local account left in localStorage,
  // matched by email, so it can be offered for import once the real
  // backend is live. Returns null when there is nothing to move.
  function localSnapshot(email, namespace) {
    if (!email || typeof localStorage === "undefined") return null;
    var ns = namespace || "study-planner-dev";
    function readJson(k) {
      try { return JSON.parse(localStorage.getItem(k) || "[]"); }
      catch (e) { return []; }
    }
    var match = readJson(ns + ":users").filter(function (u) {
      return String(u.email || "").toLowerCase() === String(email).toLowerCase();
    })[0];
    if (!match) return null;

    var out = {}, total = 0;
    COLLECTIONS.forEach(function (c) {
      var rows = readJson(ns + ":" + c).filter(function (r) { return r.userId === match.id; });
      out[c] = rows;
      total += c === "settings" ? (rows.length ? 1 : 0) : rows.length;
    });
    return total ? { localUserId: match.id, email: match.email, data: out, count: total } : null;
  }

  // Copies a snapshot into the active (Supabase) driver. Only ever called
  // on an empty account, so it cannot overwrite real data.
  function importLocalSnapshot(userId, snap) {
    requireReady();
    var jobs = [];
    ["courses", "lectures", "availability", "sessions"].forEach(function (c) {
      var rows = (snap.data[c] || []).map(function (r) {
        var copy = Object.assign({}, r);
        delete copy.userId;
        return copy;
      });
      if (rows.length) jobs.push(current.replaceAll(userId, c, rows));
    });
    var st = (snap.data.settings || [])[0];
    if (st && st.value) jobs.push(current.saveSettings(userId, st.value));
    return Promise.all(jobs).then(function () { return snap.count; });
  }

  api.localDriver = localDriver;
  api.supabaseDriver = supabaseDriver;
  api.defaultPreferences = defaultPreferences;
  api.setBackendStatus = setBackendStatus;
  api.backendStatus = backendStatus;
  api.localSnapshot = localSnapshot;
  api.importLocalSnapshot = importLocalSnapshot;
  api.toRow = toRow;
  api.fromRow = fromRow;

  return api;
})();

if (typeof module !== "undefined" && module.exports) { module.exports = StudyStore; }
