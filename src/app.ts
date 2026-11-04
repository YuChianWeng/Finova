/** App 核心：頁面註冊、載入／錯誤狀態、外框（側欄、標題列、底部導覽）、全域事件分派。 */
import { $, $$, esc, ic, store } from "./lib/dom";
import { app, getCatalog } from "./state";
import { current, navigate, back, href, type Route } from "./router";
import { skeleton, errorState, emptyState } from "./ui/components";
import { closeSheet, dialogOpen, dlgConfirm, dlgDismiss, runUndo, sheetOpen, toast } from "./ui/overlay";
import { openRemind, refreshRemind, bindRemind } from "./ui/remind";
import { LedgerError } from "./api/client";
import { api } from "./api/ledger";

export type View<D = any> = {
  load?: (r: Route) => Promise<D>;
  render: (d: D, r: Route) => string;
  title?: (d: D | null, r: Route) => string;
  /** 自訂標題列中間（回傳 HTML） */
  header?: (d: D | null, r: Route) => string;
  /** 渲染後要綁事件時用 */
  after?: (d: D, r: Route) => void;
  back?: string; // 手機版顯示返回鍵，值為後備路徑
  nav?: string;  // 對應哪個導覽項目
};
const views: Record<string, View> = {};
export const registerView = (name: string, v: View) => (views[name] = v);

type Handler = (el: HTMLElement, e: Event) => void | Promise<void>;
export const ACT: Record<string, Handler> = {};
export const actions = (o: Record<string, Handler>) => Object.assign(ACT, o);

const page = {
  route: null as Route | null,
  data: null as unknown,
  status: "loading" as "loading" | "ready" | "error",
  error: null as unknown,
  token: 0,
};
export const currentData = <D>() => page.data as D;
export const currentRoute = () => page.route!;

