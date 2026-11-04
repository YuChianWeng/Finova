/** 共用元件：交易列、進度條、狀態膠囊、空狀態、錯誤狀態、骨架。 */
import type * as L from "../types/ledger";
import { esc, ic } from "../lib/dom";
import { fmt, MINUS, plain, curInfo, byCurrency, sumByCurrency } from "../lib/money";
import { md, wd, splitDT } from "../lib/dates";
import { mainCat, ui } from "../state";
import { LedgerError, ERROR_TEXT } from "../api/client";

/* 分類顏色依圖示對應（顏色是外觀，不是分類清單；分類本身一律來自 /catalog） */
const ICON_COLOR: Record<string, string> = {
  food: "var(--c1)", bus: "var(--c2)", bag: "var(--c3)", play: "var(--c4)", house: "var(--c6)", book: "var(--c4)",
  med: "var(--c5)", repeat: "var(--c5)", in: "var(--c1)", dots: "var(--c6)", tag: "var(--c3)", alert: "var(--wa)",
};
const PALETTE = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function catColor(key: string | null | undefined, icon?: string | null): string {
  if (key === "uncategorized") return "var(--wa)";
  const i = icon ?? mainCat(key)?.icon;
  return (i && ICON_COLOR[i]) || PALETTE[hash(key ?? "") % PALETTE.length];
}
export const catIconName = (key: string | null | undefined, icon?: string | null) => icon ?? mainCat(key)?.icon ?? "dots";
export const SOURCE_TEXT: Record<L.Source, string> = { web: "網頁", iphone_shortcut: "捷徑", chat_bot: "聊天機器人", moze_import: "MOZE 匯入", auto: "自動入帳", other: "其他" };
export const GROUP_TEXT: Record<L.AccountGroup, string> = { cash: "現金", bank: "銀行", credit_card: "信用卡", stored_value: "儲值卡", investment: "投資", liability: "負債", receivable: "應收", other: "其他" };
export const TYPE_TEXT: Partial<Record<L.TransactionType, string>> = {
  expense: "支出", income: "收入", transfer: "轉帳", credit_card_payment: "繳卡費", adjustment: "餘額調整",
  investment_settlement: "投資交割", loan_interest_payment: "貸款利息", loan_principal_repayment: "償還本金",
};
export const isTransferType = (t: L.TransactionType) => t === "transfer" || t === "credit_card_payment";
export const isUncat = (t: L.Transaction) => t.category?.main.category_key === "uncategorized";

/* ---------------- 金額 ---------------- */
export function amtHTML(t: L.Transaction): string {
  const m = t.amount;
  if (isTransferType(t.type)) return `<span class="amt tr">⇄ ${fmt(m.amount, m.currency)}</span>`;
  if (t.type === "adjustment") return `<span class="amt adj">± ${t.direction === "in" ? "+" : MINUS}${fmt(m.amount, m.currency)}</span>`;
  const inc = t.direction === "in";
  return `<span class="amt ${inc ? "inc" : "out"}">${inc ? "+" : MINUS}${fmt(m.amount, m.currency)}</span>`;
}
export const moneyList = (ms: L.Money[], cls = "") => ms.map((m) => `<span class="amt ${cls}">${fmt(m.amount, m.currency)}</span>`).join('<span class="mu" aria-hidden="true"> · </span>');

