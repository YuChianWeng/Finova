/** 預算（/finance/budgets）、專案（/finance/projects[/id]）、存錢目標（/finance/goals[/id]）。 */
import type * as L from "../types/ledger";
import { $, $$, esc, ic } from "../lib/dom";
import { fmt, MINUS, num, pct1, sign, abs, curInfo, byCurrency, add, sub, cmp } from "../lib/money";
import { today, md, slash, monthOf, monthLabel, addMonths, daysInMonth, daysBetween, monthStart, monthEnd } from "../lib/dates";
import { app, ui, findCat } from "../state";
import { api } from "../api/ledger";
import { newIdempotencyKey, LedgerError } from "../api/client";
import { registerView, actions, rerender, reload, handleError, currentData } from "../app";
import { href, navigate, type Route } from "../router";
import { pbar, stPill, fromBudget, catColor, catIconName, emptyState, txRow } from "../ui/components";
import { donut, barsChart, lineChart } from "../ui/charts";
import { dialog, toast, openSheet, setSheet, sheetShell, closeSheet } from "../ui/overlay";

const tabs = (k: "month" | "proj" | "goal") => `<div class="seg full" role="group" aria-label="預算類型" style="margin-bottom:16px">${([["month", "每月預算", "/budgets"], ["proj", "專案", "/projects"], ["goal", "存錢目標", "/goals"]] as const).map(([v, l, p]) => `<a href="${href(p)}" role="button" aria-pressed="${k === v}">${l}</a>`).join("")}</div>`;

