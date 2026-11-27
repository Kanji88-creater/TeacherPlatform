'use strict';
/* Teacher Platform server. Node 22.13+ only, no installs needed (uses built-in SQLite).
   Serves the app from /public and the API under /api. See README.md. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public'), DEVDIR = path.join(__dirname, 'dev');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'school.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS schools(id TEXT PRIMARY KEY, name TEXT, code TEXT UNIQUE, departments TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, school_id TEXT, role TEXT, name TEXT, email TEXT UNIQUE, salt TEXT, pw TEXT, department TEXT, status TEXT, seal TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY, user_id TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS states(user_id TEXT PRIMARY KEY, rev INTEGER, json TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS photos(user_id TEXT, pid TEXT, mime TEXT, data BLOB, PRIMARY KEY(user_id, pid));
CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY, school_id TEXT, owner_id TEXT, department TEXT, type TEXT, ref_id TEXT, title TEXT, version INTEGER, payload TEXT, hash TEXT, status TEXT, submitted_at TEXT,
  hod_by TEXT, hod_at TEXT, hod_decision TEXT, hod_comment TEXT, hod_code TEXT, batch_id TEXT, dht_by TEXT, dht_at TEXT, dht_decision TEXT, dht_comment TEXT, dht_code TEXT);
CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, school_id TEXT, department TEXT, hod_id TEXT, title TEXT, status TEXT, created TEXT, dht_by TEXT, dht_at TEXT, dht_decision TEXT, dht_comment TEXT, dht_code TEXT);
CREATE TABLE IF NOT EXISTS schemes(id TEXT PRIMARY KEY, json TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS scheme_files(id TEXT PRIMARY KEY, title TEXT, grade TEXT, subject TEXT, term TEXT, name TEXT, mime TEXT, data BLOB, created TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, user_id TEXT, action TEXT, target TEXT);`);

/* ---------- helpers ---------- */
const all = (sql, ...p) => db.prepare(sql).all(...p), one = (sql, ...p) => db.prepare(sql).get(...p), run = (sql, ...p) => db.prepare(sql).run(...p);
const now = () => new Date().toISOString(), uid = () => crypto.randomUUID(), sha = s => crypto.createHash('sha256').update(s).digest('hex');
const meta = (k, gen) => { const r = one('SELECT v FROM meta WHERE k=?', k); if (r) return r.v; const v = gen(); run('INSERT INTO meta VALUES(?,?)', k, v); return v; };
const SECRET = process.env.STAMP_SECRET || meta('stamp_secret', () => crypto.randomBytes(32).toString('hex'));
const DEV_PATH = (process.env.DEV_PATH || '/_dev-' + meta('dev_path', () => crypto.randomBytes(6).toString('hex'))).replace(/\/+$/, '');
const DEV_USER = process.env.DEV_USER || '', DEV_PASS = process.env.DEV_PASS || '';
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const bad = (s, m) => { throw new HttpError(s, m); };
const audit = (u, action, target) => run('INSERT INTO audit(ts,user_id,action,target) VALUES(?,?,?,?)', now(), u ? u.id : null, action, target || '');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const B32 = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const mkCode = (prefix, ...parts) => { const h = crypto.createHmac('sha256', SECRET).update(parts.join('|')).digest(); let s = ''; for (let i = 0; i < 10; i++) s += B32[h[i] % 32]; return `${prefix}-${s.slice(0, 5)}-${s.slice(5)}`; };
const DEFAULT_DEPTS = ['Mathematics', 'Sciences', 'Languages', 'Social Sciences', 'Business and Practical Subjects', 'Creative and Expressive Arts', 'Primary Section'];
const ROLES = ['head', 'dht', 'hod', 'teacher'], TEACHING = ['teacher', 'hod'];
const cookieOf = (req, n) => { const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(n + '=')); return m ? decodeURIComponent(m.slice(n.length + 1)) : ''; };
const limits = new Map();
function limit(key, max, ms) { const t = Date.now(); let r = limits.get(key); if (!r || r.until < t) r = { n: 0, until: t + ms }; r.n++; limits.set(key, r); if (r.n > max) bad(429, 'Too many attempts. Please wait and try again.'); }
const clearLimit = key => limits.delete(key);
const str = (v, min, max, label) => { v = String(v == null ? '' : v).trim(); if (v.length < min || v.length > max) bad(400, label + ' is required' + (max < 500 ? ' (up to ' + max + ' characters)' : '')); return v; };

