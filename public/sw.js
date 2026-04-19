// Service Worker - Cache Strategy
const CACHE_NAME = 'live-tracker-v5-evttype-normalize';

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
