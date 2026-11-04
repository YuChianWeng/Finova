/**
 * 信用卡逐筆對帳（issue #15，契約 v1.1 提案）：
 *   /finance/reconcile/statements?account=   帳單清單（每期：結帳日、繳款日、應繳、狀態）
 *   /finance/reconcile/statements/:id        逐筆對帳：帳單每一行 ↔ 帳本記錄，處理完、差額 0 才能完成
 * 任何動作都不會自動刪除或覆寫帳本；離線時唯讀。
 */
import type * as L from "../types/ledger";
import { $, esc, ic } from "../lib/dom";
import { fmt, fmtSigned, sign, abs } from "../lib/money";
import { md, slash, wd } from "../lib/dates";
import { app, accOpt, accName, findCat, mainCat, getCatalog } from "../state";
import { api } from "../api/ledger";
import { registerView, actions, rerender, handleError, currentData, currentRoute } from "../app";
import { href, withQuery, type Route } from "../router";
import { emptyState, catColor, catIconName } from "../ui/components";
import { dialog, toast, openSheet, closeSheet, sheetShell } from "../ui/overlay";
import { openEntry } from "../ui/entry";
import { needsAction, bulkConfirmable, canFinalize, sortLines, chipOf, charge, KIND_TEXT } from "../lib/statement";

const cards = () => (app.catalog?.accounts ?? []).filter((a) => a.group === "credit_card" && !a.is_archived);
const ro = (st?: L.Statement) => !app.online || st?.status === "reconciled";

/* ------------------------------------------------------------ 帳單清單 */
type LD = { account: string | null; rows: L.Statement[] };
async function loadList(r: Route): Promise<LD> {
  await getCatalog();
  const account = r.query.get("account") ?? (cards().length === 1 ? cards()[0].account_key : null);
  return { account, rows: account ? (await api.statements(account)).rows : [] };
}
function statusChip(s: L.Statement) {
  if (s.status === "reconciled") return `<span class="st ok">${ic("check", "s")}已核對</span>`;
  if (s.counts.needs_action) return `<span class="st warn">${ic("alert", "s")}待核對 · ${s.counts.needs_action} 筆要處理</span>`;
  return `<span class="st neu">${ic("clock", "s")}待核對</span>`;
}
function renderList(d: LD): string {
  const tabs = `<div class="chips-scroll" role="group" aria-label="信用卡">${cards().map((a) => `<a class="chip" href="${href(withQuery("/reconcile/statements", { account: a.account_key }))}" ${a.account_key === d.account ? 'aria-current="page"' : ""}>${ic("card", "s")}${esc(a.name)}</a>`).join("")}</div>`;
  if (!d.account) return `<div class="card">${tabs}<p class="sm mu" style="margin:14px 0 0">選擇一張信用卡，查看每期電子帳單並逐筆核對。</p></div>`;
  const rows = d.rows.map((s) => `<a class="stm-row" href="${href("/reconcile/statements/" + encodeURIComponent(s.statement_id))}">
      <span class="stm-ic">${ic("receipt")}</span>
      <span class="stm-m"><b>${slash(s.close_date)} 結帳</b><span class="xs mu">${slash(s.period_start)}–${md(s.period_end)} · 繳款日 ${s.due_date ? slash(s.due_date) : "—"} · ${s.counts.lines} 筆</span></span>
      <span class="stm-r"><span class="num">${fmt(s.total_due.amount, s.total_due.currency)}</span>${statusChip(s)}</span>${ic("chev-r", "s")}</a>`).join("");
  return `<div class="stack" style="gap:16px">${cards().length > 1 ? tabs : ""}
    <div class="card"><div class="ch"><h2 class="h2">${ic("card")}${esc(accName(d.account))} · 每期帳單</h2></div>
    ${rows ? `<nav class="list" aria-label="帳單清單">${rows}</nav>` : emptyState("還沒有帳單", "收到電子帳單並解析後，會出現在這裡。")}</div>
    <p class="xs mu" style="margin:0">帳單由信箱裡的電子帳單解析而來；這裡只讀取和核對，不會自動修改帳本。</p></div>`;
}
registerView("statements", { load: loadList, render: renderList, title: () => "信用卡對帳單", back: "/reconcile", nav: "/reconcile" });

