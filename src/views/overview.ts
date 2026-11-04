/** 第二頁：每日明細＋本月總覽（/finance）。資料來自 /overview 與該月的 /transactions。 */
import type * as L from "../types/ledger";
import { esc, ic } from "../lib/dom";
import { fmt, fmtSigned, MINUS, num, pct1, twd, byCurrency, sign, sub, cmp, sumByCurrency, add, abs, short } from "../lib/money";
import { dailyTotals, buckets, delta as deltaOf, periodInfo, type Bucket } from "../lib/series";
import { wide } from "../lib/layout";
import { today, addDays, daysBetween, dow, wd, md, slash, monthOf, addMonths, daysInMonth, monthStart, monthEnd } from "../lib/dates";
import { app, ui } from "../state";
import { api } from "../api/ledger";
import { registerView, actions, rerender, reload, handleError } from "../app";
import { href, navigate } from "../router";
import { txRow, pbar, stPill, fromBudget, catColor, catIconName } from "../ui/components";
import { dailyChart, donutCard, niceMax, type Slice } from "../ui/charts";
import { openEntry } from "../ui/entry";
import { toast } from "../ui/overlay";
import { remindList } from "../ui/remind";
import { pendingAsTx } from "./transactions";

type D = { o: L.Overview; tx: L.Transaction[] };
async function load(): Promise<D> {
  const m = ui.cal.month;
  const all = async () => {
    const tx: L.Transaction[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 6; i++) {
      const p = await api.transactions({ from: addDays(monthStart(m), -7), to: addDays(monthEnd(m), 7), limit: 200, cursor });
      tx.push(...p.rows); cursor = p.next_cursor ?? undefined; if (!cursor) break;
    }
    return tx;
  };
  const [o, tx] = await Promise.all([api.overview(m), all()]);
  return { o, tx };
}

