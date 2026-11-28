// Test doubles: in-memory Supabase client, Leaflet and Chart.js stubs.
(function () {
  const uid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => (Math.random() * 16 | 0).toString(16));
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
  const DB = window.__DB = { profiles: [], reports: [], verifications: [], activities: [], activity_members: [], status_history: [] };
  const P = (id, name, email, role) => DB.profiles.push({ id, name, email, role: role || 'citizen', created_at: iso(40) });
  P('u-admin', 'Admin Demo', 'admin@x.com', 'admin'); P('u1', 'Demo Asha', 'a@x.com'); P('u2', 'Demo Ravi', 'r@x.com');
  P('u3', 'Demo Meera', 'm@x.com'); P('u4', 'Demo Kabir', 'k@x.com'); P('u-test', 'Tester', 'tester@x.com');
  const lat0 = 22.3072, lng0 = 73.1812, m = (n, e) => [lat0 + n / 111320, lng0 + e / (111320 * Math.cos(lat0 * Math.PI / 180))];
  const R = (id, title, cat, n, e, status, days, area, user, demo) => { const [la, lo] = m(n, e); DB.reports.push({ id, title, description: 'd', category: cat, image_url: null, latitude: la, longitude: lo, area, status, user_id: user, created_at: iso(days), is_demo: demo !== false }); };
  R('r1', 'Deep pothole', 'pothole', 0, 0, 'acknowledged', 12, 'Ward 1', 'u1');
  R('r2', 'Pothole junction', 'pothole', 45, -30, 'submitted', 9, 'Ward 1', 'u2');
  R('r3', 'Broken road', 'pothole', -60, 40, 'submitted', 7, 'Ward 1', 'u3');
  R('r4', 'New pothole', 'pothole', 90, 70, 'submitted', 4, 'Ward 1', 'u4');
  R('r5', 'Service lane pothole', 'pothole', -20, -110, 'submitted', 3, 'Ward 1', 'u1');
  R('g1', 'Garbage pile', 'garbage', 400, -300, 'acknowledged', 10, 'Ward 2', 'u2');
  R('g2', 'Overflowing bin', 'garbage', 430, -260, 'community_confirmed', 6, 'Ward 2', 'u3');
  R('g3', 'Rubbish dumped', 'garbage', 380, -340, 'submitted', 2, 'Ward 2', 'u4');
  R('x1', 'Repaired pothole', 'pothole', -800, -300, 'resolved', 33, 'Ward 2', 'u2');
  const V = (rid, uidv) => DB.verifications.push({ id: uid(), report_id: rid, user_id: uidv, vote: 'still_exists', created_at: iso(1) });
  V('r1', 'u2'); V('r1', 'u3'); V('r2', 'u3'); V('r3', 'u4');            // 4 confirmations in the cluster
  V('g1', 'u3'); V('g1', 'u4'); V('g2', 'u1'); V('g2', 'u4');
  DB.activities.push({ id: 'a1', title: 'Saturday clean-up', description: 'Bring gloves', location: 'Market gate', event_date: new Date(Date.now() + 3 * 864e5).toISOString(), creator_id: 'u2', is_demo: true });
  DB.activities.push({ id: 'a2', title: 'Tree planting', description: '', location: 'Park', event_date: new Date(Date.now() + 9 * 864e5).toISOString(), creator_id: 'u3', is_demo: true });
  DB.activity_members.push({ id: uid(), activity_id: 'a1', user_id: 'u1' }, { id: uid(), activity_id: 'a1', user_id: 'u2' }, { id: uid(), activity_id: 'a2', user_id: 'u3' });

  let session = null; const listeners = [];
  const emit = (evt) => listeners.forEach((cb) => cb(evt, session));
  const rad = (d) => d * Math.PI / 180;
  const hav = (a, b, c, d) => { const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x))); };
  const conf = (id) => DB.verifications.filter((v) => v.report_id === id && ['still_exists', 'worse'].includes(v.vote)).length;
  const viewRows = () => DB.reports.map((r) => ({ ...r, confirmations: conf(r.id), resolved_votes: DB.verifications.filter((v) => v.report_id === r.id && v.vote === 'resolved').length }));
  const me = () => session && session.user.id;
  const myRole = () => (DB.profiles.find((p) => p.id === me()) || {}).role;

  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = null; this.lim = null; this.sg = null; this.payload = null; this.ret = false; }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    eq(k, v) { this.f.push((r) => r[k] === v); return this; }
    in(k, a) { this.f.push((r) => a.includes(r[k])); return this; }
    order(k, o) { this.ord = [k, !(o && o.ascending === false)]; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.sg = 'maybe'; return this; }
    single() { this.sg = 'one'; return this; }
    insert(row) { this.op = 'insert'; this.payload = row; return this; }
    update(v) { this.op = 'update'; this.payload = v; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
    exec() {
      const src = this.t === 'reports_with_counts' ? viewRows() : DB[this.t];
      if (!src) return { data: null, error: { message: 'unknown table ' + this.t } };
      const match = (r) => this.f.every((fn) => fn(r));
      if (this.op === 'insert') {
        if (!session) return { data: null, error: { message: 'permission denied for table ' + this.t } };
        const row = { id: uid(), created_at: new Date().toISOString(), ...this.payload };
        if (this.t === 'reports') { row.user_id = me(); row.status = 'submitted'; row.is_demo = false; }
        if (this.t === 'verifications') { row.user_id = me(); if (DB.verifications.some((v) => v.report_id === row.report_id && v.user_id === row.user_id)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } }; }
        if (this.t === 'activities') { row.creator_id = me(); row.is_demo = false; }
        if (this.t === 'activity_members') { row.user_id = me(); }
        DB[this.t].push(row);
        if (this.t === 'reports') DB.status_history.push({ id: uid(), report_id: row.id, old_status: null, new_status: 'submitted', updated_by: me(), created_at: row.created_at });
        return { data: this.ret ? (this.sg ? row : [row]) : null, error: null };
      }
      if (this.op === 'update') { DB[this.t].filter(match).forEach((r) => Object.assign(r, this.payload)); return { data: null, error: null }; }
      if (this.op === 'delete') { DB[this.t] = DB[this.t].filter((r) => !match(r)); return { data: null, error: null }; }
      let rows = src.filter(match);
      if (this.ord) rows = rows.slice().sort((a, b) => (a[this.ord[0]] > b[this.ord[0]] ? 1 : -1) * (this.ord[1] ? 1 : -1));
      if (this.lim) rows = rows.slice(0, this.lim);
      if (this.sg) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
  }
  window.supabase = { createClient: () => ({
    from: (t) => new Q(t),
    rpc: async (name, a) => {
      if (name === 'nearby_reports') {
        const rows = DB.reports.filter((r) => r.category === a.p_category && r.status !== 'resolved').map((r) => ({ ...r, distance_m: hav(a.p_lat, a.p_lng, r.latitude, r.longitude), confirmations: conf(r.id) })).filter((r) => r.distance_m <= a.p_radius_m).sort((x, y) => x.distance_m - y.distance_m);
        return { data: rows, error: null };
      }
      if (name === 'set_report_status') {
        if (myRole() !== 'admin') return { data: null, error: { message: 'Only administrators can change report status' } };
        const r = DB.reports.find((x) => x.id === a.p_report_id); const old = r.status; r.status = a.p_status;
        DB.status_history.push({ id: uid(), report_id: r.id, old_status: old, new_status: a.p_status, updated_by: me(), created_at: new Date().toISOString() });
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: 'https://example.test/' + p } }) }) },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async ({ email }) => { const p = DB.profiles.find((x) => x.email === email); if (!p) return { data: {}, error: { message: 'Invalid login credentials' } }; session = { user: { id: p.id, email } }; emit('SIGNED_IN'); return { data: { session }, error: null }; },
      signUp: async ({ email, options }) => { const id = uid(); DB.profiles.push({ id, name: (options && options.data && options.data.name) || email, email, role: 'citizen' }); session = { user: { id, email } }; emit('SIGNED_IN'); return { data: { session }, error: null }; },
      signOut: async () => { if (window.__hangSignOut) return new Promise(() => {}); session = null; emit('SIGNED_OUT'); return { error: null }; }
    }
  }) };

  // Leaflet stub: records what the app draws
  window.__handlers = {}; window.__stats = { markers: 0, circles: 0 };
  const chain = () => new Proxy(function () {}, {
    get: (t, k) => k === 'then' ? undefined : k === 'on' ? (ev, fn) => { window.__handlers[ev] = fn; return chain(); } : chain(),
    apply: () => chain()
  });
  window.L = new Proxy({}, { get: (t, k) => {
    if (k === 'circleMarker') return () => { window.__stats.markers++; return chain(); };
    if (k === 'circle') return () => { window.__stats.circles++; return chain(); };
    return () => chain();
  } });
  // Chart.js stub
  window.__charts = []; window.__destroyed = 0;
  window.Chart = function (ctx, cfg) { window.__charts.push(cfg); this.destroy = () => { window.__destroyed++; }; };
  window.Chart.defaults = { font: {} };
})();
