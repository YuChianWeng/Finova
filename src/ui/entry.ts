/**
 * ＋ 記一筆／編輯表單（issue #10 版面）：
 * - 手機全螢幕（頂部 ✕ 取消、標題、✓ 儲存），桌面右側抽屜；/finance/new 為全頁版，內部版面相同
 * - 類型分頁：建議｜支出｜收入｜轉帳｜應收款項｜應付款項｜系統（後三者契約 v1.0 沒有，顯示「即將推出」）
 * - 分類格：5 欄圓形圖示；支出先選主分類再選子分類（第一格「返回」）；收入直接顯示子分類，最後一格「＋新增」
 * - 金額欄可輸入簡易算式（120+35），儲存前用十進位算出結果
 * - 兩欄欄位按鈕：帳戶、專案、日期、時間、週期、標籤；點了開啟選擇器
 *
 * 契約行為照舊：
 * - 開表單時產生 idempotency_key，重送沿用同一把（契約 §1.5）
 * - 編輯、刪除帶 expected_version，衝突時顯示最新內容並提供「重新載入」（§1.6）
 * - 依 error.details 把錯誤顯示在欄位旁（§5）
 * - 離線時新增存進佇列，標「待同步」（§6）
 * - 登入過期時把表單暫存在 sessionStorage，回來後還原（§6）
 */
import type * as L from "../types/ledger";
import { $, esc, ic, session } from "../lib/dom";
import { fmt, isPositiveAmount, curInfo, calc, hasOperator } from "../lib/money";
import { today, addDays, nowTime, isoDateTime, splitDT, md, wd, monthOf, addMonths, daysInMonth } from "../lib/dates";
import { app, getCatalog, findCat, mainCat, accOpt, catLabel } from "../state";
import { api } from "../api/ledger";
import { LedgerError, newIdempotencyKey, ERROR_TEXT } from "../api/client";
import * as queue from "../api/offline";
import { actions, reload, handleError, go } from "../app";
import { back as routerBack } from "../router";
import { amtHTML, catColor, catIconName, SOURCE_TEXT } from "./components";
import { openSheet, setSheet, closeSheet, dialog, toast, sheet } from "./overlay";

type Kind = "expense" | "income" | "transfer";
type Tab = "suggest" | Kind | "receivable" | "payable" | "system";
type Pick = "acc" | "to" | "proj" | "rec" | "tags";
type Freq = "" | "daily" | "weekly" | "monthly" | "yearly";
export type Entry = {
  mode: "new" | "edit" | "queue"; target: "sheet" | "page";
  id: number | null; version: number; key: string; qkey?: string;
  type: Kind; amt: string; amtIn: string; cur: string;
  cat: string | null; acc: string | null; to: string | null; fee: string;
  date: string; time: string; m: string; note: string; tags: string[]; proj: string;
  /** 目前的分頁；支出分類格停在哪個主分類（null = 主分類層）；開著哪個選擇器；週期 */
  tab: Tab; lvl: string | null; pick: Pick | null; rec: Freq;
  err: Record<string, string>; formErr: string | null; retryable: boolean; busy: boolean;
  hist?: L.TransactionDetail["history"]; orig?: L.Transaction; sugg: L.MerchantSuggestion[];
};
let E: Entry | null = null;
export const entryState = () => E;
const DRAFT = "finova-draft";
const SOON: Tab[] = ["receivable", "payable", "system"];
const TABS: [Tab, string][] = [["suggest", "建議"], ["expense", "支出"], ["income", "收入"], ["transfer", "轉帳"], ["receivable", "應收款項"], ["payable", "應付款項"], ["system", "系統"]];
const FREQ_TEXT: Record<Freq, string> = { "": "單次", daily: "每天", weekly: "每週", monthly: "每月", yearly: "每年" };

function blank(type: Kind = "expense"): Entry {
  const c = app.catalog!;
  const acc = c.frequent.accounts.find((k) => accOpt(k)?.can_record) ?? c.accounts.find((a) => a.can_record)?.account_key ?? null;
  return { mode: "new", target: "sheet", id: null, version: 0, key: newIdempotencyKey(), type, amt: "", amtIn: "", cur: accOpt(acc)?.currency ?? "TWD",
    cat: null, acc, to: null, fee: "", date: today(), time: nowTime(), m: "", note: "", tags: [], proj: "",
    tab: type, lvl: null, pick: null, rec: "",
    err: {}, formErr: null, retryable: false, busy: false, sugg: [] };
}
function fromTx(t: L.TransactionDetail | L.Transaction, copy = false): Entry {
  const tr = !!t.transfer;
  const [from, to] = tr ? (t.transfer!.leg === "out" ? [t.account.account_key, t.transfer!.counterpart.account_key] : [t.transfer!.counterpart.account_key, t.account.account_key]) : [t.account.account_key, null];
  const amts = tr ? (t.transfer!.leg === "out" ? [t.amount.amount, t.transfer!.counterpart.amount.amount] : [t.transfer!.counterpart.amount.amount, t.amount.amount]) : [t.amount.amount, ""];
  const { date, time } = splitDT(t.occurred_at);
  const type: Kind = tr ? "transfer" : (t.type === "income" ? "income" : "expense");
  const cat = t.category ? (t.category.sub ?? t.category.main).category_key : null;
  return { ...blank(), mode: copy ? "new" : "edit", id: copy ? null : t.id, version: t.version, type, tab: type, lvl: t.category?.sub ? t.category.main.category_key : null,
    amt: amts[0], amtIn: amts[1] !== amts[0] ? amts[1] : "", cur: t.amount.currency, cat,
    acc: from, to, fee: t.transfer?.fee?.amount ?? "", date: copy ? today() : date, time: copy ? nowTime() : time, m: t.merchant ?? "", note: t.note ?? "",
    tags: t.tags.map((x) => x.tag_id), proj: t.project?.project_id ?? "", hist: copy ? undefined : (t as L.TransactionDetail).history, orig: copy ? undefined : t };
}

