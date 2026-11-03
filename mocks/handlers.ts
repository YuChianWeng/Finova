/**
 * Mock API：依 FRONTEND-CONTRACT v1.0 實作 /api/ledger/* 的回應。
 * 只在開發與預覽版使用；正式環境接真實後端時完全不會載入這個檔案。
 */
import type * as L from "../src/types/ledger";
import {
  db, acc, cat, mainOf, addRow, addTransfer, balanceAt, delta, live, dt, r2, S,
  MOCK_TODAY, MOCK_NOW, OPENING_AT, type Row, type Acc,
} from "./db";

/* ================================================================ utils */
export type MockResponse = { status: number; body: unknown; headers?: Record<string, string> };
const ok = (data: unknown, status = 200): MockResponse => ({ status, body: { version: 1, data } });
export const fail = (status: number, code: L.ErrorCode, message: string, details?: Record<string, string[]>, current?: unknown): MockResponse =>
  ({ status, body: { version: 1, error: { code, message, ...(details ? { details } : {}), ...(current !== undefined ? { current } : {}) } } });
class HttpError extends Error { constructor(public res: MockResponse) { super(); } }
const bad = (code: L.ErrorCode, message: string, details?: Record<string, string[]>, status = 400) => { throw new HttpError(fail(status, code, message, details)); };

const noon = (d: string) => new Date(d + "T12:00:00Z");
const addDays = (d: string, n: number) => { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((noon(b).getTime() - noon(a).getTime()) / 864e5);
const dim = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const monthEnd = (m: string) => `${m}-${String(dim(m)).padStart(2, "0")}`;
const addMonths = (m: string, k: number) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; return `${y + Math.floor(mo / 12)}-${String(((mo % 12) + 12) % 12 + 1).padStart(2, "0")}`; };
const weekStart = (d: string) => addDays(d, -((noon(d).getUTCDay() + 6) % 7));
function weekToStart(w: string) { const [y, n] = w.split("-W").map(Number); return addDays(weekStart(`${y}-01-04`), (n - 1) * 7); }
const decOf = (c: string) => db.currencies.find((x) => x.code === c)?.decimals ?? 2;
const M = (n: number, c = "TWD"): L.Money => ({ amount: S(n, decOf(c)), currency: c });
const nowISO = () => MOCK_NOW;
const isTWD = (r: Row) => r.currency === "TWD";
const isMoney = (s: unknown, dec = 2) => typeof s === "string" && /^\d+(\.\d+)?$/.test(s) && (s.split(".")[1]?.length ?? 0) <= dec;

/* ================================================================ mapping */
function catRef(k: string | null): L.Transaction["category"] {
  const c = cat(k); if (!c) return null;
  const main = c.parent_key ? cat(c.parent_key)! : c;
  return { main: { category_key: main.category_key, name: main.name, icon: main.icon }, sub: c.parent_key ? { category_key: c.category_key, name: c.name, icon: c.icon } : null };
}
function accRef(k: string) { const a = db.accs.find((x) => x.account_key === k)!; return { account_key: a.account_key, name: a.name, group: a.group }; }
export function toTx(r: Row, balance_after: number | null = null): L.Transaction {
  const cp = r.counterpart_id ? db.rows.find((x) => x.id === r.counterpart_id) : null;
  const fee = r.fee_id ? db.rows.find((x) => x.id === r.fee_id) : null;
  return {
    id: r.id, version: r.version, type: r.type, direction: r.direction, amount: M(r.amount, r.currency),
    occurred_at: dt(r.date, r.time), date: r.date, account: accRef(r.account_key),
    category: r.type === "expense" || r.type === "income" ? catRef(r.category_key) : null,
    merchant: r.merchant, note: r.note, tags: r.tag_ids.map((id) => db.tags.find((t) => t.tag_id === id)).filter(Boolean) as L.Tag[],
    project: r.project_id ? { project_id: r.project_id, name: db.projects.find((p) => p.project_id === r.project_id)?.name ?? "" } : null,
    source: r.source,
    transfer: cp && r.group_id && r.leg ? { group_id: r.group_id, leg: r.leg, counterpart: { transaction_id: cp.id, account_key: cp.account_key, account_name: accRef(cp.account_key).name, amount: M(cp.amount, cp.currency) }, fee: fee ? M(fee.amount, fee.currency) : null } : null,
    recurring_rule_id: r.recurring_rule_id,
    balance_after: balance_after == null ? null : M(balance_after, r.currency),
    created_at: r.created_at, updated_at: r.updated_at,
  };
}
const order = (a: Row, b: Row) => (b.date + b.time).localeCompare(a.date + a.time) || b.id - a.id;

/* ================================================================ catalog */
function catalog(): L.Catalog {
  const mains = db.cats.filter((c) => !c.parent_key).sort((a, b) => a.sort_order - b.sort_order);
  const since = addDays(MOCK_TODAY, -90);
  const counts = (pred: (r: Row) => boolean, key: (r: Row) => string | null) => {
    const o: Record<string, number> = {};
    live().filter((r) => r.date >= since && pred(r)).forEach((r) => { const k = key(r); if (k) o[k] = (o[k] ?? 0) + 1; });
    return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  return {
    currencies: db.currencies,
    accounts: db.accs.filter((a) => !a.deleted_at).map((a) => ({ account_key: a.account_key, name: a.name, group: a.group, currency: a.currency, icon: a.icon, aliases: a.aliases, is_archived: a.is_archived, can_record: !a.is_archived && a.group !== "investment" })),
    categories: mains.map((m) => ({
      category_key: m.category_key, name: m.name, kind: m.kind, icon: m.icon, is_hidden: m.is_hidden, sort_order: m.sort_order,
      children: db.cats.filter((c) => c.parent_key === m.category_key).sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => ({ category_key: c.category_key, name: c.name, kind: c.kind, icon: c.icon, is_hidden: c.is_hidden, sort_order: c.sort_order, parent_key: m.category_key })),
    })),
    tags: db.tags,
    frequent: {
      expense_categories: counts((r) => r.type === "expense" && r.category_key !== "uncategorized", (r) => r.category_key).slice(0, 8),
      income_categories: counts((r) => r.type === "income", (r) => r.category_key).slice(0, 8),
      accounts: counts((r) => r.type === "expense" || r.type === "income", (r) => r.account_key).slice(0, 6),
    },
    projects_active: db.projects.filter((p) => p.status === "planned" || p.status === "active").map((p) => ({ project_id: p.project_id, name: p.name, start_date: p.start_date, end_date: p.end_date })),
  };
}

/* ================================================================ transactions */
function filterRows(q: Record<string, string>): Row[] {
  const list = (k: string) => (q[k] ? q[k].split(",").filter(Boolean) : []);
  const accs = list("accounts"), cats = list("categories"), types = list("types"), projects = list("projects"), tags = list("tags"), sources = list("sources");
  const qq = (q.q ?? "").toLowerCase();
  let rows = live().filter((r) => {
    if (q.from && r.date < q.from) return false;
    if (q.to && r.date > q.to) return false;
    if (accs.length && !accs.includes(r.account_key)) return false;
    if (cats.length && !cats.some((c) => r.category_key === c || (r.category_key ?? "").startsWith(c + "."))) return false;
    if (types.length && !types.includes(r.type)) return false;
    if (projects.length && !projects.includes(r.project_id ?? "")) return false;
    if (tags.length && !tags.some((t) => r.tag_ids.includes(t))) return false;
    if (sources.length && !sources.includes(r.source)) return false;
    if (q.currency && r.currency !== q.currency) return false;
    if (q.min && r.amount < Number(q.min)) return false;
    if (q.max && r.amount > Number(q.max)) return false;
    if (qq && !`${r.merchant ?? ""} ${r.note ?? ""}`.toLowerCase().includes(qq)) return false;
    return true;
  });
  // 轉帳只篩帳戶以外的條件時，一組只回一筆（轉出那筆），避免重複
  if (!accs.length) rows = rows.filter((r) => r.leg !== "in");
  const asc = q.order === "asc";
  rows.sort(q.sort === "amount" ? (a, b) => (asc ? a.amount - b.amount : b.amount - a.amount) || order(a, b) : (a, b) => (asc ? -order(a, b) : order(a, b)));
  return rows;
}
function sumBy(rows: Row[], type: "income" | "expense"): L.MoneyByCurrency {
  const o: Record<string, number> = {};
  rows.filter((r) => r.type === type).forEach((r) => (o[r.currency] = (o[r.currency] ?? 0) + r.amount));
  return Object.fromEntries(Object.entries(o).map(([c, v]) => [c, S(v, decOf(c))]));
}
function netBy(i: L.MoneyByCurrency, e: L.MoneyByCurrency): L.MoneyByCurrency {
  const o: Record<string, number> = {};
  Object.entries(i).forEach(([c, v]) => (o[c] = (o[c] ?? 0) + Number(v)));
  Object.entries(e).forEach(([c, v]) => (o[c] = (o[c] ?? 0) - Number(v)));
  return Object.fromEntries(Object.entries(o).map(([c, v]) => [c, S(v, decOf(c))]));
}
function listTransactions(q: Record<string, string>): L.TransactionsPage {
  const rows = filterRows(q);
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const off = q.cursor ? Number(atob(q.cursor)) || 0 : 0;
  const page = rows.slice(off, off + limit);
  // 只篩單一帳戶、且已設定期初時，才附交易後餘額
  const accs = q.accounts ? q.accounts.split(",") : [];
  let balMap: Map<number, number> | null = null;
  if (accs.length === 1 && acc(accs[0])?.opening) {
    const a = acc(accs[0])!; balMap = new Map(); let b = a.opening!.amount;
    db.rows.filter((r) => !r.deleted_at && r.account_key === a.account_key).sort((x, y) => -order(x, y)).forEach((r) => { b = r2(b + delta(r)); balMap!.set(r.id, b); });
  }
  const income = sumBy(rows, "income"), expense = sumBy(rows, "expense");
  return {
    rows: page.map((r) => toTx(r, balMap?.get(r.id) ?? null)),
    summary: { count: rows.length, income, expense, net: netBy(income, expense) },
    next_cursor: off + limit < rows.length ? btoa(String(off + limit)) : null,
  };
}
function detail(id: number): L.TransactionDetail {
  const r = db.rows.find((x) => x.id === id && !x.deleted_at);
  if (!r) throw new HttpError(fail(404, "NOT_FOUND", "找不到這筆交易"));
  return { ...toTx(r), history: r.history };
}

