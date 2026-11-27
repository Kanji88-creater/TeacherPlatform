const BASE = location.pathname.replace(/\/+$/, '');
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = t => { $('#msg').textContent = t; };
async function api(m, p, body) {
  const r = await fetch(BASE + '/api' + p, { method: m, headers: { 'x-td': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error ' + r.status); return j;
}
async function load() {
  try {
    const d = await api('GET', '/schemes'); $('#loginBox').hidden = true; $('#tools').hidden = false;
    $('#stats').textContent = d.stats.schools + ' school(s), ' + d.stats.users + ' user(s) registered.';
    $('#list').innerHTML = d.schemes.map(s => `<div class="item"><span><b>${esc(s.title)}</b><small>Grade ${esc(s.grade)} · ${esc(s.subject)} · ${esc(s.term)} · ${s.rows.length} weeks</small></span><button class="btn btn-danger btn-sm" data-del="${esc(s.id)}">Delete</button></div>`).join('') || '<p class="muted">None yet.</p>';
    $('#files').innerHTML = d.files.map(f => `<div class="item"><span><b>${esc(f.title)}</b><small>${esc(f.name)} · ${esc(f.subject)} ${esc(f.grade)} ${esc(f.term)}</small></span><button class="btn btn-danger btn-sm" data-delf="${esc(f.id)}">Delete</button></div>`).join('') || '<p class="muted">None yet.</p>';
  } catch (e) { $('#loginBox').hidden = false; $('#tools').hidden = true; }
}
$('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const f = e.target; try { await api('POST', '/login', { user: f.user.value, pass: f.pass.value }); f.reset(); load(); } catch (x) { $('#loginErr').textContent = x.message; } });
const parseRows = t => t.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(/\s*\|\s*|\t/); return { week: p[0] || '', topic: p[1] || '', outcomes: p[2] || '', methods: p[3] || '', aids: p[4] || '', assess: p[5] || '' }; });
$('#schemeForm').addEventListener('submit', async e => { e.preventDefault(); const f = e.target; try { await api('POST', '/schemes', { schemes: [{ title: f.title.value.trim(), grade: f.grade.value.trim(), subject: f.subject.value.trim(), term: f.term.value.trim(), rows: parseRows(f.rows.value) }] }); f.reset(); say('Published.'); load(); } catch (x) { say(x.message); } });
function csvRows(text) { const out = []; let row = [], cur = '', q = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim())) out.push(row); row = []; } else cur += c; } row.push(cur); if (row.some(x => x.trim())) out.push(row); return out; }
$('#csvFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const rows = csvRows(await f.text()), head = rows.shift().map(h => h.trim().toLowerCase()), ix = k => head.indexOf(k), g = {};
    rows.forEach(r => { const v = k => (r[ix(k)] || '').trim(), key = [v('grade'), v('subject'), v('term')].join('|'); const s = g[key] = g[key] || { title: v('subject') + ' Grade ' + v('grade') + ' ' + v('term'), grade: v('grade'), subject: v('subject'), term: v('term'), rows: [] }; s.rows.push({ week: v('week'), topic: v('topic'), outcomes: v('outcomes'), methods: v('methods'), aids: v('aids'), assess: v('assessment'), refs: v('references') }); });
    const list = Object.values(g); await api('POST', '/schemes', { schemes: list }); say(list.length + ' scheme(s) published.'); e.target.value = ''; load();
  } catch (x) { say('Could not read that CSV: ' + x.message); }
});
$('#fileForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, file = f.file.files[0]; if (!file) return;
  if (file.size > 15 * 1048576) { say('That file is over 15 MB.'); return; }
  const buf = new Uint8Array(await file.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
  try { await api('POST', '/files', { title: f.title.value.trim(), grade: f.grade.value.trim(), subject: f.subject.value.trim(), term: f.term.value.trim(), name: file.name, mime: file.type, data: btoa(bin) }); f.reset(); say('Uploaded.'); load(); } catch (x) { say(x.message); }
});
document.addEventListener('click', async e => {
  const a = e.target.dataset; if (a.del && confirm('Delete this scheme?')) { await api('DELETE', '/schemes/' + encodeURIComponent(a.del)); load(); }
  if (a.delf && confirm('Delete this document?')) { await api('DELETE', '/files/' + a.delf); load(); }
});
load();
