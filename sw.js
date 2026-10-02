'use strict';
// 离线壳。两条硬规矩，都是被咬过之后写下来的：
//  1. 同源子资源一律**网络优先、失败退缓存**。手工版本号 + cache-first 会把 js/css 永久
//     钉死在旧版，出新 HTML 配旧 JS，玩家看到的是没人复现过的鬼状态。
//  2. 缓存名带版本号；activate 时把别的版本整批删掉，不留残骸。
// 预缓存只放"首屏必需"的那几张，其余按需回填，断网二次打开同样能用。

const VERSION = 'v1';
const CACHE = `nonogram-${VERSION}`;
const CORE = [
  './',
  './index.html',
  './css/game.css',
  './js/main.js',
  './js/theme.js',
  './js/store.js',
  './js/ui/game.js',
  './js/render/board.js',
  './js/audio/synth.js',
  './js/engine/line.js',
  './js/engine/rng.js',
  './js/engine/generate.js',
  './js/engine/art.js',
  './js/sw-register.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './assets/textures/paper-grain.png',
  './assets/textures/spark.png',
  './assets/textures/hud-icons.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // 带 query 的导航（?mode=daily）不缓存，否则快捷方式会退回上一次那张图。
  if (url.search) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