/* ================================================================ accounts */
function lastRec(k: string) { return db.recs.filter((x) => x.account_key === k).sort((a, b) => b.as_of.localeCompare(a.as_of))[0] ?? null; }
function monthFlow(k: string, from: string, to: string) {
  let i = 0, o = 0;
  live().filter((r) => r.account_key === k && r.date >= from && r.date <= to).forEach((r) => (r.direction === "in" ? (i += r.amount) : (o += r.amount)));
  return { i, o };
}
function cardInfo(a: Acc): L.CreditCardInfo | null {
  if (a.group !== "credit_card" || !a.credit_card) return null;
  const c = a.credit_card, s = c.current_statement;
  const bal = balanceAt(a.account_key) ?? 0;
  let cur: L.CreditCardInfo["current_statement"] = null;
  if (s) {
    const paid = live().filter((r) => r.account_key === a.account_key && r.type === "credit_card_payment" && r.direction === "in" && r.date > s.period_end).reduce((t, r) => t + r.amount, Number(s.paid));
    cur = { period_start: s.period_start, period_end: s.period_end, amount: M(Number(s.amount)), due_date: s.due_date, days_until_due: s.due_date ? daysBetween(MOCK_TODAY, s.due_date) : null, paid: M(paid), is_paid_off: paid >= Number(s.amount) };
  }
  return { statement_day: c.statement_day, due_day: c.due_day, credit_limit: c.credit_limit ? M(Number(c.credit_limit)) : null, current_statement: cur, utilization: c.credit_limit ? r2(Math.abs(Math.min(0, bal)) / Number(c.credit_limit)) : null };
}
function summary(a: Acc): L.AccountSummary {
  const bal = balanceAt(a.account_key);
  const rec = lastRec(a.account_key);
  const m = MOCK_TODAY.slice(0, 7);
  const f = monthFlow(a.account_key, `${m}-01`, MOCK_TODAY);
  return {
    account_key: a.account_key, name: a.name, group: a.group, currency: a.currency, icon: a.icon, is_archived: a.is_archived, sort_order: a.sort_order,
    balance: { computed: bal == null ? null : M(bal, a.currency), opening_set: !!a.opening, latest_snapshot: a.latest_snapshot ?? (rec ? { amount: rec.actual, as_of: rec.as_of } : null) },
    month_flow: { inflow: M(f.i, a.currency), outflow: M(f.o, a.currency) },
    reconcile: { last_at: rec?.as_of ?? null, last_diff: rec?.diff ?? null, due: !a.is_archived && (!rec || daysBetween(rec.as_of.slice(0, 10), MOCK_TODAY) > a.reminder_days), reminder_days: a.reminder_days },
    credit_card: cardInfo(a),
  };
}
const GROUP_ORDER: L.AccountGroup[] = ["cash", "bank", "credit_card", "stored_value", "liability", "receivable", "other"];
function addTo(o: Record<string, number>, c: string, v: number) { o[c] = (o[c] ?? 0) + v; }
const fin = (o: Record<string, number>): L.MoneyByCurrency => Object.fromEntries(Object.entries(o).map(([c, v]) => [c, S(v, decOf(c))]));
function totals(list: Acc[]): L.AccountsResponse["totals"] {
  const cash: Record<string, number> = {}, card: Record<string, number> = {}, liab: Record<string, number> = {};
  list.filter((a) => !a.is_archived).forEach((a) => {
    const b = balanceAt(a.account_key);
    const v = b ?? (a.latest_snapshot ? Number(a.latest_snapshot.amount.amount) : null);
    if (v == null) return;
    if (["cash", "bank", "stored_value"].includes(a.group)) addTo(cash, a.currency, v);
    else if (a.group === "credit_card") addTo(card, a.currency, -v);
    else if (a.group === "liability") addTo(liab, a.currency, -v);
  });
  return { available_cash: fin(cash), credit_card_due: fin(card), liabilities: fin(liab) };
}
const investments = (): L.InvestmentTotal[] => db.investments.map((i) => ({ ...i, is_stale: daysBetween(i.as_of.slice(0, 10), MOCK_TODAY) > 7 }));
function accounts(includeArchived: boolean): L.AccountsResponse {
  const all = db.accs.filter((a) => !a.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
  const act = all.filter((a) => !a.is_archived);
  return {
    totals: totals(act),
    groups: GROUP_ORDER.map((g) => ({ group: g, accounts: act.filter((a) => a.group === g).map(summary) })).filter((g) => g.accounts.length),
    investments: investments(),
    archived: includeArchived ? all.filter((a) => a.is_archived).map(summary) : [],
  };
}
function accountDetail(key: string, q: Record<string, string>): L.AccountDetail {
  const a = acc(key); if (!a) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個帳戶"));
  const from = q.from || `${MOCK_TODAY.slice(0, 7)}-01`, to = q.to || MOCK_TODAY;
  const f = monthFlow(key, from, to);
  const rows = live().filter((r) => r.account_key === key && r.type === "expense" && r.date >= from && r.date <= to && isTWD(r));
  return { ...summary(a), top_categories: slices(rows, null).slice(0, 5), period: { from, to, inflow: M(f.i, a.currency), outflow: M(f.o, a.currency) } };
}
function balanceSeries(key: string, q: Record<string, string>): L.BalanceSeries {
  const a = acc(key); if (!a) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個帳戶"));
  const from = q.from, to = q.to, g = (q.granularity || "day") as L.Granularity;
  const points: { date: string; balance: string }[] = [];
  if (a.opening) {
    const rows = db.rows.filter((r) => !r.deleted_at && r.account_key === key).sort((x, y) => -order(x, y));
    let b = a.opening.amount, i = 0;
    const openDate = a.opening.at.slice(0, 10);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      while (i < rows.length && rows[i].date <= d) { b += delta(rows[i]); i++; }
      const take = g === "day" || (g === "week" && (noon(d).getUTCDay() === 0 || d === to)) || (g === "month" && (d === monthEnd(d.slice(0, 7)) || d === to));
      if (take && d >= openDate) points.push({ date: d, balance: S(b, decOf(a.currency)) });
    }
  }
  return { points, reconciliations: db.recs.filter((x) => x.account_key === key && x.as_of.slice(0, 10) >= from && x.as_of.slice(0, 10) <= to).map((x) => ({ as_of: x.as_of, actual: x.actual.amount })), opening_at: a.opening?.at ?? null };
}

