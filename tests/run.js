const { chromium } = require('playwright');
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const fakes = fs.readFileSync(__dirname + '/fakes.js', 'utf8');
let pass = 0, fail = 0; const errors = [];
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra !== undefined ? '-> ' + JSON.stringify(extra) : ''); } };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/^https?:\/\//, (r) => r.fulfill({ status: 200, contentType: r.request().url().endsWith('.css') || r.request().url().includes('css2') ? 'text/css' : 'application/javascript', body: '' }));
  await page.route('**/app/config.js', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.FMC_CONFIG={SUPABASE_URL:"https://t.test",SUPABASE_ANON_KEY:"test-key",RADIUS_M:150,MIN_CLUSTER:3,DEFAULT_CENTER:[22.3,73.18],DEFAULT_ZOOM:13};' }));
  await page.addInitScript(fakes);
  const go = async (h) => { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(250); };
  const text = (sel) => page.locator(sel).first().innerText();
  await page.goto('file://' + ROOT + '/app/index.html#/map'); await page.waitForSelector('#side .cluster');

  console.log('Explore map + radar');
  const side = await text('#side');
  check('radar cluster shows 5 reports / 4 confirmations / oldest 12 days', /5 reports · 4 community confirmations · oldest 12 days/.test(side), side.slice(0, 200));
  check('second cluster (garbage) listed', /3 reports/.test(side));
  check('markers drawn for all 9 reports', (await page.evaluate(() => window.__stats.markers)) >= 9);
  check('radius slider changes clusters (100 m => 3 potholes, 60 m => pothole cluster gone)', await (async () => { await page.fill('#radius', '100'); await page.dispatchEvent('#radius', 'input'); if (!/3 reports · 4 community/.test(await text('#side'))) return false; await page.fill('#radius', '60'); await page.dispatchEvent('#radius', 'input'); const t = await text('#side'); return !/Pothole/.test(t) && /Garbage/.test(t); })());
  check('nav links include Pulse and Action Circles', /Pulse/.test(await text('#nav')) && /Action Circles/.test(await text('#nav')));

  console.log('Neighbourhood Pulse');
  await go('#/pulse'); await page.waitForSelector('.tiles');
  const tiles = await page.$$eval('.tile', (els) => els.map((e) => [e.querySelector('span').innerText, e.querySelector('b').innerText]));
  const T = Object.fromEntries(tiles);
  check('tiles: total 9, open 8, resolved 1, hotspots 2, confirmations 8', T['Total reports'] === '9' && T['Still open'] === '8' && T['Resolved'] === '1' && T['Recurring hotspots'] === '2' && T['Community confirmations'] === '8', T);
  check('demo-data label shown', /9 of 9 reports are labelled demo data/.test(await text('#pulseSub')));
  const charts = await page.evaluate(() => window.__charts.map((c) => ({ type: c.type, data: c.data.datasets[0].data, labels: c.data.labels })));
  check('category bar chart (potholes 6, garbage 3)', charts[0] && charts[0].type === 'bar' && charts[0].data.join() === '6,3', charts[0]);
  check('weekly line chart sums to 9 over 8 weeks', charts[1] && charts[1].type === 'line' && charts[1].data.length === 8 && charts[1].data.reduce((a, b) => a + b, 0) === 9, charts[1]);
  check('leaderboard lists neighbours with points', (await page.$$eval('.leaders li', (e) => e.length)) === 4 && /pts/.test(await text('.leaders')));
  await page.selectOption('#areaSel', 'Ward 2'); await page.waitForTimeout(150);
  check('area filter Ward 2 => total 4, old charts destroyed, new drawn', (await text('.tile b')) === '4' && (await page.evaluate(() => window.__destroyed)) >= 2 && (await page.evaluate(() => window.__charts.length)) === 4);

  console.log('Action Circles (logged out)');
  await go('#/circles'); await page.waitForSelector('.card');
  check('2 upcoming circles with Demo data label and counts', (await page.$$eval('.card h3', (e) => e.length)) === 2 && /Demo data/.test(await text('.card')) && /2<\/b> neighbours|2 neighbours/.test(await page.content().then((h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))));
  check('"Log in to join" shown, no create form', (await page.locator('a:has-text("Log in to join")').count()) === 2 && (await page.locator('#circleForm').count()) === 0);
  check('safety note present', /Do not repair roads/.test(await page.content()));

  console.log('Login');
  await go('#/login'); await page.fill('#email', 'tester@x.com'); await page.fill('#password', 'secret1'); await page.click('#authBtn'); await page.waitForTimeout(500);
  check('login succeeds and lands on map', (await page.evaluate(() => location.hash)) === '#/map');
  check('nav shows My reports and Log out', /My reports/.test(await text('#nav')) && /Log out/.test(await text('#nav')));
  await go('#/login'); await page.click('#swap'); await page.fill('#email', 'bad'); // just ensure toggle works
  check('register form toggles', (await page.locator('#name').count()) === 1);

  console.log('Action Circles (logged in)');
  await go('#/circles'); await page.waitForSelector('[data-circle]');
  await page.click('[data-circle="a2"]'); await page.waitForTimeout(250);
  check('join circle recorded', (await page.evaluate(() => window.__DB.activity_members.some((m) => m.activity_id === 'a2' && m.user_id === 'u-test'))));
  check('button now says Leave', /Leave/.test(await text('[data-circle="a2"]')));
  await page.click('[data-circle="a2"]'); await page.waitForTimeout(250);
  check('leave circle removes membership', !(await page.evaluate(() => window.__DB.activity_members.some((m) => m.activity_id === 'a2' && m.user_id === 'u-test'))));
  await page.click('#newCircle summary'); await page.fill('#cTitle', 'Lake clean-up'); await page.fill('#cDate', '2027-01-10T09:00'); await page.click('#circleForm button');
  await page.waitForTimeout(300);
  check('created circle appears and creator auto-joined', /Lake clean-up/.test(await text('main')) && (await page.evaluate(() => window.__DB.activity_members.some((m) => m.user_id === 'u-test'))));

  console.log('Report an issue');
  await go('#/report'); await page.waitForSelector('#reportForm');
  await page.fill('#title', 'Pothole by the temple'); await page.selectOption('#category', 'pothole');
  await page.click('#submitBtn'); await page.waitForTimeout(200);
  check('blocks submit without a map pin', /Tap the map/.test(await text('#repErr')));
  await page.evaluate(() => window.__handlers.click({ latlng: { lat: 22.3072, lng: 73.1812 } })); await page.waitForTimeout(300);
  const sim = await text('#similar');
  check('"already reported nearby" finds the 5 open potholes', /5.*open pothole/.test(sim), sim.slice(0, 120));
  await page.click('#submitBtn'); await page.waitForTimeout(500);
  check('submit redirects to the new issue page', /^#\/issue\//.test(await page.evaluate(() => location.hash)));
  check('report saved with status submitted + history', await page.evaluate(() => { const r = window.__DB.reports.find((x) => x.title === 'Pothole by the temple'); return r && r.status === 'submitted' && !r.is_demo && window.__DB.status_history.some((h) => h.report_id === r.id); }));
  check('issue page shows own-report note and nearby list', /You reported this issue/.test(await text('main')) && /Nearby pothole reports/.test(await text('main')));
  await go('#/mine'); await page.waitForTimeout(200);
  check('My reports lists it', /Pothole by the temple/.test(await text('main')));

  console.log('Confirmations (other resident)');
  await page.evaluate(() => document.querySelector('#logout').click()); await page.waitForTimeout(300);
  await go('#/login'); await page.fill('#email', 'a@x.com'); await page.fill('#password', 'secret1'); await page.click('#authBtn'); await page.waitForTimeout(400);
  const newId = await page.evaluate(() => window.__DB.reports.find((x) => x.title === 'Pothole by the temple').id);
  await go('#/issue/' + newId); await page.waitForSelector('[data-vote]');
  await page.click('[data-vote="still_exists"]'); await page.waitForTimeout(400);
  check('vote stored once and counts update', (await page.evaluate((id) => window.__DB.verifications.filter((v) => v.report_id === id).length, newId)) === 1 && /1<\/b> residents say it still exists|1 residents/.test((await page.content()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) || /\b1\b.*still exists/.test(await text('main')));
  await page.click('[data-vote="worse"]'); await page.waitForTimeout(400);
  check('changing vote updates, not duplicates', (await page.evaluate((id) => window.__DB.verifications.filter((v) => v.report_id === id).map((v) => v.vote), newId)).join() === 'worse');
  check('community-confirmation disclaimer shown', /not an official verification/.test(await text('main')));
  await go('#/issue/r1'); await page.waitForTimeout(250);
  check('demo reports are labelled on issue page', /Demo data/.test(await text('main')));
  await go('#/admin'); await page.waitForTimeout(250);
  check('non-admin cannot see admin page', /only for the demonstration administrator/.test(await text('main')));
  await page.click('#logout');

  console.log('Admin');
  await go('#/login'); await page.fill('#email', 'admin@x.com'); await page.fill('#password', 'x12345'); await page.click('#authBtn'); await page.waitForTimeout(500);
  check('admin link visible', /Admin/.test(await text('#nav')));
  await go('#/admin'); await page.waitForSelector('select[data-id]');
  check('admin lists clusters and all 10 reports', (await page.locator('select[data-id]').count()) === 10 && /Suggested clusters/.test(await text('main')));
  await page.selectOption('select[data-id="r2"]', 'in_progress'); await page.waitForTimeout(250);
  check('admin status change saved with history', await page.evaluate(() => window.__DB.reports.find((r) => r.id === 'r2').status === 'in_progress' && window.__DB.status_history.some((h) => h.report_id === 'r2' && h.new_status === 'in_progress' && h.updated_by === 'u-admin')));
  await go('#/issue/r2'); await page.waitForSelector('#adminStatus');
  await page.selectOption('#adminStatus', 'resolved'); await page.click('#adminSave'); await page.waitForTimeout(400);
  check('status box on issue page works and timeline shows it', /Resolved/.test(await text('.timeline')));

  console.log('Landing page radar demo');
  const lp = await ctx.newPage(); lp.on('pageerror', (e) => errors.push('landing pageerror: ' + e.message));
  await lp.route(/^https?:\/\//, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await lp.goto('file://' + ROOT + '/index.html'); await lp.waitForTimeout(300);
  const lv = async () => [await lp.innerText('#sReports'), await lp.innerText('#sConfirm'), await lp.innerText('#sOldest'), await lp.innerText('#verdict')];
  check('150 m => 5 reports, 4 confirmations, 12 d, recurring', (await lv()).join('|') === '5|4|12 d|Possible recurring issue', await lv());
  await lp.fill('#radius', '250'); await lp.dispatchEvent('#radius', 'input');
  check('250 m => 7 reports', (await lv())[0] === '7', await lv());
  await lp.fill('#radius', '50'); await lp.dispatchEvent('#radius', 'input');
  check('50 m => "Not enough reports yet"', (await lv())[3] === 'Not enough reports yet', await lv());
  check('landing links point into the app', (await lp.locator('a[href^="app/"]').count()) >= 3);
  const lpOverflow = await (async () => { await lp.setViewportSize({ width: 390, height: 800 }); return lp.evaluate(() => document.documentElement.scrollWidth - innerWidth); })();
  check('landing page has no horizontal scroll on phone width', lpOverflow <= 0, lpOverflow);
  await page.setViewportSize({ width: 390, height: 800 });
  for (const h of ['#/map', '#/pulse', '#/circles', '#/report']) { await go(h); await page.waitForTimeout(250); const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); check('app ' + h + ' no horizontal scroll at 390px', o <= 0, o); }

  console.log('\nJS errors during run:', errors.length ? errors : 'none');
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail || errors.length ? 1 : 0);
})();