function calDays() {
  const first = monthStart(ui.cal.month), last = monthEnd(ui.cal.month);
  const start = addDays(first, -((dow(first) + 6) % 7)), end = addDays(last, 6 - ((dow(last) + 6) % 7));
  return Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => addDays(start, i));
}
function calendar(all: L.Transaction[]) {
  const c = ui.cal, t = today();
  let days = calDays();
  if (c.col) { const i = Math.max(0, days.indexOf(c.sel)); const w = Math.floor(i / 7); days = days.slice(w * 7, w * 7 + 7); }
  const has: Record<string, { exp: number; inc: number }> = {};
  all.forEach((x) => { const h = (has[x.date] ??= { exp: 0, inc: 0 }); if (x.type === "expense" && x.amount.currency === "TWD") h.exp += num(x.amount.amount); if (x.type === "income" && x.amount.currency === "TWD") h.inc += num(x.amount.amount); });
  const head = ["一", "二", "三", "四", "五", "六", "日"].map((w, i) => `<span class="cal-w ${i === 5 ? "sat" : i === 6 ? "sun" : ""}">週${w}</span>`).join("");
  const cells = days.map((d) => {
    const out = !d.startsWith(c.month), dw = dow(d), first = d.slice(8) === "01", h = has[d];
    const lbl = `${+d.slice(5, 7)} 月 ${+d.slice(8)} 日 星期${wd(d)}${h ? `，支出 ${h.exp} 元${h.inc ? "，收入 " + h.inc + " 元" : ""}` : "，沒有紀錄"}`;
    return `<button class="cal-d ${out ? "out" : ""} ${dw === 6 ? "sat" : dw === 0 ? "sun" : ""} ${d === c.sel ? "sel" : ""} ${d === t ? "today" : ""}" data-a="cal-pick" data-d="${d}" aria-label="${lbl}" aria-pressed="${d === c.sel}"><span class="n ${first ? "mo" : ""}">${first ? +d.slice(5, 7) + "月" : d.slice(8)}</span>${h ? '<i class="cal-dot" aria-hidden="true"></i>' : ""}</button>`;
  }).join("");
  return `<div class="cal" role="group" aria-label="${c.month.replace("-", " 年 ")} 月">${head}${cells}</div><button class="cal-handle" data-a="cal-col" aria-label="${c.col ? "展開整個月" : "收合成一週"}"></button>`;
}
function dayMoney(list: L.Transaction[], type: "expense" | "income") {
  const by = sumByCurrency(list.filter((x) => x.type === type).map((x) => x.amount));
  if (!Object.keys(by).length) by.TWD = "0";
  return byCurrency(by);
}
export function remindCard(alerts: L.Alert[]) {
  return `<div class="card" id="remind"><div class="ch"><h2 class="h2">${ic("bell")}待處理</h2><span class="eyebrow">${alerts.length} 項</span></div>${remindList(alerts)}</div>`;
}
function delta(d: L.Delta | undefined, lowerGood = false) {
  if (!d || d.change_ratio == null) return `<span class="delta flat">—</span>`;
  const up = d.change_ratio >= 0, good = lowerGood ? !up : up;
  return `<span class="delta ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(d.change_ratio * 100).toFixed(1)}%</span>`;
}
export function kpiCards(k: L.Kpi, label: string, clickable = true, cmpLabel = "比上月同期") {
  const inc = twd(k.income), exp = twd(k.expense), net = twd(k.net);
  const other = (m: L.MoneyByCurrency) => byCurrency(m).filter((x) => x.currency !== "TWD").map((x) => fmt(x.amount, x.currency)).join("、");
  const pr = k.compare ? (num(k.compare.income.previous) ? (num(k.compare.income.previous) - num(k.compare.expense.previous)) / num(k.compare.income.previous) : null) : null;
  const rateD = k.savings_rate != null && pr != null ? (() => { const d = k.savings_rate! - pr; return `<span class="delta ${d >= 0 ? "good" : "bad"}">${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(1)} pt</span>`; })() : `<span class="delta flat">—</span>`;
  const cards: [string, string, string, string, string][] = [
    ["收入", `<span class="amt inc">+${fmt(inc)}</span>`, delta(k.compare?.income), "kpi-inc", other(k.income)],
    ["支出", `<span class="amt out">${MINUS}${fmt(exp)}</span>`, delta(k.compare?.expense, true), "kpi-exp", other(k.expense)],
    ["淨額", `<span class="amt ${sign(net) >= 0 ? "inc" : "out"}">${fmtSigned(net)}</span>`, delta(k.compare?.net), "kpi-net", ""],
    ["儲蓄率", `<span class="num">${pct1(k.savings_rate)}</span>`, rateD, "kpi-rate", ""],
  ];
  return cards.map(([l, v, d, a, o]) => `<${clickable ? `button class="kpi" data-a="${a}"` : 'div class="kpi" style="cursor:default"'}><span class="eyebrow">${l} · ${label}</span><span class="v">${v}</span>${o ? `<span class="xs mu">另有 ${o}（不併入）</span>` : ""}${k.compare ? `<span class="row xs mu">${d}<span>${cmpLabel}</span></span>` : ""}</${clickable ? "button" : "div"}>`).join("");
}
export function slicesToDonut(cats: L.CategorySlice[]): Slice[] {
  if (ui.donut) {
    const m = cats.find((c) => c.category_key === ui.donut);
    if (m?.children) { const cols = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"]; return m.children.map((c, i) => ({ k: c.category_key, label: c.name, v: num(c.amount), c: cols[i % 6] })); }
    ui.donut = null;
  }
  return cats.map((c) => ({ k: c.category_key, label: c.name, v: num(c.amount), c: catColor(c.category_key, c.icon) }));
}
export function catDonut(cats: L.CategorySlice[], title: string, from: string, to: string) {
  const items = slicesToDonut(cats);
  const drill = ui.donut ? cats.find((c) => c.category_key === ui.donut)?.name ?? null : null;
  return donutCard({ title, items, drillLabel: drill, center: drill ?? "支出", drillable: true, legendAction: drill ? "gotx-cat" : "seg",
    extra: `${drill ? `<a class="link" href="${href(`/transactions?categories=${ui.donut}&from=${from}&to=${to}`)}" style="margin-top:8px">看 ${esc(drill)} 的所有明細 ${ic("chev-r", "s")}</a>` : ""}<span hidden data-range="${from}|${to}"></span>` });
}

/** 手機版與平板版共用的卡片（平板版把月曆移到右欄，其餘卡片放在左主區下方） */
function parts(d: D) {
  const { o } = d; const sel = ui.cal.sel, t = today();
  const all = [...pendingAsTx(app.queue), ...d.tx];
  const dl = all.filter((x) => x.date === sel).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const ex = dayMoney(dl, "expense"), inc = dayMoney(dl, "income");
  const b = o.budget;
  const daySum = `<div class="day-sum"><span class="cat-ic big" style="--cc:var(--s3);color:var(--tx)">${ic("wallet")}</span><div style="flex:1;min-width:0"><b>${md(sel)}（${wd(sel)}）</b>${sel === t ? ' <span class="st neu">今天</span>' : ""}<div class="xs mu">${+o.month.slice(5)} 月支出 <span class="num">${fmt(twd(o.kpi.expense))}</span>${b?.total ? ` · 預算剩 <span class="num">${fmt(b.total.remaining)}</span>` : ""}</div></div><div class="day-tot">${ex.map((m) => `<span class="amt out">${MINUS}${fmt(m.amount, m.currency)}</span>`).join("")}<span class="mu" aria-hidden="true">•</span>${inc.map((m) => `<span class="amt inc">+${fmt(m.amount, m.currency)}</span>`).join("")}</div></div>`;
  const dayList = dl.length ? `<div class="list">${dl.map((x) => txRow(x)).join("")}</div>`
    : `<div class="empty" style="padding:24px 16px"><h3>這天沒有紀錄</h3><p>補記一筆，日期會自動帶入 ${md(sel)}。</p><button class="btn" data-a="add-on" data-d="${sel}">${ic("plus")}記一筆</button></div>`;
  const calCard = `<section class="cal-card" aria-label="月曆與當日明細">${calendar(all)}${daySum}${dayList}</section>`;

  const mm = `${+o.month.slice(5)} 月`;
  const kpis = kpiCards(o.kpi, mm);
  let budCard = `<div class="card"><div class="ch"><h2 class="h2">本月預算</h2><a class="btn sm" href="${href("/budgets")}">設定預算</a></div><p class="sm mu" style="margin:0">還沒有設定預算。</p></div>`;
  if (b?.total) {
    const T = b.total, warn = b.lines.filter((l) => l.status !== "ok").sort((x, y) => y.ratio - x.ratio).slice(0, 3);
    const left = o.month === monthOf(t) ? daysInMonth(o.month) - +t.slice(8) : 0;
    budCard = `<div class="card"><div class="ch"><h2 class="h2">本月預算</h2><a class="link" href="${href("/budgets")}">全部分類 ${ic("chev-r", "s")}</a></div>
      <div class="between" style="align-items:flex-end;flex-wrap:wrap"><div><p class="eyebrow">剩餘</p><div class="huge">${fmt(T.remaining)}</div></div><div class="num sm mu" style="text-align:right">已用 ${fmt(T.used)} / ${fmt(T.limit)}<br>${pct1(T.ratio)}${left ? ` · 剩 ${left} 天` : ""}</div></div>
      <div style="margin:12px 0">${pbar(T.ratio, fromBudget(T.status))}</div>
      ${cmp(T.projected, T.limit) > 0 ? `<p class="xs" style="margin:0 0 10px;color:var(--wa)">照目前速度，月底預估 ${fmt(T.projected)}，會超出 ${fmt(sub(T.projected, T.limit))}</p>` : ""}
      <div class="stack" style="gap:10px">${warn.length ? warn.map((l) => `<a href="${href("/budgets")}" class="between" style="text-decoration:none;color:var(--tx);min-height:44px"><span class="row" style="flex:1;min-width:0"><span class="cat-ic" style="width:32px;height:32px;--cc:${catColor(l.category_key)}">${ic(catIconName(l.category_key), "s")}</span><span style="flex:1;min-width:0"><span class="between"><b style="font-weight:500">${esc(l.name)}</b><span class="num xs">${fmt(l.used)} / ${fmt(l.limit)}</span></span>${pbar(l.ratio, fromBudget(l.status), true)}</span></span>${stPill(fromBudget(l.status))}</a>`).join("") : `<p class="xs mu" style="margin:0">${ic("check", "s")} 各分類都在預算內</p>`}</div></div>`;
  }
  const remCard = remindCard(o.alerts);

  const isCur = o.month === monthOf(t);
  const spend = o.series.map((p) => num(p.expense));
  const upto = isCur ? +t.slice(8) : o.series.length;
  const budget = o.series.every((p) => p.budget_line != null) ? o.series.map((p) => num(p.budget_line!)) : null;
  const chartCard = `<div class="card sp-8"><div class="ch"><h2 class="h2">${mm}每日支出</h2><span class="eyebrow">拖動查看當日數值</span></div>${dailyChart("ov", spend, upto, budget, mm)}</div>`;
  const p = o.projects[0];
  const projCard = p ? (() => {
    const bt = p.budgets.find((x) => x.currency === "TWD"); const lim = num(bt?.total ?? "0"), spent = num(p.spent.TWD ?? "0");
    const otherB = p.budgets.filter((x) => x.currency !== "TWD" && x.total).map((x) => `${fmt(p.spent[x.currency] ?? "0", x.currency)} / ${fmt(x.total!, x.currency)}`).join("、");
    const until = daysBetween(t, p.start_date);
    return `<a class="card tap sp-4" href="${href("/projects/" + p.project_id)}" style="text-decoration:none;color:var(--tx)"><div class="ch"><h2 class="h2">${ic("plane")}${p.status === "active" ? "進行中的專案" : "即將開始的專案"}</h2><span class="st neu">${p.status === "active" ? `剩 ${p.days_left} 天` : `${until} 天後出發`}</span></div>
      <b style="font-size:16px">${esc(p.name)}</b><p class="sm mu num" style="margin:2px 0 12px">${md(p.start_date)}–${md(p.end_date)} · ${p.days_total} 天</p>
      ${lim ? `<div class="between num sm" style="margin-bottom:6px"><span>已花 <b>${fmt(p.spent.TWD ?? "0")}</b></span><span class="mu">預算 ${fmt(bt?.total ?? "0")}</span></div>${pbar(spent / lim)}` : ""}
      <p class="xs mu" style="margin:8px 0 0">${p.note ? esc(p.note) + " · " : ""}剩 ${fmt(p.remaining.TWD ?? "0")}${otherB ? ` · 另有 ${otherB}（不混加）` : ""}</p></a>`;
  })() : "";
  const goalsCard = o.goals.length ? `<div class="card sp-4"><div class="ch"><h2 class="h2">${ic("target")}存錢目標</h2><a class="link" href="${href("/goals")}">全部 ${ic("chev-r", "s")}</a></div><div class="stack" style="gap:16px">${o.goals.map((g) => `<a class="card tap" style="padding:0;border:0;background:none;text-decoration:none;color:var(--tx)" href="${href("/goals/" + g.goal_id)}"><div class="between"><b style="font-weight:500">${esc(g.name)}</b>${g.is_behind ? '<span class="st warn">! 進度落後</span>' : `<span class="st ok">${ic("check", "s")}如期</span>`}</div><div class="between num xs mu" style="margin:4px 0 6px"><span>${fmt(g.current, g.currency)} / ${fmt(g.target, g.currency)}</span><span>${pct1(g.progress)}</span></div>${pbar(g.progress, g.is_behind ? "warn" : "ok", true)}<p class="xs mu" style="margin:6px 0 0">${g.deadline ? `期限 ${slash(g.deadline.slice(0, 7))} · ` : ""}預計達成 <span class="num">${g.projected_date ? slash(g.projected_date.slice(0, 7)) : "—"}</span></p></a>`).join("")}</div></div>` : "";
  const A = o.accounts;
  const accCard = `<div class="card sp-4"><div class="ch"><h2 class="h2">${ic("wallet")}帳戶摘要</h2><a class="link" href="${href("/accounts")}">帳戶總覽 ${ic("chev-r", "s")}</a></div><div class="stack" style="gap:0">
      <a href="${href("/accounts")}" class="between" style="min-height:52px;border-bottom:1px solid var(--ln);text-decoration:none;color:var(--tx)"><span>可用現金合計<br><span class="xs mu">現金、銀行、儲值卡</span></span><span class="stack" style="gap:0;text-align:right">${byCurrency(A.totals.available_cash).map((m) => `<span class="amt pos">${fmt(m.amount, m.currency)}</span>`).join("")}</span></a>
      <a href="${href("/accounts")}" class="between" style="min-height:52px;border-bottom:1px solid var(--ln);text-decoration:none;color:var(--tx)"><span>信用卡應繳合計</span><span class="stack" style="gap:0;text-align:right">${byCurrency(A.totals.credit_card_due).map((m) => `<span class="amt out">欠款 ${fmt(m.amount, m.currency)}</span>`).join("") || '<span class="amt">—</span>'}</span></a>
      ${A.investments.map((i) => `<div class="between" style="min-height:52px;border-bottom:1px solid var(--ln)"><span>${esc(i.name)}<br><a class="link" href="${esc(i.link)}" data-a="stocks">到股票區 ${ic("ext", "s")}</a>${i.is_stale ? ' <span class="st warn">! 未更新</span>' : ""}</span><span class="amt pos">${fmt(i.market_value.amount, i.market_value.currency)}</span></div>`).join("")}
    </div></div>`;
  const donutHTML = catDonut(o.categories, `${mm}分類占比`, monthStart(o.month), monthEnd(o.month));
  return { calendar: calendar(all), daySum, dayList, calCard, kpis, budCard, remCard, chartCard, donutHTML, projCard, goalsCard, accCard, mm };
}
function render(d: D) {
  const p = parts(d);
  return `<div class="ov">${p.calCard}<div class="ov-r"><div class="kpis two" aria-label="本月概況">${p.kpis}</div>${p.budCard}${p.remCard}</div></div>
  <div class="grid" style="margin-top:16px">${p.chartCard}<div class="sp-4">${p.donutHTML}</div>${p.projCard}${p.goalsCard}${p.accCard}</div>`;
}

registerView("overview", {
  load: () => (wide() ? loadWide() : load()),
  render: (d: D) => (wide() && "rows" in d ? renderWide(d as W) : render(d)),
  nav: "",
  title: () => (wide() ? "概覽" : "每日明細"),
  header: () => wide() ? overviewWideHeader() : `<div class="grow ctr"><button class="ibtn bare" data-a="cal-prev" aria-label="上個月">${ic("chev-l", "s")}</button><h1 class="ttl num">${slash(ui.cal.sel)}</h1><button class="ibtn bare" data-a="cal-next" aria-label="下個月">${ic("chev-r", "s")}</button>${ui.cal.sel !== today() ? `<button class="chip today-chip" data-a="cal-today" aria-label="回到今天（${slash(today())}）">今天</button>` : ""}</div><button class="ibtn round" data-a="search" aria-label="搜尋交易">${ic("search")}</button>`,
});

function calMove(k: number) {
  const m = addMonths(ui.cal.month, k); ui.cal.month = m;
  ui.cal.sel = m === monthOf(today()) ? today() : monthEnd(m);
  ui.donut = null; reload();
}
actions({
  "cal-pick"(el) { const d = el.dataset.d!; ui.cal.sel = d; if (monthOf(d) !== ui.cal.month) { ui.cal.month = monthOf(d); reload(); } else rerender(); },
  "cal-prev"() { calMove(-1); }, "cal-next"() { calMove(1); },
  // 標題列的「今天」chip：只在選到的日期不是今天時出現（issue #9）
  "cal-today"() { const m = monthOf(today()); ui.cal.sel = today(); if (ui.cal.month !== m) { ui.cal.month = m; reload(); } else rerender(); },
  "cal-col"() { ui.cal.col = !ui.cal.col; rerender(); },
  search() { navigate("/transactions"); setTimeout(() => (document.getElementById("q") as HTMLInputElement | null)?.focus(), 400); },
  "add-on"(el) { openEntry({ prefill: { date: el.dataset.d! } }); },
  "kpi-inc"() { navigate(`/transactions?from=${monthStart(ui.cal.month)}&to=${monthEnd(ui.cal.month)}&types=income`); },
  "kpi-exp"() { navigate(`/transactions?from=${monthStart(ui.cal.month)}&to=${monthEnd(ui.cal.month)}&types=expense`); },
  "kpi-net"() { navigate(`/transactions?from=${monthStart(ui.cal.month)}&to=${monthEnd(ui.cal.month)}`); },
  "kpi-rate"() { navigate(`/reports/monthly?month=${ui.cal.month}`); },
  seg(el) { ui.donut = el.dataset.k!; rerender(); },
  "donut-back"() { ui.donut = null; rerender(); },
  "gotx-cat"(el) { const r = (document.querySelector("[data-range]") as HTMLElement | null)?.dataset.range?.split("|") ?? []; navigate(`/transactions?categories=${encodeURIComponent(el.dataset.k!)}${r[0] ? `&from=${r[0]}&to=${r[1]}` : ""}`); },
  async "occ-ok"(el) {
    try { const r = await api.confirmOccurrence(el.dataset.id!, el.dataset.d!); toast(`已入帳 ${esc(r.transaction.merchant ?? "")} ${fmt(r.transaction.amount.amount, r.transaction.amount.currency)}`, async () => { try { await api.deleteTransaction(r.transaction.id, r.transaction.version, "復原週期入帳"); reload(); } catch (e) { handleError(e); } }); reload(); }
    catch (e) { handleError(e); }
  },
  async "occ-skip"(el) { try { await api.skipOccurrence(el.dataset.id!, el.dataset.d!); toast("已略過這一期"); reload(); } catch (e) { handleError(e); } },
});

/* ================================================================ 平板／桌面「概覽」（issue #12，≥ 960px） */
type W = D & { from: L.ISODate; to: L.ISODate; rows: L.Transaction[]; cur: L.TransactionsSummary; prev: L.TransactionsSummary; rec: L.RecurringResponse | null };
const ovTo = () => ui.ovr.to || today();
const ovFrom = () => addDays(ovTo(), -(ui.ovr.days - 1));
async function allTx(q: L.TransactionsQuery) {
  const rows: L.Transaction[] = []; let cursor: string | undefined;
  for (let i = 0; i < 15; i++) { const p = await api.transactions({ ...q, limit: 200, cursor }); rows.push(...p.rows); cursor = p.next_cursor ?? undefined; if (!cursor) break; }
  return rows;
}
async function loadWide(): Promise<W> {
  const to = ovTo(), from = ovFrom(), pTo = addDays(from, -1), pFrom = addDays(pTo, -(ui.ovr.days - 1));
  const [base, rows, cur, prev, rec] = await Promise.all([
    load(), allTx({ from, to, types: ["expense", "income"] }),
    api.transactions({ from, to, limit: 1 }).then((r) => r.summary), api.transactions({ from: pFrom, to: pTo, limit: 1 }).then((r) => r.summary),
    api.recurring().catch(() => null),
  ]);
  return { ...base, from, to, rows, cur, prev, rec };
}
/** KPI 卡：大數字＋和上一個同長度區間比較（箭頭、百分比、差額；不只靠顏色） */
function kpiW(label: string, cur: string, prev: string, kind: "net" | "exp" | "inc") {
  const d = deltaOf(cur, prev), up = sign(d.change) > 0, flat = sign(d.change) === 0;
  const good = kind === "exp" ? !up : up;
  const big = kind === "exp" ? `${MINUS}${fmt(cur)}` : fmtSigned(cur);
  const cls = kind === "exp" ? "out" : kind === "inc" ? "inc" : sign(cur) >= 0 ? "pos" : "out";
  const txt = d.ratio == null ? "上期為 0" : `${up ? "▲" : flat ? "＝" : "▼"} ${Math.abs(d.ratio * 100).toFixed(2)}%`;
  return `<div class="kw"><span class="kw-l">${label}</span><span class="kw-v amt ${cls}">${big}</span>
    <span class="kw-d ${flat ? "flat" : good ? "good" : "bad"}" aria-label="和上一期相比 ${up ? "增加" : flat ? "持平" : "減少"} ${fmt(abs(d.change))}${d.ratio == null ? "" : "，" + Math.abs(d.ratio * 100).toFixed(2) + "%"}">${txt}<span class="num">（${fmtSigned(d.change).replace("NT$ ", "")}）</span></span></div>`;
}
/** 組合圖：收入／支出柱（左軸）＋累積淨額折線與面積（右軸）。點欄位選日期，並同步右側月曆 */
function comboW(bs: Bucket[], selKey: string | null) {
  const W0 = 900, H = 260, L0 = 46, R0 = 52, Tp = 14, B0 = 26, iw = W0 - L0 - R0, ih = H - Tp - B0, n = bs.length || 1, bw = iw / n;
  const inc = bs.map((b) => num(b.inc)), exp = bs.map((b) => num(b.exp)), cum = bs.map((b) => num(b.cum));
  // 刻度取整：每格是「好看」的數字（1、2、2.5、5 × 10ⁿ）
  const bStep = niceMax(Math.max(...inc, ...exp, 1) / 4), bm = bStep * 4;
  const cMin = Math.min(0, ...cum), cMax = Math.max(0, ...cum);
  // 右軸固定 4 格（和左軸共用格線）：每格放大到能涵蓋最小～最大值為止
  let lStep = niceMax(Math.max(cMax - cMin, 1) / 4), lo = Math.floor(cMin / lStep) * lStep;
  while (lo + lStep * 4 < cMax) { lStep = niceMax(lStep * 1.01); lo = Math.floor(cMin / lStep) * lStep; }
  const hi = lo + lStep * 4;
  const yb = (v: number) => Tp + ih * (1 - v / bm), yl = (v: number) => Tp + ih * (1 - (v - lo) / (hi - lo));
  let s = "";
  for (let i = 0; i <= 4; i++) { const yy = Tp + ih * i / 4; s += `<line class="g" x1="${L0}" x2="${W0 - R0}" y1="${yy}" y2="${yy}"/><text class="ax" x="${L0 - 6}" y="${yy + 3.5}" text-anchor="end">${short(bm * (1 - i / 4))}</text><text class="ax" x="${W0 - R0 + 6}" y="${yy + 3.5}">${short(Math.round(hi - (hi - lo) * i / 4))}</text>`; }
  const si = bs.findIndex((b) => b.key === selKey);
  if (si >= 0) s += `<rect class="sel-col" x="${(L0 + si * bw).toFixed(1)}" y="${Tp}" width="${bw.toFixed(1)}" height="${ih}" rx="3"/>`;
  const pts = cum.map((v, i) => [L0 + (i + 0.5) * bw, yl(v)]);
  if (pts.length) s += `<path class="lnf" d="M${pts[0][0].toFixed(1)},${(Tp + ih).toFixed(1)} ${pts.map((p) => "L" + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")} L${pts[n - 1][0].toFixed(1)},${(Tp + ih).toFixed(1)}Z"/>`;
  const step = Math.max(1, Math.ceil(n / 15));
  bs.forEach((b, i) => {
    const x = L0 + i * bw, w = Math.max(2, Math.min(14, bw * 0.3));
    s += `<rect class="bar out" x="${(x + bw / 2 - w - 1).toFixed(1)}" y="${yb(exp[i]).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(exp[i] ? 1 : 0, Tp + ih - yb(exp[i])).toFixed(1)}" rx="1.5"/>`;
    s += `<rect class="bar inc" x="${(x + bw / 2 + 1).toFixed(1)}" y="${yb(inc[i]).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(inc[i] ? 1 : 0, Tp + ih - yb(inc[i])).toFixed(1)}" rx="1.5"/>`;
    if (i % step === 0 || i === n - 1) s += `<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" ${i === si ? 'style="fill:var(--tx);font-weight:700"' : ""}>${esc(bucketLabel(b))}</text>`;
  });
  if (pts.length) s += `<polyline class="line" points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/>${si >= 0 ? `<circle class="dot" cx="${pts[si][0].toFixed(1)}" cy="${pts[si][1].toFixed(1)}" r="4.5"/>` : ""}`;
  // 透明的點擊區（每一欄一個），hover 時在圖例顯示數值
  s += bs.map((b, i) => `<rect class="hit" x="${(L0 + i * bw).toFixed(1)}" y="${Tp}" width="${bw.toFixed(1)}" height="${ih}" data-a="ov-day" data-d="${b.from}" data-i="${i}"><title>${esc(bucketTitle(b))}</title></rect>`).join("");
  return `<div class="chart ov-chart"><svg viewBox="0 0 ${W0} ${H}" role="img" aria-label="每${{ day: "日", week: "週", month: "月" }[ui.ovr.gran]}收入與支出（左軸）、累積餘額（右軸）">${s}</svg></div>`;
}
const bucketLabel = (b: Bucket) => (ui.ovr.gran === "month" ? `${+b.key.slice(5, 7)}月` : `${+b.from.slice(5, 7)}/${+b.from.slice(8)}`);
const bucketTitle = (b: Bucket) => `${b.from === b.to ? `${slash(b.from)}（${wd(b.from)}）` : `${md(b.from)}–${md(b.to)}`} 收入 +${fmt(b.inc)} · 支出 ${MINUS}${fmt(b.exp)} · 累積 ${fmtSigned(b.cum)}`;

/** 即將到來：未來的週期交易（GET /recurring 的 upcoming） */
function upcomingCard(rec: L.RecurringResponse | null) {
  const t = today();
  if (!rec) return `<section class="ovw-sec"><div class="ch"><h2 class="h2">即將到來</h2></div><p class="sm mu">無法載入週期交易。</p></section>`;
  const rules = new Map(rec.rules.map((r) => [r.rule_id, r]));
  const list = rec.upcoming.filter((o) => o.status === "pending" && o.due_date >= t).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8);
  const sgn = (o: L.Occurrence) => (rules.get(o.rule_id)?.template.type === "income" ? o.amount.amount : "-" + o.amount.amount);
  const tot: Record<string, string> = {};
  list.forEach((o) => (tot[o.amount.currency] = add(tot[o.amount.currency] ?? "0", sgn(o))));
  const rows = list.map((o) => {
    const r = rules.get(o.rule_id), inc = r?.template.type === "income", cat = r?.template.category_key ?? null;
    const pi = r ? periodInfo(r, o.due_date) : { index: null, remaining: null };
    const dd = daysBetween(t, o.due_date);
    const when = dd === 0 ? "今天" : dd === 1 ? "明天" : `${dd} 天後`;
    return `<a class="up-row" href="${href("/settings/recurring")}"><span class="cat-ic" style="--cc:${catColor(cat)}">${ic(catIconName(cat))}</span><span class="tx-m"><span class="tx-t"><span>${esc(o.rule_name)}</span></span><span class="tx-s">週期 ${pi.index ? "#" + pi.index : "—"} / ${pi.remaining != null ? `剩 ${pi.remaining} 期` : "無限期"}</span></span><span class="up-r"><span class="amt ${inc ? "inc" : "out"}">${inc ? "+" : MINUS}${fmt(o.amount.amount, o.amount.currency)}</span><span class="xs mu">${when}</span></span></a>`;
  }).join("");
  const sum = byCurrency(tot).map((m) => fmtSigned(m.amount, m.currency)).join("、");
  return `<section class="ovw-sec"><div class="ch"><h2 class="h2">即將到來 <span class="cnt" aria-label="${list.length} 筆">${list.length}</span></h2>${list.length ? `<span class="sm mu num">合計 ${sum}</span>` : ""}</div>
    ${list.length ? `<div class="up-list">${rows}</div>` : `<div class="ovw-empty">${ic("repeat")}<p>沒有即將到來的週期交易</p></div>`}</section>`;
}
function notifyCard(alerts: L.Alert[]) {
  return `<section class="ovw-sec"><div class="ch"><h2 class="h2">通知中心${alerts.length ? ` <span class="cnt">${alerts.length}</span>` : ""}</h2></div>
    ${alerts.length ? remindList(alerts) : `<div class="ovw-empty"><img src="${LOGO}" alt="" width="56" height="56"><p>目前沒有提醒事項</p></div>`}</section>`;
}
function renderWide(d: W) {
  const p = parts(d), t = today();
  const all = [...pendingAsTx(app.queue), ...d.rows];
  const bs = buckets(dailyTotals(all, d.from, d.to), ui.ovr.gran);
  const sel = ui.cal.sel;
  const sb = bs.find((b) => sel >= b.from && sel <= b.to) ?? null;
  const net = sub(twd(d.cur.income), twd(d.cur.expense)), pnet = sub(twd(d.prev.income), twd(d.prev.expense));
  const others = byCurrency(d.cur.net).filter((m) => m.currency !== "TWD");
  const kpis = `<div class="kws">${kpiW("餘額", net, pnet, "net")}${kpiW("支出", twd(d.cur.expense), twd(d.prev.expense), "exp")}${kpiW("收入", twd(d.cur.income), twd(d.prev.income), "inc")}</div>
    ${others.length ? `<p class="xs mu" style="margin:6px 0 0">另有 ${others.map((m) => fmtSigned(m.amount, m.currency)).join("、")}（不同幣別不併入）</p>` : ""}`;
  const legend = `<div class="ov-leg"><span class="row sm"><span class="led" style="background:var(--ac)"></span><span id="ov-read"><b class="num">${slash(sel)} 週${wd(sel)}</b>${sel === t ? ' <span class="st neu">今天</span>' : ""}</span></span>
    <span class="row sm"><span class="led" style="background:var(--ac)"></span>${sb ? `餘額 <b class="amt ${sign(sb.cum) >= 0 ? "pos" : "out"}">${fmtSigned(sb.cum)}</b>` : `<span class="mu">選中的日期不在這個區間</span>`}</span>
    <span class="grow"></span><label class="vh" for="ov-gran">圖表粒度</label><select id="ov-gran" class="in sm ov-gran">${(["day", "week", "month"] as const).map((g) => `<option value="${g}" ${ui.ovr.gran === g ? "selected" : ""}>按${{ day: "日", week: "週", month: "月" }[g]}</option>`).join("")}</select></div>
    <div class="legend"><span><i class="sw-bar" style="background:var(--exp)"></i>支出（左軸）</span><span><i class="sw-bar" style="background:var(--inc)"></i>收入（左軸）</span><span><i class="sw-line" style="border-color:var(--ac)"></i>累積餘額（右軸）</span></div>`;
  const main = `<div class="ovw-main">${kpis}<section class="ovw-chart">${comboW(bs, sb?.key ?? null)}${legend}</section>
    <div class="ovw-two">${notifyCard(d.o.alerts)}${upcomingCard(d.rec)}</div>
    <h2 class="h2 ovw-more">本月詳情 · ${p.mm}</h2>
    <div class="ov-r"><div class="kpis two" aria-label="本月概況">${p.kpis}</div>${p.budCard}</div>
    <div class="grid" style="margin-top:16px">${p.chartCard}<div class="sp-4">${p.donutHTML}</div>${p.projCard}${p.goalsCard}${p.accCard}</div></div>`;
  const side = `<aside class="ovw-side ${ui.ovr.sideOpen ? "" : "closed"}" aria-label="月曆與當日明細" tabindex="0">
    <div class="ovw-side-h"><button class="ibtn bare only-mid" data-a="ov-side" aria-expanded="${ui.ovr.sideOpen}" aria-label="${ui.ovr.sideOpen ? "收合月曆" : "展開月曆"}">${ic(ui.ovr.sideOpen ? "chev-d" : "chev-r", "s")}</button>
      <button class="ibtn bare" data-a="cal-prev" aria-label="上個月">${ic("chev-l", "s")}</button><b class="num ovw-date">${slash(sel)}</b><button class="ibtn bare" data-a="cal-next" aria-label="下個月">${ic("chev-r", "s")}</button>
      <span class="grow"></span>${sel !== t ? `<button class="chip today-chip" data-a="cal-today" aria-label="回到今天">今天</button>` : ""}
      <label class="ibtn round ovw-mpick" aria-label="選擇年月" title="選擇年月">${ic("cal")}<input type="month" id="ov-month" value="${ui.cal.month}" aria-label="選擇年月"></label></div>
    <div class="ovw-side-b">${p.calendar}${p.daySum}${p.dayList}</div></aside>`;
  return `<div class="ovw">${main}${side}</div>`;
}
const LOGO = new URL("../assets/logo-96.png", import.meta.url).href;
export const overviewWideHeader = () => `<div class="grow ovw-hd"><h1 class="ttl">概覽</h1><div class="rng"><button class="ibtn bare" data-a="ovr-prev" aria-label="上一個區間">${ic("chev-l", "s")}</button><span class="num">${slash(ovFrom())} – ${slash(ovTo())}</span><button class="ibtn bare" data-a="ovr-next" aria-label="下一個區間" ${ovTo() >= today() ? "disabled" : ""}>${ic("chev-r", "s")}</button></div></div>`;