/* ================================================================ reports */
function periodRows(from: string, to: string, ex: boolean) { return live().filter((r) => r.date >= from && r.date <= to && (!ex || !r.project_id)); }
function kpi(from: string, to: string, pf: string | null, pt: string | null, ex: boolean, compare = true): L.Kpi {
  const rows = periodRows(from, to, ex);
  const income = sumBy(rows, "income"), expense = sumBy(rows, "expense");
  const it = Number(income.TWD ?? 0), et = Number(expense.TWD ?? 0);
  let cmp: L.Kpi["compare"] = null;
  if (compare && pf && pt) {
    const pr = periodRows(pf, pt, ex);
    const pi = pr.filter((r) => r.type === "income" && isTWD(r)).reduce((s, r) => s + r.amount, 0);
    const pe = pr.filter((r) => r.type === "expense" && isTWD(r)).reduce((s, r) => s + r.amount, 0);
    const d = (cur: number, prev: number): L.Delta => ({ previous: S(prev, 0), change: S(cur - prev, 0), change_ratio: prev === 0 ? null : r2((cur - prev) / Math.abs(prev) * 1000) / 1000 });
    cmp = { income: d(it, pi), expense: d(et, pe), net: d(it - et, pi - pe) };
  }
  return { income, expense, net: netBy(income, expense), savings_rate: it ? Math.round(((it - et) / it) * 1000) / 1000 : null, compare: cmp };
}
function slices(rows: Row[], prevRows: Row[] | null): L.CategorySlice[] {
  const exp = rows.filter((r) => r.type === "expense" && isTWD(r));
  const total = exp.reduce((s, r) => s + r.amount, 0) || 1;
  const byMain: Record<string, Row[]> = {};
  exp.forEach((r) => (byMain[mainOf(r.category_key ?? "uncategorized")] ??= []).push(r));
  const prevBy: Record<string, number> = {};
  prevRows?.filter((r) => r.type === "expense" && isTWD(r)).forEach((r) => addTo(prevBy, mainOf(r.category_key ?? "uncategorized"), r.amount));
  return Object.entries(byMain).map(([k, rs]) => {
    const c = cat(k)!; const amt = rs.reduce((s, r) => s + r.amount, 0);
    const subs: Record<string, Row[]> = {};
    rs.forEach((r) => (subs[r.category_key && r.category_key.includes(".") ? r.category_key : `${k}.__none__`] ??= []).push(r));
    return {
      category_key: k, name: c.name, icon: c.icon, amount: S(amt, 0), ratio: r2(amt / total * 100) / 100, count: rs.length,
      children: Object.entries(subs).map(([sk, srs]) => { const sa = srs.reduce((s, r) => s + r.amount, 0); return { category_key: sk, name: sk.endsWith("__none__") ? "（未細分）" : cat(sk)!.name, icon: c.icon, amount: S(sa, 0), ratio: r2(sa / amt * 100) / 100, count: srs.length }; }).sort((a, b) => Number(b.amount) - Number(a.amount)),
      ...(prevRows ? { compare_previous: S(prevBy[k] ?? 0, 0) } : {}),
    };
  }).sort((a, b) => Number(b.amount) - Number(a.amount));
}
function budgetFor(m: string) { return db.budgets.filter((b) => b.effective_from <= m).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null; }
function budgetSummary(m: string): L.BudgetSummary | null {
  const b = budgetFor(m); if (!b) return null;
  const from = `${m}-01`, to = monthEnd(m);
  const elapsed = m < MOCK_TODAY.slice(0, 7) ? dim(m) : m > MOCK_TODAY.slice(0, 7) ? 0 : Number(MOCK_TODAY.slice(8));
  const rows = live().filter((r) => r.type === "expense" && isTWD(r) && r.date >= from && r.date <= to && (!r.project_id || db.projects.find((p) => p.project_id === r.project_id)?.count_in_monthly_budget));
  const line = (key: string | null, limit: number, rollover: boolean): L.BudgetLine => {
    const used = rows.filter((r) => key == null || mainOf(r.category_key ?? "uncategorized") === key || (key === "other" && r.category_key === "uncategorized")).reduce((s, r) => s + r.amount, 0);
    const ratio = limit ? used / limit : 0;
    return { category_key: key, name: key ? cat(key)!.name : "月總預算", limit: S(limit, 0), used: S(used, 0), remaining: S(limit - used, 0), ratio: Math.round(ratio * 1000) / 1000,
      status: ratio >= 1 ? "over" : ratio >= 0.8 ? "warning" : "ok", projected: S(elapsed ? Math.round(used / elapsed * dim(m)) : 0, 0), rollover };
  };
  const tl = b.lines.find((l) => l.category_key == null);
  const lines = b.lines.filter((l) => l.category_key != null).map((l) => line(l.category_key, l.amount, l.rollover));
  const sumCats = b.lines.filter((l) => l.category_key != null).reduce((s, l) => s + l.amount, 0);
  return { month: m, currency: "TWD", total: tl ? line(null, tl.amount, false) : null, total_is_sum_of_categories: !!tl && tl.amount === sumCats, lines };
}
function series(from: string, to: string, ex: boolean, budgetTotal: number | null): L.SeriesPoint[] {
  const rows = periodRows(from, to, ex).filter(isTWD);
  const out: L.SeriesPoint[] = []; let cum = 0; const n = daysBetween(from, to) + 1; let i = 0;
  for (let d = from; d <= to; d = addDays(d, 1), i++) {
    const inc = rows.filter((r) => r.date === d && r.type === "income").reduce((s, r) => s + r.amount, 0);
    const exp = rows.filter((r) => r.date === d && r.type === "expense").reduce((s, r) => s + r.amount, 0);
    cum += d <= MOCK_TODAY ? exp : 0;
    out.push({ date: d, income: S(inc, 0), expense: S(exp, 0), cumulative_expense: d <= MOCK_TODAY ? S(cum, 0) : undefined, budget_line: budgetTotal == null ? null : S(Math.round(budgetTotal * (i + 1) / n), 0) });
  }
  return out;
}
function merchants(rows: Row[]): L.MerchantRank[] {
  const o: Record<string, { amount: number; count: number }> = {};
  rows.filter((r) => r.type === "expense" && isTWD(r) && r.merchant).forEach((r) => { const x = (o[r.merchant!] ??= { amount: 0, count: 0 }); x.amount += r.amount; x.count++; });
  return Object.entries(o).sort((a, b) => b[1].amount - a[1].amount).slice(0, 10).map(([merchant, x]) => ({ merchant, amount: S(x.amount, 0), count: x.count }));
}
const bool = (v: string | undefined, d: boolean) => (v == null ? d : v === "true");
function dailyReport(q: Record<string, string>): L.DailyReport {
  const d = q.date || MOCK_TODAY;
  const rows = periodRows(d, d, false);
  const last30 = periodRows(addDays(d, -30), addDays(d, -1), false).filter((r) => r.type === "expense" && isTWD(r)).reduce((s, r) => s + r.amount, 0);
  return { date: d, kpi: kpi(d, d, addDays(d, -1), addDays(d, -1), false, bool(q.compare, true)), daily_average_expense: S(last30 / 30, 0), transactions: rows.filter((r) => r.leg !== "in").sort(order).map((r) => toTx(r)), categories: slices(rows, null) };
}
function weeklyReport(q: Record<string, string>): L.WeeklyReport {
  const start = weekToStart(q.week), end = addDays(start, 6), ex = bool(q.exclude_projects, false);
  const rows = periodRows(start, end, ex);
  const b = budgetSummary(start.slice(0, 7));
  return { week: q.week, start, end, kpi: kpi(start, end, addDays(start, -7), addDays(start, -1), ex, bool(q.compare, true)), series: series(start, end, ex, null),
    categories: slices(rows, null), top_expenses: rows.filter((r) => r.type === "expense" && isTWD(r)).sort((a, b) => b.amount - a.amount).slice(0, 3).map((r) => toTx(r)), budget: b };
}
function monthlyReport(q: Record<string, string>): L.MonthlyReport {
  const m = q.month, from = `${m}-01`, to = monthEnd(m), ex = bool(q.exclude_projects, false);
  const pm = addMonths(m, -1);
  // 「上一期同期」：本月進行中時，比較上月同樣天數
  const sameLen = m === MOCK_TODAY.slice(0, 7) ? Number(MOCK_TODAY.slice(8)) : dim(m);
  const pt = `${pm}-${String(Math.min(sameLen, dim(pm))).padStart(2, "0")}`;
  const rows = periodRows(from, to, ex), prev = periodRows(`${pm}-01`, monthEnd(pm), ex);
  const b = budgetSummary(m);
  const accRows = db.accs.filter((a) => !a.deleted_at).map((a) => { const f = { i: 0, o: 0 }; rows.filter((r) => r.account_key === a.account_key && isTWD(r)).forEach((r) => (r.direction === "in" ? (f.i += r.amount) : (f.o += r.amount))); return { account_key: a.account_key, name: a.name, inflow: S(f.i, 0), outflow: S(f.o, 0) }; }).filter((x) => x.inflow !== "0" || x.outflow !== "0");
  const fixedKeys = ["subscription", "home"];
  const exp = rows.filter((r) => r.type === "expense" && isTWD(r));
  const fixed = exp.filter((r) => fixedKeys.includes(mainOf(r.category_key ?? "")) || r.recurring_rule_id).reduce((s, r) => s + r.amount, 0);
  const total = exp.reduce((s, r) => s + r.amount, 0);
  return {
    month: m, kpi: kpi(from, to, `${pm}-01`, pt, ex, bool(q.compare, true)), series: series(from, to, ex, b?.total ? Number(b.total.limit) : null),
    categories: slices(rows, prev), accounts: accRows, merchants: merchants(rows), budget: b, fixed_vs_variable: { fixed: S(fixed, 0), variable: S(total - fixed, 0) },
    data_notice: m < "2026-10" ? "這個月份由 MOZE 匯入，部分商家名稱為彙總資料" : null,
  };
}
function rangeReport(q: Record<string, string>): L.RangeReport {
  const from = q.from, to = q.to, ex = bool(q.exclude_projects, false);
  const months: string[] = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) months.push(m);
  const ser: L.SeriesPoint[] = [], stacked: L.RangeReport["stacked"] = [];
  months.forEach((m) => {
    const rows = periodRows(`${m}-01`, monthEnd(m), ex).filter(isTWD);
    const inc = rows.filter((r) => r.type === "income").reduce((s, r) => s + r.amount, 0), exp = rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);
    ser.push({ date: `${m}-01`, income: S(inc, 0), expense: S(exp, 0) });
    const by: Record<string, number> = {}; rows.filter((r) => r.type === "expense").forEach((r) => addTo(by, mainOf(r.category_key ?? "uncategorized"), r.amount));
    stacked.push({ date: `${m}-01`, by_category: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, S(v, 0)])) });
  });
  const full = ser.filter((p) => p.date.slice(0, 7) < MOCK_TODAY.slice(0, 7) && Number(p.expense) > 0);
  const ys = (from.slice(0, 4) as unknown as number) - 1;
  const max = full.reduce<L.SeriesPoint | null>((a, p) => (!a || Number(p.expense) > Number(a.expense) ? p : a), null);
  const min = full.reduce<L.SeriesPoint | null>((a, p) => (!a || Number(p.expense) < Number(a.expense) ? p : a), null);
  return { from, to, granularity: "month", kpi: kpi(from, to, `${ys}${from.slice(4)}`, `${ys}${to.slice(4)}`, ex, bool(q.compare, true)), series: ser, stacked,
    stats: { average_expense: S(full.length ? full.reduce((s, p) => s + Number(p.expense), 0) / full.length : 0, 0), max_month: max ? { month: max.date.slice(0, 7), expense: max.expense } : null, min_month: min ? { month: min.date.slice(0, 7), expense: min.expense } : null } };
}
function trend(q: Record<string, string>): L.TrendReport {
  const g = (q.granularity || "month") as L.Granularity;
  const rows = periodRows(q.from, q.to, false).filter((r) => r.type === "expense" && isTWD(r) && (q.category ? r.category_key === q.category || (r.category_key ?? "").startsWith(q.category + ".") : r.merchant === q.merchant));
  const key = (d: string) => (g === "day" ? d : g === "week" ? weekStart(d) : `${d.slice(0, 7)}-01`);
  const pts: Record<string, { amount: number; count: number }> = {};
  for (let d = q.from; d <= q.to; d = addDays(d, 1)) pts[key(d)] ??= { amount: 0, count: 0 };
  rows.forEach((r) => { const p = pts[key(r.date)]; p.amount += r.amount; p.count++; });
  return { target: q.category ? { kind: "category", key: q.category, name: cat(q.category)?.name ?? q.category } : { kind: "merchant", key: q.merchant, name: q.merchant },
    granularity: g, points: Object.entries(pts).sort().map(([date, p]) => ({ date, amount: S(p.amount, 0), count: p.count })) };
}

