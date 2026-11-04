/**
 * Mock：信用卡電子帳單（契約 v1.1 提案，issue #15）。
 *
 * 帳單的每一行由「帳本裡這張卡在帳單期間的記錄」產生，再加上幾筆**合成**的行，
 * 讓逐筆對帳畫面每一種狀況都看得到：漏記、金額不同、疑似重複、退款、手續費、外幣、分期、繳款、
 * 日期有出入（模糊配對），以及「帳本有、帳單沒有」。
 * 帳單上的文字全部是虛構商家，金額都是整數；不使用任何真實帳單的資料。
 */
import type * as L from "../src/types/ledger";
import { acc, live, MOCK_NOW, type Row } from "./db";

export type SLine = {
  line_id: string; txn_date: string; post_date: string | null; description: string; amount: number;
  kind: L.StatementLineKind; fx: L.StatementLine["fx"];
  tx: number | null; confidence: "exact" | "fuzzy"; by: "auto" | "manual"; confirmed: boolean;
  ignored: boolean; reason: string | null; added: boolean; cat: string | null; raw: string;
};
export type SStmt = {
  statement_id: string; account_key: string; period_start: string; period_end: string; close_date: string; due_date: string;
  prev_balance: number; status: L.StatementStatus; received_at: string; reconciled_at: string | null; lines: SLine[];
};
export const stmts: SStmt[] = [];

const noon = (d: string) => new Date(d + "T12:00:00Z");
const addDays = (d: string, n: number) => { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** 以信用卡角度的金額：消費（流出）為正，退款／繳款（流入）為負 */
export const chargeOf = (r: Row) => (r.direction === "out" ? r.amount : -r.amount);

/* 虛構的帳單商家名稱（依主分類） */
const FAKE: Record<string, string[]> = {
  food: ["青禾食堂", "晨曦早餐坊", "暖陽小館"], shopping: ["星河生活百貨", "木棉選物", "晴空家用品", "米粒超市"],
  entertainment: ["月光影城", "方塊遊戲平台", "聲波歡唱"], subscription: ["雲聲音樂", "雲端書櫃"],
  transport: ["遠途航空", "島嶼高鐵"], home: ["旅宿通訂房網"], learning: ["紙頁書房"], personal: ["一般消費"], other: ["一般消費"],
};
function descOf(r: Row): string {
  if (r.type === "credit_card_payment" || r.type === "transfer") return "繳款－謝謝";
  if (r.type === "income") return "退款－" + (FAKE.shopping[r.id % FAKE.shopping.length]);
  const main = (r.category_key ?? "other").split(".")[0];
  const names = FAKE[main] ?? FAKE.other;
  return names[r.id % names.length];
}
const kindOf = (r: Row): L.StatementLineKind => (r.type === "credit_card_payment" || r.type === "transfer" ? "payment" : r.type === "income" ? "refund" : "purchase");
const md = (d: string) => d.slice(5).replace("-", "/");
const rawOf = (l: Pick<SLine, "txn_date" | "post_date" | "description" | "amount" | "fx">) =>
  `${md(l.txn_date)}  ${l.post_date ? md(l.post_date) : "     "}  ${l.description}${l.fx ? `  ${l.fx.currency} ${l.fx.amount}` : ""}  ${l.amount.toLocaleString("en-US")}`;

function line(id: string, p: Partial<SLine> & Pick<SLine, "txn_date" | "description" | "amount" | "kind">): SLine {
  const l: SLine = { line_id: id, post_date: addDays(p.txn_date, 2), fx: null, tx: null, confidence: "exact", by: "auto", confirmed: false, ignored: false, reason: null, added: false, cat: null, raw: "", ...p };
  l.raw = rawOf(l);
  return l;
}
const cardRows = (key: string, from: string, to: string) =>
  live().filter((r) => r.account_key === key && r.type !== "adjustment" && r.date >= from && r.date <= to).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id - b.id);

/** 依帳本產生一期帳單；所有行自動配對、完全吻合 */
function build(key: string, close: string, months: number, prev: number, status: L.StatementStatus): SStmt {
  const start = addDays(addMonthsDate(close, -months), 1);
  const sid = `st_${key.toLowerCase()}_${close.replace(/-/g, "")}`;
  const lines = cardRows(key, start, close).map((r, i) => line(`${sid}_${String(i + 1).padStart(2, "0")}`, {
    txn_date: r.date, description: descOf(r), amount: chargeOf(r), kind: kindOf(r), tx: r.id, cat: r.category_key,
    confirmed: status === "reconciled",
  }));
  return { statement_id: sid, account_key: key, period_start: start, period_end: close, close_date: close, due_date: addDays(close, 16), prev_balance: prev, status,
    received_at: `${addDays(close, 1)}T08:12:00+08:00`, reconciled_at: status === "reconciled" ? `${addDays(close, 18)}T21:00:00+08:00` : null, lines };
}
function addMonthsDate(d: string, k: number) {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + k, day = +d.slice(8);
  const ym = `${y + Math.floor(m / 12)}-${String(((m % 12) + 12) % 12 + 1).padStart(2, "0")}`;
  const dim = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
  return `${ym}-${String(Math.min(day, dim)).padStart(2, "0")}`;
}
const total = (s: SStmt) => s.prev_balance + s.lines.reduce((a, l) => a + l.amount, 0);