/* ------------------------------------------------------------ 逐筆對帳 */
type D = { det: L.StatementDetail; open: Set<string> };
async function loadDetail(r: Route): Promise<D> {
  await getCatalog();
  return { det: await api.statement(r.params.id), open: new Set() };
}
const txMap = (d: L.StatementDetail) => new Map(d.ledger.concat(d.unmatched_ledger).map((t) => [t.id, t] as const));
const money = (m: L.Money) => fmt(m.amount, m.currency);
const signedCard = (amount: string, cur: string) => (sign(amount) < 0 ? fmtSigned(amount, cur) : fmt(amount, cur));

function ledgerSide(t: L.Transaction | undefined, l: L.StatementLine | null) {
  if (!t) return `<div class="sl-l none"><span class="eyebrow">帳本</span><p class="sm mu" style="margin:4px 0 0">${l?.state === "ignored" ? "（已忽略，不需要帳本記錄）" : "帳本沒有這一筆"}</p></div>`;
  const c = t.category ? (t.category.sub ?? t.category.main) : null;
  const differs = !!l && charge(t) !== l.amount.amount;
  const dateOff = !!l && t.date !== l.txn_date;
  return `<div class="sl-l"><span class="eyebrow">帳本</span>
    <div class="sl-line"><span class="cat-ic sm" style="--cc:${catColor(t.category?.main.category_key, t.category?.main.icon)}">${ic(catIconName(t.category?.main.category_key, t.category?.main.icon))}</span>
      <span class="sl-t"><b>${esc(t.merchant ?? "（無名稱）")}</b><span class="xs mu"><span class="${dateOff ? "sl-off" : ""}">${md(t.date)}（${wd(t.date)}）${dateOff ? "・日期不同" : ""}</span>${c ? ` · ${esc(c.name)}` : ""}</span></span>
      <span class="sl-a num ${differs ? "sl-off" : ""}">${signedCard(charge(t), t.amount.currency)}${differs ? `<span class="vh">（和帳單不同）</span>` : ""}</span></div>
    <button class="link xs" data-a="edit" data-id="${t.id}">${ic("edit", "s")}編輯帳本記錄</button></div>`;
}
function lineCard(d: L.StatementDetail, l: L.StatementLine, tx: Map<number, L.Transaction>) {
  const t = l.match ? tx.get(l.match.transaction_id) : undefined;
  const chip = chipOf(l);
  const dis = ro(d.statement) ? "disabled" : "";
  const b = (a: string, label: string, icon: string, cls = "") => `<button class="btn sm ${cls}" data-a="${a}" data-v="${esc(l.line_id)}" ${dis}>${ic(icon, "s")}${label}</button>`;
  const acts: string[] = [];
  if (l.state === "matched" && !l.match?.confirmed) acts.push(b("stm-confirm", "確認配對", "check", "p"), b("stm-match", "改配對", "swap"), b("stm-ignore", "忽略", "x", "g"));
  else if (l.state === "missing" || l.state === "possible_duplicate") {
    if (l.kind !== "payment") acts.push(b("stm-add", "新增到帳本", "plus", "p"));
    acts.push(b("stm-match", "手動配對", "swap"), b("stm-ignore", "忽略", "x", "g"));
  } else if (l.state === "amount_differs") acts.push(b("stm-fix", "用帳單金額更新帳本", "edit", "p"), b("stm-match", "改配對", "swap"), b("stm-ignore", "忽略", "x", "g"));
  const hint = l.state === "possible_duplicate" ? "帳單上同一天、同金額出現不只一次。如果真的刷了兩次就新增；如果是銀行重複請款，請聯絡銀行並先忽略。"
    : l.state === "missing" ? (l.kind === "installment" ? "分期的每一期。如果整筆已在第一期記過，選「忽略」。" : l.kind === "payment" ? "繳款要記成「繳卡費」（轉帳），記好後用「手動配對」。" : "可能漏記了，或記在別的帳戶。")
    : l.state === "amount_differs" ? `帳單 ${signedCard(l.amount.amount, l.amount.currency)}，帳本 ${t ? signedCard(charge(t), t.amount.currency) : "—"}。`
    : l.state === "matched" && l.match?.confidence === "fuzzy" && !l.match.confirmed ? "金額相同，但日期或內容有出入，請確認是同一筆。" : "";
  return `<article class="sl ${needsAction(l) ? "todo" : ""}" id="ln-${esc(l.line_id)}" tabindex="-1" aria-label="${esc(md(l.txn_date) + " " + l.description + " " + chip.text)}">
    <div class="sl-pair">
      <div class="sl-s"><span class="eyebrow">帳單</span>
        <div class="sl-line"><span class="sl-t"><b>${esc(l.description)}</b><span class="xs mu">${md(l.txn_date)}（${wd(l.txn_date)}）${l.post_date ? ` · 入帳 ${md(l.post_date)}` : ""} · ${KIND_TEXT[l.kind]}${l.fx ? ` · ${esc(l.fx.currency)} ${esc(l.fx.amount)}` : ""}</span></span>
        <span class="sl-a num">${signedCard(l.amount.amount, l.amount.currency)}</span></div></div>
      <span class="sl-arrow" aria-hidden="true">${ic("swap", "s")}</span>
      ${ledgerSide(t, l)}
    </div>
    <div class="sl-f"><span class="sl-chip ${chip.tone}">${ic(chip.icon, "s")}${chip.text}</span>${l.ignore_reason ? `<span class="xs mu">原因：${esc(l.ignore_reason)}</span>` : ""}
      ${l.raw_text ? `<button class="link xs" data-a="stm-raw" data-v="${esc(l.line_id)}">${ic("eye", "s")}原始帳單文字</button>` : ""}</div>
    ${hint ? `<p class="xs mu sl-hint">${hint}</p>` : ""}
    ${acts.length ? `<div class="sl-acts">${acts.join("")}</div>` : ""}
  </article>`;
}
function renderDetail(d: D): string {
  const det = d.det, s = det.statement, tx = txMap(det);
  const lines = sortLines(det.lines);
  const todo = lines.filter(needsAction), done = lines.filter((l) => !needsAction(l));
  const bulk = bulkConfirmable(det.lines);
  const fin = canFinalize(det, app.online);
  const diff = sign(det.diff.amount);
  const cur = s.total_due.currency;
  const dis = ro(s) ? "disabled" : "";
  const head = `<div class="card stm-sum" aria-labelledby="stm-h">
    <div class="ch"><h2 class="h2" id="stm-h" tabindex="-1">${ic("receipt")}${esc(accName(s.account_key))} · ${slash(s.close_date)} 帳單</h2>${s.status === "reconciled" ? `<span class="st ok">${ic("check", "s")}已核對</span>` : `<span class="st warn">${ic("clock", "s")}待核對</span>`}</div>
    <p class="sm mu" style="margin:-6px 0 12px">帳單期間 ${slash(s.period_start)}–${slash(s.period_end)} · 繳款日 ${s.due_date ? slash(s.due_date) : "—"} · 本期應繳 <b class="num" style="color:var(--tx)">${money(s.total_due)}</b></p>
    <div class="panel-tot"><div><span class="eyebrow">帳單合計</span><span class="num">${signedCard(det.totals.statement.amount, cur)}</span></div><div><span class="eyebrow">帳本已配對</span><span class="num">${signedCard(det.totals.matched_ledger.amount, cur)}</span></div><div><span class="eyebrow">差額</span><span class="num" style="color:${diff ? "var(--wa)" : "var(--ac)"}">${diff ? `${ic("alert", "s")}${fmtSigned(det.diff.amount, det.diff.currency)}` : `${ic("check", "s")}0`}</span></div></div>
    <p class="xs mu" style="margin:10px 0 0">帳本同期間合計 ${signedCard(det.totals.ledger_period.amount, cur)}${det.unmatched_ledger.length ? `（含 ${det.unmatched_ledger.length} 筆帳單沒有的記錄，不計入差額）` : ""}。差額 = 帳單合計（不含忽略的行）− 已配對的帳本記錄。</p>
    <div class="stm-fin">
      <div class="xs" id="stm-why" role="status">${fin.ok ? `<span style="color:var(--ac)">${ic("check", "s")}全部處理完，差額為 0，可以完成對帳</span>` : s.status === "reconciled" ? `<span class="mu">已於 ${slash((s.reconciled_at ?? "").slice(0, 10))} 完成對帳</span>` : `<span style="color:var(--wa)">${ic("alert", "s")}${esc(fin.reason)}${!fin.ok && fin.reason.startsWith("差額") ? `（${fmtSigned(det.diff.amount, det.diff.currency)}）` : ""}</span>`}</div>
      ${s.status === "reconciled" ? "" : `<button class="btn p" data-a="stm-finalize" ${fin.ok ? "" : 'aria-disabled="true"'} aria-describedby="stm-why">${ic("check", "s")}完成對帳</button>`}
    </div>
    ${!app.online ? `<div class="callout warn" style="margin-top:12px">${ic("alert")}<div>離線中：對帳畫面只能查看，連線後才能處理。</div></div>` : ""}
  </div>`;
  const bar = todo.length ? `<div class="between" style="flex-wrap:wrap"><h2 class="h2">需要處理 <span class="cnt">${todo.length}</span></h2>${bulk.length ? `<button class="btn sm" data-a="stm-bulk" ${dis}>${ic("check", "s")}確認全部完全吻合（${bulk.length}）</button>` : ""}</div>` : "";
  const todoHTML = todo.length ? `${bar}<div class="sl-list">${todo.map((l) => lineCard(det, l, tx)).join("")}</div>`
    : `<div class="callout ok">${ic("check")}<div>帳單上的每一筆都處理完了。${diff ? "但差額不是 0，請檢查已配對的金額。" : ""}</div></div>`;
  const doneHTML = done.length ? `<details class="stm-done" ${d.open.has("done") || !todo.length ? "open" : ""} data-k="done"><summary><h2 class="h2">已處理 <span class="cnt">${done.length}</span></h2>${ic("chev-d", "s")}</summary><div class="sl-list">${done.map((l) => lineCard(det, l, tx)).join("")}</div></details>` : "";
  const ledgerOnly = det.unmatched_ledger.length ? `<section class="stm-only" aria-labelledby="stm-only-h"><h2 class="h2" id="stm-only-h">帳單沒有的帳本記錄 <span class="cnt">${det.unmatched_ledger.length}</span></h2>
    <p class="xs mu" style="margin:4px 0 10px">帳本有、這期帳單沒有：可能還沒入帳（下一期才會出現）、記錯帳戶，或重複記帳。不計入差額，也不影響完成對帳；需要時可以編輯，或從帳單的行「手動配對」過來。</p>
    <div class="sl-list">${det.unmatched_ledger.map((t) => `<article class="sl only"><div class="sl-pair one">${ledgerSide(t, null)}</div></article>`).join("")}</div></section>` : "";
  return `<div class="stm">${head}${todoHTML}${doneHTML}${ledgerOnly}</div>`;
}
registerView("statement", { load: loadDetail, render: renderDetail, title: (d) => (d ? `${accName(d.det.statement.account_key)} 帳單` : "逐筆對帳"), back: "/reconcile/statements", nav: "/reconcile" });

