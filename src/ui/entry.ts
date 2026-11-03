/**
 * ＋ 記一筆／編輯表單（底部面板或桌面右側抽屜；/finance/new 為全頁版）。
 * - 開表單時產生 idempotency_key，重送沿用同一把（契約 §1.5）
 * - 編輯、刪除帶 expected_version，衝突時顯示最新內容並提供「重新載入」（§1.6）
 * - 依 error.details 把錯誤顯示在欄位旁（§5）
 * - 離線時新增存進佇列，標「待同步」（§6）
 * - 登入過期時把表單暫存在 sessionStorage，回來後還原（§6）
 */
import type * as L from "../types/ledger";
import { $, esc, ic, session } from "../lib/dom";
import { fmt, isPositiveAmount, MINUS, curInfo } from "../lib/money";
import { today, addDays, nowTime, isoDateTime, splitDT, md, wd } from "../lib/dates";
import { app, getCatalog, findCat, mainCat, accOpt, catLabel } from "../state";
import { api } from "../api/ledger";
import { LedgerError, newIdempotencyKey, ERROR_TEXT } from "../api/client";
import * as queue from "../api/offline";
import { actions, reload, handleError, go } from "../app";
import { amtHTML, catColor, catIconName, SOURCE_TEXT } from "./components";
import { openSheet, setSheet, closeSheet, sheetShell, dialog, toast, sheet } from "./overlay";

type Kind = "expense" | "income" | "transfer";
export type Entry = {
  mode: "new" | "edit" | "queue"; target: "sheet" | "page";
  id: number | null; version: number; key: string; qkey?: string;
  type: Kind; amt: string; amtIn: string; cur: string;
  cat: string | null; acc: string | null; to: string | null; fee: string;
  date: string; time: string; m: string; note: string; tags: string[]; proj: string;
  err: Record<string, string>; formErr: string | null; retryable: boolean; busy: boolean;
  hist?: L.TransactionDetail["history"]; orig?: L.Transaction; sugg: L.MerchantSuggestion[];
};
let E: Entry | null = null;
export const entryState = () => E;
const DRAFT = "finova-draft";

function blank(type: Kind = "expense"): Entry {
  const c = app.catalog!;
  const acc = c.frequent.accounts.find((k) => accOpt(k)?.can_record) ?? c.accounts.find((a) => a.can_record)?.account_key ?? null;
  return { mode: "new", target: "sheet", id: null, version: 0, key: newIdempotencyKey(), type, amt: "", amtIn: "", cur: accOpt(acc)?.currency ?? "TWD",
    cat: type === "income" ? c.frequent.income_categories[0] ?? null : null, acc, to: null, fee: "", date: today(), time: nowTime(), m: "", note: "", tags: [], proj: "",
    err: {}, formErr: null, retryable: false, busy: false, sugg: [] };
}
function fromTx(t: L.TransactionDetail | L.Transaction, copy = false): Entry {
  const tr = !!t.transfer;
  const [from, to] = tr ? (t.transfer!.leg === "out" ? [t.account.account_key, t.transfer!.counterpart.account_key] : [t.transfer!.counterpart.account_key, t.account.account_key]) : [t.account.account_key, null];
  const amts = tr ? (t.transfer!.leg === "out" ? [t.amount.amount, t.transfer!.counterpart.amount.amount] : [t.transfer!.counterpart.amount.amount, t.amount.amount]) : [t.amount.amount, ""];
  const { date, time } = splitDT(t.occurred_at);
  return { ...blank(), mode: copy ? "new" : "edit", id: copy ? null : t.id, version: t.version, type: tr ? "transfer" : (t.type === "income" ? "income" : "expense"),
    amt: amts[0], amtIn: amts[1] !== amts[0] ? amts[1] : "", cur: t.amount.currency, cat: t.category ? (t.category.sub ?? t.category.main).category_key : null,
    acc: from, to, fee: t.transfer?.fee?.amount ?? "", date: copy ? today() : date, time: copy ? nowTime() : time, m: t.merchant ?? "", note: t.note ?? "",
    tags: t.tags.map((x) => x.tag_id), proj: t.project?.project_id ?? "", hist: copy ? undefined : (t as L.TransactionDetail).history, orig: copy ? undefined : t };
}

