/* Home route: Repeat Issue Radar demo + in-page scrolling.
   app.js loads this file once, then calls window.FMC_HOME.init(root) every time the Home route
   renders. init() returns a cleanup function that app.js calls when the route changes. */
(function () {
  // Example reports, positions in metres from the first pothole report.
  var pins = [
    { x: 0,    y: 0,    cat: "pothole", conf: 2, age: 12 },
    { x: 60,   y: -40,  cat: "pothole", conf: 1, age: 9 },
    { x: -80,  y: 50,   cat: "pothole", conf: 1, age: 7 },
    { x: 110,  y: 90,   cat: "pothole", conf: 0, age: 4 },
    { x: -30,  y: -120, cat: "pothole", conf: 0, age: 3 },
    { x: 170,  y: -100, cat: "pothole", conf: 0, age: 1 },
    { x: -170, y: 150,  cat: "pothole", conf: 0, age: 1 },
    { x: 40,   y: 60,   cat: "garbage", conf: 1, age: 5 },
    { x: -100, y: -60,  cat: "garbage", conf: 0, age: 2 }
  ];
  var NS = "http://www.w3.org/2000/svg", C = 200;

  function init(root) {
    var svg = root.querySelector("#homeMap");
    var slider = root.querySelector("#homeRadius");
    if (!svg || !slider) return function () {};
    var cleanups = [];
    function on(target, evt, fn) { target.addEventListener(evt, fn); cleanups.push(function () { target.removeEventListener(evt, fn); }); }

    function el(name, attrs, parent) {
      var e = document.createElementNS(NS, name);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(e); return e;
    }
    svg.textContent = ""; // re-init safe
    [60, 140, 200, 280, 340].forEach(function (p) {
      el("line", { x1: p, y1: 0, x2: p, y2: 400, stroke: "var(--map-line)", "stroke-width": p === 200 ? 14 : 8 });
      el("line", { x1: 0, y1: p, x2: 400, y2: p, stroke: "var(--map-line)", "stroke-width": p === 200 ? 14 : 8 });
    });
    var ring = el("circle", { cx: C, cy: C, r: 150, fill: "var(--primary)", "fill-opacity": 0.12, stroke: "var(--primary)", "stroke-width": 2, "stroke-dasharray": "6 5" });
    var dots = pins.map(function (p) {
      var g = el("g", {});
      var halo = el("circle", { cx: C + p.x, cy: C + p.y, r: 15, fill: "none", stroke: "var(--primary)", "stroke-width": 2 }, g);
      var d = el("circle", { cx: C + p.x, cy: C + p.y, r: 9, fill: p.cat === "pothole" ? "var(--primary)" : "var(--secondary)", stroke: "var(--surface)", "stroke-width": 2.5 }, g);
      return { p: p, g: g, halo: halo, d: d };
    });
    var out = root.querySelector("#homeRadiusOut");
    var sR = root.querySelector("#homeReports"), sC = root.querySelector("#homeConfirm"), sO = root.querySelector("#homeOldest"), verdict = root.querySelector("#homeVerdict");

    function update() {
      var r = +slider.value, n = 0, c = 0, oldest = 0;
      ring.setAttribute("r", r);
      out.textContent = r + " m";
      dots.forEach(function (o) {
        var inside = o.p.cat === "pothole" && Math.hypot(o.p.x, o.p.y) <= r;
        if (inside) { n++; c += o.p.conf; oldest = Math.max(oldest, o.p.age); }
        o.d.setAttribute("opacity", o.p.cat === "pothole" && !inside ? 0.35 : 1);
        o.halo.setAttribute("opacity", inside ? 0.9 : 0);
      });
      sR.textContent = n; sC.textContent = c; sO.textContent = oldest + " d";
      var flagged = n >= 3;
      verdict.textContent = flagged ? "Possible recurring issue" : "Not enough reports yet";
      verdict.className = "tag " + (flagged ? "tag-warn" : "");
    }
    on(slider, "input", update);
    update();

    // In-page "scroll to section" buttons. Real #anchors would change the hash and break routing.
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.querySelectorAll("[data-scroll]").forEach(function (b) {
      on(b, "click", function (e) {
        e.preventDefault();
        var target = root.querySelector("#" + b.getAttribute("data-scroll"));
        if (target) target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      });
    });

    root.querySelectorAll("[data-tour]").forEach(function (b) {
      on(b, "click", function () { location.hash = "#/tour"; });
    });

    return function cleanup() {
      stopCount();
      cleanups.forEach(function (f) { f(); });
      cleanups = [];
    };
  }
  // Live impact band. app.js fetches the numbers and calls this; null means "could not load".
  var raf = 0;
  function stopCount() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function setImpact(root, d) {
    var note = root.querySelector("#impactNote");
    if (!note) return;
    if (!d) { note.textContent = "Live numbers are not available right now."; return; }
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var targets = { reports: d.reports, resolved: d.resolved, neighbours: d.neighbours, days: d.days };
    var els = {};
    Object.keys(targets).forEach(function (k) { els[k] = root.querySelector('[data-impact="' + k + '"]'); });
    function paint(f) {
      Object.keys(targets).forEach(function (k) {
        var v = targets[k], el = els[k];
        if (!el) return;
        if (v == null) { el.textContent = "n/a"; return; }
        el.textContent = k === "days" ? (Math.round(v * f * 10) / 10) : Math.round(v * f);
      });
    }
    stopCount();
    if (reduce) paint(1);
    else {
      var t0 = null, dur = 1200;
      var step = function (ts) {
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        paint(e);
        raf = p < 1 ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    }
    note.textContent = (d.demo ? "Includes " + d.demo + " labelled demo reports. " : "") + "Live from the community database" + (d.days == null ? "; average fix time appears once a report has been resolved." : ".");
  }
  window.FMC_HOME = { init: init, setImpact: setImpact };
})();