/* ------------------------------------------------------------ 每月預算 */
type BD = { b: L.BudgetSummary; m: L.MonthlyReport; month: string };
async function loadBudget(r: Route): Promise<BD> {
  const month = r.query.get("month") ?? monthOf(today());
  const [b, m] = await Promise.all([api.budgets(month), api.monthly(month, { compare: false })]);
  return { b, m, month };
}
function renderBudget(d: BD) {
  const { b, m, month } = d;
  const nav = `<div class="between" style="margin-bottom:12px"><a class="ibtn" href="${href("/budgets?month=" + addMonths(month, -1))}" aria-label="上個月">${ic("chev-l")}</a><b class="num">${monthLabel(month)}</b>${month < monthOf(today()) ? `<a class="ibtn" href="${href("/budgets?month=" + addMonths(month, 1))}" aria-label="下個月">${ic("chev-r")}</a>` : `<span style="width:44px"></span>`}</div>`;
  if (!b.lines.length && !b.total && !ui.budEdit) return tabs("month") + nav + `<div class="card">${emptyState("尚未設定預算", "可以用過去 3 個月的平均花費，一鍵建立各分類的月預算。", `<div class="row" style="justify-content:center;flex-wrap:wrap"><button class="btn p" data-a="bud-suggest">用過去 3 個月平均快速建立</button><button class="btn" data-a="bud-edit">手動設定</button></div>`)}</div>`;
  const T = b.total, isCur = month === monthOf(today());
  const totalCard = T ? `<div class="card sp-4"><div class="ch"><h2 class="h2">${monthLabel(month).slice(5)}總預算</h2>${stPill(fromBudget(T.status))}</div><div class="huge">${fmt(T.remaining)}</div><p class="sm mu" style="margin:2px 0 12px">剩餘 · 已用 ${fmt(T.used)} / ${fmt(T.limit)}（${pct1(T.ratio)}）</p>${pbar(T.ratio, fromBudget(T.status))}
      ${isCur && cmp(T.projected, T.limit) > 0 ? `<div class="callout warn" style="margin-top:14px">${ic("alert")}<div>照目前速度，月底預估支出 <b class="num">${fmt(T.projected)}</b>，會超出預算 <b class="num">${fmt(sub(T.projected, T.limit))}</b>。</div></div>` : isCur ? `<p class="xs mu" style="margin:12px 0 0">月底預估 ${fmt(T.projected)} · 剩 ${daysInMonth(month) - +today().slice(8)} 天</p>` : ""}
      ${!b.total_is_sum_of_categories ? `<p class="xs mu" style="margin:10px 0 0">總預算和分類預算加總不同，以總預算為準。</p>` : ""}</div>` : `<div class="card sp-4"><p class="sm mu">沒有設定月總預算。</p></div>`;
  const subs = (key: string | null) => m.categories.find((c) => c.category_key === key)?.children ?? [];
  let lines: string;
  if (ui.budEdit) {
    const keys = new Set(b.lines.map((l) => l.category_key));
    const addable = app.catalog!.categories.filter((c) => c.kind === "expense" && !c.is_hidden && !keys.has(c.category_key));
    lines = `<div class="between" style="min-height:64px;border-bottom:1px solid var(--ln);flex-wrap:wrap"><b>月總預算</b><label class="vh" for="lim-total">月總預算</label><input class="in num" id="lim-total" data-bk="" inputmode="numeric" value="${T ? num(T.limit) : ""}" placeholder="不設定" style="width:140px;text-align:right"></div>` +
      b.lines.map((l) => `<div class="between" style="min-height:64px;border-bottom:1px solid var(--ln);flex-wrap:wrap"><span class="row" style="min-width:90px"><span style="color:${catColor(l.category_key)}">${ic(catIconName(l.category_key))}</span>${esc(l.name)}</span><div class="row" style="flex:1;justify-content:flex-end;flex-wrap:wrap"><label class="vh" for="lim-${l.category_key}">${esc(l.name)} 上限</label><input class="in num" id="lim-${l.category_key}" data-bk="${l.category_key}" inputmode="numeric" value="${num(l.limit)}" style="width:120px;text-align:right"><label class="row xs mu" style="min-height:44px;cursor:pointer"><input type="checkbox" data-roll="${l.category_key}" ${l.rollover ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--ac)">累積到下月</label></div></div>`).join("") +
      (addable.length ? `<div class="row" style="margin-top:12px;flex-wrap:wrap"><label class="vh" for="bud-add">新增分類預算</label><select id="bud-add" class="in" style="flex:1;min-width:140px"><option value="">＋ 新增分類預算…</option>${addable.map((c) => `<option value="${c.category_key}">${esc(c.name)}</option>`).join("")}</select></div>` : "");
  } else {
    lines = b.lines.map((l) => {
      const s = fromBudget(l.status), ch = subs(l.category_key);
      return `<details style="border-bottom:1px solid var(--ln)"><summary style="list-style:none;cursor:pointer;padding:12px 0;display:flex;flex-direction:column;gap:8px"><span class="between"><span class="row"><span style="color:${catColor(l.category_key)}">${ic(catIconName(l.category_key))}</span><b style="font-weight:500">${esc(l.name)}</b>${l.rollover ? '<span class="src">累積</span>' : ""}</span><span class="row">${stPill(s)}${ic("chev-d", "s")}</span></span><span>${pbar(l.ratio, s)}</span><span class="between num xs"><span>${fmt(l.used)} / ${fmt(l.limit)}</span><span class="${s === "ok" ? "mu" : ""}" style="${s === "over" ? "color:var(--dg)" : s === "warn" ? "color:var(--wa)" : ""}">${sign(l.remaining) < 0 ? "超出 " + fmt(abs(l.remaining)) : "剩 " + fmt(l.remaining)} · ${Math.round(l.ratio * 100)}%</span></span></summary>
        <div style="padding:0 0 12px 30px">${ch.length ? ch.map((c) => `<a class="between sm" href="${href(`/transactions?categories=${c.category_key.endsWith("__none__") ? l.category_key : c.category_key}&from=${monthStart(month)}&to=${monthEnd(month)}`)}" style="min-height:40px;border-top:1px dashed var(--ln);color:var(--tx);text-decoration:none"><span>${esc(c.name)}</span><span class="num">${fmt(c.amount)}</span></a>`).join("") : '<p class="xs mu">還沒有子分類支出</p>'}${isCur ? `<p class="xs mu" style="margin:6px 0 0">照目前速度月底約 ${fmt(l.projected)}</p>` : ""}</div></details>`;
    }).join("");
  }
  return tabs("month") + nav + `<div class="grid">${totalCard}
    <div class="card sp-8"><div class="ch"><h2 class="h2">分類預算</h2>${ui.budEdit ? `<div class="row"><button class="btn sm g" data-a="bud-edit">取消</button><button class="btn sm p" data-a="bud-save">${ic("check", "s")}儲存</button></div>` : `<button class="btn sm" data-a="bud-edit">${ic("edit", "s")}編輯</button>`}</div>
    <div class="list" id="bud-lines">${lines}</div>${ui.budEdit ? `<p class="xs mu" style="margin:10px 0 0">儲存後從 ${monthLabel(month)} 起生效。「累積到下月」預設關閉；開啟後，本月沒用完的額度會加到下個月。</p>` : ""}</div></div>`;
}
registerView("budgets", { load: loadBudget, render: renderBudget, title: () => "預算", back: "/more", nav: "/budgets" });

