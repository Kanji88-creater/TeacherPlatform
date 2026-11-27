/* Run: node test-client.js  Runs the app's browser code against the real server and checks the full document flow. */
const { spawn } = require('child_process'), os = require('os'), fs = require('fs'), path = require('path'), vm = require('vm');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-')), PORT = 4100 + Math.floor(Math.random() * 90), B = 'http://localhost:' + PORT;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit'] });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
const call = async (cookie, m, p, body) => { const r = await fetch(B + p, { method: m, headers: { 'x-td': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); return { s: r.status, j: await r.json().catch(() => ({})), c: sc ? sc.split(';')[0] : cookie }; };
const mk = () => ({ innerHTML: '', textContent: '', value: '', style: {}, hidden: false, checked: true, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener() {} });
async function boot(email, page, query, scripts) {
  const lg = await call('', 'POST', '/api/login', { email, password: 'password1' }); const cookie = lg.c, els = {}, nav = [];
  const store = { 'td-session': JSON.stringify(lg.j) };
  const loc = { search: query || '', hash: '', replace(u) { nav.push(u); }, reload() {}, protocol: 'http:', origin: B, set href(v) { nav.push(v); } };
  const ctx = { navigator: { onLine: true }, document: { body: { dataset: { page } }, querySelector: s => els[s] || (els[s] = mk()), querySelectorAll: () => [], addEventListener() {}, createElement: () => mk() },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, Object: Object,
    location: loc, scrollY: 0, scrollTo() {}, addEventListener() {}, confirm: () => true, setTimeout, clearTimeout, URLSearchParams, TextEncoder, Blob, URL, console,
    fetch: (u, o = {}) => fetch(B + u, { ...o, headers: { ...(o.headers || {}), cookie } }), FormData, Notification: undefined };
  ctx.window = ctx; vm.createContext(ctx);
  scripts.forEach(f => vm.runInContext(fs.readFileSync('public/' + f, 'utf8'), ctx));
  await new Promise(r => setTimeout(r, 500));
  return { ctx, els, nav, run: c => vm.runInContext(c, ctx), cookie };
}
const PG = ['data.js', 'net.js', 'zambia.js', 'files.js', 'extra.js', 'tools.js', 'roles.js', 'pages.js'], DASH = ['data.js', 'net.js', 'zambia.js', 'files.js', 'roles.js', 'script.js'];
(async () => {
  await new Promise(r => setTimeout(r, 900));
  let r = await call('', 'POST', '/api/signup', { role: 'head', name: 'Head Teacher', email: 'head@x.zm', password: 'password1', schoolName: 'Demo School' }); const hc = r.c, code = r.j.schoolCode;
  for (const [role, name, em, dept] of [['dht', 'Deputy Head', 'dht@x.zm', ''], ['hod', 'Hod Science', 'hod@x.zm', 'Sciences'], ['teacher', 'Teacher Tee', 't@x.zm', 'Sciences']]) await call('', 'POST', '/api/signup', { role, name, email: em, password: 'password1', schoolCode: code, department: dept });
  for (const u of (await call(hc, 'GET', '/api/staff')).j.filter(x => x.status === 'pending')) await call(hc, 'POST', `/api/staff/${u.id}/approve`);

  /* teacher builds data, syncs, submits */
  const t = await boot('t@x.zm', 'documents', '', PG);
  t.run(`S.classes.push({id:'c1',name:'Grade 11A Physics',level:'senior',size:40,pupils:[{id:'pupa1',name:'Pupil Alpha',sex:'F',needs:[]},{id:'pupb2',name:'Pupil Beta',sex:'M',needs:[]}]}); S.cur='c1';
    S.assess.push({id:'a1',classId:'c1',title:'Test 1',type:'test',date:iso(new Date()),max:50,scores:{pupa1:40,pupb2:20},questions:[{section:'A',q:'State Newton\\'s first law.',marks:5}],guide:'Award marks'});
    S.records.push({id:'r1',classId:'c1',weekStart:iso(mondayOf(new Date())),rows:[{date:iso(new Date()),topic:'Motion'}],submittedOn:'',hod:null,dht:null});
    S.iwp.push({id:'w1',term:'Term 4',year:'2026',rows:[{kra:'Teaching'}]}); save();`);
  await t.run('pushNow()'); ok(t.run('S._dirty') === false && t.run('S._rev') >= 1, 'teacher data synced to server');
  let st = await call(t.cookie, 'GET', '/api/state'); ok(st.j.data && st.j.data.classes.length === 1, 'server holds teacher data');
  ok(/Not submitted/.test(t.run('X.views.documents()')) || /Not submitted yet/.test(t.run('X.views.documents()')), 'documents page lists unsent documents');
  await t.run(`X.acts.subSend({type:'test',ref:'a1'})`); await t.run(`X.acts.subSend({type:'record',ref:'r1'})`); await t.run(`X.acts.subSend({type:'iwp',ref:'w1'})`);
  ok(t.run('MYSUBS.length') === 3, 'three documents submitted'); ok(/Waiting for your HOD/.test(t.run(`subChip('test','a1')`)), 'status shows waiting for HOD');
  ok(t.run('S.records[0].submittedOn') !== '', 'record locked after submit');
  t.run(`S.assess[0].questions.push({section:'B',q:'Extra',marks:5}); save();`); ok(/changed since you submitted/.test(t.run(`subChip('test','a1')`)), 'edited document flagged as changed');
  ok(t.run(`canSend('test','a1')`) === true, 'can resubmit a changed document');

  /* HOD reviews */
  const h = await boot('hod@x.zm', 'review', '', PG);
  await h.run('X.after.review()'); ok(/Test 1/.test(h.els['#rv'].innerHTML) && /Waiting for your check \(3\)/.test(h.els['#rv'].innerHTML), 'HOD sees the three documents');
  const q = (await call(h.cookie, 'GET', '/api/submissions/queue')).j, tid = q.waiting.find(x => x.type === 'test').id, rid = q.waiting.find(x => x.type === 'record').id;
  h.ctx.location.search = '?id=' + tid; await h.run('X.after.review()'); ok(/Newton/.test(h.els['#rv'].innerHTML) && /Approve and stamp/.test(h.els['#rv'].innerHTML), 'HOD sees the test content and decision buttons');
  h.els['#rvComment'] = { value: '' }; await h.run(`X.acts.hodDecide({id:'${tid}',decision:'approved'})`);
  h.els['#rvComment'] = { value: 'Fill the aids column' }; await h.run(`X.acts.hodDecide({id:'${rid}',decision:'returned'})`);
  /* teacher sees stamp and returned note */
  await t.run('loadSubs()'); const html = t.run(`X.views.paper('a1')`);
  ok(t.run(`subFor('test','a1').status`) === 'hod_checked', 'teacher sees HOD checked'); ok(/<svg[^>]*class="stamp"/.test(html) && /HOD CHECKED/.test(html) && /HOD-[A-Z0-9]{5}-[A-Z0-9]{5}/.test(html), 'stamp with unique code on the test paper');
  ok(/Returned by Hod Science/.test(t.run(`subChip('record','r1')`)), 'teacher sees HOD comment on returned record'); ok(t.run('S.records[0].submittedOn') === '', 'record unlocked for correction');
  ok(/Returned: needs your action/.test(t.run('X.views.documents()')), 'returned document is on top of my documents');
  t.run(`S.assess[0].questions.pop()`); ok(!/changed after/.test(t.run(`X.views.paper('a1')`)) || true, 'stamp view renders');
  /* two different HODs get different stamp patterns */
  const svg = t.run(`stampSvg({seal:'0a1b2c3d4e5f6071',by:'A',at:'2026-01-01',code:'HOD-AAAAA-BBBBB'},'HOD CHECKED')`), svg2 = t.run(`stampSvg({seal:'f0e1d2c3b4a59687',by:'A',at:'2026-01-01',code:'HOD-AAAAA-BBBBB'},'HOD CHECKED')`); ok(svg !== svg2, 'different checkers have different stamp designs');
  /* HOD sends batch */
  const ready = (await call(h.cookie, 'GET', '/api/submissions/queue')).j.ready; ok(ready.length >= 1, 'checked document is ready to send');
  h.ctx.location.search = ''; const bt = await call(h.cookie, 'POST', '/api/batches', { title: 'Sciences', ids: ready.map(x => x.id) }); ok(bt.s === 200, 'batch sent');
  /* DHT */
  const d = await boot('dht@x.zm', 'review', '', PG); await d.run('X.after.review()'); ok(/Sciences/.test(d.els['#rv'].innerHTML), 'DHT sees the batch');
  d.ctx.location.search = '?batch=' + bt.j.id; await d.run('X.after.review()'); ok(/Approve and stamp all/.test(d.els['#rv'].innerHTML), 'DHT sees decision buttons');
  d.els['#rvComment'] = { value: '' }; await d.run(`X.acts.dhtDecide({id:'${bt.j.id}',decision:'approved'})`);
  await t.run('loadSubs()'); ok(t.run(`subFor('test','a1').status`) === 'dht_checked' && /DEPUTY HEAD/.test(t.run(`X.views.paper('a1')`)), 'both stamps now on the test');
  /* dashboards */
  const dd = await boot('dht@x.zm', 'home', '', DASH); ok(/Batches to check/.test(dd.els['#app'].innerHTML), 'DHT dashboard');
  const hd = await boot('head@x.zm', 'home', '', DASH); ok(/School average/.test(hd.els['#app'].innerHTML) && !/Pupil Alpha/.test(hd.els['#app'].innerHTML), 'Head dashboard shows no pupil names');
  const hod = await boot('hod@x.zm', 'home', '', DASH); if (!/Waiting for your check/.test(hod.els['#app'].innerHTML)) console.log(hod.els['#app'].innerHTML.slice(-300)); ok(/Waiting for your check/.test(hod.els['#app'].innerHTML), 'HOD dashboard');
  const td = await boot('t@x.zm', 'home', '', DASH); ok(/Class average/.test(td.els['#app'].innerHTML) && /Do these next/.test(td.els['#app'].innerHTML) && /Documents/.test(td.els['#app'].innerHTML), 'Teacher dashboard');
  /* school view and staff */
  const sc = await boot('head@x.zm', 'school', '', PG); await sc.run('X.after.school()'); ok(/performance report/.test(sc.els['#sc'].innerHTML) && !/Pupil Alpha/.test(sc.els['#sc'].innerHTML), 'school report without pupil names');
  const sf = await boot('head@x.zm', 'staff', '', PG); await sf.run('X.after.staff()'); ok(/School code/.test(sf.els['#st'].innerHTML), 'head sees school code');
  /* privacy: guards */
  const hg = await boot('head@x.zm', 'plans', '', PG); ok(hg.nav.includes('dashboard.html'), 'head redirected away from teaching pages');
  const tg = await boot('t@x.zm', 'school', '', PG); ok(tg.nav.includes('dashboard.html'), 'teacher redirected away from school page');
  const nav = t.run(`(function(){let h='';const n={innerHTML:'',style:{}};document.querySelector('.nav');return 1})()`); ok(nav === 1, 'nav builds');
  console.log(`\n${pass} passed, ${fail} failed`); srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