/* ---------------- 交易列 ---------------- */
export function txVisual(t: L.Transaction): [string, string] {
  if (isTransferType(t.type)) return ["swap", "var(--tr)"];
  if (t.type === "adjustment") return ["scale", "var(--c6)"];
  if (t.type === "investment_settlement") return ["trend", "var(--c2)"];
  if (t.type.startsWith("loan")) return ["debt", "var(--c6)"];
  if (!t.category || isUncat(t)) return ["alert", "var(--wa)"];
  return [catIconName(t.category.main.category_key, t.category.main.icon), catColor(t.category.main.category_key, t.category.main.icon)];
}
export type RowOpt = { showDate?: boolean; batch?: boolean; balance?: boolean; noSwipe?: boolean };
export function txRow(t: L.Transaction, o: RowOpt = {}): string {
  const [icn, col] = txVisual(t);
  const pending = !!t.is_pending_sync;
  let title = esc(t.merchant || (t.category ? (t.category.sub ?? t.category.main).name : TYPE_TEXT[t.type] ?? ""));
  let sub: string;
  if (isTransferType(t.type) && t.transfer) {
    const [a, b] = t.transfer.leg === "out" ? [t.account.name, t.transfer.counterpart.account_name] : [t.transfer.counterpart.account_name, t.account.name];
    sub = `${esc(a)} → ${esc(b)}${t.transfer.fee ? ` · 手續費 ${fmt(t.transfer.fee.amount, t.transfer.fee.currency)}` : ""}`;
  } else if (t.type === "adjustment") { title = "餘額調整"; sub = "不計入收支"; }
  else if (!t.category) sub = esc(TYPE_TEXT[t.type] ?? "");
  else if (isUncat(t)) sub = '<span class="unc">未分類</span>';
  else sub = esc(t.category.main.name + (t.category.sub ? " › " + t.category.sub.name : ""));
  if (t.note) sub += ` · ${esc(t.note)}`;
  const { time } = splitDT(t.occurred_at);
  const when = o.showDate ? `${md(t.date)} ${time}` : time;
  const pill = isTransferType(t.type) ? TYPE_TEXT[t.type]! : t.account.name;
  const tags = (t.project ? `<span class="ptag">${ic("plane", "s")}${esc(t.project.name)}</span>` : "") + t.tags.map((g) => `<span class="ptag">#${esc(g.name)}</span>`).join("");
  const sel = ui.sel.has(t.id);
  const id = pending ? `q:${esc(String((t as any)._qkey))}` : String(t.id);
  const swipe = !o.batch && !o.noSwipe && !pending;
  return `<div class="sw" data-id="${id}">
    ${swipe ? `<div class="sw-acts" aria-hidden="true"><button class="sw-e" data-a="edit" data-id="${t.id}" tabindex="-1">${ic("edit")}編輯</button><button class="sw-d" data-a="askdel" data-id="${t.id}" tabindex="-1">${ic("trash")}刪除</button></div>` : ""}
    <div class="tx${pending ? " pending" : ""}">
      ${o.batch ? `<label class="ck"><input type="checkbox" data-a="sel" data-id="${t.id}" ${sel ? "checked" : ""} aria-label="選取 ${title}"></label>` : ""}
      <button class="tx-b" data-a="${pending ? "queue-open" : o.batch ? "selrow" : "edit"}" data-id="${id}">
        <span class="cat-ic" style="--cc:${col}">${ic(icn)}</span>
        <span class="tx-m">
          <span class="tx-t"><span>${title}</span>${tags}</span>
          <span class="tx-s"><span>${sub}</span><span aria-hidden="true">·</span><span class="num">${when}</span>${pending ? `<span class="st warn">${ic("clock", "s")}待同步</span>` : `<span class="src">${SOURCE_TEXT[t.source]}</span>`}${t.statement?.reconciled ? `<span class="src rcd" title="已在 ${md(t.statement.close_date)} 帳單完成對帳">${ic("check", "s")}已對帳</span>` : ""}</span>
        </span>
        <span class="tx-r">${amtHTML(t)}${o.balance && t.balance_after ? `<span class="num xs mu">餘 ${fmt(t.balance_after.amount, t.balance_after.currency)}</span>` : ""}<span class="pill">${esc(pill)}</span></span>
      </button>
    </div>
  </div>`;
}
function dayTotals(list: L.Transaction[]) {
  const by = (dir: "in" | "out", type: string) => {
    const sums = sumByCurrency(list.filter((t) => t.type === type && t.direction === dir).map((t) => t.amount));
    return byCurrency(sums).map((m) => fmt(m.amount, m.currency));
  };
  return { ex: by("out", "expense"), inc: by("in", "income") };
}
export function groupHead(d: string, list: L.Transaction[]): string {
  const { ex, inc } = dayTotals(list);
  const parts = [ex.length ? "支出 " + ex.map((x) => MINUS + x).join("、") : "", inc.length ? "收入 +" + inc.join("、+") : ""].filter(Boolean);
  return `<div class="gh"><b>${md(d)}（${wd(d)}）</b><span>${parts.join(" · ") || "僅轉帳"}</span></div>`;
}
export function groupedList(list: L.Transaction[], o: RowOpt & { byAmount?: boolean } = {}): string {
  if (o.byAmount) return `<div class="gh"><b>依金額排序</b><span>${list.length} 筆</span></div>` + list.map((t) => txRow(t, { ...o, showDate: true })).join("");
  const g = new Map<string, L.Transaction[]>();
  list.forEach((t) => g.set(t.date, [...(g.get(t.date) ?? []), t]));
  return [...g.entries()].map(([d, l]) => groupHead(d, l) + l.map((t) => txRow(t, o)).join("")).join("");
}

