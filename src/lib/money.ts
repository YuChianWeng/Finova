/**
 * 金額工具。契約規定金額一律用十進位字串傳遞（F-8），不同幣別絕不相加。
 * 加減比較用 BigInt 定點運算（小數 8 位），避免浮點誤差；只有畫圖時才轉成 number。
 */
import type { CurrencyCode, Money, MoneyByCurrency } from "../types/ledger";

const SCALE = 8;
const F = 10n ** BigInt(SCALE);
export const MINUS = "−";

export function toUnits(s: string | number | null | undefined): bigint {
  if (s == null || s === "") return 0n;
  let str = String(s).trim().replace(/,/g, "").replace(MINUS, "-");
  let neg = false;
  if (str.startsWith("-")) { neg = true; str = str.slice(1); } else if (str.startsWith("+")) str = str.slice(1);
  if (!/^\d*(\.\d*)?$/.test(str)) throw new Error(`不是合法的金額：${s}`);
  const [i = "0", f = ""] = str.split(".");
  const v = BigInt(i || "0") * F + BigInt((f + "0".repeat(SCALE)).slice(0, SCALE) || "0");
  return neg ? -v : v;
}

export function fromUnits(u: bigint, decimals = SCALE): string {
  const neg = u < 0n;
  let a = neg ? -u : u;
  if (decimals < SCALE) {
    const d = 10n ** BigInt(SCALE - decimals);
    a = (a + d / 2n) / d * d; // 四捨五入
  }
  const i = a / F;
  let f = (a % F).toString().padStart(SCALE, "0").slice(0, Math.max(decimals, 0)).replace(/0+$/, "");
  const out = f ? `${i}.${f}` : `${i}`;
  return neg && out !== "0" ? `-${out}` : out;
}

export const add = (...xs: (string | null | undefined)[]) => fromUnits(xs.reduce<bigint>((s, x) => s + toUnits(x), 0n));
export const sub = (a: string, b: string) => fromUnits(toUnits(a) - toUnits(b));
export const neg = (a: string) => fromUnits(-toUnits(a));
export const abs = (a: string) => fromUnits(toUnits(a) < 0n ? -toUnits(a) : toUnits(a));
export const cmp = (a: string, b: string) => { const d = toUnits(a) - toUnits(b); return d > 0n ? 1 : d < 0n ? -1 : 0; };
export const sign = (a: string | null | undefined) => cmp(a ?? "0", "0");
export const isZero = (a: string | null | undefined) => sign(a) === 0;
export const num = (a: string | null | undefined) => Number(a ?? 0); // 只用於圖表比例

/** 合法的正數金額字串（依幣別小數位數）。 */
export function isPositiveAmount(s: string, decimals = 2): boolean {
  if (!/^\d+(\.\d+)?$/.test(s)) return false;
  const f = s.split(".")[1] ?? "";
  return f.length <= decimals && toUnits(s) > 0n;
}

/* ---------------- 顯示格式（由前端負責，契約 §1.2） ---------------- */
export type CurrencyInfo = { code: CurrencyCode; name: string; symbol: string; decimals: number };
const DEFAULT_CUR: Record<string, CurrencyInfo> = {
  TWD: { code: "TWD", name: "新台幣", symbol: "NT$", decimals: 0 },
  USD: { code: "USD", name: "美元", symbol: "US$", decimals: 2 },
  JPY: { code: "JPY", name: "日圓", symbol: "¥", decimals: 0 },
  USDT: { code: "USDT", name: "USDT", symbol: "USDT", decimals: 2 },
};
let CUR: Record<string, CurrencyInfo> = { ...DEFAULT_CUR };
export function setCurrencies(list: CurrencyInfo[]) {
  CUR = { ...DEFAULT_CUR };
  list.forEach((c) => (CUR[c.code] = c));
}
export const curInfo = (c: CurrencyCode): CurrencyInfo => CUR[c] ?? { code: c, name: c, symbol: c, decimals: 2 };

function group(intPart: string) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** 1234.5 → "1,234.50"（依幣別位數，不含符號） */
export function plain(amount: string, currency: CurrencyCode = "TWD", decimals?: number): string {
  const d = decimals ?? curInfo(currency).decimals;
  const s = fromUnits(toUnits(abs(amount)), d);
  const [i, f = ""] = s.split(".");
  return d > 0 && f !== "" ? `${group(i)}.${f.padEnd(Math.min(d, 2), "0")}` : group(i);
}
/** "NT$ 12,345"，負數為 "−NT$ 120" */
export function fmt(amount: string, currency: CurrencyCode = "TWD"): string {
  const info = curInfo(currency);
  const body = `${info.symbol} ${plain(amount, currency)}`;
  return sign(amount) < 0 ? MINUS + body : body;
}
/** 永遠帶正負號："+NT$ 300" / "−NT$ 120" */
export function fmtSigned(amount: string, currency: CurrencyCode = "TWD"): string {
  return (sign(amount) < 0 ? MINUS : "+") + `${curInfo(currency).symbol} ${plain(amount, currency)}`;
}
export const fmtMoney = (m: Money | null | undefined) => (m ? fmt(m.amount, m.currency) : "—");
/** 圖表軸用：12.4k */
export function short(v: number): string {
  const a = Math.abs(v), s = v < 0 ? MINUS : "";
  if (a >= 1000) { const k = a / 1000; return s + (k % 1 ? k.toFixed(1) : k) + "k"; }
  return s + Math.round(a);
}
export const pct1 = (x: number | null | undefined) => (x == null ? "—" : (x * 100).toFixed(1) + "%");

