/* Guided tour: a 6-step spotlight walk through the app, read-only and usable without signing in.
   app.js loads this file on demand (#/tour or ?tour=1) and calls FMC_TOUR.start({ target }),
   where target() resolves to { issueId } for a report worth showing (or null when there are none). */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var state = null;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function waitFor(sel, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var n = document.querySelector(sel);
        if (n) return resolve(n);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(poll, 120);
      })();
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function buildSteps(target) {
    var issue = target && target.issueId ? "#/issue/" + target.issueId : null;
    return [
      { route: "#/map", wait: "#side h2", target: "#map", title: "The Repeat Issue Radar",
        body: "Dashed rings mark places where several neighbours reported the same kind of problem. We flew the map to the biggest cluster. Reports are only suggested as a group, never merged automatically.",
        before: function () { var c = document.querySelector("#side .cluster"); if (c) c.click(); return sleep(reduce ? 50 : 700); } },
      { route: issue, wait: "#mainCard", target: "#mainCard", title: "Open any report",
        body: "Each report has a photo, a category, where it is and how long it has been open. Reports past their target for the category show an Overdue badge.",
        missing: "There are no reports yet, so there is nothing to open. Once someone reports an issue it will appear here." },
      { route: issue, wait: "#communityCard", target: "#communityCard", title: "The community confirms",
        body: "Signed-in neighbours say whether the problem still exists, got worse or looks fixed, one vote each. You are viewing read-only, so nothing here changes.",
        missing: "Community confirmation shows up on each report once there is one." },
      { route: issue, wait: "#historyCard", target: "#historyCard", title: "A status timeline you can trust",
        body: "Every status change is recorded with who made it, from Submitted to Resolved. If neighbours say a fix did not hold, a resolved report can be reopened.",
        missing: "Every report has a timeline of status changes." },
      { route: "#/pulse", wait: ".tiles", target: ".tiles", title: "Neighbourhood Pulse",
        body: "Open and resolved counts, overdue reports, the oldest unresolved items and recurring hotspots, with an area report card and a shareable image." },
      { route: "#/circles", wait: "#circlesTop", target: "#circlesTop", title: "Action Circles",
        body: "Residents can start and join safe, voluntary activities such as clean-ups and tree planting. That is the tour. Report an issue to try it for real." }
    ].map(function (s) { if (!s.route) { s.route = null; } return s; });
  }

  function start(opts) {
    if (state) close(false);
    var prev = document.activeElement;
    var overlay = el("div", "tour-block");
    var spot = el("div", "tour-spot");
    var pop = el("div", "tour-pop");
    pop.setAttribute("role", "dialog"); pop.setAttribute("aria-modal", "true");
    pop.setAttribute("aria-labelledby", "tourTitle"); pop.setAttribute("aria-describedby", "tourBody");
    pop.innerHTML = '<p class="tour-count small muted" id="tourCount"></p><h2 id="tourTitle"></h2><p id="tourBody"></p>' +
      '<div class="row tour-btns"><button type="button" class="btn ghost sm" id="tourSkip">Skip</button><span class="tour-gap"></span>' +
      '<button type="button" class="btn ghost sm" id="tourBack">Back</button><button type="button" class="btn sm" id="tourNext">Next</button></div>';
    overlay.appendChild(spot); document.body.appendChild(overlay); document.body.appendChild(pop);
    var inertEls = Array.prototype.slice.call(document.querySelectorAll("header.top, #view, .site-foot"));
    inertEls.forEach(function (n) { n.setAttribute("inert", ""); });

    var st = state = { i: 0, steps: null, expected: null, current: null, token: 0, overlay: overlay, spot: spot, pop: pop, inertEls: inertEls, prev: prev, raf: 0 };
    var $ = function (id) { return pop.querySelector("#" + id); };

    function place() {
      st.raf = 0;
      var t = st.current;
      if (!t || !t.isConnected) { spot.style.display = "none"; pop.classList.add("tour-center"); return; }
      var r = t.getBoundingClientRect(), pad = 8;
      spot.style.display = "block";
      spot.style.top = Math.max(0, r.top - pad) + "px"; spot.style.left = Math.max(0, r.left - pad) + "px";
      spot.style.width = Math.min(window.innerWidth, r.width + pad * 2) + "px"; spot.style.height = Math.min(window.innerHeight, r.height + pad * 2) + "px";
      pop.classList.remove("tour-center");
      var below = r.top + r.height / 2 < window.innerHeight / 2;
      pop.style.top = below ? "auto" : "12px"; pop.style.bottom = below ? "12px" : "auto";
    }
    function schedulePlace() { if (!st.raf) st.raf = requestAnimationFrame(place); }
    window.addEventListener("scroll", schedulePlace, true); window.addEventListener("resize", schedulePlace);

    async function show(i) {
      var token = ++st.token;
      st.i = i;
      var s = st.steps[i];
      $("tourCount").textContent = "Step " + (i + 1) + " of " + st.steps.length;
      $("tourTitle").textContent = s.title;
      $("tourBody").textContent = s.body;
      $("tourBack").disabled = i === 0;
      $("tourNext").textContent = i === st.steps.length - 1 ? "Finish" : "Next";
      $("tourNext").disabled = true;
      st.current = null; schedulePlace();
      if (s.route && location.hash !== s.route) { st.expected = s.route; location.hash = s.route; } else st.expected = location.hash;
      var node = s.route ? await waitFor(s.wait, 9000) : null;
      if (token !== st.token || state !== st) return;
      if (node && s.before) { try { await s.before(); } catch (e) { /* decorative step, keep going */ } }
      if (token !== st.token || state !== st) return;
      if (!node) {
        $("tourBody").textContent = s.missing || "This part could not load right now. You can still continue.";
      } else {
        var tall = node.getBoundingClientRect().height > window.innerHeight * 0.6;
        node.scrollIntoView({ block: tall ? "start" : "center", behavior: "auto" });
        st.current = node;
      }
      $("tourNext").disabled = false;
      schedulePlace();
      $("tourNext").focus();
    }
    function close(done) {
      if (state !== st) return;
      state = null;
      if (st.raf) cancelAnimationFrame(st.raf);
      window.removeEventListener("scroll", schedulePlace, true); window.removeEventListener("resize", schedulePlace);
      window.removeEventListener("hashchange", onHash); document.removeEventListener("keydown", onKey, true);
      overlay.remove(); pop.remove();
      st.inertEls.forEach(function (n) { n.removeAttribute("inert"); });
      var t = document.getElementById("toast");
      if (done && t) { t.textContent = "Tour finished. Try reporting an issue."; t.classList.add("show"); setTimeout(function () { t.classList.remove("show"); }, 3200); }
      var v = document.getElementById("view");
      if (v) v.focus({ preventScroll: true });
    }
    function onHash() { if (location.hash !== st.expected) close(false); } // user navigated away (e.g. browser Back)
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); return; }
      if (e.key !== "Tab") return;
      var f = Array.prototype.filter.call(pop.querySelectorAll("button"), function (b) { return !b.disabled; });
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (!pop.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener("hashchange", onHash); document.addEventListener("keydown", onKey, true);
    $("tourSkip").onclick = function () { close(false); };
    $("tourBack").onclick = function () { if (st.i > 0) show(st.i - 1); };
    $("tourNext").onclick = function () { if (st.i < st.steps.length - 1) show(st.i + 1); else close(true); };

    $("tourTitle").textContent = "Starting the tour…";
    Promise.resolve(opts && opts.target ? opts.target() : null).catch(function () { return null; }).then(function (target) {
      if (state !== st) return;
      st.steps = buildSteps(target);
      // Without any report, the three report steps explain themselves in place instead of navigating.
      st.steps.forEach(function (s) { if (!target && s.target && /^#(mainCard|communityCard|historyCard)$/.test(s.target)) { s.route = "#/map"; s.wait = "#map"; s.target = "#map"; } });
      show(0);
    });
  }
  window.FMC_TOUR = { start: start };
})();