/* ------------------------------------------------------------ actions */
const D_ = () => currentData<D>();
const lineOf = (id: string) => D_().det.lines.find((l) => l.line_id === id)!;
/**
 * 更新畫面後的焦點：同一行還看得到就放回那一行；
 * 那一行已移到收起來的「已處理」時，放到原本位置的下一筆待處理；都沒有就放到標題。
 */
function apply(det: L.StatementDetail, focusLine?: string) {
  const todoIds = [...document.querySelectorAll<HTMLElement>(".stm > .sl-list .sl.todo")].map((x) => x.id);
  const at = focusLine ? todoIds.indexOf("ln-" + focusLine) : -1;
  D_().det = det; rerender();
  let el = focusLine ? document.getElementById("ln-" + focusLine) : null;
  if (el && (el.closest("details:not([open])") || !el.getClientRects().length)) {
    const todo = [...document.querySelectorAll<HTMLElement>(".stm > .sl-list .sl.todo")];
    el = todo[Math.max(0, Math.min(at, todo.length - 1))] ?? null;
  }
  (el ?? $<HTMLElement>("#stm-h"))?.focus();
}
async function run(f: () => Promise<L.StatementDetail>, msg: string, line?: string) {
  if (!app.online) { toast("離線中，連線後才能處理"); return; }
  try { apply(await f(), line); toast(msg); } catch (e) { handleError(e); }
}
const sid = () => D_().det.statement.statement_id;