/* ------------------------------------------------------------ open */
export async function openEntry(o: { id?: number; copy?: boolean; type?: Kind; prefill?: Partial<Entry>; target?: "sheet" | "page" } = {}) {
  await getCatalog();
  if (o.id) {
    try { E = fromTx(await api.transaction(o.id), o.copy); }
    catch (e) { handleError(e); return; }
  } else { E = { ...blank(o.type), ...(o.prefill ?? {}) }; if (o.prefill?.type) E.tab = o.prefill.type; }
  E.target = o.target ?? "sheet";
  if (E.target === "sheet") { showSheet(); focusAmount(); }
}
const showSheet = () => openSheet("entry", entryHTML(), () => { E = null; }, { cls: "entry", returnFocus: "[data-a=add]" });
export function openFromQueue(item: queue.QueueItem) {
  const b = item.body as any;
  const tr = "from_account_key" in b;
  const { date, time } = splitDT(b.occurred_at);
  const type: Kind = tr ? "transfer" : b.type;
  E = { ...blank(), mode: "queue", qkey: item.key, key: item.key, type, tab: type, amt: tr ? b.amount_out : b.amount, amtIn: b.amount_in ?? "", cur: b.currency ?? "TWD",
    cat: b.category_key ?? null, acc: tr ? b.from_account_key : b.account_key, to: b.to_account_key ?? null, fee: b.fee?.amount ?? "", date, time, m: b.merchant ?? "", note: b.note ?? "",
    tags: b.tag_ids ?? [], proj: b.project_id ?? "", formErr: item.error ? `送出失敗：${item.error.message}` : null };
  E.lvl = mainCat(E.cat)?.category_key !== E.cat ? mainCat(E.cat)?.category_key ?? null : null;
  showSheet();
}
export function restoreDraft(): boolean {
  const s = session.get(DRAFT); if (!s) return false;
  session.del(DRAFT);
  try { E = { ...blank(), ...JSON.parse(s), busy: false, sugg: [], pick: null }; } catch { return false; }
  showSheet();
  toast("已還原登入前未送出的表單");
  return true;
}
/** 桌面開表單時直接把游標放在金額；手機先選分類，選好再聚焦（避免鍵盤蓋住分類格） */
function focusAmount(force = false) {
  setTimeout(() => {
    const a = $<HTMLInputElement>("#e-amt");
    if (a && E?.mode !== "edit" && (force || matchMedia("(min-width: 960px)").matches)) a.focus({ preventScroll: !force });
  }, force ? 30 : 300);
}
export function renderEntry() {
  if (!E) return;
  if (E.target === "page") { const p = $("#entry-page"); if (p) p.innerHTML = entryHTML(); }
  else if (sheet.kind === "entry") setSheet(entryHTML());
}

/* ------------------------------------------------------------ render */
const errP = (k: string) => (E!.err[k] ? `<p class="err" id="err-${k}">${ic("alert", "s")}${esc(E!.err[k])}</p>` : "");
const titleOf = () => (E!.mode === "edit" ? "編輯記錄" : E!.mode === "queue" ? "待同步的記錄" : "新增記錄");
const isSoon = (t: Tab) => SOON.includes(t);

/** 頂部：✕ 取消、標題、✓ 儲存 */
function head(): string {
  const e = E!, dis = e.busy || isSoon(e.tab) ? "disabled" : "";
  return `<div class="eh"><button class="ibtn" data-a="e-close" aria-label="取消">${ic("x")}</button><h2 class="h2" id="sheet-title">${titleOf()}</h2><button class="ibtn eh-ok" data-a="e-save" aria-label="${e.busy ? "儲存中" : "儲存"}" ${dis}>${ic("check")}</button></div>`;
}
function tabs(): string {
  const e = E!, trNow = e.type === "transfer";
  return `<div class="etabs" role="tablist" aria-label="類型">${TABS.map(([k, l]) => {
    // 編輯時不能在轉帳／非轉帳之間切換（契約：轉帳是兩筆一組）
    const lock = e.mode === "edit" && (isSoon(k) || (k === "transfer") !== trNow || (k === "suggest" && trNow));
    return `<button role="tab" data-a="e-tab" data-v="${k}" aria-selected="${e.tab === k}" ${lock ? "disabled" : ""}>${l}${isSoon(k) ? '<span class="soon-dot" aria-hidden="true"></span>' : ""}</button>`;
  }).join("")}</div>`;
}

