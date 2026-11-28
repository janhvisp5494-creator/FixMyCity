/* FixMyCity app: auth, reporting, map + Repeat Issue Radar, issue pages, admin.
   Plain JavaScript, hash routing. Data and auth come from Supabase. */
(async function () {
  const cfg = window.FMC_CONFIG || {};
  const view = document.getElementById("view");
  const navEl = document.getElementById("nav");
  const navToggle = document.getElementById("navToggle");

  if (!cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.indexOf("PASTE") === 0) {
    view.innerHTML = '<div class="card narrow"><h2>Setup needed</h2><p>Add your Supabase anon key to <code>app/config.js</code>, then reload.</p></div>';
    return;
  }
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const CATS = {
    pothole: { label: "Pothole", color: "#C5633C", img: "assets/issues/pothole.webp" },
    garbage: { label: "Garbage", color: "#3C6D4F", img: "assets/issues/garbage.webp" },
    streetlight: { label: "Streetlight", color: "#C99A06", img: "assets/issues/streetlight.webp" },
    drainage: { label: "Drainage", color: "#2F7F9E", img: "assets/issues/drainage.webp" },
    water_logging: { label: "Water logging", color: "#5B6BC0", img: "assets/issues/water-logging.webp" },
    other: { label: "Other", color: "#7A7A7A", img: "assets/issues/other.webp" }
  };
  const STATUSES = [
    ["submitted", "Submitted"], ["community_confirmed", "Community confirmed"],
    ["acknowledged", "Acknowledged"], ["in_progress", "In progress"], ["resolved", "Resolved"]
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES);
  // Service-level targets: days an unresolved report may stay open before it shows as overdue.
  const SLA_DAYS = { pothole: 7, garbage: 2, streetlight: 5, drainage: 5, water_logging: 3, other: 10 };
  const RADIUS = cfg.RADIUS_M || 150, MIN_CLUSTER = cfg.MIN_CLUSTER || 3;
  const BUCKET = "report-images";
  const MIGRATION_HINT = "The database is missing a permission. Run supabase/04-fixes.sql in the Supabase SQL Editor.";

  let homeCleanup = null, homeScript = null;
  const fragments = {}; // cached HTML fragments (home, brand)
  let user = null, profile = null, lastUid = null, map = null, charts = [], realtime = null;
  let notifCount = 0, notifFor = null; // unseen updates on my reports; user id already checked this session
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Each route() call gets a number. A view that resumes after an await checks
  // whether a newer route has started (e.g. login fires both hashchange and the
  // auth listener) and quits instead of drawing over it.
  const blobUrls = []; // object URLs made by a view (open data page); revoked on route change
  let voiceRec = null;  // active speech recognition on the report form
  let routeSeq = 0;
  const routeToken = () => { const s = routeSeq; return () => s !== routeSeq; };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const daysAgo = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
  /* ---------- language (English / Hindi / Gujarati) ---------- */
  const I18N = {
    en: {
      nav_home: "Home", nav_map: "Explore map", nav_pulse: "Pulse", nav_circles: "Action Circles", nav_report: "Report an issue", nav_mine: "My reports", nav_admin: "Admin",
      login: "Log in", logout: "Log out", h_map: "Explore issues", h_report: "Report an issue", h_pulse: "Neighbourhood Pulse", h_circles: "Action Circles",
      h_mine: "My reports", h_admin: "Admin dashboard", submit: "Submit report", join: "Join", leave: "Leave", share: "Share this report", login_join: "Log in to join",
      updates: "{n} updates on your reports",
      cat_pothole: "Pothole", cat_garbage: "Garbage", cat_streetlight: "Streetlight", cat_drainage: "Drainage", cat_water_logging: "Water logging", cat_other: "Other",
      st_submitted: "Submitted", st_community_confirmed: "Community confirmed", st_acknowledged: "Acknowledged", st_in_progress: "In progress", st_resolved: "Resolved"
    },
    hi: {
      nav_home: "होम", nav_map: "नक्शा देखें", nav_pulse: "पल्स", nav_circles: "एक्शन सर्कल", nav_report: "समस्या दर्ज करें", nav_mine: "मेरी रिपोर्ट", nav_admin: "एडमिन",
      login: "लॉग इन", logout: "लॉग आउट", h_map: "समस्याएँ देखें", h_report: "समस्या दर्ज करें", h_pulse: "पड़ोस पल्स", h_circles: "एक्शन सर्कल",
      h_mine: "मेरी रिपोर्ट", h_admin: "एडमिन डैशबोर्ड", submit: "रिपोर्ट जमा करें", join: "जुड़ें", leave: "छोड़ें", share: "यह रिपोर्ट साझा करें", login_join: "जुड़ने के लिए लॉग इन करें",
      updates: "आपकी रिपोर्ट पर {n} अपडेट",
      cat_pothole: "गड्ढा", cat_garbage: "कचरा", cat_streetlight: "स्ट्रीटलाइट", cat_drainage: "नाली", cat_water_logging: "जलभराव", cat_other: "अन्य",
      st_submitted: "दर्ज की गई", st_community_confirmed: "समुदाय द्वारा पुष्टि", st_acknowledged: "स्वीकार की गई", st_in_progress: "प्रगति में", st_resolved: "सुलझ गई"
    },
    gu: {
      nav_home: "હોમ", nav_map: "નકશો જુઓ", nav_pulse: "પલ્સ", nav_circles: "એક્શન સર્કલ", nav_report: "સમસ્યા નોંધાવો", nav_mine: "મારા અહેવાલ", nav_admin: "એડમિન",
      login: "લૉગ ઇન", logout: "લૉગ આઉટ", h_map: "સમસ્યાઓ જુઓ", h_report: "સમસ્યા નોંધાવો", h_pulse: "પડોશ પલ્સ", h_circles: "એક્શન સર્કલ",
      h_mine: "મારા અહેવાલ", h_admin: "એડમિન ડેશબોર્ડ", submit: "અહેવાલ સબમિટ કરો", join: "જોડાઓ", leave: "છોડો", share: "આ અહેવાલ શેર કરો", login_join: "જોડાવા માટે લૉગ ઇન કરો",
      updates: "તમારા અહેવાલો પર {n} અપડેટ",
      cat_pothole: "ખાડો", cat_garbage: "કચરો", cat_streetlight: "સ્ટ્રીટલાઇટ", cat_drainage: "ગટર", cat_water_logging: "પાણી ભરાવું", cat_other: "અન્ય",
      st_submitted: "નોંધાયેલ", st_community_confirmed: "સમુદાય દ્વારા પુષ્ટિ", st_acknowledged: "સ્વીકારાયેલ", st_in_progress: "પ્રગતિમાં", st_resolved: "ઉકેલાયેલ"
    }
  };
  function translate(dict, lang, key, fallback) {
    const l = dict[lang] && dict[lang][key] != null ? dict[lang][key] : null;
    if (l != null) return l;
    if (dict.en && dict.en[key] != null) return dict.en[key];
    return fallback != null ? fallback : key;
  }
  // Start of the "new updates" window: the stored ISO timestamp if valid, else 7 days before `now` (ms).
  function sinceIso(stored, now) {
    if (stored && !isNaN(new Date(stored).getTime())) return stored;
    return new Date(now - 7 * 864e5).toISOString();
  }
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  // Built-in strings exist for en/hi/gu; any other site language uses English here and Google Translate (app/translate.js).
  let lang = window.FMC_LANG ? window.FMC_LANG.builtin : lsGet("fmc_lang");
  if (!I18N[lang]) lang = "en";
  const t = (key, fallback) => translate(I18N, lang, key, fallback);

  const badge = (s) => '<span class="badge s-' + esc(s) + '">' + esc(t("st_" + s, STATUS_LABEL[s] || s)) + "</span>";
  const catDot = (c) => '<span class="dot" style="background:' + (CATS[c] || CATS.other).color + '"></span>';
  const catLabel = (c) => t("cat_" + (CATS[c] ? c : "other"), (CATS[c] || CATS.other).label);
  const demoTag = (r) => (r && r.is_demo ? ' <span class="badge demo">Demo data</span>' : "");
  const slaTarget = (c) => SLA_DAYS[c] != null ? SLA_DAYS[c] : SLA_DAYS.other;
  // Days past the category target for an unresolved report (0 when on time or resolved).
  const overdueDays = (r) => (r && r.status !== "resolved" ? Math.max(0, daysAgo(r.created_at) - slaTarget(r.category)) : 0);
  const overdueBadge = (r) => { const d = overdueDays(r); return d > 0 ? ' <span class="badge overdue" title="Target for this category is ' + slaTarget(r.category) + ' days">Overdue ' + d + "d</span>" : ""; };
  // CSV cell: leading =,+,-,@ are neutralised to stop spreadsheet formula injection.
  const csvCell = (v) => { let s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const scriptLoads = {};
  function loadScript(src) {
    if (!scriptLoads[src]) {
      scriptLoads[src] = new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src; el.onload = resolve; el.onerror = () => { delete scriptLoads[src]; reject(new Error(src + " failed to load")); };
        document.head.appendChild(el);
      });
    }
    return scriptLoads[src];
  }
  const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const areaHref = (a) => "#/area/" + encodeURIComponent(a);
  const fmtDateTime = (iso) => {
    const d = new Date(iso), opts = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return d.toLocaleString(undefined, opts);
  };
  // datetime-local value for "now", in the user's local time
  const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  // Turn raw database errors into something a resident can act on.
  const friendly = (e) => {
    const m = (e && e.message) || String(e || "Something went wrong");
    if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
    if (/duplicate key/i.test(m)) return "You have already done that.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Network problem. Check your connection and try again.";
    return m;
  };
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }
  function showError(e) {
    console.error(e);
    view.innerHTML = '<div class="card narrow"><h2>Something went wrong</h2><p class="muted">' + esc(friendly(e)) + '</p><p><a href="#/map">Back to the map</a></p></div>';
  }
  const notFound = () => { view.innerHTML = '<div class="card narrow"><h1>Report not found</h1><p class="muted">It may have been deleted, or the link is wrong.</p><p><a href="#/map">Back to the map</a></p></div>'; };
  // Two-tap confirmation for destructive buttons (no browser confirm() dialogs).
  function armed(btn, label) {
    if (btn.dataset.armed === "1") return true;
    btn.dataset.armed = "1"; btn.dataset.orig = btn.textContent; btn.textContent = label || "Tap again to confirm";
    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ""; btn.textContent = btn.dataset.orig; } }, 4000);
    return false;
  }
  // Delete a report's photo from storage. Best effort: the report row is already gone.
  async function removePhoto(url) {
    if (!url) return;
    const path = String(url).split("/" + BUCKET + "/")[1];
    if (path) { try { await db.storage.from(BUCKET).remove([decodeURIComponent(path)]); } catch (e) { console.warn(e); } }
  }
  // Delete a report (owner while "submitted", or admin). RLS silently skips rows you may not
  // delete, so check that a row actually came back.
  async function deleteReport(r) {
    const res = await db.from("reports").delete().eq("id", r.id).select("id");
    if (res.error) return friendly(res.error);
    if (!res.data || !res.data.length) return isAdmin() ? MIGRATION_HINT : "This report can no longer be deleted.";
    await removePhoto(r.image_url);
    return null;
  }
  const isAdmin = () => !!(profile && profile.role === "admin");
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  /* Repeat Issue Radar: same category, within `radius` metres of the oldest unclustered report.
     Returns suggested clusters for review. Nothing is merged. */
  function computeClusters(reports, radius) {
    const open = reports.filter((r) => r.status !== "resolved").sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const used = new Set(), out = [];
    for (const a of open) {
      if (used.has(a.id)) continue;
      const members = open.filter((b) => !used.has(b.id) && b.category === a.category &&
        haversine(a.latitude, a.longitude, b.latitude, b.longitude) <= radius);
      if (members.length >= MIN_CLUSTER) {
        members.forEach((m) => used.add(m.id));
        const confirmations = members.reduce((s, m) => s + (Number(m.confirmations) || 0), 0);
        const age = daysAgo(members[0].created_at);
        out.push({
          anchor: a, category: a.category, members, confirmations,
          oldest: members[0].created_at,
          // Priority = how many reports, how many neighbours agree, how long it has been open.
          priority: members.length * 10 + confirmations * 3 + Math.min(age, 60)
        });
      }
    }
    return out.sort((x, y) => y.priority - x.priority);
  }
  const priorityLabel = (c) => (c.priority >= 80 ? "High" : c.priority >= 45 ? "Medium" : "Low");
  const clusterText = (c) => c.members.length + " reports · " + c.confirmations + " community confirmations · oldest " + daysAgo(c.oldest) + " days · " + priorityLabel(c) + " priority";
  // Share a report: native share sheet on phones, otherwise copy the link.
  async function shareLink(title, url) {
    const text = "Help fix our city: " + title + " #BuildForMyCity";
    try {
      if (navigator.share) { await navigator.share({ title: "FixMyCity", text, url }); return; }
      await navigator.clipboard.writeText(text + " " + url);
      toast("Link copied. Paste it anywhere to share.");
    } catch (e) { if (e && e.name !== "AbortError") toast("Could not share. Copy the address from your browser."); }
  }
  // Fill the "area" field from the pin using OpenStreetMap Nominatim (best effort, free, no key).
  // Nominatim allows at most 1 request per second: calls are queued and only the latest pending one is sent.
  let areaLast = 0, areaPending = null;
  function lookupArea(lat, lng) {
    return new Promise((resolve) => {
      if (areaPending) { clearTimeout(areaPending.timer); areaPending.resolve(null); } // superseded by a newer pin
      const wait = Math.max(0, areaLast + 1100 - Date.now());
      const job = { resolve, timer: setTimeout(() => {
        areaPending = null; areaLast = Date.now();
        fetchArea(lat, lng).then(resolve);
      }, wait) };
      areaPending = job;
    });
  }
  async function fetchArea(lat, lng) {
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=" + lat + "&lon=" + lng, { headers: { Accept: "application/json" } });
      if (!r.ok) return null;
      const a = (await r.json()).address || {};
      return a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || a.town || a.city || null;
    } catch (e) { return null; }
  }
  function baseMap(el) {
    const m = L.map(el);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    return m;
  }
  function defaultView(m, tryLocate) {
    m.setView(cfg.DEFAULT_CENTER || [20.59, 78.96], cfg.DEFAULT_ZOOM || 5);
    if (tryLocate && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => { if (m === map) m.setView([p.coords.latitude, p.coords.longitude], 15); }, () => {}, { timeout: 6000 });
    }
  }

  /* ---------- auth + nav ---------- */
  async function loadUser(session) {
    user = session && session.user ? session.user : null;
    profile = null;
    if (user) {
      const r = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
      profile = r.data;
    }
    lastUid = user ? user.id : null;
    renderNav();
    checkUpdates(); // not awaited: runs in the background, once per session
  }
  // In-app notifications: status changes by others and new comments on my reports since I last looked.
  async function checkUpdates() {
    if (!user || notifFor === user.id) return;
    const uid = user.id;
    notifFor = uid;
    try {
      const since = sinceIso(lsGet("fmc_seen_" + uid), Date.now());
      const rq = await db.from("reports").select("id").eq("user_id", uid).limit(500);
      if (rq.error || !rq.data || !rq.data.length) return;
      const ids = rq.data.map((x) => x.id);
      const [hq, cq] = await Promise.all([
        db.from("status_history").select("id", { count: "exact", head: true }).in("report_id", ids).gt("created_at", since).or("updated_by.is.null,updated_by.neq." + uid),
        db.from("report_comments").select("id", { count: "exact", head: true }).in("report_id", ids).gt("created_at", since).neq("user_id", uid)
      ]);
      if (!user || user.id !== uid) return;
      const n = (hq.error ? 0 : hq.count || 0) + (cq.error ? 0 : cq.count || 0); // missing table: just ignore
      if (n > 0) { notifCount = n; renderNav(); toast(t("updates").replace("{n}", n)); }
    } catch (e) { console.warn("Update check failed", e); }
  }
  function renderNav() {
    const h = location.hash;
    const isHome = h === "" || h === "#" || h === "#/";
    const link = (href, text, cls) => { const on = href === "#/" ? isHome : h.indexOf(href) === 0; return '<a href="' + href + '" class="' + (cls || "") + (on ? " active" : "") + '"' + (on ? ' aria-current="page"' : "") + ">" + text + "</a>"; };
    let html = link("#/", esc(t("nav_home"))) + link("#/map", esc(t("nav_map"))) + link("#/pulse", esc(t("nav_pulse"))) + link("#/circles", esc(t("nav_circles"))) + link("#/report", esc(t("nav_report")), "cta");
    if (user) html += link("#/mine", esc(t("nav_mine")) + (notifCount > 0 ? ' <span class="badge" aria-label="' + notifCount + ' new updates">' + notifCount + "</span>" : ""));
    if (isAdmin()) html += link("#/admin", esc(t("nav_admin")));
    html += user ? '<button id="logout" type="button">' + esc(t("logout")) + "</button>" : link("#/login", esc(t("login")));
    html += window.FMC_LANG ? window.FMC_LANG.selectHtml() : "";
    navEl.innerHTML = html;
    const lo = document.getElementById("logout");
    if (lo) lo.onclick = logout;
    if (window.FMC_LANG) window.FMC_LANG.bindSelect(); // language switching lives in app/translate.js
  }
  // Log out locally even if the server call fails (offline, expired or already-revoked
  // session). A failed signOut() must not leave the user logged in while the toast says "Logged out".
  async function logout() {
    const lo = document.getElementById("logout");
    if (lo) lo.disabled = true;
    // signOut() waits for supabase-js's cross-tab auth lock. With the app open in another
    // tab it can hang, which left "Log out" on screen, so give it 4 seconds at most.
    let res;
    const timeout = new Promise((r) => setTimeout(() => r({ error: new Error("signOut timed out") }), 4000));
    try { res = await Promise.race([db.auth.signOut(), timeout]); } catch (e) { res = { error: e }; }
    if (res && res.error) {
      console.warn("signOut failed, clearing the local session instead:", res.error);
      try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
      // Reload so the Supabase client drops the session it still holds in memory.
      location.replace(location.pathname + "#/map");
      location.reload();
      return;
    }
    // Update the UI now rather than waiting for the auth event.
    user = null; profile = null; lastUid = null; notifCount = 0; notifFor = null;
    toast("Logged out");
    if (location.hash === "#/map" || location.hash === "") route(); else location.hash = "#/map";
  }
  if (navToggle) navToggle.onclick = () => {
    const open = navEl.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  };
  db.auth.onAuthStateChange((evt, session) => {
    if (evt === "PASSWORD_RECOVERY") {
      setTimeout(async () => { await loadUser(session); location.hash = "#/reset"; route(); }, 0);
      return;
    }
    const uid = session && session.user ? session.user.id : null;
    if (uid === lastUid) return; // ignore token refreshes and tab re-focus
    setTimeout(async () => { await loadUser(session); route(); }, 0);
  });

  /* ---------- router ---------- */
  function cleanup() {
    if (homeCleanup) { try { homeCleanup(); } catch (e) {} homeCleanup = null; }
    if (voiceRec) { try { voiceRec.abort(); } catch (e) {} voiceRec = null; }
    blobUrls.splice(0).forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    if (map) { map.remove(); map = null; }
    if (realtime) { try { db.removeChannel(realtime); } catch (e) {} realtime = null; }
    charts.forEach((c) => { try { c.destroy(); } catch (e) {} }); charts = [];
  }
  async function route() {
    routeSeq++;
    const stale = routeToken();
    cleanup();
    renderNav();
    navEl.classList.remove("open");
    if (navToggle) navToggle.setAttribute("aria-expanded", "false");
    const parts = (location.hash.replace(/^#\/?/, "") || "home").split("/");
    const name = parts[0], arg = parts[1];
    window.scrollTo(0, 0);
    try {
      if (name === "home") await viewHome();
      else if (name === "map") await viewMap();
      else if (name === "report") await viewReport();
      else if (name === "issue" && arg) await viewIssue(arg);
      else if (name === "mine") await viewMine();
      else if (name === "brand") await viewBrand();
      else if (name === "pulse") await viewPulse();
      else if (name === "circles") await viewCircles();
      else if (name === "area") await viewArea(arg);
      else if (name === "data") await viewData();
      else if (name === "tour") await viewTour();
      else if (name === "admin") await viewAdmin();
      else if (name === "login") viewLogin();
      else if (name === "reset") viewReset();
      else await viewHome();
    } catch (e) { if (!stale()) showError(e); }
    if (!stale()) view.focus({ preventScroll: true });
  }
  window.addEventListener("hashchange", route);

  /* ---------- home (the former landing page) ---------- */
  function loadHomeScript() {
    if (window.FMC_HOME) return Promise.resolve();
    if (!homeScript) {
      homeScript = new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = "app/home.js"; el.onload = resolve; el.onerror = () => { homeScript = null; reject(new Error("home.js failed to load")); };
        document.head.appendChild(el);
      });
    }
    return homeScript;
  }
  async function loadFragment(url) {
    if (fragments[url] == null) {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      fragments[url] = await r.text();
    }
    return fragments[url];
  }
  async function viewHome() {
    const stale = routeToken();
    view.innerHTML = '<p class="muted pad">Loading…</p>';
    let html;
    try {
      html = await loadFragment("app/home.html");
      await loadHomeScript();
    } catch (e) {
      if (stale()) return;
      console.warn("Home failed to load", e);
      view.innerHTML = '<div class="card narrow"><h1>Welcome to FixMyCity</h1><p class="muted">The home page could not be loaded. Check your connection, or go straight to the map.</p><p class="row"><a class="btn" href="#/map">Explore the map</a><a class="btn ghost" href="#/report">Report an issue</a></p></div>';
      return;
    }
    if (stale()) return;
    view.innerHTML = html;
    view.querySelectorAll("[data-cat-name]").forEach((el) => { el.textContent = catLabel(el.dataset.catName); });
    homeCleanup = window.FMC_HOME.init(view);
    loadImpact().then((d) => { if (!stale() && window.FMC_HOME) window.FMC_HOME.setImpact(view, d); });
  }
  // Numbers for the Home impact band: reports and resolved from reports_with_counts, neighbours from
  // profiles (or distinct reporters if that fails), average days from rpc resolution_stats (05-features.sql, optional).
  async function loadImpact() {
    try {
      const [rq, pq, sq] = await Promise.all([
        db.from("reports_with_counts").select("user_id,status,is_demo").limit(5000),
        db.from("profiles").select("id", { count: "exact", head: true }),
        db.rpc("resolution_stats")
      ]);
      if (rq.error) return null;
      const rows = rq.data || [];
      const stats = !sq.error && sq.data && sq.data[0] ? sq.data[0] : null;
      return {
        reports: rows.length,
        resolved: rows.filter((r) => r.status === "resolved").length,
        neighbours: !pq.error && pq.count != null ? pq.count : new Set(rows.map((r) => r.user_id)).size,
        days: stats && stats.avg_days_to_resolve != null ? Number(stats.avg_days_to_resolve) : null,
        demo: rows.filter((r) => r.is_demo).length
      };
    } catch (e) { console.warn("Impact numbers unavailable", e); return null; }
  }
  async function viewBrand() {
    const stale = routeToken();
    view.innerHTML = '<p class="muted pad">Loading…</p>';
    let html;
    try { html = await loadFragment("app/brand.html"); }
    catch (e) {
      if (stale()) return;
      console.warn("Brand kit failed to load", e);
      view.innerHTML = '<div class="card narrow"><h1>Brand kit</h1><p class="muted">The brand kit could not be loaded. Check your connection and try again.</p><p class="row"><a class="btn" href="#/">Back to home</a></p></div>';
      return;
    }
    if (stale()) return;
    view.innerHTML = html;
  }

  /* ---------- login / register / password reset ---------- */
  function viewLogin() {
    if (user) {
      view.innerHTML = '<div class="card narrow"><h1>You are logged in</h1><p>Signed in as <b>' + esc((profile && profile.name) || user.email) +
        '</b>.</p><div class="row"><a class="btn" href="#/map">Go to the map</a><a class="btn ghost" href="#/mine">My reports</a></div></div>';
      return;
    }
    let mode = "login"; // login | register | forgot
    function draw() {
      const title = { login: "Log in", register: "Create your account", forgot: "Reset your password" }[mode];
      view.innerHTML =
        '<div class="card narrow"><h1>' + title + "</h1>" +
        '<form id="authForm" class="stack">' +
        (mode === "register" ? '<label>Name<input id="name" required maxlength="60" autocomplete="name"></label>' : "") +
        '<label>Email<input id="email" type="email" required autocomplete="email"></label>' +
        (mode !== "forgot" ? '<label>Password<input id="password" type="password" required minlength="6" autocomplete="' + (mode === "register" ? "new-password" : "current-password") + '"></label>' : "") +
        '<p class="err" id="authErr" role="alert"></p>' +
        '<button class="btn" id="authBtn">' + { login: "Log in", register: "Sign up", forgot: "Send reset link" }[mode] + "</button></form>" +
        (mode === "login" ? '<p class="small"><a href="#/login" id="forgot">Forgot your password?</a></p>' : "") +
        '<p class="small muted">' + (mode === "login" ? "New here?" : "Already have an account?") +
        ' <a href="#/login" id="swap">' + (mode === "login" ? "Create an account" : "Log in") + "</a></p></div>";
      document.getElementById("swap").onclick = (e) => { e.preventDefault(); mode = mode === "login" ? "register" : "login"; draw(); };
      const fg = document.getElementById("forgot");
      if (fg) fg.onclick = (e) => { e.preventDefault(); mode = "forgot"; draw(); };
      document.getElementById("authForm").onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById("authBtn"), err = document.getElementById("authErr");
        btn.disabled = true; err.textContent = ""; err.classList.remove("ok");
        const email = document.getElementById("email").value.trim();
        let res;
        if (mode === "forgot") {
          res = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
          btn.disabled = false;
          if (res.error) { err.textContent = res.error.message; return; }
          err.classList.add("ok");
          err.textContent = "If an account exists for that email, a reset link is on its way.";
          return;
        }
        const password = document.getElementById("password").value;
        if (mode === "register") {
          res = await db.auth.signUp({ email, password, options: { data: { name: document.getElementById("name").value.trim() } } });
        } else {
          res = await db.auth.signInWithPassword({ email, password });
        }
        btn.disabled = false;
        if (res.error) { err.textContent = res.error.message; return; }
        if (mode === "register" && !res.data.session) {
          err.classList.add("ok");
          err.textContent = "Account created. Check your email to confirm, then log in.";
          return;
        }
        toast(mode === "register" ? "Welcome to FixMyCity" : "Logged in");
        location.hash = "#/map";
      };
    }
    draw();
  }
  function viewReset() {
    if (!user) { view.innerHTML = '<div class="card narrow"><h1>Reset link expired</h1><p>Open the latest reset email again, or <a href="#/login">request a new link</a>.</p></div>'; return; }
    view.innerHTML = '<div class="card narrow"><h1>Choose a new password</h1><form id="resetForm" class="stack">' +
      '<label>New password<input id="newPw" type="password" required minlength="6" autocomplete="new-password"></label>' +
      '<p class="err" id="resetErr" role="alert"></p><button class="btn">Save password</button></form></div>';
    document.getElementById("resetForm").onsubmit = async (e) => {
      e.preventDefault();
      const res = await db.auth.updateUser({ password: document.getElementById("newPw").value });
      if (res.error) { document.getElementById("resetErr").textContent = res.error.message; return; }
      toast("Password updated"); location.hash = "#/map";
    };
  }

  /* ---------- explore map + radar ---------- */
  async function viewMap() {
    const stale = routeToken();
    view.innerHTML =
      "<h1>" + esc(t("h_map")) + "</h1>" +
      '<div class="toolbar" id="chips" role="group" aria-label="Filter by category"></div>' +
      '<div class="toolbar"><label class="range">Radar radius <input type="range" id="radius" min="50" max="300" step="10" value="' + RADIUS + '"><span id="radiusOut">' + RADIUS + ' m</span></label>' +
      '<label class="check"><input type="checkbox" id="hideResolved"> Hide resolved</label>' +
      '<label class="check"><input type="checkbox" id="heat"> Density view</label>' +
      '<button type="button" class="btn ghost sm" id="showAll">Show all reports</button></div>' +
      '<div class="map-layout"><div id="map" class="map" role="application" aria-label="Map of reported issues"></div><aside class="side" id="side"></aside></div>';
    const loadReports = () => db.from("reports_with_counts").select("*").order("created_at", { ascending: false }).limit(1000);
    const q = await loadReports();
    if (stale()) return;
    if (q.error) return showError(q.error);
    let reports = q.data || [];

    map = baseMap("map");
    const markers = L.layerGroup().addTo(map), rings = L.layerGroup().addTo(map);
    let radius = RADIUS, hideResolved = false, heat = false;
    // Live updates: when anyone adds or changes a report, reload the pins (needs supabase/07-realtime.sql).
    let rtTimer;
    try {
      realtime = db.channel("fmc-map").on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => {
        clearTimeout(rtTimer);
        rtTimer = setTimeout(async () => {
          const f = await loadReports();
          if (stale() || f.error) return;
          reports = f.data || []; draw(); toast("Map updated with the latest reports");
        }, 800);
      }).subscribe();
    } catch (e) { console.warn("Realtime unavailable", e); }
    document.getElementById("heat").onchange = (e) => { heat = e.target.checked; draw(); };
    map.on("zoomend", () => draw());
    const active = new Set(Object.keys(CATS));

    const chips = document.getElementById("chips");
    chips.innerHTML = Object.keys(CATS).map((k) =>
      '<button type="button" class="btn sm on chip" aria-pressed="true" data-cat="' + k + '">' + catDot(k) + catLabel(k) + "</button>").join("");
    chips.querySelectorAll("button").forEach((b) => b.onclick = () => {
      const k = b.dataset.cat, on = !active.has(k);
      if (on) active.add(k); else active.delete(k);
      b.classList.toggle("on", on); b.classList.toggle("ghost", !on); b.setAttribute("aria-pressed", on ? "true" : "false");
      draw();
    });
    document.getElementById("radius").oninput = (e) => { radius = +e.target.value; document.getElementById("radiusOut").textContent = radius + " m"; draw(); };
    document.getElementById("hideResolved").onchange = (e) => { hideResolved = e.target.checked; draw(); };
    const fitAll = () => {
      if (reports.length) map.fitBounds(L.latLngBounds(reports.map((r) => [r.latitude, r.longitude])), { padding: [40, 40], maxZoom: 16 });
      else defaultView(map, true);
    };
    document.getElementById("showAll").onclick = fitAll;

    let clusters = [];
    function draw() {
      markers.clearLayers(); rings.clearLayers();
      const shown = reports.filter((r) => active.has(r.category) && !(hideResolved && r.status === "resolved"));
      // Zoomed out: merge nearby pins into numbered bubbles (grid on screen pixels). Zoomed in: show each pin.
      let pins = shown;
      if (heat) {
        shown.forEach((r) => L.circle([r.latitude, r.longitude], { radius: 90, stroke: false, fillColor: "#C5633C", fillOpacity: 0.16, interactive: false }).addTo(markers));
      } else if (map._loaded && map.getZoom() < 15 && shown.length > 1) {
        const cells = new Map();
        shown.forEach((r) => {
          const p = map.latLngToContainerPoint([r.latitude, r.longitude]), key = Math.floor(p.x / 56) + ":" + Math.floor(p.y / 56);
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(r);
        });
        pins = [];
        cells.forEach((g) => {
          if (g.length === 1) { pins.push(g[0]); return; }
          const lat = g.reduce((s, r) => s + r.latitude, 0) / g.length, lng = g.reduce((s, r) => s + r.longitude, 0) / g.length;
          L.marker([lat, lng], { keyboard: false, icon: L.divIcon({ className: "", iconSize: [38, 38], html: '<div class="bubble" role="img" aria-label="' + g.length + ' reports">' + g.length + "</div>" }) })
            .addTo(markers).on("click", () => map.fitBounds(L.latLngBounds(g.map((r) => [r.latitude, r.longitude])), { padding: [60, 60], maxZoom: 17 }));
        });
      }
      if (!heat) pins.forEach((r) => {
        const color = (CATS[r.category] || CATS.other).color;
        L.circleMarker([r.latitude, r.longitude], {
          radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: r.status === "resolved" ? 0.35 : 0.9
        }).addTo(markers).bindPopup(
          '<div class="pop"><h3>' + esc(r.title) + "</h3>" + demoTag(r) + "<br>" + catDot(r.category) + esc(catLabel(r.category)) + " · " + badge(r.status) + overdueBadge(r) +
          '<br><span class="small">' + (Number(r.confirmations) || 0) + ' <span class="heart">&hearts;</span> community confirmations</span><br><a href="#/issue/' + r.id + '">View details</a></div>');
      });
      clusters = computeClusters(shown, radius);
      const side = document.getElementById("side");
      clusters.forEach((c) => {
        L.circle([c.anchor.latitude, c.anchor.longitude], { radius, color: "#3C6D4F", weight: 2, dashArray: "6 5", fillColor: "#3C6D4F", fillOpacity: 0.12, interactive: false }).addTo(rings);
      });
      side.innerHTML = "<h2>Possible recurring issues</h2>" + (clusters.length
        ? clusters.map((c, i) => '<button type="button" class="cluster" data-i="' + i + '"><b>' + catDot(c.category) + esc(catLabel(c.category)) + "</b><br>" +
          '<span class="small">' + esc(clusterText(c)) + '</span><br><span class="small muted">Suggested for review, not merged</span></button>').join("")
        : '<p class="muted small">No clusters of ' + MIN_CLUSTER + "+ same-type reports within " + radius + " m yet.</p>") +
        '<p class="small muted">' + shown.length + " reports shown. Clusters are suggestions based on category and distance.</p>";
      side.querySelectorAll(".cluster").forEach((b) => b.onclick = () => focusCluster(clusters[+b.dataset.i]));
    }
    function focusCluster(c) {
      map.fitBounds(L.latLng(c.anchor.latitude, c.anchor.longitude).toBounds(radius * 2.6));
    }
    draw();
    // Open on the biggest recurring hotspot so the radar is visible straight away;
    // "Show all reports" zooms out to everything.
    if (clusters.length) focusCluster(clusters[0]); else fitAll();
    draw();
  }

  /* ---------- report an issue ---------- */
  async function resizeImage(file, max) {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error("That photo could not be read. Use a JPEG, PNG or WebP image."); }
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  }
  // Voice typing for the description (Web Speech API). Hidden when the browser has no support.
  const VOICE_LANG = { en: "en-IN", hi: "hi-IN", gu: "gu-IN", mr: "mr-IN", bn: "bn-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-guru-IN", ur: "ur-IN", es: "es-ES", fr: "fr-FR", de: "de-DE" };
  function setupVoice(ta) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const box = document.getElementById("micBox"), btn = document.getElementById("mic"), status = document.getElementById("micStatus");
    if (!SR || !box || !btn || !ta) return;
    box.style.display = "";
    let rec = null, listening = false;
    const setState = (on, msg) => { listening = on; btn.setAttribute("aria-pressed", on ? "true" : "false"); btn.textContent = on ? "Stop listening" : "Speak your description"; status.textContent = msg || ""; };
    btn.onclick = () => {
      if (listening && rec) { rec.stop(); return; }
      const picked = (lsGet("fmc_lang") || lang || "en").split("-")[0];
      rec = new SR(); voiceRec = rec;
      rec.lang = VOICE_LANG[picked] || "en-IN"; rec.continuous = true; rec.interimResults = false;
      rec.onstart = () => setState(true, "Listening… speak now.");
      rec.onresult = (e) => {
        let add = "";
        for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript;
        add = add.trim();
        if (!add) return;
        ta.value = ((ta.value && !/\s$/.test(ta.value) ? ta.value + " " : ta.value) + add).slice(0, +ta.maxLength > 0 ? +ta.maxLength : 2000);
        status.textContent = "Added: " + add.slice(0, 60);
      };
      rec.onerror = (e) => {
        const m = { "not-allowed": "Microphone access was blocked. Allow it in your browser to use voice typing.", "service-not-allowed": "Voice typing is not allowed in this browser.", "no-speech": "No speech heard. Try again.", "audio-capture": "No microphone found.", "network": "Voice typing needs an internet connection." };
        setState(false, m[e.error] || "Voice typing stopped.");
      };
      rec.onend = () => { if (voiceRec === rec) voiceRec = null; if (listening) setState(false, "Stopped. Check the text and edit if needed."); };
      try { rec.start(); } catch (e) { setState(false, "Could not start voice typing."); }
    };
  }
  async function viewReport() {
    if (!user) {
      view.innerHTML = '<div class="card narrow"><h1>' + esc(t("h_report")) + '</h1><p>Please <a href="#/login">log in or create an account</a> to report an issue. It takes under a minute.</p></div>';
      return;
    }
    view.innerHTML =
      "<h1>" + esc(t("h_report")) + '</h1><div class="issue"><form id="reportForm" class="card stack">' +
      '<label>Title<input id="title" required minlength="3" maxlength="120" placeholder="e.g. Deep pothole near the bus stop"></label>' +
      '<div class="cat-row"><label>Category<select id="category">' + Object.keys(CATS).map((k) => '<option value="' + k + '">' + esc(catLabel(k)) + "</option>").join("") + "</select></label>" +
      '<img id="catPreview" class="cat-thumb" src="' + CATS.pothole.img + '" width="72" height="72" decoding="async" alt="Illustration for the ' + esc(catLabel("pothole")) + ' category"></div>' +
      '<label>Description<textarea id="desc" maxlength="2000" placeholder="What is the problem, and how long has it been there?"></textarea></label>' +
      '<div id="micBox" class="stack" style="display:none"><div class="row"><button type="button" class="btn ghost sm" id="mic" aria-pressed="false">Speak your description</button><span class="small muted" id="micStatus" role="status" aria-live="polite"></span></div>' +
      '<p class="note">Voice typing uses your browser\'s speech service, so your voice may be sent to the browser vendor (for example Google in Chrome). It adds text to the description; you can edit it before submitting.</p></div>' +
      '<label>Photo (recommended, opens the camera on phones)<input id="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label>' +
      '<img id="preview" class="preview" alt="Photo preview">' +
      '<p class="note">Keep faces, vehicle number plates and private property out of the photo. Photos are shown publicly.</p>' +
      '<p class="note">When you drop a pin, its location is sent to OpenStreetMap (Nominatim) to suggest the area name.</p>' +
      '<label>Area or landmark (optional)<input id="area" maxlength="120" placeholder="e.g. MG Road, near the bus stop"></label>' +
      '<div><strong class="small">Location</strong><p class="small muted" style="margin:2px 0 8px">Tap the map to drop a pin on the exact spot, or move the map and use "Pin map centre".</p>' +
      '<div id="picker" class="picker" tabindex="0" aria-label="Map for choosing the issue location. Use arrow keys to move the map."></div>' +
      '<div class="row" style="margin-top:8px"><button type="button" class="btn ghost sm" id="locate">Use my location</button>' +
      '<button type="button" class="btn ghost sm" id="pinCentre">Pin map centre</button><span class="small muted" id="coords" aria-live="polite">No location chosen yet</span></div></div>' +
      '<p class="err" id="repErr" role="alert"></p><button class="btn" id="submitBtn">' + esc(t("submit")) + '</button></form>' +
      '<aside class="card stack"><h2>Already reported nearby?</h2><div id="similar" class="muted small" aria-live="polite">Choose a category and drop a pin to see similar reports within ' + RADIUS + ' m.</div></aside></div>';

    map = baseMap("picker");
    defaultView(map, false);
    let pin = null, point = null, checkSeq = 0;
    const similar = document.getElementById("similar");
    const catSel = document.getElementById("category"), catPrev = document.getElementById("catPreview");
    catSel.addEventListener("change", () => {
      const c = CATS[catSel.value] || CATS.other;
      catPrev.src = c.img; catPrev.alt = "Illustration for the " + catLabel(catSel.value) + " category";
    });
    async function checkSimilar() {
      if (!point) return;
      const mine = ++checkSeq;
      const cat = document.getElementById("category").value;
      similar.textContent = "Checking…";
      const r = await db.rpc("nearby_reports", { p_lat: point.lat, p_lng: point.lng, p_category: cat, p_radius_m: RADIUS });
      if (mine !== checkSeq || !similar.isConnected) return; // a newer check replaced this one
      if (r.error) { similar.textContent = "Could not check nearby reports."; return; }
      if (!r.data.length) { similar.innerHTML = "No open " + esc(catLabel(cat).toLowerCase()) + " reports within " + RADIUS + " m. You would be the first."; return; }
      similar.innerHTML = "<p><b>" + r.data.length + "</b> open " + esc(catLabel(cat).toLowerCase()) + " report" + (r.data.length > 1 ? "s" : "") +
        " within " + RADIUS + ' m. If yours is the same issue, open it and confirm it instead.</p><ul class="list">' +
        r.data.map((x) => '<li><span>' + esc(x.title) + '<br><span class="small muted">' + Math.round(x.distance_m) + " m away · " + daysAgo(x.created_at) + ' days old</span></span><span class="row">' +
          '<a href="#/issue/' + x.id + '" target="_blank" rel="noopener">View</a>' +
          '<button type="button" class="btn sm" data-confirm="' + x.id + '">Same issue, confirm</button></span></li>').join("") + "</ul>";
      similar.querySelectorAll("[data-confirm]").forEach((b) => b.onclick = async () => {
        b.disabled = true;
        const res = await db.from("verifications").insert({ report_id: b.dataset.confirm, vote: "still_exists" });
        if (res.error) { b.disabled = false; return toast(friendly(res.error)); }
        toast("Thanks, you confirmed the existing report instead of duplicating it");
        location.hash = "#/issue/" + b.dataset.confirm;
      });
    }
    let areaSeq = 0;
    function setPoint(latlng, pan) {
      point = { lat: latlng.lat, lng: latlng.lng };
      if (pin) pin.setLatLng(latlng); else pin = L.marker(latlng).addTo(map);
      if (pan) map.setView(latlng, 17);
      document.getElementById("coords").textContent = "Pin at " + point.lat.toFixed(5) + ", " + point.lng.toFixed(5);
      checkSimilar();
      // Suggest the area name unless the resident has typed their own.
      const areaEl = document.getElementById("area"), mineA = ++areaSeq;
      if (!areaEl.value || areaEl.dataset.auto === "1") {
        lookupArea(point.lat, point.lng).then((a) => {
          if (a && mineA === areaSeq && areaEl.isConnected && (!areaEl.value || areaEl.dataset.auto === "1")) { areaEl.value = a; areaEl.dataset.auto = "1"; }
        });
      }
    }
    document.getElementById("area").addEventListener("input", (e) => { e.target.dataset.auto = ""; });
    map.on("click", (e) => setPoint(e.latlng, false));
    document.getElementById("pinCentre").onclick = () => setPoint(map.getCenter(), false);
    document.getElementById("category").onchange = checkSimilar;
    document.getElementById("locate").onclick = () => {
      if (!navigator.geolocation) return toast("Location is not available in this browser");
      navigator.geolocation.getCurrentPosition(
        (p) => { if (map) setPoint(L.latLng(p.coords.latitude, p.coords.longitude), true); },
        () => toast("Could not get your location. Tap the map instead."), { timeout: 8000, enableHighAccuracy: true });
    };
    setupVoice(document.getElementById("desc"));
    const photoEl = document.getElementById("photo"), preview = document.getElementById("preview");
    photoEl.onchange = () => {
      const f = photoEl.files[0];
      if (!f) { preview.style.display = "none"; return; }
      preview.src = URL.createObjectURL(f); preview.style.display = "block";
    };
    document.getElementById("reportForm").onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("repErr"), btn = document.getElementById("submitBtn");
      err.textContent = "";
      if (!point) { err.textContent = "Tap the map to choose the location of the issue."; return; }
      btn.disabled = true; btn.textContent = "Submitting…";
      let path = null;
      try {
        let imageUrl = null;
        const file = photoEl.files[0];
        if (file) {
          const blob = await resizeImage(file, 1600);
          path = user.id + "/" + Date.now() + ".jpg";
          const up = await db.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
          if (up.error) { path = null; throw up.error; }
          imageUrl = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        }
        const ins = await db.from("reports").insert({
          title: document.getElementById("title").value.trim(),
          description: document.getElementById("desc").value.trim() || null,
          category: document.getElementById("category").value,
          area: document.getElementById("area").value.trim() || null,
          latitude: point.lat, longitude: point.lng, image_url: imageUrl
        }).select("id").single();
        if (ins.error) throw ins.error;
        toast("Report submitted");
        location.hash = "#/issue/" + ins.data.id;
      } catch (ex) {
        if (path) db.storage.from(BUCKET).remove([path]).catch(() => {}); // don't leave an orphaned photo
        err.textContent = friendly(ex) || "Could not submit the report.";
        btn.disabled = false; btn.textContent = t("submit");
      }
    };
  }

  /* ---------- issue details ---------- */
  async function viewIssue(id) {
    if (!/^[\w-]{1,64}$/.test(id)) return notFound();
    const stale = routeToken();
    const [rq, hq, vq] = await Promise.all([
      db.from("reports_with_counts").select("*").eq("id", id).maybeSingle(),
      db.from("status_history").select("*").eq("report_id", id).order("created_at", { ascending: true }),
      user ? db.from("verifications").select("vote").eq("report_id", id).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    if (stale()) return;
    // 22P02 = "invalid input syntax for type uuid" (e.g. #/issue/abc): treat as not found.
    if (rq.error) return rq.error.code === "22P02" || !UUID_RE.test(id) ? notFound() : showError(rq.error);
    const r = rq.data;
    if (!r) return notFound();
    const [aq, nq, cmq, dq] = await Promise.all([
      db.from("profiles").select("name").eq("id", r.user_id).maybeSingle(),
      db.rpc("nearby_reports", { p_lat: r.latitude, p_lng: r.longitude, p_category: r.category, p_radius_m: RADIUS }),
      db.from("report_comments").select("*").eq("report_id", id).order("created_at", { ascending: true }).limit(200), // 06-comments-and-proof.sql; optional
      r.status === "resolved" ? db.from("report_disputes").select("user_id").eq("report_id", id) : Promise.resolve({ data: [], error: null }) // 08-features.sql; optional
    ]);
    if (stale()) return;
    const commentsOk = !cmq.error;
    let comments = commentsOk ? cmq.data || [] : [];
    const cnames = {};
    if (comments.length) {
      const cpq = await db.from("profiles").select("id,name").in("id", Array.from(new Set(comments.map((c) => c.user_id))));
      if (stale()) return;
      (cpq.data || []).forEach((p) => { cnames[p.id] = p.name; });
    }
    const commentHtml = (c) => '<li><span><b>' + esc(cnames[c.user_id] || "A resident") + '</b> <span class="small muted">' + esc(fmtDateTime(c.created_at)) + "</span><br>" + esc(c.body) + "</span>" +
      (user && (c.user_id === user.id || admin) ? '<button type="button" class="btn danger sm" data-delcomment="' + esc(c.id) + '">Delete</button>' : "") + "</li>";
    const history = hq.data || [], myVote = vq.data ? vq.data.vote : null;
    const nearby = (nq.data || []).filter((x) => x.id !== r.id);
    const isOwner = user && user.id === r.user_id, admin = isAdmin();
    const who = (h) => h.updated_by == null ? "Community" : h.updated_by === r.user_id ? "Reporter" : "Admin (demo role)";

    let voteHtml;
    if (!user) voteHtml = '<p class="small"><a href="#/login">Log in</a> to confirm or update this report.</p>';
    else if (isOwner) voteHtml = '<p class="small muted">You reported this issue. Other residents can confirm it.</p>';
    else voteHtml = '<div class="votes" role="group" aria-label="Your response">' + [["still_exists", "Still exists"], ["worse", "It got worse"], ["resolved", "Looks resolved"]]
      .map((v) => '<button type="button" class="btn sm ' + (myVote === v[0] ? "on" : "ghost") + '" aria-pressed="' + (myVote === v[0]) + '" data-vote="' + v[0] + '">' + v[1] + "</button>").join("") + "</div>" +
      (myVote ? '<p class="small"><button type="button" class="linkbtn" id="unvote">Remove my response</button></p>' : "");

    const disputes = dq.error ? [] : dq.data || [];
    const myDispute = !!(user && disputes.some((d) => d.user_id === user.id));
    let disputeHtml = "";
    if (r.status === "resolved") {
      disputeHtml = '<div class="stack" id="disputeBox"><h3 style="margin:0">Is it really fixed?</h3>' +
        (dq.error ? "" : '<p class="small"><b>' + disputes.length + "</b> of 2 residents say this is not really fixed. At 2, the report is reopened.</p>") +
        (!user ? '<p class="small"><a href="#/login">Log in</a> to dispute this resolution.</p>'
          : isOwner ? '<p class="small muted">Other residents can dispute a resolution you reported.</p>'
          : myDispute ? '<p class="small">You said this is not really fixed. <button type="button" class="linkbtn" id="undispute">Withdraw</button></p>'
          : '<div><button type="button" class="btn ghost sm" id="disputeBtn">Not really fixed</button></div>') + "</div>";
    }
    const canDelete = (isOwner && r.status === "submitted") || admin;
    view.innerHTML =
      '<p><a href="#/map">&larr; Back to the map</a></p><div class="issue"><div class="stack"><div class="card stack" id="mainCard">' +
      (r.resolution_image_url
        ? '<div class="ba"><figure>' + (r.image_url ? '<img src="' + esc(r.image_url) + '" alt="Before: the reported issue">' : "") + "<figcaption>Before</figcaption></figure>" +
          '<figure><img src="' + esc(r.resolution_image_url) + '" alt="After: the issue resolved"><figcaption>After</figcaption></figure></div>'
        : r.image_url ? '<img class="photo" src="' + esc(r.image_url) + '" alt="Photo of the reported issue">' : "") +
      "<div><h1>" + esc(r.title) + '</h1><div class="row">' + badge(r.status) + overdueBadge(r) + demoTag(r) + "<span>" + catDot(r.category) + esc(catLabel(r.category)) + "</span></div></div>" +
      (r.description ? "<p>" + esc(r.description) + "</p>" : "") +
      '<p class="small muted">Reported ' + fmtDate(r.created_at) + " by " + esc((aq.data && aq.data.name) || "a resident") +
      (r.area ? ' · <a href="' + areaHref(r.area) + '">' + esc(r.area) + "</a>" : "") + " · Report ID " + esc(String(r.id).slice(0, 8)) + "</p>" +
      (r.status !== "resolved" && (Number(r.resolved_votes) || 0) >= 2
        ? '<p class="note"><b>Resolution pending review.</b> ' + (Number(r.resolved_votes)) + " residents say this looks resolved. An admin can confirm and close it.</p>" : "") +
      '<div class="row"><button class="btn ghost sm" id="share" type="button">' + esc(t("share")) + '</button>' +
        (user && !isOwner ? '<button class="btn ghost sm" id="flag" type="button">Flag as inappropriate</button>' : "") + "</div>" +
      ((isOwner || canDelete) ? '<div class="row">' +
        (isOwner ? '<button class="btn ghost sm" id="edit" type="button">Edit report</button>' : "") +
        (canDelete ? '<button class="btn danger sm" id="del" type="button">' + (isOwner ? "Delete my report" : "Delete report (admin)") + "</button>" : "") + "</div>" : "") +
      '</div><div class="card stack"><h2>Nearby ' + esc(catLabel(r.category).toLowerCase()) + " reports</h2>" +
      (nearby.length ? '<ul class="list">' + nearby.map((x) => '<li><span>' + esc(x.title) + '<br><span class="small muted">' + Math.round(x.distance_m) + " m away · " + esc(STATUS_LABEL[x.status] || x.status) + '</span></span><a href="#/issue/' + x.id + '">View</a></li>').join("") + "</ul>"
        : '<p class="small muted">No other open reports of this type within ' + RADIUS + " m.</p>") +
      "</div></div>" +
      '<div class="stack"><div class="card stack" id="communityCard"><h2>Community check</h2>' +
      '<p><b>' + (Number(r.confirmations) || 0) + '</b> residents say it still exists · <b>' + (Number(r.resolved_votes) || 0) + "</b> say it looks resolved</p>" + voteHtml + disputeHtml +
      '<p class="note">Community confirmation shows neighbours agree the issue exists. It is not an official verification.</p></div>' +
      (commentsOk ? '<div class="card stack"><h2>Comments</h2>' +
        (comments.length ? '<ul class="list" id="commentList">' + comments.map(commentHtml).join("") + "</ul>" : '<p class="small muted" id="noComments">No comments yet.</p>') +
        (user ? '<form id="commentForm" class="stack"><label>Add a comment<textarea id="cBody" required maxlength="500" rows="3" placeholder="Share an update or useful detail (max 500 characters)"></textarea></label>' +
          '<p class="err" id="cmErr" role="alert"></p><button class="btn sm" id="cmBtn">Post comment</button></form>'
          : '<p class="small"><a href="#/login">Log in</a> to comment.</p>') + "</div>" : "") +
      '<div class="card stack" id="historyCard"><h2>Status history</h2><ol class="timeline">' +
      history.map((h) => "<li>" + badge(h.new_status) + '<br><span class="small muted">' + fmtDate(h.created_at) + " · " + who(h) + "</span></li>").join("") + "</ol></div>" +
      (admin ? '<div class="card stack"><h2>Admin (demo role)</h2><label>Update status<select id="adminStatus">' +
        STATUSES.map((s) => '<option value="' + s[0] + '"' + (s[0] === r.status ? " selected" : "") + ">" + s[1] + "</option>").join("") +
        '</select></label><button class="btn" id="adminSave" type="button">Save status</button>' +
        '<label>Resolution photo (proof of the fix)<input id="resFile" type="file" accept="image/jpeg,image/png,image/webp"></label>' +
        '<button class="btn ghost" id="resBtn" type="button">Add resolution photo</button></div>' : "") +
      "</div></div>";

    view.querySelectorAll("[data-vote]").forEach((b) => b.onclick = async () => {
      const vote = b.dataset.vote;
      if (vote === myVote) return;
      const res = myVote
        ? await db.from("verifications").update({ vote }).eq("report_id", id).eq("user_id", user.id)
        : await db.from("verifications").insert({ report_id: id, vote });
      if (res.error) return toast(friendly(res.error));
      toast("Thanks, your response was recorded");
      route();
    });
    const unvote = document.getElementById("unvote");
    if (unvote) unvote.onclick = async () => {
      const res = await db.from("verifications").delete().eq("report_id", id).eq("user_id", user.id);
      if (res.error) return toast(friendly(res.error));
      toast("Your response was removed"); route();
    };
    const dBtn = document.getElementById("disputeBtn");
    if (dBtn) dBtn.onclick = () => {
      document.getElementById("disputeBox").innerHTML = '<form id="disputeForm" class="stack"><label>What still looks wrong? (3 to 300 characters)<textarea id="dNote" required minlength="3" maxlength="300" rows="3" placeholder="e.g. The hole has reopened after the rain"></textarea></label>' +
        '<p class="err" id="dErr" role="alert"></p><div class="row"><button class="btn sm" id="dSend">Send</button><button type="button" class="btn ghost sm" id="dCancel">Cancel</button></div></form>';
      document.getElementById("dNote").focus();
      document.getElementById("dCancel").onclick = route;
      document.getElementById("disputeForm").onsubmit = async (e) => {
        e.preventDefault();
        const note = document.getElementById("dNote").value.trim(), err = document.getElementById("dErr"), send = document.getElementById("dSend");
        err.textContent = "";
        if (note.length < 3) { err.textContent = "Please add a few words about what is still wrong."; return; }
        send.disabled = true;
        const res = await db.from("report_disputes").insert({ report_id: id, note });
        send.disabled = false;
        if (res.error) { err.textContent = /report_disputes|schema cache/.test(res.error.message) ? "Disputes are not set up yet (run supabase/08-features.sql)." : /row-level security/i.test(res.error.message) ? "You can only dispute a resolved report that you did not file." : friendly(res.error); return; }
        toast("Thanks, your response was recorded"); route();
      };
    };
    const undis = document.getElementById("undispute");
    if (undis) undis.onclick = async () => {
      const res = await db.from("report_disputes").delete().eq("report_id", id).eq("user_id", user.id);
      if (res.error) return toast(friendly(res.error));
      toast("Your dispute was withdrawn"); route();
    };
    document.getElementById("share").onclick = () => shareLink(r.title, location.origin + location.pathname + "#/issue/" + r.id);
    const flag = document.getElementById("flag");
    if (flag) flag.onclick = async () => {
      if (!armed(flag, "Tap again to flag")) return;
      flag.disabled = true;
      const res = await db.from("report_flags").insert({ report_id: id, reason: "Flagged by a resident as inappropriate or spam" });
      if (res.error) { flag.disabled = false; return toast(/duplicate/i.test(res.error.message) ? "You already flagged this report." : /report_flags/.test(res.error.message) ? "Flagging is not set up yet (run supabase/05-features.sql)." : friendly(res.error)); }
      toast("Thanks, an admin will review this report"); flag.textContent = "Flagged";
    };
    const cform = document.getElementById("commentForm");
    if (cform) cform.onsubmit = async (e) => {
      e.preventDefault();
      const body = document.getElementById("cBody").value.trim(), err = document.getElementById("cmErr"), btn = document.getElementById("cmBtn");
      err.textContent = "";
      if (!body) return;
      if (body.length > 500) { err.textContent = "Comments can be at most 500 characters."; return; }
      btn.disabled = true;
      const res = await db.from("report_comments").insert({ report_id: id, body });
      btn.disabled = false;
      if (res.error) { err.textContent = /report_comments|schema cache/.test(res.error.message) ? "Comments are not set up yet (run supabase/06-comments-and-proof.sql)." : friendly(res.error); return; }
      toast("Comment posted"); route();
    };
    view.querySelectorAll("[data-delcomment]").forEach((b) => b.onclick = async () => {
      if (!armed(b, "Tap again to delete")) return;
      b.disabled = true;
      const res = await db.from("report_comments").delete().eq("id", b.dataset.delcomment).select("id");
      if (res.error || !res.data || !res.data.length) { b.disabled = false; return toast(res.error ? friendly(res.error) : "Could not delete this comment."); }
      toast("Comment deleted"); route();
    });
    const resBtn = document.getElementById("resBtn");
    if (resBtn) resBtn.onclick = async () => {
      const f = document.getElementById("resFile").files[0];
      if (!f) return toast("Choose a photo first.");
      resBtn.disabled = true;
      let path = null;
      try {
        const blob = await resizeImage(f, 1600);
        path = "resolved/" + Date.now() + ".jpg";
        const up = await db.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) { path = null; throw up.error; }
        const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        const res = await db.rpc("set_resolution_photo", { p_report_id: id, p_url: url });
        if (res.error) throw res.error;
        toast("Resolution photo added"); route();
      } catch (ex) {
        if (path) db.storage.from(BUCKET).remove([path]).catch(() => {});
        resBtn.disabled = false;
        toast(/set_resolution_photo|schema cache|row-level security/i.test((ex && ex.message) || "") ? "Resolution photos are not set up yet (run supabase/06-comments-and-proof.sql)." : friendly(ex));
      }
    };
    const del = document.getElementById("del");
    if (del) del.onclick = async () => {
      if (!armed(del, "Tap again to confirm delete")) return;
      del.disabled = true;
      const msg = await deleteReport(r);
      if (msg) { del.disabled = false; return toast(msg); }
      toast("Report deleted"); location.hash = isOwner ? "#/mine" : "#/admin";
    };
    const edit = document.getElementById("edit");
    if (edit) edit.onclick = () => {
      document.getElementById("mainCard").innerHTML = '<h2>Edit report</h2><form id="editForm" class="stack">' +
        '<label>Title<input id="eTitle" required minlength="3" maxlength="120" value="' + esc(r.title) + '"></label>' +
        '<label>Category<select id="eCat">' + Object.keys(CATS).map((k) => '<option value="' + k + '"' + (k === r.category ? " selected" : "") + ">" + esc(catLabel(k)) + "</option>").join("") + "</select></label>" +
        '<label>Description<textarea id="eDesc" maxlength="2000">' + esc(r.description || "") + "</textarea></label>" +
        '<label>Area or landmark<input id="eArea" maxlength="120" value="' + esc(r.area || "") + '"></label>' +
        '<label>Replace photo (optional)<input id="ePhoto" type="file" accept="image/jpeg,image/png,image/webp"></label>' +
        '<p class="err" id="eErr" role="alert"></p><div class="row"><button class="btn" id="eSave">Save changes</button><button type="button" class="btn ghost" id="eCancel">Cancel</button></div></form>';
      document.getElementById("eCancel").onclick = route;
      document.getElementById("editForm").onsubmit = async (e) => {
        e.preventDefault();
        const eErr = document.getElementById("eErr"), eSave = document.getElementById("eSave"), file = document.getElementById("ePhoto").files[0];
        eErr.textContent = ""; eSave.disabled = true;
        const fields = {
          title: document.getElementById("eTitle").value.trim(),
          category: document.getElementById("eCat").value,
          description: document.getElementById("eDesc").value.trim() || null,
          area: document.getElementById("eArea").value.trim() || null
        };
        let path = null;
        try {
          if (file) {
            const blob = await resizeImage(file, 1600);
            path = user.id + "/" + Date.now() + ".jpg";
            const up = await db.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
            if (up.error) { path = null; throw up.error; }
            fields.image_url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
          }
          const res = await db.from("reports").update(fields).eq("id", id).select("id");
          if (res.error) throw res.error;
          if (!res.data || !res.data.length) throw new Error("This report can no longer be edited.");
        } catch (ex) {
          if (path) db.storage.from(BUCKET).remove([path]).catch(() => {});
          eErr.textContent = friendly(ex); eSave.disabled = false; return;
        }
        if (file) await removePhoto(r.image_url); // the old photo is no longer referenced
        toast("Report updated"); route();
      };
    };
    const save = document.getElementById("adminSave");
    if (save) save.onclick = async () => {
      const res = await db.rpc("set_report_status", { p_report_id: id, p_status: document.getElementById("adminStatus").value });
      if (res.error) return toast(friendly(res.error));
      toast("Status updated"); route();
    };
  }

  /* ---------- Neighbourhood Pulse ---------- */
  function weekBuckets(reports, n) {
    const out = new Array(n).fill(0), now = Date.now();
    reports.forEach((r) => {
      const w = Math.floor((now - new Date(r.created_at).getTime()) / (7 * 864e5));
      if (w >= 0 && w < n) out[n - 1 - w]++;
    });
    return out;
  }
  function pointsFor(reports, votes, members) {
    const pts = {};
    const add = (id, n) => { if (id) pts[id] = (pts[id] || 0) + n; };
    reports.forEach((r) => add(r.user_id, 10));                                       // 10 points per report
    votes.filter((v) => v.vote !== "resolved").forEach((v) => add(v.user_id, 2));     // 2 per confirmation given
    members.forEach((m) => add(m.user_id, 5));                                        // 5 per Action Circle joined
    return Object.keys(pts).map((id) => ({ id, points: pts[id] })).sort((a, b) => b.points - a.points);
  }
  async function viewPulse() {
    const stale = routeToken();
    view.innerHTML = "<h1>" + esc(t("h_pulse")) + '</h1><p class="muted" id="pulseSub">Loading…</p><div id="pulseBody"></div>';
    const [rq, vq, mq, sq] = await Promise.all([
      db.from("reports_with_counts").select("*").limit(2000),
      db.from("verifications").select("user_id,vote").limit(5000),
      db.from("activity_members").select("user_id").limit(5000),
      db.rpc("resolution_stats") // from 05-features.sql; optional
    ]);
    if (stale()) return;
    if (rq.error) return showError(rq.error);
    const stats = !sq.error && sq.data && sq.data[0] ? sq.data[0] : null;
    const all = rq.data || [];
    const areas = Array.from(new Set(all.map((r) => r.area).filter(Boolean))).sort();
    const demoCount = all.filter((r) => r.is_demo).length;
    document.getElementById("pulseSub").innerHTML = "What is being reported, what is still open, and where problems keep coming back." +
      (demoCount ? ' <span class="badge demo">Demo data</span> ' + demoCount + " of " + all.length + " reports are labelled demo data, not real city statistics." : "");

    // Admin accounts are moderators, not neighbours, so they are left off the leaderboard.
    const ranked = pointsFor(all, vq.data || [], mq.data || []).slice(0, 15);
    const names = {}, roles = {};
    if (ranked.length) {
      const pq = await db.from("profiles").select("id,name,role").in("id", ranked.map((l) => l.id));
      if (stale()) return;
      (pq.data || []).forEach((p) => { names[p.id] = p.name; roles[p.id] = p.role; });
    }
    const leaders = ranked.filter((l) => roles[l.id] !== "admin").slice(0, 5);

    function render(area) {
      charts.forEach((c) => { try { c.destroy(); } catch (e) {} }); charts = [];
      const rs = area ? all.filter((r) => r.area === area) : all;
      const open = rs.filter((r) => r.status !== "resolved"), resolved = rs.length - open.length;
      const clusters = computeClusters(rs, RADIUS);
      const confirms = rs.reduce((s, r) => s + (Number(r.confirmations) || 0), 0);
      const byCat = Object.keys(CATS).map((k) => ({ k, n: rs.filter((r) => r.category === k).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
      const byStatus = STATUSES.map((s) => [s[0], rs.filter((r) => r.status === s[0]).length]);
      const overdue = open.filter((r) => overdueDays(r) > 0).length;
      const oldest = open.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 5);
      const weeks = weekBuckets(rs, 8);
      const weekLabels = weeks.map((_, i) => (i === weeks.length - 1 ? "This week" : (weeks.length - 1 - i) + "w ago"));

      document.getElementById("pulseBody").innerHTML =
        '<div class="toolbar"><label class="range">Area <select id="areaSel" style="width:auto"><option value="">All areas</option>' +
        areas.map((a) => '<option value="' + esc(a) + '"' + (a === area ? " selected" : "") + ">" + esc(a) + "</option>").join("") + "</select></label>" +
        (area ? '<a class="btn ghost sm" href="' + areaHref(area) + '">Area report card</a>' : "") + "</div>" +
        '<div class="tiles">' +
        [["Total reports", rs.length], ["Still open", open.length], ["Resolved", resolved], ["Recurring hotspots", clusters.length], ["Community confirmations", confirms],
          ["Resolution rate", (rs.length ? Math.round((resolved / rs.length) * 100) : 0) + "%"]]
          .concat([["Overdue (past category target)", overdue]])
          .concat(stats && stats.avg_days_to_resolve != null && !area ? [["Avg days to resolve", stats.avg_days_to_resolve]] : [])
          .map((t) => '<div class="tile"><b>' + t[1] + "</b><span>" + t[0] + "</span></div>").join("") + "</div>" +
        '<div class="pulse-grid"><div class="card"><h2>Reports by category</h2><div class="chartbox"><canvas id="catChart" role="img" aria-label="Reports by category: ' +
        esc(byCat.map((x) => catLabel(x.k) + " " + x.n).join(", ")) + '"></canvas></div></div>' +
        '<div class="card"><h2>Reports per week</h2><div class="chartbox"><canvas id="weekChart" role="img" aria-label="Reports per week, oldest first: ' + weeks.join(", ") + '"></canvas></div></div>' +
        '<div class="card stack"><h2>Status breakdown</h2><ul class="list">' + byStatus.map((s) => "<li>" + badge(s[0]) + "<b>" + s[1] + "</b></li>").join("") + "</ul></div>" +
        '<div class="card stack"><h2>Oldest unresolved</h2>' + (oldest.length
          ? '<ol class="list">' + oldest.map((r) => '<li><span><a href="#/issue/' + r.id + '">' + esc(r.title) + '</a><br><span class="small muted">' + esc(catLabel(r.category)) + " · open " + daysAgo(r.created_at) + " days" + (r.area ? " · " + esc(r.area) : "") + "</span></span>" + (overdueBadge(r) || badge(r.status)) + "</li>").join("") + "</ol>"
          : '<p class="muted small">Nothing unresolved. Well done, neighbours.</p>') +
        '<p class="small muted">Overdue means open longer than the target for its category: ' + Object.keys(SLA_DAYS).map((k) => esc(catLabel(k)) + " " + SLA_DAYS[k] + "d").join(", ") + ".</p></div>" +
        '<div class="card stack"><h2>Recurring hotspots</h2>' + (clusters.length
          ? '<ul class="list">' + clusters.map((c) => "<li><span><b>" + catDot(c.category) + esc(catLabel(c.category)) + '</b><br><span class="small">' + esc(clusterText(c)) +
            '</span></span><a href="#/issue/' + c.anchor.id + '">View</a></li>').join("") + "</ul>"
          : '<p class="muted small">No clusters of ' + MIN_CLUSTER + "+ same-type reports within " + RADIUS + " m.</p>") + "</div>" +
        '<div class="card stack" style="grid-column:1/-1" id="pulseShare"><h2>Share these numbers</h2>' + cardButtonsHtml() + "</div>" +
        '<div class="card stack" style="grid-column:1/-1"><h2>Active neighbours</h2>' + (leaders.length
          ? '<ol class="list leaders">' + leaders.map((l, i) => "<li><span><b>" + (i + 1) + ".</b> " + esc(names[l.id] || "A neighbour") + "</span><b>" + l.points + " pts</b></li>").join("") + "</ol>"
          : '<p class="muted small">No activity yet.</p>') +
        '<p class="small muted">10 points per report, 2 per confirmation, 5 per Action Circle joined. Covers all areas and includes demo residents while demo data is loaded. Admin accounts are not ranked.</p></div></div>';

      document.getElementById("areaSel").onchange = (e) => render(e.target.value);
      bindCard(document.getElementById("pulseShare"), { title: area ? area + " Pulse" : "Neighbourhood Pulse", sub: demoCount && !area ? "Includes labelled demo data" : "Live community data",
        nums: [[open.length, "still open"], [(rs.length ? Math.round((resolved / rs.length) * 100) : 0) + "%", "resolved"], [overdue, "overdue"], [rs.length, "reports"]] });
      if (!window.Chart) return;
      const theme = document.documentElement.dataset.theme;
      const dark = theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
      const tick = dark ? "#AFC3C1" : "#5B6B6A", grid = dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)";
      const font = { family: "Inter, system-ui, sans-serif" };
      const axis = (extra) => Object.assign({ ticks: { font, color: tick }, grid: { color: grid } }, extra || {});
      charts.push(new Chart(document.getElementById("catChart"), {
        type: "bar",
        data: { labels: byCat.map((x) => catLabel(x.k)), datasets: [{ data: byCat.map((x) => x.n), backgroundColor: byCat.map((x) => CATS[x.k].color), borderRadius: 8 }] },
        options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: axis({ beginAtZero: true, ticks: { precision: 0, font, color: tick } }), y: axis() } }
      }));
      charts.push(new Chart(document.getElementById("weekChart"), {
        type: "line",
        data: { labels: weekLabels, datasets: [{ data: weeks, borderColor: "#C5633C", backgroundColor: "rgba(197,99,60,.15)", fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#C5633C" }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: axis({ beginAtZero: true, ticks: { precision: 0, font, color: tick } }), x: axis() } }
      }));
    }
    render("");
  }

  /* ---------- shareable impact card (canvas PNG, same-origin assets only) ---------- */
  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  // spec: { title, sub, nums: [[value, label] x4] }
  async function renderCard(spec) {
    const W = 1080, c = document.createElement("canvas");
    c.width = W; c.height = W;
    const g = c.getContext("2d");
    try { await Promise.all([document.fonts.load("600 64px Poppins"), document.fonts.load("500 32px Inter")]); } catch (e) { /* fall back to system fonts */ }
    const head = "Poppins, Inter, system-ui, sans-serif", body = "Inter, system-ui, sans-serif";
    const fit = (txt, font, max) => { g.font = font; let s = String(txt); while (s.length > 3 && g.measureText(s).width > max) s = s.slice(0, -2); return s === String(txt) ? s : s.trim() + "…"; };
    g.fillStyle = "#F8F9F3"; g.fillRect(0, 0, W, W);
    g.fillStyle = "#144448"; g.fillRect(0, 0, W, 260);
    const logo = await loadImg("assets/fixmycity-icon.png");
    if (logo) g.drawImage(logo, 70, 70, 120, 120);
    g.fillStyle = "#FFFFFF"; g.textBaseline = "alphabetic";
    g.font = "600 68px " + head; g.fillText("FixMyCity", logo ? 220 : 70, 150);
    g.font = "500 30px " + body; g.fillStyle = "#CFE0DD"; g.fillText("Report once. Understand together.", logo ? 220 : 70, 198);
    g.fillStyle = "#144448"; g.font = "600 58px " + head; g.fillText(fit(spec.title, "600 58px " + head, 940), 70, 370);
    g.fillStyle = "#5B6B6A"; g.font = "500 32px " + body; g.fillText(fit(spec.sub || "", "500 32px " + body, 940), 70, 425);
    spec.nums.slice(0, 4).forEach((n, i) => {
      const x = 70 + (i % 2) * 480, y = 480 + Math.floor(i / 2) * 220;
      g.fillStyle = "#FFFFFF"; g.beginPath(); g.roundRect ? g.roundRect(x, y, 450, 190, 28) : g.rect(x, y, 450, 190); g.fill();
      g.strokeStyle = "#D9DEDC"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "#A84E2C"; g.font = "600 92px " + head; g.fillText(fit(n[0], "600 92px " + head, 400), x + 30, y + 108);
      g.fillStyle = "#5B6B6A"; g.font = "500 30px " + body; g.fillText(fit(n[1], "500 30px " + body, 400), x + 30, y + 156);
    });
    g.fillStyle = "#A84E2C"; g.font = "600 46px " + head; g.fillText("#BuildForMyCity", 70, 975);
    g.fillStyle = "#5B6B6A"; g.font = "500 28px " + body; g.fillText(fit(location.host + location.pathname.replace(/index\.html$/, ""), "500 28px " + body, 940), 70, 1025);
    return new Promise((res) => c.toBlob(res, "image/png"));
  }
  const cardButtonsHtml = () => '<div class="stack"><div class="row"><button type="button" class="btn sm" data-card="share" style="display:none">Share image</button>' +
    '<button type="button" class="btn ghost sm" data-card="dl">Download PNG</button></div>' +
    '<p class="small muted">A 1080 x 1080 image drawn on your device from these numbers. Nothing is uploaded.</p></div>';
  function bindCard(root, spec) {
    const sh = root.querySelector('[data-card="share"]'), dl = root.querySelector('[data-card="dl"]');
    let canFiles = false;
    try { canFiles = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File(["x"], "a.png", { type: "image/png" })] })); } catch (e) { /* no file sharing */ }
    if (sh && canFiles) sh.style.display = "";
    const make = async (btn) => {
      btn.disabled = true;
      try { const b = await renderCard(spec); if (!b) throw new Error("no image"); return b; }
      catch (e) { console.warn(e); toast("Could not make the image in this browser."); return null; }
      finally { btn.disabled = false; }
    };
    if (dl) dl.onclick = async () => {
      const blob = await make(dl);
      if (!blob) return;
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "fixmycity-impact.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    if (sh) sh.onclick = async () => {
      const blob = await make(sh);
      if (!blob) return;
      try { await navigator.share({ files: [new File([blob], "fixmycity-impact.png", { type: "image/png" })], title: "FixMyCity", text: "#BuildForMyCity" }); }
      catch (e) { if (e && e.name !== "AbortError") toast("Could not share the image. Use Download PNG instead."); }
    };
  }

  /* ---------- area report card (#/area/<name>) ---------- */
  // Grade rule: share of reports resolved, and share of still-open reports that are overdue. Fewer than 3 reports: no grade.
  function gradeFor(total, resolvedPct, overduePct) {
    if (total < 3) return null;
    if (resolvedPct >= 70 && overduePct <= 20) return "A";
    if (resolvedPct >= 50 && overduePct <= 40) return "B";
    if (resolvedPct >= 30 && overduePct <= 60) return "C";
    return "D";
  }
  async function viewArea(raw) {
    let name = "";
    try { name = decodeURIComponent(raw || ""); } catch (e) { name = ""; }
    const stale = routeToken();
    if (!name || name.length > 160) { view.innerHTML = '<div class="card narrow"><h1>Area not found</h1><p class="muted">The link is incomplete.</p><p><a href="#/pulse">Back to Pulse</a></p></div>'; return; }
    view.innerHTML = '<p class="muted pad">Loading…</p>';
    const [rq, hq] = await Promise.all([
      db.from("reports_with_counts").select("*").eq("area", name).limit(2000),
      db.from("status_history").select("report_id,created_at").eq("new_status", "resolved").order("created_at", { ascending: true }).limit(5000)
    ]);
    if (stale()) return;
    if (rq.error) return showError(rq.error);
    const rs = rq.data || [];
    if (!rs.length) { view.innerHTML = '<div class="card narrow"><h1>' + esc(name) + '</h1><p class="muted">No reports have been filed for this area yet.</p><p class="row"><a class="btn" href="#/report">Report an issue</a><a class="btn ghost" href="#/pulse">Back to Pulse</a></p></div>'; return; }
    const open = rs.filter((r) => r.status !== "resolved"), resolved = rs.filter((r) => r.status === "resolved");
    const firstRes = {};
    (hq.error ? [] : hq.data || []).forEach((h) => { if (!firstRes[h.report_id]) firstRes[h.report_id] = h.created_at; });
    const fixDays = resolved.filter((r) => firstRes[r.id]).map((r) => (new Date(firstRes[r.id]) - new Date(r.created_at)) / 864e5).filter((d) => d >= 0);
    const med = median(fixDays);
    const resolvedPct = Math.round((resolved.length / rs.length) * 100);
    const overdue = open.filter((r) => overdueDays(r) > 0).length, overduePct = open.length ? Math.round((overdue / open.length) * 100) : 0;
    const grade = gradeFor(rs.length, resolvedPct, overduePct);
    const oldest = open.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
    const catCount = {}; rs.forEach((r) => { catCount[r.category] = (catCount[r.category] || 0) + 1; });
    const topCat = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a])[0];
    const demoN = rs.filter((r) => r.is_demo).length;
    const medText = med == null ? "n/a" : (Math.round(med * 10) / 10) + " d";
    const spec = { title: name + " report card", sub: (grade ? "Grade " + grade + " · " : "") + "Aggregated community data", nums: [[open.length, "still open"], [resolvedPct + "%", "resolved"], [medText, "median days to fix"], [overdue, "overdue"]] };
    view.innerHTML =
      '<p><a href="#/pulse">&larr; Back to Pulse</a></p><h1>' + esc(name) + " report card</h1>" +
      '<p class="muted" style="max-width:62ch">A summary of reports filed in this area. Numbers only: no resident is named.' +
      (demoN ? ' <span class="badge demo">Demo data</span> ' + demoN + " of " + rs.length + " reports are labelled demo data." : "") + "</p>" +
      '<div class="card grade-card"><div class="grade g-' + (grade || "na") + '" role="img" aria-label="' + (grade ? "Grade " + grade : "Not enough reports to grade") + '"><b>' + (grade || "&ndash;") + "</b></div>" +
      "<div><h2>" + (grade ? "Grade " + grade : "Not graded yet") + "</h2><p class=\"small\">" + (grade
        ? resolvedPct + "% of reports resolved, and " + overduePct + "% of open reports are overdue."
        : "At least 3 reports are needed before an area is graded (this area has " + rs.length + ").") + "</p></div></div>" +
      '<div class="tiles">' + [["Open reports", open.length], ["Resolved", resolvedPct + "%"], ["Median days to fix", medText], ["Overdue", overdue]]
        .map((x) => '<div class="tile"><b>' + esc(x[1]) + "</b><span>" + x[0] + "</span></div>").join("") + "</div>" +
      '<div class="pulse-grid"><div class="card stack"><h2>Oldest open item</h2>' + (oldest
        ? '<p><a href="#/issue/' + oldest.id + '">' + esc(oldest.title) + '</a><br><span class="small muted">' + esc(catLabel(oldest.category)) + " · open " + daysAgo(oldest.created_at) + " days</span>" + overdueBadge(oldest) + "</p>"
        : '<p class="muted small">Nothing open here. Every report is resolved.</p>') +
      "<h2>Top category</h2><p>" + catDot(topCat) + esc(catLabel(topCat)) + ' <span class="small muted">(' + catCount[topCat] + " of " + rs.length + " reports)</span></p></div>" +
      '<div class="card stack"><h2>How the grade works</h2><ul class="small" style="margin:0;padding-left:18px">' +
      "<li><b>A</b>: at least 70% resolved and at most 20% of open reports overdue</li><li><b>B</b>: at least 50% resolved and at most 40% overdue</li>" +
      "<li><b>C</b>: at least 30% resolved and at most 60% overdue</li><li><b>D</b>: anything lower</li></ul>" +
      '<p class="small muted">Overdue means open longer than the target for its category (' + Object.keys(SLA_DAYS).map((k) => esc(catLabel(k)) + " " + SLA_DAYS[k] + "d").join(", ") +
      "). Median days to fix uses resolved reports that have a recorded resolution. This is a community indicator, not an official rating.</p></div></div>" +
      '<div class="card stack" id="areaShare"><h2>Share</h2><div class="row"><button type="button" class="btn sm" id="areaLink">Share this report card</button></div>' + cardButtonsHtml() + "</div>";
    document.getElementById("areaLink").onclick = () => shareLink(name + " report card", location.origin + location.pathname + areaHref(name));
    bindCard(document.getElementById("areaShare"), spec);
  }

  /* ---------- open data (#/data) ---------- */
  async function viewData() {
    const stale = routeToken();
    view.innerHTML = '<p class="muted pad">Loading…</p>';
    const q = await db.from("reports_with_counts").select("id,category,status,created_at,area,latitude,longitude,confirmations,is_demo").order("created_at", { ascending: false }).limit(5000);
    if (stale()) return;
    if (q.error) return showError(q.error);
    // Public export: demo rows left out, no user ids, coordinates rounded to 4 decimals (about 11 m).
    const rows = (q.data || []).filter((r) => !r.is_demo).map((r) => ({
      id: r.id, category: r.category, status: r.status, created_at: r.created_at, area: r.area || "",
      latitude: Math.round(r.latitude * 1e4) / 1e4, longitude: Math.round(r.longitude * 1e4) / 1e4, confirmations: Number(r.confirmations) || 0
    }));
    const geo = JSON.stringify({
      type: "FeatureCollection", generated: new Date().toISOString(), note: "Data shared for civic use. No personal data. Coordinates rounded to 4 decimals.",
      features: rows.map((r) => ({ type: "Feature", geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
        properties: { id: r.id, category: r.category, status: r.status, created_at: r.created_at, area: r.area, confirmations: r.confirmations } }))
    }, null, 1);
    const cols = ["id", "category", "status", "created_at", "area", "latitude", "longitude", "confirmations"];
    const csv = "﻿" + [cols].concat(rows.map((r) => cols.map((c) => r[c]))).map((r) => r.map(csvCell).join(",")).join("\r\n");
    const mk = (text, type) => { const u = URL.createObjectURL(new Blob([text], { type })); blobUrls.push(u); return u; };
    const gUrl = mk(geo, "application/geo+json"), cUrl = mk(csv, "text/csv;charset=utf-8");
    const pageUrl = location.origin + location.pathname + "#/data";
    view.innerHTML = "<h1>Open data</h1>" +
      '<p class="muted" style="max-width:62ch">Reports filed on FixMyCity, free to download for civic use, research and journalism. Built in your browser from the live community database.</p>' +
      '<div class="card stack"><h2>' + rows.length + " report" + (rows.length === 1 ? "" : "s") + " available</h2>" +
      (rows.length ? "" : '<p class="small muted">There are no real (non-demo) reports to export yet. Demo data is never included.</p>') +
      '<div class="row"><a class="btn" id="dlGeo" href="' + gUrl + '" download="fixmycity-reports.geojson">Download GeoJSON</a>' +
      '<a class="btn" id="dlCsv" href="' + cUrl + '" download="fixmycity-reports.csv">Download CSV</a>' +
      '<button type="button" class="btn ghost" id="copyData">Copy link to this page</button></div>' +
      '<p class="small"><b>Licence:</b> data shared for civic use, no personal data. Please credit FixMyCity.</p></div>' +
      '<div class="card stack"><h2>What is in the files</h2><ul class="small" style="margin:0;padding-left:18px"><li>Fields: id, category, status, created_at, area, latitude, longitude, confirmations.</li>' +
      "<li>Left out: demo data, reporter identity, titles, descriptions and photos.</li><li>Coordinates are rounded to 4 decimals (roughly 11 metres).</li></ul></div>";
    document.getElementById("copyData").onclick = async () => {
      try { await navigator.clipboard.writeText(pageUrl); toast("Link copied. Anyone can open it to download the data."); }
      catch (e) { toast("Could not copy. Copy the address from your browser."); }
    };
  }

  /* ---------- guided tour (#/tour) ---------- */
  // Finds something worth showing: the biggest recurring cluster's oldest report, else the newest report.
  async function tourTarget() {
    const q = await db.from("reports_with_counts").select("*").limit(1000);
    if (q.error || !q.data || !q.data.length) return null;
    const cl = computeClusters(q.data, RADIUS);
    const pick = cl.length ? cl[0].anchor : q.data.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return { issueId: pick.id };
  }
  async function viewTour() {
    const stale = routeToken();
    view.innerHTML = '<p class="muted pad">Starting the tour…</p>';
    try { await loadScript("app/tour.js"); } catch (e) {
      if (stale()) return;
      view.innerHTML = '<div class="card narrow"><h1>Tour unavailable</h1><p class="muted">The tour could not be loaded. Check your connection and try again.</p><p class="row"><a class="btn" href="#/map">Explore the map</a></p></div>';
      return;
    }
    if (stale()) return;
    window.FMC_TOUR.start({ target: tourTarget });
  }

  /* ---------- Action Circles ---------- */
  async function viewCircles() {
    const stale = routeToken();
    const [aq, mq] = await Promise.all([
      db.from("activities").select("*").order("event_date", { ascending: true }).limit(200),
      db.from("activity_members").select("activity_id,user_id").limit(5000)
    ]);
    if (stale()) return;
    if (aq.error) return showError(aq.error);
    const acts = aq.data || [], members = mq.data || [];
    const cq = acts.length ? await db.from("profiles").select("id,name").in("id", Array.from(new Set(acts.map((a) => a.creator_id)))) : { data: [] };
    if (stale()) return;
    const cname = {}; (cq.data || []).forEach((p) => { cname[p.id] = p.name; });
    const cutoff = Date.now() - 864e5;
    const upcoming = acts.filter((a) => !a.event_date || new Date(a.event_date).getTime() >= cutoff);
    const past = acts.filter((a) => a.event_date && new Date(a.event_date).getTime() < cutoff).reverse();

    const card = (a) => {
      const mine = user && members.some((m) => m.activity_id === a.id && m.user_id === user.id);
      const n = members.filter((m) => m.activity_id === a.id).length;
      const isPast = a.event_date && new Date(a.event_date).getTime() < cutoff;
      const canManage = user && (a.creator_id === user.id || isAdmin());
      return '<div class="card stack"><div><h3 style="margin-bottom:4px">' + esc(a.title) + demoTag(a) + "</h3>" +
        '<p class="small muted" style="margin:0">' + (a.event_date ? esc(fmtDateTime(a.event_date)) : "Date to be announced") + (a.location ? " · " + esc(a.location) : "") + "</p></div>" +
        (a.description ? "<p>" + esc(a.description) + "</p>" : "") +
        '<div class="row" style="justify-content:space-between"><span class="small"><b>' + n + "</b> neighbour" + (n === 1 ? "" : "s") + " joined · organised by " + esc(cname[a.creator_id] || "a resident") + "</span>" +
        '<span class="row">' + (canManage ? '<button type="button" class="btn danger sm" data-delcircle="' + a.id + '">Delete</button>' : "") +
        (isPast ? "" : user
          ? '<button type="button" class="btn sm ' + (mine ? "ghost" : "") + '" data-circle="' + a.id + '" data-joined="' + (mine ? "1" : "0") + '">' + esc(mine ? t("leave") : t("join")) + "</button>"
          : '<a class="btn sm" href="#/login">' + esc(t("login_join")) + "</a>") + "</span></div></div>";
    };
    view.innerHTML = "<h1>" + esc(t("h_circles")) + "</h1>" +
      '<p class="lead muted" id="circlesTop" style="max-width:62ch">Small voluntary activities that neighbours organise together: clean-ups, tree planting, awareness walks.</p>' +
      '<p class="note" style="max-width:62ch;margin-bottom:20px"><b>Safety first.</b> Circles are for safe, voluntary activities only. Do not repair roads, wiring or drains yourself. Report hazards on the map instead.</p>' +
      (user ? '<details class="card" id="newCircle" style="margin-bottom:20px"><summary style="cursor:pointer;font-weight:600">Start an Action Circle</summary>' +
        '<form id="circleForm" class="stack" style="margin-top:14px"><label>Title<input id="cTitle" required minlength="3" maxlength="120" placeholder="e.g. Saturday park clean-up"></label>' +
        '<label>What will you do?<textarea id="cDesc" maxlength="1000" placeholder="Keep it safe and simple. Say what to bring."></textarea></label>' +
        '<label>Where<input id="cLoc" maxlength="160" placeholder="Meeting point"></label>' +
        '<label>When<input id="cDate" type="datetime-local" required min="' + localNow() + '"></label><p class="err" id="cErr" role="alert"></p><button class="btn">Create circle</button></form></details>'
        : '<p><a href="#/login">Log in</a> to join or start an Action Circle.</p>') +
      "<h2>Upcoming</h2>" + (upcoming.length ? '<div class="stack">' + upcoming.map(card).join("") + "</div>" : '<p class="muted">Nothing planned yet. Be the first to start one.</p>') +
      (past.length ? '<h2 style="margin-top:28px">Past</h2><div class="stack">' + past.map(card).join("") + "</div>" : "");

    view.querySelectorAll("[data-circle]").forEach((b) => b.onclick = async () => {
      const id = b.dataset.circle;
      b.disabled = true;
      const res = b.dataset.joined === "1"
        ? await db.from("activity_members").delete().eq("activity_id", id).eq("user_id", user.id)
        : await db.from("activity_members").insert({ activity_id: id });
      if (res.error) { b.disabled = false; return toast(friendly(res.error)); }
      toast(b.dataset.joined === "1" ? "You left the circle" : "You joined the circle");
      route();
    });
    view.querySelectorAll("[data-delcircle]").forEach((b) => b.onclick = async () => {
      if (!armed(b, "Tap again to delete")) return;
      const res = await db.from("activities").delete().eq("id", b.dataset.delcircle).select("id");
      if (res.error || !res.data || !res.data.length) return toast(res.error ? friendly(res.error) : "Could not delete this circle.");
      toast("Action Circle deleted"); route();
    });
    const form = document.getElementById("circleForm");
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("cErr"); err.textContent = "";
      const when = new Date(document.getElementById("cDate").value);
      if (isNaN(when.getTime())) { err.textContent = "Choose a date and time."; return; }
      if (when.getTime() < Date.now() - 6e4) { err.textContent = "Choose a date and time in the future."; return; }
      const ins = await db.from("activities").insert({
        title: document.getElementById("cTitle").value.trim(),
        description: document.getElementById("cDesc").value.trim() || null,
        location: document.getElementById("cLoc").value.trim() || null,
        event_date: when.toISOString()
      }).select("id").single();
      if (ins.error) { err.textContent = friendly(ins.error); return; }
      await db.from("activity_members").insert({ activity_id: ins.data.id });
      toast("Action Circle created"); route();
    };
  }

  /* ---------- my reports + profile ---------- */
  async function viewMine() {
    if (!user) { view.innerHTML = '<div class="card narrow"><h1>' + esc(t("h_mine")) + '</h1><p><a href="#/login">Log in</a> to see your reports.</p></div>'; return; }
    const stale = routeToken();
    const q = await db.from("reports_with_counts").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (stale()) return;
    if (q.error) return showError(q.error);
    lsSet("fmc_seen_" + user.id, new Date().toISOString()); // mark updates as seen
    if (notifCount) { notifCount = 0; renderNav(); }
    view.innerHTML = "<h1>" + esc(t("h_mine")) + "</h1>" +
      '<details class="card" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:600">My profile</summary>' +
      '<form id="profileForm" class="row" style="margin-top:12px;align-items:end"><label style="flex:1;min-width:200px">Display name<input id="pName" required maxlength="60" value="' + esc((profile && profile.name) || "") + '"></label>' +
      '<button class="btn">Save name</button></form><p class="small muted" style="margin-bottom:0">Shown on your reports and Action Circles. Signed in as ' + esc(user.email) + ".</p></details>" +
      (q.data.length
        ? '<ul class="list">' + q.data.map((r) => '<li><span><a href="#/issue/' + r.id + '">' + esc(r.title) + '</a>' + demoTag(r) + '<br><span class="small muted">' + esc(catLabel(r.category)) + " · " + fmtDate(r.created_at) + " · " + (Number(r.confirmations) || 0) + " confirmations</span></span><span class=\"row\">" + badge(r.status) + overdueBadge(r) + "</span></li>").join("") + "</ul>"
        : '<div class="card"><p>You have not reported anything yet.</p><a class="btn" href="#/report">Report an issue</a></div>');
    document.getElementById("profileForm").onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("pName").value.trim();
      const res = await db.from("profiles").update({ name }).eq("id", user.id).select("name");
      if (res.error) return toast(friendly(res.error));
      if (profile) profile.name = name;
      toast("Name saved");
    };
  }

  /* ---------- admin (demo role) ---------- */
  async function viewAdmin() {
    if (!isAdmin()) {
      view.innerHTML = '<div class="card narrow"><h1>Admin</h1><p>This page is only for the demonstration administrator account.</p></div>'; return;
    }
    const stale = routeToken();
    const q = await db.from("reports_with_counts").select("*").order("created_at", { ascending: false }).limit(2000);
    if (stale()) return;
    if (q.error) return showError(q.error);
    let reports = q.data || [];
    const clusters = computeClusters(reports, RADIUS);
    const pq = reports.length ? await db.from("profiles").select("id,name").in("id", Array.from(new Set(reports.map((r) => r.user_id)))) : { data: [] };
    if (stale()) return;
    const rname = {}; (pq.data || []).forEach((p) => { rname[p.id] = p.name; });
    const PAGE = 25;
    let page = 0;

    view.innerHTML =
      "<h1>" + esc(t("h_admin")) + '</h1><p class="small muted">Demonstration role. It does not represent any government body.</p>' +
      "<h2>Suggested clusters to review</h2>" + (clusters.length
        ? '<ul class="list" style="margin-bottom:24px">' + clusters.map((c) => "<li><span><b>" + catDot(c.category) + esc(catLabel(c.category)) + '</b><br><span class="small">' + esc(clusterText(c)) +
          '</span></span><a href="#/issue/' + c.anchor.id + '">Open oldest report</a></li>').join("") + "</ul>"
        : '<p class="muted small">No clusters at ' + RADIUS + " m right now.</p>") +
      '<h2>All reports</h2><div class="toolbar">' +
      '<label class="range">Search <input id="aSearch" type="search" placeholder="Title, area or reporter" style="width:220px"></label>' +
      '<label class="range">Status <select id="aStatus" style="width:auto"><option value="">All</option>' + STATUSES.map((s) => '<option value="' + s[0] + '">' + s[1] + "</option>").join("") + "</select></label>" +
      '<label class="range">Category <select id="aCat" style="width:auto"><option value="">All</option>' + Object.keys(CATS).map((k) => '<option value="' + k + '">' + catLabel(k) + "</option>").join("") + "</select></label>" +
      '<button type="button" class="btn ghost sm" id="aExport">Export CSV</button><button type="button" class="btn ghost sm" id="aHot">Export hotspots CSV</button>' +
      '<span class="small muted" id="aCount" aria-live="polite"></span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Report</th><th>Reporter</th><th>Category</th><th>Confirmations</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="aBody"></tbody></table></div>' +
      '<div class="row" style="margin-top:12px" id="aPager"></div>';

    function filtered() {
      const s = document.getElementById("aSearch").value.trim().toLowerCase(), st = document.getElementById("aStatus").value, c = document.getElementById("aCat").value;
      return reports.filter((r) => (!st || r.status === st) && (!c || r.category === c) &&
        (!s || [r.title, r.area, rname[r.user_id]].some((v) => v && String(v).toLowerCase().indexOf(s) !== -1)));
    }
    function drawTable() {
      const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / PAGE));
      page = Math.min(page, pages - 1);
      document.getElementById("aCount").textContent = rows.length + " of " + reports.length + " reports";
      document.getElementById("aBody").innerHTML = rows.length ? rows.slice(page * PAGE, page * PAGE + PAGE).map((r) =>
        '<tr><td><a href="#/issue/' + r.id + '">' + esc(r.title) + "</a>" + demoTag(r) + overdueBadge(r) + '<br><span class="small muted">' + fmtDate(r.created_at) + (r.area ? " · " + esc(r.area) : "") + "</span></td>" +
        "<td>" + esc(rname[r.user_id] || "a resident") + "</td><td>" + catDot(r.category) + esc(catLabel(r.category)) + "</td><td>" + (Number(r.confirmations) || 0) + "</td>" +
        '<td><select data-id="' + r.id + '" data-prev="' + r.status + '" aria-label="Status for ' + esc(r.title) + '">' +
        STATUSES.map((s) => '<option value="' + s[0] + '"' + (s[0] === r.status ? " selected" : "") + ">" + s[1] + "</option>").join("") + "</select></td>" +
        '<td><button type="button" class="btn danger sm" data-del="' + r.id + '" aria-label="Delete ' + esc(r.title) + '">Delete</button></td></tr>').join("")
        : '<tr><td colspan="6" class="muted">No reports match.</td></tr>';
      document.getElementById("aPager").innerHTML = pages > 1
        ? '<button type="button" class="btn ghost sm" id="aPrev"' + (page === 0 ? " disabled" : "") + '>Previous</button><span class="small muted">Page ' + (page + 1) + " of " + pages +
          '</span><button type="button" class="btn ghost sm" id="aNext"' + (page >= pages - 1 ? " disabled" : "") + ">Next</button>" : "";
      const prev = document.getElementById("aPrev"), next = document.getElementById("aNext");
      if (prev) prev.onclick = () => { page--; drawTable(); };
      if (next) next.onclick = () => { page++; drawTable(); };
      view.querySelectorAll("select[data-id]").forEach((sel) => sel.onchange = async () => {
        sel.disabled = true;
        const res = await db.rpc("set_report_status", { p_report_id: sel.dataset.id, p_status: sel.value });
        sel.disabled = false;
        if (res.error) { sel.value = sel.dataset.prev; return toast(friendly(res.error)); } // revert on failure
        sel.dataset.prev = sel.value;
        const r = reports.find((x) => x.id === sel.dataset.id); if (r) r.status = sel.value;
        toast("Status updated");
      });
      view.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
        if (!armed(b, "Confirm")) return;
        b.disabled = true;
        const r = reports.find((x) => x.id === b.dataset.del);
        const msg = await deleteReport(r);
        if (msg) { b.disabled = false; return toast(msg); }
        reports = reports.filter((x) => x.id !== r.id);
        toast("Report deleted"); drawTable();
      });
    }
    // CSV for sharing with a ward office. Leading =,+,-,@ are neutralised to stop spreadsheet formula injection.
    function downloadCsv(name, rows) {
      const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    document.getElementById("aExport").onclick = () => downloadCsv("fixmycity-reports.csv",
      [["id", "title", "category", "status", "area", "latitude", "longitude", "confirmations", "reported", "demo"]].concat(
        filtered().map((r) => [r.id, r.title, r.category, r.status, r.area, r.latitude, r.longitude, r.confirmations, r.created_at, r.is_demo ? "yes" : ""])));
    document.getElementById("aHot").onclick = () => downloadCsv("fixmycity-hotspots.csv",
      [["priority", "category", "reports", "confirmations", "oldest_days", "latitude", "longitude", "oldest_report_id"]].concat(
        clusters.map((c) => [priorityLabel(c), c.category, c.members.length, c.confirmations, daysAgo(c.oldest), c.anchor.latitude, c.anchor.longitude, c.anchor.id])));
    ["aSearch", "aStatus", "aCat"].forEach((id) => { document.getElementById(id).oninput = () => { page = 0; drawTable(); }; });
    drawTable();
  }

  /* ---------- start ---------- */
  const s = await db.auth.getSession();
  await loadUser(s.data && s.data.session);
  // A password-reset link lands with tokens in the hash; the PASSWORD_RECOVERY event
  // (handled above) then moves the user to #/reset.
  if (/type=recovery/.test(location.hash)) location.hash = "#/reset";
  else if (/[?&]tour=1\b/.test(location.search)) { history.replaceState(null, "", location.pathname + "#/tour"); route(); } // shareable "?tour=1" link
  else route();
})();