/* ================================================================ projects / goals */
function project(p: (typeof db.projects)[number]): L.Project {
  const rows = live().filter((r) => r.project_id === p.project_id && r.type === "expense");
  const spent: Record<string, number> = {}; rows.forEach((r) => addTo(spent, r.currency, r.amount));
  p.budgets.forEach((b) => (spent[b.currency] ??= 0));
  const remaining: Record<string, number> = {};
  p.budgets.forEach((b) => { if (b.total != null) remaining[b.currency] = Number(b.total) - (spent[b.currency] ?? 0); });
  const days_total = daysBetween(p.start_date, p.end_date) + 1;
  const days_left = MOCK_TODAY > p.end_date ? 0 : MOCK_TODAY < p.start_date ? days_total : daysBetween(MOCK_TODAY, p.end_date) + 1;
  const ended = p.status === "closed" || p.status === "archived";
  return { ...p, spent: fin(spent), remaining: fin(remaining), per_day_available: ended ? null : fin(Object.fromEntries(Object.entries(remaining).map(([c, v]) => [c, v / Math.max(1, days_left)]))), days_total, days_left };
}
function projectDetail(id: string): L.ProjectDetail {
  const p = db.projects.find((x) => x.project_id === id); if (!p) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個專案"));
  const base = project(p);
  const rows = live().filter((r) => r.project_id === id && r.type === "expense");
  const byDate: Record<string, Record<string, number>> = {};
  rows.forEach((r) => addTo((byDate[r.date] ??= {}), r.currency, r.amount));
  const ended = p.status === "closed" || p.status === "archived";
  const largest = rows.slice().sort((a, b) => b.amount - a.amount)[0];
  return { ...base, series: Object.entries(byDate).sort().map(([date, v]) => ({ date, amount: fin(v) })), categories: slices(rows, null),
    summary: ended ? { total: base.spent, daily_average: fin(Object.fromEntries(Object.entries(base.spent).map(([c, v]) => [c, Number(v) / base.days_total]))), largest: largest ? toTx(largest) : null } : null };
}
function goal(g: (typeof db.goals)[number]): L.SavingsGoal {
  const current = g.entries.reduce((s, e) => s + e.amount, 0);
  const target = Number(g.target);
  const monthsLeft = g.deadline ? Math.max(1, (Number(g.deadline.slice(0, 4)) - 2026) * 12 + Number(g.deadline.slice(5, 7)) - 11 + 1) : null;
  const recent = g.entries.filter((e) => e.date >= "2026-05-01").map((e) => e.amount);
  const pace = recent.length ? recent.reduce((a, b) => a + b, 0) / 6 : 0;
  const need = Math.max(0, target - current);
  const monthsNeeded = pace > 0 ? Math.ceil(need / pace) : null;
  const projected = monthsNeeded == null ? null : `${addMonths("2026-11", monthsNeeded - 1)}-28`;
  return { goal_id: g.goal_id, name: g.name, currency: g.currency, target: g.target, current: S(current, 0), progress: Math.round(current / target * 1000) / 1000,
    start_date: g.start_date, deadline: g.deadline, progress_mode: g.progress_mode, linked_account_key: g.linked_account_key,
    monthly_required: monthsLeft ? S(Math.ceil(need / monthsLeft), 0) : null, projected_date: projected,
    is_behind: !!(g.deadline && projected && projected > g.deadline), status: current >= target ? "achieved" : g.status, note: g.note };
}
function goalDetail(id: string): L.SavingsGoalDetail {
  const g = db.goals.find((x) => x.goal_id === id); if (!g) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個目標"));
  let c = 0;
  const months: Record<string, number> = {}; g.entries.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => (months[e.date.slice(0, 7)] = (c += e.amount)));
  const sm = g.start_date.slice(0, 7), dm = g.deadline?.slice(0, 7) ?? null;
  const total = dm ? (Number(dm.slice(0, 4)) - Number(sm.slice(0, 4))) * 12 + Number(dm.slice(5)) - Number(sm.slice(5)) : null;
  const series: L.SavingsGoalDetail["series"] = []; let last = 0, i = 0;
  for (let m = sm; m <= MOCK_TODAY.slice(0, 7); m = addMonths(m, 1), i++) { if (months[m] != null) last = months[m]; series.push({ date: `${m}-01`, cumulative: S(last, 0), target_line: total ? S(Math.round(Number(g.target) * i / total), 0) : null }); }
  return { ...goal(g), series, entries: g.entries.slice().sort((a, b) => b.date.localeCompare(a.date)).map((e) => ({ ...e, amount: S(e.amount, 0) })) };
}

/* ================================================================ recurring & alerts */
function occurrences(rule: (typeof db.rules)[number], from: string, to: string): string[] {
  const out: string[] = [];
  if (rule.freq === "monthly" && rule.by_monthday) {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, rule.interval || 1)) {
      const d = `${m}-${String(Math.min(rule.by_monthday, dim(m))).padStart(2, "0")}`;
      if (d >= from && d <= to && d >= rule.start_date && (!rule.end_date || d <= rule.end_date)) out.push(d);
    }
  } else if (rule.freq === "weekly" && rule.by_weekday) {
    for (let d = from; d <= to; d = addDays(d, 1)) if (((noon(d).getUTCDay() + 6) % 7) + 1 === rule.by_weekday && d >= rule.start_date) out.push(d);
  } else if (rule.freq === "daily") { for (let d = from; d <= to; d = addDays(d, 1)) if (d >= rule.start_date) out.push(d); }
  else if (rule.freq === "yearly") { const md = rule.start_date.slice(4); for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) { const d = `${y}${md}`; if (d >= from && d <= to) out.push(d); } }
  return out;
}
function recurring(): L.RecurringResponse {
  const from = addDays(MOCK_TODAY, -14), to = addDays(MOCK_TODAY, 7);
  const upcoming: L.Occurrence[] = [];
  const rules = db.rules.map((r) => {
    const next = occurrences(r, MOCK_TODAY, addDays(MOCK_TODAY, 400)).find((d) => !db.occ[`${r.rule_id}|${d}`]) ?? null;
    if (r.is_active && r.mode === "confirm") occurrences(r, from, to).forEach((d) => {
      const o = db.occ[`${r.rule_id}|${d}`];
      if (d < "2026-10-25" && !o) return; // 舊的視為已處理（mock）
      if (o?.status === "confirmed" || o?.status === "skipped") return;
      upcoming.push({ rule_id: r.rule_id, rule_name: r.name, due_date: d, amount: M(Number(r.template.amount), r.template.currency), status: "pending", transaction_id: null });
    });
    return { ...r, next_due: next };
  });
  return { rules, upcoming: upcoming.sort((a, b) => a.due_date.localeCompare(b.due_date)) };
}
function alerts(): L.Alert[] {
  const out: L.Alert[] = [];
  db.accs.filter((a) => !a.deleted_at && !a.is_archived).forEach((a) => { const s = summary(a); if (s.reconcile.due && s.reconcile.last_at) out.push({ type: "reconcile_due", account_key: a.account_key, account_name: a.name, days: daysBetween(s.reconcile.last_at.slice(0, 10), MOCK_TODAY) }); });
  const unc = live().filter((r) => r.category_key === "uncategorized").length;
  if (unc) out.push({ type: "uncategorized", count: unc });
  recurring().upcoming.forEach((o) => out.push({ type: "recurring_due", rule_id: o.rule_id, name: o.rule_name, due_date: o.due_date, amount: o.amount }));
  const b = budgetSummary(MOCK_TODAY.slice(0, 7));
  b?.lines.filter((l) => l.status !== "ok").forEach((l) => out.push({ type: l.status === "over" ? "budget_over" : "budget_warning", category_key: l.category_key, name: l.name, ratio: l.ratio }));
  db.goals.map(goal).filter((g) => g.status === "active" && g.is_behind).forEach((g) => out.push({ type: "goal_behind", goal_id: g.goal_id, name: g.name }));
  db.accs.filter((a) => !a.deleted_at && !a.is_archived).forEach((a) => { const c = cardInfo(a)?.current_statement; if (c && !c.is_paid_off && c.days_until_due != null && c.days_until_due <= 7) out.push({ type: "card_due", account_key: a.account_key, name: a.name, due_date: c.due_date!, amount: c.amount }); });
  const missing = db.accs.filter((a) => !a.deleted_at && !a.is_archived && !a.opening && a.group !== "investment").length;
  if (missing) out.push({ type: "opening_missing", count: missing });
  return out;
}
function overview(q: Record<string, string>): L.Overview {
  const m = q.month || MOCK_TODAY.slice(0, 7);
  const from = `${m}-01`, to = monthEnd(m), pm = addMonths(m, -1);
  const day = m === MOCK_TODAY.slice(0, 7) ? Number(MOCK_TODAY.slice(8)) : dim(m);
  const rows = periodRows(from, to, false), prev = periodRows(`${pm}-01`, monthEnd(pm), false);
  const b = budgetSummary(m);
  const exp = (f: string, t: string) => periodRows(f, t, false).filter((r) => r.type === "expense" && isTWD(r)).reduce((s, r) => s + r.amount, 0);
  const avg30 = exp(addDays(MOCK_TODAY, -30), addDays(MOCK_TODAY, -1)) / 30;
  const ws = weekStart(MOCK_TODAY);
  const acc = accounts(false);
  return {
    month: m, kpi: kpi(from, to, `${pm}-01`, `${pm}-${String(Math.min(day, dim(pm))).padStart(2, "0")}`, false),
    today: { expense: S(exp(MOCK_TODAY, MOCK_TODAY), 0), vs_daily_average: S(avg30, 0) },
    this_week: { expense: S(exp(ws, MOCK_TODAY), 0), vs_weekly_average: S(avg30 * 7, 0) },
    budget: b, series: series(from, to, false, b?.total ? Number(b.total.limit) : null), categories: slices(rows, prev),
    projects: db.projects.filter((p) => p.status === "planned" || p.status === "active").map(project),
    goals: db.goals.filter((g) => g.status === "active").map(goal),
    accounts: { totals: acc.totals, investments: acc.investments },
    recent: live().filter((r) => r.leg !== "in").sort(order).slice(0, 10).map((r) => toTx(r)),
    alerts: alerts(), generated_at: nowISO(),
  };
}