/* ------------------------------------------------------------ open */
export async function openEntry(o: { id?: number; copy?: boolean; type?: Kind; prefill?: Partial<Entry>; target?: "sheet" | "page" } = {}) {
  await getCatalog();
  if (o.id) {
    try { E = fromTx(await api.transaction(o.id), o.copy); }
    catch (e) { handleError(e); return; }
  } else E = { ...blank(o.type), ...(o.prefill ?? {}) };
  E.target = o.target ?? "sheet";
  if (E.target === "sheet") { openSheet("entry", sheetEntry(), () => { E = null; }); focusAmount(); }
}
export function openFromQueue(item: queue.QueueItem) {
  const b = item.body as any;
  const tr = "from_account_key" in b;
  const { date, time } = splitDT(b.occurred_at);
  E = { ...blank(), mode: "queue", qkey: item.key, key: item.key, type: tr ? "transfer" : b.type, amt: tr ? b.amount_out : b.amount, amtIn: b.amount_in ?? "", cur: b.currency ?? "TWD",
    cat: b.category_key ?? null, acc: tr ? b.from_account_key : b.account_key, to: b.to_account_key ?? null, fee: b.fee?.amount ?? "", date, time, m: b.merchant ?? "", note: b.note ?? "",
    tags: b.tag_ids ?? [], proj: b.project_id ?? "", formErr: item.error ? `送出失敗：${item.error.message}` : null };
  openSheet("entry", sheetEntry(), () => { E = null; });
}
export function restoreDraft(): boolean {
  const s = session.get(DRAFT); if (!s) return false;
  session.del(DRAFT);
  try { E = { ...JSON.parse(s), busy: false, sugg: [] }; } catch { return false; }
  openSheet("entry", sheetEntry(), () => { E = null; });
  toast("已還原登入前未送出的表單");
  return true;
}
function focusAmount() { setTimeout(() => { const a = $<HTMLInputElement>("#e-amt"); if (a && E?.mode !== "edit") a.focus({ preventScroll: true }); }, 300); }
export function renderEntry() {
  if (!E) return;
  if (E.target === "page") { const p = $("#entry-page"); if (p) p.innerHTML = entryPage(); }
  else if (sheet.kind === "entry") setSheet(sheetEntry());
  const a = $<HTMLInputElement>("#e-amt"); if (a) a.setAttribute("inputmode", matchMedia("(max-width: 959.98px)").matches ? "none" : "decimal");
}

