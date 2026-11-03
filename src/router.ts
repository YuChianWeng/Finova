/**
 * 前端路由（契約 §8）。頁面在 /finance 之下：
 *   history 模式：真的網址（正式環境，伺服器要把 /finance/* 都回 index.html）
 *   memory 模式：網址不變，只在記憶體裡切換（單檔預覽版）
 */
export const BASE = "/finance";
export type Route = { name: string; params: Record<string, string>; query: URLSearchParams; path: string };

const TABLE: [RegExp, string, string[]][] = [
  [/^\/?$/, "overview", []],
  [/^\/accounts\/?$/, "accounts", []],
  [/^\/accounts\/([^/]+)$/, "account", ["key"]],
  [/^\/transactions\/?$/, "transactions", []],
  [/^\/transactions\/(\d+)$/, "transaction", ["id"]],
  [/^\/new$/, "new", []],
  [/^\/reports\/?$/, "reports", []],
  [/^\/reports\/(daily|weekly|monthly|range|trend)$/, "reports", ["mode"]],
  [/^\/budgets$/, "budgets", []],
  [/^\/projects$/, "projects", []],
  [/^\/projects\/([^/]+)$/, "project", ["id"]],
  [/^\/goals$/, "goals", []],
  [/^\/goals\/([^/]+)$/, "goal", ["id"]],
  [/^\/reconcile$/, "reconcile", []],
  [/^\/settings$/, "settings", []],
  [/^\/settings\/accounts$/, "settings-accounts", []],
  [/^\/settings\/accounts\/opening$/, "opening", []],
  [/^\/settings\/categories$/, "categories", []],
  [/^\/settings\/tags$/, "tags", []],
  [/^\/settings\/recurring$/, "recurring", []],
  [/^\/settings\/trash$/, "trash", []],
  [/^\/more$/, "more", []],
];

export function parse(full: string): Route {
  const u = new URL(full, "http://x");
  let p = u.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  p = p.replace(/\/+$/, "") || "/";
  for (const [re, name, keys] of TABLE) {
    const m = p.match(re);
    if (m) return { name, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), query: u.searchParams, path: BASE + (p === "/" ? "" : p) + u.search };
  }
  return { name: "notfound", params: {}, query: u.searchParams, path: BASE + p + u.search };
}

const MODE = (import.meta.env.VITE_ROUTER as string) === "memory" ? "memory" : "history";
let memStack: string[] = [];
let listener: (r: Route) => void = () => {};

export function current(): Route {
  if (MODE === "memory") return parse(memStack[memStack.length - 1] ?? BASE);
  return parse(location.pathname + location.search);
}
export function navigate(path: string, opt: { replace?: boolean } = {}) {
  let full = path.startsWith(BASE) ? path : BASE + (path.startsWith("/") ? path : "/" + path);
  if (full === BASE || full.startsWith(BASE + "?")) full = BASE + "/" + full.slice(BASE.length);
  if (MODE === "memory") {
    if (opt.replace && memStack.length) memStack[memStack.length - 1] = full; else memStack.push(full);
  } else if (opt.replace) history.replaceState(null, "", full);
  else history.pushState(null, "", full);
  listener(current());
}
export function back(fallback = "/accounts") {
  if (MODE === "memory") { if (memStack.length > 1) { memStack.pop(); listener(current()); } else navigate(fallback, { replace: true }); return; }
  if (history.state !== null || history.length > 1) history.back(); else navigate(fallback, { replace: true });
}
export function startRouter(onChange: (r: Route) => void, start?: string) {
  listener = onChange;
  if (MODE === "memory") memStack = [start ?? BASE + "/accounts"];
  else window.addEventListener("popstate", () => listener(current()));
  // 攔截站內連結
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.target || e.defaultPrevented || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey) return;
    const href = a.getAttribute("href")!;
    if (!href.startsWith(BASE)) return;
    e.preventDefault();
    navigate(href);
  });
  listener(current());
}
/** 產生站內連結 */
export const href = (p: string) => BASE + (p || "/");
export const withQuery = (p: string, q: Record<string, string | string[] | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => { if (v == null || v === "" || (Array.isArray(v) && !v.length)) return; s.set(k, Array.isArray(v) ? v.join(",") : String(v)); });
  const qs = s.toString();
  return p + (qs ? "?" + qs : "");
};
