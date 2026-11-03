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
