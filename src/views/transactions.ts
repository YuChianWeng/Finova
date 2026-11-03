/** 明細（/finance/transactions）。篩選條件放在網址 query，名稱和 API 參數相同（契約 §8）。 */
import type * as L from "../types/ledger";
import { esc, ic } from "../lib/dom";
import { fmt, fmtSigned, MINUS, byCurrency, sign } from "../lib/money";
import { today, addDays, monthOf, monthStart, monthEnd, addMonths, md, splitDT } from "../lib/dates";
import { app, ui, catLabel, accOpt, findCat } from "../state";
import { api } from "../api/ledger";
import type { QueueItem } from "../api/offline";
import * as queue from "../api/offline";
import { registerView, actions, rerender, reload, handleError, currentData, currentRoute } from "../app";
import { navigate, withQuery, type Route } from "../router";
import { groupedList, emptyState, SOURCE_TEXT, TYPE_TEXT, catIconName } from "../ui/components";
import { openSheet, setSheet, sheetShell, closeSheet, dialog, toast, sheet } from "../ui/overlay";
import { openEntry } from "../ui/entry";

const LIST_KEYS = ["accounts", "categories", "types", "projects", "tags", "sources"] as const;
export function queryFromRoute(r: Route): L.TransactionsQuery {
  const q = r.query, list = (k: string) => (q.get(k) ? q.get(k)!.split(",").filter(Boolean) : undefined);
  return { from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, accounts: list("accounts"), categories: list("categories"), types: list("types") as L.TransactionType[] | undefined,
    projects: list("projects"), tags: list("tags"), sources: list("sources") as L.Source[] | undefined, min: q.get("min") ?? undefined, max: q.get("max") ?? undefined,
    currency: q.get("currency") ?? undefined, q: q.get("q") ?? undefined, sort: (q.get("sort") as "date" | "amount") ?? undefined, order: (q.get("order") as "asc" | "desc") ?? undefined };
}
const toPath = (f: L.TransactionsQuery) => withQuery("/transactions", f as Record<string, string | string[] | undefined>);

/** 離線佇列 → 畫面用的 Transaction（is_pending_sync） */
export function pendingAsTx(items: QueueItem[]): L.Transaction[] {
  return items.map((it, i) => {
    const b = it.body as any, tr = "from_account_key" in b;
    const a = accOpt(tr ? b.from_account_key : b.account_key);
    const c = findCat(b.category_key); const main = c && "parent_key" in c ? findCat(c.parent_key) : c;
    const { date } = splitDT(b.occurred_at);
    return {
      id: -1 - i, version: 0, type: tr ? b.type : b.type, direction: tr ? "out" : b.type === "income" ? "in" : "out",
      amount: { amount: tr ? b.amount_out : b.amount, currency: tr ? a?.currency ?? "TWD" : b.currency }, occurred_at: b.occurred_at, date,
      account: { account_key: a?.account_key ?? "", name: a?.name ?? "", group: a?.group ?? "other" },
      category: c && main ? { main: { category_key: main.category_key, name: main.name, icon: main.icon }, sub: main !== c ? { category_key: c.category_key, name: c.name, icon: c.icon } : null } : null,
      merchant: b.merchant ?? null, note: it.error ? `送出失敗：${it.error.message}` : b.note ?? null, tags: [], project: null, source: "web",
      transfer: tr ? { group_id: "", leg: "out", counterpart: { transaction_id: 0, account_key: b.to_account_key, account_name: accOpt(b.to_account_key)?.name ?? "", amount: { amount: b.amount_in ?? b.amount_out, currency: accOpt(b.to_account_key)?.currency ?? "TWD" } }, fee: b.fee ? { amount: b.fee.amount, currency: a?.currency ?? "TWD" } : null } : null,
      recurring_rule_id: null, balance_after: null, is_pending_sync: true, created_at: it.queued_at, updated_at: it.queued_at, _qkey: it.key,
    } as L.Transaction & { _qkey: string };
  });
}