/* ------------------------------------------------------------ 專案 */
type PD = { list: L.Project[]; p: L.ProjectDetail | null; tx: L.Transaction[] };
async function loadProjects(r: Route): Promise<PD> {
  const list = (await api.projects()).rows;
  const id = r.params.id ?? list.find((p) => p.status === "active")?.project_id ?? list.find((p) => p.status === "planned")?.project_id ?? list[0]?.project_id;
  if (!id) return { list, p: null, tx: [] };
  const [p, tx] = await Promise.all([api.project(id), api.transactions({ projects: [id], limit: 50 })]);
  return { list, p, tx: tx.rows };
}
function renderProjects(d: PD) {
  const groups: [string, L.Project[]][] = [["進行中", d.list.filter((x) => x.status === "active")], ["即將開始", d.list.filter((x) => x.status === "planned")], ["已結束", d.list.filter((x) => x.status === "closed" || x.status === "archived")]];
  const tw = (p: L.Project) => { const b = p.budgets.find((x) => x.currency === "TWD"); const limS = b?.total ?? "0", spentS = p.spent.TWD ?? "0"; return { lim: num(limS), spent: num(spentS), limS, spentS }; };
  const list = `<div class="stack">${groups.map(([h, ps]) => `<div><p class="eyebrow" style="margin-bottom:8px">${h}</p>${ps.length ? ps.map((x) => { const t = tw(x); return `<a class="card tap" style="margin-bottom:8px;display:block;text-decoration:none;color:var(--tx);${x.project_id === d.p?.project_id ? "border-color:var(--ac)" : ""}" href="${href("/projects/" + x.project_id)}"><div class="between"><b style="font-weight:500">${esc(x.name)}</b><span class="xs mu num">${md(x.start_date)}–${md(x.end_date)}</span></div>${t.lim ? `<div class="between num xs mu" style="margin:6px 0"><span>${fmt(t.spentS)} / ${fmt(t.limS)}</span><span>${pct1(t.spent / t.lim)}</span></div>${pbar(t.spent / t.lim, x.status === "closed" ? "done" : null, true)}` : ""}</a>`; }).join("") : `<p class="sm mu" style="margin:0 0 8px">目前沒有${h}的專案</p>`}</div>`).join("")}<button class="btn wide" data-a="proj-new">${ic("plus")}建立專案</button></div>`;
  const p = d.p;
  if (!p) return tabs("proj") + `<div class="grid"><div class="sp-4">${list}</div><div class="sp-8"><div class="card">${emptyState("還沒有專案", "旅行、活動等可以建立專案，獨立追蹤預算。")}</div></div></div>`;
  const budgets = p.budgets.filter((b) => b.total).map((b) => {
    const spentS = p.spent[b.currency] ?? "0", spent = num(spentS), lim = num(b.total!);
    return `<div style="margin-top:10px"><div class="between num xs mu"><span>${esc(curInfo(b.currency).name)} 預算 ${fmt(b.total!, b.currency)}</span><span>已花 ${fmt(spentS, b.currency)} · ${pct1(spent / lim)}</span></div><div style="margin-top:6px">${pbar(spent / lim, p.status === "closed" ? "done" : null)}</div></div>`;
  }).join("");
  const days = Array.from({ length: p.days_total }, (_, i) => { const x = new Date(p.start_date + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); });
  const daily = days.map((dd) => num(p.series.find((s) => s.date === dd)?.amount.TWD ?? "0"));
  const ended = p.status === "closed" || p.status === "archived";
  const head = ended && p.summary
    ? `<div class="panel-tot"><div><span class="eyebrow">總花費</span>${byCurrency(p.summary.total).map((m) => `<span class="amt">${fmt(m.amount, m.currency)}</span>`).join("")}</div><div><span class="eyebrow">平均每日</span>${byCurrency(p.summary.daily_average).map((m) => `<span class="amt">${fmt(m.amount, m.currency)}</span>`).join("")}</div><div><span class="eyebrow">最大支出</span>${p.summary.largest ? `<span class="amt">${fmt(p.summary.largest.amount.amount, p.summary.largest.amount.currency)}</span><span class="xs mu">${esc(p.summary.largest.merchant ?? "")}</span>` : "—"}</div></div>`
    : `<div class="panel-tot"><div><span class="eyebrow">已花</span>${byCurrency(p.spent).map((m) => `<span class="amt">${fmt(m.amount, m.currency)}</span>`).join("")}</div><div><span class="eyebrow">剩餘</span>${byCurrency(p.remaining).map((m) => `<span class="amt">${fmt(m.amount, m.currency)}</span>`).join("") || "—"}</div><div><span class="eyebrow">每日可用</span>${p.per_day_available ? byCurrency(p.per_day_available).map((m) => `<span class="amt">${fmt(m.amount, m.currency)}</span>`).join("") : "—"}<span class="xs mu">剩餘 ÷ ${p.days_left} 天</span></div></div>`;
  const tw0 = tw(p);
  const status = ended ? `<span class="st done">${ic("check", "s")}已結束</span>` : p.status === "planned" ? `<span class="st neu">${daysBetween(today(), p.start_date)} 天後開始</span>` : `<span class="st ok">進行中 · 剩 ${p.days_left} 天</span>`;
  const items = p.categories.map((c) => ({ k: c.category_key, label: c.name, amt: c.amount, v: num(c.amount), c: catColor(c.category_key, c.icon) }));
  const det = `<div class="card"><div class="ch"><h2 class="h2">${ic("plane")}${esc(p.name)}</h2>${status}</div>
    <p class="sm mu num" style="margin:-6px 0 12px">${slash(p.start_date)}–${slash(p.end_date)} · ${p.days_total} 天${p.count_in_monthly_budget ? " · 計入每月預算" : " · 不計入每月預算"}${p.note ? " · " + esc(p.note) : ""}</p>
    ${head}${budgets}${p.budgets.length > 1 ? '<p class="xs mu" style="margin:6px 0 0">不同幣別分開計算，不混加。</p>' : ""}
    ${ended && tw0.lim ? (() => { const under = cmp(tw0.spentS, tw0.limS) <= 0; return `<p class="callout ${under ? "ok" : "warn"}" style="margin:16px 0 0">${ic(under ? "check" : "alert")}${under ? "比預算少花 " + fmt(sub(tw0.limS, tw0.spentS)) : "超出預算 " + fmt(sub(tw0.spentS, tw0.limS))}</p>`; })() : ""}
    <p class="eyebrow" style="margin:20px 0 6px">${ended ? "旅程每日花費" : "期間每日花費"}</p>${barsChart(daily, days.map((x) => md(x)), { label: "專案每日花費" })}${!ended && daily.every((v) => !v) ? '<p class="xs mu" style="margin:4px 0 0">開始後每天的花費會顯示在這裡。</p>' : ""}
    ${items.length ? `<div class="donut-wrap" style="margin-top:16px">${donut(items, "分類")}<div class="leg">${items.map((x) => `<a href="${href(`/transactions?projects=${p.project_id}&categories=${x.k}`)}" style="text-decoration:none;color:inherit"><i class="dotc" style="background:${x.c}"></i>${esc(x.label)}<span class="num sm">${fmt(x.amt)}</span></a>`).join("")}</div></div>` : ""}
    <div class="between" style="margin:20px 0 6px"><p class="eyebrow">這個專案的明細</p><a class="btn sm" href="${href("/transactions")}" title="在明細用「批次」→「歸入專案」">${ic("plus", "s")}從明細批次加入</a></div>
    ${d.tx.length ? `<div class="list plain">${d.tx.map((t) => txRow(t, { showDate: true })).join("")}</div>` : '<p class="sm mu">還沒有交易</p>'}
    ${!ended ? `<div class="row" style="margin-top:16px;flex-wrap:wrap"><button class="btn" data-a="proj-close" data-id="${p.project_id}">結束專案</button></div>` : ""}</div>`;
  return tabs("proj") + `<div class="grid"><div class="sp-4">${list}</div><div class="sp-8">${det}</div></div>`;
}
registerView("projects", { load: loadProjects, render: renderProjects, title: () => "專案", back: "/more", nav: "/budgets" });
registerView("project", { load: loadProjects, render: renderProjects, title: (d) => d?.p?.name ?? "專案", back: "/projects", nav: "/budgets" });

