/** 首頁：帳戶總覽（/finance/accounts）與帳戶詳情（/finance/accounts/:key）。 */
import type * as L from "../types/ledger";
import { $, esc, ic } from "../lib/dom";
import { fmt, fmtSigned, MINUS, short, byCurrency, add, sub, neg, sign, num, plain, twd, pct1 } from "../lib/money";
import { today, addDays, isoWeek, addMonths, monthOf, daysBetween, slash, md, wd, monthEnd } from "../lib/dates";
import { wide } from "../lib/layout";
import { signed } from "../lib/series";
import { app, ui } from "../state";
import { api } from "../api/ledger";
import { registerView, registered, patchView, currentData, actions, rerender, reload, handleError, shell } from "../app";
import type { Route } from "../router";
import { href } from "../router";
import { txRow, groupHead, emptyState, pbar, GROUP_TEXT, catColor, catIconName } from "../ui/components";
import { comboChart, donut, lineChart } from "../ui/charts";
import { openEntry } from "../ui/entry";
import { dialog, toast, openSheet, sheetShell } from "../ui/overlay";
import { openAccountForm, deleteAccountFlow } from "./settings";

const LIAB: L.AccountGroup[] = ["credit_card", "liability"];
const GROUP_LABEL: Partial<Record<L.AccountGroup, string>> = { cash: "生活現金", bank: "銀行", credit_card: "信用卡", stored_value: "儲值卡／電子票證", liability: "負債", receivable: "應收", other: "其他" };

