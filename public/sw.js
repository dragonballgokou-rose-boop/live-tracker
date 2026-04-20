// Service Worker - Cache Strategy
const CACHE_NAME = 'live-tracker-v7-push-fix';

const ASSETS = [
    '/',
    '/index.html',
    '/index.css',
    '/main.js',
    '/manifest.json'
];

// 公式ライブ JSON は毎回ネットワーク必須（キャッシュさせない）
function shouldBypassCache(url) {
    return url.pathname.endsWith('/official-lives.json') || url.search.includes('v=');
}

// Install
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch - Network first, fallback to cache (except for official-lives.json)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // 公式ライブ JSON はキャッシュさせず常にネットワーク
    if (shouldBypassCache(url)) {
        event.respondWith(fetch(event.request));
        return;
    }
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

// ============================================
// Web Push 通知
// ============================================
// payload 形式: { title, body, url?, tag?, icon? }

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
    const title = data.title || '推しメンちぇっく';
    const options = {
        body: data.body || '',
        icon: data.icon || '/icon.svg',
        badge: '/icon.svg',
        tag:  data.tag || undefined,
        data: { url: data.url || '/' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // 既にアプリタブがあればそれを focus + navigate
        for (const client of all) {
            if ('focus' in client) {
                try {
                    await client.focus();
                    if ('navigate' in client && target && target !== '/') await client.navigate(target);
                    return;
                } catch { /* fallthrough */ }
            }
        }
        await self.clients.openWindow(target);
    })());
});