/* ---------- 分類格 */
const cell = (o: { a: string; v: string; name: string; icon: string; color: string; on: boolean; sub?: string; cls?: string; label?: string }) =>
  `<button class="cg ${o.cls ?? ""}" data-a="${o.a}" data-v="${esc(o.v)}" aria-pressed="${o.on}" ${o.label ? `aria-label="${esc(o.label)}"` : ""}><span class="cg-ic" style="--cc:${o.color}">${ic(o.icon)}</span><span class="cg-n">${esc(o.name)}</span>${o.sub ? `<span class="cg-s">${o.sub}</span>` : ""}</button>`;
/** 圖示：分類自己的 icon → 主分類的 icon → 「?」 */
const iconOf = (key: string, icon: string | null | undefined) => icon ?? (mainCat(key)?.icon ?? null) ?? "q";
function catGrid(): string {
  const e = E!, c = app.catalog!;
  if (e.tab === "suggest") {
    const keys = [...c.frequent.expense_categories, ...c.frequent.income_categories].filter((k) => { const f = findCat(k); return f && !f.is_hidden; });
    if (!keys.length) return `<p class="sm mu" style="margin:8px 0">還沒有常用分類，記幾筆之後會出現在這裡。</p>`;
    return `<div class="cgrid" role="group" aria-label="建議分類">${keys.map((k) => { const f = findCat(k)!; return cell({ a: "e-cat", v: k, name: f.name, icon: catIconName(k, iconOf(k, f.icon)), color: catColor(k, f.icon), on: e.cat === k, sub: f.kind === "income" ? "收入" : "支出", label: `${f.kind === "income" ? "收入" : "支出"}：${catLabel(k)}` }); }).join("")}</div>`;
  }
  if (e.tab === "expense") {
    const lvl = e.lvl ? c.categories.find((m) => m.category_key === e.lvl) : null;
    if (lvl) {
      const kids = lvl.children.filter((x) => !x.is_hidden);
      return `<div class="cgrid" role="group" aria-label="${esc(lvl.name)} 子分類">${cell({ a: "e-lvl", v: "", name: "返回", icon: catIconName(lvl.category_key, iconOf(lvl.category_key, lvl.icon)), color: catColor(lvl.category_key, lvl.icon), on: false, cls: "back", label: `返回主分類（目前：${lvl.name}）` })}${kids.map((s) => cell({ a: "e-cat", v: s.category_key, name: s.name, icon: catIconName(s.category_key, iconOf(s.category_key, s.icon)), color: catColor(lvl.category_key, lvl.icon), on: e.cat === s.category_key })).join("")}</div>
        <p class="xs mu cg-hint">${e.cat === lvl.category_key ? `已選「${esc(lvl.name)}」；也可以再選子分類` : `不選子分類也可以，按「返回」只記主分類`}</p>`;
    }
    const mains = c.categories.filter((m) => m.kind === "expense" && !m.is_hidden);
    return `<div class="cgrid" role="group" aria-label="支出主分類">${mains.map((m) => cell({ a: "e-main", v: m.category_key, name: m.name, icon: catIconName(m.category_key, iconOf(m.category_key, m.icon)), color: catColor(m.category_key, m.icon), on: mainCat(e.cat)?.category_key === m.category_key && findCat(e.cat)?.kind === "expense" })).join("")}</div>`;
  }
  // 收入：直接列子分類（沒有子分類的主分類列它自己），最後一格「＋新增」
  const items = c.categories.filter((m) => m.kind === "income" && !m.is_hidden).flatMap((m) => { const kids = m.children.filter((x) => !x.is_hidden); return kids.length ? kids.map((k) => ({ k: k.category_key, n: k.name, icon: k.icon, main: m })) : [{ k: m.category_key, n: m.name, icon: m.icon, main: m }]; });
  return `<div class="cgrid" role="group" aria-label="收入分類">${items.map((x) => cell({ a: "e-cat", v: x.k, name: x.n, icon: catIconName(x.k, iconOf(x.k, x.icon ?? x.main.icon)), color: catColor(x.main.category_key, x.main.icon), on: e.cat === x.k })).join("")}<button class="cg add" data-a="e-newcat"><span class="cg-ic">${ic("plus")}</span><span class="cg-n">新增</span></button></div>`;
}
function soonPanel(t: Tab): string {
  if (t === "system") return `<div class="soon">${ic("scale")}<div><b>系統（餘額調整）</b><p class="sm mu">餘額調整請從對帳建立：輸入實際餘額，App 會算出差額並記成「餘額調整」（不計入收支）。</p><button class="btn sm" data-a="e-go-rec">前往對帳</button></div></div>`;
  const n = t === "receivable" ? "應收款項" : "應付款項";
  return `<div class="soon">${ic("clock")}<div><b>${n} · 即將推出</b><p class="sm mu">${n}需要新版記帳格式（契約 v1.1）與後端支援，目前還不能從這裡記錄。${t === "receivable" ? "借錢給別人，暫時可以記成「轉帳」到應收帳戶。" : ""}</p></div></div>`;
}

