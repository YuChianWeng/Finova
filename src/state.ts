/** 全域狀態：catalog 快取（5 分鐘，契約 §2.1）、連線狀態、各頁面的 UI 狀態。 */
import type * as L from "./types/ledger";
import { api } from "./api/ledger";
import { setCurrencies } from "./lib/money";
import type { QueueItem } from "./api/offline";
import { today, monthOf } from "./lib/dates";
import { store } from "./lib/dom";
const CATALOG_KEY = "finova-catalog";

export const app = {
  catalog: null as L.Catalog | null,
  catalogAt: 0,
  alerts: [] as L.Alert[],
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  authExpired: false,
  cachedAt: null as string | null,
  queue: [] as QueueItem[],
  hide: false,
  /** 開啟來源：從主畫面圖示開啟時 manifest 的 start_url 帶 ?source=pwa */
  source: "web" as "web" | "pwa",
};

const CATALOG_TTL = 5 * 60 * 1000;
let catalogP: Promise<L.Catalog> | null = null;
export async function getCatalog(force = false): Promise<L.Catalog> {
  if (!force && app.catalog && Date.now() - app.catalogAt < CATALOG_TTL) return app.catalog;
  if (catalogP && !force) return catalogP;
  catalogP = api.catalog().then((c) => {
    app.catalog = c; app.catalogAt = Date.now();
    setCurrencies(c.currencies);
    store.set(CATALOG_KEY, JSON.stringify({ at: new Date().toISOString(), c }));
    return c;
  }).catch((e) => {
    // 離線且 service worker 也沒有快取時，退回這台裝置上次的選單資料，讓離線記帳仍可用
    const saved = app.catalog ? null : store.get(CATALOG_KEY);
    if (app.catalog) return app.catalog;
    if (saved) { try { const { at, c } = JSON.parse(saved); app.catalog = c; app.cachedAt = at; setCurrencies(c.currencies); return c as L.Catalog; } catch { /* ignore */ } }
    throw e;
  }).finally(() => { catalogP = null; });
  return catalogP;
}
export const invalidateCatalog = () => { app.catalogAt = 0; };

/* ------------------------- catalog 查詢 ------------------------- */
type CatAny = L.CategoryNode | L.CategoryLeaf;
export function findCat(key: string | null | undefined): CatAny | null {
  if (!key || !app.catalog) return null;
  for (const m of app.catalog.categories) {
    if (m.category_key === key) return m;
    const c = m.children.find((x) => x.category_key === key);
    if (c) return c;
  }
  return null;
}
export function mainCat(key: string | null | undefined): L.CategoryNode | null {
  if (!key || !app.catalog) return null;
  const main = key.split(".")[0];
  return app.catalog.categories.find((m) => m.category_key === main) ?? null;
}
export const catLabel = (key: string | null | undefined) => {
  const c = findCat(key); if (!c) return key ?? "";
  const m = mainCat(key);
  return m && m.category_key !== c.category_key ? `${m.name} › ${c.name}` : c.name;
};
export const accOpt = (key: string | null | undefined) => app.catalog?.accounts.find((a) => a.account_key === key) ?? null;
export const accName = (key: string | null | undefined) => accOpt(key)?.name ?? key ?? "—";
export const tagName = (id: string) => app.catalog?.tags.find((t) => t.tag_id === id)?.name ?? id;

/* ------------------------- UI 狀態 ------------------------- */
export const ui = {
  cal: { month: monthOf(today()), sel: today(), col: false },
  accPeriod: "week" as "week" | "month",
  accPie: false as false | "group" | "cur",
  accRange: "3M" as "1M" | "3M" | "1Y" | "ALL",
  donut: null as string | null,
  rp: { cmp: true, ex: false },
  hid: new Set<string>(),
  budEdit: false,
  batch: false,
  sel: new Set<number>(),
  rec: { step: 1, acc: null as string | null, actual: "", date: today(), err: null as string | null, showTx: false,
    preview: null as L.ReconcilePreview | null, result: null as null | { reconciliation: L.Reconciliation; adjustment: L.Transaction | null } },
};