/* ================================================================ writes */
function idem<T>(key: string | undefined, body: unknown, run: () => T): { status: "created" | "duplicate" } & T {
  if (!key || !/^[\w-]+:[\w-]+$/.test(key)) bad("VALIDATION_ERROR", "缺少 idempotency_key", { idempotency_key: ["必須是 web:<uuid> 格式"] });
  const hash = JSON.stringify(body, Object.keys(body as object).sort());
  const prev = db.idem.get(key!);
  if (prev) {
    if (prev.hash !== hash) throw new HttpError(fail(409, "IDEMPOTENCY_CONFLICT", "這筆已經以不同內容送出過"));
    return { status: "duplicate", ...(prev.result as T) };
  }
  const result = run();
  db.idem.set(key!, { hash, result });
  return { status: "created", ...result };
}
function checkAmount(s: unknown, field: string, cur = "TWD") {
  if (typeof s !== "string" || !/^-?\d+(\.\d+)?$/.test(s)) bad("VALIDATION_ERROR", "金額格式不正確", { [field]: ["請輸入數字"] });
  if (Number(s) <= 0) bad("AMOUNT_NOT_POSITIVE", "金額必須大於 0", { [field]: ["金額必須大於 0"] });
  if (!isMoney(s, decOf(cur))) bad("AMOUNT_PRECISION", `${cur} 最多 ${decOf(cur)} 位小數`, { [field]: [`最多 ${decOf(cur)} 位小數`] });
}
function checkAccount(k: unknown, field = "account_key"): Acc {
  const a = typeof k === "string" ? acc(k) : null;
  if (!a) bad("UNKNOWN_ACCOUNT", "這個帳戶已不存在", { [field]: ["帳戶不存在"] });
  if (a!.is_archived) bad("ACCOUNT_INACTIVE", "這個帳戶已封存", { [field]: ["帳戶已封存"] });
  if (a!.group === "investment") bad("VALIDATION_ERROR", "投資帳戶不能記帳", { [field]: ["投資帳戶由股票區管理"] });
  return a!;
}
function checkText(b: any) {
  const d: Record<string, string[]> = {};
  if (b.merchant && String(b.merchant).length > 200) d.merchant = ["最多 200 字"];
  if (b.note && String(b.note).length > 200) d.note = ["最多 200 字"];
  if (b.tag_ids && b.tag_ids.length > 10) d.tag_ids = ["最多 10 個標籤"];
  if (Object.keys(d).length) bad("VALIDATION_ERROR", "有欄位需要修正", d);
}
function splitAt(iso: string) { const d = new Date(iso); const t = new Date(d.getTime() + 8 * 3600e3).toISOString(); return { date: t.slice(0, 10), time: t.slice(11, 16) }; }
function createTx(b: L.CreateTransactionRequest) {
  if (b.type !== "expense" && b.type !== "income") bad("VALIDATION_ERROR", "類型不正確", { type: ["只能是支出或收入"] });
  const a = checkAccount(b.account_key);
  const cur = b.currency || a.currency;
  checkAmount(b.amount, "amount", cur);
  const c = cat(b.category_key);
  if (!c) bad("UNKNOWN_CATEGORY", "這個分類已不存在", { category_key: ["分類不存在"] });
  if (c!.kind !== b.type) bad("CATEGORY_KIND_MISMATCH", b.type === "expense" ? "支出不能選收入分類" : "收入不能選支出分類", { category_key: ["分類和類型不符"] });
  if (b.project_id && !db.projects.find((p) => p.project_id === b.project_id)) bad("UNKNOWN_PROJECT", "這個專案已不存在", { project_id: ["專案不存在"] });
  checkText(b);
  return idem(b.idempotency_key, b, () => {
    const { date, time } = splitAt(b.occurred_at || nowISO());
    const r = addRow({ type: b.type, direction: b.type === "income" ? "in" : "out", amount: Number(b.amount), currency: cur, date, time, account_key: a.account_key,
      category_key: b.category_key, merchant: b.merchant ?? null, note: b.note ?? null, tag_ids: b.tag_ids ?? [], project_id: b.project_id ?? null, source: "web",
      created_at: nowISO(), updated_at: nowISO() });
    return { transaction: toTx(r) };
  });
}
function createTransfer(b: L.CreateTransferRequest) {
  const from = checkAccount(b.from_account_key, "from_account_key"), to = checkAccount(b.to_account_key, "to_account_key");
  if (from.account_key === to.account_key) bad("TRANSFER_SAME_ACCOUNT", "轉出和轉入不能是同一個帳戶", { to_account_key: ["請選擇其他帳戶"] });
  if (b.type === "credit_card_payment" && to.group !== "credit_card") bad("CARD_PAYMENT_TARGET_NOT_CARD", "繳卡費的轉入帳戶必須是信用卡", { to_account_key: ["請選擇信用卡"] });
  checkAmount(b.amount_out, "amount_out", from.currency);
  if (from.currency !== to.currency && !b.amount_in) bad("VALIDATION_ERROR", "跨幣別轉帳要填轉入金額", { amount_in: ["請輸入轉入金額"] });
  if (b.amount_in) checkAmount(b.amount_in, "amount_in", to.currency);
  if (b.fee) checkAmount(b.fee.amount, "fee", from.currency);
  return idem(b.idempotency_key, b, () => {
    const { date, time } = splitAt(b.occurred_at || nowISO());
    const [o, i] = addTransfer({ type: b.type, from: from.account_key, to: to.account_key, out: Number(b.amount_out), in: b.amount_in ? Number(b.amount_in) : undefined, date, time, note: b.note ?? null,
      merchant: b.type === "credit_card_payment" ? `繳 ${to.name} 卡費` : null, fee: b.fee ? Number(b.fee.amount) : undefined, feeCat: b.fee?.category_key });
    [o, i].forEach((r) => { r.created_at = r.updated_at = nowISO(); });
    const fee = o.fee_id ? db.rows.find((r) => r.id === o.fee_id)! : null;
    return { legs: [toTx(o), toTx(i)] as [L.Transaction, L.Transaction], fee: fee ? toTx(fee) : null };
  });
}
function findLive(id: number) { const r = db.rows.find((x) => x.id === id && !x.deleted_at); if (!r) throw new HttpError(fail(404, "NOT_FOUND", "找不到這筆交易")); return r; }
function checkVersion(r: Row, v: unknown) {
  if (typeof v !== "number") bad("VALIDATION_ERROR", "缺少 expected_version", { expected_version: ["必填"] });
  if (r.version !== v) throw new HttpError(fail(409, "VERSION_CONFLICT", "這筆在別處被修改過", undefined, { ...toTx(r), history: r.history }));
}
function patchTx(id: number, b: L.UpdateTransactionRequest) {
  const r = findLive(id); checkVersion(r, b.expected_version);
  const p = b.patch ?? {}; const before: any = toTx(r); const changed: string[] = [];
  const set = <K extends keyof Row>(k: K, v: Row[K], field: string) => { if (v !== undefined && r[k] !== v) { (r as any)[k] = v; changed.push(field); } };
  if (r.group_id && r.leg) {
    const o = r.leg === "out" ? r : db.rows.find((x) => x.id === r.counterpart_id)!;
    const i = r.leg === "in" ? r : db.rows.find((x) => x.id === r.counterpart_id)!;
    if (p.amount_out) { checkAmount(p.amount_out, "amount_out", o.currency); o.amount = Number(p.amount_out); if (!p.amount_in && o.currency === i.currency) i.amount = o.amount; changed.push("amount"); }
    if (p.amount_in) { checkAmount(p.amount_in, "amount_in", i.currency); i.amount = Number(p.amount_in); changed.push("amount"); }
    if (p.from_account_key) { checkAccount(p.from_account_key, "from_account_key"); o.account_key = p.from_account_key; changed.push("account"); }
    if (p.to_account_key) { checkAccount(p.to_account_key, "to_account_key"); i.account_key = p.to_account_key; changed.push("account"); }
    if (o.account_key === i.account_key) bad("TRANSFER_SAME_ACCOUNT", "轉出和轉入不能是同一個帳戶", { to_account_key: ["請選擇其他帳戶"] });
    if (p.occurred_at) { const s = splitAt(p.occurred_at); [o, i].forEach((x) => { x.date = s.date; x.time = s.time; }); changed.push("occurred_at"); }
    if (p.note !== undefined) { [o, i].forEach((x) => (x.note = p.note ?? null)); changed.push("note"); }
    [o, i].forEach((x) => { x.version++; x.updated_at = nowISO(); x.history.push({ action: "update", actor: "網頁", at: nowISO(), changed_fields: [...new Set(changed)], before, after: toTx(x) }); });
    return { transaction: toTx(r), legs: [toTx(o), toTx(i)] };
  }
  if (p.type && p.type !== r.type) { if (r.type !== "expense" && r.type !== "income") bad("VALIDATION_ERROR", "這種交易不能改類型", { type: ["只能在支出和收入之間切換"] }); set("type", p.type, "type"); r.direction = p.type === "income" ? "in" : "out"; }
  if (p.account_key) { checkAccount(p.account_key); set("account_key", p.account_key, "account"); }
  if (p.amount) { checkAmount(p.amount, "amount", p.currency ?? r.currency); set("amount", Number(p.amount), "amount"); }
  if (p.currency) set("currency", p.currency, "currency");
  if (p.category_key) { const c = cat(p.category_key); if (!c) bad("UNKNOWN_CATEGORY", "這個分類已不存在", { category_key: ["分類不存在"] }); if (c!.kind !== r.type) bad("CATEGORY_KIND_MISMATCH", "支出不能選收入分類", { category_key: ["分類和類型不符"] }); set("category_key", p.category_key, "category"); }
  if (p.occurred_at) { const s = splitAt(p.occurred_at); if (s.date !== r.date || s.time !== r.time) { r.date = s.date; r.time = s.time; changed.push("occurred_at"); } }
  checkText(p);
  if (p.merchant !== undefined) set("merchant", p.merchant ?? null, "merchant");
  if (p.note !== undefined) set("note", p.note ?? null, "note");
  if (p.tag_ids) { if (JSON.stringify(p.tag_ids) !== JSON.stringify(r.tag_ids)) { r.tag_ids = p.tag_ids; changed.push("tags"); } }
  if (p.project_id !== undefined) set("project_id", p.project_id ?? null, "project");
  if (changed.length) { r.version++; r.updated_at = nowISO(); r.history.push({ action: "update", actor: "網頁", at: nowISO(), changed_fields: changed, before, after: toTx(r) }); }
  return { transaction: toTx(r) };
}
function groupRows(r: Row): Row[] { return r.group_id ? db.rows.filter((x) => x.group_id === r.group_id && !x.deleted_at) : [r]; }
function deleteTx(id: number, b: { expected_version?: number; reason?: string }) {
  const r = findLive(id); checkVersion(r, b.expected_version);
  const rows = groupRows(r); const purge = new Date(new Date(MOCK_NOW).getTime() + 30 * 864e5).toISOString().replace(".000Z", "Z");
  rows.forEach((x) => { x.deleted_at = nowISO(); x.history.push({ action: "delete", actor: "網頁", at: nowISO(), changed_fields: [], before: null, after: null }); });
  return { deleted_ids: rows.map((x) => x.id), purge_after: purge };
}
function restoreTx(id: number) {
  const r = db.rows.find((x) => x.id === id && x.deleted_at); if (!r) throw new HttpError(fail(404, "NOT_FOUND", "找不到可還原的交易"));
  if (!acc(r.account_key)) throw new HttpError(fail(409, "RESTORE_CONFLICT", "無法還原：帳戶已被刪除"));
  const rows = r.group_id ? db.rows.filter((x) => x.group_id === r.group_id && x.deleted_at) : [r];
  rows.forEach((x) => { x.deleted_at = null; x.version++; x.history.push({ action: "restore", actor: "網頁", at: nowISO(), changed_fields: [], before: null, after: null }); });
  return { restored: rows.map((x) => toTx(x)) };
}
function bulk(b: L.BulkRequest) {
  const rows = b.ids.map((id) => db.rows.find((x) => x.id === id && !x.deleted_at));
  if (rows.some((x) => !x)) throw new HttpError(fail(404, "NOT_FOUND", "部分交易已不存在，沒有任何變更"));
  if (b.action === "delete") { const all = new Set<Row>(); rows.forEach((r) => groupRows(r!).forEach((x) => all.add(x))); all.forEach((x) => { x.deleted_at = nowISO(); }); return { affected: all.size }; }
  const p = b.patch;
  if (p.category_key) { const c = cat(p.category_key); if (!c) bad("UNKNOWN_CATEGORY", "這個分類已不存在"); if (rows.some((r) => r!.type !== c!.kind)) bad("CATEGORY_KIND_MISMATCH", "選取的交易中有收入／支出不符這個分類"); }
  if (p.account_key) checkAccount(p.account_key);
  rows.forEach((r) => {
    const changed: string[] = [];
    if (p.category_key && (r!.type === "expense" || r!.type === "income")) { r!.category_key = p.category_key; changed.push("category"); }
    if (p.account_key && !r!.group_id) { r!.account_key = p.account_key; changed.push("account"); }
    if (p.tag_ids_add) { r!.tag_ids = [...new Set([...r!.tag_ids, ...p.tag_ids_add])]; changed.push("tags"); }
    if (p.tag_ids_remove) { r!.tag_ids = r!.tag_ids.filter((t) => !p.tag_ids_remove!.includes(t)); changed.push("tags"); }
    if (p.project_id !== undefined) { r!.project_id = p.project_id; changed.push("project"); }
    if (changed.length) { r!.version++; r!.updated_at = nowISO(); r!.history.push({ action: "update", actor: "網頁（批次）", at: nowISO(), changed_fields: changed, before: null, after: null }); }
  });
  return { affected: rows.length };
}

