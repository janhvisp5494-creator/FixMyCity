/* FixMyCity app: auth, reporting, map + Repeat Issue Radar, issue pages, admin.
   Plain JavaScript, hash routing. Data and auth come from Supabase. */
(async function () {
  const cfg = window.FMC_CONFIG || {};
  const view = document.getElementById("view");
  const navEl = document.getElementById("nav");

  if (!cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.indexOf("PASTE") === 0) {
    view.innerHTML = '<div class="card narrow"><h2>Setup needed</h2><p>Add your Supabase anon key to <code>app/config.js</code>, then reload.</p></div>';
    return;
  }
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const CATS = {
    pothole: { label: "Pothole", color: "#C5633C" },
    garbage: { label: "Garbage", color: "#3C6D4F" },
    streetlight: { label: "Streetlight", color: "#C99A06" },
    drainage: { label: "Drainage", color: "#2F7F9E" },
    water_logging: { label: "Water logging", color: "#5B6BC0" },
    other: { label: "Other", color: "#7A7A7A" }
  };
  const STATUSES = [
    ["submitted", "Submitted"], ["community_confirmed", "Community confirmed"],
    ["acknowledged", "Acknowledged"], ["in_progress", "In progress"], ["resolved", "Resolved"]
  ];
  const STATUS_LABEL = Object.fromEntries(STATUSES);
  const RADIUS = cfg.RADIUS_M || 150, MIN_CLUSTER = cfg.MIN_CLUSTER || 3;

  let user = null, profile = null, lastUid = null, map = null, charts = [];

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const daysAgo = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
  const badge = (s) => '<span class="badge s-' + esc(s) + '">' + esc(STATUS_LABEL[s] || s) + "</span>";
  const catDot = (c) => '<span class="dot" style="background:' + (CATS[c] || CATS.other).color + '"></span>';
  const catLabel = (c) => (CATS[c] || CATS.other).label;
  const demoTag = (r) => (r && r.is_demo ? ' <span class="badge demo">Demo data</span>' : "");
  const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }
  function showError(e) {
    console.error(e);
    view.innerHTML = '<div class="card narrow"><h2>Something went wrong</h2><p class="muted">' + esc(e && e.message ? e.message : e) + "</p></div>";
  }
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
        out.push({
          anchor: a, category: a.category, members,
          confirmations: members.reduce((s, m) => s + (Number(m.confirmations) || 0), 0),
          oldest: members[0].created_at
        });
      }
    }
    return out.sort((x, y) => y.members.length - x.members.length);
  }
  const clusterText = (c) => c.members.length + " reports · " + c.confirmations + " community confirmations · oldest " + daysAgo(c.oldest) + " days";
  function baseMap(el) {
    const m = L.map(el);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    return m;
  }
  function defaultView(m, tryLocate) {
    m.setView(cfg.DEFAULT_CENTER || [20.59, 78.96], cfg.DEFAULT_ZOOM || 5);
    if (tryLocate && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => m.setView([p.coords.latitude, p.coords.longitude], 15), () => {}, { timeout: 6000 });
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
  }
  function renderNav() {
    const h = location.hash || "#/map";
    const link = (href, text, cls) => '<a href="' + href + '" class="' + (cls || "") + (h.indexOf(href) === 0 ? " active" : "") + '">' + text + "</a>";
    let html = link("#/map", "Explore map") + link("#/pulse", "Pulse") + link("#/circles", "Action Circles") + link("#/report", "Report an issue", "cta");
    if (user) html += link("#/mine", "My reports");
    if (profile && profile.role === "admin") html += link("#/admin", "Admin");
    html += user ? '<button id="logout" type="button">Log out</button>' : link("#/login", "Log in");
    navEl.innerHTML = html;
    const lo = document.getElementById("logout");
    if (lo) lo.onclick = async () => { await db.auth.signOut(); toast("Logged out"); location.hash = "#/map"; };
  }
  db.auth.onAuthStateChange((evt, session) => {
    const uid = session && session.user ? session.user.id : null;
    if (uid === lastUid) return; // ignore token refreshes and tab re-focus
    setTimeout(async () => { await loadUser(session); route(); }, 0);
  });

  /* ---------- router ---------- */
  function cleanup() {
    if (map) { map.remove(); map = null; }
    charts.forEach((c) => { try { c.destroy(); } catch (e) {} }); charts = [];
  }
  async function route() {
    cleanup();
    renderNav();
    const parts = (location.hash.replace(/^#\/?/, "") || "map").split("/");
    const name = parts[0], arg = parts[1];
    window.scrollTo(0, 0);
    try {
      if (name === "map") await viewMap();
      else if (name === "report") await viewReport();
      else if (name === "issue" && arg) await viewIssue(arg);
      else if (name === "mine") await viewMine();
      else if (name === "pulse") await viewPulse();
      else if (name === "circles") await viewCircles();
      else if (name === "admin") await viewAdmin();
      else if (name === "login") viewLogin();
      else await viewMap();
    } catch (e) { showError(e); }
  }
  window.addEventListener("hashchange", route);

  /* ---------- login / register ---------- */
  function viewLogin() {
    let registering = false;
    function draw() {
      view.innerHTML =
        '<div class="card narrow"><h1>' + (registering ? "Create your account" : "Log in") + "</h1>" +
        '<form id="authForm" class="stack">' +
        (registering ? '<label>Name<input id="name" required maxlength="60" autocomplete="name"></label>' : "") +
        '<label>Email<input id="email" type="email" required autocomplete="email"></label>' +
        '<label>Password<input id="password" type="password" required minlength="6" autocomplete="' + (registering ? "new-password" : "current-password") + '"></label>' +
        '<p class="err" id="authErr"></p>' +
        '<button class="btn" id="authBtn">' + (registering ? "Sign up" : "Log in") + "</button></form>" +
        '<p class="small muted">' + (registering ? "Already have an account?" : "New here?") +
        ' <a href="#/login" id="swap">' + (registering ? "Log in" : "Create an account") + "</a></p></div>";
      document.getElementById("swap").onclick = (e) => { e.preventDefault(); registering = !registering; draw(); };
      document.getElementById("authForm").onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById("authBtn"), err = document.getElementById("authErr");
        btn.disabled = true; err.textContent = "";
        const email = document.getElementById("email").value.trim(), password = document.getElementById("password").value;
        let res;
        if (registering) {
          res = await db.auth.signUp({ email, password, options: { data: { name: document.getElementById("name").value.trim() } } });
        } else {
          res = await db.auth.signInWithPassword({ email, password });
        }
        btn.disabled = false;
        if (res.error) { err.textContent = res.error.message; return; }
        if (registering && !res.data.session) {
          err.style.color = "#3C6D4F";
          err.textContent = "Account created. Check your email to confirm, then log in.";
          return;
        }
        toast(registering ? "Welcome to FixMyCity" : "Logged in");
        location.hash = "#/map";
      };
    }
    draw();
  }

  /* ---------- explore map + radar ---------- */
  async function viewMap() {
    view.innerHTML =
      '<h1>Explore issues</h1>' +
      '<div class="toolbar" id="chips"></div>' +
      '<div class="toolbar"><label class="range">Radar radius <input type="range" id="radius" min="50" max="300" step="10" value="' + RADIUS + '"><span id="radiusOut">' + RADIUS + ' m</span></label>' +
      '<label class="range"><input type="checkbox" id="hideResolved"> Hide resolved</label></div>' +
      '<div class="map-layout"><div id="map" class="map" role="application" aria-label="Map of reported issues"></div><aside class="side" id="side"></aside></div>';
    const q = await db.from("reports_with_counts").select("*").order("created_at", { ascending: false }).limit(1000);
    if (q.error) return showError(q.error);
    const reports = q.data || [];

    map = baseMap("map");
    const markers = L.layerGroup().addTo(map), rings = L.layerGroup().addTo(map);
    let radius = RADIUS, hideResolved = false;
    const active = new Set(Object.keys(CATS));

    const chips = document.getElementById("chips");
    chips.innerHTML = Object.keys(CATS).map((k) =>
      '<button type="button" class="btn sm on" data-cat="' + k + '">' + catDot(k).replace("background:", "background:") + catLabel(k) + "</button>").join("");
    chips.querySelectorAll("button").forEach((b) => b.onclick = () => {
      const k = b.dataset.cat;
      if (active.has(k)) { active.delete(k); b.classList.remove("on"); b.classList.add("ghost"); }
      else { active.add(k); b.classList.add("on"); b.classList.remove("ghost"); }
      draw();
    });
    document.getElementById("radius").oninput = (e) => { radius = +e.target.value; document.getElementById("radiusOut").textContent = radius + " m"; draw(); };
    document.getElementById("hideResolved").onchange = (e) => { hideResolved = e.target.checked; draw(); };

    function draw() {
      markers.clearLayers(); rings.clearLayers();
      const shown = reports.filter((r) => active.has(r.category) && !(hideResolved && r.status === "resolved"));
      shown.forEach((r) => {
        const color = (CATS[r.category] || CATS.other).color;
        L.circleMarker([r.latitude, r.longitude], {
          radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: r.status === "resolved" ? 0.35 : 0.9
        }).addTo(markers).bindPopup(
          '<div class="pop"><h3>' + esc(r.title) + "</h3>" + demoTag(r) + "<br>" + catDot(r.category) + esc(catLabel(r.category)) + " · " + badge(r.status) +
          '<br><span class="small">' + (Number(r.confirmations) || 0) + ' <span class="heart">&hearts;</span> community confirmations</span><br><a href="#/issue/' + r.id + '">View details</a></div>');
      });
      const clusters = computeClusters(shown, radius);
      const side = document.getElementById("side");
      clusters.forEach((c) => {
        L.circle([c.anchor.latitude, c.anchor.longitude], { radius, color: "#3C6D4F", weight: 2, dashArray: "6 5", fillColor: "#3C6D4F", fillOpacity: 0.12, interactive: false }).addTo(rings);
      });
      side.innerHTML = "<h2>Possible recurring issues</h2>" + (clusters.length
        ? clusters.map((c, i) => '<button type="button" class="cluster" data-i="' + i + '"><b>' + catDot(c.category) + esc(catLabel(c.category)) + "</b><br>" +
          '<span class="small">' + esc(clusterText(c)) + '</span><br><span class="small muted">Suggested for review, not merged</span></button>').join("")
        : '<p class="muted small">No clusters of ' + MIN_CLUSTER + "+ same-type reports within " + radius + " m yet.</p>") +
        '<p class="small muted">' + shown.length + " reports shown. Clusters are suggestions based on category and distance.</p>";
      side.querySelectorAll(".cluster").forEach((b) => b.onclick = () => {
        const c = clusters[+b.dataset.i];
        map.fitBounds(L.latLng(c.anchor.latitude, c.anchor.longitude).toBounds(radius * 2.6));
      });
    }
    draw();
    if (reports.length) {
      map.fitBounds(L.latLngBounds(reports.map((r) => [r.latitude, r.longitude])), { padding: [40, 40], maxZoom: 16 });
    } else {
      defaultView(map, true);
    }
  }

  /* ---------- report an issue ---------- */
  async function resizeImage(file, max) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  }
  async function viewReport() {
    if (!user) {
      view.innerHTML = '<div class="card narrow"><h1>Report an issue</h1><p>Please <a href="#/login">log in or create an account</a> to report an issue. It takes under a minute.</p></div>';
      return;
    }
    view.innerHTML =
      '<h1>Report an issue</h1><div class="issue"><form id="reportForm" class="card stack">' +
      '<label>Title<input id="title" required minlength="3" maxlength="120" placeholder="e.g. Deep pothole near the bus stop"></label>' +
      '<label>Category<select id="category">' + Object.keys(CATS).map((k) => '<option value="' + k + '">' + esc(catLabel(k)) + "</option>").join("") + "</select></label>" +
      '<label>Description<textarea id="desc" maxlength="2000" placeholder="What is the problem, and how long has it been there?"></textarea></label>' +
      '<label>Photo (recommended)<input id="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>' +
      '<img id="preview" class="preview" alt="Photo preview">' +
      '<p class="note">Keep faces, vehicle number plates and private property out of the photo. Photos are shown publicly.</p>' +
      '<label>Area or landmark (optional)<input id="area" maxlength="120" placeholder="e.g. MG Road, near the bus stop"></label>' +
      '<div><strong class="small">Location</strong><p class="small muted" style="margin:2px 0 8px">Tap the map to drop a pin on the exact spot.</p>' +
      '<div id="picker" class="picker"></div><div class="row" style="margin-top:8px"><button type="button" class="btn ghost sm" id="locate">Use my location</button><span class="small muted" id="coords">No location chosen yet</span></div></div>' +
      '<p class="err" id="repErr"></p><button class="btn" id="submitBtn">Submit report</button></form>' +
      '<aside class="card stack"><h2>Already reported nearby?</h2><div id="similar" class="muted small">Choose a category and drop a pin to see similar reports within ' + RADIUS + ' m.</div></aside></div>';

    map = baseMap("picker");
    defaultView(map, false);
    let pin = null, point = null;
    const similar = document.getElementById("similar");
    async function checkSimilar() {
      if (!point) return;
      const cat = document.getElementById("category").value;
      similar.textContent = "Checking…";
      const r = await db.rpc("nearby_reports", { p_lat: point.lat, p_lng: point.lng, p_category: cat, p_radius_m: RADIUS });
      if (r.error) { similar.textContent = "Could not check nearby reports."; return; }
      if (!r.data.length) { similar.innerHTML = "No open " + esc(catLabel(cat).toLowerCase()) + " reports within " + RADIUS + " m. You would be the first."; return; }
      similar.innerHTML = "<p><b>" + r.data.length + "</b> open " + esc(catLabel(cat).toLowerCase()) + " report" + (r.data.length > 1 ? "s" : "") +
        " within " + RADIUS + ' m. If yours is the same issue, open it and confirm it instead.</p><ul class="list">' +
        r.data.map((x) => '<li><span>' + esc(x.title) + '<br><span class="small muted">' + Math.round(x.distance_m) + " m away · " + daysAgo(x.created_at) + ' days old</span></span><a href="#/issue/' + x.id + '" target="_blank" rel="noopener">View</a></li>').join("") + "</ul>";
    }
    function setPoint(latlng, pan) {
      point = { lat: latlng.lat, lng: latlng.lng };
      if (pin) pin.setLatLng(latlng); else pin = L.marker(latlng).addTo(map);
      if (pan) map.setView(latlng, 17);
      document.getElementById("coords").textContent = "Pin at " + point.lat.toFixed(5) + ", " + point.lng.toFixed(5);
      checkSimilar();
    }
    map.on("click", (e) => setPoint(e.latlng, false));
    document.getElementById("category").onchange = checkSimilar;
    document.getElementById("locate").onclick = () => {
      if (!navigator.geolocation) return toast("Location is not available in this browser");
      navigator.geolocation.getCurrentPosition(
        (p) => setPoint(L.latLng(p.coords.latitude, p.coords.longitude), true),
        () => toast("Could not get your location. Tap the map instead."), { timeout: 8000, enableHighAccuracy: true });
    };
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
      try {
        let imageUrl = null;
        const file = photoEl.files[0];
        if (file) {
          const blob = await resizeImage(file, 1600);
          const path = user.id + "/" + Date.now() + ".jpg";
          const up = await db.storage.from("report-images").upload(path, blob, { contentType: "image/jpeg" });
          if (up.error) throw up.error;
          imageUrl = db.storage.from("report-images").getPublicUrl(path).data.publicUrl;
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
        err.textContent = ex.message || "Could not submit the report.";
        btn.disabled = false; btn.textContent = "Submit report";
      }
    };
  }

  /* ---------- issue details ---------- */
  async function viewIssue(id) {
    const [rq, hq, vq] = await Promise.all([
      db.from("reports_with_counts").select("*").eq("id", id).maybeSingle(),
      db.from("status_history").select("*").eq("report_id", id).order("created_at", { ascending: true }),
      user ? db.from("verifications").select("vote").eq("report_id", id).eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    if (rq.error) return showError(rq.error);
    const r = rq.data;
    if (!r) { view.innerHTML = '<div class="card narrow"><h1>Report not found</h1><p><a href="#/map">Back to the map</a></p></div>'; return; }
    const [aq, nq] = await Promise.all([
      db.from("profiles").select("name").eq("id", r.user_id).maybeSingle(),
      db.rpc("nearby_reports", { p_lat: r.latitude, p_lng: r.longitude, p_category: r.category, p_radius_m: RADIUS })
    ]);
    const history = hq.data || [], myVote = vq.data ? vq.data.vote : null;
    const nearby = (nq.data || []).filter((x) => x.id !== r.id);
    const isOwner = user && user.id === r.user_id, isAdmin = profile && profile.role === "admin";
    const who = (h) => h.updated_by == null ? "Community" : h.updated_by === r.user_id ? "Reporter" : "Admin (demo role)";

    let voteHtml;
    if (!user) voteHtml = '<p class="small"><a href="#/login">Log in</a> to confirm or update this report.</p>';
    else if (isOwner) voteHtml = '<p class="small muted">You reported this issue. Other residents can confirm it.</p>';
    else voteHtml = '<div class="votes">' + [["still_exists", "Still exists"], ["worse", "It got worse"], ["resolved", "Looks resolved"]]
      .map((v) => '<button type="button" class="btn sm ' + (myVote === v[0] ? "on" : "ghost") + '" data-vote="' + v[0] + '">' + v[1] + "</button>").join("") + "</div>";

    view.innerHTML =
      '<p><a href="#/map">&larr; Back to the map</a></p><div class="issue"><div class="stack"><div class="card stack">' +
      (r.image_url ? '<img class="photo" src="' + esc(r.image_url) + '" alt="Photo of the reported issue">' : "") +
      "<div><h1>" + esc(r.title) + '</h1><div class="row">' + badge(r.status) + demoTag(r) + "<span>" + catDot(r.category) + esc(catLabel(r.category)) + "</span></div></div>" +
      (r.description ? "<p>" + esc(r.description) + "</p>" : "") +
      '<p class="small muted">Reported ' + fmtDate(r.created_at) + " by " + esc((aq.data && aq.data.name) || "a resident") +
      (r.area ? " · " + esc(r.area) : "") + " · Report ID " + esc(String(r.id).slice(0, 8)) + "</p>" +
      (isOwner && r.status === "submitted" ? '<div><button class="btn danger sm" id="del" type="button">Delete my report</button></div>' : "") +
      '</div><div class="card stack"><h2>Nearby ' + esc(catLabel(r.category).toLowerCase()) + " reports</h2>" +
      (nearby.length ? '<ul class="list">' + nearby.map((x) => '<li><span>' + esc(x.title) + '<br><span class="small muted">' + Math.round(x.distance_m) + " m away · " + esc(STATUS_LABEL[x.status] || x.status) + '</span></span><a href="#/issue/' + x.id + '">View</a></li>').join("") + "</ul>"
        : '<p class="small muted">No other open reports of this type within ' + RADIUS + " m.</p>") +
      "</div></div>" +
      '<div class="stack"><div class="card stack"><h2>Community check</h2>' +
      '<p><b>' + (Number(r.confirmations) || 0) + '</b> residents say it still exists · <b>' + (Number(r.resolved_votes) || 0) + "</b> say it looks resolved</p>" + voteHtml +
      '<p class="note">Community confirmation shows neighbours agree the issue exists. It is not an official verification.</p></div>' +
      '<div class="card stack"><h2>Status history</h2><ol class="timeline">' +
      history.map((h) => "<li>" + badge(h.new_status) + '<br><span class="small muted">' + fmtDate(h.created_at) + " · " + who(h) + "</span></li>").join("") + "</ol></div>" +
      (isAdmin ? '<div class="card stack"><h2>Admin (demo role)</h2><label>Update status<select id="adminStatus">' +
        STATUSES.map((s) => '<option value="' + s[0] + '"' + (s[0] === r.status ? " selected" : "") + ">" + s[1] + "</option>").join("") +
        '</select></label><button class="btn" id="adminSave" type="button">Save status</button></div>' : "") +
      "</div></div>";

    view.querySelectorAll("[data-vote]").forEach((b) => b.onclick = async () => {
      const vote = b.dataset.vote;
      const res = myVote
        ? await db.from("verifications").update({ vote }).eq("report_id", id).eq("user_id", user.id)
        : await db.from("verifications").insert({ report_id: id, vote });
      if (res.error) return toast(res.error.message);
      toast("Thanks, your response was recorded");
      route();
    });
    const del = document.getElementById("del");
    if (del) del.onclick = async () => {
      if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Tap again to confirm delete"; return; }
      const res = await db.from("reports").delete().eq("id", id);
      if (res.error) return toast(res.error.message);
      toast("Report deleted"); location.hash = "#/mine";
    };
    const save = document.getElementById("adminSave");
    if (save) save.onclick = async () => {
      const res = await db.rpc("set_report_status", { p_report_id: id, p_status: document.getElementById("adminStatus").value });
      if (res.error) return toast(res.error.message);
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
    reports.forEach((r) => add(r.user_id, 10));          // 10 points per report
    votes.forEach((v) => add(v.user_id, 2));             // 2 points per confirmation given
    members.forEach((m) => add(m.user_id, 5));           // 5 points per Action Circle joined
    return Object.keys(pts).map((id) => ({ id, points: pts[id] })).sort((a, b) => b.points - a.points).slice(0, 5);
  }
  async function viewPulse() {
    view.innerHTML = '<h1>Neighbourhood Pulse</h1><p class="muted" id="pulseSub">Loading…</p><div id="pulseBody"></div>';
    const [rq, vq, mq] = await Promise.all([
      db.from("reports_with_counts").select("*").limit(2000),
      db.from("verifications").select("user_id").limit(5000),
      db.from("activity_members").select("user_id").limit(5000)
    ]);
    if (rq.error) return showError(rq.error);
    const all = rq.data || [];
    const areas = Array.from(new Set(all.map((r) => r.area).filter(Boolean))).sort();
    const demoCount = all.filter((r) => r.is_demo).length;
    document.getElementById("pulseSub").innerHTML = "What is being reported, what is still open, and where problems keep coming back." +
      (demoCount ? ' <span class="badge demo">Demo data</span> ' + demoCount + " of " + all.length + " reports are labelled demo data, not real city statistics." : "");

    const leaders = pointsFor(all, vq.data || [], mq.data || []);
    const names = {};
    if (leaders.length) {
      const pq = await db.from("profiles").select("id,name").in("id", leaders.map((l) => l.id));
      (pq.data || []).forEach((p) => { names[p.id] = p.name; });
    }

    function render(area) {
      charts.forEach((c) => { try { c.destroy(); } catch (e) {} }); charts = [];
      const rs = area ? all.filter((r) => r.area === area) : all;
      const open = rs.filter((r) => r.status !== "resolved"), resolved = rs.length - open.length;
      const clusters = computeClusters(rs, RADIUS);
      const confirms = rs.reduce((s, r) => s + (Number(r.confirmations) || 0), 0);
      const byCat = Object.keys(CATS).map((k) => ({ k, n: rs.filter((r) => r.category === k).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
      const byStatus = STATUSES.map((s) => [s[0], rs.filter((r) => r.status === s[0]).length]);
      const weeks = weekBuckets(rs, 8);
      const weekLabels = weeks.map((_, i) => (i === weeks.length - 1 ? "This week" : (weeks.length - 1 - i) + "w ago"));

      document.getElementById("pulseBody").innerHTML =
        '<div class="toolbar"><label class="range">Area <select id="areaSel" style="width:auto"><option value="">All areas</option>' +
        areas.map((a) => '<option value="' + esc(a) + '"' + (a === area ? " selected" : "") + ">" + esc(a) + "</option>").join("") + "</select></label></div>" +
        '<div class="tiles">' +
        [["Total reports", rs.length], ["Still open", open.length], ["Resolved", resolved], ["Recurring hotspots", clusters.length], ["Community confirmations", confirms]]
          .map((t) => '<div class="tile"><b>' + t[1] + "</b><span>" + t[0] + "</span></div>").join("") + "</div>" +
        '<div class="pulse-grid"><div class="card"><h2>Reports by category</h2><div class="chartbox"><canvas id="catChart" aria-label="Reports by category"></canvas></div></div>' +
        '<div class="card"><h2>Reports per week</h2><div class="chartbox"><canvas id="weekChart" aria-label="Reports per week"></canvas></div></div>' +
        '<div class="card stack"><h2>Status breakdown</h2><ul class="list">' + byStatus.map((s) => "<li>" + badge(s[0]) + "<b>" + s[1] + "</b></li>").join("") + "</ul></div>" +
        '<div class="card stack"><h2>Recurring hotspots</h2>' + (clusters.length
          ? '<ul class="list">' + clusters.map((c) => "<li><span><b>" + catDot(c.category) + esc(catLabel(c.category)) + '</b><br><span class="small">' + esc(clusterText(c)) +
            '</span></span><a href="#/issue/' + c.anchor.id + '">View</a></li>').join("") + "</ul>"
          : '<p class="muted small">No clusters of ' + MIN_CLUSTER + "+ same-type reports within " + RADIUS + " m.</p>") + "</div>" +
        '<div class="card stack" style="grid-column:1/-1"><h2>Active neighbours</h2>' + (leaders.length
          ? '<ol class="list leaders">' + leaders.map((l, i) => "<li><span><b>" + (i + 1) + ".</b> " + esc(names[l.id] || "A neighbour") + "</span><b>" + l.points + " pts</b></li>").join("") + "</ol>"
          : '<p class="muted small">No activity yet.</p>') +
        '<p class="small muted">10 points per report, 2 per confirmation, 5 per Action Circle joined. Covers all areas and includes demo residents while demo data is loaded.</p></div></div>';

      document.getElementById("areaSel").onchange = (e) => render(e.target.value);
      if (!window.Chart) return;
      const font = { family: "Inter, system-ui, sans-serif" };
      charts.push(new Chart(document.getElementById("catChart"), {
        type: "bar",
        data: { labels: byCat.map((x) => catLabel(x.k)), datasets: [{ data: byCat.map((x) => x.n), backgroundColor: byCat.map((x) => CATS[x.k].color), borderRadius: 8 }] },
        options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0, font } }, y: { ticks: { font } } } }
      }));
      charts.push(new Chart(document.getElementById("weekChart"), {
        type: "line",
        data: { labels: weekLabels, datasets: [{ data: weeks, borderColor: "#A84E2C", backgroundColor: "rgba(197,99,60,.15)", fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#A84E2C" }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0, font } }, x: { ticks: { font } } } }
      }));
    }
    render("");
  }

  /* ---------- Action Circles ---------- */
  async function viewCircles() {
    const [aq, mq] = await Promise.all([
      db.from("activities").select("*").order("event_date", { ascending: true }).limit(200),
      db.from("activity_members").select("activity_id,user_id").limit(5000)
    ]);
    if (aq.error) return showError(aq.error);
    const acts = aq.data || [], members = mq.data || [];
    const cq = acts.length ? await db.from("profiles").select("id,name").in("id", Array.from(new Set(acts.map((a) => a.creator_id)))) : { data: [] };
    const cname = {}; (cq.data || []).forEach((p) => { cname[p.id] = p.name; });
    const cutoff = Date.now() - 864e5;
    const upcoming = acts.filter((a) => !a.event_date || new Date(a.event_date).getTime() >= cutoff);
    const past = acts.filter((a) => a.event_date && new Date(a.event_date).getTime() < cutoff).reverse();

    const card = (a) => {
      const mine = user && members.some((m) => m.activity_id === a.id && m.user_id === user.id);
      const n = members.filter((m) => m.activity_id === a.id).length;
      const isPast = a.event_date && new Date(a.event_date).getTime() < cutoff;
      return '<div class="card stack"><div><h3 style="margin-bottom:4px">' + esc(a.title) + demoTag(a) + "</h3>" +
        '<p class="small muted" style="margin:0">' + (a.event_date ? esc(fmtDateTime(a.event_date)) : "Date to be announced") + (a.location ? " · " + esc(a.location) : "") + "</p></div>" +
        (a.description ? "<p>" + esc(a.description) + "</p>" : "") +
        '<div class="row" style="justify-content:space-between"><span class="small"><b>' + n + "</b> neighbour" + (n === 1 ? "" : "s") + " joined · organised by " + esc(cname[a.creator_id] || "a resident") + "</span>" +
        (isPast ? "" : user
          ? '<button type="button" class="btn sm ' + (mine ? "ghost" : "") + '" data-circle="' + a.id + '" data-joined="' + (mine ? "1" : "0") + '">' + (mine ? "Leave" : "Join") + "</button>"
          : '<a class="btn sm" href="#/login">Log in to join</a>') + "</div></div>";
    };
    view.innerHTML = "<h1>Action Circles</h1>" +
      '<p class="lead muted" style="max-width:62ch">Small voluntary activities that neighbours organise together: clean-ups, tree planting, awareness walks.</p>' +
      '<p class="note" style="max-width:62ch;margin-bottom:20px"><b>Safety first.</b> Circles are for safe, voluntary activities only. Do not repair roads, wiring or drains yourself. Report hazards on the map instead.</p>' +
      (user ? '<details class="card" id="newCircle" style="margin-bottom:20px"><summary style="cursor:pointer;font-weight:600">Start an Action Circle</summary>' +
        '<form id="circleForm" class="stack" style="margin-top:14px"><label>Title<input id="cTitle" required minlength="3" maxlength="120" placeholder="e.g. Saturday park clean-up"></label>' +
        '<label>What will you do?<textarea id="cDesc" maxlength="1000" placeholder="Keep it safe and simple. Say what to bring."></textarea></label>' +
        '<label>Where<input id="cLoc" maxlength="160" placeholder="Meeting point"></label>' +
        '<label>When<input id="cDate" type="datetime-local" required></label><p class="err" id="cErr"></p><button class="btn">Create circle</button></form></details>'
        : '<p><a href="#/login">Log in</a> to join or start an Action Circle.</p>') +
      "<h2>Upcoming</h2>" + (upcoming.length ? '<div class="stack">' + upcoming.map(card).join("") + "</div>" : '<p class="muted">Nothing planned yet. Be the first to start one.</p>') +
      (past.length ? '<h2 style="margin-top:28px">Past</h2><div class="stack">' + past.map(card).join("") + "</div>" : "");

    view.querySelectorAll("[data-circle]").forEach((b) => b.onclick = async () => {
      const id = b.dataset.circle;
      const res = b.dataset.joined === "1"
        ? await db.from("activity_members").delete().eq("activity_id", id).eq("user_id", user.id)
        : await db.from("activity_members").insert({ activity_id: id });
      if (res.error) return toast(res.error.message);
      toast(b.dataset.joined === "1" ? "You left the circle" : "You joined the circle");
      route();
    });
    const form = document.getElementById("circleForm");
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("cErr"); err.textContent = "";
      const when = new Date(document.getElementById("cDate").value);
      if (isNaN(when.getTime())) { err.textContent = "Choose a date and time."; return; }
      const ins = await db.from("activities").insert({
        title: document.getElementById("cTitle").value.trim(),
        description: document.getElementById("cDesc").value.trim() || null,
        location: document.getElementById("cLoc").value.trim() || null,
        event_date: when.toISOString()
      }).select("id").single();
      if (ins.error) { err.textContent = ins.error.message; return; }
      await db.from("activity_members").insert({ activity_id: ins.data.id });
      toast("Action Circle created"); route();
    };
  }

  /* ---------- my reports ---------- */
  async function viewMine() {
    if (!user) { view.innerHTML = '<div class="card narrow"><h1>My reports</h1><p><a href="#/login">Log in</a> to see your reports.</p></div>'; return; }
    const q = await db.from("reports_with_counts").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (q.error) return showError(q.error);
    view.innerHTML = "<h1>My reports</h1>" + (q.data.length
      ? '<ul class="list">' + q.data.map((r) => '<li><span><a href="#/issue/' + r.id + '">' + esc(r.title) + '</a>' + demoTag(r) + '<br><span class="small muted">' + esc(catLabel(r.category)) + " · " + fmtDate(r.created_at) + " · " + (Number(r.confirmations) || 0) + " confirmations</span></span>" + badge(r.status) + "</li>").join("") + "</ul>"
      : '<div class="card"><p>You have not reported anything yet.</p><a class="btn" href="#/report">Report an issue</a></div>');
  }

  /* ---------- admin (demo role) ---------- */
  async function viewAdmin() {
    if (!profile || profile.role !== "admin") {
      view.innerHTML = '<div class="card narrow"><h1>Admin</h1><p>This page is only for the demonstration administrator account.</p></div>'; return;
    }
    const q = await db.from("reports_with_counts").select("*").order("created_at", { ascending: false }).limit(500);
    if (q.error) return showError(q.error);
    const reports = q.data, clusters = computeClusters(reports, RADIUS);
    view.innerHTML =
      '<h1>Admin dashboard</h1><p class="small muted">Demonstration role. It does not represent any government body.</p>' +
      "<h2>Suggested clusters to review</h2>" + (clusters.length
        ? '<ul class="list" style="margin-bottom:24px">' + clusters.map((c) => "<li><span><b>" + catDot(c.category) + esc(catLabel(c.category)) + '</b><br><span class="small">' + esc(clusterText(c)) +
          '</span></span><a href="#/issue/' + c.anchor.id + '">Open oldest report</a></li>').join("") + "</ul>"
        : '<p class="muted small">No clusters at ' + RADIUS + " m right now.</p>") +
      "<h2>All reports</h2>" + '<div class="table-wrap"><table><thead><tr><th>Report</th><th>Category</th><th>Confirmations</th><th>Status</th></tr></thead><tbody>' +
      reports.map((r) => '<tr><td><a href="#/issue/' + r.id + '">' + esc(r.title) + '</a><br><span class="small muted">' + fmtDate(r.created_at) + "</span></td><td>" + catDot(r.category) + esc(catLabel(r.category)) + "</td><td>" + (Number(r.confirmations) || 0) + '</td><td><select data-id="' + r.id + '" aria-label="Status for ' + esc(r.title) + '">' +
        STATUSES.map((s) => '<option value="' + s[0] + '"' + (s[0] === r.status ? " selected" : "") + ">" + s[1] + "</option>").join("") + "</select></td></tr>").join("") + "</tbody></table></div>";
    view.querySelectorAll("select[data-id]").forEach((sel) => sel.onchange = async () => {
      const res = await db.rpc("set_report_status", { p_report_id: sel.dataset.id, p_status: sel.value });
      toast(res.error ? res.error.message : "Status updated");
    });
  }

  /* ---------- start ---------- */
  const s = await db.auth.getSession();
  await loadUser(s.data && s.data.session);
  route();
})();