/* ---------- 金額與名稱 */
function amountBlock(): string {
  const e = E!, c = app.catalog!, tr = e.type === "transfer";
  const fromAcc = accOpt(e.acc), toAcc = accOpt(e.to);
  const cross = tr && fromAcc && toAcc && fromAcc.currency !== toAcc.currency;
  const cur = tr ? fromAcc?.currency ?? "TWD" : e.cur;
  const curChip = tr ? `<span class="cur-chip static" title="轉出帳戶的幣別">${esc(cur)}</span>`
    : `<label class="vh" for="e-cur">幣別</label><select id="e-cur" class="cur-chip">${c.currencies.map((x) => `<option value="${x.code}" ${e.cur === x.code ? "selected" : ""}>${esc(x.code)}</option>`).join("")}</select>`;
  const dec = curInfo(cur).decimals;
  const preview = hasOperator(e.amt) ? (() => { const v = calc(e.amt, dec); return `<p class="calc-hint ${v === null ? "bad" : ""}" aria-live="polite">${v === null ? "算式不完整" : "= " + esc(fmt(v, cur))}</p>`; })() : "";
  const amt = `<div class="arow ${e.err.amt ? "bad" : ""}">${curChip}<label class="vh" for="e-amt">${cross ? "轉出金額" : "金額"}</label><input id="e-amt" class="amt-in" inputmode="decimal" enterkeyhint="done" placeholder="0" value="${esc(e.amt)}" autocomplete="off" ${e.err.amt ? 'aria-invalid="true" aria-describedby="err-amt"' : ""}><button class="ibtn calc-btn" data-a="e-plus" aria-label="加（輸入算式，例如 120+35）">${ic("plus")}</button></div>${preview}${errP("amt")}`;
  const amtIn = cross ? `<div class="arow ${e.err.amtIn ? "bad" : ""}"><span class="cur-chip static">${esc(toAcc!.currency)}</span><label class="vh" for="e-amtin">轉入金額（${esc(toAcc!.currency)}）</label><input id="e-amtin" class="amt-in sm" inputmode="decimal" placeholder="轉入金額" value="${esc(e.amtIn)}" autocomplete="off"></div>${errP("amtIn")}` : "";
  const suggest = e.sugg.length ? `<div class="sugg" role="listbox" aria-label="名稱建議">${e.sugg.map((s, i) => `<button data-a="sug" data-i="${i}" role="option"><span>${esc(s.merchant)}</span><span class="xs mu">${esc(s.last_category_key ? catLabel(s.last_category_key) : "")}${s.last_account_key ? " · " + esc(accOpt(s.last_account_key)?.name ?? "") : ""} · ${s.use_count} 次</span></button>`).join("")}</div>` : "";
  const name = tr ? "" : `<div class="nrow ${e.err.m ? "bad" : ""}">${ic("receipt", "s")}<label class="vh" for="e-m">名稱</label><input id="e-m" placeholder="名稱" value="${esc(e.m)}" autocomplete="off" maxlength="200"><button class="ibtn bare" data-a="e-star" aria-label="加入常用範本（即將推出）">${ic("star", "s")}</button></div><div id="sugg">${suggest}</div>${errP("m")}`;
  return `<div class="amtblk"><button class="photo" data-a="e-photo" aria-label="收據照片（即將推出）" aria-disabled="true">${ic("camera")}<span>即將推出</span></button><div class="amtcol">${amt}${amtIn}${name}</div></div>`;
}

/* ---------- 兩欄欄位按鈕 */
const fbtn = (a: string, v: string, label: string, value: string | null, placeholder: string, err?: string) =>
  `<button class="fbtn ${value ? "" : "empty"} ${err ? "bad" : ""}" data-a="${a}" data-v="${v}" aria-label="${esc(label)}：${esc(value ?? placeholder)}"><span class="fl">${esc(label)}</span><span class="fv">${esc(value ?? placeholder)}</span>${ic("chev-r", "s")}</button>`;