type D = { page: L.TransactionsPage; rows: L.Transaction[]; q: L.TransactionsQuery };
async function load(r: Route): Promise<D> {
  const q = queryFromRoute(r);
  const page = await api.transactions({ ...q, limit: 50 });
  ui.sel.clear();
  return { page, rows: page.rows, q };
}
function chips(q: L.TransactionsQuery): [string, string, string][] {
  const c: [string, string, string][] = [];
  if (q.from || q.to) c.push(["range", "", q.from === q.to ? md(q.from!) : `${q.from ? md(q.from) : "…"} – ${q.to ? md(q.to) : "…"}`]);
  q.types?.forEach((v) => c.push(["types", v, TYPE_TEXT[v] ?? v]));
  q.accounts?.forEach((v) => c.push(["accounts", v, accOpt(v)?.name ?? v]));
  q.categories?.forEach((v) => c.push(["categories", v, catLabel(v)]));
  q.sources?.forEach((v) => c.push(["sources", v, "來源：" + SOURCE_TEXT[v]]));
  q.tags?.forEach((v) => c.push(["tags", v, "#" + (app.catalog?.tags.find((t) => t.tag_id === v)?.name ?? v)]));
  q.projects?.forEach((v) => c.push(["projects", v, app.catalog?.projects_active.find((p) => p.project_id === v)?.name ?? "專案"]));
  if (q.min || q.max) c.push(["amt", "", `${q.min || 0}–${q.max || "∞"}`]);
  if (q.currency) c.push(["currency", "", q.currency]);
  return c;
}
function body(d: D) {
  const s = d.page.summary, q = d.q;
  const money = (m: L.MoneyByCurrency, pre: string, cls: string) => byCurrency(m).map((x) => `<span class="amt ${cls}">${pre}${fmt(x.amount, x.currency)}</span>`).join("") || `<span class="amt">${fmt("0")}</span>`;
  const net = byCurrency(s.net).map((x) => `<span class="amt ${sign(x.amount) >= 0 ? "inc" : ""}">${fmtSigned(x.amount, x.currency)}</span>`).join("") || `<span class="amt">${fmt("0")}</span>`;
  const sumbar = `<div class="sumbar" aria-label="篩選結果摘要"><div><span class="eyebrow">筆數</span><span class="num">${s.count}</span></div><div><span class="eyebrow">收入</span>${money(s.income, "+", "inc")}</div><div><span class="eyebrow">支出</span>${money(s.expense, MINUS, "")}</div><div><span class="eyebrow">淨額</span>${net}</div></div>`;
  const cs = chips(q);
  const chipRow = cs.length ? `<div class="wrap-row" style="margin-top:12px">${cs.map(([k, v, l]) => `<button class="fchip" data-a="f-rm" data-k="${k}" data-v="${esc(v)}" aria-label="移除篩選 ${esc(l)}">${esc(l)}${ic("x", "s")}</button>`).join("")}<button class="link" data-a="f-clear">清除全部</button></div>` : "";
  const noFilter = !cs.length && !q.q;
  const pend = pendingAsTx(app.queue);
  const pending = noFilter && pend.length ? `<div class="list" style="margin-top:4px"><div class="gh"><b>${ic("clock", "s")} 待同步</b><span>${pend.length} 筆</span></div>${pend.map((t) => groupedList([t], {}).replace(/<div class="gh">.*?<\/div>/, "")).join("")}</div>` : "";
  const list = d.rows.length ? `<div class="list" style="margin-top:4px">${groupedList(d.rows, { batch: ui.batch, byAmount: q.sort === "amount" })}</div>
    ${d.page.next_cursor ? `<div style="text-align:center;margin:16px 0"><button class="btn" data-a="tx-more">載入更多（已顯示 ${d.rows.length} / ${s.count} 筆）</button></div>` : `<p class="eyebrow" style="text-align:center;margin:20px 0">— 已載入全部 ${s.count} 筆${d.rows.length ? ` · 最早 ${d.rows[d.rows.length - 1].date.replace(/-/g, "/")}` : ""} —</p>`}`
    : `<div class="card" style="margin-top:16px">${emptyState("沒有符合條件的交易", "試著放寬日期或分類，或清除所有篩選。", cs.length || q.q ? `<button class="btn p" data-a="f-clear">清除篩選</button>` : `<button class="btn p" data-a="add">${ic("plus")}記一筆</button>`)}</div>`;
  const n = ui.sel.size, dis = n ? "" : "disabled";
  const batch = ui.batch ? `<div class="batchbar"><b class="num" style="margin-right:auto">已選 ${n} 筆</b><button class="btn sm" data-a="batch-form" data-v="category" ${dis}>${ic("tag", "s")}改分類</button><button class="btn sm" data-a="batch-form" data-v="account" ${dis}>${ic("wallet", "s")}改帳戶</button><button class="btn sm" data-a="batch-form" data-v="tags" ${dis}>#加標籤</button><button class="btn sm" data-a="batch-form" data-v="project" ${dis}>${ic("plane", "s")}歸入專案</button><button class="btn sm dg-t" data-a="batch-del" ${dis}>${ic("trash", "s")}刪除</button></div>` : "";
  return sumbar + chipRow + pending + list + batch;
}
function render(d: D) {
  const n = chips(d.q).length;
  return `<div class="stack" style="gap:12px">
    <div class="row" style="flex-wrap:wrap">
      <div class="search">${ic("search")}<label for="q" class="vh">搜尋商家與備註</label><input id="q" class="in" type="search" placeholder="搜尋商家、備註" value="${esc(d.q.q ?? "")}" autocomplete="off"></div>
      <button class="btn" data-a="f-open" aria-label="篩選，已套用 ${n} 個">${ic("filter")}篩選${n ? ` <span class="st ok">${n}</span>` : ""}</button>
      <button class="btn" data-a="sort" aria-label="切換排序">${ic("sort")}${d.q.sort === "amount" ? "金額" : "日期"}</button>
      <button class="btn ${ui.batch ? "p" : ""}" data-a="batch" aria-pressed="${ui.batch}">${ic("check")}${ui.batch ? "完成" : "批次"}</button>
      <button class="btn g only-d" data-a="export">${ic("download")}匯出 CSV</button>
    </div>
    <p class="xs mu only-m" style="margin:0">提示：交易往左滑可以編輯或刪除</p>
  </div><div id="txbody" style="margin-top:12px">${body(d)}</div>`;
}
registerView("transactions", { load, render, title: () => "全部交易", back: "/more", nav: "/transactions" });
registerView("transaction", {
  load: async (r) => { const d = await load({ ...r, query: new URLSearchParams() }); setTimeout(() => openEntry({ id: Number(r.params.id) }), 0); return d; },
  render, title: () => "全部交易", back: "/transactions", nav: "/transactions",
});
registerView("new", {
  load: async (r) => { const t = (r.query.get("type") as "expense" | "income" | "transfer") ?? "expense"; await openEntry({ type: t, target: "page" }); return null; },
  render: () => `<div class="card" id="entry-page" style="max-width:640px;margin:0 auto"></div>`,
  after: () => import("../ui/entry").then((m) => m.renderEntry()),
  title: () => "記一筆", back: "/accounts", nav: "",
});