/* ------------------------------------------------------------ render */
const errP = (k: string) => (E!.err[k] ? `<p class="err" id="err-${k}">${ic("alert", "s")}${esc(E!.err[k])}</p>` : "");
function body(): string {
  const e = E!, c = app.catalog!, tr = e.type === "transfer";
  const sign = tr ? "⇄" : e.type === "income" ? "+" : MINUS;
  const typeSeg = `<div class="seg full" role="group" aria-label="類型">${([["expense", MINUS + " 支出"], ["income", "+ 收入"], ["transfer", "⇄ 轉帳"]] as const).map(([k, l]) => `<button data-a="e-type" data-v="${k}" aria-pressed="${e.type === k}" ${e.mode === "edit" && (k === "transfer") !== tr ? "disabled" : ""}>${l}</button>`).join("")}</div>`;
  const fromAcc = accOpt(e.acc), toAcc = accOpt(e.to);
  const cross = tr && fromAcc && toAcc && fromAcc.currency !== toAcc.currency;
  const cur = tr ? fromAcc?.currency ?? "TWD" : e.cur;
  const amount = `<div class="fld"><label class="eyebrow" for="e-amt">${cross ? "轉出金額" : "金額"}</label><div class="amt-box ${e.err.amt ? "bad" : ""}"><span class="cur">${esc(curInfo(cur).symbol)}</span><span class="sg" aria-hidden="true">${sign}</span><input id="e-amt" class="amt-in" inputmode="decimal" placeholder="0" value="${esc(e.amt)}" autocomplete="off" ${e.err.amt ? 'aria-invalid="true" aria-describedby="err-amt"' : ""}></div>${errP("amt")}</div>
    ${cross ? `<div class="fld"><label class="eyebrow" for="e-amtin">轉入金額（${esc(toAcc!.currency)}）</label><div class="amt-box ${e.err.amtIn ? "bad" : ""}"><span class="cur">${esc(curInfo(toAcc!.currency).symbol)}</span><input id="e-amtin" class="amt-in" inputmode="decimal" placeholder="0" value="${esc(e.amtIn)}" autocomplete="off"></div>${errP("amtIn")}</div>` : ""}
    <div class="keypad only-m" aria-label="數字鍵盤">${["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => `<button data-a="kp" data-k="${k}" ${k === "del" ? 'aria-label="刪除一位"' : ""}>${k === "del" ? ic("chev-l") : k}</button>`).join("")}</div>`;
  let cat = "";
  if (!tr) {
    const kind = e.type;
    const mains = c.categories.filter((m) => m.kind === kind && !m.is_hidden);
    const freq = (kind === "income" ? c.frequent.income_categories : c.frequent.expense_categories).filter((k) => findCat(k)).slice(0, 8);
    const sel = findCat(e.cat), main = mainCat(e.cat);
    cat = `${freq.length ? `<div class="fld"><span class="eyebrow">常用</span><div class="chips-scroll">${freq.map((k) => { const f = findCat(k)!; return `<button class="chip" data-a="e-cat" data-v="${k}" aria-pressed="${e.cat === k}">${ic(catIconName(k), "s")}${esc(f.name)}</button>`; }).join("")}</div></div>` : ""}
    <div class="fld"><span class="eyebrow" id="lbl-cat">分類 ${sel ? `· <span style="color:var(--tx)">${esc(catLabel(e.cat))}</span>` : ""}</span>
      <div class="catgrid" role="group" aria-labelledby="lbl-cat">${mains.map((m) => `<button class="catbtn" data-a="e-cat" data-v="${m.category_key}" aria-pressed="${main?.category_key === m.category_key}"><span style="color:${catColor(m.category_key, m.icon)}">${ic(catIconName(m.category_key, m.icon))}</span>${esc(m.name)}</button>`).join("")}</div>
      ${main && main.children.filter((x) => !x.is_hidden).length ? `<div class="wrap-row" style="margin-top:4px">${main.children.filter((x) => !x.is_hidden).map((s) => `<button class="chip" data-a="e-cat" data-v="${s.category_key}" aria-pressed="${e.cat === s.category_key}">${ic("check", "s ck-i")}${esc(s.name)}</button>`).join("")}</div><p class="xs mu" style="margin:0">不選子分類也可以，只記主分類。</p>` : ""}
      ${errP("cat")}</div>`;
  }
  const accs = c.accounts.filter((a) => a.can_record);
  const accChips = (key: "acc" | "to", label: string) => `<div class="fld"><span class="eyebrow">${label}</span><div class="chips-scroll">${accs.map((a) => `<button class="chip" data-a="e-acc" data-k="${key}" data-v="${a.account_key}" aria-pressed="${e[key] === a.account_key}">${ic(a.icon ?? "wallet", "s")}${esc(a.name)}${a.currency !== "TWD" ? ` <span class="xs mu">${a.currency}</span>` : ""}</button>`).join("")}</div>${errP(key)}</div>`;
  const accPart = tr
    ? accChips("acc", "轉出帳戶") + `<div style="text-align:center;color:var(--mu)">${ic("chev-d")}</div>` + accChips("to", toAcc?.group === "credit_card" ? "轉入帳戶 · 會記成「繳卡費」" : "轉入帳戶（繳信用卡費 = 轉入信用卡）") +
      (e.mode === "edit" ? "" : `<div class="fld"><label class="eyebrow" for="e-fee">手續費（選填，記成 個人 › 手續費）</label><input id="e-fee" class="in num" inputmode="decimal" placeholder="0" value="${esc(e.fee)}">${errP("fee")}</div>`)
    : accChips("acc", "帳戶");
  const t0 = today(), y0 = addDays(t0, -1);
  const date = `<div class="fld"><span class="eyebrow">日期時間</span><div class="row" style="flex-wrap:wrap"><button class="chip" data-a="e-date" data-v="${t0}" aria-pressed="${e.date === t0}">今天</button><button class="chip" data-a="e-date" data-v="${y0}" aria-pressed="${e.date === y0}">昨天</button><label for="e-d" class="vh">日期</label><input id="e-d" class="in" type="date" value="${e.date}" style="width:auto;flex:1;min-width:140px"><label for="e-t" class="vh">時間</label><input id="e-t" class="in" type="time" value="${e.time}" style="width:110px"></div>${errP("date")}</div>`;
  const suggest = e.sugg.length ? `<div class="sugg" style="margin-top:6px" role="listbox" aria-label="商家建議">${e.sugg.map((s, i) => `<button data-a="sug" data-i="${i}" role="option"><span>${esc(s.merchant)}</span><span class="xs mu">${esc(s.last_category_key ? catLabel(s.last_category_key) : "")}${s.last_account_key ? " · " + esc(accOpt(s.last_account_key)?.name ?? "") : ""} · ${s.use_count} 次</span></button>`).join("")}</div>` : "";
  const more = `${tr ? "" : `<div class="fld" style="position:relative"><label class="eyebrow" for="e-m">商家／項目</label><input id="e-m" class="in" placeholder="例：學餐、全聯" value="${esc(e.m)}" autocomplete="off" maxlength="200"><div id="sugg">${suggest}</div>${errP("m")}</div>`}
    <div class="fld"><label class="eyebrow" for="e-note">備註</label><input id="e-note" class="in" value="${esc(e.note)}" placeholder="選填" maxlength="200">${errP("note")}</div>
    ${tr ? "" : `<div class="fld"><span class="eyebrow">標籤（最多 10 個）</span><div class="wrap-row">${c.tags.map((t) => `<button class="chip" data-a="e-tag" data-v="${t.tag_id}" aria-pressed="${e.tags.includes(t.tag_id)}">#${esc(t.name)}</button>`).join("")}</div>${errP("tags")}</div>
    <div class="two"><div class="fld"><label class="eyebrow" for="e-proj">專案</label><select id="e-proj" class="in"><option value="">無</option>${c.projects_active.map((p) => `<option value="${p.project_id}" ${e.proj === p.project_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="fld"><label class="eyebrow" for="e-cur">幣別</label><select id="e-cur" class="in">${c.currencies.map((x) => `<option value="${x.code}" ${e.cur === x.code ? "selected" : ""}>${esc(x.name)} ${esc(x.symbol)}</option>`).join("")}</select></div></div>`}`;
  const hist = e.mode === "edit" && e.hist ? `<div class="fld"><span class="eyebrow">修改紀錄</span><div class="hist">${e.hist.slice().reverse().map((h) => { const s = splitDT(h.at); return `<div><span class="num">${md(s.date)} ${s.time}</span> · <span class="src">${esc(h.actor)}</span><br><span class="mu">${({ create: "建立", update: "修改", delete: "刪除", restore: "還原", migrate: "從 MOZE 匯入" } as const)[h.action]}${h.changed_fields.length ? "：" + h.changed_fields.map((f) => FIELD_TEXT[f] ?? f).join("、") : ""}</span></div>`; }).join("")}</div></div>` : "";
  const info = e.mode === "edit" && e.orig ? `<p class="xs mu" style="margin:0">來源：${SOURCE_TEXT[e.orig.source]} · 版本 ${e.version}</p>` : "";
  const formErr = e.formErr ? `<div class="callout warn" role="alert">${ic("alert")}<div>${esc(e.formErr)}${e.retryable ? ` <button class="link" data-a="e-save">重試</button>` : ""}</div></div>` : "";
  return formErr + typeSeg + amount + cat + accPart + date + more + info + hist;
}
const FIELD_TEXT: Record<string, string> = { amount: "金額", account: "帳戶", category: "分類", merchant: "商家", note: "備註", tags: "標籤", project: "專案", occurred_at: "時間", type: "類型", currency: "幣別" };
function foot(): string {
  const e = E!, dis = e.busy ? "disabled" : "";
  if (e.mode === "edit") return `<button class="btn dg-t" data-a="askdel" data-id="${e.id}" style="flex:0 0 auto" ${dis}>${ic("trash", "s")}刪除</button><button class="btn" data-a="e-copy" style="flex:0 0 auto" ${dis}>${ic("copy", "s")}複製</button><button class="btn p" data-a="e-save" ${dis}>${e.busy ? "儲存中…" : ic("check", "s") + "儲存修改"}</button>`;
  if (e.mode === "queue") return `<button class="btn dg-t" data-a="queue-drop" style="flex:0 0 auto">${ic("trash", "s")}捨棄</button><button class="btn p" data-a="e-save" ${dis}>${ic("check", "s")}修正後送出</button>`;
  return `<button class="btn" data-a="e-save" data-again="1" ${dis}>再記一筆</button><button class="btn p" data-a="e-save" ${dis}>${e.busy ? "儲存中…" : ic("check", "s") + "儲存"}</button>`;
}
const titleOf = () => (E!.mode === "edit" ? "編輯紀錄" : E!.mode === "queue" ? "待同步的紀錄" : "記一筆");
export const sheetEntry = () => sheetShell(titleOf(), body(), foot());
export const entryPage = () => `<div class="ch"><h2 class="h2">${titleOf()}</h2></div><div class="stack" style="gap:16px">${body()}</div><div class="sheet-f" style="position:static;margin-top:16px;padding:0;border:0;background:none">${foot()}</div>`;

/* ------------------------------------------------------------ validate & build */
function validate(): boolean {
  const e = E!, err: Record<string, string> = {}, tr = e.type === "transfer";
  const from = accOpt(e.acc), to = accOpt(e.to);
  const dec = curInfo(tr ? from?.currency ?? "TWD" : e.cur).decimals;
  if (!isPositiveAmount(e.amt, dec)) err.amt = e.amt && Number(e.amt) > 0 ? `${curInfo(tr ? from?.currency ?? "TWD" : e.cur).code} 最多 ${dec} 位小數` : "請輸入金額（大於 0）";
  if (!e.acc) err.acc = tr ? "請選擇轉出帳戶" : "請選擇帳戶";
  if (tr) {
    if (!e.to) err.to = "請選擇轉入帳戶";
    else if (e.to === e.acc) err.to = "轉出和轉入不能是同一個帳戶，請改選其他帳戶";
    if (from && to && from.currency !== to.currency && !isPositiveAmount(e.amtIn, curInfo(to.currency).decimals)) err.amtIn = "跨幣別轉帳要填轉入金額";
    if (e.fee && !isPositiveAmount(e.fee, dec)) err.fee = "手續費要大於 0，或留空";
  } else {
    const c = findCat(e.cat);
    if (!c) err.cat = "請選擇分類";
    else if (c.kind !== e.type) err.cat = e.type === "expense" ? "支出不能選收入分類" : "收入不能選支出分類";
  }
  if (!e.date) err.date = "請選擇日期";
  if (e.tags.length > 10) err.tags = "最多 10 個標籤";
  e.err = err;
  return !Object.keys(err).length;
}
function txBody(): L.CreateTransactionRequest {
  const e = E!;
  return { idempotency_key: e.key, type: e.type as "expense" | "income", amount: e.amt, currency: e.cur, account_key: e.acc!, category_key: e.cat!, occurred_at: isoDateTime(e.date, e.time),
    merchant: e.m.trim() || null, note: e.note.trim() || null, tag_ids: e.tags, project_id: e.proj || null };
}
function trBody(): L.CreateTransferRequest {
  const e = E!; const to = accOpt(e.to);
  return { idempotency_key: e.key, type: to?.group === "credit_card" ? "credit_card_payment" : "transfer", from_account_key: e.acc!, to_account_key: e.to!, amount_out: e.amt,
    ...(e.amtIn ? { amount_in: e.amtIn } : {}), occurred_at: isoDateTime(e.date, e.time), note: e.note.trim() || null, fee: e.fee ? { amount: e.fee } : null };
}
const FIELD_MAP: Record<string, string> = { amount: "amt", amount_out: "amt", amount_in: "amtIn", category_key: "cat", account_key: "acc", from_account_key: "acc", to_account_key: "to", merchant: "m", note: "note", tag_ids: "tags", occurred_at: "date", fee: "fee", currency: "amt", project_id: "proj" };

/* ------------------------------------------------------------ save */
export async function saveEntry(again = false) {
  const e = E!; if (e.busy) return;
  e.formErr = null; e.retryable = false;
  if (!validate()) { renderEntry(); $(".sheet .err, #entry-page .err")?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
  const tr = e.type === "transfer";
  const label = tr ? (accOpt(e.to)?.group === "credit_card" ? "繳卡費" : "轉帳") : e.m || findCat(e.cat)?.name || "";
  const shown = fmt(e.amt, tr ? accOpt(e.acc)?.currency ?? "TWD" : e.cur);

  // 離線：新增進佇列，編輯停用
  if (!app.online && e.mode !== "edit") {
    await queue.enqueue({ key: e.key, kind: tr ? "transfer" : "transaction", body: tr ? trBody() : txBody(), queued_at: new Date().toISOString(), error: null });
    toast(`離線中，已暫存 ${esc(label)} ${shown}，連線後自動同步`);
    return finish(again);
  }
  if (!app.online) { e.formErr = "離線中不能修改，連線後再試"; renderEntry(); return; }

  e.busy = true; renderEntry();
  try {
    if (e.mode === "edit") {
      const patch: L.UpdateTransactionRequest["patch"] = tr
        ? { amount_out: e.amt, ...(e.amtIn ? { amount_in: e.amtIn } : {}), from_account_key: e.acc!, to_account_key: e.to!, occurred_at: isoDateTime(e.date, e.time), note: e.note.trim() || null }
        : (() => { const b = txBody(); const { idempotency_key, ...rest } = b; void idempotency_key; return rest; })();
      const old = e.orig!;
      const res = await api.updateTransaction(e.id!, { expected_version: e.version, patch });
      const nt = res.transaction;
      closeSheet(); E = null;
      toast(`已更新 ${esc(label)} ${shown}`, async () => {
        try {
          const back: L.UpdateTransactionRequest["patch"] = old.transfer ? { amount_out: (old.transfer.leg === "out" ? old.amount : old.transfer.counterpart.amount).amount, occurred_at: old.occurred_at, note: old.note }
            : { type: old.type as "expense" | "income", amount: old.amount.amount, currency: old.amount.currency, account_key: old.account.account_key, category_key: (old.category?.sub ?? old.category?.main)?.category_key, occurred_at: old.occurred_at, merchant: old.merchant, note: old.note, tag_ids: old.tags.map((t) => t.tag_id), project_id: old.project?.project_id ?? null };
          await api.updateTransaction(nt.id, { expected_version: nt.version, patch: back }); toast("已復原修改"); reload();
        } catch (err) { handleError(err); }
      });
    } else if (tr) {
      const res = await api.createTransfer(trBody());
      if (e.mode === "queue") await queue.remove(e.qkey!);
      toast(`${res.status === "duplicate" ? "這筆先前已送出" : "已記錄"} ${esc(label)} ${shown}`, () => undoCreate(res.legs[0]));
      return finish(again);
    } else {
      const res = await api.createTransaction(txBody());
      if (e.mode === "queue") await queue.remove(e.qkey!);
      toast(`${res.status === "duplicate" ? "這筆先前已送出" : "已記錄"} ${esc(label)} ${shown}`, () => undoCreate(res.transaction));
      return finish(again);
    }
    reload();
  } catch (err) {
    e.busy = false;
    onSaveError(err as LedgerError);
  }
}
async function undoCreate(t: L.Transaction) {
  try { await api.deleteTransaction(t.id, t.version, "復原新增"); toast("已復原（刪除剛剛新增的紀錄）"); reload(); } catch (err) { handleError(err); }
}
function finish(again: boolean) {
  const e = E!;
  if (again) { E = { ...blank(e.type), acc: e.acc, date: e.date, cur: e.cur, to: e.type === "transfer" ? e.to : null }; renderEntry(); setTimeout(() => $<HTMLInputElement>("#e-amt")?.focus(), 50); }
  else if (e.target === "page") { E = null; go("/transactions"); }
  else { closeSheet(); E = null; }
  reload();
}
function onSaveError(err: LedgerError) {
  const e = E!;
  if (!(err instanceof LedgerError)) { e.formErr = "發生未預期的錯誤"; renderEntry(); console.error(err); return; }
  switch (err.code) {
    case "VALIDATION_ERROR": case "AMOUNT_PRECISION": case "AMOUNT_NOT_POSITIVE": case "CATEGORY_KIND_MISMATCH": case "TRANSFER_SAME_ACCOUNT": case "CARD_PAYMENT_TARGET_NOT_CARD": case "ACCOUNT_INACTIVE": {
      const d = err.details ?? {};
      Object.entries(d).forEach(([k, v]) => { e.err[FIELD_MAP[k] ?? k] = v.join("；"); });
      const unmapped = Object.keys(d).filter((k) => !FIELD_MAP[k] && !["amt", "m", "note"].includes(k));
      e.formErr = !Object.keys(d).length || unmapped.length ? err.message : null;
      if (err.code === "ACCOUNT_INACTIVE") getCatalog(true);
      break;
    }
    case "UNKNOWN_ACCOUNT": case "UNKNOWN_CATEGORY": case "UNKNOWN_PROJECT":
      e.formErr = ERROR_TEXT[err.code]!; getCatalog(true).then(renderEntry);
      if (err.code === "UNKNOWN_ACCOUNT") e.acc = null; if (err.code === "UNKNOWN_CATEGORY") e.cat = null; if (err.code === "UNKNOWN_PROJECT") e.proj = "";
      break;
    case "IDEMPOTENCY_CONFLICT":
      dialog("這筆已經以不同內容送出過", `<p style="margin:0">同一張表單先前送出的內容和現在不同（例如送出後網路中斷、你又改了金額）。</p><p class="mu" style="margin:8px 0 0">要把現在的內容當成<b>新的一筆</b>送出嗎？請先到明細確認沒有重複。</p>`, "當成新的一筆送出", () => { e.key = newIdempotencyKey(); saveEntry(); }, { cancel: "先不要" });
      e.formErr = "這筆已經以不同內容送出過，請確認後再送出";
      break;
    case "VERSION_CONFLICT": {
      const cur = err.current as L.TransactionDetail | undefined;
      const preview = cur ? `<div class="card" style="padding:10px 12px;margin-top:10px"><b>${esc(cur.merchant ?? "")}</b> · ${amtHTML(cur)}<br><span class="xs mu">${esc(cur.account.name)} · ${md(cur.date)}（${wd(cur.date)}）${cur.note ? " · " + esc(cur.note) : ""} · 版本 ${cur.version}</span></div>` : "";
      dialog("這筆在別處被修改過", `<p style="margin:0">在你編輯的同時，這筆紀錄已經被其他裝置（例如捷徑或聊天機器人）修改。最新內容：</p>${preview}<p class="mu" style="margin:10px 0 0">重新載入會放棄你這次的修改。</p>`, "重新載入", () => {
        if (cur) { const t = e.target; E = fromTx(cur); E.target = t; renderEntry(); } else openEntry({ id: e.id! });
        reload();
      }, { cancel: "繼續編輯" });
      e.formErr = "這筆在別處被修改過";
      break;
    }
    case "NOT_FOUND": e.formErr = "這筆紀錄已不存在（可能已在別處刪除）"; reload(); break;
    case "AUTH_EXPIRED": session.set(DRAFT, JSON.stringify({ ...E, busy: false, sugg: [] })); e.formErr = "登入已過期，表單已暫存，重新登入後會自動還原"; break;
    case "DB_BUSY": case "WRITE_SERVICE_UNAVAILABLE": e.formErr = `${err.message}（已自動重試 2 次）`; e.retryable = true; break;
    case "OFFLINE": case "NETWORK":
      if (e.mode !== "edit") { app.online = navigator.onLine; e.formErr = "連線失敗，可以按重試，或在離線時存入待同步佇列"; e.retryable = true; }
      else { e.formErr = "連線失敗，請稍後再試"; e.retryable = true; }
      break;
    default: e.formErr = err.message || err.code;
  }
  renderEntry();
  $(".sheet .err, .sheet .callout, #entry-page .err")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* ------------------------------------------------------------ delete（含復原） */
export async function askDelete(id: number) {
  let t: L.Transaction;
  try { t = E?.orig?.id === id ? E.orig : await api.transaction(id); } catch (err) { handleError(err); return; }
  if (!app.online) { toast("離線中不能刪除"); return; }
  const group = t.transfer ? "<br>轉帳的轉出、轉入兩筆會一起刪除。" : "";
  dialog("刪除這筆紀錄？", `<p style="margin:0 0 6px"><b>${esc(t.merchant ?? "")}</b> · ${amtHTML(t)} · ${md(t.date)}</p><p class="mu" style="margin:0">30 天內可在 設定 › 最近刪除 中復原。${group}</p>`, "刪除", async () => {
    try {
      const res = await api.deleteTransaction(t.id, t.version);
      if (E) { closeSheet(); E = null; }
      toast(`已刪除 ${esc(t.merchant ?? "")} ${fmt(t.amount.amount, t.amount.currency)}`, async () => {
        try { await api.restoreTransaction(res.deleted_ids[0]); toast("已復原"); reload(); } catch (err) { handleError(err); }
      });
      reload();
    } catch (err) {
      const e = err as LedgerError;
      if (e?.code === "VERSION_CONFLICT") dialog("這筆在別處被修改過", "<p style='margin:0'>刪除前請先看看最新內容。</p>", "查看最新內容", () => openEntry({ id: t.id }), { cancel: "取消" });
      else handleError(err);
    }
  }, { danger: true });
}

/* ------------------------------------------------------------ actions & inputs */
let sugT: ReturnType<typeof setTimeout> | undefined;
actions({
  add() { openEntry(); },
  edit(el) {
    const row = el.closest(".tx") as HTMLElement | null; if (row?.dataset.dragged) return;
    const sw = el.closest(".sw"); if (sw?.classList.contains("open") && el.classList.contains("tx-b")) { sw.classList.remove("open"); (sw.querySelector(".tx") as HTMLElement).style.transform = ""; return; }
    openEntry({ id: Number(el.dataset.id) });
  },
  askdel(el) { askDelete(Number(el.dataset.id)); },
  "e-type"(el) {
    const e = E!; const v = el.dataset.v as Kind; if (e.type === v) return;
    e.type = v; e.err = {};
    if (findCat(e.cat)?.kind !== v) e.cat = v === "income" ? app.catalog!.frequent.income_categories[0] ?? null : null;
    renderEntry();
  },
  kp(el) {
    const e = E!; const k = el.dataset.k!; let v = e.amt;
    if (k === "del") v = v.slice(0, -1); else if (k === ".") { if (!v.includes(".")) v = (v || "0") + "."; } else if (v.length < 12) v = (v === "0" ? "" : v) + k;
    e.amt = v; const i = $<HTMLInputElement>("#e-amt"); if (i) i.value = v;
    if (e.err.amt && Number(v) > 0) { delete e.err.amt; renderEntry(); }
  },
  "e-cat"(el) { const e = E!; e.cat = el.dataset.v!; delete e.err.cat; renderEntry(); },
  "e-acc"(el) {
    const e = E!; const k = el.dataset.k as "acc" | "to"; e[k] = el.dataset.v!; delete e.err.acc; delete e.err.to;
    if (k === "acc" && e.type !== "transfer") e.cur = accOpt(e.acc)?.currency ?? e.cur;
    renderEntry();
  },
  "e-tag"(el) { const e = E!; const v = el.dataset.v!; e.tags = e.tags.includes(v) ? e.tags.filter((x) => x !== v) : [...e.tags, v]; renderEntry(); },
  "e-date"(el) { E!.date = el.dataset.v!; renderEntry(); },
  "e-save"(el) { saveEntry(!!el.dataset.again); },
  "e-copy"() { const id = E!.id!; openEntry({ id, copy: true }); toast("已複製，修改後儲存成新的一筆"); },
  sug(el) {
    const e = E!; const s = e.sugg[Number(el.dataset.i)]; if (!s) return;
    e.m = s.merchant; e.sugg = [];
    if (s.last_category_key && findCat(s.last_category_key)) { const k = findCat(s.last_category_key)!.kind; if (k === "expense" || k === "income") { e.type = k; e.cat = s.last_category_key; } }
    if (s.last_account_key && accOpt(s.last_account_key)?.can_record) { e.acc = s.last_account_key; e.cur = accOpt(e.acc)!.currency; }
    renderEntry();
  },
  async "queue-open"(el) { const k = el.dataset.id!.replace(/^q:/, ""); const it = (await queue.list()).find((x) => x.key === k); if (it) openFromQueue(it); },
  async "queue-drop"() { const e = E!; dialog("捨棄這筆待同步紀錄？", "<p style='margin:0'>還沒送到伺服器，捨棄後無法復原。</p>", "捨棄", async () => { await queue.remove(e.qkey!); closeSheet(); E = null; reload(); }, { danger: true }); },
});
document.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement; if (!E || !t.id?.startsWith("e-")) return;
  const e = E;
  if (t.id === "e-amt") { e.amt = t.value.replace(/[^\d.]/g, ""); if (t.value !== e.amt) t.value = e.amt; }
  else if (t.id === "e-amtin") { e.amtIn = t.value.replace(/[^\d.]/g, ""); if (t.value !== e.amtIn) t.value = e.amtIn; }
  else if (t.id === "e-m") {
    e.m = t.value; clearTimeout(sugT);
    const q = t.value.trim();
    sugT = setTimeout(async () => {
      if (!E || E.m.trim() !== q) return;
      if (!q || !app.online) { E.sugg = []; } else { try { E.sugg = (await api.merchants(q, 5)).rows.filter((r) => r.merchant !== q); } catch { E.sugg = []; } }
      const box = $("#sugg"); if (box) { box.innerHTML = ""; renderEntry(); const inp = $<HTMLInputElement>("#e-m"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
    }, 220);
  }
  else if (t.id === "e-note") e.note = t.value;
  else if (t.id === "e-fee") e.fee = t.value.replace(/[^\d.]/g, "");
});
document.addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement; if (!E || !t.id?.startsWith("e-")) return;
  if (t.id === "e-d") { E.date = t.value; renderEntry(); }
  else if (t.id === "e-t") E.time = t.value;
  else if (t.id === "e-proj") E.proj = t.value;
  else if (t.id === "e-cur") { E.cur = t.value; renderEntry(); }
});
