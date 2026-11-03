/**
 * 在瀏覽器內攔截 fetch('/api/ledger/*')，交給 handlers.ts 回應。
 * 不用 service worker，所以在一般開發、單檔預覽版都能用。
 *
 * 錯誤模擬（契約 §7 必須模擬的錯誤）：設定頁的「開發用 Mock」或網址加 ?mock=<情境>
 *   validation   下一次寫入回 VALIDATION_ERROR（欄位錯誤）
 *   version      下一次修改／刪除回 VERSION_CONFLICT（模擬別處先改過）
 *   idempotency  下一次新增回 IDEMPOTENCY_CONFLICT
 *   auth         下一個請求被導向 Cloudflare 登入頁（回 HTML）→ AUTH_EXPIRED
 *   busy         寫入回 503 兩次後成功（看自動重試）
 *   down         寫入一律回 503（看重試按鈕）
 *   offline      模擬離線（navigator.onLine=false，請求失敗）
 *   slow         每個請求延遲 1.2 秒（看載入狀態）
 */
import { handle, fail, bumpElsewhere, type MockResponse } from "./handlers";

export type Scenario = "none" | "validation" | "version" | "idempotency" | "auth" | "busy" | "down" | "offline" | "slow";
export const SCENARIOS: [Scenario, string][] = [
  ["none", "正常"], ["slow", "延遲 1.2 秒"], ["validation", "欄位錯誤"], ["version", "版本衝突"], ["idempotency", "冪等衝突"],
  ["auth", "登入過期"], ["busy", "503 後成功"], ["down", "503 持續"], ["offline", "離線"],
];
const KEY = "finova-mock-scenario";
let scenario: Scenario = "none";
let busyCount = 0;
let fakeOffline = false;

const read = () => { try { return (sessionStorage.getItem(KEY) as Scenario) || "none"; } catch { return "none"; } };
export const getScenario = () => scenario;
export function setScenario(s: Scenario) {
  scenario = s; busyCount = 0;
  try { sessionStorage.setItem(KEY, s); } catch { /* ignore */ }
  const wasOffline = fakeOffline;
  fakeOffline = s === "offline";
  if (wasOffline !== fakeOffline) window.dispatchEvent(new Event(fakeOffline ? "offline" : "online"));
}
/** 一次性情境觸發後自動回到正常 */
const once = () => setScenario("none");

const json = (r: MockResponse) => new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
  status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", ...(r.headers ?? {}) },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installMock() {
  const fromUrl = new URLSearchParams(location.search).get("mock") as Scenario | null;
  setScenario(fromUrl ?? read());
  const realOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  try {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => (fakeOffline ? false : realOnLine?.get?.call(navigator) ?? true) });
  } catch { /* 某些瀏覽器不允許，忽略 */ }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (!url.pathname.startsWith("/api/ledger")) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const path = url.pathname.slice("/api/ledger".length) || "/";
    const query = Object.fromEntries(url.searchParams.entries());
    let body: unknown = undefined;
    if (init?.body && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const write = method !== "GET";

    await sleep(scenario === "slow" ? 1200 : 120 + Math.random() * 120);
    if (fakeOffline) throw new TypeError("Failed to fetch (mock offline)");
    if (scenario === "auth") { once(); return new Response("<!doctype html><title>Cloudflare Access</title><p>Sign in", { status: 200, headers: { "Content-Type": "text/html" } }); }
    if (write && scenario === "busy") { if (busyCount++ < 2) return json(fail(503, "DB_BUSY", "資料庫忙碌中")); once(); }
    if (write && scenario === "down") return json(fail(503, "WRITE_SERVICE_UNAVAILABLE", "寫入服務暫時無法使用"));
    if (write && scenario === "validation" && (method === "POST" || method === "PATCH")) {
      once();
      const field = path.startsWith("/transfers") ? "amount_out" : path.startsWith("/reconciliations") ? "actual" : "amount";
      return json(fail(400, "VALIDATION_ERROR", "有欄位需要修正", { [field]: ["（模擬）金額超過單筆上限 NT$ 100,000"], merchant: ["（模擬）商家名稱含有不支援的字元"] }));
    }
    if (write && scenario === "idempotency" && method === "POST" && /^\/(transactions|transfers)$/.test(path)) { once(); return json(fail(409, "IDEMPOTENCY_CONFLICT", "這筆已經以不同內容送出過")); }
    if (write && scenario === "version" && (method === "PATCH" || method === "DELETE")) {
      const id = Number(path.match(/^\/transactions\/(\d+)/)?.[1]);
      if (id) { once(); bumpElsewhere(id); }
    }
    return json(handle(method, path, query, body));
  };
}