/* ---------------- accounts writes ---------------- */
function createAccount(b: any) {
  const d: Record<string, string[]> = {};
  if (!b.name?.trim()) d.name = ["請輸入名稱"];
  if (!GROUP_ORDER.includes(b.group)) d.group = [b.group === "investment" ? "投資帳戶由股票區管理" : "請選擇類型"];
  if (!db.currencies.find((c) => c.code === b.currency)) d.currency = ["不支援的幣別"];
  if (Object.keys(d).length) bad("VALIDATION_ERROR", "有欄位需要修正", d);
  const key = b.account_key || `${b.group}_${Date.now().toString(36)}`;
  if (db.accs.find((a) => a.account_key === key)) bad("VALIDATION_ERROR", "帳戶代碼重複", { account_key: ["已經有這個代碼"] });
  const a: Acc = { account_key: key, name: b.name.trim(), group: b.group, currency: b.currency, icon: b.icon ?? null, aliases: b.aliases ?? [], is_archived: false,
    sort_order: b.sort_order ?? db.accs.length, opening: b.opening ? { amount: Number(b.opening.amount) * (["credit_card", "liability"].includes(b.group) ? -1 : 1), at: b.opening.at } : null,
    latest_snapshot: null, reminder_days: b.reconcile_reminder_days ?? 30,
    credit_card: b.group === "credit_card" ? { statement_day: b.statement_day ?? null, due_day: b.due_day ?? null, credit_limit: b.credit_limit ?? null, current_statement: null } : null, deleted_at: null };
  db.accs.push(a);
  return { account: summary(a) };
}
function patchAccount(key: string, b: any) {
  const a = acc(key); if (!a) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個帳戶"));
  if (b.currency && b.currency !== a.currency && db.rows.some((r) => r.account_key === key)) bad("VALIDATION_ERROR", "已有交易的帳戶不能改幣別", { currency: ["已有交易，不能修改"] });
  if (b.group === "investment") bad("VALIDATION_ERROR", "不能改成投資帳戶", { group: ["投資帳戶由股票區管理"] });
  ["name", "group", "currency", "aliases", "icon", "sort_order"].forEach((k) => { if (b[k] !== undefined) (a as any)[k] = b[k]; });
  if (b.reconcile_reminder_days !== undefined) a.reminder_days = b.reconcile_reminder_days;
  if (a.credit_card) ["statement_day", "due_day", "credit_limit"].forEach((k) => { if (b[k] !== undefined) (a.credit_card as any)[k] = b[k]; });
  return { account: summary(a) };
}
function deletePreview(key: string): L.DeletePreview {
  const a = acc(key); if (!a) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個帳戶"));
  const rows = live().filter((r) => r.account_key === key);
  return { transactions: rows.length, transfer_groups: new Set(rows.filter((r) => r.group_id).map((r) => r.group_id)).size, reconciliations: db.recs.filter((r) => r.account_key === key).length,
    snapshots: a.latest_snapshot ? 1 : 0, used_by: { goals: db.goals.filter((g) => g.linked_account_key === key).map((g) => g.name), recurring: db.rules.filter((r) => r.template.account_key === key).map((r) => r.name), loans: [] },
    allowed_modes: rows.length ? ["merge", "with_transactions"] : ["empty"], merge_targets: db.accs.filter((x) => !x.deleted_at && !x.is_archived && x.account_key !== key && x.currency === a.currency && x.group !== "investment").map((x) => x.account_key) };
}
function deleteAccount(key: string, b: L.DeleteAccountRequest) {
  const a = acc(key); if (!a) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個帳戶"));
  const pv = deletePreview(key);
  if (pv.used_by.goals.length || pv.used_by.recurring.length) throw new HttpError(fail(409, "ACCOUNT_IN_USE", `這個帳戶被 ${[...pv.used_by.goals, ...pv.used_by.recurring].join("、")} 使用中`));
  if (!pv.allowed_modes.includes(b.mode)) bad("VALIDATION_ERROR", "這個帳戶不能用這種方式刪除", { mode: ["請選擇其他方式"] });
  const rows = live().filter((r) => r.account_key === key);
  if (b.mode === "merge") {
    const t = acc(b.target_key ?? ""); if (!t || t.currency !== a.currency) throw new HttpError(fail(400, "MERGE_INCOMPATIBLE", "只能合併到同幣別的帳戶"));
    if (rows.some((r) => r.counterpart_id && db.rows.find((x) => x.id === r.counterpart_id)?.account_key === t.account_key)) throw new HttpError(fail(400, "MERGE_CREATES_SELF_TRANSFER", "合併後會出現同一帳戶互轉，請先處理這些轉帳"));
    rows.forEach((r) => (r.account_key = t.account_key));
    a.deleted_at = nowISO();
    return { mode: b.mode, moved_transactions: rows.length };
  }
  if (b.mode === "with_transactions" && b.confirm_name !== a.name) throw new HttpError(fail(400, "CONFIRM_NAME_MISMATCH", "輸入的帳戶名稱不符"));
  rows.forEach((r) => groupRows(r).forEach((x) => (x.deleted_at = nowISO())));
  a.deleted_at = nowISO();
  return { mode: b.mode, deleted_transactions: rows.length, purge_after: "2026-12-03T19:05:00+08:00" };
}
function restoreAccount(key: string) {
  const a = db.accs.find((x) => x.account_key === key && x.deleted_at); if (!a) throw new HttpError(fail(404, "NOT_FOUND", "找不到可還原的帳戶"));
  const at = a.deleted_at; a.deleted_at = null;
  const rows = db.rows.filter((r) => r.account_key === key && r.deleted_at === at);
  rows.forEach((r) => groupRows({ ...r, deleted_at: null } as Row).length && db.rows.filter((x) => x.group_id && x.group_id === r.group_id).forEach((x) => (x.deleted_at = null)));
  rows.forEach((r) => (r.deleted_at = null));
  return { account: summary(a), restored_transactions: rows.length };
}
function openingWizard(): L.OpeningWizard {
  return { accounts: db.accs.filter((a) => !a.deleted_at && !a.is_archived).map((a) => {
    const liab = ["credit_card", "liability"].includes(a.group); const bal = balanceAt(a.account_key);
    return { account_key: a.account_key, name: a.name, group: a.group, currency: a.currency, latest_snapshot: a.latest_snapshot ?? (lastRec(a.account_key) ? { amount: lastRec(a.account_key)!.actual, as_of: lastRec(a.account_key)!.as_of } : null),
      opening: a.opening ? { amount: M(liab ? -a.opening.amount : a.opening.amount, a.currency), at: a.opening.at } : null, computed_now: bal == null ? null : M(bal, a.currency), is_liability: liab };
  }) };
}
function setOpening(b: L.OpeningRequest) {
  const d: Record<string, string[]> = {};
  b.items.forEach((it, i) => { const a = acc(it.account_key); if (!a) d[`items.${i}.account_key`] = ["帳戶不存在"]; else if (!/^\d+(\.\d+)?$/.test(it.amount)) d[`items.${i}.amount`] = ["請輸入 0 以上的數字"]; });
  if (Object.keys(d).length) bad("VALIDATION_ERROR", "有欄位需要修正", d);
  const saved = b.items.map((it) => { const a = acc(it.account_key)!; return [a, a.opening] as const; });
  b.items.forEach((it) => { const a = acc(it.account_key)!; const liab = ["credit_card", "liability"].includes(a.group); a.opening = { amount: Number(it.amount) * (liab ? -1 : 1), at: it.at || OPENING_AT }; });
  if (b.preview) {
    const res = { preview: openingWizard().accounts, totals: totals(db.accs.filter((a) => !a.deleted_at)) };
    saved.forEach(([a, o]) => (a.opening = o));
    return res;
  }
  return { updated: b.items.map((i) => i.account_key) };
}
function recPreview(b: { account_key: string; as_of: string; actual: string }): L.ReconcilePreview {
  const a = acc(b.account_key); if (!a) bad("UNKNOWN_ACCOUNT", "這個帳戶已不存在");
  if (!/^-?\d+(\.\d+)?$/.test(String(b.actual))) bad("VALIDATION_ERROR", "請輸入實際餘額", { actual: ["請輸入數字（可為負數）"] });
  const d = splitAt(b.as_of).date;
  const comp = balanceAt(a!.account_key, d);
  if (comp == null) bad("VALIDATION_ERROR", "這個帳戶還沒設定期初餘額，無法對帳", { account_key: ["請先設定期初"] });
  const last = lastRec(a!.account_key)?.as_of.slice(0, 10) ?? "0000";
  return { computed: M(comp!, a!.currency), diff: M(Number(b.actual) - comp!, a!.currency),
    transactions_since_last: live().filter((r) => r.account_key === a!.account_key && r.date > last && r.date <= d).sort(order).map((r) => toTx(r)) };
}
function reconcile(b: L.ReconcileRequest) {
  const pv = recPreview(b); const a = acc(b.account_key)!;
  let adj: Row | null = null;
  const diff = Number(pv.diff.amount);
  if (b.resolution === "adjusted" && diff !== 0) {
    const { date } = splitAt(b.as_of);
    adj = addRow({ type: "adjustment", direction: diff > 0 ? "in" : "out", amount: Math.abs(diff), currency: a.currency, date, time: "23:59", account_key: a.account_key, merchant: "餘額調整", note: b.note ?? "對帳調整", source: "web" });
  }
  const rec: L.Reconciliation = { reconciliation_id: `rec_${db.recs.length + 1}`, account_key: a.account_key, as_of: b.as_of, actual: M(Number(b.actual), a.currency), computed: pv.computed, diff: pv.diff,
    resolution: diff === 0 ? "matched" : b.resolution, adjustment_transaction_id: adj?.id ?? null, note: b.note ?? null, created_at: nowISO() };
  db.recs.push(rec);
  return { reconciliation: rec, adjustment: adj ? toTx(adj) : null };
}