/* ---------------- 狀態 ---------------- */
export const stateOf = (r: number): "ok" | "warn" | "over" => (r >= 1 ? "over" : r >= 0.8 ? "warn" : "ok");
export const fromBudget = (s: L.BudgetStatus) => (s === "warning" ? "warn" : s);
const ST_LABEL: Record<string, string> = { ok: ic("check", "s") + "正常", warn: "! 快超支", over: "▲ 超支", done: ic("check", "s") + "已達成" };
export const stPill = (s: string) => `<span class="st ${s}">${ST_LABEL[s] ?? s}</span>`;
export function pbar(p: number, s?: string | null, thin = false) {
  return `<div class="pb ${s || stateOf(p)} ${thin ? "thin" : ""}" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, Math.max(0, p * 100)).toFixed(1)}%"></i></div>`;
}
export function emptyState(title: string, body: string, btn = "") {
  return `<div class="empty">
    <svg class="ill" viewBox="0 0 120 90" aria-hidden="true"><rect x="10" y="12" width="100" height="66" rx="8" fill="none" style="stroke:var(--ln2)" stroke-dasharray="4 4"/><path d="M24 62h14M24 52h40M24 42h28" style="stroke:var(--ln2)" stroke-width="3" stroke-linecap="round"/><circle cx="84" cy="44" r="13" fill="none" style="stroke:var(--ac)" stroke-width="2.5"/><path d="M93 53l9 9" style="stroke:var(--ac)" stroke-width="2.5" stroke-linecap="round"/></svg>
    <h3>${title}</h3><p>${body}</p>${btn}</div>`;
}
export function errorState(e: unknown, retry = "retry") {
  const err = e as LedgerError;
  const offline = err?.code === "OFFLINE" || err?.code === "NETWORK";
  const msg = err instanceof LedgerError ? (err.message || ERROR_TEXT[err.code] || err.code) : "發生未預期的錯誤";
  const body = offline ? "目前沒有網路，也沒有這一頁的離線快取。連上網路後再試一次；已記的資料不會遺失。"
    : err?.code === "AUTH_EXPIRED" ? "請重新登入後再試。" : `${esc(msg)}。稍後再試一次；已記的資料不會遺失。`;
  return `<div class="empty"><div class="cat-ic" style="color:var(--dg);width:56px;height:56px">${ic("alert")}</div><h3>${offline ? "離線中" : "資料載入失敗"}</h3><p>${body}</p><button class="btn p" data-a="${retry}">${ic("undo")}重試</button></div>`;
}
export function skeleton() {
  const card = (h: number) => `<div class="card"><div class="sk" style="height:12px;width:40%;margin-bottom:14px"></div><div class="sk" style="height:${h}px"></div></div>`;
  const row = `<div class="row" style="padding:12px 0;border-bottom:1px solid var(--ln)"><div class="sk" style="width:40px;height:40px;border-radius:50%"></div><div style="flex:1"><div class="sk" style="height:12px;width:55%;margin-bottom:8px"></div><div class="sk" style="height:10px;width:35%"></div></div><div class="sk" style="width:64px;height:14px"></div></div>`;
  return `<div class="grid" aria-busy="true" aria-label="載入中"><div class="sp-4">${card(60)}</div><div class="sp-4">${card(60)}</div><div class="sp-4">${card(60)}</div><div class="sp-8">${card(180)}</div><div class="sp-4"><div class="card">${row + row + row + row}</div></div></div>`;
}
/** 幣別金額（純數字，不帶符號），給大數字用 */
export const bigPlain = (m: L.Money) => `${sign0(m.amount)}${plain(m.amount, m.currency)}`;
const sign0 = (a: string) => (a.trim().startsWith("-") ? MINUS : "");
export const curSym = (c: string) => curInfo(c).symbol;
