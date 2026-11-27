/* Sign up and sign in for the four roles. */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let mode = 'login';
async function api(m, p, body) {
  const r = await fetch(p, { method: m, credentials: 'same-origin', headers: { 'x-td': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.'); return j;
}
const DEFAULT_DEPTS = ['Mathematics', 'Sciences', 'Languages', 'Social Sciences', 'Business and Practical Subjects', 'Creative and Expressive Arts', 'Primary Section'];
function setMode(m) {
  mode = m; $('#tLogin').setAttribute('aria-selected', m === 'login'); $('#tSignup').setAttribute('aria-selected', m === 'signup');
  $('#signupOnly').hidden = m === 'login'; $('#go').textContent = m === 'login' ? 'Sign in' : 'Create account'; $('#err').textContent = '';
  $('[name=password]').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password'); if (m === 'signup') roleFields();
}
function roleFields() {
  const r = $('[name=role]').value;
  $('#headFields').hidden = r !== 'head'; $('#staffFields').hidden = r === 'head'; $('#deptRow').hidden = !(r === 'hod' || r === 'teacher');
}
async function lookup() {
  const code = $('[name=schoolCode]').value.trim().toUpperCase(), out = $('#schoolName'), sel = $('[name=department]');
  if (code.length < 4) { out.textContent = ''; return; }
  try { const s = await api('GET', '/api/school/' + encodeURIComponent(code)); out.textContent = 'School: ' + s.name; sel.innerHTML = s.departments.map(d => `<option>${esc(d)}</option>`).join(''); }
  catch (e) { out.textContent = e.message; sel.innerHTML = ''; }
}
async function enter(me) { localStorage.setItem('td-session', JSON.stringify(me)); location.href = 'dashboard.html'; }
$('#tLogin').onclick = () => setMode('login'); $('#tSignup').onclick = () => setMode('signup');
$('[name=role]').onchange = roleFields; $('[name=schoolCode]').addEventListener('input', lookup);
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, err = $('#err'); err.textContent = ''; $('#go').disabled = true;
  try {
    if (mode === 'login') { enter(await api('POST', '/api/login', { email: f.email.value, password: f.password.value })); return; }
    const role = f.role.value, body = { role, name: f.name.value, email: f.email.value, password: f.password.value };
    if (role === 'head') { body.schoolName = f.schoolName.value; body.departments = f.departments.value.split('\n'); } else { body.schoolCode = f.schoolCode.value; body.department = f.department.value; }
    const r = await api('POST', '/api/signup', body);
    if (r.pending) { $('#formBox').hidden = true; $('#doneBox').hidden = false; $('#doneMsg').textContent = 'Your account was created. It must be approved by your school before you can sign in. Ask your ' + (role === 'teacher' ? 'HOD or Head teacher' : 'Head teacher') + ' to approve it.'; }
    else { const me = await api('GET', '/api/me'); localStorage.setItem('td-session', JSON.stringify(me)); $('#formBox').hidden = true; $('#doneBox').hidden = false; $('#doneMsg').innerHTML = 'Your school is ready. Your school code is <b class="code">' + esc(r.schoolCode) + '</b>. Give it to your Deputy Head, HODs and teachers so they can sign up. You approve every new account.'; $('#doneLink').hidden = false; }
  } catch (x) { err.textContent = x.message; } finally { $('#go').disabled = false; }
});
(async () => { try { const me = await api('GET', '/api/me'); localStorage.setItem('td-session', JSON.stringify(me)); $('#openBox').hidden = false; $('#formBox').hidden = true; $('#welcome').textContent = 'Signed in as ' + me.name + ' (' + me.role + ').'; } catch (e) { localStorage.removeItem('td-session'); } })();
$('#out').onclick = async () => { try { await api('POST', '/api/logout'); } catch (e) {} localStorage.removeItem('td-session'); location.reload(); };
setMode('login');