/* ------------------------------------------------------------ 產生 */
function seed() {
  if (!acc("Cube_Card") || !acc("ESun_Unicard")) return;
  // Cube 信用卡：結帳日 22 日。前兩期已核對，最新一期（9/23–10/22）各種狀況都有
  const c0 = build("Cube_Card", "2026-08-22", 1, 0, "reconciled");
  c0.prev_balance = -c0.lines.filter((l) => l.kind === "payment").reduce((a, l) => a + l.amount, 0);
  const c1 = build("Cube_Card", "2026-09-22", 1, total(c0), "reconciled");
  const c2 = build("Cube_Card", "2026-10-22", 1, total(c1), "in_review");
  const sid = c2.statement_id; let n = c2.lines.length;
  const nid = () => `${sid}_${String(++n).padStart(2, "0")}`;
  const buys = c2.lines.filter((l) => l.kind === "purchase");
  // 帳本有、帳單沒有：期末最後一筆消費（例如還沒入帳，會出現在下一期）
  const last = buys[buys.length - 1];
  if (last) c2.lines = c2.lines.filter((l) => l !== last);
  const pool = buys.filter((l) => l !== last);
  // 金額不同：帳單比帳本多 60
  const big = pool.slice().sort((a, b) => b.amount - a.amount)[0];
  if (big) { big.amount += 60; big.raw = rawOf(big); }
  // 日期有出入（模糊配對）：帳單消費日比帳本晚 1 天
  const fz = pool.find((l) => l !== big && l.amount < 2000);
  if (fz) { fz.txn_date = addDays(fz.txn_date, 1); fz.post_date = addDays(fz.txn_date, 2); fz.confidence = "fuzzy"; fz.raw = rawOf(fz); }
  // 疑似重複：同一天、同金額出現兩次（第二筆帳本沒有）
  const dupOf = pool.find((l) => l !== big && l !== fz && l.amount < 1000);
  if (dupOf) c2.lines.push(line(nid(), { txn_date: dupOf.txn_date, description: dupOf.description, amount: dupOf.amount, kind: "purchase", cat: dupOf.cat }));
  // 漏記、退款、外幣＋國外交易手續費、分期
  c2.lines.push(
    line(nid(), { txn_date: "2026-10-09", description: "雲朵咖啡工作室", amount: 180, kind: "purchase", cat: "food.drink" }),
    line(nid(), { txn_date: "2026-10-18", description: "退款－木棉選物", amount: -120, kind: "refund", cat: "income.refund" }),
    line(nid(), { txn_date: "2026-10-11", description: "PIXEL HARBOR GAMES", amount: 390, kind: "purchase", cat: "entertainment.game", fx: { amount: "12.00", currency: "USD" } }),
    line(nid(), { txn_date: "2026-10-11", description: "國外交易手續費", amount: 6, kind: "fee", cat: "personal.fee" }),
    line(nid(), { txn_date: "2026-10-20", description: "晨星家電 分期 2/6", amount: 1500, kind: "installment", cat: "shopping.electronics" }),
  );
  c2.lines.sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.line_id.localeCompare(b.line_id));
  // 玉山 Unicard：結帳日 25 日。最新一期全部吻合（只要「全部確認」再完成對帳）
  const u0 = build("ESun_Unicard", "2026-09-25", 1, 0, "reconciled");
  u0.prev_balance = -u0.lines.filter((l) => l.kind === "payment").reduce((a, l) => a + l.amount, 0);
  const u1 = build("ESun_Unicard", "2026-10-25", 1, total(u0), "in_review");
  stmts.push(c0, c1, c2, u0, u1);
}
seed();

/* ------------------------------------------------------------ 讀取（狀態由配對與帳本即時推算） */
const rowOf = (id: number | null) => (id == null ? null : live().find((r) => r.id === id) ?? null);
export function stateOf(s: SStmt, l: SLine): L.StatementLineState {
  if (l.ignored) return "ignored";
  const r = rowOf(l.tx);
  if (l.tx != null && !r) { l.tx = null; l.added = false; l.confirmed = false; } // 帳本那筆被刪掉了
  if (r) return chargeOf(r) !== l.amount ? "amount_differs" : l.added ? "added" : "matched";
  const dup = s.lines.some((o) => o !== l && !o.ignored && o.txn_date === l.txn_date && o.amount === l.amount);
  return dup ? "possible_duplicate" : "missing";
}
/** 被任何一期帳單配對到的帳本記錄 id */
const matchedIds = () => new Set(stmts.flatMap((s) => s.lines.filter((l) => !l.ignored && l.tx != null).map((l) => l.tx!)));
export function unmatchedRows(s: SStmt): Row[] {
  const used = matchedIds();
  return cardRows(s.account_key, s.period_start, s.period_end).filter((r) => !used.has(r.id));
}
export function candidatesOf(s: SStmt, l: SLine): number[] {
  const used = matchedIds();
  const near = cardRows(s.account_key, addDays(s.period_start, -7), addDays(s.period_end, 3)).filter((r) => !used.has(r.id) || r.id === l.tx);
  const dist = (r: Row) => Math.abs(chargeOf(r) - l.amount) * 100 + Math.abs(noon(r.date).getTime() - noon(l.txn_date).getTime()) / 864e5;
  return near.filter((r) => r.id !== l.tx && Math.sign(chargeOf(r)) === Math.sign(l.amount)).sort((a, b) => dist(a) - dist(b)).slice(0, 6).map((r) => r.id);
}
export const findStmt = (id: string) => stmts.find((s) => s.statement_id === id) ?? null;

/** 交易明細上的「已對帳」標記 */
export function stmtRef(rowId: number): L.StatementRef | null {
  for (const s of stmts) for (const l of s.lines) if (l.tx === rowId && !l.ignored) return { statement_id: s.statement_id, line_id: l.line_id, reconciled: s.status === "reconciled", close_date: s.close_date };
  return null;
}
export const nowStamp = () => MOCK_NOW;
export const lineTotal = total;