function dateLabel(d: string) { const t = today(); return `${d === t ? "今天" : d === addDays(t, -1) ? "昨天" : d === addDays(t, 1) ? "明天" : md(d)}（週${wd(d)}）`; }
function fields(): string {
  const e = E!, c = app.catalog!, tr = e.type === "transfer";
  const dateBtn = `<label class="fbtn ${e.err.date ? "bad" : ""}"><span class="fl">日期</span><span class="fv">${e.date ? dateLabel(e.date) : "選擇日期"}</span><input id="e-d" class="fbtn-in" type="date" value="${e.date}" aria-label="日期"></label>`;
  const timeBtn = `<label class="fbtn"><span class="fl">時間</span><span class="fv num">${esc(e.time || "--:--")}</span><input id="e-t" class="fbtn-in" type="time" value="${e.time}" aria-label="時間"></label>`;
  if (tr) {
    const toAcc = accOpt(e.to);
    return `<div class="fgrid">${fbtn("e-pick", "acc", "轉出帳戶", accOpt(e.acc)?.name ?? null, "選擇帳戶", e.err.acc)}${fbtn("e-pick", "to", toAcc?.group === "credit_card" ? "轉入（繳卡費）" : "轉入帳戶", toAcc?.name ?? null, "選擇帳戶", e.err.to)}${dateBtn}${timeBtn}
      ${e.mode === "edit" ? "" : `<label class="fbtn ${e.err.fee ? "bad" : ""} ${e.fee ? "" : "empty"}"><span class="fl">手續費（選填）</span><input id="e-fee" class="fv-in num" inputmode="decimal" placeholder="0" value="${esc(e.fee)}"></label>`}</div>
      ${errP("acc")}${errP("to")}${errP("fee")}${errP("date")}
      <p class="xs mu" style="margin:0">轉入信用卡會自動記成「繳卡費」；手續費記成 個人 › 手續費。</p>`;
  }
  const proj = c.projects_active.find((p) => p.project_id === e.proj)?.name ?? null;
  const tags = e.tags.map((id) => c.tags.find((t) => t.tag_id === id)?.name).filter(Boolean).map((n) => "#" + n).join(" ");
  const recBtn = e.mode === "new" ? fbtn("e-pick", "rec", "週期", e.rec ? recText(e.rec, e.date) : null, "單次", e.err.rec) : `<div class="fbtn empty" aria-disabled="true"><span class="fl">週期</span><span class="fv">單次</span></div>`;
  return `<div class="fgrid">${fbtn("e-pick", "acc", "帳戶", accOpt(e.acc)?.name ?? null, "選擇帳戶", e.err.acc)}${fbtn("e-pick", "proj", "專案", proj, "無專案", e.err.proj)}${dateBtn}${timeBtn}${recBtn}${fbtn("e-pick", "tags", "標籤", tags || null, "#標籤", e.err.tags)}</div>
    ${errP("acc")}${errP("proj")}${errP("date")}${errP("rec")}${errP("tags")}`;
}
function recText(f: Freq, d: string) {
  if (f === "weekly") return `每週${wd(d)}`;
  if (f === "monthly") return `每月 ${+d.slice(8)} 日`;
  if (f === "yearly") return `每年 ${md(d)}`;
  return FREQ_TEXT[f];
}

/* ---------- 選擇器（在表單內切換，不另開面板） */
function picker(): string {
  const e = E!, c = app.catalog!, p = e.pick!;
  const row = (a: string, v: string, label: string, on: boolean, sub = "", icon = "") => `<button class="opt-row" data-a="${a}" data-v="${esc(v)}" aria-pressed="${on}">${icon ? ic(icon, "s") : ""}<span class="grow">${label}${sub ? `<span class="xs mu"> ${sub}</span>` : ""}</span>${on ? ic("check", "s") : ""}</button>`;
  let title = "", list = "";
  if (p === "acc" || p === "to") {
    title = p === "to" ? "轉入帳戶" : e.type === "transfer" ? "轉出帳戶" : "帳戶";
    list = c.accounts.filter((a) => a.can_record).map((a) => row("e-set", a.account_key, esc(a.name), e[p] === a.account_key, a.currency !== "TWD" ? a.currency : "", a.icon ?? "wallet")).join("");
  } else if (p === "proj") {
    title = "專案";
    list = row("e-set", "", "無專案", !e.proj) + c.projects_active.map((x) => row("e-set", x.project_id, esc(x.name), e.proj === x.project_id, `${md(x.start_date)}–${md(x.end_date)}`, "plane")).join("");
  } else if (p === "rec") {
    title = "週期";
    const off = !app.online ? `<p class="callout warn sm" style="margin:0 0 8px">${ic("alert", "s")}離線時不能設定週期，連線後再設定。</p>` : "";
    list = off + (["", "daily", "weekly", "monthly", "yearly"] as Freq[]).map((f) => row("e-set", f, f ? recText(f, e.date) : "單次", e.rec === f, f ? "從下一期開始自動提醒入帳" : "")).join("");
  } else {
    title = "標籤（最多 10 個）";
    list = c.tags.length ? c.tags.map((t) => row("e-set", t.tag_id, "#" + esc(t.name), e.tags.includes(t.tag_id))).join("") : `<p class="sm mu">還沒有標籤，可以在 設定 › 標籤 新增。</p>`;
  }
  return `<div class="pick"><div class="pick-h"><button class="btn sm g" data-a="e-pick-back">${ic("chev-l", "s")}返回</button><b>${title}</b>${p === "tags" ? `<button class="btn sm p" data-a="e-pick-back">完成</button>` : "<span></span>"}</div><div class="pick-l" role="group" aria-label="${esc(title)}">${list}</div></div>`;
}

