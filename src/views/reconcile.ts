/** 對帳（/finance/reconcile?account=）：選帳戶 → 輸入實際餘額 → 預覽差額 → 相符／記調整／先保留。 */
import type * as L from "../types/ledger";
import { esc, ic } from "../lib/dom";
import { fmt, fmtSigned, sign, abs, neg, curInfo } from "../lib/money";
import { today, md, slash, daysBetween, isoDateTime } from "../lib/dates";
import { app, ui, accOpt } from "../state";
import { api } from "../api/ledger";
import { LedgerError } from "../api/client";
import { registerView, actions, rerender, reload, handleError, currentData } from "../app";
import { navigate, href, type Route } from "../router";
import { txRow } from "../ui/components";
import { toast } from "../ui/overlay";
import { balanceHTML } from "./accounts";

type D = { acc: L.AccountsResponse; recs: L.Reconciliation[] };
const LIAB = ["credit_card", "liability"];
async function load(r: Route): Promise<D> {
  const want = r.query.get("account");
  if (want && ui.rec.acc !== want) Object.assign(ui.rec, { step: 2, acc: want, actual: "", date: today(), err: null, showTx: false, preview: null, result: null });
  if (!want && ui.rec.step > 1 && !ui.rec.result) Object.assign(ui.rec, { step: 1, acc: null });
  const [acc, recs] = await Promise.all([api.accounts(false), api.reconciliations()]);
  return { acc, recs: recs.rows };
}
const all = (d: D) => d.acc.groups.flatMap((g) => g.accounts);
function render(d: D) {
  const R = ui.rec, a = all(d).find((x) => x.account_key === R.acc) ?? null;
  const steps = `<div class="steps" aria-label="對帳步驟">${["選擇帳戶", "輸入實際餘額", "核對結果"].map((l, i) => `${i ? '<span class="step-line"></span>' : ""}<span class="step ${R.step === i + 1 ? "on" : R.step > i + 1 ? "done" : ""}"><b>${R.step > i + 1 ? "✓" : i + 1}</b><span class="${R.step === i + 1 ? "" : "only-d"}">${l}</span></span>`).join("")}</div>`;
  let body = "";
  if (R.step === 1 || !a) {
    body = `<div class="list">${all(d).map((x) => {
      const last = x.reconcile.last_at?.slice(0, 10); const days = last ? daysBetween(last, today()) : null; const ok = x.balance.opening_set;
      return `<button class="between" data-a="rec-acc" data-id="${esc(x.account_key)}" ${ok ? "" : "disabled"} style="width:100%;min-height:64px;background:none;border:0;border-bottom:1px solid var(--ln);color:var(--tx);cursor:${ok ? "pointer" : "not-allowed"};text-align:left;font:inherit;${ok ? "" : "opacity:.55"}"><span class="row"><span class="acc-ic">${ic(x.icon ?? "wallet")}</span><span><b style="font-weight:500">${esc(x.name)}</b><br><span class="xs ${x.reconcile.due ? "" : "mu"}" style="${x.reconcile.due ? "color:var(--wa)" : ""}">${!ok ? "尚未設定期初，無法對帳" : last ? `${x.reconcile.due ? "! " : ""}上次 ${md(last)} · ${days} 天前` : "還沒對帳過"}</span></span></span><span class="row">${balanceHTML(x)}${ic("chev-r", "s")}</span></button>`;
    }).join("")}</div>`;
  } else if (R.step === 2) {
    const liab = LIAB.includes(a.group);
    body = `<div class="stack" style="gap:16px"><div class="callout ok">${ic(a.icon ?? "wallet")}<div><b>${esc(a.name)}</b><br><span class="sm">App 計算${liab ? "欠款" : "餘額"} ${balanceHTML(a)}</span></div></div>
      <div class="fld"><label class="eyebrow" for="rec-actual">${liab ? "銀行或 App 上看到的目前欠款（正數）" : "銀行或 App 上看到的實際餘額"}</label><div class="amt-box ${R.err ? "bad" : ""}"><span class="cur">${esc(curInfo(a.currency).symbol)}</span><input id="rec-actual" class="amt-in" inputmode="decimal" placeholder="0" value="${esc(R.actual)}" autocomplete="off" ${R.err ? 'aria-invalid="true" aria-describedby="rec-err"' : ""}></div>${R.err ? `<p class="err" id="rec-err">${ic("alert", "s")}${esc(R.err)}</p>` : ""}</div>
      <div class="fld"><label class="eyebrow" for="rec-date">餘額日期</label><input id="rec-date" class="in" type="date" value="${R.date}" max="${today()}"></div>
      ${a.group === "credit_card" ? `<a class="opt" href="${href("/reconcile/statements?account=" + encodeURIComponent(a.account_key))}">${ic("receipt")}<span><b>逐筆對帳（依電子帳單）</b><span class="sm mu">差額不是 0 時，用帳單上的每一筆找出漏記、重複或金額不同</span></span></a>` : ""}
      <div class="row"><button class="btn" data-a="rec-back">${ic("chev-l", "s")}上一步</button><button class="btn p" style="flex:1" data-a="rec-next" ${app.online ? "" : "disabled"}>核對</button></div>${app.online ? "" : '<p class="xs mu" style="margin:0">離線中不能對帳。</p>'}</div>`;
  } else {
    const p = R.preview!, res = R.result, liab = LIAB.includes(a.group);
    const show = (m: L.Money) => (liab ? fmt(neg(m.amount), m.currency) : fmt(m.amount, m.currency));
    const diff = sign(p.diff.amount);
    body = `<div class="panel-tot"><div><span class="eyebrow">App 計算</span><span class="amt">${show(p.computed)}</span></div><div><span class="eyebrow">實際</span><span class="amt">${liab ? fmt(R.actual, a.currency) : fmt(R.actual.replace("−", "-"), a.currency)}</span></div><div><span class="eyebrow">差額</span><span class="amt" style="color:${diff ? "var(--wa)" : "var(--ac)"}">${diff ? fmtSigned(p.diff.amount, p.diff.currency) : "0"}</span></div></div>` +
      (res ? `<div class="empty"><div class="cat-ic" style="width:64px;height:64px;color:var(--ac)">${ic("check")}</div><h3>${res.reconciliation.resolution === "left_open" ? "已記錄，差額先保留" : "已核對 ✓"}</h3><p>${esc(a.name)} ${res.adjustment ? `已記一筆餘額調整 ${fmtSigned(res.adjustment.direction === "in" ? res.adjustment.amount.amount : neg(res.adjustment.amount.amount), res.adjustment.amount.currency)}（不計入收支）。` : res.reconciliation.resolution === "left_open" ? "下次對帳時可以再處理。" : "的餘額和銀行一致。"}對帳日期更新為 ${slash(R.date)}。</p><button class="btn p" data-a="rec-reset">完成</button></div>`
      : !diff ? `<div class="empty"><div class="cat-ic" style="width:64px;height:64px;color:var(--ac)">${ic("check")}</div><h3>餘額相符</h3><p>按「確認」記錄這次對帳。</p><button class="btn p" data-a="rec-commit" data-v="matched">確認</button></div>`
      : `<div class="callout warn" style="margin-top:16px">${ic("alert")}<div>App 比實際${(diff > 0) !== liab ? "少" : "多"}了 <b class="num">${fmt(abs(p.diff.amount), p.diff.currency)}</b>。可能有漏記或重複記錄。</div></div>
        <div class="stack" style="margin-top:12px">
          ${a.group === "credit_card" ? `<a class="opt" href="${href("/reconcile/statements?account=" + encodeURIComponent(a.account_key))}">${ic("receipt")}<span><b>逐筆對帳（依電子帳單）</b><span class="sm mu">用帳單上的每一筆核對，找出是哪幾筆對不上</span></span></a>` : ""}
          <button class="opt" data-a="rec-check">${ic("search")}<span><b>(a) 檢查期間交易</b><span class="sm mu">列出上次對帳之後的 ${p.transactions_since_last.length} 筆交易，找出漏記</span></span></button>
          <button class="opt" data-a="rec-commit" data-v="adjusted">${ic("scale")}<span><b>(b) 記一筆調整</b><span class="sm mu">自動補 ${fmtSigned(p.diff.amount, p.diff.currency)}，標示為「餘額調整」，不計入收支報表</span></span></button>
          <button class="opt" data-a="rec-commit" data-v="left_open">${ic("clock")}<span><b>(c) 先保留差額</b><span class="sm mu">只記錄這次對帳結果，之後再處理</span></span></button>
        </div>
        ${R.showTx ? `<p class="eyebrow" style="margin:18px 0 0">上次對帳後的交易</p><div class="list plain">${p.transactions_since_last.length ? p.transactions_since_last.map((t) => txRow(t, { showDate: true })).join("") : '<p class="sm mu">沒有交易</p>'}</div>` : ""}
        <button class="btn g" style="margin-top:12px" data-a="rec-back">${ic("chev-l", "s")}重新輸入</button>`);
  }
  const hist = `<div class="card sp-4"><div class="ch"><h2 class="h2">對帳紀錄</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>帳戶</th><th class="r">差額</th></tr></thead><tbody>${d.recs.slice(0, 20).map((x) => `<tr><td class="num">${slash(x.as_of.slice(0, 10))}</td><td>${esc(accOpt(x.account_key)?.name ?? x.account_key)}</td><td class="r num" style="${sign(x.diff.amount) ? "color:var(--wa)" : ""}">${sign(x.diff.amount) ? fmtSigned(x.diff.amount, x.diff.currency) + (x.resolution === "adjusted" ? " · 已調整" : x.resolution === "left_open" ? " · 保留" : "") : ic("check", "s")}</td></tr>`).join("")}</tbody></table></div></div>`;
  return `<div class="grid"><div class="card sp-8"><div class="ch"><h2 class="h2">${ic("scale")}對帳</h2><span class="row">${R.step > 1 ? `<button class="btn sm g" data-a="rec-reset">重新開始</button>` : ""}<a class="btn sm" href="${href("/reconcile/statements")}">${ic("receipt", "s")}信用卡對帳單</a></span></div>${steps}<div style="margin-top:18px">${body}</div></div>${hist}</div>`;
}
registerView("reconcile", { load, render, title: () => "對帳", back: "/more", nav: "/reconcile" });