actions({
  "ovr-prev"() { ui.ovr.to = addDays(ovTo(), -ui.ovr.days); reload(); },
  "ovr-next"() { const n = addDays(ovTo(), ui.ovr.days); ui.ovr.to = n >= today() ? "" : n; reload(); },
  "ov-day"(el) { const d = el.dataset.d!; ui.cal.sel = d; if (monthOf(d) !== ui.cal.month) { ui.cal.month = monthOf(d); reload(); } else rerender(); },
  "ov-side"() { ui.ovr.sideOpen = !ui.ovr.sideOpen; rerender(); },
});
document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "ov-gran") { ui.ovr.gran = t.value as typeof ui.ovr.gran; rerender(); }
  if (t.id === "ov-month" && /^\d{4}-\d{2}$/.test(t.value)) { ui.cal.month = t.value; ui.cal.sel = t.value === monthOf(today()) ? today() : monthStart(t.value); reload(); }
});
// 圖表 hover：在圖例顯示該欄數值（不重畫）
document.addEventListener("mouseover", (e) => {
  const r = (e.target as Element).closest?.(".ov-chart .hit") as SVGRectElement | null; const out = document.getElementById("ov-read");
  if (!r || !out) return;
  out.textContent = r.querySelector("title")?.textContent ?? "";
});
