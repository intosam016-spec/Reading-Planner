/* Study Planner — small shared UI helpers. */
var UI = (function () {
  "use strict";

  var DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return DAY_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
  }

  function fmtDateLong(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return DAY_LONG[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function dayName(i) { return DAY_LONG[+i] || ""; }
  function dayShort(i) { return DAY_SHORT[+i] || ""; }

  var toastTimer = null;
  function toast(msg, kind) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show" + (kind === "error" ? " error" : "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = "toast"; }, 3000);
  }

  function setFieldError(form, fieldName, message) {
    var wrap = form.querySelector('[data-field="' + fieldName + '"]');
    if (!wrap) return;
    wrap.classList.toggle("bad", !!message);
    var err = wrap.querySelector(".err");
    if (err) err.textContent = message || "";
  }

  function clearErrors(form) {
    form.querySelectorAll(".field").forEach(function (f) {
      f.classList.remove("bad");
      var e = f.querySelector(".err");
      if (e) e.textContent = "";
    });
  }

  function applyErrors(form, errors) {
    clearErrors(form);
    Object.keys(errors || {}).forEach(function (k) { setFieldError(form, k, errors[k]); });
    var first = form.querySelector(".field.bad input, .field.bad select");
    if (first) first.focus();
  }

  function banner(kind, html) {
    return '<div class="banner ' + kind + '">' + html + "</div>";
  }

  function empty(msg) { return '<p class="empty">' + esc(msg) + "</p>"; }

  // "HH:MM" -> minutes, tolerant of "HH:MM:SS" coming back from Postgres
  function toMin(t) {
    if (!t) return NaN;
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t));
    return m ? (+m[1]) * 60 + (+m[2]) : NaN;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  return {
    DAY_SHORT: DAY_SHORT, DAY_LONG: DAY_LONG,
    esc: esc, todayISO: todayISO, fmtDate: fmtDate, fmtDateLong: fmtDateLong,
    dayName: dayName, dayShort: dayShort,
    toast: toast, setFieldError: setFieldError, clearErrors: clearErrors, applyErrors: applyErrors,
    banner: banner, empty: empty, toMin: toMin, pad2: pad2
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = UI; }
