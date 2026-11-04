/**
 * 平板／桌面「概覽」與帳戶頁用的序列計算（issue #12）。
 * 全部用 money.ts 的十進位字串運算，不經過浮點數；只有畫圖時才轉成 number。
 */
import type * as L from "../types/ledger";
import { add, sub, sign, toUnits, fromUnits } from "./money";
import { addDays, daysBetween, monthOf, weekStart, daysInMonth } from "./dates";

export type Gran = "day" | "week" | "month";
export type Bucket = { key: string; from: L.ISODate; to: L.ISODate; inc: string; exp: string; net: string; cum: string };

/** 區間內每一天（含頭尾） */
export const daysIn = (from: L.ISODate, to: L.ISODate) => Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, i) => addDays(from, i));

/**
 * 把交易加總成每日收入／支出（只算指定幣別，預設 TWD；不同幣別不相加）。
 * 只計 expense／income，轉帳、繳卡費、餘額調整不算收支（和契約 summary 一致）。
 */
export function dailyTotals(rows: L.Transaction[], from: L.ISODate, to: L.ISODate, currency = "TWD") {
  const inc: Record<string, bigint> = {}, exp: Record<string, bigint> = {};
  rows.forEach((t) => {
    if (t.amount.currency !== currency || t.date < from || t.date > to) return;
    if (t.type === "income") inc[t.date] = (inc[t.date] ?? 0n) + toUnits(t.amount.amount);
    else if (t.type === "expense") exp[t.date] = (exp[t.date] ?? 0n) + toUnits(t.amount.amount);
  });
  return daysIn(from, to).map((d) => ({ date: d, inc: fromUnits(inc[d] ?? 0n), exp: fromUnits(exp[d] ?? 0n) }));
}

/** 依粒度分組（週一開始的週、月），並算出累積淨額（收入 − 支出） */
export function buckets(days: { date: L.ISODate; inc: string; exp: string }[], g: Gran): Bucket[] {
  const keyOf = (d: string) => (g === "day" ? d : g === "week" ? weekStart(d) : monthOf(d));
  const out: Bucket[] = [];
  let cum = "0";
  days.forEach((x) => {
    const k = keyOf(x.date);
    let b = out[out.length - 1];
    if (!b || b.key !== k) { b = { key: k, from: x.date, to: x.date, inc: "0", exp: "0", net: "0", cum }; out.push(b); }
    b.to = x.date; b.inc = add(b.inc, x.inc); b.exp = add(b.exp, x.exp); b.net = sub(b.inc, b.exp);
    cum = add(cum, x.inc, "-" + x.exp.replace(/^-/, "")); b.cum = cum;
  });
  return out;
}

/** 和上一期比較：差額與比例（上期為 0 時比例為 null） */
export function delta(cur: string, prev: string): { change: string; ratio: number | null } {
  const change = sub(cur, prev);
  const p = toUnits(prev);
  if (p === 0n) return { change, ratio: null };
  // 比例只用來顯示百分比，這裡才轉成 number
  return { change, ratio: Number((toUnits(change) * 1_000_000n) / (p < 0n ? -p : p)) / 1_000_000 };
}

/** 依頻率往後推一期 */
function step(d: L.ISODate, r: Pick<L.RecurringRule, "freq" | "interval" | "by_monthday">, start: L.ISODate): L.ISODate {
  const n = Math.max(1, r.interval || 1);
  if (r.freq === "daily") return addDays(d, n);
  if (r.freq === "weekly") return addDays(d, 7 * n);
  const months = r.freq === "monthly" ? n : 12 * n;
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + months;
  const ym = `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}` as L.ISOMonth;
  const want = r.freq === "monthly" && r.by_monthday ? r.by_monthday : +start.slice(8);
  return `${ym}-${String(Math.min(want, daysInMonth(ym))).padStart(2, "0")}`;
}
/**
 * 週期交易：這一期是第幾期（從 start_date 算起，第 1 期 = start_date），以及到 end_date 為止還剩幾期（含這一期）。
 * 契約沒有期數欄位，這裡在前端推算（Asia/Taipei 日期，不含時間）。
 */
export function periodInfo(rule: Pick<L.RecurringRule, "freq" | "interval" | "by_monthday" | "start_date" | "end_date">, due: L.ISODate): { index: number | null; remaining: number | null } {
  let d = rule.start_date, i = 1;
  if (due < d) return { index: null, remaining: null };
  for (; d < due && i < 5000; i++) d = step(d, rule, rule.start_date);
  const index = d === due ? i : null;
  if (!rule.end_date) return { index, remaining: null };
  let left = 0, e = due;
  for (; e <= rule.end_date && left < 5000; left++) e = step(e, rule, rule.start_date);
  return { index, remaining: left };
}

/** 依方向帶正負號的金額：流入 +、流出 − */
export const signed = (t: L.Transaction) => (t.direction === "in" ? t.amount.amount : "-" + t.amount.amount.replace(/^-/, ""));
export const isPositive = (s: string) => sign(s) > 0;