/* ---------------- categories, tags, budgets, projects, goals, recurring ---------------- */
function createCategory(b: L.CategoryInput) {
  if (!b.name?.trim()) bad("VALIDATION_ERROR", "請輸入名稱", { name: ["請輸入名稱"] });
  if (b.parent_key) { const p = cat(b.parent_key); if (!p || p.parent_key) bad("UNKNOWN_CATEGORY", "主分類不存在"); if (p!.kind !== b.kind) bad("CATEGORY_KIND_MISMATCH", "子分類要和主分類同類型"); }
  const slug = `c${Date.now().toString(36)}`;
  const c = { category_key: b.parent_key ? `${b.parent_key}.${slug}` : slug, name: b.name.trim(), kind: b.kind, icon: b.icon ?? (b.parent_key ? cat(b.parent_key)!.icon : "dots"), is_hidden: false, sort_order: b.sort_order ?? 99, parent_key: b.parent_key ?? null };
  db.cats.push(c);
  return { category: c.parent_key ? { ...c, parent_key: c.parent_key } : { ...c, children: [] } };
}
function patchCategory(key: string, b: L.CategoryPatch) {
  const c = cat(key); if (!c) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個分類"));
  if (b.parent_key && c.parent_key) { const p = cat(b.parent_key); if (!p || p.kind !== c.kind || p.parent_key) bad("CATEGORY_KIND_MISMATCH", "只能移到同類型的主分類"); }
  Object.assign(c, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
  return { category: c };
}
function mergeCategory(b: { from_key: string; to_key: string }) {
  const f = cat(b.from_key), t = cat(b.to_key);
  if (!f || !t) bad("UNKNOWN_CATEGORY", "分類不存在");
  if (f!.kind !== t!.kind) bad("CATEGORY_KIND_MISMATCH", "只能合併同類型的分類");
  const rows = db.rows.filter((r) => r.category_key === b.from_key); rows.forEach((r) => (r.category_key = b.to_key));
  f!.is_hidden = true;
  return { moved_transactions: rows.length };
}
function putBudgets(b: L.BudgetPut) {
  const d: Record<string, string[]> = {};
  b.lines.forEach((l, i) => { if (!/^\d+(\.\d+)?$/.test(l.amount)) d[`lines.${i}.amount`] = ["請輸入 0 以上的數字"]; if (l.category_key && !cat(l.category_key)) d[`lines.${i}.category_key`] = ["分類不存在"]; });
  if (Object.keys(d).length) bad("VALIDATION_ERROR", "有欄位需要修正", d);
  db.budgets = db.budgets.filter((x) => x.effective_from !== b.effective_from);
  db.budgets.push({ effective_from: b.effective_from, lines: b.lines.map((l) => ({ category_key: l.category_key, amount: Number(l.amount), rollover: !!l.rollover })) });
  return budgetSummary(b.effective_from);
}
function suggestBudgets(b: { months: number }) {
  const n = b.months || 3, m0 = MOCK_TODAY.slice(0, 7); const by: Record<string, number> = {};
  for (let k = 1; k <= n; k++) { const m = addMonths(m0, -k); periodRows(`${m}-01`, monthEnd(m), true).filter((r) => r.type === "expense" && isTWD(r)).forEach((r) => addTo(by, mainOf(r.category_key === "uncategorized" ? "other" : r.category_key ?? "other"), r.amount)); }
  return { lines: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([category_key, v]) => ({ category_key, amount: S(Math.ceil(v / n / 100) * 100, 0) })) };
}
function upsertProject(id: string | null, b: any) {
  if (!id) {
    const d: Record<string, string[]> = {};
    if (!b.name?.trim()) d.name = ["請輸入名稱"];
    if (!b.start_date || !b.end_date || b.end_date < b.start_date) d.end_date = ["結束日要在開始日之後"];
    if (Object.keys(d).length) bad("VALIDATION_ERROR", "有欄位需要修正", d);
    const p = { project_id: `p_${Date.now().toString(36)}`, name: b.name.trim(), start_date: b.start_date, end_date: b.end_date, status: b.status ?? (b.start_date > MOCK_TODAY ? "planned" : "active"), count_in_monthly_budget: !!b.count_in_monthly_budget, budgets: b.budgets ?? [], note: b.note ?? null };
    db.projects.push(p as any);
    return { project: project(p as any) };
  }
  const p = db.projects.find((x) => x.project_id === id); if (!p) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個專案"));
  Object.assign(p, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
  return { project: project(p) };
}
function upsertGoal(id: string | null, b: any) {
  if (!id) {
    const d: Record<string, string[]> = {};
    if (!b.name?.trim()) d.name = ["請輸入名稱"];
    if (!isMoney(b.target, 2) || Number(b.target) <= 0) d.target = ["請輸入大於 0 的目標金額"];
    if (b.progress_mode === "linked_account" && !acc(b.linked_account_key)) d.linked_account_key = ["請選擇帳戶"];
    if (Object.keys(d).length) bad("VALIDATION_ERROR", "有欄位需要修正", d);
    const g = { goal_id: `g_${Date.now().toString(36)}`, name: b.name.trim(), currency: b.currency ?? "TWD", target: b.target, start_date: b.start_date ?? MOCK_TODAY, deadline: b.deadline ?? null,
      progress_mode: b.progress_mode ?? "manual", linked_account_key: b.linked_account_key ?? null, note: b.note ?? null, status: "active" as const,
      entries: b.start_amount && Number(b.start_amount) > 0 ? [{ entry_id: `e_${Date.now()}`, date: b.start_date ?? MOCK_TODAY, amount: Number(b.start_amount), note: "起始金額" }] : [] };
    db.goals.push(g);
    return { goal: goal(g) };
  }
  const g = db.goals.find((x) => x.goal_id === id); if (!g) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個目標"));
  Object.assign(g, Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== "start_amount")));
  return { goal: goal(g) };
}
function goalEntry(id: string, b: any) {
  const g = db.goals.find((x) => x.goal_id === id); if (!g) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個目標"));
  if (!/^-?\d+(\.\d+)?$/.test(String(b.amount)) || Number(b.amount) === 0) bad("VALIDATION_ERROR", "請輸入金額", { amount: ["存入請填正數、取出請填負數"] });
  const cur = g.entries.reduce((s, e) => s + e.amount, 0);
  if (cur + Number(b.amount) < 0) bad("VALIDATION_ERROR", "取出金額超過目前已存", { amount: [`最多可取出 ${cur}`] });
  return idem(b.idempotency_key, b, () => { g.entries.push({ entry_id: `e_${Date.now()}`, date: b.date ?? MOCK_TODAY, amount: Number(b.amount), note: b.note ?? null }); return { goal: goalDetail(id) }; });
}
function upsertRule(id: string | null, b: any) {
  if (!id) {
    if (!b.name?.trim()) bad("VALIDATION_ERROR", "請輸入名稱", { name: ["請輸入名稱"] });
    checkAccount(b.template?.account_key, "template.account_key"); checkAmount(b.template?.amount, "template.amount");
    const r = { ...b, rule_id: `r_${Date.now().toString(36)}` }; db.rules.push(r);
    return { rule: recurring().rules.find((x) => x.rule_id === r.rule_id) };
  }
  const r = db.rules.find((x) => x.rule_id === id); if (!r) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個週期規則"));
  Object.assign(r, Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)));
  return { rule: recurring().rules.find((x) => x.rule_id === id) };
}
function confirmOcc(id: string, date: string, b: { amount?: string }) {
  const r = db.rules.find((x) => x.rule_id === id); if (!r) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個週期規則"));
  const k = `${id}|${date}`;
  if (db.occ[k]?.status === "confirmed") return { transaction: toTx(db.rows.find((x) => x.id === db.occ[k].transaction_id)!) };
  if (b.amount) checkAmount(b.amount, "amount", r.template.currency);
  const t = r.template;
  const row = addRow({ type: t.type, direction: t.type === "income" ? "in" : "out", amount: Number(b.amount ?? t.amount), currency: t.currency, date, time: r.time_local.slice(0, 5), account_key: t.account_key, category_key: t.category_key, merchant: t.merchant ?? r.name, note: t.note ?? null, tag_ids: t.tag_ids ?? [], project_id: t.project_id ?? null, source: "auto", recurring_rule_id: id, created_at: nowISO(), updated_at: nowISO() });
  db.occ[k] = { status: "confirmed", transaction_id: row.id };
  return { transaction: toTx(row) };
}
function skipOcc(id: string, date: string) {
  const r = db.rules.find((x) => x.rule_id === id); if (!r) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個週期規則"));
  db.occ[`${id}|${date}`] = { status: "skipped", transaction_id: null };
  return { occurrence: { rule_id: id, rule_name: r.name, due_date: date, amount: M(Number(r.template.amount), r.template.currency), status: "skipped", transaction_id: null } };
}
function trash(): L.TrashResponse {
  const purge = (at: string) => new Date(new Date(at).getTime() + 30 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
  return { transactions: db.rows.filter((r) => r.deleted_at && r.leg !== "in" && !db.accs.find((a) => a.account_key === r.account_key)?.deleted_at).sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!)).map((r) => ({ ...toTx(r), deleted_at: r.deleted_at!, purge_after: purge(r.deleted_at!) })),
    accounts: db.accs.filter((a) => a.deleted_at).map((a) => ({ account_key: a.account_key, name: a.name, deleted_at: a.deleted_at!, purge_after: purge(a.deleted_at!), transactions: db.rows.filter((r) => r.account_key === a.account_key && r.deleted_at === a.deleted_at).length })) };
}
function merchantSuggest(q: Record<string, string>) {
  const s = (q.q ?? "").toLowerCase(); const o: Record<string, { use_count: number; last: Row }> = {};
  live().filter((r) => r.merchant && (r.type === "expense" || r.type === "income") && r.merchant.toLowerCase().includes(s)).forEach((r) => { const x = (o[r.merchant!] ??= { use_count: 0, last: r }); x.use_count++; if (r.date >= x.last.date) x.last = r; });
  return { rows: Object.entries(o).sort((a, b) => b[1].use_count - a[1].use_count).slice(0, Number(q.limit) || 10).map(([merchant, x]) => ({ merchant, use_count: x.use_count, last_category_key: x.last.category_key, last_account_key: x.last.account_key })) };
}
function exportCsv(q: Record<string, string>): MockResponse {
  const rows = filterRows(q);
  const head = ["id", "date", "time", "type", "direction", "amount", "currency", "account", "category", "merchant", "note", "tags", "project", "source"];
  const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r) => { const t = toTx(r); return [t.id, t.date, r.time, t.type, t.direction, t.amount.amount, t.amount.currency, t.account.name, t.category ? t.category.main.name + (t.category.sub ? " > " + t.category.sub.name : "") : "", t.merchant, t.note, t.tags.map((x) => x.name).join(" "), t.project?.name, t.source].map(cell).join(","); });
  return { status: 200, body: "﻿" + [head.join(","), ...lines].join("\n"), headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="finova-transactions.csv"' } };
}