actions({
  "stm-confirm"(el) { const id = el.dataset.v!; run(() => api.stmtConfirm(sid(), id), "已確認配對", id); },
  async "stm-bulk"() {
    if (!app.online) { toast("離線中，連線後才能處理"); return; }
    const list = bulkConfirmable(D_().det.lines); let det = D_().det;
    try { for (const l of list) det = await api.stmtConfirm(sid(), l.line_id); apply(det); toast(`已確認 ${list.length} 筆完全吻合的配對`); }
    catch (e) { handleError(e); }
  },
  "stm-ignore"(el) {
    const l = lineOf(el.dataset.v!);
    dialog("標記為忽略？", `<p style="margin:0 0 10px"><b>${esc(l.description)}</b> · ${signedCard(l.amount.amount, l.amount.currency)} · ${md(l.txn_date)}</p>
      <p class="sm mu" style="margin:0 0 10px">忽略的行不計入帳單合計，也不會新增或修改帳本。例如已知的手續費、已經另外處理的分期。</p>
      <label class="eyebrow" for="stm-reason" style="display:block">原因（選填）</label><input id="stm-reason" class="in" maxlength="100" placeholder="例：分期第一期已記整筆">`, "忽略", () => {
      const reason = ($<HTMLInputElement>("#stm-reason")?.value ?? "").trim();
      run(() => api.stmtIgnore(sid(), l.line_id, reason || undefined), "已標記為忽略", l.line_id);
    });
  },
  "stm-raw"(el) {
    const l = lineOf(el.dataset.v!);
    dialog("原始帳單文字", `<p class="sm mu" style="margin:0 0 8px">解析前的原文，用來檢查解析結果是否正確。</p><pre class="stm-raw">${esc(l.raw_text ?? "")}</pre>`, "關閉", () => {});
  },
  "stm-fix"(el) {
    const l = lineOf(el.dataset.v!); const t = txMap(D_().det).get(l.match!.transaction_id)!;
    const to = abs(l.amount.amount);
    dialog("用帳單金額更新帳本？", `<p style="margin:0 0 8px"><b>${esc(t.merchant ?? "")}</b> · ${md(t.date)}</p><p style="margin:0">帳本金額 <b class="num">${money(t.amount)}</b> → <b class="num">${fmt(to, l.amount.currency)}</b></p><p class="sm mu" style="margin:8px 0 0">只改這一筆的金額，修改紀錄裡看得到，之後也可以再改回來。</p>`, "更新並確認", async () => {
      if (!app.online) { toast("離線中，連線後才能處理"); return; }
      try {
        await api.updateTransaction(t.id, { expected_version: t.version, patch: { amount: to } });
        apply(await api.stmtConfirm(sid(), l.line_id), l.line_id); toast("已更新帳本金額並確認配對");
      } catch (e) { handleError(e); try { apply(await api.statement(sid()), l.line_id); } catch { /* 留在原畫面 */ } }
    });
  },
  "stm-add"(el) {
    const l = lineOf(el.dataset.v!); const s = D_().det.statement;
    const refund = sign(l.amount.amount) < 0;
    const type = refund ? "income" : "expense";
    const cat = findCat(l.suggested_category_key)?.kind === type ? l.suggested_category_key : refund ? (findCat("income.refund") ? "income.refund" : null) : null;
    const lvl = type === "expense" && cat && mainCat(cat)?.category_key !== cat ? mainCat(cat)!.category_key : null;
    const cur = accOpt(s.account_key)?.currency ?? l.amount.currency;
    openEntry({ type, prefill: { type, tab: type, acc: s.account_key, cur, amt: abs(l.amount.amount), m: l.description, date: l.txn_date, time: "12:00", cat, lvl,
      note: l.fx ? `外幣 ${l.fx.currency} ${l.fx.amount}` : "", stmt: { statement_id: s.statement_id, line_id: l.line_id, label: `${md(l.txn_date)} ${l.description}` } } });
  },
  "stm-match"(el) { openMatch(el.dataset.v!); },
  async "stm-pick"(el) {
    const lid = el.dataset.v!, id = Number(el.dataset.id);
    closeSheet({ restoreFocus: false });
    run(() => api.stmtMatch(sid(), lid, id), "已手動配對", lid);
  },
  async "stm-finalize"() {
    const det = D_().det; const f = canFinalize(det, app.online);
    if (!f.ok) { toast(f.reason); $("#stm-why")?.focus(); return; }
    dialog("完成這一期對帳？", `<p style="margin:0">${esc(accName(det.statement.account_key))} ${slash(det.statement.close_date)} 帳單：${det.lines.length} 行都已處理，差額為 0。</p><p class="sm mu" style="margin:8px 0 0">完成後，已配對的帳本記錄會顯示「已對帳」，編輯或刪除時會先提醒。</p>`, "完成對帳", () => run(() => api.stmtFinalize(sid()), "這一期已完成對帳 ✓"));
  },
});
/** 「已處理」展開狀態在重畫後保留 */
document.addEventListener("toggle", (e) => {
  const t = e.target as HTMLDetailsElement;
  if (!t.classList?.contains("stm-done") || currentRoute()?.name !== "statement") return;
  const o = D_().open; if (t.open) o.add("done"); else o.delete("done");
}, true);