/* ------------------------------------------------------------ shell */
const NAV: [string, string, string][] = [
  ["/accounts", "帳戶總覽", "wallet"], ["", "每日明細", "cal"], ["/transactions", "全部交易", "list"], ["/reports/monthly", "報表", "chart"],
  ["/budgets", "預算", "target"], ["/reconcile", "對帳", "scale"], ["/settings", "設定", "gear"],
];
function navKey(r: Route) {
  const v = views[r.name];
  if (v?.nav != null) return v.nav;
  return ({ overview: "", accounts: "/accounts", account: "/accounts", transactions: "/transactions", transaction: "/transactions", reports: "/reports/monthly",
    budgets: "/budgets", projects: "/budgets", project: "/budgets", goals: "/budgets", goal: "/budgets", reconcile: "/reconcile" } as Record<string, string>)[r.name] ?? "/settings";
}
export function effTheme() { const t = document.documentElement.dataset.theme; if (t) return t; return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
export function setTheme(t: string) { if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; store.set("fin-theme", t); shell(); rerender(); }

export function shell() {
  const r = page.route; if (!r) return;
  const act = navKey(r);
  $("#railnav")!.innerHTML = NAV.map(([p, l, i]) => `<a href="${href(p || "")}" ${act === p ? 'aria-current="page"' : ""}>${ic(i)}${l}</a>`).join("") +
    `<div class="sep"></div><a href="/portfolio" data-a="stocks">${ic("trend")}股票<svg class="ic s" style="margin-left:auto" aria-hidden="true"><use href="#i-ext"/></svg></a>`;
  const more = ["/budgets", "/reconcile", "/settings", "/transactions"].includes(act) || r.name === "more";
  $("#tabbar")!.innerHTML =
    `<a href="${href("/accounts")}" aria-label="帳戶總覽" title="帳戶總覽" ${act === "/accounts" ? 'aria-current="page"' : ""}>${ic("wallet")}</a>` +
    `<a href="${href("")}" aria-label="每日明細" title="每日明細" ${act === "" ? 'aria-current="page"' : ""}>${ic("cal")}</a>` +
    `<button class="fab" data-a="add" aria-label="記一筆">${ic("plus")}</button>` +
    `<a href="${href("/reports/monthly")}" aria-label="報表" title="報表" ${act === "/reports/monthly" ? 'aria-current="page"' : ""}>${ic("chart")}</a>` +
    `<a href="${href("/more")}" aria-label="更多：全部交易、預算、對帳、設定" title="更多" ${more ? 'aria-current="page"' : ""}>${ic("gear")}</a>`;
  const n = app.alerts.length, dark = effTheme() === "dark";
  const themeBtn = `<button class="ibtn round" data-a="theme" aria-label="${dark ? "切換為淺色" : "切換為深色"}">${ic(dark ? "sun" : "moon")}</button>`;
  const bell = `<button class="ibtn round" data-a="bell" aria-label="待處理提醒 ${n} 項">${ic("bell")}${n ? `<span class="badge">${n}</span>` : ""}</button>`;
  const addD = `<button class="btn p only-d" data-a="add">${ic("plus")}記一筆</button>`;
  const v = views[r.name];
  const center = v?.header ? v.header(page.status === "ready" ? page.data : null, r) : `<div class="grow ctr"><h1 class="ttl">${esc(v?.title?.(page.status === "ready" ? page.data : null, r) ?? "Finova")}</h1></div>`;
  const left = v?.back ? `<button class="ibtn round only-m" data-a="back" aria-label="返回">${ic("chev-l")}</button><span class="only-d">${bell}</span>` : bell;
  $("#topin")!.innerHTML = `${left}${center}${r.name === "overview" ? `<span class="only-d">${themeBtn}</span>` : themeBtn}${addD}`;
  banners();
  const syncLabel = !app.online ? "離線中" : app.queue.length ? `${app.queue.length} 筆待同步` : "已連線";
  $("#railfoot")!.innerHTML = `<p class="eyebrow"><span class="led" style="${app.online ? "" : "background:var(--wa)"}"></span>${syncLabel}</p>`;
}
function banners() {
  const out: string[] = [];
  if (app.authExpired) out.push(`<div class="callout warn banner" role="alert">${ic("alert")}<div><b>登入已過期</b>，未送出的表單已暫存，重新登入後會自動還原。</div><button class="btn sm p" data-a="relogin">重新登入</button></div>`);
  if (!app.online) out.push(`<div class="callout warn banner" role="status">${ic("clock")}<div>離線中${app.cachedAt ? `，資料時間 ${new Date(app.cachedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" })}` : ""}。可以照常記帳，連線後自動同步；編輯、刪除與對帳暫時停用。</div></div>`);
  else if (app.cachedAt) out.push(`<div class="callout warn banner" role="status">${ic("clock")}<div>目前顯示快取資料（${new Date(app.cachedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" })}）。</div><button class="btn sm" data-a="retry">重新整理</button></div>`);
  const errs = app.queue.filter((q) => q.error).length;
  if (app.queue.length && app.online) out.push(`<div class="callout ${errs ? "warn" : "ok"} banner" role="status">${ic(errs ? "alert" : "clock")}<div>${app.queue.length} 筆離線紀錄${errs ? `，其中 ${errs} 筆送出失敗，請點開修正` : " 等待同步"}。</div><button class="btn sm" data-a="sync">${ic("undo", "s")}同步</button></div>`);
  $("#banners")!.innerHTML = out.join("");
}

/* ------------------------------------------------------------ pages */
export async function show(r: Route) {
  closeSheet();
  page.route = r;
  const v = views[r.name];
  const token = ++page.token;
  if (!v) { page.status = "ready"; page.data = null; shell(); $("#view")!.innerHTML = `<div class="card">${emptyState("找不到這個頁面", "網址可能打錯了。", `<a class="btn p" href="${href("/accounts")}">回帳戶總覽</a>`)}</div>`; return; }
  page.status = "loading"; page.data = null; page.error = null;
  shell();
  $("#view")!.innerHTML = skeleton();
  window.scrollTo(0, 0);
  try {
    await getCatalog();
    const data = v.load ? await v.load(r) : null;
    if (token !== page.token) return;
    page.data = data; page.status = "ready";
  } catch (e) {
    if (token !== page.token) return;
    page.status = "error"; page.error = e;
    if (!(e instanceof LedgerError)) console.error(e);
  }
  paint();
}
function paint() {
  const r = page.route!, v = views[r.name];
  shell();
  if (page.status === "error") { $("#view")!.innerHTML = `<div class="card">${errorState(page.error)}</div>`; return; }
  if (page.status !== "ready") return;
  $("#view")!.innerHTML = v.render(page.data, r);
  v.after?.(page.data, r);
  bindSwipe();
}
/** 只重畫（UI 狀態改變，不重新取資料） */
export function rerender() { if (page.status === "ready") { const y = window.scrollY; paint(); window.scrollTo(0, y); } }
/** 重新取資料再畫（寫入成功後呼叫）。保留捲動位置，不顯示骨架。 */
export async function reload() {
  const r = page.route; if (!r) return;
  refreshAlerts();
  const v = views[r.name]; const token = ++page.token;
  try {
    const data = v?.load ? await v.load(r) : null;
    if (token !== page.token) return;
    page.data = data; page.status = "ready"; page.error = null;
  } catch (e) {
    if (token !== page.token) return;
    const code = (e as LedgerError)?.code;
    // 離線或暫時失敗時，保留目前畫面上的資料（banner 已提示）
    if (page.status === "ready" && (code === "OFFLINE" || code === "NETWORK" || code === "AUTH_EXPIRED")) { rerender(); return; }
    page.status = "error"; page.error = e;
  }
  const y = window.scrollY; paint(); window.scrollTo(0, y);
}
export async function refreshAlerts() {
  try { const o = await api.overview(); app.alerts = o.alerts; shell(); refreshRemind(); } catch { /* 提醒失敗不影響頁面 */ }
}
export const go = (p: string, replace = false) => navigate(p, { replace });

/* ------------------------------------------------------------ swipe（手機往左滑出編輯／刪除） */
function bindSwipe() {
  $$<HTMLElement>("#view .sw").forEach((sw) => {
    const row = sw.querySelector<HTMLElement>(".tx"); if (!row || row.dataset.b || !sw.querySelector(".sw-acts")) return; row.dataset.b = "1";
    let x0: number | null = null, y0 = 0, dx = 0, drag = false, base = 0;
    row.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" && matchMedia("(min-width:960px)").matches) return; x0 = e.clientX; y0 = e.clientY; dx = 0; drag = false; base = sw.classList.contains("open") ? -136 : 0; });
    row.addEventListener("pointermove", (e) => {
      if (x0 == null) return; const mx = e.clientX - x0, my = e.clientY - y0;
      if (!drag) { if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { drag = true; try { row.setPointerCapture(e.pointerId); } catch { /* */ } row.style.transition = "none"; } else if (Math.abs(my) > 10) { x0 = null; return; } else return; }
      dx = mx; row.style.transform = `translateX(${Math.max(-160, Math.min(0, base + dx))}px)`;
    });
    const end = () => {
      if (x0 == null) return; x0 = null; row.style.transition = ""; if (!drag) return;
      const open = base + dx < -60;
      $$<HTMLElement>(".sw.open").forEach((o) => { if (o !== sw) { o.classList.remove("open"); o.querySelector<HTMLElement>(".tx")!.style.transform = ""; } });
      sw.classList.toggle("open", open); row.style.transform = open ? "translateX(-136px)" : ""; row.dataset.dragged = "1"; setTimeout(() => delete row.dataset.dragged, 60);
    };
    row.addEventListener("pointerup", end); row.addEventListener("pointercancel", end);
  });
}

/* ------------------------------------------------------------ global events */
actions({
  back() { back(views[page.route?.name ?? ""]?.back ?? "/accounts"); },
  retry() { show(current()); },
  theme() { setTheme(effTheme() === "dark" ? "light" : "dark"); },
  "set-theme"(el) { setTheme(el.dataset.v!); },
  stocks(_el, e) { e.preventDefault(); toast("前往「股票」區塊（財富儀表板的另一個區塊：/portfolio）"); },
  toast(el) { toast(esc(el.dataset.msg)); },
  closeall() { if (dialogOpen()) { dlgDismiss(); return; } closeSheet(); },
  "dlg-ok"() { dlgConfirm(); },
  "dlg-cancel"() { dlgDismiss(); },
  undo() { runUndo(); },
  sfull() { $("#sheet")!.classList.toggle("full"); },
  // 鈴鐺：在目前頁面開啟待處理面板，不換頁、不捲動（issue #7）；開啟時順便更新提醒
  bell(el) { openRemind(el); refreshAlerts(); },
  go(el) { navigate(el.dataset.to!); },
});

export function startEvents() {
  bindRemind();
  document.addEventListener("click", (e) => {
    const el = (e.target as Element).closest?.("[data-a]") as HTMLElement | null; if (!el) return;
    const f = ACT[el.dataset.a!]; if (!f) return;
    if (el.tagName === "A") e.preventDefault();
    Promise.resolve(f(el, e)).catch((err) => handleError(err));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (sheetOpen() || dialogOpen())) ACT.closeall(document.body, e); });
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => shell());
}

/** 寫入失敗的共通處理（表單會自己處理欄位錯誤，這裡處理其餘） */
export function handleError(err: unknown) {
  const e = err as LedgerError;
  if (!(e instanceof LedgerError)) { console.error(err); toast("發生未預期的錯誤"); return; }
  if (e.code === "AUTH_EXPIRED") return; // banner 已顯示
  if (e.code === "UNKNOWN_ACCOUNT" || e.code === "UNKNOWN_CATEGORY" || e.code === "UNKNOWN_PROJECT") { getCatalog(true).then(() => rerender()); }
  if (e.code === "NOT_FOUND") { toast(esc(e.message)); return; }
  if (e.code === "DB_BUSY" || e.code === "WRITE_SERVICE_UNAVAILABLE") { toast(`${esc(e.message)}（已自動重試 2 次）`); return; }
  toast(esc(e.message || e.code));
}
