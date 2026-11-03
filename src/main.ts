/** 進入點：載入 mock（開發）、主題、路由、連線／離線同步、登入過期。 */
import "./styles.css";
import { setNow, today, monthOf } from "./lib/dates";
import { app, ui } from "./state";
import { onClientEvent } from "./api/client";
import * as queue from "./api/offline";
import { startRouter, BASE } from "./router";
import { show, shell, startEvents, actions, reload, rerender, refreshAlerts } from "./app";
import { bindChartHover } from "./ui/charts";
import { restoreDraft } from "./ui/entry";
import { toast } from "./ui/overlay";
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
  startRouter(show, `${BASE}/accounts`);
  app.queue = await queue.list();
  refreshAlerts();
  syncQueue();
  restoreDraft();

  if (import.meta.env.PROD && !MOCK && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => { /* SW 失敗不影響使用 */ });
  }
}
boot();
