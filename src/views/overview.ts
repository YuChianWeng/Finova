/** 第二頁：每日明細＋本月總覽（/finance）。資料來自 /overview 與該月的 /transactions。 */
import type * as L from "../types/ledger";
import { esc, ic } from "../lib/dom";
import { fmt, fmtSigned, MINUS, num, pct1, twd, byCurrency, sign, sub, cmp, sumByCurrency } from "../lib/money";
import { today, addDays, daysBetween, dow, wd, md, slash, monthOf, addMonths, daysInMonth, monthStart, monthEnd } from "../lib/dates";
import { app, ui } from "../state";
import { api } from "../api/ledger";
import { registerView, actions, rerender, reload, handleError } from "../app";
import { href, navigate } from "../router";
import { txRow, pbar, stPill, fromBudget, catColor, catIconName } from "../ui/components";
import { dailyChart, donutCard, type Slice } from "../ui/charts";
import { openEntry } from "../ui/entry";
import { toast } from "../ui/overlay";
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
function alertItem(a: L.Alert): { ic: string; t: string; s: string; btn: string; ac?: boolean } {
  switch (a.type) {
    case "reconcile_due": return { ic: "scale", t: `${esc(a.account_name)} ${a.days} 天未對帳`, s: "對帳可以找出漏記或重複", btn: `<a class="btn sm" href="${href("/reconcile?account=" + encodeURIComponent(a.account_key))}">對帳</a>` };
    case "uncategorized": return { ic: "alert", t: `${a.count} 筆交易未分類`, s: "來自聊天機器人、捷徑與自動入帳", btn: `<a class="btn sm" href="${href("/transactions?categories=uncategorized")}">分類</a>` };
    case "recurring_due": { const dd = daysBetween(today(), a.due_date); return { ic: "repeat", ac: true, t: `週期交易：${esc(a.name)} ${dd === 0 ? "今天" : dd === 1 ? "明天" : dd < 0 ? `已過期 ${-dd} 天` : `${dd} 天後`}到期`, s: `${md(a.due_date)} · ${fmt(a.amount.amount, a.amount.currency)}`, btn: `<span class="row" style="gap:6px"><button class="btn sm g" data-a="occ-skip" data-id="${a.rule_id}" data-d="${a.due_date}">略過</button><button class="btn sm" data-a="occ-ok" data-id="${a.rule_id}" data-d="${a.due_date}">確認入帳</button></span>` }; }
    case "budget_warning": case "budget_over": return { ic: "target", t: `${esc(a.name)} 預算${a.type === "budget_over" ? "已超支" : "快用完"}（${Math.round(a.ratio * 100)}%）`, s: "看看各分類的花費", btn: `<a class="btn sm" href="${href("/budgets")}">查看</a>` };
    case "goal_behind": return { ic: "target", t: `存錢目標「${esc(a.name)}」進度落後`, s: "照目前速度會晚於期限達成", btn: `<a class="btn sm" href="${href("/goals/" + a.goal_id)}">查看</a>` };
    case "card_due": { const dd = daysBetween(today(), a.due_date); return { ic: "card", t: `${esc(a.name)} 帳單 ${dd >= 0 ? `${dd} 天後` : "已"}到期`, s: `${md(a.due_date)} · ${fmt(a.amount.amount, a.amount.currency)}`, btn: `<button class="btn sm" data-a="pay" data-id="${esc(a.account_key)}" data-amt="${a.amount.amount}">繳卡費</button>` }; }
    case "opening_missing": return { ic: "wallet", t: `${a.count} 個帳戶還沒設定期初餘額`, s: "設定後才能計算餘額與對帳", btn: `<a class="btn sm" href="${href("/settings/accounts/opening")}">設定</a>` };
    case "data_notice": return { ic: "alert", t: esc(a.message), s: "", btn: "" };
  }
}
export function remindCard(alerts: L.Alert[]) {
  const items = alerts.map(alertItem);
  return `<div class="card" id="remind"><div class="ch"><h2 class="h2">${ic("bell")}待處理</h2><span class="eyebrow">${items.length} 項</span></div>${items.length ? items.map((r) => `<div class="remind"><span class="ri ${r.ac ? "ac" : ""}">${ic(r.ic, "s")}</span><div style="flex:1;min-width:0"><div style="font-weight:500">${r.t}</div>${r.s ? `<div class="xs mu">${r.s}</div>` : ""}</div>${r.btn}</div>`).join("") : `<p class="mu sm">${ic("check", "s")} 都處理完了</p>`}</div>`;
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

function render(d: D) {
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
  return `<div class="ov">${calCard}<div class="ov-r"><div class="kpis two" aria-label="本月概況">${kpis}</div>${budCard}${remCard}</div></div>
  <div class="grid" style="margin-top:16px">${chartCard}<div class="sp-4">${catDonut(o.categories, `${mm}分類占比`, monthStart(o.month), monthEnd(o.month))}</div>${projCard}${goalsCard}${accCard}</div>`;
}

registerView("overview", {
  load, render, nav: "",
  title: () => "每日明細",
  header: () => `<div class="grow ctr"><button class="ibtn bare" data-a="cal-prev" aria-label="上個月">${ic("chev-l", "s")}</button><h1 class="ttl num">${slash(ui.cal.sel)}</h1><button class="ibtn bare" data-a="cal-next" aria-label="下個月">${ic("chev-r", "s")}</button></div><button class="ibtn round" data-a="cal-today" aria-label="回到今天">${ic("cal")}</button><button class="ibtn round" data-a="search" aria-label="搜尋交易">${ic("search")}</button>`,
});

function calMove(k: number) {
  const m = addMonths(ui.cal.month, k); ui.cal.month = m;
  ui.cal.sel = m === monthOf(today()) ? today() : monthEnd(m);
  ui.donut = null; reload();
}
actions({
  "cal-pick"(el) { const d = el.dataset.d!; ui.cal.sel = d; if (monthOf(d) !== ui.cal.month) { ui.cal.month = monthOf(d); reload(); } else rerender(); },
  "cal-prev"() { calMove(-1); }, "cal-next"() { calMove(1); },
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