/* ------------------------------------------------------------ 存錢目標 */
type GD = { list: L.SavingsGoal[]; g: L.SavingsGoalDetail | null };
async function loadGoals(r: Route): Promise<GD> {
  const list = (await api.goals()).rows;
  const id = r.params.id ?? list.find((g) => g.status === "active")?.goal_id ?? list[0]?.goal_id;
  return { list, g: id ? await api.goal(id) : null };
}
function renderGoals(d: GD) {
  const list = `<div class="stack">${d.list.map((x) => `<a class="card tap" style="display:block;text-decoration:none;color:var(--tx);${x.goal_id === d.g?.goal_id ? "border-color:var(--ac)" : ""}" href="${href("/goals/" + x.goal_id)}"><div class="between"><b style="font-weight:500">${esc(x.name)}</b>${x.status === "achieved" ? stPill("done") : x.is_behind ? '<span class="st warn">! 落後</span>' : `<span class="st ok">${ic("check", "s")}如期</span>`}</div><div class="between num xs mu" style="margin:6px 0"><span>${fmt(x.current, x.currency)} / ${fmt(x.target, x.currency)}</span><span>${pct1(x.progress)}</span></div>${pbar(x.progress, x.status === "achieved" ? "done" : x.is_behind ? "warn" : "ok", true)}<div class="between xs mu" style="margin-top:6px"><span>${x.deadline ? "期限 " + slash(x.deadline.slice(0, 7)) : "沒有期限"}</span><span>預計 <span class="num">${x.projected_date ? slash(x.projected_date.slice(0, 7)) : "—"}</span></span></div></a>`).join("")}<button class="btn wide" data-a="goal-new">${ic("plus")}建立目標</button></div>`;
  const g = d.g;
  if (!g) return tabs("goal") + `<div class="grid"><div class="sp-4">${list}</div><div class="sp-8"><div class="card">${emptyState("還沒有存錢目標", "設定目標金額與期限，追蹤每月需要存多少。")}</div></div></div>`;
  const cum = g.series.map((s) => num(s.cumulative)), tl = g.series.map((s) => (s.target_line == null ? null : num(s.target_line)));
  const src = g.progress_mode === "linked_account" ? `連結帳戶：${esc(app.catalog!.accounts.find((a) => a.account_key === g.linked_account_key)?.name ?? g.linked_account_key ?? "")}` : "手動記錄存入／取出";
  const det = `<div class="card"><div class="ch"><h2 class="h2">${ic("target")}${esc(g.name)}</h2><span class="xs mu">${src}</span></div>
    <div class="between" style="align-items:flex-end;flex-wrap:wrap"><div><p class="eyebrow">已存</p><div class="huge">${fmt(g.current, g.currency)}</div><p class="sm mu num" style="margin:4px 0 0">目標 ${fmt(g.target, g.currency)} · ${pct1(g.progress)}</p></div><div class="row"><button class="btn" data-a="goal-mv" data-v="-1">${ic("out", "s")}取出</button><button class="btn p" data-a="goal-mv" data-v="1">${ic("in", "s")}存入</button></div></div>
    <div style="margin:14px 0">${pbar(g.progress, g.is_behind ? "warn" : "ok")}</div>
    ${g.monthly_required ? `<div class="callout ${g.is_behind ? "warn" : "ok"}">${ic(g.is_behind ? "alert" : "check")}<div>每月還需存 <b class="num">${fmt(g.monthly_required, g.currency)}</b>，才能在 ${slash(g.deadline!.slice(0, 7))} 前達成。${g.projected_date ? `照目前速度，預計 <b class="num">${slash(g.projected_date.slice(0, 7))}</b> ${g.is_behind ? "才會達成" : "達成"}。` : "目前無法推估達成時間。"}</div></div>` : `<p class="sm mu">沒有設定期限。${g.projected_date ? `照目前速度，預計 ${slash(g.projected_date.slice(0, 7))} 達成。` : ""}</p>`}
    <p class="eyebrow" style="margin:20px 0 6px">累計金額 vs 目標</p>
    ${cum.length > 1 ? lineChart(cum, { target: num(g.target), ref: tl.every((x) => x != null) ? (tl as number[]) : null, zero: true, xl: [[0, slash(g.series[0].date.slice(0, 7))], [cum.length - 1, slash(g.series[cum.length - 1].date.slice(0, 7))]], label: "存錢累計折線" }) : '<p class="sm mu">資料不足</p>'}
    <div class="legend"><span><i class="sw-bar" style="height:2px"></i>累計已存</span><span><i class="sw-dash" style="border-color:var(--wa)"></i>目標金額／應有進度</span></div>
    <p class="eyebrow" style="margin:20px 0 4px">存入／取出紀錄</p>
    <div class="list">${g.entries.map((e) => `<div class="between" style="min-height:48px;border-bottom:1px solid var(--ln)"><span><span class="num">${slash(e.date)}</span>${e.note ? ` <span class="xs mu">· ${esc(e.note)}</span>` : ""}</span><span class="amt ${sign(e.amount) >= 0 ? "inc" : "out"}">${sign(e.amount) >= 0 ? "+" : MINUS}${fmt(abs(e.amount), g.currency)}</span></div>`).join("")}</div></div>`;
  return tabs("goal") + `<div class="grid"><div class="sp-4">${list}</div><div class="sp-8">${det}</div></div>`;
}
registerView("goals", { load: loadGoals, render: renderGoals, title: () => "存錢目標", back: "/more", nav: "/budgets" });
registerView("goal", { load: loadGoals, render: renderGoals, title: (d) => d?.g?.name ?? "存錢目標", back: "/goals", nav: "/budgets" });

