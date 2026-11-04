/** 進入點：載入 mock（開發）、主題、路由、連線／離線同步、登入過期。 */
import "./styles.css";
import { setNow, today, monthOf } from "./lib/dates";
import { app, ui } from "./state";
import { onClientEvent } from "./api/client";
import * as queue from "./api/offline";
import { startRouter, current, BASE } from "./router";
import { show, shell, startEvents, actions, reload, rerender, refreshAlerts } from "./app";
import { bindChartHover } from "./ui/charts";
import { restoreDraft } from "./ui/entry";
import { toast } from "./ui/overlay";
import { bindPullToRefresh } from "./ui/ptr";
import "./views/accounts";
import "./views/overview";
import "./views/transactions";
import "./views/reports";
import "./views/budgets";
import "./views/reconcile";
import "./views/settings";

const MOCK = import.meta.env.VITE_USE_MOCK === "true";

async function boot() {
  if (MOCK) {
    const [m, db] = await Promise.all([import("../mocks/browser"), import("../mocks/db")]);
    m.installMock();
    setNow(new Date(db.MOCK_NOW)); // mock 資料固定在 2026-11-03
    console.info("[Finova] 使用 mock API（mocks/）。接真實後端：npm run dev:api");
  }
  readLaunchSource();
  ui.cal = { month: monthOf(today()), sel: today(), col: false };
  ui.rec.date = today();
  app.online = navigator.onLine;

  onClientEvent((e) => {
    if (e.type === "auth-expired" && !app.authExpired) { app.authExpired = true; shell(); }
    if (e.type === "cache" && e.at !== app.cachedAt) { app.cachedAt = e.at; shell(); }
  });
  const syncQueue = async () => {
    app.queue = await queue.list(); shell();
    if (!app.online || !app.queue.length) return;
    const r = await queue.flush();
    if (r.sent) { toast(`已同步 ${r.sent} 筆離線紀錄`); reload(); }
    if (r.failed) toast(`${r.failed} 筆離線紀錄送出失敗，請點開修正`);
  };
  queue.onQueueChange(async () => { app.queue = await queue.list(); shell(); rerender(); });
  window.addEventListener("online", () => { app.online = true; shell(); syncQueue(); reload(); });
  window.addEventListener("offline", () => { app.online = false; shell(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncQueue(); });

  actions({
    relogin() {
      if (MOCK) { app.authExpired = false; shell(); reload(); restoreDraft(); return; }
      location.href = `/cdn-cgi/access/login?redirect_url=${encodeURIComponent(location.href)}`;
    },
  });

  startEvents();
  bindChartHover();
  // 下拉更新：總覽、帳戶、明細頁（只在主畫面 App 模式啟用）
  const PTR_PAGES = new Set(["overview", "accounts", "account", "transactions"]);
  bindPullToRefresh({ enabled: () => PTR_PAGES.has(current().name), refresh: async () => { await syncQueue(); await reload(); } });
  startRouter(show, `${BASE}/accounts`);
  app.queue = await queue.list();
  refreshAlerts();
  syncQueue();
  restoreDraft();

  if (import.meta.env.PROD && !MOCK && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => { /* SW 失敗不影響使用 */ });
  }
}
/** manifest start_url 帶 ?source=pwa：記下來源（整個分頁期間有效），再從網址拿掉，避免被複製或加進書籤 */
function readLaunchSource() {
  try {
    const u = new URL(location.href);
    if (u.searchParams.get("source") === "pwa") {
      sessionStorage.setItem("finova-source", "pwa");
      u.searchParams.delete("source");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    app.source = sessionStorage.getItem("finova-source") === "pwa" ? "pwa" : "web";
  } catch { /* sessionStorage 不能用時當成 web */ }
}
boot();
