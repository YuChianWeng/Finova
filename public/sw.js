/*
 * Finova 記帳 service worker（契約 §6 離線讀取）
 * - /api/ledger/catalog、/overview、最近一頁 /transactions：先走網路，失敗時回快取，並加上 X-Ledger-Cached-At 標頭
 *   讓前端顯示「離線中，資料時間 HH:MM」。
 * - 頁面本身（/finance/*）：先走網路，離線時回快取的 index.html 與靜態檔。
 * 寫入請求一律不經過快取。
 */
const VERSION = "finova-v1";
const API_CACHE = `${VERSION}-api`, APP_CACHE = `${VERSION}-app`;

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(["/finance/", "/finance/manifest.webmanifest", "/finance/icon.svg"]).catch(() => {}))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

function cacheableApi(url) {
  if (!url.pathname.startsWith("/api/ledger/")) return false;
  const p = url.pathname.slice("/api/ledger".length);
  if (p === "/catalog" || p === "/overview") return true;
  return p === "/transactions" && !url.searchParams.has("cursor"); // 只快取最近一頁
}
async function apiNetworkFirst(req) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected && (res.headers.get("Content-Type") || "").includes("json")) {
      const body = await res.clone().blob();
      const headers = new Headers(res.headers); headers.set("X-Ledger-Saved-At", new Date().toISOString());
      await cache.put(req, new Response(body, { status: 200, headers }));
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (!hit) throw err;
    const headers = new Headers(hit.headers); headers.set("X-Ledger-Cached-At", hit.headers.get("X-Ledger-Saved-At") || "");
    return new Response(await hit.blob(), { status: 200, headers });
  }
}
async function pageNetworkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") cache.put(req.mode === "navigate" ? "/finance/" : req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req.mode === "navigate" ? "/finance/" : req)) || Promise.reject(err);
  }
}
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (cacheableApi(url)) e.respondWith(apiNetworkFirst(req));
  else if (url.pathname.startsWith("/finance")) e.respondWith(pageNetworkFirst(req));
});
