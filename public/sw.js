/* Service worker: lets the app open offline once loaded. It never stores API answers (private data). Change CACHE to force an update. */
const CACHE = 'teacher-platform-v3';
const FILES = ["./", "account.html", "assessment-new.html", "assessments.html", "assignments.html", "assistant.html", "attendance.html", "dashboard.html", "documents.html", "exercises.html", "index.html", "learner.html", "learners.html", "lesson-plan-new.html", "marks.html", "materials.html", "more.html", "paper.html", "plan-view.html", "plans.html", "privacy.html", "records.html", "register.html", "reminders.html", "reports.html", "review.html", "scan.html", "schemes.html", "school.html", "settings.html", "staff.html", "verify.html", "workplan.html", "styles.css", "data.js", "net.js", "zambia.js", "files.js", "extra.js", "tools.js", "roles.js", "pages.js", "script.js", "auth.js", "verify.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('dashboard.html'))));
});