/* ================================================================ router */
type H = (p: string[], q: Record<string, string>, b: any) => unknown;
const routes: [string, RegExp, H][] = [
  ["GET", /^\/catalog$/, () => catalog()],
  ["GET", /^\/overview$/, (_, q) => overview(q)],
  ["GET", /^\/transactions$/, (_, q) => listTransactions(q)],
  ["GET", /^\/transactions\/(\d+)$/, ([id]) => detail(+id)],
  ["GET", /^\/accounts$/, (_, q) => accounts(q.include_archived !== "false")],
  ["GET", /^\/accounts\/opening$/, () => openingWizard()],
  ["GET", /^\/accounts\/([^/]+)\/balance-series$/, ([k], q) => balanceSeries(decodeURIComponent(k), q)],
  ["GET", /^\/accounts\/([^/]+)\/delete-preview$/, ([k]) => deletePreview(decodeURIComponent(k))],
  ["GET", /^\/accounts\/([^/]+)$/, ([k], q) => accountDetail(decodeURIComponent(k), q)],
  ["GET", /^\/reports\/daily$/, (_, q) => dailyReport(q)],
  ["GET", /^\/reports\/weekly$/, (_, q) => weeklyReport(q)],
  ["GET", /^\/reports\/monthly$/, (_, q) => monthlyReport(q)],
  ["GET", /^\/reports\/range$/, (_, q) => rangeReport(q)],
  ["GET", /^\/reports\/trend$/, (_, q) => trend(q)],
  ["GET", /^\/budgets$/, (_, q) => budgetSummary(q.month) ?? { month: q.month, currency: "TWD", total: null, total_is_sum_of_categories: false, lines: [] }],
  ["GET", /^\/projects$/, (_, q) => ({ rows: db.projects.filter((p) => !q.status || p.status === q.status).map(project) })],
  ["GET", /^\/projects\/([^/]+)$/, ([id]) => projectDetail(id)],
  ["GET", /^\/goals$/, (_, q) => ({ rows: db.goals.map(goal).filter((g) => !q.status || g.status === q.status) })],
  ["GET", /^\/goals\/([^/]+)$/, ([id]) => goalDetail(id)],
  ["GET", /^\/reconciliations$/, (_, q) => ({ rows: db.recs.filter((r) => !q.account || r.account_key === q.account).sort((a, b) => b.as_of.localeCompare(a.as_of)) })],
  ["GET", /^\/recurring$/, () => recurring()],
  ["GET", /^\/merchants$/, (_, q) => merchantSuggest(q)],
  ["GET", /^\/trash$/, () => trash()],

  ["POST", /^\/transactions$/, (_, __, b) => createTx(b)],
  ["POST", /^\/transfers$/, (_, __, b) => createTransfer(b)],
  ["PATCH", /^\/transactions\/(\d+)$/, ([id], _, b) => patchTx(+id, b)],
  ["DELETE", /^\/transactions\/(\d+)$/, ([id], _, b) => deleteTx(+id, b ?? {})],
  ["POST", /^\/trash\/transactions\/(\d+)\/restore$/, ([id]) => restoreTx(+id)],
  ["POST", /^\/transactions\/bulk$/, (_, __, b) => bulk(b)],
  ["POST", /^\/accounts\/opening$/, (_, __, b) => setOpening(b)],
  ["POST", /^\/accounts$/, (_, __, b) => createAccount(b)],
  ["PATCH", /^\/accounts\/([^/]+)$/, ([k], _, b) => patchAccount(decodeURIComponent(k), b)],
  ["POST", /^\/accounts\/([^/]+)\/(archive|unarchive)$/, ([k, a]) => { const x = acc(decodeURIComponent(k)); if (!x) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個帳戶")); x.is_archived = a === "archive"; return { account: summary(x) }; }],
  ["DELETE", /^\/accounts\/([^/]+)$/, ([k], _, b) => deleteAccount(decodeURIComponent(k), b)],
  ["POST", /^\/trash\/accounts\/([^/]+)\/restore$/, ([k]) => restoreAccount(decodeURIComponent(k))],
  ["POST", /^\/reconciliations\/preview$/, (_, __, b) => recPreview(b)],
  ["POST", /^\/reconciliations$/, (_, __, b) => reconcile(b)],
  ["POST", /^\/categories\/merge$/, (_, __, b) => mergeCategory(b)],
  ["POST", /^\/categories$/, (_, __, b) => createCategory(b)],
  ["PATCH", /^\/categories\/([^/]+)$/, ([k], _, b) => patchCategory(decodeURIComponent(k), b)],
  ["POST", /^\/tags$/, (_, __, b) => { if (!b.name?.trim()) bad("VALIDATION_ERROR", "請輸入標籤名稱", { name: ["請輸入名稱"] }); const t = { tag_id: `t_${Date.now().toString(36)}`, name: b.name.trim() }; db.tags.push(t); return { tag: t }; }],
  ["PATCH", /^\/tags\/([^/]+)$/, ([id], _, b) => { const t = db.tags.find((x) => x.tag_id === id); if (!t) throw new HttpError(fail(404, "NOT_FOUND", "找不到這個標籤")); t.name = b.name; return { tag: t }; }],
  ["DELETE", /^\/tags\/([^/]+)$/, ([id]) => { db.tags = db.tags.filter((x) => x.tag_id !== id); db.rows.forEach((r) => (r.tag_ids = r.tag_ids.filter((t) => t !== id))); return { deleted: true }; }],
  ["PUT", /^\/budgets$/, (_, __, b) => putBudgets(b)],
  ["POST", /^\/budgets\/suggest$/, (_, __, b) => suggestBudgets(b)],
  ["POST", /^\/projects$/, (_, __, b) => upsertProject(null, b)],
  ["PATCH", /^\/projects\/([^/]+)$/, ([id], _, b) => upsertProject(id, b)],
  ["POST", /^\/goals\/([^/]+)\/entries$/, ([id], _, b) => goalEntry(id, b)],
  ["POST", /^\/goals$/, (_, __, b) => upsertGoal(null, b)],
  ["PATCH", /^\/goals\/([^/]+)$/, ([id], _, b) => upsertGoal(id, b)],
  ["POST", /^\/recurring\/([^/]+)\/occurrences\/([\d-]+)\/confirm$/, ([id, d], _, b) => confirmOcc(id, d, b ?? {})],
  ["POST", /^\/recurring\/([^/]+)\/occurrences\/([\d-]+)\/skip$/, ([id, d]) => skipOcc(id, d)],
  ["POST", /^\/recurring$/, (_, __, b) => upsertRule(null, b)],
  ["PATCH", /^\/recurring\/([^/]+)$/, ([id], _, b) => upsertRule(id, b)],
];

export function handle(method: string, path: string, query: Record<string, string>, body: unknown): MockResponse {
  if (method === "GET" && path === "/export.csv") return exportCsv(query);
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const hit = path.match(re);
    if (!hit) continue;
    try {
      const data = h(hit.slice(1), query, body);
      return ok(data, method === "POST" && (data as any)?.status === "created" ? 201 : 200);
    } catch (e) {
      if (e instanceof HttpError) return e.res;
      console.error("[mock]", e);
      return fail(500, "VALIDATION_ERROR", "Mock 伺服器錯誤：" + (e as Error).message);
    }
  }
  return fail(404, "NOT_FOUND", `沒有這個端點：${method} ${path}`);
}
/** 給「版本衝突」情境用：模擬別的裝置先改了這筆 */
export function bumpElsewhere(id: number) {
  const r = db.rows.find((x) => x.id === id && !x.deleted_at); if (!r) return;
  r.version++; r.note = (r.note ? r.note + "；" : "") + "（在手機捷徑改過）"; r.updated_at = MOCK_NOW;
  r.history.push({ action: "update", actor: "捷徑", at: MOCK_NOW, changed_fields: ["note"], before: null, after: null });
}
