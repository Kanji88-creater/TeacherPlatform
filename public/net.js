/* Sign-in session, server sync, navigation by role, pupil photos. Loaded right after data.js. */
async function API(m, p, body, raw) {
  const h = { 'x-td': '1' }; let b;
  if (raw) { h['Content-Type'] = raw.type; b = raw.data; } else if (body !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(p, { method: m, credentials: 'same-origin', headers: h, body: b });
  if (r.status === 401) { location.replace('index.html'); throw Object.assign(new Error('Please sign in'), { status: 401 }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Error ' + r.status), { status: r.status, body: j });
  return j;
}
let _tt;
function toast(msg) { const t = document.querySelector('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(_tt); _tt = setTimeout(() => t.classList.remove('on'), 2400); }

/* ---- navigation depends on the signed-in role ---- */
const NAVS = {
  teacher: [['home', 'dashboard.html', 'Home'], ['plans', 'plans.html', 'Plans'], ['assess', 'assessments.html', 'Assess'], ['learners', 'learners.html', 'Learners'], ['more', 'more.html', 'More']],
  hod: [['home', 'dashboard.html', 'Home'], ['review', 'review.html', 'Review'], ['plans', 'plans.html', 'Teaching'], ['school', 'school.html', 'Department'], ['more', 'more.html', 'More']],
  dht: [['home', 'dashboard.html', 'Home'], ['review', 'review.html', 'Review'], ['school', 'school.html', 'School'], ['more', 'more.html', 'More']],
  head: [['home', 'dashboard.html', 'Home'], ['school', 'school.html', 'School'], ['staff', 'staff.html', 'Staff'], ['more', 'more.html', 'More']]
};
function buildNav(active) {
  const nav = document.querySelector('.nav'); if (!nav) return;
  const list = NAVS[ROLE] || NAVS.teacher; let key = active; if (ROLE === 'hod' && ['assess', 'learners'].includes(key)) key = 'plans';
  nav.innerHTML = list.map(([k, h, t]) => `<a href="${h}" data-r="${k}"${k === key ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  nav.style.gridTemplateColumns = 'repeat(' + list.length + ',1fr)';
}
(function guard() {
  const pg = (document.body.dataset || {}).page || '';
  const teachingOnly = ['plans', 'plan-new', 'plan-view', 'assessments', 'exercises', 'assignments', 'assessment-new', 'marks', 'paper', 'attendance', 'register', 'learners', 'learner', 'reports', 'records', 'workplan', 'schemes', 'materials', 'scan', 'assistant', 'reminders', 'documents'];
  const need = { review: ['hod', 'dht'], school: ['head', 'dht', 'hod'], staff: ['head', 'hod'] };
  if ((teachingOnly.includes(pg) && !TEACH) || (need[pg] && !need[pg].includes(ROLE))) location.replace('dashboard.html');
})();

/* ---- documents sent for checking (cached for offline) ---- */
let MYSUBS = []; try { MYSUBS = JSON.parse(localStorage.getItem('td-subs-' + (SESSION && SESSION.id)) || '[]'); } catch (e) {}
const subFor = (type, ref) => MYSUBS.find(s => s.type === type && s.refId === ref) || null;
async function loadSubs() {
  MYSUBS = await API('GET', '/api/submissions/mine'); try { localStorage.setItem('td-subs-' + SESSION.id, JSON.stringify(MYSUBS)); } catch (e) {}
  let ch = false; (S.records || []).forEach(r => { const s = subFor('record', r.id), lock = s && s.status !== 'returned' ? (r.submittedOn || (s.submittedAt || '').slice(0, 10)) : ''; if ((r.submittedOn || '') !== lock) { r.submittedOn = lock; ch = true; } });
  if (ch) save();
}

/* ---- schemes of work supplied by the developer ---- */
function setSchemes(d) { window.DEV_SCHEMES = d.schemes || []; window.DEV_SCHEME_FILES = (d.files || []).map(f => ({ ...f, url: '/api/scheme-files/' + f.id })); }
try { const c = JSON.parse(localStorage.getItem('td-schemes')); if (c) setSchemes(c); } catch (e) {}
async function loadSchemes() { try { const d = await API('GET', '/api/schemes'); setSchemes(d); localStorage.setItem('td-schemes', JSON.stringify(d)); } catch (e) {} }

/* ---- keep the teacher's data safe on the server ---- */
let pushTimer = null, pushing = false;
function queuePush() { if (!TEACH) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 2000); }
async function pushNow() {
  if (!TEACH || pushing || !navigator.onLine) return; pushing = true;
  try {
    const data = JSON.parse(JSON.stringify(S)); delete data._dirty; delete data._rev;
    const r = await API('PUT', '/api/state', { rev: S._rev || 0, data }); S._rev = r.rev; S._dirty = false; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  } catch (e) { if (e.status === 409) { pushing = false; await pullState(true); } }
  pushing = false;
}
async function pullState(force) {
  const d = await API('GET', '/api/state');
  if (!d.data) { if (S.classes.length || S.plans.length || S.assess.length) { S._rev = 0; await pushNow(); } return false; }
  if (d.rev === (S._rev || 0) && !force) { if (S._dirty) pushNow(); return false; }
  if (S._dirty) { try { localStorage.setItem('td-backup-' + SESSION.id, JSON.stringify(S)); } catch (e) {} }
  S = migrate(d.data); S._rev = d.rev; S._dirty = false; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  return true;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S._dirty) pushNow(); });
addEventListener('online', () => { if (S._dirty) pushNow(); });

(async function boot() {
  try {
    const me = await API('GET', '/api/me');
    if (me.role !== ROLE || me.name !== USER || !SESSION.school) { localStorage.setItem('td-session', JSON.stringify(me)); location.reload(); return; }
    if (TEACH) { await pullState(); await loadSubs(); loadSchemes(); }
    if (typeof render === 'function') render(true);
  } catch (e) {}
})();

X.acts.logout = async () => {
  try { await pushNow(); await API('POST', '/api/logout'); } catch (e) {}
  if (S._dirty) { if (!confirm('Some changes have not reached the server yet. Signing out will keep them on this device until you sign in again. Sign out now?')) return; }
  else { try { localStorage.removeItem(KEY); localStorage.removeItem('td-backup-' + SESSION.id); } catch (e) {} const l = await fileAll().catch(() => []); l.filter(m => m.kind === 'photo').forEach(m => fileDel(m.id)); }
  ['td-subs-' + SESSION.id, 'td-schemes', 'td-session'].forEach(k => localStorage.removeItem(k)); location.href = 'index.html';
};

/* ---- pupil photos: stored privately for the teacher, on the device and on the server ---- */
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const avatar = (p, size) => `<span class="av ${size || ''}" data-pid="${p.id}" aria-hidden="true">${esc(initials(p.name))}</span>`;
const photoUrls = {};
async function savePhoto(pid, file) {
  if (!localStorage.getItem('td-photo-consent')) { if (!confirm('Only add photos of pupils with permission from the school and the pupil\'s parent or guardian. Photos are private to you and are not shown to other staff. Continue?')) return; localStorage.setItem('td-photo-consent', '1'); }
  const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = URL.createObjectURL(file); }); if (!img) { toast('That file is not a photo'); return; }
  const s = 240, c = document.createElement('canvas'), q = Math.min(img.width, img.height); c.width = c.height = s;
  c.getContext('2d').drawImage(img, (img.width - q) / 2, (img.height - q) / 2, q, q, 0, 0, s, s);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  await filePut({ id: 'photo-' + pid, kind: 'photo', name: pid, mime: 'image/jpeg', size: blob.size, date: iso(new Date()), subject: '', grade: '', topics: '', blob }); delete photoUrls[pid];
  try { await API('PUT', '/api/photos/' + pid, undefined, { type: 'image/jpeg', data: blob }); } catch (e) {}
}
async function hydratePhotos() {
  for (const el of document.querySelectorAll('[data-pid]')) {
    const pid = el.dataset.pid; let url = photoUrls[pid];
    if (!url) {
      let rec = await fileGet('photo-' + pid).catch(() => null);
      if (!rec && navigator.onLine) { try { const r = await fetch('/api/photos/' + pid, { credentials: 'same-origin' }); if (r.ok) { const blob = await r.blob(); rec = { blob }; filePut({ id: 'photo-' + pid, kind: 'photo', name: pid, mime: blob.type, size: blob.size, date: iso(new Date()), subject: '', grade: '', topics: '', blob }); } } catch (e) {} }
      if (rec) url = photoUrls[pid] = URL.createObjectURL(rec.blob);
    }
    if (url) el.innerHTML = `<img src="${url}" alt="">`;
  }
}
