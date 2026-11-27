/* Run: node test-api.js   Checks the sign-up roles, privacy rules, document flow, stamps and developer area. */
const { spawn } = require('child_process'), os = require('os'), fs = require('fs'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-')), PORT = 3900 + Math.floor(Math.random() * 90), B = 'http://localhost:' + PORT;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, DEV_USER: 'dev', DEV_PASS: 'devpass-123', DEV_PATH: '/_secret' }, stdio: ['ignore', 'pipe', 'inherit'] });
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log('FAIL:', m)); };
class U { constructor() { this.c = ''; } async call(m, p, body, raw) { const h = { 'x-td': '1' }; if (this.c) h.cookie = this.c; let b; if (raw) { h['content-type'] = 'image/jpeg'; b = raw; } else if (body !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(B + p, { method: m, headers: h, body: b }); const sc = r.headers.get('set-cookie'); if (sc) this.c = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; } return { s: r.status, j, r }; } }
(async () => {
  await new Promise(r => setTimeout(r, 900));
  const head = new U(), dht = new U(), hod = new U(), hod2 = new U(), t1 = new U(), t2 = new U(), anon = new U();
  let r = await head.call('POST', '/api/signup', { role: 'head', name: 'Head One', email: 'head@s.zm', password: 'password1', schoolName: 'Test Secondary' });
  ok(r.s === 200 && !r.j.pending && r.j.schoolCode, 'head signup'); const code = r.j.schoolCode;
  r = await anon.call('GET', '/api/school/' + code); ok(r.s === 200 && r.j.departments.includes('Sciences'), 'school lookup');
  const su = async (u, role, name, email, dept) => (await u.call('POST', '/api/signup', { role, name, email, password: 'password1', schoolCode: code, department: dept })).j;
  ok((await su(dht, 'dht', 'Deputy D', 'dht@s.zm')).pending, 'dht pending');
  ok((await su(hod, 'hod', 'Hod Sci', 'hod@s.zm', 'Sciences')).pending, 'hod pending'); ok((await su(hod2, 'hod', 'Hod Lang', 'hod2@s.zm', 'Languages')).pending, 'hod2 pending');
  await su(t1, 'teacher', 'Teacher One', 't1@s.zm', 'Sciences'); await su(t2, 'teacher', 'Teacher Two', 't2@s.zm', 'Languages');
  r = await t1.call('POST', '/api/login', { email: 't1@s.zm', password: 'password1' }); ok(r.s === 403, 'pending cannot log in');
  r = await t1.call('POST', '/api/signup', { role: 'teacher', name: 'X Y', email: 'bad@s.zm', password: 'password1', schoolCode: code, department: 'Nope' }); ok(r.s === 400, 'bad department rejected');
  r = await t1.call('POST', '/api/signup', { role: 'teacher', name: 'X Y', email: 'w@s.zm', password: 'short', schoolCode: code, department: 'Sciences' }); ok(r.s === 400, 'short password rejected');
  const staff = (await head.call('GET', '/api/staff')).j; ok(staff.length === 6, 'head sees all staff');
  for (const s of staff.filter(x => x.status === 'pending')) { r = await head.call('POST', `/api/staff/${s.id}/approve`); ok(r.s === 200, 'approve ' + s.email); }
  for (const [u, e] of [[dht, 'dht@s.zm'], [hod, 'hod@s.zm'], [hod2, 'hod2@s.zm'], [t1, 't1@s.zm'], [t2, 't2@s.zm']]) { u.c = ''; r = await u.call('POST', '/api/login', { email: e, password: 'password1' }); ok(r.s === 200, 'login ' + e); }
  r = await t1.call('POST', '/api/login', { email: 't1@s.zm', password: 'wrong' }); ok(r.s === 401, 'wrong password');
  r = await anon.call('GET', '/api/me'); ok(r.s === 401, 'no session');
  r = await anon.call('POST', '/api/logout'); ok(r.s === 401 || r.s === 403, 'csrf/auth on logout');
  r = await fetch(B + '/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }); ok(r.status === 403 || r.status === 401, 'PUT without header refused');
  /* private state */
  const S1 = { classes: [{ id: 'c1', name: 'Grade 11A Physics', pupils: [{ id: 'p1', name: 'Pupil A' }, { id: 'p2', name: 'Pupil B' }] }], assess: [{ id: 'a1', classId: 'c1', max: 50, date: new Date().toISOString().slice(0, 10), scores: { p1: 40, p2: 20 } }], att: { 'c1|2026-01-05': { p1: 'P', p2: 'A' } } };
  r = await t1.call('PUT', '/api/state', { rev: 0, data: S1 }); ok(r.s === 200 && r.j.rev === 1, 'state save');
  r = await t1.call('PUT', '/api/state', { rev: 0, data: S1 }); ok(r.s === 409, 'state conflict detected');
  r = await t2.call('GET', '/api/state'); ok(r.j.data === null, 'teacher 2 cannot see teacher 1 state');
  r = await head.call('GET', '/api/state'); ok(r.s === 403, 'head has no teaching state access');
  r = await dht.call('GET', '/api/state'); ok(r.s === 403, 'dht has no teaching state access');
  /* photos are private */
  r = await t1.call('PUT', '/api/photos/p1', undefined, Buffer.from([255, 216, 255, 217])); ok(r.s === 200, 'photo upload'); r = await t1.call('GET', '/api/photos/p1'); ok(r.s === 200, 'owner reads photo'); r = await t2.call('GET', '/api/photos/p1'); ok(r.s === 404, 'other teacher cannot read photo'); r = await head.call('GET', '/api/photos/p1'); ok(r.s === 403, 'head cannot read photos');
  /* document flow */
  r = await t1.call('POST', '/api/submissions', { type: 'test', refId: 'a1', title: 'Test 1', payload: { q: [1, 2] } }); ok(r.s === 200 && r.j.status === 'submitted', 'teacher submits'); const sid = r.j.id;
  r = await hod2.call('GET', '/api/submissions/' + sid); ok(r.s === 403, 'other department HOD cannot open');
  r = await t2.call('GET', '/api/submissions/' + sid); ok(r.s === 403, 'other teacher cannot open');
  r = await head.call('GET', '/api/submissions/' + sid); ok(r.s === 403, 'head cannot read document content');
  r = await hod.call('GET', '/api/submissions/queue'); ok(r.j.waiting.length === 1, 'HOD sees waiting doc');
  r = await hod2.call('POST', `/api/submissions/${sid}/check`, { decision: 'approved' }); ok(r.s === 403, 'other HOD cannot check');
  r = await t1.call('POST', `/api/submissions/${sid}/check`, { decision: 'approved' }); ok(r.s === 403, 'teacher cannot check own');
  r = await hod.call('POST', `/api/submissions/${sid}/check`, { decision: 'returned', comment: '' }); ok(r.s === 400, 'return needs a comment');
  r = await hod.call('POST', `/api/submissions/${sid}/check`, { decision: 'returned', comment: 'Add marking guide' }); ok(r.s === 200 && r.j.status === 'returned', 'HOD returns');
  r = await t1.call('POST', '/api/submissions', { type: 'test', refId: 'a1', title: 'Test 1', payload: { q: [1, 2], guide: 'x' } }); ok(r.j.version === 2, 'resubmission is version 2'); const sid2 = r.j.id;
  r = await hod.call('POST', `/api/submissions/${sid2}/check`, { decision: 'approved', comment: 'Good' }); ok(r.s === 200 && r.j.status === 'hod_checked' && /^HOD-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(r.j.hod.code), 'HOD approves with unique code'); const hcode = r.j.hod.code;
  r = await t1.call('GET', '/api/submissions/mine'); ok(r.j.length === 1 && r.j[0].hod.code === hcode && r.j[0].hod.seal, 'teacher sees HOD stamp info');
  r = await anon.call('GET', '/api/verify/' + hcode); ok(r.j.valid === true && r.j.checkedBy === undefined && r.j.by === 'Hod Sci', 'public verification valid'); ok(!JSON.stringify(r.j).includes('Teacher One'), 'verification does not reveal the teacher');
  r = await anon.call('GET', '/api/verify/HOD-AAAAA-BBBBB'); ok(r.j.valid === false, 'fake code invalid');
  /* hod -> dht */
  r = await dht.call('GET', '/api/batches'); ok(r.j.length === 0, 'dht sees no batches yet');
  r = await hod.call('POST', '/api/batches', { title: 'Sciences week 1', ids: [sid] }); ok(r.s === 400, 'cannot batch superseded/returned doc');
  r = await hod.call('POST', '/api/batches', { title: 'Sciences week 1', ids: [sid2] }); ok(r.s === 200, 'HOD sends batch'); const bid = r.j.id;
  r = await hod2.call('GET', '/api/batches/' + bid); ok(r.s === 403, 'other HOD cannot see batch');
  r = await dht.call('GET', '/api/batches/' + bid); ok(r.s === 200 && r.j.documents.length === 1, 'DHT sees batch');
  r = await dht.call('GET', '/api/submissions/' + sid2); ok(r.s === 200 && r.j.payload.guide === 'x', 'DHT can open batched doc');
  r = await t1.call('POST', `/api/batches/${bid}/check`, { decision: 'approved' }); ok(r.s === 403, 'teacher cannot DHT-check');
  r = await dht.call('POST', `/api/batches/${bid}/check`, { decision: 'approved', comment: 'Seen' }); ok(r.s === 200, 'DHT approves');
  r = await t1.call('GET', '/api/submissions/mine'); ok(r.j[0].status === 'dht_checked' && /^DHT-/.test(r.j[0].dht.code), 'teacher sees DHT stamp'); const dcode = r.j[0].dht.code;
  r = await anon.call('GET', '/api/verify/' + dcode); ok(r.j.valid && r.j.kind.includes('Deputy'), 'DHT stamp verifies');
  /* performance and overview */
  r = await head.call('GET', '/api/performance'); ok(r.s === 200 && r.j.school.pupils === 2 && r.j.school.avg === 60, 'head school performance'); ok(!JSON.stringify(r.j).includes('Pupil A'), 'no pupil names in performance');
  r = await hod.call('GET', '/api/performance'); ok(r.j.classes.length === 1, 'HOD sees own department only'); r = await hod2.call('GET', '/api/performance'); ok(r.j.classes.length === 0, 'other HOD sees nothing of Sciences');
  r = await t1.call('GET', '/api/performance'); ok(r.s === 403, 'teacher cannot see school performance');
  r = await head.call('GET', '/api/overview'); ok(r.s === 200 && r.j.byDepartment.some(d => d.dht_checked === 1), 'overview counts');
  /* staff privacy */
  r = await hod.call('GET', '/api/staff'); ok(r.j.length === 1 && r.j[0].role === 'teacher', 'HOD sees only own teachers'); r = await t1.call('GET', '/api/staff'); ok(r.s === 403, 'teacher cannot list staff');
  r = await hod.call('POST', `/api/staff/${staff.find(s => s.email === 't2@s.zm').id}/disable`); ok(r.s === 403, 'HOD cannot manage other department');
  /* developer area hidden */
  r = await anon.call('GET', '/_dev'); ok(r.s === 404, 'guessable dev path is 404'); r = await anon.call('GET', '/api/dev/schemes'); ok(r.s === 404, 'old dev api absent');
  r = await anon.call('GET', '/_secret'); ok(r.s === 200, 'dev page on secret path'); r = await anon.call('GET', '/_secret/api/schemes'); ok(r.s === 401, 'dev api needs login');
  r = await t1.call('GET', '/_secret/api/schemes'); ok(r.s === 401, 'normal user session is not dev access');
  r = await anon.call('POST', '/_secret/api/login', { user: 'dev', pass: 'bad' }); ok(r.s === 401, 'wrong dev login');
  const dv = new U(); r = await dv.call('POST', '/_secret/api/login', { user: 'dev', pass: 'devpass-123' }); ok(r.s === 200, 'dev login');
  r = await dv.call('POST', '/_secret/api/schemes', { schemes: [{ title: 'Physics G11 T1', grade: '11', subject: 'Physics', term: 'Term 1', rows: [{ week: 1, topic: 'Motion' }] }] }); ok(r.j.added === 1, 'dev adds scheme');
  r = await dv.call('POST', '/_secret/api/files', { title: 'Scheme PDF', name: 'phys.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-test').toString('base64') }); ok(r.s === 200, 'dev uploads file'); const fid = r.j.id;
  r = await t1.call('GET', '/api/schemes'); ok(r.j.schemes.length === 1 && r.j.files.length === 1, 'teacher receives developer schemes'); r = await t1.call('GET', '/api/scheme-files/' + fid); ok(r.s === 200, 'teacher downloads scheme file');
  r = await anon.call('GET', '/api/schemes'); ok(r.s === 401, 'schemes need sign in');
  r = await anon.call('GET', '/developer.html'); ok(r.s === 404, 'no developer.html in public site');
  /* headers and static */
  r = await anon.call('GET', '/'); ok(r.r.headers.get('content-security-policy').includes("script-src 'self'") && r.r.headers.get('x-frame-options') === 'DENY', 'security headers');
  r = await anon.call('GET', '/../server.js'); ok(r.s === 404 || (typeof r.j === 'string' && !r.j.includes('DatabaseSync')), 'no path traversal'); r = await anon.call('GET', '/%2e%2e/server.js'); ok(!(typeof r.j === 'string' && r.j.includes('DatabaseSync')), 'no encoded traversal');
  /* account */
  r = await t2.call('GET', '/api/me/export'); ok(r.s === 200, 'export'); r = await t2.call('POST', '/api/me/delete', { password: 'password1' }); ok(r.s === 200, 'delete account'); r = await t2.call('GET', '/api/me'); ok(r.s === 401, 'session gone after delete');
  r = await head.call('POST', '/api/me/delete', { password: 'password1' }); ok(r.s === 400, 'head cannot self-delete');
  console.log(`\n${pass} passed, ${fail} failed`); srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
