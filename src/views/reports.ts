/** 報表（/finance/reports/daily|weekly|monthly|range|trend）。 */
import type * as L from "../types/ledger";
import { esc, ic } from "../lib/dom";
import { fmt, MINUS, num, pct1, twd, byCurrency, add, sub, sign, abs, div, mulDiv } from "../lib/money";
import { today, addDays, md, wd, isoWeek, weekToStart, monthOf, addMonths, monthStart, monthEnd, monthLabel, slash } from "../lib/dates";
import { app, ui } from "../state";
import { api } from "../api/ledger";
import { registerView, actions, rerender, reload, currentRoute } from "../app";
import { navigate, withQuery, href, type Route } from "../router";
import { txRow, emptyState, pbar, stPill, fromBudget, catColor } from "../ui/components";
import { dailyChart, barsChart, lineChart, monthBars, stackedBars } from "../ui/charts";
import { kpiCards, catDonut } from "./overview";

type Mode = "daily" | "weekly" | "monthly" | "range" | "trend";
type D = { mode: Mode; label: string; daily?: L.DailyReport; weekly?: L.WeeklyReport; monthly?: L.MonthlyReport; range?: L.RangeReport; trend?: L.TrendReport; trendTop?: L.TrendReport | null; key: string };

function params(r: Route) {
  const mode = (r.params.mode as Mode) || "monthly";
  const t = today(), q = r.query;
  return { mode, date: q.get("date") ?? t, week: q.get("week") ?? isoWeek(t), month: q.get("month") ?? monthOf(t),
    from: q.get("from") ?? `${t.slice(0, 4)}-01-01`, to: q.get("to") ?? `${t.slice(0, 4)}-12-31`, category: q.get("category"), merchant: q.get("merchant"), granularity: (q.get("granularity") as L.Granularity) ?? "month" };
}
async function load(r: Route): Promise<D> {
  const p = params(r), o = { exclude_projects: ui.rp.ex, compare: ui.rp.cmp };
  switch (p.mode) {
    case "daily": return { mode: p.mode, key: p.date, label: `${md(p.date)}（${wd(p.date)}）`, daily: await api.daily(p.date) };
    case "weekly": { const s = weekToStart(p.week); return { mode: p.mode, key: p.week, label: `${md(s)} – ${md(addDays(s, 6))}`, weekly: await api.weekly(p.week, o) }; }
    case "range": {
      const range = await api.range(p.from, p.to, o);
      const top = range.stacked.reduce<Record<string, number>>((a, s) => { Object.entries(s.by_category).forEach(([k, v]) => (a[k] = (a[k] ?? 0) + num(v))); return a; }, {});
      const k = Object.entries(top).sort((a, b) => b[1] - a[1])[0]?.[0];
      return { mode: p.mode, key: `${p.from}|${p.to}`, label: p.from.slice(0, 4) === p.to.slice(0, 4) && p.from.endsWith("01-01") && p.to.endsWith("12-31") ? `${p.from.slice(0, 4)} 年` : `${slash(p.from)} – ${slash(p.to)}`, range,
        trendTop: k ? await api.trend({ category: k, from: p.from, to: p.to, granularity: "month" }) : null };
    }
    case "trend": {
      const cat = p.category ?? (p.merchant ? undefined : "food");
      const from = r.query.get("from") ?? `${addMonths(monthOf(today()), -11)}-01`, to = r.query.get("to") ?? today();
      return { mode: p.mode, key: cat ?? p.merchant ?? "", label: `${slash(from)} – ${slash(to)}`, trend: await api.trend({ category: cat, merchant: p.merchant ?? undefined, from, to, granularity: p.granularity }) };
    }
    default: return { mode: "monthly", key: p.month, label: monthLabel(p.month), monthly: await api.monthly(p.month, o) };
  }
}
function step(d: D, k: -1 | 1): string | null {
  const t = today();
  switch (d.mode) {
    case "daily": { const n = addDays(d.key, k); return n > t ? null : withQuery("/reports/daily", { date: n }); }
    case "weekly": { const n = isoWeek(addDays(weekToStart(d.key), 7 * k)); return weekToStart(n) > t ? null : withQuery("/reports/weekly", { week: n }); }
    case "monthly": { const n = addMonths(d.key, k); return n > monthOf(t) ? null : withQuery("/reports/monthly", { month: n }); }
    case "range": { const [f, to] = d.key.split("|"); const y = +f.slice(0, 4) + k; return String(y) > t.slice(0, 4) ? null : withQuery("/reports/range", { from: `${y}${f.slice(4)}`, to: `${y}${to.slice(4)}` }); }
    default: return null;
  }
}
function hbars(rows: { k: string; label: string; v: number; prev?: number; amt: string; prevAmt?: string; c: string; href: string }[], cmp: boolean, prevLabel = "") {
  const mx = Math.max(1, ...rows.map((r) => Math.max(r.v, r.prev ?? 0)));
  return `<div class="hbars">${rows.map((r) => { const d = sub(r.amt, r.prevAmt ?? "0"); return `<a class="hb" href="${r.href}" style="text-decoration:none;color:var(--tx)"><span class="hb-n">${esc(r.label)}</span><span class="hb-t"><i style="width:${r.v / mx * 100}%;background:${r.c}"></i>${cmp && r.prev != null ? `<i class="prev" style="width:${r.prev / mx * 100}%"></i>` : ""}</span><span class="hb-v">${fmt(r.amt)}${cmp && r.prev != null ? `<br><span class="mu">${sign(d) > 0 ? "▲" : sign(d) < 0 ? "▼" : "＝"} ${fmt(abs(d))}</span>` : ""}</span></a>`; }).join("")}</div>${prevLabel}`;
}
function render(d: D) {
  const prev = step(d, -1), next = step(d, 1);
  const head = `<div class="card" style="margin-bottom:16px;padding:12px"><div class="between" style="flex-wrap:wrap">
    <div class="seg" role="group" aria-label="報表期間">${([["daily", "日"], ["weekly", "週"], ["monthly", "月"], ["range", "年"], ["trend", "趨勢"]] as const).map(([k, l]) => `<a href="${href("/reports/" + k)}" role="button" aria-pressed="${d.mode === k}">${l}</a>`).join("")}</div>
    ${d.mode !== "trend" ? `<div class="row"><button class="ibtn" data-a="rp-go" data-to="${prev ?? ""}" aria-label="上一期" ${prev ? "" : "disabled"}>${ic("chev-l")}</button><b class="num" style="min-width:150px;text-align:center">${esc(d.label)}</b><button class="ibtn" data-a="rp-go" data-to="${next ?? ""}" aria-label="下一期" ${next ? "" : "disabled"}>${ic("chev-r")}</button></div>` : `<b class="num">${esc(d.label)}</b>`}
    <div class="row" style="flex-wrap:wrap">${d.mode !== "daily" && d.mode !== "trend" ? `<button class="chip" data-a="rp-cmp" aria-pressed="${ui.rp.cmp}">${ic("check", "s ck-i")}和上一期比較</button><button class="chip" data-a="rp-ex" aria-pressed="${ui.rp.ex}">${ic("check", "s ck-i")}排除專案支出</button>` : ""}</div>
  </div></div>`;
  return head + (d.daily ? daily(d.daily) : d.weekly ? weekly(d.weekly) : d.monthly ? monthly(d.monthly) : d.range ? range(d.range, d.trendTop ?? null) : trend(d.trend!));
}
function daily(r: L.DailyReport) {
  const ex = num(twd(r.kpi.expense)), avg = num(r.daily_average_expense), dd = avg ? (ex - avg) / avg : 0;
  const mx = Math.max(1, ...r.categories.map((c) => num(c.amount)));
  return `<div class="grid"><div class="card sp-4"><p class="eyebrow">當日支出</p><div class="huge amt">${MINUS}${fmt(twd(r.kpi.expense))}</div>${byCurrency(r.kpi.expense).filter((m) => m.currency !== "TWD").map((m) => `<p class="xs mu" style="margin:2px 0 0">另有 ${fmt(m.amount, m.currency)}</p>`).join("")}
      <p class="row sm" style="margin:10px 0 0">${avg ? `<span class="delta ${dd > 0 ? "bad" : "good"}">${dd > 0 ? "▲" : "▼"} ${Math.abs(dd * 100).toFixed(0)}%</span>` : ""}<span class="mu">近 30 天日平均 ${fmt(r.daily_average_expense)}</span></p>
      <p class="eyebrow" style="margin:18px 0 10px">分類分布</p><div class="hbars">${r.categories.map((c) => `<a class="hb" href="${href(`/transactions?categories=${c.category_key}&from=${r.date}&to=${r.date}`)}" style="text-decoration:none;color:var(--tx)"><span class="hb-n">${esc(c.name)}</span><span class="hb-t"><i style="width:${num(c.amount) / mx * 100}%;background:${catColor(c.category_key, c.icon)}"></i></span><span class="hb-v">${fmt(c.amount)}</span></a>`).join("") || '<p class="sm mu">沒有支出</p>'}</div></div>
    <div class="card sp-8"><div class="ch"><h2 class="h2">當日每筆交易</h2><span class="eyebrow">${r.transactions.length} 筆</span></div>${r.transactions.length ? `<div class="list plain">${r.transactions.map((t) => txRow(t)).join("")}</div>` : emptyState("這天沒有紀錄", "沒有任何收支或轉帳。", `<button class="btn" data-a="add">${ic("plus")}補記一筆</button>`)}</div></div>`;
}
function weekly(r: L.WeeklyReport) {
  const vals = r.series.map((p) => num(p.expense)), ex = num(twd(r.kpi.expense));
  const pex = r.kpi.compare ? num(r.kpi.compare.expense.previous) : 0, dd = pex ? (ex - pex) / pex : 0;
  const mbS = r.budget?.total?.limit ?? "0", wbS = mulDiv(mbS, 7, 30, 0), wb = num(wbS), exS = twd(r.kpi.expense);
  return `<div class="grid"><div class="card sp-8"><div class="ch"><h2 class="h2">每日支出 · 週一到週日</h2><span class="num sm">${MINUS}${fmt(exS)}</span></div>${barsChart(vals, r.series.map((p) => wd(p.date) + " " + p.date.slice(8)), { label: "本週每日支出" })}
      ${ui.rp.cmp && r.kpi.compare ? `<p class="row sm" style="margin:8px 0 0">${pex ? `<span class="delta ${dd > 0 ? "bad" : "good"}">${dd > 0 ? "▲" : "▼"} ${Math.abs(dd * 100).toFixed(0)}%</span>` : ""}<span class="mu">上週 ${fmt(r.kpi.compare.expense.previous)}</span></p>` : ""}</div>
    <div class="card sp-4"><div class="ch"><h2 class="h2">本週預算消耗</h2></div>${wb ? `<div class="big">${fmt(exS)}<span class="sm mu"> / ${fmt(wbS)}</span></div><div style="margin:10px 0">${pbar(ex / wb)}</div><p class="xs mu" style="margin:0">週預算＝月預算 ${fmt(mbS)} × 7 ÷ 30</p>` : '<p class="sm mu">沒有設定月預算</p>'}
      <p class="eyebrow" style="margin:18px 0 8px">最大的 3 筆支出</p>${r.top_expenses.length ? `<div class="list plain">${r.top_expenses.map((t) => txRow(t, { showDate: true })).join("")}</div>` : '<p class="sm mu">本週還沒有支出</p>'}</div>
    <div class="sp-6">${catDonut(r.categories, "本週分類", r.start, r.end)}</div></div>`;
}
function monthly(r: L.MonthlyReport) {
  const m = r.month, isCur = m === monthOf(today()), upto = isCur ? +today().slice(8) : r.series.length;
  const spend = r.series.map((p) => num(p.expense));
  const budget = r.series.every((p) => p.budget_line != null) ? r.series.map((p) => num(p.budget_line!)) : null;
  const exp = num(twd(r.kpi.expense)) || 1, fixed = num(r.fixed_vs_variable.fixed), vari = num(r.fixed_vs_variable.variable);
  const cats = r.categories.map((c) => ({ k: c.category_key, label: c.name, v: num(c.amount), prev: c.compare_previous != null ? num(c.compare_previous) : undefined, amt: c.amount, prevAmt: c.compare_previous ?? undefined, c: catColor(c.category_key, c.icon), href: href(`/transactions?categories=${c.category_key}&from=${monthStart(m)}&to=${monthEnd(m)}`) }));
  const mm = Math.max(1, ...r.merchants.map((x) => num(x.amount)));
  return (r.data_notice ? `<div class="callout warn" style="margin-bottom:16px">${ic("alert")}<div>${esc(r.data_notice)}</div></div>` : "") +
    `<div class="kpis" style="margin-bottom:16px">${kpiCards(r.kpi, `${+m.slice(5)} 月`, false, isCur ? "比上月同期" : "比上月")}</div>
    <div class="grid">
      <div class="card sp-8"><div class="ch"><h2 class="h2">每日支出</h2><span class="eyebrow">拖動查看</span></div>${dailyChart("rp", spend, upto, budget, `${+m.slice(5)} 月`)}</div>
      <div class="sp-4">${catDonut(r.categories, "主分類占比", monthStart(m), monthEnd(m))}</div>
      <div class="card sp-6"><div class="ch"><h2 class="h2">各分類${ui.rp.cmp ? " vs 上月" : ""}</h2>${ui.rp.cmp ? `<span class="legend" style="margin:0"><span><i class="sw-bar"></i>本月</span><span><i class="sw-bar" style="background:var(--ln2)"></i>上月</span></span>` : ""}</div>${cats.length ? hbars(cats, ui.rp.cmp) : '<p class="sm mu">沒有支出</p>'}</div>
      <div class="card sp-6"><div class="ch"><h2 class="h2">商家前 10 名</h2></div>${r.merchants.length ? `<div class="hbars">${r.merchants.map((x, i) => `<a class="hb" href="${href(withQuery("/reports/trend", { merchant: x.merchant }))}" style="grid-template-columns:96px minmax(0,1fr) auto;text-decoration:none;color:var(--tx)"><span class="hb-n" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="num mu">${String(i + 1).padStart(2, "0")}</span> ${esc(x.merchant)}</span><span class="hb-t"><i style="width:${num(x.amount) / mm * 100}%"></i></span><span class="hb-v">${fmt(x.amount)}<br><span class="mu">${x.count} 筆</span></span></a>`).join("")}</div>` : emptyState("沒有商家資料", "這個月份沒有支出。")}</div>
      <div class="card sp-6"><div class="ch"><h2 class="h2">預算達成</h2></div>${r.budget ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>分類</th><th class="r">已用</th><th class="r">上限</th><th class="r">%</th><th>狀態</th></tr></thead><tbody>${[...(r.budget.total ? [r.budget.total] : []), ...r.budget.lines].map((b) => `<tr><td>${b.category_key ? esc(b.name) : "<b>月總預算</b>"}</td><td class="r num">${fmt(b.used)}</td><td class="r num mu">${fmt(b.limit)}</td><td class="r num">${Math.round(b.ratio * 100)}%</td><td>${stPill(fromBudget(b.status))}</td></tr>`).join("")}</tbody></table></div>` : emptyState("當時尚未設定預算", "這個月份沒有預算資料。")}</div>
      <div class="card sp-6"><div class="ch"><h2 class="h2">固定 vs 變動支出</h2></div><div class="panel-tot" style="grid-template-columns:1fr 1fr"><div><span class="eyebrow">固定（訂閱、居家、週期）</span><span class="amt">${fmt(r.fixed_vs_variable.fixed)}</span><span class="xs mu">${pct1(fixed / exp)}</span></div><div><span class="eyebrow">變動</span><span class="amt">${fmt(r.fixed_vs_variable.variable)}</span><span class="xs mu">${pct1(vari / exp)}</span></div></div>
        <p class="eyebrow" style="margin:18px 0 8px">各帳戶收支（TWD）</p>${r.accounts.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>帳戶</th><th class="r">流入</th><th class="r">流出</th></tr></thead><tbody>${r.accounts.map((a) => `<tr><td><a class="link" href="${href("/accounts/" + encodeURIComponent(a.account_key))}">${esc(a.name)}</a></td><td class="r num" style="color:var(--inc)">+${fmt(a.inflow)}</td><td class="r num">${MINUS}${fmt(a.outflow)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="sm mu">沒有帳戶資料</p>'}</div>
    </div>`;
}
function range(r: L.RangeReport, top: L.TrendReport | null) {
  const labels = r.series.map((p) => String(+p.date.slice(5, 7)));
  const keys = [...new Set(r.stacked.flatMap((s) => Object.keys(s.by_category)))];
  const totals = Object.fromEntries(keys.map((k) => [k, r.stacked.reduce((s, x) => s + num(x.by_category[k] ?? "0"), 0)]));
  keys.sort((a, b) => totals[b] - totals[a]);
  const name = (k: string) => app.catalog!.categories.find((c) => c.category_key === k)?.name ?? k;
  const stacks = keys.map((k) => ({ k, c: catColor(k), vals: r.stacked.map((s) => num(s.by_category[k] ?? "0")) }));
  const net = sub(add(...r.series.map((p) => p.income)), add(...r.series.map((p) => p.expense)));
  return `<div class="kpis" style="margin-bottom:16px">${kpiCards(r.kpi, "全期", false, "比去年同期")}</div><div class="grid">
    <div class="card sp-8"><div class="ch"><h2 class="h2">每月收入／支出</h2></div>${monthBars(labels, r.series.map((p) => num(p.income)), r.series.map((p) => num(p.expense)))}</div>
    <div class="card sp-4"><div class="ch"><h2 class="h2">統計</h2><span class="eyebrow">不含進行中的月份</span></div><div class="stack" style="gap:0">
      <div class="between" style="min-height:52px;border-bottom:1px solid var(--ln)"><span class="mu">月平均支出</span><span class="amt">${fmt(r.stats.average_expense)}</span></div>
      <div class="between" style="min-height:52px;border-bottom:1px solid var(--ln)"><span class="mu">最高月${r.stats.max_month ? ` · ${+r.stats.max_month.month.slice(5)} 月` : ""}</span><span class="amt">${r.stats.max_month ? fmt(r.stats.max_month.expense) : "—"}</span></div>
      <div class="between" style="min-height:52px;border-bottom:1px solid var(--ln)"><span class="mu">最低月${r.stats.min_month ? ` · ${+r.stats.min_month.month.slice(5)} 月` : ""}</span><span class="amt">${r.stats.min_month ? fmt(r.stats.min_month.expense) : "—"}</span></div>
      <div class="between" style="min-height:52px"><span class="mu">累計淨額</span><span class="amt ${sign(net) >= 0 ? "inc" : "out"}">${sign(net) >= 0 ? "+" : MINUS}${fmt(abs(net))}</span></div></div></div>
    <div class="card sp-8"><div class="ch"><h2 class="h2">各主分類每月組成</h2><span class="eyebrow">點圖例隱藏／顯示</span></div>${stackedBars(labels, stacks, ui.hid)}
      <div class="wrap-row" style="margin-top:10px">${keys.map((k) => `<button class="chip" style="min-height:36px" data-a="hid" data-k="${k}" aria-pressed="${!ui.hid.has(k)}"><i class="dotc" style="width:10px;height:10px;border-radius:3px;background:${catColor(k)};${ui.hid.has(k) ? "opacity:.25" : ""}"></i>${esc(name(k))}</button>`).join("")}</div></div>
    <div class="card sp-4"><div class="ch"><h2 class="h2">趨勢</h2>${top ? `<a class="link" href="${href(withQuery("/reports/trend", { category: top.target.key }))}">更多 ${ic("chev-r", "s")}</a>` : ""}</div>${top ? `<p class="sm mu" style="margin:0 0 10px">${esc(top.target.name)} · 每月</p>${lineChart(top.points.map((p) => num(p.amount)), { xl: [[0, md(top.points[0].date).slice(0, 2) + "月"], [top.points.length - 1, md(top.points[top.points.length - 1].date).slice(0, 2) + "月"]], label: top.target.name + " 趨勢" })}` : '<p class="sm mu">沒有資料</p>'}</div>
  </div>`;
}
function trend(t: L.TrendReport) {
  const c = app.catalog!;
  const vals = t.points.map((p) => num(p.amount)), tot = add(...t.points.map((p) => p.amount)), cnt = t.points.reduce((a, p) => a + p.count, 0);
  const avgStr = div(tot, t.points.length), avg = num(avgStr); // avg（number）只給圖表參考線用
  const unit = { day: "每日", week: "每週", month: "每月" }[t.granularity];
  return `<div class="grid"><div class="card sp-8"><div class="ch"><h2 class="h2">${esc(t.target.name)} · ${unit}</h2><div class="seg" role="group" aria-label="粒度">${(["day", "week", "month"] as const).map((g) => `<button data-a="tr-g" data-v="${g}" aria-pressed="${t.granularity === g}">${{ day: "日", week: "週", month: "月" }[g]}</button>`).join("")}</div></div>
      ${vals.length > 1 ? lineChart(vals, { ref: vals.map(() => avg), xl: [[0, md(t.points[0].date)], [vals.length - 1, md(t.points[vals.length - 1].date)]], label: t.target.name + " 趨勢" }) : '<p class="sm mu">資料不足</p>'}
      <div class="legend"><span><i class="sw-bar" style="height:2px"></i>${esc(t.target.name)}</span><span><i class="sw-dash" style="border-color:var(--wa)"></i>平均 ${fmt(avgStr)}</span></div></div>
    <div class="card sp-4"><div class="ch"><h2 class="h2">摘要</h2></div><div class="stack" style="gap:0">
      <div class="between" style="min-height:48px;border-bottom:1px solid var(--ln)"><span class="mu">合計</span><span class="amt">${fmt(tot)}</span></div>
      <div class="between" style="min-height:48px;border-bottom:1px solid var(--ln)"><span class="mu">${unit}平均</span><span class="amt">${fmt(avgStr)}</span></div>
      <div class="between" style="min-height:48px"><span class="mu">筆數</span><span class="num">${cnt}</span></div></div>
      <p class="eyebrow" style="margin:16px 0 8px">換一個分類</p><div class="wrap-row">${c.categories.filter((x) => x.kind === "expense" && !x.is_hidden).map((x) => `<a class="chip" href="${href(withQuery("/reports/trend", { category: x.category_key, granularity: t.granularity }))}" aria-pressed="${t.target.key === x.category_key}">${esc(x.name)}</a>`).join("")}</div>
      ${t.target.kind === "category" ? `<a class="link" style="margin-top:12px;display:inline-flex" href="${href(`/transactions?categories=${t.target.key}`)}">看明細 ${ic("chev-r", "s")}</a>` : `<a class="link" style="margin-top:12px;display:inline-flex" href="${href(withQuery("/transactions", { q: t.target.key }))}">看「${esc(t.target.name)}」的明細 ${ic("chev-r", "s")}</a>`}</div></div>`;
}
registerView("reports", { load, render, title: () => "報表", nav: "/reports/monthly" });

actions({
  "rp-go"(el) { if (el.dataset.to) navigate(el.dataset.to, { replace: true }); },
  "rp-cmp"() { ui.rp.cmp = !ui.rp.cmp; reload(); },
  "rp-ex"() { ui.rp.ex = !ui.rp.ex; reload(); },
  hid(el) { const k = el.dataset.k!; ui.hid.has(k) ? ui.hid.delete(k) : ui.hid.add(k); rerender(); },
  "tr-g"(el) { const r = currentRoute(); const q = new URLSearchParams(r.query); q.set("granularity", el.dataset.v!); navigate(`/reports/trend?${q}`, { replace: true }); },
});