/** MoneyByCurrency 列出每個幣別，絕不相加。TWD 排第一。 */
export function byCurrency(m: MoneyByCurrency | null | undefined): Money[] {
  if (!m) return [];
  return Object.entries(m)
    .sort(([a], [b]) => (a === "TWD" ? -1 : b === "TWD" ? 1 : a.localeCompare(b)))
    .map(([currency, amount]) => ({ currency, amount }));
}
export const twd = (m: MoneyByCurrency | null | undefined) => m?.TWD ?? "0";

/** 依幣別加總（十進位），回傳 { TWD: "123.5", USDT: "111.13" }。不同幣別絕不相加。 */
export function sumByCurrency(list: Money[]): Record<string, string> {
  const o: Record<string, bigint> = {};
  list.forEach((m) => (o[m.currency] = (o[m.currency] ?? 0n) + toUnits(m.amount)));
  return Object.fromEntries(Object.entries(o).map(([c, u]) => [c, fromUnits(u)]));
}
/** 金額除以整數（例如平均），結果四捨五入到小數 decimals 位。 */
export function div(a: string, n: number, decimals = SCALE): string {
  if (!n) return "0";
  const u = toUnits(a), d = BigInt(n);
  const q = (u * 2n + (u < 0n ? -d : d)) / (2n * d); // 四捨五入到最小單位
  return fromUnits(q, decimals);
}
/** a × m ÷ n（例如週預算＝月預算 × 7 ÷ 30），四捨五入到小數 decimals 位。 */
export const mulDiv = (a: string, m: number, n: number, decimals = SCALE) => div(fromUnits(toUnits(a) * BigInt(m)), n, decimals);

/**
 * 金額欄的簡易計算機（issue #10）：支援 + − × ÷ 與小數，例如 "120+35"、"1,200÷3"。
 * 用十進位定點運算，不經過浮點數。沒有運算子時原樣回傳（交給一般驗證）；算式看不懂時回傳 null。
 * 有運算子時，結果四捨五入到該幣別的小數位數。
 */
export const hasOperator = (s: string) => /[+\-*/×÷＋−]/.test(s.replace(/^[+-]/, ""));
export function calc(expr: string, decimals = SCALE): string | null {
  const s = expr.replace(/[,\s]/g, "").replace(/[＋]/g, "+").replace(/[−–]/g, "-").replace(/[×xX]/g, "*").replace(/÷/g, "/");
  if (!s) return "";
  if (!hasOperator(s)) return s;
  const toks = s.match(/\d*\.?\d+|\d+\.|[+\-*/]/g);
  if (!toks || toks.join("") !== s) return null;
  // 先算乘除，再算加減
  const nums: bigint[] = [], ops: string[] = [];
  let i = 0, expectNum = true;
  const mul = (a: bigint, b: bigint) => (a * b) / F;
  const dv = (a: bigint, b: bigint) => { if (b === 0n) throw new Error("÷0"); const q = (a * F * 2n) / b; return (q + (q < 0n ? -1n : 1n)) / 2n; };
  try {
    while (i < toks.length) {
      const t = toks[i];
      if (expectNum) {
        let neg = false;
        if (t === "-" || t === "+") { neg = t === "-"; i++; }
        const n = toks[i]; if (n === undefined || /[+\-*/]/.test(n)) return null;
        let v = toUnits(n); if (neg) v = -v;
        const op = ops[ops.length - 1];
        if (op === "*" || op === "/") { ops.pop(); const a = nums.pop()!; v = op === "*" ? mul(a, v) : dv(a, v); }
        nums.push(v); expectNum = false; i++;
      } else {
        if (!/[+\-*/]/.test(t)) return null;
        ops.push(t); expectNum = true; i++;
      }
    }
    if (expectNum) return null; // 結尾是運算子
    let r = nums[0];
    for (let k = 0; k < ops.length; k++) r = ops[k] === "+" ? r + nums[k + 1] : r - nums[k + 1];
    return fromUnits(r, decimals);
  } catch { return null; }
}
