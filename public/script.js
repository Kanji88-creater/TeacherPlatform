/* Dashboard: a short, clear summary for each role. Needs data.js, net.js, zambia.js, files.js, roles.js. */
const state = { view: 'trend' };
const greetName = () => USER ? ', ' + esc(USER.split(' ')[0]) : '';
function dashHead() {
  return `<header class="top"><div><p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Good morning${greetName()}</h1></div>${S.classes.length ? `<select id="classSelect" aria-label="Choose class">${S.classes.map(k => `<option value="${k.id}"${k.id === S.cur ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select>` : ''}</header>`;
}
function render() {
  if (!TEACH || (ROLE === 'hod' && !rq('me'))) { roleDashboard(); return; }
  const c = cls(), app = $('#app');
  if (!c) { app.innerHTML = dashHead() + '<div class="card stack"><h2>Welcome</h2><p>Start by adding your class and your pupils. Then you can take attendance and record marks.</p><a class="btn btn-solid" href="learners.html">Add my first class</a></div>'; buildNav('home'); return; }
  const as = S.assess.filter(a => a.classId === c.id), st = pupilStats(c), at = attCount(c), rate = at.pr + at.ab ? Math.round(at.pr / (at.pr + at.ab) * 100) + '%' : '–';
  const waiting = MYSUBS.filter(s => s.status === 'submitted').length, returned = MYSUBS.filter(s => s.status === 'returned').length, checked = MYSUBS.filter(s => s.status === 'hod_checked' || s.status === 'batched' || s.status === 'dht_checked').length;
  const todo = alerts().sort((a, b) => ({ high: 0, med: 1, low: 2 })[a.lvl] - ({ high: 0, med: 1, low: 2 })[b.lvl]).slice(0, 4), lab = { high: 'Urgent', med: 'Check', low: 'Note' }, cl = { high: 'support', med: 'watch', low: 'draft' };
  const d = state.view === 'week' ? weekly(as) : termly(as), t = classTrend(c);
  const chartHtml = state.view === 'trend' ? multiLine(t.labels, t.series) : '<div class="chart">' + chart(d.labels, d.vals) + '</div>';
  app.innerHTML = dashHead() + (ROLE === 'hod' ? '<a class="btn btn-outline" href="dashboard.html">Back to department view</a>' : '') + `
  <section class="stats" aria-label="Summary">
    <div class="stat"><b>${c.pupils.length}</b><span>Pupils in ${esc(c.name)}</span></div>
    <div class="stat"><b>${st ? st.mean + '%' : '–'}</b><span>Class average</span></div>
    <div class="stat"><b>${rate}</b><span>Attendance</span></div>
    <div class="stat"><b>${returned || waiting}</b><span>${returned ? 'Documents to correct' : 'Documents with HOD'}</span></div>
  </section>
  <section class="actions" aria-label="Quick actions"><a class="btn btn-solid" href="attendance.html">Take attendance</a><a class="btn btn-solid" href="marks.html">Enter marks</a><a class="btn btn-outline" href="lesson-plan-new.html">New lesson plan</a><a class="btn btn-outline" href="assessment-new.html">New test</a></section>
  <section><h2>Do these next</h2><div class="stack">${todo.map(x => item(x.link, esc(x.text), '', `<span class="pill ${cl[x.lvl]}">${lab[x.lvl]}</span>`)).join('') || '<p class="chip ready">You are up to date.</p>'}</div>${alerts().length > 4 ? '<a class="btn btn-outline" href="reminders.html" style="margin-top:8px">See all reminders</a>' : ''}</section>
  <section class="card"><div class="row"><h2>How the class is doing</h2><div class="tabs" role="tablist"><button role="tab" data-view="trend" aria-selected="${state.view === 'trend'}">Trend</button><button role="tab" data-view="week" aria-selected="${state.view === 'week'}">Week</button><button role="tab" data-view="term" aria-selected="${state.view === 'term'}">Term</button></div></div><p class="muted">${esc(trendNote(c))}</p>${chartHtml}</section>
  <section><h2>Pupils</h2><div class="stack">${st ? item('learner.html?id=' + st.top.p.id, 'Top performer', esc(st.top.p.name), pill(st.top.v)) + item('reports.html', 'Class average', st.n + ' pupils with marks', pill(st.mean)) + item('learner.html?id=' + st.low.p.id, 'Needs most help', esc(st.low.p.name), pill(st.low.v)) : '<p class="muted">Enter marks to see the top, average and lowest results.</p>'}</div></section>
  <section class="card"><h2>My documents</h2><p class="muted">Sent to your ${ROLE === 'hod' ? 'Deputy Head' : 'HOD'} for checking</p><div class="stats"><div class="stat"><b>${waiting}</b><span>Waiting</span></div><div class="stat"><b>${returned}</b><span>Returned</span></div><div class="stat"><b>${checked}</b><span>Checked</span></div></div><a class="btn btn-outline" href="documents.html" style="margin-top:8px">Open my documents</a></section>`;
  buildNav('home'); hydratePhotos();
  try { if ('Notification' in window && Notification.permission === 'granted' && alerts().length && localStorage.getItem('td-notified') !== iso(new Date())) { localStorage.setItem('td-notified', iso(new Date())); notify(alerts().length + ' item(s) need your attention.'); } } catch (e) {}
}
document.addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { state.view = b.dataset.view; render(); } });
document.addEventListener('change', e => { if (e.target.id === 'classSelect') { S.cur = e.target.value; save(); render(); } });
render();
