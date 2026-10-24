// Offline app shell: the page and its hashed assets are cached on install, so the app starts without
// network. Pages: network first, the cache after 3 s or offline. Hashed assets never change: cache first.
// Supabase and other origins are not touched; the app keeps its own data cache (src/lib/sync.ts).
const CACHE = 'zuhause-v2'
const SHELL = new URL('./', self.registration.scope).href

async function precache() {
  const c = await caches.open(CACHE)
  const r = await fetch(SHELL, { cache: 'no-cache' })
  if (!r.ok) return
  const html = await r.clone().text()
  await c.put(SHELL, r)
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1], SHELL)).filter((u) => u.origin === location.origin)
  await Promise.all(urls.map((u) => c.add(u.href).catch(() => null)))
}

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(precache().catch(() => null))
})
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
)

const store = (req, r) => {
  if (r.ok) {
    const copy = r.clone()
    caches.open(CACHE).then((c) => c.put(req, copy))
  }
  return r
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => store(req, r))))
    return
  }
  const page = req.mode === 'navigate' && /(\/|index\.html)$/.test(url.pathname)
  const key = page ? SHELL : req
  const net = fetch(req).then((r) => store(key, r))
  const cached = () => caches.match(key).then((r) => r || (page ? caches.match(SHELL) : undefined))
  // flaky kitchen wifi: after 3 s the cached copy answers, the network still refreshes the cache
  const late = new Promise((res) => setTimeout(() => cached().then((r) => r && res(r)), 3000))
  e.respondWith(
    Promise.race([net, late]).catch(() => cached().then((r) => r || Response.error())),
  )
  e.waitUntil(net.catch(() => null))
})

// Web Push from the push-digest Edge Function: {title, body, url: '#/route', count, tag}.
// iOS drops the subscription when a push shows nothing, so always show a notification.
self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { body: e.data ? e.data.text() : '' }
  }
  const badge = typeof d.count === 'number' && self.navigator.setAppBadge ? (d.count > 0 ? self.navigator.setAppBadge(d.count) : self.navigator.clearAppBadge()) : null
  e.waitUntil(
    Promise.all([
      Promise.resolve(badge).catch(() => null),
      self.registration.showNotification(d.title || 'zuhause', { body: d.body || '', tag: d.tag || 'zuhause', icon: 'icon-192.png', data: { url: d.url || '#/' }, lang: 'de' }),
    ]),
  )
})

// Opens the app at the notification's route: reuses an open window, else starts the app there.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '#/', self.registration.scope).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const w = list.find((c) => c.url.startsWith(self.registration.scope))
      if (!w) return self.clients.openWindow(url)
      await w.focus()
      return w.navigate(url).catch(() => self.clients.openWindow(url))
    }),
  )
})