/* ------------------------------------------------------------ 表單（專案／目標） */
type FormState = { kind: "proj" | "goal"; v: Record<string, string>; err: Record<string, string> };
let FS: FormState | null = null;
const fld = (id: string, label: string, input: string) => `<div class="fld"><label class="eyebrow" for="pf-${id}">${label}</label>${input}${FS!.err[id] ? `<p class="err">${ic("alert", "s")}${esc(FS!.err[id])}</p>` : ""}</div>`;
const inp = (id: string, attrs = "") => `<input id="pf-${id}" class="in" value="${esc(FS!.v[id] ?? "")}" ${attrs} ${FS!.err[id] ? 'aria-invalid="true"' : ""}>`;
function formSheet() {
  const f = FS!;
  if (f.kind === "proj") return sheetShell("建立專案", fld("name", "名稱", inp("name", 'placeholder="例：日本東京 5 天"')) + `<div class="two">${fld("start_date", "開始", inp("start_date", 'type="date"'))}${fld("end_date", "結束", inp("end_date", 'type="date"'))}</div>` +
    `<div class="two">${fld("twd", "新台幣總預算", inp("twd", 'inputmode="numeric" placeholder="選填"'))}${fld("other", "外幣預算（選填）", `<div class="row"><select id="pf-cur" class="in" style="width:96px">${app.catalog!.currencies.filter((c) => c.code !== "TWD").map((c) => `<option ${f.v.cur === c.code ? "selected" : ""}>${c.code}</option>`).join("")}</select>${inp("other", 'inputmode="decimal" placeholder="0"')}</div>`)}</div>` +
    `<label class="row sm" style="min-height:44px"><input type="checkbox" id="pf-count" ${f.v.count === "1" ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--ac)">計入每月預算</label>` + fld("note", "備註", inp("note")), `<button class="btn" data-a="closeall">取消</button><button class="btn p" data-a="pf-save">${ic("check", "s")}建立</button>`);
  return sheetShell("建立存錢目標", fld("name", "名稱", inp("name", 'placeholder="例：新筆電"')) + `<div class="two">${fld("target", "目標金額（NT$）", inp("target", 'inputmode="numeric"'))}${fld("start_amount", "起始金額", inp("start_amount", 'inputmode="numeric" placeholder="0"'))}</div>` +
    `<div class="two">${fld("start_date", "開始日", inp("start_date", 'type="date"'))}${fld("deadline", "期限（選填）", inp("deadline", 'type="date"'))}</div>` +
    fld("mode", "進度來源", `<select id="pf-mode" class="in"><option value="manual" ${f.v.mode !== "linked_account" ? "selected" : ""}>手動記錄存入／取出</option><option value="linked_account" ${f.v.mode === "linked_account" ? "selected" : ""}>連結帳戶</option></select>`) +
    (f.v.mode === "linked_account" ? fld("linked_account_key", "帳戶", `<select id="pf-linked_account_key" class="in"><option value="">選擇帳戶</option>${app.catalog!.accounts.filter((a) => a.can_record).map((a) => `<option value="${a.account_key}" ${f.v.linked_account_key === a.account_key ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`) : ""),
    `<button class="btn" data-a="closeall">取消</button><button class="btn p" data-a="pf-save">${ic("check", "s")}建立</button>`);
}
function readForm() { $$<HTMLInputElement>("#sheet [id^=pf-]").forEach((i) => { const k = i.id.slice(3); FS!.v[k] = i.type === "checkbox" ? (i.checked ? "1" : "") : i.value; }); }
function applyErr(e: unknown) {
  const err = e as LedgerError;
  if (err instanceof LedgerError && err.details) { Object.entries(err.details).forEach(([k, v]) => (FS!.err[k] = v.join("；"))); setSheet(formSheet()); }
  else handleError(e);
}

actions({
  "bud-edit"() { ui.budEdit = !ui.budEdit; rerender(); },
  async "bud-save"() {
    const d = currentData<BD>(); const lines: L.BudgetPut["lines"] = []; let bad = false;
    $$<HTMLInputElement>("[data-bk]").forEach((i) => {
      const v = i.value.replace(/[^\d]/g, ""), key = i.dataset.bk || null;
      if (!v) { if (key) bad = true; return; }
      lines.push({ category_key: key, amount: v, rollover: key ? !!$<HTMLInputElement>(`[data-roll="${key}"]`)?.checked : false });
    });
    const add = $<HTMLSelectElement>("#bud-add")?.value; if (add) lines.push({ category_key: add, amount: "1000", rollover: false });
    if (bad) { toast("分類預算不能空白；不需要的話請設為 0"); return; }
    try { await api.putBudgets({ effective_from: d.month, lines }); ui.budEdit = false; toast("已更新預算"); reload(); } catch (e) { handleError(e); }
  },
  async "bud-suggest"() {
    try {
      const s = await api.suggestBudgets(3); const d = currentData<BD>();
      const total = add(...s.lines.map((l) => l.amount));
      dialog("用過去 3 個月平均建立？", `<div class="tbl-wrap"><table class="tbl"><tbody>${s.lines.map((l) => `<tr><td>${esc(findCat(l.category_key)?.name ?? l.category_key)}</td><td class="r num">${fmt(l.amount)}</td></tr>`).join("")}<tr><td><b>月總預算</b></td><td class="r num"><b>${fmt(total)}</b></td></tr></tbody></table></div>`, "建立", async () => {
        try { await api.putBudgets({ effective_from: d.month, lines: [{ category_key: null, amount: total }, ...s.lines.map((l) => ({ category_key: l.category_key, amount: l.amount }))] }); toast(`已建立 ${s.lines.length} 個分類預算`); reload(); } catch (e) { handleError(e); }
      });
    } catch (e) { handleError(e); }
  },
  "proj-new"() { FS = { kind: "proj", v: { start_date: today(), end_date: today(), cur: "JPY" }, err: {} }; openSheet("form", formSheet()); },
  "goal-new"() { FS = { kind: "goal", v: { start_date: today(), mode: "manual" }, err: {} }; openSheet("form", formSheet()); },
  async "pf-save"() {
    readForm(); const f = FS!; f.err = {};
    if (!f.v.name?.trim()) f.err.name = "請輸入名稱";
    if (f.kind === "proj") {
      if (!f.v.start_date || !f.v.end_date || f.v.end_date < f.v.start_date) f.err.end_date = "結束日要在開始日之後";
      if (Object.keys(f.err).length) return setSheet(formSheet());
      const budgets: L.Project["budgets"] = [];
      if (f.v.twd) budgets.push({ currency: "TWD", total: f.v.twd.replace(/\D/g, ""), by_category: [] });
      if (f.v.other) budgets.push({ currency: f.v.cur || "JPY", total: f.v.other, by_category: [] });
      try { const r = await api.createProject({ name: f.v.name.trim(), start_date: f.v.start_date, end_date: f.v.end_date, count_in_monthly_budget: f.v.count === "1", budgets, note: f.v.note || null }); closeSheet(); toast("已建立專案"); navigate("/projects/" + r.project.project_id); }
      catch (e) { applyErr(e); }
    } else {
      if (!/^\d+$/.test(f.v.target ?? "") || Number(f.v.target) <= 0) f.err.target = "請輸入大於 0 的目標金額";
      if (f.v.mode === "linked_account" && !f.v.linked_account_key) f.err.linked_account_key = "請選擇帳戶";
      if (Object.keys(f.err).length) return setSheet(formSheet());
      try { const r = await api.createGoal({ name: f.v.name.trim(), currency: "TWD", target: f.v.target, start_amount: f.v.start_amount || undefined, start_date: f.v.start_date, deadline: f.v.deadline || null, progress_mode: f.v.mode as "manual" | "linked_account", linked_account_key: f.v.linked_account_key || null }); closeSheet(); toast("已建立目標"); navigate("/goals/" + r.goal.goal_id); }
      catch (e) { applyErr(e); }
    }
  },
  async "proj-close"(el) {
    dialog("結束這個專案？", "<p style='margin:0'>結束後會產生總結，之後的新交易不會再出現在專案選單。</p>", "結束專案", async () => {
      try { await api.updateProject(el.dataset.id!, { status: "closed" }); toast("已結束專案"); reload(); } catch (e) { handleError(e); }
    });
  },
  "goal-mv"(el) {
    const out = el.dataset.v === "-1", g = currentData<GD>().g!; const key = newIdempotencyKey();
    dialog(out ? "從目標取出" : "存入目標", `<div class="fld"><label class="eyebrow" for="g-amt">${esc(g.name)} · 金額</label><input id="g-amt" class="in num" inputmode="numeric" placeholder="例如 3000" autocomplete="off"></div><div class="fld"><label class="eyebrow" for="g-note">備註（選填）</label><input id="g-note" class="in" autocomplete="off"></div>`, out ? "取出" : "存入", async () => {
      const v = ($<HTMLInputElement>("#g-amt")?.value ?? "").replace(/\D/g, ""), note = $<HTMLInputElement>("#g-note")?.value.trim() || null;
      if (!v || Number(v) <= 0) { toast("沒有輸入金額，未變更"); return; }
      try { await api.goalEntry(g.goal_id, { idempotency_key: key, date: today(), amount: out ? "-" + v : v, note }); toast(`已${out ? "取出" : "存入"} ${fmt(v)}`); reload(); } catch (e) { handleError(e); }
    });
  },
});
document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "pf-mode" && FS) { readForm(); setSheet(formSheet()); }
});