function bodyHTML(): string {
  const e = E!;
  const formErr = e.formErr ? `<div class="callout warn" role="alert">${ic("alert")}<div>${esc(e.formErr)}${e.retryable ? ` <button class="link" data-a="e-save">重試</button>` : ""}</div></div>` : "";
  if (e.pick) return formErr + picker();
  if (isSoon(e.tab)) return formErr + tabs() + soonPanel(e.tab);
  const cat = e.type === "transfer" ? "" : `<div class="fld">${catGrid()}${errP("cat")}</div>`;
  const note = `<div class="fld"><label class="vh" for="e-note">備註</label><textarea id="e-note" class="in note-in" rows="2" maxlength="200" placeholder="備註">${esc(e.note)}</textarea>${errP("note")}</div>`;
  const dis = e.busy ? "disabled" : "";
  const actionsRow = e.mode === "edit"
    ? `<div class="row e-more"><button class="btn dg-t" data-a="askdel" data-id="${e.id}" ${dis}>${ic("trash", "s")}刪除</button><button class="btn" data-a="e-copy" ${dis}>${ic("copy", "s")}複製成新的一筆</button></div>`
    : e.mode === "queue" ? `<div class="row e-more"><button class="btn dg-t" data-a="queue-drop">${ic("trash", "s")}捨棄這筆待同步紀錄</button></div>`
    : `<button class="btn wide" data-a="e-save" data-again="1" ${dis}>${ic("plus", "s")}儲存並再記一筆</button>`;
  const hist = e.mode === "edit" && e.hist ? `<div class="fld"><span class="eyebrow">修改紀錄</span><div class="hist">${e.hist.slice().reverse().map((h) => { const s = splitDT(h.at); return `<div><span class="num">${md(s.date)} ${s.time}</span> · <span class="src">${esc(h.actor)}</span><br><span class="mu">${({ create: "建立", update: "修改", delete: "刪除", restore: "還原", migrate: "從 MOZE 匯入" } as const)[h.action]}${h.changed_fields.length ? "：" + h.changed_fields.map((f) => FIELD_TEXT[f] ?? f).join("、") : ""}</span></div>`; }).join("")}</div></div>` : "";
  const info = e.mode === "edit" && e.orig ? `<p class="xs mu" style="margin:0">來源：${SOURCE_TEXT[e.orig.source]} · 版本 ${e.version}</p>` : "";
  return formErr + tabs() + cat + amountBlock() + fields() + note + actionsRow + info + hist;
}
const FIELD_TEXT: Record<string, string> = { amount: "金額", account: "帳戶", category: "分類", merchant: "名稱", note: "備註", tags: "標籤", project: "專案", occurred_at: "時間", type: "類型", currency: "幣別" };
/** 面板與 /finance/new 共用：頂部列＋可捲動內容 */
export const entryHTML = () => `${head()}<div class="sheet-b entry-b">${bodyHTML()}</div>`;
/** 舊名稱（/finance/new 用 renderEntry 畫進 #entry-page） */
export const sheetEntry = entryHTML;