function openMatch(lineId: string) {
  const det = D_().det, l = lineOf(lineId), tx = txMap(det);
  const cands = l.candidates.map((id) => tx.get(id)).filter(Boolean) as L.Transaction[];
  const body = `<div class="callout">${ic("receipt")}<div><b>${esc(l.description)}</b> · <span class="num">${signedCard(l.amount.amount, l.amount.currency)}</span><br><span class="xs mu">${md(l.txn_date)}（${wd(l.txn_date)}）</span></div></div>
    <p class="eyebrow" style="margin:6px 0 0">選一筆帳本記錄（同一張卡、帳單期間前後、尚未配對）</p>
    ${cands.length ? `<div class="list" role="group" aria-label="候選帳本記錄">${cands.map((t) => {
      const same = charge(t) === l.amount.amount;
      return `<button class="opt-row" data-a="stm-pick" data-v="${esc(l.line_id)}" data-id="${t.id}"><span class="grow"><b>${esc(t.merchant ?? "（無名稱）")}</b><br><span class="xs mu">${md(t.date)}（${wd(t.date)}）${t.category ? ` · ${esc((t.category.sub ?? t.category.main).name)}` : ""}</span></span><span class="num">${signedCard(charge(t), t.amount.currency)}</span>${same ? `<span class="st ok">${ic("check", "s")}金額相同</span>` : `<span class="st neu">金額不同</span>`}</button>`;
    }).join("")}</div>` : `<p class="sm mu">沒有可配對的帳本記錄。可以改用「新增到帳本」，或先在明細裡修正那一筆的帳戶或日期。</p>`}`;
  openSheet("form", sheetShell("手動配對", body, `<button class="btn" data-a="closeall">取消</button>`), undefined, { returnFocus: `#ln-${CSS.escape(lineId)} [data-a=stm-match]` });
}


/** 離線／恢復連線時重畫，讓動作按鈕停用或恢復（離線時這個畫面唯讀） */
const onNet = () => setTimeout(() => { const n = currentRoute()?.name; if (n === "statement" || n === "statements") rerender(); }, 0);
window.addEventListener("offline", onNet);
window.addEventListener("online", onNet);