/* ---------- sessions ---------- */
function startSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url'), exp = Date.now() + 30 * 864e5;
  run('INSERT INTO sessions VALUES(?,?,?)', sha(token), userId, exp);
  const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}`);
}
function sessionUser(req) {
  const t = cookieOf(req, 'sid'); if (!t) return null;
  const s = one('SELECT * FROM sessions WHERE th=?', sha(t)); if (!s || s.expires < Date.now()) return null;
  const u = one('SELECT * FROM users WHERE id=?', s.user_id); return u && u.status === 'active' ? u : null;
}
const pub = u => { const s = one('SELECT * FROM schools WHERE id=?', u.school_id); return { id: u.id, name: u.name, email: u.email, role: u.role, department: u.department || '', seal: u.seal, school: { id: s.id, name: s.name, departments: JSON.parse(s.departments), code: ['head', 'dht'].includes(u.role) ? s.code : undefined } }; };

/* ---------- performance maths (numbers only, no pupil names leave the teacher's state) ---------- */
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function classStats(c, assess, att) {
  const as = (assess || []).filter(a => a.classId === c.id && a.max), pup = [];
  (c.pupils || []).forEach(p => { const v = as.filter(a => a.scores && a.scores[p.id] != null).map(a => a.scores[p.id] / a.max * 100); if (v.length) pup.push(mean(v)); });
  const per = as.map(a => { const v = Object.values(a.scores || {}).map(s => s / a.max * 100); return v.length ? { date: a.date, avg: Math.round(mean(v)) } : null; }).filter(Boolean).sort((x, y) => x.date.localeCompare(y.date));
  let pr = 0, ab = 0; Object.keys(att || {}).forEach(k => { if (k.startsWith(c.id + '|')) Object.values(att[k]).forEach(v => { if (v === 'P') pr++; if (v === 'A') ab++; }); });
  const y = new Date().getFullYear(), terms = [0, 1, 2].map(t => { const v = per.filter(p => { const d = new Date(p.date + 'T00:00'); return d.getFullYear() === y && Math.floor(d.getMonth() / 4) === t; }).map(p => p.avg); return v.length ? Math.round(mean(v)) : null; });
  return { pup, avg: pup.length ? Math.round(mean(pup)) : null, pupils: (c.pupils || []).length, strong: pup.filter(v => v >= 70).length, watch: pup.filter(v => v >= 50 && v < 70).length, support: pup.filter(v => v < 50).length, present: pr, absent: ab, trend: per.slice(-8), terms };
}
function performance(user) {
  const users = all("SELECT * FROM users WHERE school_id=? AND role IN ('teacher','hod') AND status='active'", user.school_id).filter(u => user.role !== 'hod' || u.department === user.department);
  const classes = [], depts = {}; let allPup = [], present = 0, absent = 0;
  users.forEach(u => {
    const st = one('SELECT json FROM states WHERE user_id=?', u.id); if (!st) return;
    let S; try { S = JSON.parse(st.json); } catch (e) { return; }
    (S.classes || []).forEach(c => {
      const s = classStats(c, S.assess, S.att), d = depts[u.department] = depts[u.department] || { department: u.department, teachers: new Set(), classes: 0, pupils: 0, pup: [] };
      d.teachers.add(u.id); d.classes++; d.pupils += s.pupils; d.pup = d.pup.concat(s.pup); allPup = allPup.concat(s.pup); present += s.present; absent += s.absent;
      classes.push({ teacher: u.name, department: u.department, name: c.name, pupils: s.pupils, avg: s.avg, strong: s.strong, watch: s.watch, support: s.support, attendance: s.present + s.absent ? Math.round(s.present / (s.present + s.absent) * 100) : null, trend: s.trend, terms: s.terms });
    });
  });
  const rate = a => a.length ? Math.round(mean(a)) : null;
  return { school: { pupils: classes.reduce((a, c) => a + c.pupils, 0), classes: classes.length, avg: rate(allPup), strong: allPup.filter(v => v >= 70).length, watch: allPup.filter(v => v >= 50 && v < 70).length, support: allPup.filter(v => v < 50).length, attendance: present + absent ? Math.round(present / (present + absent) * 100) : null },
    departments: Object.values(depts).map(d => ({ department: d.department, teachers: d.teachers.size, classes: d.classes, pupils: d.pupils, avg: rate(d.pup) })), classes };
}

/* ---------- submissions ---------- */
const subOut = (s, withOwner) => ({ id: s.id, type: s.type, refId: s.ref_id, title: s.title, version: s.version, status: s.status, submittedAt: s.submitted_at, department: s.department,
  owner: withOwner ? (one('SELECT name FROM users WHERE id=?', s.owner_id) || {}).name : undefined,
  hod: s.hod_by ? { decision: s.hod_decision, comment: s.hod_comment, code: s.hod_code, at: s.hod_at, ...checker(s.hod_by, s) } : null,
  dht: s.dht_by ? { decision: s.dht_decision, comment: s.dht_comment, code: s.dht_code, at: s.dht_at, ...checker(s.dht_by, s) } : null, batchId: s.batch_id });
const checker = (id, s) => { const u = one('SELECT name, role, seal FROM users WHERE id=?', id) || {}; const sc = one('SELECT name FROM schools WHERE id=?', s.school_id) || {}; return { by: u.name, role: u.role, seal: u.seal, school: sc.name }; };
const subRow = id => one('SELECT * FROM submissions WHERE id=?', id) || bad(404, 'Not found');

/* ---------- API routes ---------- */
const routes = [];
const on = (method, pattern, opts, fn) => routes.push({ method, re: new RegExp('^' + pattern + '$'), opts, fn });

on('GET', '/api/school/([A-Z0-9]{4,10})', { auth: false }, c => { limit('sc' + c.ip, 60, 6e4); const s = one('SELECT name, departments FROM schools WHERE code=?', c.m[1]); if (!s) bad(404, 'School code not found'); return { name: s.name, departments: JSON.parse(s.departments) }; });

on('POST', '/api/signup', { auth: false }, c => {
  limit('su' + c.ip, 15, 36e5);
  const b = c.body, role = b.role; if (!ROLES.includes(role)) bad(400, 'Choose a role');
  const name = str(b.name, 2, 80, 'Name'), email = str(b.email, 5, 120, 'Email').toLowerCase(), pw = String(b.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad(400, 'Enter a valid email');
  if (pw.length < 8) bad(400, 'Password must be at least 8 characters');
  if (one('SELECT 1 FROM users WHERE email=?', email)) bad(409, 'An account with this email already exists');
  let school, status = 'pending', dept = '';
  if (role === 'head') {
    const sname = str(b.schoolName, 3, 120, 'School name'); let code; do { code = Array.from(crypto.randomBytes(6), x => B32[x % 32]).join(''); } while (one('SELECT 1 FROM schools WHERE code=?', code));
    let depts = Array.isArray(b.departments) ? b.departments.map(d => String(d).trim()).filter(Boolean).slice(0, 20) : []; if (!depts.length) depts = DEFAULT_DEPTS;
    school = { id: uid(), name: sname, code }; run('INSERT INTO schools VALUES(?,?,?,?,?)', school.id, sname, code, JSON.stringify(depts), now()); status = 'active';
  } else {
    school = one('SELECT * FROM schools WHERE code=?', String(b.schoolCode || '').toUpperCase().trim()) || bad(404, 'School code not found. Ask your Head teacher for it.');
    if (['hod', 'teacher'].includes(role)) { dept = String(b.department || ''); if (!JSON.parse(school.departments).includes(dept)) bad(400, 'Choose your department'); }
  }
  const user = { id: uid(), salt: crypto.randomBytes(16).toString('hex') };
  run('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?,?)', user.id, school.id, role, name, email, user.salt, hashPw(pw, user.salt), dept, status, crypto.randomBytes(8).toString('hex'), now());
  audit({ id: user.id }, 'signup', role);
  if (status === 'active') { startSession(c.res, c.req, user.id); return { ok: true, pending: false, schoolCode: school.code }; }
  return { ok: true, pending: true };
});

on('POST', '/api/login', { auth: false }, c => {
  const email = String(c.body.email || '').toLowerCase().trim(), key = 'li' + c.ip + email; limit(key, 6, 9e5);
  const u = one('SELECT * FROM users WHERE email=?', email);
  const okPw = u ? safeEq(hashPw(String(c.body.password || ''), u.salt), u.pw) : (hashPw('x', 'y'), false);
  if (!u || !okPw) bad(401, 'Email or password is incorrect');
  if (u.status === 'pending') bad(403, 'Your account is waiting for approval by your school.');
  if (u.status !== 'active') bad(403, 'This account is not active.');
  clearLimit(key); startSession(c.res, c.req, u.id); audit(u, 'login'); return pub(u);
});
on('POST', '/api/logout', { auth: true }, c => { run('DELETE FROM sessions WHERE th=?', sha(cookieOf(c.req, 'sid'))); c.res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; });
on('GET', '/api/me', { auth: true }, c => pub(c.user));
on('POST', '/api/me/password', { auth: true }, c => {
  const u = c.user; if (!safeEq(hashPw(String(c.body.old || ''), u.salt), u.pw)) bad(403, 'Current password is incorrect');
  const nw = String(c.body.new || ''); if (nw.length < 8) bad(400, 'New password must be at least 8 characters');
  const salt = crypto.randomBytes(16).toString('hex'); run('UPDATE users SET salt=?, pw=? WHERE id=?', salt, hashPw(nw, salt), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); startSession(c.res, c.req, u.id); audit(u, 'password'); return { ok: true };
});
on('GET', '/api/me/export', { auth: true }, c => { const u = c.user, st = one('SELECT json FROM states WHERE user_id=?', u.id); audit(u, 'export'); return { profile: pub(u), data: st ? JSON.parse(st.json) : null, submissions: all('SELECT id,type,title,version,status,submitted_at FROM submissions WHERE owner_id=?', u.id) }; });
on('POST', '/api/me/delete', { auth: true }, c => {
  const u = c.user; if (!safeEq(hashPw(String(c.body.password || ''), u.salt), u.pw)) bad(403, 'Password is incorrect');
  if (u.role === 'head') bad(400, 'The Head teacher account cannot be deleted here because it owns the school. Contact the developer.');
  ['states', 'photos', 'sessions'].forEach(t => run(`DELETE FROM ${t} WHERE user_id=?`, u.id)); run('DELETE FROM submissions WHERE owner_id=?', u.id); run('DELETE FROM users WHERE id=?', u.id);
  audit(null, 'account-deleted', u.id); c.res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true };
});

/* teacher's own data */
on('GET', '/api/state', { roles: TEACHING }, c => { const s = one('SELECT rev, json FROM states WHERE user_id=?', c.user.id); return s ? { rev: s.rev, data: JSON.parse(s.json) } : { rev: 0, data: null }; });
on('PUT', '/api/state', { roles: TEACHING, limit: 6e6 }, c => {
  const cur = one('SELECT rev FROM states WHERE user_id=?', c.user.id), rev = cur ? cur.rev : 0;
  if (typeof c.body.data !== 'object' || !c.body.data) bad(400, 'No data');
  if (+c.body.rev !== rev) { c.status = 409; return { conflict: true, rev }; }
  run('INSERT INTO states VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET rev=excluded.rev, json=excluded.json, updated=excluded.updated', c.user.id, rev + 1, JSON.stringify(c.body.data), now()); return { rev: rev + 1 };
});
const PID = '([a-z0-9]{1,40})';
on('GET', '/api/photos/' + PID, { roles: TEACHING }, c => { const p = one('SELECT mime, data FROM photos WHERE user_id=? AND pid=?', c.user.id, c.m[1]); if (!p) bad(404, 'No photo'); return { raw: Buffer.from(p.data), mime: p.mime }; });
on('PUT', '/api/photos/' + PID, { roles: TEACHING, raw: true, limit: 6e5 }, c => {
  const mime = String(c.req.headers['content-type'] || ''); if (!/^image\/(jpeg|png|webp)$/.test(mime)) bad(400, 'Photo must be JPEG, PNG or WebP');
  run('INSERT INTO photos VALUES(?,?,?,?) ON CONFLICT(user_id,pid) DO UPDATE SET mime=excluded.mime, data=excluded.data', c.user.id, c.m[1], mime, c.body); return { ok: true };
});
on('DELETE', '/api/photos/' + PID, { roles: TEACHING }, c => { run('DELETE FROM photos WHERE user_id=? AND pid=?', c.user.id, c.m[1]); return { ok: true }; });

/* submissions: teacher -> HOD -> (batch) -> DHT */
const TYPES = ['test', 'record', 'iwp', 'register', 'plan', 'scheme'];
on('POST', '/api/submissions', { roles: TEACHING, limit: 3e6 }, c => {
  const b = c.body, type = b.type; if (!TYPES.includes(type)) bad(400, 'Unknown document type');
  const title = str(b.title, 2, 160, 'Title'), ref = str(b.refId, 1, 80, 'Document'), payload = JSON.stringify(b.payload || {});
  const prev = one('SELECT MAX(version) v FROM submissions WHERE owner_id=? AND type=? AND ref_id=?', c.user.id, type, ref);
  run("UPDATE submissions SET status='superseded' WHERE owner_id=? AND type=? AND ref_id=? AND status IN ('submitted','returned')", c.user.id, type, ref);
  const id = uid(); run('INSERT INTO submissions(id,school_id,owner_id,department,type,ref_id,title,version,payload,hash,status,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, c.user.school_id, c.user.id, c.user.department, type, ref, title, ((prev && prev.v) || 0) + 1, payload, sha(payload), 'submitted', now());
  audit(c.user, 'submit', id); return subOut(subRow(id));
});
on('GET', '/api/submissions/mine', { roles: TEACHING }, c => all("SELECT * FROM submissions WHERE owner_id=? AND status!='superseded' ORDER BY submitted_at DESC", c.user.id).map(s => subOut(s)));
on('GET', '/api/submissions/queue', { roles: ['hod'] }, c => {
  const rows = all("SELECT * FROM submissions WHERE school_id=? AND department=? AND status!='superseded' ORDER BY submitted_at DESC", c.user.school_id, c.user.department).map(s => subOut(s, true));
  const own = id => (subRow(id).owner_id === c.user.id);
  return { waiting: rows.filter(s => s.status === 'submitted' && !own(s.id)), ready: rows.filter(s => (s.status === 'hod_checked' || (s.status === 'submitted' && own(s.id))) && !s.batchId), sent: rows.filter(s => ['batched', 'dht_checked'].includes(s.status)), returned: rows.filter(s => s.status === 'returned') };
});
on('GET', '/api/submissions/' + '([0-9a-f-]{36})', { auth: true }, c => {
  const s = subRow(c.m[1]), u = c.user; let ok = s.owner_id === u.id || (u.role === 'hod' && s.department === u.department && s.school_id === u.school_id);
  if (!ok && u.role === 'dht' && s.school_id === u.school_id && s.batch_id) ok = true;
  if (!ok) bad(403, 'You cannot open this document');
  if (s.owner_id !== u.id) audit(u, 'view', s.id);
  return { ...subOut(s, true), payload: JSON.parse(s.payload) };
});
on('POST', '/api/submissions/' + '([0-9a-f-]{36})' + '/check', { roles: ['hod'] }, c => {
  const s = subRow(c.m[1]), u = c.user; if (s.school_id !== u.school_id || s.department !== u.department) bad(403, 'Not in your department');
  if (s.owner_id === u.id) bad(400, 'You cannot check your own document. It goes to the Deputy Head.'); if (s.status !== 'submitted') bad(409, 'This document is not waiting for a check');
  const dec = c.body.decision; if (!['approved', 'returned'].includes(dec)) bad(400, 'Choose approve or return'); const comment = String(c.body.comment || '').trim().slice(0, 800); if (dec === 'returned' && !comment) bad(400, 'Say what must be corrected');
  const at = now(), code = dec === 'approved' ? mkCode('HOD', 'hod', s.id, s.hash, u.id, at) : null;
  run('UPDATE submissions SET status=?, hod_by=?, hod_at=?, hod_decision=?, hod_comment=?, hod_code=? WHERE id=?', dec === 'approved' ? 'hod_checked' : 'returned', u.id, at, dec, comment, code, s.id); audit(u, 'hod-' + dec, s.id); return subOut(subRow(s.id), true);
});
on('POST', '/api/batches', { roles: ['hod'] }, c => {
  const u = c.user, ids = Array.isArray(c.body.ids) ? c.body.ids : []; if (!ids.length) bad(400, 'Choose at least one document');
  const subs = ids.map(subRow); subs.forEach(s => { const mine = s.owner_id === u.id && s.status === 'submitted'; if (s.department !== u.department || s.school_id !== u.school_id || s.batch_id || !(s.status === 'hod_checked' || mine)) bad(400, 'Only documents you have checked (or your own) can be sent to the Deputy Head'); });
  const id = uid(); run('INSERT INTO batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, u.school_id, u.department, u.id, str(c.body.title || u.department + ' documents', 2, 160, 'Title'), 'submitted', now(), null, null, null, null, null);
  subs.forEach(s => run("UPDATE submissions SET batch_id=?, status='batched' WHERE id=?", id, s.id)); audit(u, 'batch', id); return { id };
});
const batchOut = b => ({ id: b.id, title: b.title, department: b.department, status: b.status, created: b.created, hod: (one('SELECT name FROM users WHERE id=?', b.hod_id) || {}).name, count: one('SELECT COUNT(*) n FROM submissions WHERE batch_id=?', b.id).n,
  dht: b.dht_by ? { decision: b.dht_decision, comment: b.dht_comment, code: b.dht_code, at: b.dht_at, ...checker(b.dht_by, b) } : null });
on('GET', '/api/batches', { roles: ['hod', 'dht', 'head'] }, c => all("SELECT * FROM batches WHERE school_id=? ORDER BY created DESC", c.user.school_id).filter(b => c.user.role !== 'hod' || b.department === c.user.department).map(batchOut));
on('GET', '/api/batches/' + '([0-9a-f-]{36})', { roles: ['hod', 'dht'] }, c => {
  const b = one('SELECT * FROM batches WHERE id=?', c.m[1]) || bad(404, 'Not found'); if (b.school_id !== c.user.school_id || (c.user.role === 'hod' && b.department !== c.user.department)) bad(403, 'No access');
  return { ...batchOut(b), documents: all('SELECT * FROM submissions WHERE batch_id=? ORDER BY title', b.id).map(s => subOut(s, true)) };
});
on('POST', '/api/batches/' + '([0-9a-f-]{36})' + '/check', { roles: ['dht'] }, c => {
  const b = one('SELECT * FROM batches WHERE id=?', c.m[1]) || bad(404, 'Not found'); if (b.school_id !== c.user.school_id) bad(403, 'No access'); if (b.status !== 'submitted') bad(409, 'This batch has already been checked');
  const dec = c.body.decision; if (!['approved', 'returned'].includes(dec)) bad(400, 'Choose approve or return'); const comment = String(c.body.comment || '').trim().slice(0, 800); if (dec === 'returned' && !comment) bad(400, 'Say what must be corrected');
  const at = now(), u = c.user;
  if (dec === 'approved') { all('SELECT * FROM submissions WHERE batch_id=?', b.id).forEach(s => run("UPDATE submissions SET status='dht_checked', dht_by=?, dht_at=?, dht_decision='approved', dht_comment=?, dht_code=? WHERE id=?", u.id, at, comment, mkCode('DHT', 'dht', s.id, s.hash, u.id, at), s.id)); }
  else run("UPDATE submissions SET status=CASE WHEN hod_decision='approved' THEN 'hod_checked' ELSE 'submitted' END, batch_id=NULL, dht_comment=? WHERE batch_id=?", comment, b.id);
  run('UPDATE batches SET status=?, dht_by=?, dht_at=?, dht_decision=?, dht_comment=?, dht_code=? WHERE id=?', dec === 'approved' ? 'approved' : 'returned', u.id, at, dec, comment, dec === 'approved' ? mkCode('DHT', 'batch', b.id, u.id, at) : null, b.id); audit(u, 'dht-' + dec, b.id); return { ok: true };
});
on('GET', '/api/overview', { roles: ['hod', 'dht', 'head'] }, c => {
  const u = c.user, rows = all("SELECT department, status, COUNT(*) n FROM submissions WHERE school_id=? AND status!='superseded' GROUP BY department, status", u.school_id).filter(r => u.role !== 'hod' || r.department === u.department);
  const by = {}; rows.forEach(r => { const d = by[r.department] = by[r.department] || { department: r.department }; d[r.status] = r.n; });
  const oldest = one("SELECT MIN(submitted_at) t FROM submissions WHERE school_id=? AND status='submitted'", u.school_id).t;
  return { byDepartment: Object.values(by), oldestWaiting: oldest };
});
on('GET', '/api/performance', { roles: ['hod', 'dht', 'head'] }, c => performance(c.user));

/* staff and approvals */
const staffOut = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, status: u.status });
on('GET', '/api/staff', { roles: ['head', 'dht', 'hod'] }, c => all('SELECT * FROM users WHERE school_id=? ORDER BY role, name', c.user.school_id).filter(u => c.user.role !== 'hod' || (u.role === 'teacher' && u.department === c.user.department)).map(staffOut));
const staffAct = status => c => {
  const t = one('SELECT * FROM users WHERE id=?', c.m[1]) || bad(404, 'Not found'), u = c.user; if (t.school_id !== u.school_id || t.id === u.id) bad(403, 'No access');
  const allowed = u.role === 'head' || (u.role === 'hod' && t.role === 'teacher' && t.department === u.department); if (!allowed) bad(403, 'You cannot manage this account');
  if (t.role === 'head') bad(403, 'No access'); run('UPDATE users SET status=? WHERE id=?', status, t.id); if (status !== 'active') run('DELETE FROM sessions WHERE user_id=?', t.id); audit(u, 'staff-' + status, t.id); return { ok: true };
};
on('POST', '/api/staff/' + '([0-9a-f-]{36})' + '/approve', { roles: ['head', 'hod'] }, staffAct('active'));
on('POST', '/api/staff/' + '([0-9a-f-]{36})' + '/disable', { roles: ['head', 'hod'] }, staffAct('disabled'));
on('PUT', '/api/school/departments', { roles: ['head'] }, c => { const d = (Array.isArray(c.body.departments) ? c.body.departments : []).map(x => String(x).trim()).filter(Boolean).slice(0, 20); if (!d.length) bad(400, 'Add at least one department'); run('UPDATE schools SET departments=? WHERE id=?', JSON.stringify(d), c.user.school_id); return { departments: d }; });

/* public stamp verification */
on('GET', '/api/verify/([A-Z]{3}-[A-Z0-9]{5}-[A-Z0-9]{5})', { auth: false }, c => {
  limit('vf' + c.ip, 60, 6e4); const code = c.m[1];
  const s = one('SELECT * FROM submissions WHERE hod_code=? OR dht_code=?', code, code);
  if (s) { const isH = s.hod_code === code, by = isH ? s.hod_by : s.dht_by, at = isH ? s.hod_at : s.dht_at, expect = isH ? mkCode('HOD', 'hod', s.id, s.hash, by, at) : mkCode('DHT', 'dht', s.id, s.hash, by, at);
    const intact = sha(s.payload) === s.hash && expect === code; return { valid: intact, kind: isH ? 'Head of Department check' : 'Deputy Head Teacher check', docType: s.type, title: s.title, version: s.version, ...checker(by, s), date: at };
  }
  const b = one('SELECT * FROM batches WHERE dht_code=?', code);
  if (b && b.dht_by) return { valid: mkCode('DHT', 'batch', b.id, b.dht_by, b.dht_at) === code, kind: 'Deputy Head Teacher check of a department batch', docType: 'batch', title: b.title, ...checker(b.dht_by, b), date: b.dht_at };
  return { valid: false };
});

/* developer-supplied schemes of work (read by every signed-in user) */
on('GET', '/api/schemes', { auth: true }, c => ({ schemes: all('SELECT json FROM schemes ORDER BY created').map(r => JSON.parse(r.json)), files: all('SELECT id,title,grade,subject,term,name FROM scheme_files ORDER BY created') }));
on('GET', '/api/scheme-files/([0-9a-f-]{36})', { auth: true }, c => { const f = one('SELECT * FROM scheme_files WHERE id=?', c.m[1]) || bad(404, 'Not found'); return { raw: Buffer.from(f.data), mime: f.mime || 'application/octet-stream', filename: f.name }; });

/* ---------- developer area (secret path, separate login, never linked from the app) ---------- */
const devSessions = new Map();
const devOk = req => { const t = cookieOf(req, 'dsid'), e = devSessions.get(t); return !!(DEV_PASS && e && e > Date.now()); };
const D = DEV_PATH + '/api';
on('POST', D + '/login', { auth: false, dev: true }, c => {
  limit('dv' + c.ip, 8, 9e5); if (!DEV_USER || !DEV_PASS) bad(404, 'Not found');
  if (!safeEq(c.body.user || '', DEV_USER) || !safeEq(c.body.pass || '', DEV_PASS)) bad(401, 'Incorrect developer login');
  const t = crypto.randomBytes(24).toString('base64url'); devSessions.set(t, Date.now() + 4 * 36e5);
  c.res.setHeader('Set-Cookie', `dsid=${t}; HttpOnly; SameSite=Strict; Path=${DEV_PATH}; Max-Age=14400`); return { ok: true };
});
on('GET', D + '/schemes', { dev: true, auth: false, devAuth: true }, () => ({ schemes: all('SELECT json FROM schemes ORDER BY created').map(r => JSON.parse(r.json)), files: all('SELECT id,title,grade,subject,term,name FROM scheme_files ORDER BY created'), stats: { schools: one('SELECT COUNT(*) n FROM schools').n, users: one('SELECT COUNT(*) n FROM users').n } }));
on('POST', D + '/schemes', { dev: true, auth: false, devAuth: true, limit: 3e6 }, c => { const list = Array.isArray(c.body.schemes) ? c.body.schemes : []; list.forEach(s => { s.id = s.id || uid(); run('INSERT INTO schemes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json', String(s.id), JSON.stringify(s), now()); }); return { added: list.length }; });
on('DELETE', D + '/schemes/([^/]+)', { dev: true, auth: false, devAuth: true }, c => { run('DELETE FROM schemes WHERE id=?', decodeURIComponent(c.m[1])); return { ok: true }; });
on('POST', D + '/files', { dev: true, auth: false, devAuth: true, limit: 2.5e7 }, c => { const b = c.body, id = uid(); run('INSERT INTO scheme_files VALUES(?,?,?,?,?,?,?,?,?)', id, str(b.title, 2, 160, 'Title'), String(b.grade || ''), String(b.subject || ''), String(b.term || ''), str(b.name, 1, 160, 'File name').replace(/[\\/:*?"<>|]/g, '-'), String(b.mime || 'application/octet-stream'), Buffer.from(String(b.data || ''), 'base64'), now()); return { id }; });
on('DELETE', D + '/files/([0-9a-f-]{36})', { dev: true, auth: false, devAuth: true }, c => { run('DELETE FROM scheme_files WHERE id=?', c.m[1]); return { ok: true }; });

/* ---------- HTTP plumbing ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon' };
function secure(res, req) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
const readBody = (req, max) => new Promise((res, rej) => { const ch = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { rej(new HttpError(413, 'Too large')); req.destroy(); } else ch.push(d); }); req.on('end', () => res(Buffer.concat(ch))); req.on('error', rej); });
function send(res, status, obj) { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); }
function serveFile(res, dir, rel) {
  let p = path.normalize(path.join(dir, rel === '/' ? 'index.html' : rel)); if (!p.startsWith(dir)) return send(res, 404, { error: 'Not found' });
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(p).pipe(res);
}
const server = http.createServer(async (req, res) => {
  secure(res, req); const url = new URL(req.url, 'http://x'), p = url.pathname, ip = (process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  try {
    if (p === DEV_PATH || p === DEV_PATH + '/') { if (!DEV_PASS) return send(res, 404, { error: 'Not found' }); return serveFile(res, DEVDIR, 'developer.html'); }
    if (p === DEV_PATH + '/dev.js') { if (!DEV_PASS) return send(res, 404, { error: 'Not found' }); return serveFile(res, DEVDIR, 'dev.js'); }
    if (p.startsWith('/api/') || p.startsWith(DEV_PATH + '/api/')) {
      const r = routes.find(x => x.method === req.method && x.re.test(p));
      if (!r) return send(res, 404, { error: 'Not found' });
      const c = { req, res, ip, url, m: p.match(r.re), status: 200 };
      if (r.opts.devAuth && !devOk(req)) return send(res, 401, { error: 'Developer login required' });
      if (r.opts.auth !== false && !r.opts.dev) { c.user = sessionUser(req); if (!c.user) return send(res, 401, { error: 'Please sign in' }); if (r.opts.roles && !r.opts.roles.includes(c.user.role)) return send(res, 403, { error: 'Your role cannot do this' }); }
      if (req.method !== 'GET' && req.headers['x-td'] !== '1') return send(res, 403, { error: 'Bad request' });
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') { const buf = await readBody(req, r.opts.limit || 1e6); if (r.opts.raw) c.body = buf; else { try { c.body = buf.length ? JSON.parse(buf.toString()) : {}; } catch (e) { bad(400, 'Invalid JSON'); } } } else c.body = {};
      const out = await r.fn(c);
      if (out && out.raw) { res.writeHead(200, { 'Content-Type': out.mime, 'Cache-Control': 'private, no-store', ...(out.filename ? { 'Content-Disposition': 'attachment; filename="' + out.filename.replace(/"/g, '') + '"' } : {}) }); return res.end(out.raw); }
      return send(res, c.status, out);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    return serveFile(res, PUBLIC, decodeURIComponent(p));
  } catch (e) { if (e instanceof HttpError) return send(res, e.status, { error: e.message }); console.error(e); return send(res, 500, { error: 'Something went wrong' }); }
});
if (require.main === module) {
  setInterval(() => { run('DELETE FROM sessions WHERE expires<?', Date.now()); for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k); for (const [k, v] of devSessions) if (v < Date.now()) devSessions.delete(k); }, 36e5).unref();
  server.listen(PORT, () => { console.log('Teacher Platform running on port ' + PORT); console.log(DEV_PASS ? 'Developer area: ' + DEV_PATH : 'Developer area is OFF. Set DEV_USER and DEV_PASS to turn it on.'); });
}
module.exports = { server, db, DEV_PATH };
