const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function check(code) {
  const out = $('#result'); code = code.trim().toUpperCase(); if (!code) return;
  if (!/^[A-Z]{3}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code)) { out.innerHTML = '<p class="chip support">That is not a valid code format. Codes look like HOD-AB123-CD456.</p>'; return; }
  try {
    const r = await (await fetch('/api/verify/' + code)).json();
    out.innerHTML = r.valid ? `<div class="card"><p class="chip ready">Genuine stamp</p><h2>${esc(r.title)}</h2><p>${esc(r.kind)} by <b>${esc(r.by)}</b> (${esc(r.role)}) at ${esc(r.school)}.</p><p class="muted">${new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} · version ${esc(r.version || 1)}</p></div>` : '<p class="chip support">This code is not valid. The stamp may be forged, or the document was altered.</p>';
  } catch (e) { out.innerHTML = '<p class="chip support">Could not check the code. Check your connection.</p>'; }
}
$('#vf').addEventListener('submit', e => { e.preventDefault(); check($('#code').value); });
const c = new URLSearchParams(location.search).get('code'); if (c) { $('#code').value = c; check(c); }