/* ------------------------------------------------------------ 帳戶總覽 */
type AccData = { acc: L.AccountsResponse; flow: { labels: string[]; inn: number[]; out: number[]; last: { inn: string; out: string } } };
async function loadAccounts(): Promise<AccData> {
  const t = today();
  const flowP = async (): Promise<AccData["flow"]> => {
    if (ui.accPeriod === "week") {
      const weeks = Array.from({ length: 10 }, (_, i) => isoWeek(addDays(t, -7 * (9 - i))));
      const reps = await Promise.all(weeks.map((w) => api.weekly(w, { compare: false })));
      const lr = reps[reps.length - 1];
      return { labels: weeks.map((w) => "W" + w.slice(-2)), inn: reps.map((r) => num(twd(r.kpi.income))), out: reps.map((r) => num(twd(r.kpi.expense))), last: { inn: twd(lr?.kpi.income), out: twd(lr?.kpi.expense) } };
    }
    const m = monthOf(t), from = `${addMonths(m, -5)}-01`;
    const r = await api.range(from, monthEnd(m), { compare: false });
    const lp = r.series[r.series.length - 1];
    return { labels: r.series.map((p) => +p.date.slice(5, 7) + "月"), inn: r.series.map((p) => num(p.income)), out: r.series.map((p) => num(p.expense)), last: { inn: lp?.income ?? "0", out: lp?.expense ?? "0" } };
  };
  const [acc, flow] = await Promise.all([api.accounts(true), flowP()]);
  return { acc, flow };
}
function heroNumbers(a: L.AccountsResponse) {
  const invTWD = a.investments.filter((i) => i.market_value.currency === "TWD").map((i) => i.market_value.amount);
  const assets = add(twd(a.totals.available_cash), ...invTWD);
  const debts = add(twd(a.totals.credit_card_due), twd(a.totals.liabilities));
  // 其他幣別（不換算、不併入）
  const other: Record<string, string> = {};
  const put = (m: L.MoneyByCurrency, s: 1 | -1) => byCurrency(m).filter((x) => x.currency !== "TWD").forEach((x) => (other[x.currency] = add(other[x.currency] ?? "0", s > 0 ? x.amount : neg(x.amount))));
  put(a.totals.available_cash, 1); put(a.totals.credit_card_due, -1); put(a.totals.liabilities, -1);
  a.investments.filter((i) => i.market_value.currency !== "TWD").forEach((i) => (other[i.market_value.currency] = add(other[i.market_value.currency] ?? "0", i.market_value.amount)));
  return { assets, debts, net: sub(assets, debts), other };
}
export function balanceOf(s: L.AccountSummary): { money: L.Money | null; snapshot: boolean } {
  if (s.balance.computed) return { money: s.balance.computed, snapshot: false };
  if (s.balance.latest_snapshot) return { money: s.balance.latest_snapshot.amount, snapshot: true };
  return { money: null, snapshot: false };
}
/** 依符號約定顯示：信用卡、負債的負數 → 「欠款 NT$ 3,870」 */
export function balanceHTML(s: L.AccountSummary, big = false) {
  const { money, snapshot } = balanceOf(s);
  if (!money) return `<span class="xs mu">尚未設定期初</span>`;
  const liab = LIAB.includes(s.group);
  const cls = big ? "" : "amt ";
  if (liab) return sign(money.amount) < 0 ? `<span class="${cls}out">欠款 ${fmt(neg(money.amount), money.currency)}</span>` : `<span class="${cls}pos">溢繳 ${fmt(money.amount, money.currency)}</span>`;
  const c = sign(money.amount) > 0 ? "pos" : sign(money.amount) < 0 ? "out" : "zero";
  return `<span class="${cls}${c}">${fmt(money.amount, money.currency)}</span>${snapshot ? `<span class="xs mu"> 快照</span>` : ""}`;
}
function accSub(s: L.AccountSummary) {
  const cc = s.credit_card?.current_statement;
  if (cc && !cc.is_paid_off) { const dd = cc.days_until_due ?? 99; return `本期帳單 ${fmt(cc.amount.amount, cc.amount.currency)} · <span style="color:${dd <= 5 ? "var(--wa)" : "inherit"}">${dd >= 0 ? `${dd} 天後繳款` : `已逾期 ${-dd} 天`}</span>`; }
  if (cc?.is_paid_off) return `本期帳單已繳清`;
  if (!s.balance.opening_set) return `<span style="color:var(--wa)">! 尚未設定期初餘額${s.balance.latest_snapshot ? `（快照 ${md(s.balance.latest_snapshot.as_of.slice(0, 10))}）` : ""}</span>`;
  if (s.group === "liability") return "貸款";
  if (s.reconcile.due && s.reconcile.last_at) return `<span style="color:var(--wa)">! ${daysBetween(s.reconcile.last_at.slice(0, 10), today())} 天未對帳</span>`;
  if (s.reconcile.last_diff && sign(s.reconcile.last_diff.amount)) return `<span style="color:var(--wa)">上次對帳差額 ${fmtSigned(s.reconcile.last_diff.amount, s.reconcile.last_diff.currency)}</span>`;
  const f = s.month_flow;
  return `本月 +${short(num(f.inflow.amount))} ／ ${MINUS}${short(num(f.outflow.amount))}`;
}
function accRow(s: L.AccountSummary, dim = false) {
  return `<a class="acc-row" href="${href("/accounts/" + encodeURIComponent(s.account_key))}" ${dim ? 'style="opacity:.6"' : ""}><span class="cat-ic" style="--cc:var(--s3);color:var(--tx)">${ic(s.icon ?? "wallet")}</span><span class="tx-m"><span class="tx-t"><span>${esc(s.name)}</span>${s.currency !== "TWD" ? `<span class="src">${esc(s.currency)}</span>` : ""}</span><span class="tx-s">${accSub(s)}</span></span>${balanceHTML(s)}</a>`;
}
function invRow(i: L.InvestmentTotal) {
  return `<a class="acc-row" href="${esc(i.link)}" data-a="stocks"><span class="cat-ic" style="--cc:var(--s3);color:var(--tx)">${ic("trend")}</span><span class="tx-m"><span class="tx-t"><span>${esc(i.name)}</span></span><span class="tx-s">${i.is_stale ? `<span style="color:var(--wa)">! 市值已超過 7 天未更新（${md(i.as_of.slice(0, 10))}）</span>` : `市值由股票區同步 · ${md(i.as_of.slice(0, 10))}`}</span></span><span class="amt pos">${fmt(i.market_value.amount, i.market_value.currency)}</span>${ic("ext", "s")}</a>`;
}
function groupTotal(list: L.AccountSummary[]) {
  const by: Record<string, string> = {};
  list.forEach((s) => { const m = balanceOf(s).money; if (m) by[m.currency] = add(by[m.currency] ?? "0", m.amount); });
  return byCurrency(by).map((m) => `${sign(m.amount) < 0 ? MINUS : "+"}${fmt(m.amount.replace("-", ""), m.currency)}`).join(" · ");
}
/** 資產分組占比／各幣種卡片（手機版顯示在總額下方；平板版用彈出面板） */
function pieCard(a: L.AccountsResponse, kind: "group" | "cur") {
  let pie = "";
  if (kind === "group") {
    const cols = ["var(--c4)", "var(--c2)", "var(--c1)", "var(--c5)", "var(--c3)", "var(--c6)"];
    const items = a.groups.filter((g) => !LIAB.includes(g.group)).map((g, i) => {
      const v = g.accounts.map((s) => balanceOf(s).money).filter((m): m is L.Money => !!m && m.currency === "TWD" && sign(m.amount) > 0).reduce((t, m) => add(t, m.amount), "0");
      return { k: g.group, label: GROUP_LABEL[g.group] ?? g.group, amt: v, v: num(v), c: cols[i % cols.length] };
    });
    const inv = a.investments.filter((i) => i.market_value.currency === "TWD").reduce((t, i) => add(t, i.market_value.amount), "0");
    if (sign(inv) > 0) items.push({ k: "investment", label: "投資", amt: inv, v: num(inv), c: "var(--c5)" });
    const shown = items.filter((x) => x.v > 0); const t = shown.reduce((s, x) => s + x.v, 0) || 1;
    pie = `<div class="card" style="margin-top:12px"><div class="ch"><h2 class="h2">資產分組占比 · TWD</h2><button class="ibtn bare" data-a="acc-pie" data-v="group" aria-label="關閉">${ic("x")}</button></div><div class="donut-wrap">${donut(shown, "資產")}<div class="leg">${shown.map((x) => `<button data-a="toast" data-msg="${esc(x.label)} ${fmt(x.amt)}"><i class="dotc" style="background:${x.c}"></i>${esc(x.label)}<span class="p">${(x.v / t * 100).toFixed(1)}%</span><span class="num sm">${fmt(x.amt)}</span></button>`).join("")}</div></div></div>`;
  } else if (kind === "cur") {
    const cash = byCurrency(a.totals.available_cash), card = a.totals.credit_card_due, liab = a.totals.liabilities;
    const curs = [...new Set([...cash.map((m) => m.currency), ...Object.keys(card), ...Object.keys(liab), ...a.investments.map((i) => i.market_value.currency)])].sort((x, y) => (x === "TWD" ? -1 : y === "TWD" ? 1 : x.localeCompare(y)));
    pie = `<div class="card" style="margin-top:12px"><div class="ch"><h2 class="h2">各幣種</h2><button class="ibtn bare" data-a="acc-pie" data-v="cur" aria-label="關閉">${ic("x")}</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>幣別</th><th class="r">可用現金</th><th class="r">投資</th><th class="r">欠款</th></tr></thead><tbody>${curs.map((c) => `<tr><td>${esc(c)}</td><td class="r num">${a.totals.available_cash[c] ? fmt(a.totals.available_cash[c], c) : "—"}</td><td class="r num">${a.investments.filter((i) => i.market_value.currency === c).map((i) => fmt(i.market_value.amount, c)).join("<br>") || "—"}</td><td class="r num">${card[c] || liab[c] ? fmt(add(card[c] ?? "0", liab[c] ?? "0"), c) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="xs mu" style="margin:10px 0 0">不同幣別分開計算，不會換算或相加。</p></div>`;
  }
  return pie;
}
function renderAccounts(d: AccData) {
  const a = d.acc, h = heroNumbers(a);
  const others = Object.entries(h.other).filter(([, v]) => sign(v) !== 0);
  const hero = `<section class="acc-hero"><div class="hero-num"><span class="hero-l">總額<br><b>TWD</b></span><span class="big-n amt ${sign(h.net) >= 0 ? "pos" : "out"}">${sign(h.net) < 0 ? MINUS : ""}${plain(h.net)}</span></div>
    <div class="row hero-sub"><span>總資產 <span class="amt pos">${plain(h.assets)}</span></span><span>總負債 <span class="amt out">${plain(h.debts)}</span></span></div>
    ${others.length ? `<p class="xs mu" style="margin:0">另有 ${others.map(([c, v]) => fmt(v, c)).join("、")}（不同幣別不併入總額）</p>` : ""}
    <div class="row hero-links"><button class="link" data-a="acc-pie" data-v="group" aria-pressed="${ui.accPie === "group"}">${ic("pie", "s")}各分組占比</button><button class="link" data-a="acc-pie" data-v="cur" aria-pressed="${ui.accPie === "cur"}">${ic("pie", "s")}各幣種</button></div></section>`;
  const pie = ui.accPie ? pieCard(a, ui.accPie) : "";
  const { labels, inn, out, last } = d.flow;
  let v = num(h.net); const line = [v]; for (let i = labels.length - 1; i > 0; i--) { v -= inn[i] - out[i]; line.unshift(v); }
  const n = labels.length - 1;
  const chart = `<div class="card" style="margin-top:16px">${comboChart(labels, inn, out, line)}<div class="between" style="margin-top:12px;flex-wrap:wrap"><span class="row sm"><span class="led"></span><b class="num">${labels[n]}</b><span class="mu">收入 <span class="num">+${fmt(last.inn)}</span> · 支出 <span class="num">${MINUS}${fmt(last.out)}</span></span></span><div class="seg" role="group" aria-label="統計週期"><button data-a="acc-period" data-v="week" aria-pressed="${ui.accPeriod === "week"}">${ic("cal", "s")} 按週</button><button data-a="acc-period" data-v="month" aria-pressed="${ui.accPeriod === "month"}">按月</button></div></div><p class="xs mu" style="margin:6px 0 0">淨資產線由目前總額依每期收支回推，不含投資市值變動。</p></div>`;
  const groups = a.groups.map((g) => `<details class="grp" open><summary><span class="sgn" aria-hidden="true"></span>${esc(GROUP_LABEL[g.group] ?? GROUP_TEXT[g.group])} (${g.accounts.length})<span class="num">${groupTotal(g.accounts)}</span></summary><div>${g.accounts.map((s) => accRow(s)).join("")}</div></details>`).join("");
  const inv = a.investments.length ? `<details class="grp" open><summary><span class="sgn" aria-hidden="true"></span>投資 (${a.investments.length})<span class="num">${byCurrency(a.investments.reduce<Record<string, string>>((o, i) => ({ ...o, [i.market_value.currency]: add(o[i.market_value.currency] ?? "0", i.market_value.amount) }), {})).map((m) => "+" + fmt(m.amount, m.currency)).join(" · ")}</span></summary><div>${a.investments.map(invRow).join("")}</div></details>` : "";
  const arch = a.archived.length ? `<details class="grp"><summary><span class="sgn" aria-hidden="true"></span>已封存 (${a.archived.length})<span class="num">${groupTotal(a.archived) || ""}</span></summary><div>${a.archived.map((s) => accRow(s, true)).join("")}</div></details>` : "";
  return `${hero}${pie}${chart}<div class="card" style="margin-top:16px;padding-block:4px">${groups}${inv}${arch}</div>`;
}
registerView("accounts", {
  load: loadAccounts,
  render: renderAccounts,
  title: () => "帳戶總覽",
  nav: "/accounts",
  header: () => `<button class="ibtn round" data-a="hide" aria-pressed="${app.hide}" aria-label="${app.hide ? "顯示金額" : "隱藏金額"}">${ic(app.hide ? "eye-off" : "eye")}</button><div class="grow ctr"><h1 class="ttl">帳戶總覽</h1></div><button class="ibtn round" data-a="acc-new" aria-label="新增帳戶">${ic("plus")}</button>`,
});

/* ------------------------------------------------------------ 帳戶詳情 */
type AccDetail = { a: L.AccountDetail; series: L.BalanceSeries; tx: L.TransactionsPage };
const RANGE: Record<string, { days: number; g: L.Granularity; label: string }> = { "1M": { days: 30, g: "day", label: "1 個月" }, "3M": { days: 90, g: "day", label: "3 個月" }, "1Y": { days: 365, g: "week", label: "1 年" }, ALL: { days: 0, g: "month", label: "全部" } };
async function loadAccount(r: { params: Record<string, string> }): Promise<AccDetail> {
  const key = r.params.key, t = today(), R = RANGE[ui.accRange];
  const from = R.days ? addDays(t, -R.days + 1) : "2025-01-01";
  const [a, series, tx] = await Promise.all([api.account(key, `${monthOf(t)}-01`, t), api.balanceSeries(key, from, t, R.g), api.transactions({ accounts: [key], limit: 10 })]);
  return { a, series, tx };
}
function renderAccount(d: AccDetail) {
  const a = d.a, liab = LIAB.includes(a.group);
  const { money } = balanceOf(a);
  const rec = a.reconcile.last_at ? `上次對帳 ${slash(a.reconcile.last_at.slice(0, 10))}（${daysBetween(a.reconcile.last_at.slice(0, 10), today())} 天前）${a.reconcile.last_diff && sign(a.reconcile.last_diff.amount) ? ` · 差額 ${fmtSigned(a.reconcile.last_diff.amount, a.reconcile.last_diff.currency)}` : " · 相符"}` : "還沒有對帳紀錄";
  const pts = d.series.points;
  const vals = pts.map((p) => num(p.balance) * (liab ? -1 : 1));
  const marks = d.series.reconciliations.map((x) => pts.findIndex((p) => p.date >= x.as_of.slice(0, 10))).filter((i) => i >= 0);
  const chart = pts.length > 1 ? lineChart(vals, { zero: liab, marks, xl: [[0, md(pts[0].date)], [pts.length - 1, md(pts[pts.length - 1].date)]], label: a.name + " 餘額走勢" })
    : `<p class="sm mu">${a.balance.opening_set ? "這段期間沒有資料" : "設定期初餘額後才會有走勢圖。"}</p>`;
  const cc = a.credit_card;
  let side = "";
  if (cc) {
    const s = cc.current_statement;
    side = `<div class="card sp-4"><div class="ch"><h2 class="h2">${ic("card")}本期帳單</h2>${s && !s.is_paid_off && s.days_until_due != null ? `<span class="st ${s.days_until_due <= 5 ? "warn" : "neu"}">${s.days_until_due >= 0 ? `${s.days_until_due} 天後到期` : "已逾期"}</span>` : s?.is_paid_off ? `<span class="st ok">${ic("check", "s")}已繳清</span>` : ""}</div>
      ${s ? `<div class="huge">${fmt(s.amount.amount, s.amount.currency)}</div><p class="sm mu" style="margin:4px 0 14px">${md(s.period_start)}–${md(s.period_end)} · 已繳 ${fmt(s.paid.amount, s.paid.currency)}</p>` : `<p class="sm mu">尚無帳單資料</p>`}
      <div class="kv" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><span>結帳日<br><b>${cc.statement_day ? `每月 ${cc.statement_day} 日` : "—"}</b></span><span>繳款日<br><b>${s?.due_date ? md(s.due_date) : cc.due_day ? `每月 ${cc.due_day} 日` : "—"}</b></span><span>目前欠款<br><b>${money ? fmt(neg(money.amount), money.currency) : "—"}</b></span><span>額度<br><b>${cc.credit_limit ? fmt(cc.credit_limit.amount, cc.credit_limit.currency) : "—"}</b></span></div>
      ${cc.utilization != null ? `<div style="margin-top:14px">${pbar(cc.utilization, cc.utilization >= 0.8 ? "warn" : "ok")}<div class="between xs mu num" style="margin-top:6px"><span>額度使用率 ${pct1(cc.utilization)}</span></div></div>` : ""}
      ${s && !s.is_paid_off ? `<button class="btn p wide" style="margin-top:14px" data-a="pay" data-id="${esc(a.account_key)}" data-amt="${sub(s.amount.amount, s.paid.amount)}">${ic("swap")}繳卡費（轉帳到這張卡）</button>` : ""}
      <a class="btn wide" style="margin-top:10px" href="${href("/reconcile/statements?account=" + encodeURIComponent(a.account_key))}">${ic("receipt")}對帳單（逐筆核對）</a></div>`;
  } else {
    side = `<div class="card sp-4"><div class="ch"><h2 class="h2">本期 · ${+d.a.period.from.slice(5, 7)} 月</h2></div><div class="panel-tot" style="grid-template-columns:1fr 1fr"><div><span class="eyebrow">流入</span><span class="amt inc">+${fmt(a.period.inflow.amount, a.period.inflow.currency)}</span></div><div><span class="eyebrow">流出</span><span class="amt">${MINUS}${fmt(a.period.outflow.amount, a.period.outflow.currency)}</span></div></div>
      <p class="eyebrow" style="margin:16px 0 8px">支出前幾名</p>${a.top_categories.length ? a.top_categories.map((c) => `<a class="between sm" href="${href(`/transactions?accounts=${encodeURIComponent(a.account_key)}&categories=${c.category_key}`)}" style="min-height:36px;border-bottom:1px solid var(--ln);text-decoration:none;color:var(--tx)"><span class="row"><span style="color:${catColor(c.category_key, c.icon)}">${ic(catIconName(c.category_key, c.icon), "s")}</span>${esc(c.name)}</span><span class="num">${fmt(c.amount)}</span></a>`).join("") : '<p class="sm mu">本月沒有支出</p>'}</div>`;
  }
  const list = d.tx.rows;
  const g = new Map<string, L.Transaction[]>(); list.forEach((t) => g.set(t.date, [...(g.get(t.date) ?? []), t]));
  const rows = [...g.entries()].map(([dd, l]) => groupHead(dd, l) + l.map((t) => txRow(t, { balance: true })).join("")).join("");
  return `<div class="grid">
    <div class="card sp-8"><div class="between" style="align-items:flex-start;flex-wrap:wrap"><div><p class="eyebrow">${liab ? "目前欠款" : "目前餘額"}</p><div class="huge">${money ? (liab ? fmt(neg(money.amount), money.currency) : fmt(money.amount, money.currency)) : "—"}</div><p class="sm mu" style="margin:6px 0 0">${rec}</p></div><a class="btn" href="${href("/reconcile?account=" + encodeURIComponent(a.account_key))}">${ic("scale")}對帳</a></div>
      ${!a.balance.opening_set ? `<div class="callout warn" style="margin-top:14px">${ic("alert")}<div>這個帳戶還沒設定期初餘額，只能顯示最新快照，也無法對帳。<a class="link" href="${href("/settings/accounts/opening")}">設定期初</a></div></div>` : ""}
      <div class="between" style="margin:16px 0 6px;flex-wrap:wrap"><h2 class="h2">${liab ? "欠款走勢" : "餘額走勢"}</h2><div class="seg" role="group" aria-label="期間">${Object.entries(RANGE).map(([k, v]) => `<button data-a="acc-range" data-v="${k}" aria-pressed="${ui.accRange === k}">${v.label}</button>`).join("")}</div></div>
      ${chart}<div class="legend"><span><i class="sw-bar" style="height:2px"></i>${liab ? "欠款" : "餘額"}</span><span><svg width="10" height="10" aria-hidden="true"><rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" style="fill:var(--s1);stroke:var(--tx)"/></svg>對帳點</span></div>
    </div>
    ${side}
    <div class="card sp-8"><div class="ch"><h2 class="h2">最近 10 筆明細</h2><a class="link" href="${href("/transactions?accounts=" + encodeURIComponent(a.account_key))}">全部 ${d.tx.summary.count} 筆 ${ic("chev-r", "s")}</a></div>${list.length ? `<div class="list plain">${rows}</div>` : emptyState("還沒有交易", "這個帳戶沒有任何紀錄。")}</div>
    <div class="card sp-4"><div class="ch"><h2 class="h2">${ic("gear")}帳戶設定</h2></div><div class="mlist">
      <button data-a="acc-edit" data-id="${esc(a.account_key)}">名稱、別名${cc ? "、結帳日／繳款日" : ""}${ic("chev-r", "chev")}</button>
      <a href="${href("/settings/accounts/opening")}">期初餘額與日期<span class="xs mu" style="margin-left:auto">${a.balance.opening_set ? "已設定" : "未設定"}</span>${ic("chev-r", "chev")}</a>
      <button data-a="acc-archive" data-id="${esc(a.account_key)}" data-v="${a.is_archived ? "0" : "1"}">${a.is_archived ? "取消封存" : "封存帳戶"}${ic("chev-r", "chev")}</button>
      <button data-a="acc-del" data-id="${esc(a.account_key)}" style="color:var(--dg)">刪除帳戶…${ic("chev-r", "chev")}</button>
    </div></div>
  </div>`;
}
registerView("account", { load: loadAccount, render: renderAccount, title: (d) => d?.a.name ?? "帳戶詳情", back: "/accounts", nav: "/accounts" });

/* ------------------------------------------------------------ actions */
actions({
  hide() { app.hide = !app.hide; document.body.classList.toggle("hide-amt", app.hide); shell(); },
  "acc-pie"(el) { const v = el.dataset.v as "group" | "cur"; ui.accPie = ui.accPie === v ? false : v; rerender(); },
  "acc-period"(el) { ui.accPeriod = el.dataset.v as "week" | "month"; reload(); },
  "acc-range"(el) { ui.accRange = el.dataset.v as typeof ui.accRange; reload(); },
  "acc-new"() { openAccountForm(); },
  "acc-edit"(el) { openAccountForm(el.dataset.id); },
  async "acc-archive"(el) {
    const key = el.dataset.id!, on = el.dataset.v === "1";
    const go = async () => { try { await api.archiveAccount(key, on); toast(on ? "已封存，記一筆選單不再顯示這個帳戶" : "已取消封存"); reload(); } catch (e) { handleError(e); } };
    if (on) dialog("封存這個帳戶？", "<p style='margin:0'>封存後不會出現在記一筆選單，歷史交易與報表不受影響，隨時可以取消封存。</p>", "封存", go); else go();
  },
  "acc-del"(el) { deleteAccountFlow(el.dataset.id!); },
  async pay(el) {
    const card = el.dataset.id!;
    const from = app.catalog!.accounts.find((a) => a.can_record && a.group === "bank")?.account_key ?? null;
    openEntry({ type: "transfer", prefill: { acc: from, to: card, amt: el.dataset.amt ?? "" } });
  },
});

/* ================================================================ 平板／桌面：帳戶三欄 master–detail（issue #12，≥ 960px） */
type Det = { key: string; month: L.ISOMonth; a: L.AccountDetail; series: L.BalanceSeries; rows: L.Transaction[]; count: number };
type AW = { wide: true; acc: L.AccountsResponse; det: Det | null };
const accMonth = () => ui.accW.month || monthOf(today());
async function loadDet(key: string): Promise<Det> {
  const m = accMonth(), from = `${m}-01`, to = monthEnd(m) > today() ? today() : monthEnd(m);
  const rowsP = (async () => {
    const rows: L.Transaction[] = []; let cursor: string | undefined;
    for (let i = 0; i < 10; i++) { const p = await api.transactions({ accounts: [key], from, to: monthEnd(m), limit: 200, cursor }); rows.push(...p.rows); cursor = p.next_cursor ?? undefined; if (!cursor) break; }
    return rows;
  })();
  const [a, series, rows, cnt] = await Promise.all([api.account(key, from, monthEnd(m)), api.balanceSeries(key, from, to < from ? from : to, "day"), rowsP, api.transactions({ accounts: [key], limit: 1 })]);
  return { key, month: m, a, series, rows, count: cnt.summary.count };
}
const firstKey = (a: L.AccountsResponse) => a.groups.flatMap((g) => g.accounts)[0]?.account_key ?? a.archived[0]?.account_key ?? null;
async function loadWideAcc(r: { params: Record<string, string> }): Promise<AW> {
  const acc = await api.accounts(true);
  const key = r.params.key ?? firstKey(acc);
  return { wide: true, acc, det: key ? await loadDet(key) : null };
}
/** 左欄帳戶列：選中的有底色＋左側強調線；信用卡多一行「可用額度」 */
function accRowW(s: L.AccountSummary, selKey: string | null, dim = false) {
  const on = s.account_key === selKey, cc = s.credit_card;
  const m = balanceOf(s).money;
  const avail = cc?.credit_limit && m ? add(cc.credit_limit.amount, m.amount) : null; // 餘額為負數＝欠款
  return `<a class="accw-row ${on ? "sel" : ""}" href="${href("/accounts/" + encodeURIComponent(s.account_key))}" data-key="${esc(s.account_key)}" ${on ? 'aria-current="true"' : ""} ${dim ? 'style="opacity:.6"' : ""}>
    <span class="cat-ic" style="--cc:var(--s3);color:var(--tx)">${ic(s.icon ?? "wallet")}</span><span class="tx-m"><span class="tx-t"><span>${esc(s.name)}</span>${s.currency !== "TWD" ? `<span class="xs mu">${esc(s.currency)}</span>` : ""}</span>${avail ? `<span class="tx-s">可用額度 ${fmt(avail, cc!.credit_limit!.currency)}</span>` : ""}</span><span class="accw-bal">${balanceHTML(s)}</span></a>`;
}
function masterHTML(a: L.AccountsResponse, selKey: string | null) {
  const h = heroNumbers(a);
  const others = Object.entries(h.other).filter(([, v]) => sign(v) !== 0);
  const hero = `<section class="accw-hero"><div class="hero-num"><span class="hero-l">總額<br><b>TWD</b></span><span class="big-n amt ${sign(h.net) >= 0 ? "pos" : "out"}">${sign(h.net) < 0 ? MINUS : ""}${plain(h.net)}</span></div>
    <div class="row hero-sub"><span>總資產 <span class="amt pos">${plain(h.assets)}</span></span><span>總負債 <span class="amt out">${plain(h.debts)}</span></span></div>
    ${others.length ? `<p class="xs" style="margin:0;opacity:.85">另有 ${others.map(([c, v]) => fmt(v, c)).join("、")}（不併入）</p>` : ""}
    <div class="row hero-links"><button class="link" data-a="accw-pie" data-v="group">${ic("pie", "s")}各分組佔比</button><button class="link" data-a="accw-pie" data-v="cur">${ic("pie", "s")}各幣種佔比</button></div></section>`;
  const grp = (label: string, list: L.AccountSummary[], open = true, dim = false) => `<details class="grp" ${open ? "open" : ""}><summary><span class="sgn" aria-hidden="true"></span>${esc(label)} (${list.length})<span class="num">${groupTotal(list)}</span></summary><div>${list.map((s) => accRowW(s, selKey, dim)).join("")}</div></details>`;
  const groups = a.groups.map((g) => grp(GROUP_LABEL[g.group] ?? GROUP_TEXT[g.group], g.accounts)).join("");
  const inv = a.investments.length ? `<details class="grp" open><summary><span class="sgn" aria-hidden="true"></span>投資 (${a.investments.length})<span class="num">${byCurrency(a.investments.reduce<Record<string, string>>((o, i) => ({ ...o, [i.market_value.currency]: add(o[i.market_value.currency] ?? "0", i.market_value.amount) }), {})).map((m) => "+" + fmt(m.amount, m.currency)).join(" · ")}</span></summary><div>${a.investments.map(invRow).join("")}</div></details>` : "";
  const arch = a.archived.length ? grp("已封存", a.archived, false, true) : "";
  return `<div class="accw-lh"><h2 class="h2">帳戶總覽</h2><button class="ibtn" data-a="acc-new" aria-label="新增帳戶">${ic("plus")}</button></div>${hero}<nav class="accw-list" aria-label="帳戶清單">${groups}${inv}${arch}</nav>`;
}
/** 帳務統計：依類型分列（筆數、比例條、金額），最後一列總計 */
function statsHTML(d: Det) {
  const cur = d.a.currency;
  const kinds: { k: string; l: string; c: string; test: (t: L.Transaction) => boolean }[] = [
    { k: "exp", l: "支出", c: "var(--exp)", test: (t) => t.type === "expense" },
    { k: "inc", l: "收入", c: "var(--inc)", test: (t) => t.type === "income" },
    { k: "tin", l: "轉入", c: "var(--c5)", test: (t) => (t.type === "transfer" || t.type === "credit_card_payment") && t.direction === "in" },
    { k: "tout", l: "轉出", c: "var(--c3)", test: (t) => (t.type === "transfer" || t.type === "credit_card_payment") && t.direction === "out" },
    { k: "adj", l: "餘額調整", c: "var(--c2)", test: (t) => t.type === "adjustment" },
    { k: "oth", l: "其他", c: "var(--c6)", test: () => true },
  ];
  const rows = d.rows.filter((t) => t.amount.currency === cur);
  const used = new Set<number>();
  const lines = kinds.map((k) => { const l = rows.filter((t) => !used.has(t.id) && k.test(t)); l.forEach((t) => used.add(t.id)); return { ...k, n: l.length, sum: add(...l.map(signed)) }; }).filter((x) => x.n);
  const mx = Math.max(1, ...lines.map((x) => Math.abs(num(x.sum))));
  const total = add(...lines.map((x) => x.sum)), n = lines.reduce((s, x) => s + x.n, 0);
  const line = (l: string, c: string, cnt: number, sum: string, tot = false) => `<div class="st-row ${tot ? "tot" : ""}"><span>${l}</span><span class="cnt" style="background:${c}">${cnt}</span><span class="st-bar"><i style="width:${(Math.abs(num(sum)) / mx * 100).toFixed(1)}%;background:${c}"></i></span><span class="amt ${sign(sum) >= 0 ? "pos" : "out"}">${fmtSigned(sum, cur)}</span></div>`;
  return lines.length ? `<div class="st-rows">${lines.map((x) => line(x.l, x.c, x.n, x.sum)).join("")}${line("總計", "var(--ac)", n, total, true)}</div>` : `<div class="ovw-empty">${ic("list")}<p>這個月份沒有資料</p></div>`;
}
function detailHTML(d: Det | null) {
  if (!d) return `<div class="ovw-empty">${ic("wallet")}<p>還沒有帳戶</p><button class="btn" data-a="acc-new">${ic("plus")}新增帳戶</button></div>`;
  const a = d.a, liab = LIAB.includes(a.group), m = d.month, cc = a.credit_card;
  const pts = d.series.points, vals = pts.map((p) => num(p.balance) * (liab ? -1 : 1));
  const chart = pts.length > 1 ? lineChart(vals, { zero: liab, xl: [[0, md(pts[0].date)], [pts.length - 1, md(pts[pts.length - 1].date)]], label: a.name + (liab ? " 欠款走勢" : " 餘額走勢") })
    : `<p class="sm mu">${a.balance.opening_set ? "這個月份沒有資料" : "設定期初餘額後才會有走勢圖。"}</p>`;
  const { money } = balanceOf(a);
  const kv = (k: string, v: string, hint = "") => `<div class="kv-row"><span>${k}</span><span ${hint ? `title="${hint}"` : ""}>${v}</span></div>`;
  const NA = `<span class="mu" aria-label="契約 v1.0 沒有這個欄位">—</span>`;
  const info = kv("餘額", money ? balanceHTML(a) : `<span class="mu">尚未設定期初</span>`) + kv("記帳筆數", `<span class="num">${d.count.toLocaleString("en-US")}</span>`) + kv("主幣種", esc(a.currency)) +
    kv("帳戶分組", esc(GROUP_TEXT[a.group])) + kv("信用帳戶", cc ? "是" : "否") + kv("主帳戶", NA, "契約 v1.1 提案") + kv("紅利回饋", NA, "契約 v1.1 提案") + kv("國外交易手續費", NA, "契約 v1.1 提案") + kv("封存帳戶", a.is_archived ? "是" : "否");
  const s = cc?.current_statement;
  const card = cc ? `<section class="accw-card"><div class="ch"><h3 class="h3">${ic("card", "s")}本期帳單</h3>${s && !s.is_paid_off && s.days_until_due != null ? `<span class="st ${s.days_until_due <= 5 ? "warn" : "neu"}">${s.days_until_due >= 0 ? `${s.days_until_due} 天後繳款` : `已逾期 ${-s.days_until_due} 天`}</span>` : ""}</div>
    ${s ? `<div class="big">${fmt(s.amount.amount, s.amount.currency)}</div><p class="sm mu" style="margin:2px 0 10px">${md(s.period_start)}–${md(s.period_end)} · 已繳 ${fmt(s.paid.amount, s.paid.currency)}</p>` : `<p class="sm mu">尚無帳單</p>`}
    ${cc.utilization != null ? `${pbar(cc.utilization, cc.utilization >= 0.8 ? "warn" : "ok")}<p class="xs mu num" style="margin:6px 0 0">額度使用率 ${pct1(cc.utilization)}</p>` : ""}
    ${s && !s.is_paid_off ? `<button class="btn p wide" style="margin-top:12px" data-a="pay" data-id="${esc(a.account_key)}" data-amt="${sub(s.amount.amount, s.paid.amount)}">${ic("swap")}繳卡費</button>` : ""}</section>` : "";
  const rec = a.reconcile.last_at ? `上次對帳 ${slash(a.reconcile.last_at.slice(0, 10))}（${daysBetween(a.reconcile.last_at.slice(0, 10), today())} 天前）` : "還沒有對帳過";
  const ops = `<section class="accw-card"><div class="ch"><h3 class="h3">帳戶操作</h3></div><div class="mlist">
    <a href="${href("/reconcile?account=" + encodeURIComponent(a.account_key))}">${ic("scale", "s")}對帳<span class="xs mu" style="margin-left:auto">${rec}</span>${ic("chev-r", "chev")}</a>
    ${cc ? `<a href="${href("/reconcile/statements?account=" + encodeURIComponent(a.account_key))}">${ic("receipt", "s")}對帳單（逐筆核對）${ic("chev-r", "chev")}</a>` : ""}
    <a href="${href("/settings/accounts/opening")}">期初餘額與日期<span class="xs mu" style="margin-left:auto">${a.balance.opening_set ? "已設定" : "未設定"}</span>${ic("chev-r", "chev")}</a>
    <button data-a="acc-archive" data-id="${esc(a.account_key)}" data-v="${a.is_archived ? "0" : "1"}">${a.is_archived ? "取消封存" : "封存帳戶"}${ic("chev-r", "chev")}</button>
    <button data-a="acc-del" data-id="${esc(a.account_key)}" style="color:var(--dg)">刪除帳戶…${ic("chev-r", "chev")}</button></div></section>`;
  const view = (v: string, l: string, i: string, soon = false) => `<button class="ibtn bare" data-a="accw-view" data-v="${v}" aria-pressed="${ui.accW.view === v}" aria-label="${l}${soon ? "（即將推出）" : ""}" title="${l}${soon ? "（即將推出）" : ""}">${ic(i, "s")}</button>`;
  return `<div class="accw-mh"><span class="cat-ic" style="--cc:var(--s3);color:var(--tx)">${ic(a.icon ?? "wallet")}</span><h2 class="h2">${esc(a.name)}</h2>
      <div class="row accw-views" role="group" aria-label="記錄檢視">${view("list", "清單", "list")}${view("detail", "詳細", "receipt")}${view("grid", "格狀", "grid", true)}</div></div>
    <div class="accw-mh2"><div class="rng"><button class="ibtn bare" data-a="accw-month" data-v="-1" aria-label="上個月">${ic("chev-l", "s")}</button><span class="num">${slash(m)}/01 – ${slash(monthEnd(m))}</span><button class="ibtn bare" data-a="accw-month" data-v="1" aria-label="下個月" ${m >= monthOf(today()) ? "disabled" : ""}>${ic("chev-r", "s")}</button></div></div>
    <section class="accw-card"><div class="ch"><h3 class="h3">帳務統計</h3><span class="xs mu">${esc(a.currency)}</span></div>${statsHTML(d)}<div style="margin-top:14px">${chart}</div></section>
    <section class="accw-card"><div class="ch"><h3 class="h3">帳戶資訊</h3><button class="ibtn bare" data-a="acc-edit" data-id="${esc(a.account_key)}" aria-label="編輯帳戶">${ic("gear", "s")}</button></div><div class="kv-list">${info}</div></section>
    ${card}${ops}`;
}
/** 右欄：一般記錄（記帳後餘額＝契約的 balance_after） */
function recordsHTML(d: Det | null) {
  if (!d) return "";
  const rows = d.rows.slice().sort((x, y) => y.occurred_at.localeCompare(x.occurred_at));
  const m = d.month;
  const head = `<div class="accw-xh"><h2 class="h2">一般記錄 <span class="cnt">${rows.length}</span></h2><span class="grow"></span>
    <a class="ibtn bare" href="${href(`/transactions?accounts=${encodeURIComponent(d.key)}&from=${m}-01&to=${monthEnd(m)}`)}" aria-label="篩選這個帳戶的交易" title="篩選">${ic("filter", "s")}</a>
    <button class="ibtn bare" data-a="accw-add" data-id="${esc(d.key)}" aria-label="在這個帳戶記一筆" title="記一筆">${ic("plus", "s")}</button></div>`;
  if (!rows.length) return head + `<div class="ovw-empty">${ic("list")}<p>尚無交易記錄</p></div>`;
  if (ui.accW.view === "list") {
    const g = new Map<string, L.Transaction[]>(); rows.forEach((t) => g.set(t.date, [...(g.get(t.date) ?? []), t]));
    return head + `<div class="list">${[...g.entries()].map(([dd, l]) => groupHead(dd, l) + l.map((t) => txRow(t, { balance: true })).join("")).join("")}</div>`;
  }
  return head + `<div class="recs">${rows.map((t) => {
    const name = t.merchant || t.category?.sub?.name || t.category?.main.name || (t.transfer ? (t.direction === "in" ? `從 ${t.transfer.counterpart.account_name} 轉入` : `轉到 ${t.transfer.counterpart.account_name}`) : t.type === "adjustment" ? "餘額調整" : "—");
    const subl = [t.category ? (t.category.sub ? `${t.category.main.name} › ${t.category.sub.name}` : t.category.main.name) : "", t.note ?? ""].filter((x) => x && x !== name).join(" · ");
    const cat = t.category?.sub?.category_key ?? t.category?.main.category_key ?? null;
    const icon = t.transfer ? "swap" : t.type === "adjustment" ? "scale" : catIconName(cat, t.category?.main.icon);
    const s = signed(t);
    return `<button class="rec" data-a="edit" data-id="${t.id}" aria-label="${esc(name)} ${fmtSigned(s, t.amount.currency)}，${md(t.date)}">
      <span class="rec-top"><span class="num">${slash(t.date)} 週${wd(t.date)} ${t.occurred_at.slice(11, 16)}</span>${t.balance_after ? `<span class="num mu">餘 ${fmtSigned(t.balance_after.amount, t.balance_after.currency)}</span>` : ""}</span>
      <span class="rec-main"><span class="cat-ic" style="--cc:${t.transfer || t.type === "adjustment" ? "var(--s3)" : catColor(cat, t.category?.main.icon)}${t.transfer || t.type === "adjustment" ? ";color:var(--tx)" : ""}">${ic(icon)}</span>
        <span class="tx-m"><span class="tx-t"><span>${esc(name)}</span></span>${subl ? `<span class="tx-s">${esc(subl)}</span>` : ""}</span>
        <span class="rec-r"><span class="amt ${sign(s) >= 0 ? "inc" : "out"}">${fmtSigned(s, t.amount.currency)}</span><span class="acc-chip">${esc(t.account.name)}</span></span></span></button>`;
  }).join("")}</div>`;
}
function renderWideAcc(d: AW) {
  const k = d.det?.key ?? null, n = d.det?.rows.length ?? 0;
  return `<div class="accw pane-${ui.accW.pane}">
    <section class="accw-l" aria-label="帳戶清單" tabindex="0">${masterHTML(d.acc, k)}</section>
    <div class="accw-r">
      <div class="accw-tabs seg" role="tablist" aria-label="帳戶內容"><button role="tab" data-a="accw-pane" data-v="info" aria-selected="${ui.accW.pane === "info"}">帳戶資訊</button><button role="tab" data-a="accw-pane" data-v="rec" aria-selected="${ui.accW.pane === "rec"}">一般記錄 (${n})</button></div>
      <section class="accw-m" id="accw-m" aria-label="帳戶詳情" tabindex="0">${detailHTML(d.det)}</section>
      <section class="accw-x" id="accw-x" aria-label="一般記錄" tabindex="0">${recordsHTML(d.det)}</section>
    </div></div>`;
}
/** 只更新中欄、右欄（不整頁重畫；左欄的捲動位置和展開狀態都保留） */
let detToken = 0;
async function refreshDet(key: string) {
  const d = currentData<AW>(); if (!d?.wide) return;
  const tok = ++detToken;
  $("#accw-m")?.classList.add("loading"); $("#accw-x")?.classList.add("loading");
  document.querySelectorAll<HTMLElement>(".accw-row").forEach((r) => { const on = r.dataset.key === key; r.classList.toggle("sel", on); on ? r.setAttribute("aria-current", "true") : r.removeAttribute("aria-current"); });
  try {
    const det = await loadDet(key);
    if (tok !== detToken) return;
    d.det = det;
    const m = $("#accw-m"), x = $("#accw-x"), tabs = $(".accw-tabs [data-v=rec]");
    if (m) { m.innerHTML = detailHTML(det); m.classList.remove("loading"); m.scrollTop = 0; }
    if (x) { x.innerHTML = recordsHTML(det); x.classList.remove("loading"); x.scrollTop = 0; }
    if (tabs) tabs.textContent = `一般記錄 (${det.rows.length})`;
    shell();
  } catch (e) { $("#accw-m")?.classList.remove("loading"); $("#accw-x")?.classList.remove("loading"); handleError(e); }
}
const isAccRoute = (r: Route) => r.name === "accounts" || r.name === "account";
function softAcc(prev: Route, next: Route) {
  if (!wide() || !isAccRoute(prev) || !isAccRoute(next) || !currentData<AW>()?.wide || !$("#accw-m")) return false;
  const key = next.params.key ?? firstKey(currentData<AW>().acc);
  if (key) refreshDet(key);
  return true;
}
// 平板版：accounts 與 account 共用三欄版面；手機版維持原本的兩頁
const accHeaderNarrow = registered("accounts").header!;
patchView("accounts", { load: (r) => (wide() ? loadWideAcc(r) : loadAccounts()), render: (d) => (wide() && d?.wide ? renderWideAcc(d) : renderAccounts(d)), title: (d) => (wide() ? "帳戶" : "帳戶總覽"), header: (d, r) => (wide() ? `<div class="grow ctr"><h1 class="ttl">帳戶</h1></div>` : accHeaderNarrow(d, r)), soft: softAcc });
patchView("account", { load: (r) => (wide() ? loadWideAcc(r) : loadAccount(r)), render: (d) => (wide() && d?.wide ? renderWideAcc(d) : renderAccount(d)), title: (d) => (wide() ? "帳戶" : (d as AccDetail | null)?.a.name ?? "帳戶詳情"), back: "/accounts", soft: softAcc });

actions({
  "accw-pie"(el) { const a = currentData<AW>().acc; const k = el.dataset.v as "group" | "cur"; openSheet("form", sheetShell(k === "group" ? "各分組佔比" : "各幣種佔比", pieCard(a, k).replace(/<button class="ibtn bare" data-a="acc-pie"[^>]*>.*?<\/button>/, ""), `<button class="btn" data-a="closeall">關閉</button>`)); },
  "accw-month"(el) { const k = Number(el.dataset.v); ui.accW.month = addMonths(accMonth(), k); if (ui.accW.month >= monthOf(today())) ui.accW.month = ""; const key = currentData<AW>().det?.key; if (key) refreshDet(key); },
  "accw-pane"(el) { ui.accW.pane = el.dataset.v as "info" | "rec"; const w = $(".accw"); w?.classList.remove("pane-info", "pane-rec"); w?.classList.add("pane-" + ui.accW.pane); document.querySelectorAll(".accw-tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String((b as HTMLElement).dataset.v === ui.accW.pane))); },
  "accw-view"(el) { const v = el.dataset.v as "list" | "detail" | "grid"; if (v === "grid") { toast("格狀檢視即將推出"); return; } ui.accW.view = v; const d = currentData<AW>(); const x = $("#accw-x"); if (x && d?.det) x.innerHTML = recordsHTML(d.det); document.querySelectorAll(".accw-views [data-v]").forEach((b) => b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.v === v))); },
  "accw-add"(el) { const key = el.dataset.id!; const o = app.catalog?.accounts.find((x) => x.account_key === key); if (o && !o.can_record) { toast("這個帳戶不能記帳（已封存或為投資帳戶）"); return; } openEntry({ prefill: { acc: key, cur: o?.currency ?? "TWD" } }); },
});