/* ------------------------------------------------------------ filter sheet */
let F: L.TransactionsQuery = {};
function rangeChip(k: string, l: string, from?: string, to?: string) { return `<button class="chip" data-a="f-range" data-from="${from ?? ""}" data-to="${to ?? ""}" aria-pressed="${(F.from ?? "") === (from ?? "") && (F.to ?? "") === (to ?? "")}">${l}</button>`; }
function sheetFilter() {
  const c = app.catalog!, t = today(), m = monthOf(t), lm = addMonths(m, -1);
  const tg = (k: (typeof LIST_KEYS)[number], v: string, l: string, icn?: string) => `<button class="chip" data-a="f-tg" data-k="${k}" data-v="${esc(v)}" aria-pressed="${((F[k] as string[] | undefined) ?? []).includes(v)}">${ic("check", "s ck-i")}${icn ? ic(icn, "s") : ""}${esc(l)}</button>`;
  const body = `<div class="fld"><span class="eyebrow">日期區間</span><div class="wrap-row">${rangeChip("all", "全部")}${rangeChip("m", "本月", monthStart(m), monthEnd(m))}${rangeChip("l", "上月", monthStart(lm), monthEnd(lm))}${rangeChip("7", "近 7 天", addDays(t, -6), t)}</div>
      <div class="row" style="margin-top:6px;flex-wrap:wrap"><label class="vh" for="f-from">起</label><input id="f-from" class="in" type="date" value="${F.from ?? ""}" style="flex:1;min-width:130px"><span class="mu">–</span><label class="vh" for="f-to">迄</label><input id="f-to" class="in" type="date" value="${F.to ?? ""}" style="flex:1;min-width:130px"></div></div>
    <div class="fld"><span class="eyebrow">類型</span><div class="wrap-row">${tg("types", "expense", MINUS + " 支出")}${tg("types", "income", "+ 收入")}${tg("types", "transfer", "⇄ 轉帳")}${tg("types", "credit_card_payment", "⇄ 繳卡費")}${tg("types", "adjustment", "± 調整")}</div></div>
    <div class="fld"><span class="eyebrow">帳戶（多選）</span><div class="wrap-row">${c.accounts.filter((a) => a.group !== "investment").map((a) => tg("accounts", a.account_key, a.name, a.icon ?? "wallet")).join("")}</div></div>
    <div class="fld"><span class="eyebrow">分類（選主分類＝包含所有子分類）</span><div class="wrap-row">${c.categories.filter((x) => !x.is_hidden).map((x) => tg("categories", x.category_key, x.name, catIconName(x.category_key, x.icon))).join("")}</div>
      ${(F.categories ?? []).filter((k) => !k.includes(".")).map((k) => { const mc = c.categories.find((x) => x.category_key === k); return mc?.children.length ? `<div class="wrap-row" style="margin-top:4px"><span class="xs mu">${esc(mc.name)} ›</span>${mc.children.map((s) => tg("categories", s.category_key, s.name)).join("")}</div>` : ""; }).join("")}</div>
    <div class="fld"><span class="eyebrow">來源</span><div class="wrap-row">${(Object.keys(SOURCE_TEXT) as L.Source[]).map((s) => tg("sources", s, SOURCE_TEXT[s])).join("")}</div></div>
    ${c.tags.length ? `<div class="fld"><span class="eyebrow">標籤</span><div class="wrap-row">${c.tags.map((x) => tg("tags", x.tag_id, "#" + x.name)).join("")}</div></div>` : ""}
    ${c.projects_active.length ? `<div class="fld"><span class="eyebrow">專案</span><div class="wrap-row">${c.projects_active.map((p) => tg("projects", p.project_id, p.name, "plane")).join("")}</div></div>` : ""}
    <div class="two"><div class="fld"><label class="eyebrow" for="f-min">金額下限</label><input id="f-min" class="in num" inputmode="decimal" value="${esc(F.min ?? "")}" placeholder="0"></div><div class="fld"><label class="eyebrow" for="f-max">金額上限</label><input id="f-max" class="in num" inputmode="decimal" value="${esc(F.max ?? "")}" placeholder="不限"></div></div>
    <div class="fld"><label class="eyebrow" for="f-cur">幣別</label><select id="f-cur" class="in"><option value="">全部</option>${c.currencies.map((x) => `<option value="${x.code}" ${F.currency === x.code ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>`;
  return sheetShell("篩選", body, `<button class="btn" data-a="f-reset">清除</button><button class="btn p" data-a="f-apply">套用</button>`);
}

/* ------------------------------------------------------------ batch */
let B: { kind: string; value: string; tags: string[] } = { kind: "", value: "", tags: [] };
function batchSheet() {
  const c = app.catalog!; const n = ui.sel.size;
  let body = "";
  if (B.kind === "category") body = c.categories.filter((m) => !m.is_hidden && m.kind !== "system").map((m) => `<div class="fld"><span class="eyebrow">${esc(m.name)}${m.kind === "income" ? "（收入）" : ""}</span><div class="wrap-row"><button class="chip" data-a="b-pick" data-v="${m.category_key}" aria-pressed="${B.value === m.category_key}">${esc(m.name)}（不細分）</button>${m.children.filter((s) => !s.is_hidden).map((s) => `<button class="chip" data-a="b-pick" data-v="${s.category_key}" aria-pressed="${B.value === s.category_key}">${esc(s.name)}</button>`).join("")}</div></div>`).join("");
  else if (B.kind === "account") body = `<div class="wrap-row">${c.accounts.filter((a) => a.can_record).map((a) => `<button class="chip" data-a="b-pick" data-v="${a.account_key}" aria-pressed="${B.value === a.account_key}">${ic(a.icon ?? "wallet", "s")}${esc(a.name)}</button>`).join("")}</div><p class="xs mu">轉帳不會被改帳戶。</p>`;
  else if (B.kind === "tags") body = `<div class="wrap-row">${c.tags.map((t) => `<button class="chip" data-a="b-tag" data-v="${t.tag_id}" aria-pressed="${B.tags.includes(t.tag_id)}">#${esc(t.name)}</button>`).join("")}</div>`;
  else if (B.kind === "project") body = `<div class="wrap-row"><button class="chip" data-a="b-pick" data-v="__none__" aria-pressed="${B.value === "__none__"}">移出專案</button>${c.projects_active.map((p) => `<button class="chip" data-a="b-pick" data-v="${p.project_id}" aria-pressed="${B.value === p.project_id}">${ic("plane", "s")}${esc(p.name)}</button>`).join("")}</div>`;
  const title = { category: "改分類", account: "改帳戶", tags: "加標籤", project: "歸入專案" }[B.kind] ?? "";
  return sheetShell(`${title} · ${n} 筆`, body + `<p class="xs mu" style="margin:0">批次修改是「全部成功或全部失敗」。</p>`, `<button class="btn" data-a="closeall">取消</button><button class="btn p" data-a="b-apply">${ic("check", "s")}套用到 ${n} 筆</button>`);
}

let qT: ReturnType<typeof setTimeout> | undefined;
actions({
  "f-open"() { F = { ...currentData<D>().q }; openSheet("filter", sheetFilter()); },
  "f-tg"(el) { const k = el.dataset.k as (typeof LIST_KEYS)[number], v = el.dataset.v!; const a = ((F[k] as string[] | undefined) ?? []).slice(); const i = a.indexOf(v); i > -1 ? a.splice(i, 1) : a.push(v); (F as any)[k] = a; setSheet(sheetFilter()); },
  "f-range"(el) { F.from = el.dataset.from || undefined; F.to = el.dataset.to || undefined; setSheet(sheetFilter()); },
  "f-reset"() { F = { q: F.q, sort: F.sort }; setSheet(sheetFilter()); },
  "f-apply"() { closeSheet(); navigate(toPath(F), { replace: true }); },
  "f-rm"(el) {
    const q = { ...currentData<D>().q }; const k = el.dataset.k!, v = el.dataset.v!;
    if (k === "range") { q.from = undefined; q.to = undefined; } else if (k === "amt") { q.min = undefined; q.max = undefined; } else if (k === "currency") q.currency = undefined;
    else (q as any)[k] = ((q as any)[k] as string[]).filter((x) => x !== v);
    navigate(toPath(q), { replace: true });
  },
  "f-clear"() { navigate("/transactions", { replace: true }); },
  sort() { const q = { ...currentData<D>().q }; q.sort = q.sort === "amount" ? undefined : "amount"; navigate(toPath(q), { replace: true }); },
  batch() { ui.batch = !ui.batch; ui.sel.clear(); rerender(); },
  sel(el) { const id = Number(el.dataset.id); (el as HTMLInputElement).checked ? ui.sel.add(id) : ui.sel.delete(id); refreshBody(); },
  selrow(el) { const id = Number(el.dataset.id); ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id); refreshBody(); },
  async "tx-more"() {
    const d = currentData<D>(); if (!d.page.next_cursor) return;
    try { const p = await api.transactions({ ...d.q, limit: 50, cursor: d.page.next_cursor }); d.rows.push(...p.rows); d.page = { ...p, summary: d.page.summary }; rerender(); }
    catch (e) { handleError(e); }
  },
  async export() {
    try {
      const blob = await api.exportCsv(currentData<D>().q);
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `finova-${today()}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`已匯出 ${currentData<D>().page.summary.count} 筆交易為 CSV`);
    } catch (e) { handleError(e); }
  },
  "batch-form"(el) { B = { kind: el.dataset.v!, value: "", tags: [] }; openSheet("form", batchSheet()); },
  "b-pick"(el) { B.value = el.dataset.v!; setSheet(batchSheet()); },
  "b-tag"(el) { const v = el.dataset.v!; B.tags = B.tags.includes(v) ? B.tags.filter((x) => x !== v) : [...B.tags, v]; setSheet(batchSheet()); },
  async "b-apply"() {
    const ids = [...ui.sel]; const patch: any = {};
    if (B.kind === "category") { if (!B.value) return toast("請選擇分類"); patch.category_key = B.value; }
    if (B.kind === "account") { if (!B.value) return toast("請選擇帳戶"); patch.account_key = B.value; }
    if (B.kind === "tags") { if (!B.tags.length) return toast("請選擇標籤"); patch.tag_ids_add = B.tags; }
    if (B.kind === "project") { if (!B.value) return toast("請選擇專案"); patch.project_id = B.value === "__none__" ? null : B.value; }
    try { const r = await api.bulk({ action: "update", ids, patch }); closeSheet(); ui.sel.clear(); toast(`已更新 ${r.affected} 筆`); reload(); } catch (e) { handleError(e); }
  },
  "batch-del"() {
    const ids = [...ui.sel];
    dialog(`刪除 ${ids.length} 筆紀錄？`, '<p class="mu" style="margin:0">30 天內可在 設定 › 最近刪除 中復原。轉帳會整組刪除。</p>', "刪除", async () => {
      try { const r = await api.bulk({ action: "delete", ids }); ui.sel.clear(); toast(`已刪除 ${r.affected} 筆`); reload(); } catch (e) { handleError(e); }
    }, { danger: true });
  },
  async sync() { const r = await queue.flush(); toast(r.sent ? `已同步 ${r.sent} 筆` : r.failed ? `${r.failed} 筆需要修正後才能送出` : "沒有可同步的紀錄"); reload(); },
});
function refreshBody() { const b = document.getElementById("txbody"); if (b && currentRoute()?.name === "transactions") b.innerHTML = body(currentData<D>()); }
document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "q") { clearTimeout(qT); qT = setTimeout(() => { const q = { ...currentData<D>().q, q: t.value.trim() || undefined }; navigate(toPath(q), { replace: true }); setTimeout(() => { const i = document.getElementById("q") as HTMLInputElement | null; if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 350); }, 350); }
  if (sheet.kind === "filter") {
    if (t.id === "f-min") F.min = t.value.replace(/[^\d.]/g, "") || undefined;
    if (t.id === "f-max") F.max = t.value.replace(/[^\d.]/g, "") || undefined;
  }
});
document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement; if (sheet.kind !== "filter") return;
  if (t.id === "f-from") { F.from = t.value || undefined; setSheet(sheetFilter()); }
  if (t.id === "f-to") { F.to = t.value || undefined; setSheet(sheetFilter()); }
  if (t.id === "f-cur") F.currency = t.value || undefined;
});
