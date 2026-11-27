/* Documents sent for checking, stamps, role dashboards, school performance, staff and account. Loaded after tools.js. */
const rq = k => new URLSearchParams(location.search).get(k);
const TYPELABEL = { test: 'Test', record: 'Record of work', iwp: 'Individual work plan', register: 'Class register', plan: 'Lesson plan', scheme: 'Scheme of work' };
const fmtDay = d => d ? new Date(String(d).slice(0, 10) + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const mkSig = o => { const s = JSON.stringify(o); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const SIGKEY = 'td-sig-' + (SESSION ? SESSION.id : ''); let SIGS = {}; try { SIGS = JSON.parse(localStorage.getItem(SIGKEY) || '{}'); } catch (e) {}
const saveSigs = () => { try { localStorage.setItem(SIGKEY, JSON.stringify(SIGS)); } catch (e) {} };
const clsById = id => S.classes.find(c => c.id === id) || { name: 'Class', pupils: [] };
const monthLabel = m => new Date(m + '-01T00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const wrapView = (key, fn) => { const o = X.views[key]; if (o) X.views[key] = id => fn(o(id), id); };

/* ---- what gets sent when a document is submitted ---- */
const PAYLOAD = {
  test: id => { const a = S.assess.find(x => x.id === id), m = assAvg(a); return { title: a.title, type: a.type, className: clsById(a.classId).name, date: a.date, max: a.max, questions: a.questions || [], guide: a.guide || '', marked: Object.keys(a.scores).length, average: m == null ? null : Math.round(m) }; },
  record: id => { const r = S.records.find(x => x.id === id); return { className: clsById(r.classId).name, weekStart: r.weekStart, teacher: USER, rows: r.rows }; },
  iwp: id => { const w = S.iwp.find(x => x.id === id); return { teacher: USER, term: w.term, year: w.year, rows: w.rows }; },
  plan: id => { const p = S.plans.find(x => x.id === id), o = { className: clsById(p.classId).name, teacher: USER }; PLAN_KEYS.forEach(k => { o[k] = p[k] || ''; }); return o; },
  register: ref => { const [cid, m] = ref.split('|'), c = clsById(cid), y = +m.slice(0, 4), mo = +m.slice(5), days = []; for (let d = 1; d <= new Date(y, mo, 0).getDate(); d++) { const w = new Date(y, mo - 1, d).getDay(); if (w && w < 6) days.push(d); }
    return { className: c.name, month: m, teacher: USER, days, rows: c.pupils.map((p, i) => { const marks = days.map(d => (S.att[cid + '|' + m + '-' + String(d).padStart(2, '0')] || {})[p.id] || ''); return { no: i + 1, name: p.name, sex: p.sex || '', marks, present: marks.filter(x => x === 'P').length, absent: marks.filter(x => x === 'A').length }; }) }; }
};
const TITLES = {
  test: id => S.assess.find(x => x.id === id).title,
  record: id => { const r = S.records.find(x => x.id === id); return 'Record of work: ' + clsById(r.classId).name + ', week of ' + r.weekStart; },
  iwp: id => { const w = S.iwp.find(x => x.id === id); return 'Individual work plan: ' + w.term + ' ' + w.year; },
  plan: id => 'Lesson plan: ' + S.plans.find(x => x.id === id).title,
  register: ref => { const [cid, m] = ref.split('|'); return 'Class register: ' + clsById(cid).name + ', ' + monthLabel(m); }
};
const isStale = (type, ref, s) => { try { return !!(SIGS[s.id] && SIGS[s.id] !== mkSig(PAYLOAD[type](ref))); } catch (e) { return false; } };
function statusText(s) {
  const toDHT = ROLE === 'hod';
  return ({ submitted: ['watch', toDHT ? 'Ready to go to the Deputy Head with your department documents' : 'Waiting for your HOD to check'],
    returned: ['support', 'Returned by ' + esc((s.hod || {}).by || 'HOD') + ': ' + esc((s.hod || {}).comment || '')],
    hod_checked: ['ready', 'Checked by HOD. It will go to the Deputy Head with the department documents'],
    batched: ['watch', 'Sent to the Deputy Head'], dht_checked: ['ready', 'Checked by the Deputy Head'] })[s.status] || ['draft', s.status];
}
function subChip(type, ref) { const s = subFor(type, ref); if (!s) return ''; const [c, t] = statusText(s); return `<p class="chip ${c}">${t}${isStale(type, ref, s) ? ' <b>(changed since you submitted it)</b>' : ''}</p>`; }
const canSend = (type, ref) => { const s = subFor(type, ref); return !s || s.status === 'returned' || (s.status === 'submitted' && isStale(type, ref, s)); };
function submitBlock(type, ref) {
  const s = subFor(type, ref), target = ROLE === 'hod' ? 'Deputy Head' : 'HOD';
  return `<section class="card noprint"><h2>Checking</h2>${s ? subChip(type, ref) : `<p class="chip draft">Not submitted yet. Submit it to your ${target} to be checked.</p>`}${canSend(type, ref) ? `<button class="btn btn-solid" data-act="subSend" data-type="${type}" data-ref="${esc(ref)}">${!s ? 'Submit to ' + target : s.status === 'returned' ? 'Submit corrected version' : 'Submit updated version'}</button>` : ''}</section>`;
}
X.acts.subSend = async d => {
  try {
    const p = PAYLOAD[d.type](d.ref), s = await API('POST', '/api/submissions', { type: d.type, refId: d.ref, title: TITLES[d.type](d.ref), payload: p });
    SIGS[s.id] = mkSig(p); saveSigs(); await loadSubs(); toast('Submitted. You will see the check result here.'); if (typeof render === 'function') render(true);
  } catch (e) { toast(e.message || 'Could not submit'); }
};

/* ---- the unique stamp: a pattern and colour unique to each checker, plus a code unique to each document ---- */
function stampSvg(ch, label) {
  const seal = String(ch.seal || '0000000000000000'), hue = Math.round(parseInt(seal.slice(0, 2), 16) * 360 / 256), col = `hsl(${hue} 55% 30%)`, n = parseInt(seal.slice(2, 6), 16);
  let cells = ''; for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if ((n >> (r * 3 + c)) & 1) { cells += `<rect x="${50 + c * 8}" y="${20 + r * 8}" width="8" height="8"/>`; if (c < 2) cells += `<rect x="${50 + (4 - c) * 8}" y="${20 + r * 8}" width="8" height="8"/>`; }
  const t = (y, size, txt, w) => `<text x="70" y="${y}" style="text-anchor:middle;font-size:${size}px;font-weight:${w || 700};fill:${col}">${esc(txt)}</text>`;
  return `<svg viewBox="0 0 140 140" class="stamp" role="img" aria-label="${esc(label)} stamp ${esc(ch.code)}"><g transform="rotate(-6 70 70)"><circle cx="70" cy="70" r="66" fill="#fffdf8" stroke="${col}" stroke-width="3"/><circle cx="70" cy="70" r="60" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3"/><g fill="${col}">${cells}</g>${t(74, 9, label)}${t(86, 9, String(ch.by || '').slice(0, 20), 600)}${t(97, 8, fmtDay(ch.at), 500)}${t(112, 7.5, ch.code, 700)}</g></svg>`;
}
const stampBox = (ch, label) => `<figure class="stampbox">${stampSvg(ch, label)}<figcaption>${esc(ch.by)}<br>${esc(fmtDay(ch.at))}<br><small>Verify: ${esc(location.origin)}/verify.html?code=${esc(ch.code)}</small></figcaption></figure>`;
function stampsBlock(type, ref) {
  const s = subFor(type, ref); if (!s) return '';
  const a = s.hod && s.hod.decision === 'approved' ? stampBox(s.hod, 'HOD CHECKED') : '', b = s.dht && s.dht.decision === 'approved' ? stampBox(s.dht, 'DEPUTY HEAD') : '';
  return a || b ? `<section class="stamps">${a}${b}${isStale(type, ref, s) ? '<p class="muted noprint"><b>This document changed after it was checked. Submit it again for a new stamp.</b></p>' : ''}</section>` : '';
}

/* ---- connect the stamps and submit buttons to the existing document pages ---- */
wrapView('records', (h, id) => id ? h.replace(/<section class="card form"><h2>HOD check<\/h2>.*?<\/section>/s, '').replace(/<section class="card form"><h2>Deputy Head Teacher check<\/h2>.*?<\/section>/s, '') + submitBlock('record', id) + stampsBlock('record', id) : h);
wrapView('workplan', (h, id) => id ? h + submitBlock('iwp', id) + stampsBlock('iwp', id) : h);
wrapView('plan-view', (h, id) => id ? h + submitBlock('plan', id) + stampsBlock('plan', id) : h);
wrapView('paper', (h, id) => id ? h + submitBlock('test', id) + stampsBlock('test', id) : h);
wrapView('register', h => { const c = cls(); if (!c) return h; const ref = c.id + '|' + (rq('month') || iso(new Date()).slice(0, 7)); return h + submitBlock('register', ref) + stampsBlock('register', ref); });
wrapView('learner', (h, id) => {
  const p = S.classes.flatMap(c => c.pupils).find(x => x.id === id); if (!p) return h;
  return h.replace('</header>', `</header><section class="card noprint"><div class="who">${avatar(p, 'big')}<label class="btn btn-outline">Add or change photo<input type="file" accept="image/*" capture="user" class="photoIn" data-for="${p.id}" hidden></label></div><p class="muted">Photos are private to you. Only add a photo with the permission of the school and the pupil's parent or guardian.</p></section>`);
});
const prevChangeR = X.change;
X.change = e => { if (prevChangeR) prevChangeR(e); const t = e.target; if (t.classList && t.classList.contains('photoIn') && t.files[0]) savePhoto(t.dataset.for, t.files[0]).then(() => { toast('Photo saved'); if (typeof render === 'function') render(true); }); };

/* ---- my documents (teacher and HOD) ---- */
const docLink = (type, id) => ({ test: (S.assess.find(a => a.id === id) || {}).questions ? 'paper.html?id=' + id : 'assessments.html', record: 'records.html?id=' + id, iwp: 'workplan.html?id=' + id, plan: 'plan-view.html?id=' + id })[type];
X.views.documents = () => {
  const all = [];
  S.assess.forEach(a => all.push(['test', a.id, a.title, TYPES[a.type] + ' · ' + clsById(a.classId).name]));
  S.records.forEach(r => all.push(['record', r.id, TITLES.record(r.id), 'Record of work']));
  S.iwp.forEach(w => all.push(['iwp', w.id, TITLES.iwp(w.id), 'Individual work plan']));
  S.plans.forEach(p => all.push(['plan', p.id, 'Lesson plan: ' + p.title, clsById(p.classId).name]));
  const grp = { act: [], todo: [], wait: [], done: [] };
  all.forEach(d => { const s = subFor(d[0], d[1]); (!s ? grp.todo : s.status === 'returned' ? grp.act : s.status === 'dht_checked' ? grp.done : grp.wait).push(d); });
  const row = d => `<div class="item col"><div class="row"><span><b>${esc(d[2])}</b><small>${esc(d[3])}</small></span><a class="btn btn-outline btn-sm" href="${docLink(d[0], d[1])}">Open</a></div>${subChip(d[0], d[1])}${canSend(d[0], d[1]) ? `<div class="btns"><button class="btn btn-solid btn-sm" data-act="subSend" data-type="${d[0]}" data-ref="${d[1]}">${subFor(d[0], d[1]) ? 'Submit corrected version' : 'Submit to ' + (ROLE === 'hod' ? 'Deputy Head' : 'HOD')}</button></div>` : ''}</div>`;
  const sec = (t, l) => l.length ? `<section><h2>${t} (${l.length})</h2><div class="stack">${l.map(row).join('')}</div></section>` : '';
  return head('My documents') + `<p class="muted">Tests, records of work, work plans and lesson plans go to your ${ROLE === 'hod' ? 'Deputy Head' : 'HOD'} to be checked. Class registers are submitted from the register page.</p>` + (sec('Returned: needs your action', grp.act) + sec('Not submitted yet', grp.todo) + sec('Waiting for a check', grp.wait) + sec('Checked', grp.done) || '<p class="muted">Nothing to submit yet.</p>') + '<a class="btn btn-outline" href="register.html">Submit a class register</a>';
};

/* ---- showing a submitted document to the person checking it ---- */
const rtable = (cols, rows) => `<div class="tblwrap"><table class="tbl"><thead><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${(rows || []).map(r => `<tr>${cols.map(c => `<td>${esc(r[c[0]] == null ? '' : r[c[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const para = (l, t) => t ? `<h3>${l}</h3><p>${esc(t).replace(/\n/g, '<br>')}</p>` : '';
function renderPayload(s) {
  const p = s.payload || {};
  if (s.type === 'test') return `<h3>${esc(p.title)}</h3><p>${esc(p.className)} · ${esc(p.date)} · out of ${p.max} · ${p.marked} pupils marked${p.average != null ? ' · class average ' + p.average + '%' : ''}</p>${(p.questions || []).map((q, i) => `<p>${i + 1}. ${esc(q.q)} <b>(${q.marks})</b></p>`).join('') || '<p class="muted">No questions were attached.</p>'}${para('Marking guide', p.guide)}`;
  if (s.type === 'record') return `<p>${esc(p.className)} · week of ${esc(p.weekStart)} · ${esc(p.teacher)}</p>` + rtable([['date', 'Date'], ['cls', 'Class / subject'], ['topic', 'Topic / content covered'], ['methods', 'Methods'], ['aids', 'Aids used'], ['eval', 'Evaluation / remarks']], p.rows);
  if (s.type === 'iwp') return `<p>${esc(p.teacher)} · ${esc(p.term)} ${esc(p.year)}</p>` + rtable([['kra', 'Key result area'], ['activities', 'Activities'], ['target', 'Target / indicator'], ['time', 'Timeframe'], ['resources', 'Resources'], ['status', 'Status'], ['review', 'Review remarks']], p.rows);
  if (s.type === 'plan') return `<h3>${esc(p.title)}</h3><p>${esc(p.subject)} · ${esc(p.className)} · ${esc(p.date)} · ${esc(p.duration)} minutes · ${esc(p.teacher)}</p>` + [['rationale', 'Rationale'], ['outcomes', 'Learning outcomes'], ['prior', 'Prerequisite knowledge'], ['aids', 'Teaching and learning aids'], ['refs', 'References'], ['intro', 'Introduction'], ['development', 'Development'], ['conclusion', 'Conclusion'], ['evaluation', 'Evaluation'], ['inclusion', 'Inclusion']].map(([k, l]) => para(l, p[k])).join('');
  if (s.type === 'register') return `<p>${esc(p.className)} · ${esc(monthLabel(p.month))} · ${esc(p.teacher)}</p><div class="tblwrap"><table class="tbl reg"><thead><tr><th>No</th><th>Name</th><th>Sex</th>${(p.days || []).map(d => `<th>${d}</th>`).join('')}<th>P</th><th>A</th></tr></thead><tbody>${(p.rows || []).map(r => `<tr><td>${r.no}</td><td class="nm">${esc(r.name)}</td><td>${esc(r.sex)}</td>${r.marks.map(m => `<td${m === 'A' ? ' class="abs"' : ''}>${esc(m)}</td>`).join('')}<td>${r.present}</td><td>${r.absent}</td></tr>`).join('')}</tbody></table></div>`;
  return '<p class="muted">No preview for this type.</p>';
}

/* ---- HOD and Deputy Head: review and checking ---- */
X.views.review = () => head('Review') + '<div id="rv"><p class="muted">Loading...</p></div>';
const rowSub = s => item('review.html?id=' + s.id, esc(s.title), esc(s.owner || '') + ' · ' + (TYPELABEL[s.type] || s.type) + ' · version ' + s.version, '<span class="count">›</span>');
X.after.review = async () => {
  const box = $('#rv');
  try { if (rq('id')) await reviewDoc(rq('id')); else if (rq('batch')) await reviewBatch(rq('batch')); else if (ROLE === 'hod') await hodQueue(); else await dhtQueue(); }
  catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
};
async function hodQueue() {
  const q = await API('GET', '/api/submissions/queue'), b = await API('GET', '/api/batches');
  $('#rv').innerHTML = `<section><h2>Waiting for your check (${q.waiting.length})</h2><div class="stack">${q.waiting.map(rowSub).join('') || '<p class="muted">Nothing is waiting.</p>'}</div></section>
  <section class="card"><h2>Ready to send to the Deputy Head (${q.ready.length})</h2>${q.ready.length ? `<form class="form" id="batchForm">${q.ready.map(s => `<label class="item"><span><b>${esc(s.title)}</b><small>${esc(s.owner || '')} · ${TYPELABEL[s.type] || s.type}${s.hod ? ' · stamp ' + esc(s.hod.code) : ''}</small></span><input type="checkbox" name="ids" value="${s.id}" checked style="width:auto"></label>`).join('')}<label>Name of this batch<input name="title" value="${esc(SESSION.department)} documents, week of ${iso(mondayOf(new Date()))}"></label><button type="button" class="btn btn-solid" data-act="sendBatch">Send selected to Deputy Head</button></form>` : '<p class="muted">Documents you have checked, and your own, appear here.</p>'}</section>
  <section><h2>Returned to teachers (${q.returned.length})</h2><div class="stack">${q.returned.map(rowSub).join('') || '<p class="muted">None.</p>'}</div></section>
  <section><h2>Sent to Deputy Head</h2><div class="stack">${b.map(x => item('review.html?batch=' + x.id, esc(x.title), x.count + ' documents · ' + ({ submitted: 'waiting for the Deputy Head', approved: 'checked', returned: 'returned to you' })[x.status], '<span class="pill ' + (x.status === 'approved' ? 'ready' : x.status === 'returned' ? 'support' : 'watch') + '">' + x.status + '</span>')).join('') || '<p class="muted">None yet.</p>'}</div></section>`;
}
async function dhtQueue() {
  const b = await API('GET', '/api/batches'), wait = b.filter(x => x.status === 'submitted'), rest = b.filter(x => x.status !== 'submitted');
  const row = x => item('review.html?batch=' + x.id, esc(x.title), esc(x.hod || '') + ' · ' + x.count + ' documents · ' + fmtDay(x.created), `<span class="pill ${x.status === 'approved' ? 'ready' : x.status === 'returned' ? 'support' : 'watch'}">${x.status === 'submitted' ? 'to check' : x.status}</span>`);
  $('#rv').innerHTML = `<section><h2>Department batches waiting (${wait.length})</h2><div class="stack">${wait.map(row).join('') || '<p class="muted">Nothing is waiting.</p>'}</div></section><section><h2>Already checked</h2><div class="stack">${rest.map(row).join('') || '<p class="muted">None yet.</p>'}</div></section>`;
}
async function reviewDoc(id) {
  const s = await API('GET', '/api/submissions/' + id), mine = s.owner === USER, decide = ROLE === 'hod' && s.status === 'submitted' && !mine;
  const stamps = (s.hod && s.hod.decision === 'approved' ? stampBox(s.hod, 'HOD CHECKED') : '') + (s.dht && s.dht.decision === 'approved' ? stampBox(s.dht, 'DEPUTY HEAD') : '');
  $('#rv').innerHTML = `<p class="muted"><a href="review.html">‹ Back to review</a></p><article class="doc"><div class="doc-head"><h2>${esc(s.title)}</h2><p>${esc(TYPELABEL[s.type] || s.type)} · submitted by ${esc(s.owner || '')} · ${esc(fmtDay(s.submittedAt))} · version ${s.version}</p></div>${renderPayload(s)}${stamps ? `<section class="stamps">${stamps}</section>` : ''}</article>
  ${s.hod && s.hod.decision === 'returned' ? `<p class="chip support">Returned: ${esc(s.hod.comment)}</p>` : ''}
  ${decide ? `<section class="card form noprint"><h2>Your decision</h2><label>Comment (required if you return it)<textarea id="rvComment" rows="3"></textarea></label><div class="btns"><button class="btn btn-solid" data-act="hodDecide" data-id="${s.id}" data-decision="approved">Approve and stamp</button><button class="btn btn-danger" data-act="hodDecide" data-id="${s.id}" data-decision="returned">Return to teacher</button></div></section>` : ''}`;
}
async function reviewBatch(id) {
  const b = await API('GET', '/api/batches/' + id), decide = ROLE === 'dht' && b.status === 'submitted';
  $('#rv').innerHTML = `<p class="muted"><a href="review.html">‹ Back to review</a></p><section class="card"><h2>${esc(b.title)}</h2><p class="muted">${esc(b.department)} · sent by ${esc(b.hod || '')} · ${b.count} documents · ${esc(b.status)}</p>${b.dht && b.dht.decision === 'approved' ? stampBox(b.dht, 'DEPUTY HEAD') : ''}${b.dht && b.dht.decision === 'returned' ? `<p class="chip support">Returned: ${esc(b.dht.comment)}</p>` : ''}</section>
  <section><h2>Documents</h2><div class="stack">${b.documents.map(s => item('review.html?id=' + s.id, esc(s.title), esc(s.owner || '') + ' · ' + (TYPELABEL[s.type] || s.type) + (s.hod ? ' · checked by ' + esc(s.hod.by) : ''), '<span class="count">›</span>')).join('')}</div></section>
  ${decide ? `<section class="card form noprint"><h2>Your decision on this batch</h2><label>Comment (required if you return it)<textarea id="rvComment" rows="3"></textarea></label><div class="btns"><button class="btn btn-solid" data-act="dhtDecide" data-id="${b.id}" data-decision="approved">Approve and stamp all</button><button class="btn btn-danger" data-act="dhtDecide" data-id="${b.id}" data-decision="returned">Return to HOD</button></div></section>` : ''}`;
}
X.acts.hodDecide = async d => { try { await API('POST', '/api/submissions/' + d.id + '/check', { decision: d.decision, comment: $('#rvComment').value }); toast(d.decision === 'approved' ? 'Approved and stamped' : 'Returned to the teacher'); setTimeout(() => { location.href = 'review.html'; }, 700); } catch (e) { toast(e.message); } };
X.acts.dhtDecide = async d => { try { await API('POST', '/api/batches/' + d.id + '/check', { decision: d.decision, comment: $('#rvComment').value }); toast(d.decision === 'approved' ? 'Approved and stamped' : 'Returned to the HOD'); setTimeout(() => { location.href = 'review.html'; }, 700); } catch (e) { toast(e.message); } };
X.acts.sendBatch = async () => { const f = document.querySelector('#batchForm'), fd = new FormData(f), ids = fd.getAll('ids'); try { await API('POST', '/api/batches', { title: fd.get('title'), ids }); toast('Sent to the Deputy Head'); X.after.review(); } catch (e) { toast(e.message); } };

/* ---- school and department performance (numbers only, no pupil names) ---- */
const bandOf = v => v == null ? '' : v >= 70 ? 'strong' : v >= 50 ? 'watch' : 'support';
const hbar = (label, v, extra) => `<div class="hbar"><span>${esc(label)}</span><div class="meter"><i class="${bandOf(v)}" style="width:${v == null ? 0 : v}%"></i></div><b>${v == null ? '–' : v + '%'}</b>${extra ? `<small>${extra}</small>` : ''}</div>`;
const tiles = list => `<section class="stats">${list.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('')}</section>`;
const compliance = o => { const rows = o.byDepartment || []; const t = k => rows.reduce((a, r) => a + (r[k] || 0), 0); const total = t('submitted') + t('returned') + t('hod_checked') + t('batched') + t('dht_checked'); return { rows, total, done: t('dht_checked'), waiting: t('submitted'), returned: t('returned') }; };
const complianceTable = o => { const c = compliance(o); return c.rows.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Department</th><th>Waiting for HOD</th><th>Returned</th><th>Checked by HOD</th><th>With Deputy</th><th>Fully checked</th></tr></thead><tbody>${c.rows.map(r => `<tr><td>${esc(r.department)}</td><td>${r.submitted || 0}</td><td>${r.returned || 0}</td><td>${r.hod_checked || 0}</td><td>${r.batched || 0}</td><td>${r.dht_checked || 0}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No documents submitted yet.</p>'; };
X.views.school = () => head(ROLE === 'hod' ? 'Department performance' : 'School performance') + '<div id="sc"><p class="muted">Loading...</p></div>';
X.after.school = async () => {
  try {
    const [p, o] = await Promise.all([API('GET', '/api/performance'), API('GET', '/api/overview')]), s = p.school, label = ROLE === 'hod' ? 'Department' : 'School';
    const terms = [0, 1, 2].map(t => { let w = 0, a = 0; p.classes.forEach(c => { if (c.terms[t] != null && c.pupils) { w += c.pupils; a += c.terms[t] * c.pupils; } }); return w ? Math.round(a / w) : null; });
    $('#sc').innerHTML = `<div class="noprint"><button class="btn btn-solid" data-act="print">Print report</button></div><article class="doc">
    <div class="doc-head"><b>${esc(SESSION.school.name)}</b><h2>${label} performance report</h2><p>${esc(fmtDay(iso(new Date())))}</p></div>
    ${tiles([[s.avg == null ? '–' : s.avg + '%', label + ' average'], [s.pupils, 'Pupils'], [s.classes, 'Classes'], [s.attendance == null ? '–' : s.attendance + '%', 'Attendance']])}
    <h3>Pupils by performance band</h3>${donut([{ label: '70% and above', v: s.strong, color: '#2E6B3C' }, { label: '50 to 69%', v: s.watch, color: '#A66A00' }, { label: 'Below 50%', v: s.support, color: '#A32A2A' }])}
    ${ROLE === 'hod' ? '' : `<h3>By department</h3>${p.departments.map(d => hbar(d.department, d.avg, d.teachers + ' teachers · ' + d.pupils + ' pupils')).join('') || '<p class="muted">No marks recorded yet.</p>'}`}
    <h3>By term</h3><div class="chart">${chart(['Term 1', 'Term 2', 'Term 3'], terms)}</div>
    <h3>Classes</h3>${p.classes.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Class</th><th>Teacher</th><th>Pupils</th><th>Average</th><th>Below 50%</th><th>Attendance</th></tr></thead><tbody>${p.classes.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.teacher)}</td><td>${c.pupils}</td><td>${c.avg == null ? '–' : c.avg + '%'}</td><td>${c.support}</td><td>${c.attendance == null ? '–' : c.attendance + '%'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No classes have recorded marks yet.</p>'}
    <h3>Documents checked</h3>${complianceTable(o)}</article>`;
  } catch (e) { $('#sc').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
};

/* ---- staff and approvals ---- */
X.views.staff = () => head('Staff') + '<div id="st"><p class="muted">Loading...</p></div>';
const ROLEL = { head: 'Head teacher', dht: 'Deputy Head', hod: 'HOD', teacher: 'Teacher' };
X.after.staff = async () => {
  try {
    const list = await API('GET', '/api/staff'), pend = list.filter(u => u.status === 'pending'), act = list.filter(u => u.status === 'active'), off = list.filter(u => u.status === 'disabled');
    const row = (u, btns) => `<div class="item col"><div class="row"><span><b>${esc(u.name)}</b><small>${esc(ROLEL[u.role])}${u.department ? ' · ' + esc(u.department) : ''} · ${esc(u.email)}</small></span></div><div class="btns">${btns}</div></div>`;
    const sch = SESSION.school || {};
    $('#st').innerHTML = (ROLE === 'head' ? `<section class="card"><h2>School code</h2><p>Staff need this code to sign up: <b class="code">${esc(sch.code || '')}</b></p><p class="muted">Share it only with your staff. Every new account waits for your approval.</p></section>` : '') +
      `<section><h2>Waiting for approval (${pend.length})</h2><div class="stack">${pend.map(u => row(u, `<button class="btn btn-solid btn-sm" data-act="staffDo" data-id="${u.id}" data-do="approve">Approve</button><button class="btn btn-danger btn-sm" data-act="staffDo" data-id="${u.id}" data-do="disable">Reject</button>`)).join('') || '<p class="muted">Nobody is waiting.</p>'}</div></section>
      <section><h2>Staff (${act.length})</h2><div class="stack">${act.map(u => row(u, u.role === 'head' ? '' : `<button class="btn btn-danger btn-sm" data-act="staffDo" data-id="${u.id}" data-do="disable">Remove access</button>`)).join('')}</div></section>
      ${off.length ? `<section><h2>No access (${off.length})</h2><div class="stack">${off.map(u => row(u, `<button class="btn btn-outline btn-sm" data-act="staffDo" data-id="${u.id}" data-do="approve">Restore</button>`)).join('')}</div></section>` : ''}
      ${ROLE === 'head' ? `<section class="card"><h2>Departments</h2><form class="form" data-form="depts"><label>One department per line<textarea name="d" rows="7">${esc((sch.departments || []).join('\n'))}</textarea></label><button class="btn btn-solid">Save departments</button></form></section>` : ''}`;
  } catch (e) { $('#st').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
};
X.acts.staffDo = async d => { try { await API('POST', '/api/staff/' + d.id + '/' + d.do); toast('Done'); X.after.staff(); } catch (e) { toast(e.message); } };
X.noRender.depts = true;
X.forms.depts = f => { API('PUT', '/api/school/departments', { departments: f.d.value.split('\n') }).then(r => { SESSION.school.departments = r.departments; localStorage.setItem('td-session', JSON.stringify(SESSION)); toast('Departments saved'); }).catch(e => toast(e.message)); };

/* ---- more, and my account ---- */
function moreItems() {
  const t = [['reports.html', 'Reports', 'Class results, graphs and printable reports'], ['register.html', 'Class register', 'Printable monthly attendance register'], ['documents.html', 'My documents', 'Send documents to be checked and see the stamps'], ['records.html', 'Records of work', 'Weekly records'], ['workplan.html', 'Individual work plan', 'Your term work plan'], ['schemes.html', 'Schemes of work', 'Browse, copy and print schemes'], ['materials.html', 'Teaching materials', 'Upload books and past papers, find aids'], ['scan.html', 'Scan documents', 'Scan pages and save as PDF'], ['assistant.html', 'AI assistant', 'Draft lesson plans and assessments'], ['reminders.html', 'Reminders', 'What needs improvement and what is due'], ['settings.html', 'Settings', 'School details and AI connection']];
  const m = { teacher: t, hod: [['staff.html', 'Teachers in my department', 'Approve new teachers'], ...t], dht: [['school.html', 'School performance', 'Overall results'], ['review.html', 'Review', 'Department batches to check']], head: [['staff.html', 'Staff and approvals', 'School code, new accounts, departments'], ['school.html', 'School performance', 'Overall results and documents checked']] };
  return (m[ROLE] || t).concat([['account.html', 'My account', 'Password, my data and sign out'], ['privacy.html', 'Privacy', 'Who can see what']]);
}
X.views.more = () => head('More') + `<div class="stack">${moreItems().map(([h, t, s]) => item(h, t, s, '<span class="count">›</span>')).join('')}</div>`;
X.views.account = () => head('My account') + `<section class="card"><h2>${esc(USER)}</h2><p class="muted">${esc(ROLEL[ROLE])}${SESSION.department ? ' · ' + esc(SESSION.department) : ''} · ${esc((SESSION.school || {}).name || '')}<br>${esc(SESSION.email || '')}</p><button class="btn btn-outline" data-act="logout">Sign out</button></section>
  <section class="card"><h2>Change password</h2><form class="form" data-form="pw"><label>Current password<input type="password" name="old" autocomplete="current-password" required></label><label>New password (8+ characters)<input type="password" name="nw" autocomplete="new-password" minlength="8" required></label><button class="btn btn-solid">Change password</button></form></section>
  <section class="card"><h2>My data</h2><p class="muted">You can download everything stored about you, or delete your account and all your data from the server.</p><button class="btn btn-outline" data-act="exportMe">Download my data</button><button class="btn btn-outline" data-act="wipeDevice" style="margin-top:8px">Remove data from this device</button>
  ${ROLE === 'head' ? '<p class="muted">The Head teacher account owns the school, so it cannot be deleted here.</p>' : '<form class="form" data-form="del" style="margin-top:12px"><label>Password to confirm<input type="password" name="pw" autocomplete="current-password" required></label><button class="btn btn-danger">Delete my account and data</button></form>'}</section>`;
X.noRender.pw = X.noRender.del = true;
X.forms.pw = f => { API('POST', '/api/me/password', { old: f.old.value, new: f.nw.value }).then(() => { toast('Password changed'); f.reset(); }).catch(e => toast(e.message)); };
X.forms.del = f => { if (!confirm('This permanently deletes your account and everything you have saved. Continue?')) return; API('POST', '/api/me/delete', { password: f.pw.value }).then(() => { Object.keys(localStorage).filter(k => k.startsWith('td-') || k === KEY).forEach(k => localStorage.removeItem(k)); try { indexedDB.deleteDatabase('td-files-' + SESSION.id); } catch (e) {} location.href = 'index.html'; }).catch(e => toast(e.message)); };
X.acts.exportMe = async () => { try { const d = await API('GET', '/api/me/export'), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })); a.download = 'my-data.json'; a.click(); } catch (e) { toast(e.message); } };
X.acts.wipeDevice = async () => { if (!confirm('Remove all saved data from this device? Anything not yet synced to the server will be lost.')) return; await pushNow(); Object.keys(localStorage).filter(k => k.startsWith('td-')).forEach(k => localStorage.removeItem(k)); localStorage.removeItem(KEY); try { indexedDB.deleteDatabase('td-files-' + SESSION.id); } catch (e) {} location.href = 'index.html'; };

/* ---- dashboards for HOD, Deputy Head and Head teacher ---- */
async function roleDashboard() {
  const app = $('#app'), sch = SESSION.school || {}, hi = `<header class="top"><div><p class="muted">${esc(ROLEL[ROLE])} · ${esc(sch.name || '')}</p><h1>Good day, ${esc(USER.split(' ')[0])}</h1></div></header>`;
  app.innerHTML = hi + '<p class="muted">Loading...</p>';
  try {
    if (ROLE === 'hod') {
      const [q, p, st] = await Promise.all([API('GET', '/api/submissions/queue'), API('GET', '/api/performance'), API('GET', '/api/staff')]);
      app.innerHTML = hi + tiles([[q.waiting.length, 'Waiting for your check'], [q.ready.length, 'Ready for Deputy Head'], [p.school.avg == null ? '–' : p.school.avg + '%', 'Department average'], [st.filter(u => u.status === 'active').length, 'Teachers']]) +
        `<section><h2>Waiting for your check</h2><div class="stack">${q.waiting.slice(0, 5).map(rowSub).join('') || '<p class="muted">Nothing is waiting.</p>'}</div>${q.waiting.length > 5 ? '<a class="btn btn-outline" href="review.html">See all</a>' : ''}</section>` +
        (q.ready.length ? `<a class="btn btn-solid" href="review.html">Send ${q.ready.length} document(s) to the Deputy Head</a>` : '') +
        (st.some(u => u.status === 'pending') ? `<a class="btn btn-outline" href="staff.html">Teachers waiting for approval: ${st.filter(u => u.status === 'pending').length}</a>` : '') +
        `<section><h2>Classes in the department</h2>${p.classes.map(c => hbar(c.name + ' · ' + c.teacher, c.avg, c.pupils + ' pupils')).join('') || '<p class="muted">No marks recorded yet.</p>'}</section><a class="btn btn-outline" href="dashboard.html?me=1">My own teaching</a>`;
    } else if (ROLE === 'dht') {
      const [b, p, o] = await Promise.all([API('GET', '/api/batches'), API('GET', '/api/performance'), API('GET', '/api/overview')]), wait = b.filter(x => x.status === 'submitted'), c = compliance(o);
      app.innerHTML = hi + tiles([[wait.length, 'Batches to check'], [b.filter(x => x.status === 'approved').length, 'Batches approved'], [p.school.avg == null ? '–' : p.school.avg + '%', 'School average'], [c.total ? Math.round(c.done / c.total * 100) + '%' : '–', 'Documents fully checked']]) +
        `<section><h2>Waiting for your check</h2><div class="stack">${wait.map(x => item('review.html?batch=' + x.id, esc(x.title), esc(x.hod || '') + ' · ' + x.count + ' documents', '<span class="count">›</span>')).join('') || '<p class="muted">Nothing is waiting.</p>'}</div></section><section><h2>Documents by department</h2>${complianceTable(o)}</section><a class="btn btn-outline" href="school.html">School performance</a>`;
    } else {
      const [p, o, st] = await Promise.all([API('GET', '/api/performance'), API('GET', '/api/overview'), API('GET', '/api/staff')]), c = compliance(o), pend = st.filter(u => u.status === 'pending');
      app.innerHTML = hi + tiles([[p.school.avg == null ? '–' : p.school.avg + '%', 'School average'], [p.school.pupils, 'Pupils'], [p.school.attendance == null ? '–' : p.school.attendance + '%', 'Attendance'], [c.total ? Math.round(c.done / c.total * 100) + '%' : '–', 'Documents fully checked']]) +
        (pend.length ? `<a class="btn btn-solid" href="staff.html">${pend.length} account(s) waiting for your approval</a>` : '') +
        `<section><h2>Departments</h2>${p.departments.map(d => hbar(d.department, d.avg, d.teachers + ' teachers')).join('') || '<p class="muted">No marks recorded yet.</p>'}</section><section><h2>Documents by department</h2>${complianceTable(o)}</section><a class="btn btn-outline" href="school.html">Full school report</a>`;
    }
    buildNav('home');
  } catch (e) { app.innerHTML = hi + `<p class="muted">${esc(e.message)}</p>`; }
}