/* ------------------------------------------------------------ validate & build */
function validate(): boolean {
  const e = E!, err: Record<string, string> = {}, tr = e.type === "transfer";
  const from = accOpt(e.acc), to = accOpt(e.to);
  const dec = curInfo(tr ? from?.currency ?? "TWD" : e.cur).decimals;
  if (isSoon(e.tab)) { e.formErr = "這個類型即將推出，目前還不能記錄"; e.err = err; return false; }
  // 簡易計算機：有算式時先算出結果（十進位運算），再照一般規則驗證
  if (hasOperator(e.amt)) { const v = calc(e.amt, dec); if (v === null) err.amt = "算式不完整，請檢查"; else e.amt = v; }
  if (err.amt) { /* 已有錯誤 */ }
  else if (!isPositiveAmount(e.amt, dec)) err.amt = e.amt && Number(e.amt) > 0 ? `${curInfo(tr ? from?.currency ?? "TWD" : e.cur).code} 最多 ${dec} 位小數` : "請輸入金額（大於 0）";
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
  if (e.rec && !tr && e.mode === "new" && !app.online) err.rec = "離線時不能設定週期，請連線後再設定，或改成單次";
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
  if (!validate()) { renderEntry(); $(".sheet .err, .sheet .callout, #entry-page .err, #entry-page .callout")?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
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
      const body = txBody();
      const res = await api.createTransaction(body);
      if (e.mode === "queue") await queue.remove(e.qkey!);
      let ruleMsg = "";
      if (e.rec && e.mode === "new" && res.status !== "duplicate") {
        try { await createRule(e, body); ruleMsg = `，並設定${recText(e.rec, e.date)}週期`; }
        catch (err) { ruleMsg = "（週期規則建立失敗，可到 設定 › 週期交易 重新設定）"; console.warn(err); }
      }
      toast(`${res.status === "duplicate" ? "這筆先前已送出" : "已記錄"} ${esc(label)} ${shown}${ruleMsg}`, () => undoCreate(res.transaction));
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
  if (again) { E = { ...blank(e.type), target: e.target, tab: e.tab, acc: e.acc, date: e.date, cur: e.cur, to: e.type === "transfer" ? e.to : null }; renderEntry(); }
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

/* ------------------------------------------------------------ 週期（選了週期，儲存後用 POST /recurring 建立規則） */
function nextStart(f: Freq, d: string): string {
  if (f === "daily") return addDays(d, 1);
  if (f === "weekly") return addDays(d, 7);
  const day = +d.slice(8);
  const m = f === "monthly" ? addMonths(monthOf(d), 1) : `${+d.slice(0, 4) + 1}-${d.slice(5, 7)}`;
  return `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, "0")}`;
}
async function createRule(e: Entry, body: L.CreateTransactionRequest) {
  const { idempotency_key, occurred_at, ...template } = body; void idempotency_key; void occurred_at;
  const f = e.rec as Exclude<Freq, "">;
  const isLast = +e.date.slice(8) === daysInMonth(monthOf(e.date));
  await api.createRecurring({
    name: e.m.trim() || findCat(e.cat)?.name || "週期交易", template: template as L.CreateTransactionRequest,
    freq: f, interval: 1, by_weekday: f === "weekly" ? ((new Date(e.date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1 : null,
    by_monthday: f === "monthly" ? (isLast ? 31 : +e.date.slice(8)) : null, time_local: `${e.time || "12:00"}:00`,
    start_date: nextStart(f, e.date), end_date: null, mode: "confirm", is_active: true,
  });
}

/* ------------------------------------------------------------ actions & inputs */
let sugT: ReturnType<typeof setTimeout> | undefined;
function closeEntry() {
  const e = E; if (!e) return;
  if (e.target === "page") { E = null; routerBack("/accounts"); } else closeSheet();
}
function pickCat(key: string) {
  const e = E!; const f = findCat(key); if (!f) return;
  const k = f.kind === "income" ? "income" : "expense";
  e.cat = key; e.type = k; delete e.err.cat;
  if (e.tab !== "suggest") e.tab = k;
  renderEntry();
  if (!e.amt) focusAmount(true); // 選好分類 → 直接輸入金額（最少 3 次點擊：分類 → 金額 → ✓）
}
actions({
  add() { openEntry(); },
  edit(el) {
    const row = el.closest(".tx") as HTMLElement | null; if (row?.dataset.dragged) return;
    const sw = el.closest(".sw"); if (sw?.classList.contains("open") && el.classList.contains("tx-b")) { sw.classList.remove("open"); (sw.querySelector(".tx") as HTMLElement).style.transform = ""; return; }
    openEntry({ id: Number(el.dataset.id) });
  },
  askdel(el) { askDelete(Number(el.dataset.id)); },
  "e-close"() { closeEntry(); },
  "e-tab"(el) {
    const e = E!; const v = el.dataset.v as Tab; if (e.tab === v) return;
    e.tab = v; e.err = {}; e.formErr = null; e.pick = null;
    if (v === "expense" || v === "income" || v === "transfer") {
      e.type = v;
      if (v !== "transfer" && findCat(e.cat)?.kind !== v) { e.cat = null; e.lvl = null; }
      if (v === "expense") e.lvl = mainCat(e.cat) && mainCat(e.cat)!.category_key !== e.cat ? mainCat(e.cat)!.category_key : null;
    }
    renderEntry();
  },
  "e-main"(el) {
    const e = E!; const m = app.catalog!.categories.find((x) => x.category_key === el.dataset.v); if (!m) return;
    if (m.children.some((x) => !x.is_hidden)) { e.lvl = m.category_key; e.cat = m.category_key; e.type = "expense"; delete e.err.cat; renderEntry(); $<HTMLElement>("#sheet .cgrid .cg.back, #entry-page .cgrid .cg.back")?.focus(); }
    else pickCat(m.category_key);
  },
  "e-lvl"() { E!.lvl = null; renderEntry(); },
  "e-cat"(el) { pickCat(el.dataset.v!); },
  async "e-newcat"() {
    if (!app.online) { toast("離線時不能新增分類"); return; }
    const mains = app.catalog!.categories.filter((m) => m.kind === "income" && !m.is_hidden);
    const parentSel = mains.length > 1 ? `<label class="eyebrow" for="nc-parent" style="display:block;margin-top:10px">放在哪個主分類</label><select id="nc-parent" class="in">${mains.map((m) => `<option value="${m.category_key}">${esc(m.name)}</option>`).join("")}</select>` : "";
    dialog("新增收入分類", `<label class="eyebrow" for="nc-name" style="display:block">名稱</label><input id="nc-name" class="in" maxlength="20" placeholder="例：出遊款">${parentSel}`, "新增", async () => {
      const name = ($<HTMLInputElement>("#nc-name")?.value ?? "").trim();
      if (!name) { toast("請輸入分類名稱"); return; }
      const parent = $<HTMLSelectElement>("#nc-parent")?.value ?? mains[0]?.category_key;
      try {
        const r = await api.createCategory({ name, kind: "income", ...(parent ? { parent_key: parent } : {}) });
        await getCatalog(true);
        if (E) { E.tab = E.tab === "suggest" ? "suggest" : "income"; pickCat(r.category.category_key); }
        toast(`已新增分類「${esc(name)}」`);
      } catch (err) { handleError(err); }
    });
  },
  "e-go-rec"() { const t = E?.target; if (t === "page") E = null; else closeSheet(); go("/reconcile"); },
  "e-plus"() {
    const e = E!; const i = $<HTMLInputElement>("#e-amt"); if (!i) return;
    if (e.amt && !/[+\-*/×÷]$/.test(e.amt)) e.amt += "+";
    i.value = e.amt; i.focus(); i.setSelectionRange(e.amt.length, e.amt.length);
    renderAmountHint();
  },
  "e-star"() { toast("常用範本即將推出（需要契約 v1.1）"); },
  "e-photo"() { toast("收據照片即將推出"); },
  "e-pick"(el) { E!.pick = el.dataset.v as Pick; renderEntry(); $<HTMLElement>(".pick-l [aria-pressed=true], .pick-l .opt-row")?.focus(); },
  "e-pick-back"() { const p = E!.pick; E!.pick = null; renderEntry(); $<HTMLElement>(`[data-a=e-pick][data-v=${p}]`)?.focus(); },
  "e-set"(el) {
    const e = E!; const v = el.dataset.v!, p = e.pick!;
    if (p === "tags") { e.tags = e.tags.includes(v) ? e.tags.filter((x) => x !== v) : [...e.tags, v]; delete e.err.tags; renderEntry(); $<HTMLElement>(`.pick-l [data-v="${CSS.escape(v)}"]`)?.focus(); return; }
    if (p === "acc" || p === "to") { e[p] = v; delete e.err.acc; delete e.err.to; if (p === "acc" && e.type !== "transfer") e.cur = accOpt(v)?.currency ?? e.cur; }
    else if (p === "proj") e.proj = v;
    else if (p === "rec") { if (v && !app.online) return; e.rec = v as Freq; delete e.err.rec; }
    e.pick = null; renderEntry(); $<HTMLElement>(`[data-a=e-pick][data-v=${p}]`)?.focus();
  },
  "e-save"(el) { saveEntry(!!el.dataset.again); },
  "e-copy"() { const id = E!.id!; openEntry({ id, copy: true }); toast("已複製，修改後儲存成新的一筆"); },
  sug(el) {
    const e = E!; const s = e.sugg[Number(el.dataset.i)]; if (!s) return;
    e.m = s.merchant; e.sugg = [];
    if (s.last_category_key && findCat(s.last_category_key)) { const k = findCat(s.last_category_key)!.kind; if (k === "expense" || k === "income") { e.type = k; e.cat = s.last_category_key; if (e.tab !== "suggest") e.tab = k; e.lvl = k === "expense" && mainCat(e.cat)?.category_key !== e.cat ? mainCat(e.cat)?.category_key ?? null : null; } }
    if (s.last_account_key && accOpt(s.last_account_key)?.can_record) { e.acc = s.last_account_key; e.cur = accOpt(e.acc)!.currency; }
    renderEntry();
  },
  async "queue-open"(el) { const k = el.dataset.id!.replace(/^q:/, ""); const it = (await queue.list()).find((x) => x.key === k); if (it) openFromQueue(it); },
  async "queue-drop"() { const e = E!; dialog("捨棄這筆待同步紀錄？", "<p style='margin:0'>還沒送到伺服器，捨棄後無法復原。</p>", "捨棄", async () => { await queue.remove(e.qkey!); closeSheet(); E = null; reload(); }, { danger: true }); },
});
/** 只更新算式提示，不重畫整個表單（輸入時游標才不會跳） */
function renderAmountHint() {
  const e = E; if (!e) return;
  const box = $(".arow")?.parentElement; if (!box) return;
  const cur = e.type === "transfer" ? accOpt(e.acc)?.currency ?? "TWD" : e.cur;
  let h = box.querySelector<HTMLElement>(".calc-hint");
  if (!hasOperator(e.amt)) { h?.remove(); return; }
  if (!h) { h = document.createElement("p"); h.className = "calc-hint"; h.setAttribute("aria-live", "polite"); box.querySelector(".arow")!.after(h); }
  const v = calc(e.amt, curInfo(cur).decimals);
  h.classList.toggle("bad", v === null); h.textContent = v === null ? "算式不完整" : "= " + fmt(v, cur);
}
document.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement; if (!E || !t.id?.startsWith("e-")) return;
  const e = E;
  if (t.id === "e-amt") {
    // 允許數字、小數點與 + − × ÷（簡易計算機）
    const v = t.value.replace(/[＋]/g, "+").replace(/[−–]/g, "-").replace(/[^\d.+\-*/×÷]/g, "");
    e.amt = v; if (t.value !== v) t.value = v;
    if (e.err.amt) { delete e.err.amt; t.removeAttribute("aria-invalid"); t.closest(".arow")?.classList.remove("bad"); document.getElementById("err-amt")?.remove(); }
    renderAmountHint();
  }
  else if (t.id === "e-amtin") { e.amtIn = t.value.replace(/[^\d.]/g, ""); if (t.value !== e.amtIn) t.value = e.amtIn; }
  else if (t.id === "e-m") {
    e.m = t.value; clearTimeout(sugT);
    const q = t.value.trim();
    sugT = setTimeout(async () => {
      if (!E || E.m.trim() !== q) return;
      if (!q || !app.online) { E.sugg = []; } else { try { E.sugg = (await api.merchants(q, 5)).rows.filter((r) => r.merchant !== q); } catch { E.sugg = []; } }
      renderEntry(); const inp = $<HTMLInputElement>("#e-m"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 220);
  }
  else if (t.id === "e-note") e.note = t.value;
  else if (t.id === "e-fee") e.fee = t.value.replace(/[^\d.]/g, "");
});
document.addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement; if (!E || !t.id?.startsWith("e-")) return;
  if (t.id === "e-d") { if (t.value) { E.date = t.value; delete E.err.date; } renderEntry(); }
  else if (t.id === "e-t") { E.time = t.value; renderEntry(); }
  else if (t.id === "e-cur") { E.cur = t.value; renderEntry(); }
});
// 桌面瀏覽器：點「日期／時間」按鈕任何位置都打開原生選擇器（iOS 點透明 input 本來就會打開）
document.addEventListener("click", (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t?.classList?.contains("fbtn-in")) { try { (t as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* 不支援就用預設行為 */ } }
});