function actualFor(a: L.AccountSummary): string | null {
  const v = ui.rec.actual.replace(/[−–]/g, "-").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  return LIAB.includes(a.group) ? (v.startsWith("-") ? v.slice(1) : "-" + v) : v; // 負債輸入欠款正數 → 帳戶餘額為負
}
actions({
  "rec-acc"(el) { navigate("/reconcile?account=" + encodeURIComponent(el.dataset.id!), { replace: true }); },
  "rec-back"() { ui.rec.step = Math.max(1, ui.rec.step - 1); ui.rec.showTx = false; ui.rec.preview = null; if (ui.rec.step === 1) navigate("/reconcile", { replace: true }); else rerender(); },
  async "rec-next"() {
    const a = all(currentData<D>()).find((x) => x.account_key === ui.rec.acc)!; const actual = actualFor(a);
    if (actual == null) { ui.rec.err = "請輸入實際餘額（數字）"; return rerender(); }
    ui.rec.err = null;
    try { ui.rec.preview = await api.reconcilePreview({ account_key: a.account_key, as_of: isoDateTime(ui.rec.date, "23:59"), actual }); ui.rec.step = 3; rerender(); }
    catch (e) { const err = e as LedgerError; if (err instanceof LedgerError && err.details) { ui.rec.err = Object.values(err.details).flat().join("；"); rerender(); } else handleError(e); }
  },
  "rec-check"() { ui.rec.showTx = !ui.rec.showTx; rerender(); },
  async "rec-commit"(el) {
    const a = all(currentData<D>()).find((x) => x.account_key === ui.rec.acc)!;
    try {
      ui.rec.result = await api.reconcile({ account_key: a.account_key, as_of: isoDateTime(ui.rec.date, "23:59"), actual: actualFor(a)!, resolution: el.dataset.v as L.Reconciliation["resolution"] });
      if (ui.rec.result.adjustment) toast(`已記一筆餘額調整（不計入收支）`);
      reload();
    } catch (e) { handleError(e); }
  },
  "rec-reset"() { Object.assign(ui.rec, { step: 1, acc: null, actual: "", date: today(), err: null, showTx: false, preview: null, result: null }); navigate("/reconcile", { replace: true }); },
});
document.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.id === "rec-actual") ui.rec.actual = t.value; });
document.addEventListener("change", (e) => { const t = e.target as HTMLInputElement; if (t.id === "rec-date") ui.rec.date = t.value; });
