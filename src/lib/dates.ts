/** 日期工具。時區 Asia/Taipei、一週從週一開始（契約 F-7）。 */
import type { ISODate, ISODateTime, ISOMonth, ISOWeek } from "../types/ledger";

export const TZ = "Asia/Taipei";
const WD = "日一二三四五六";

/** 測試／mock 可以固定「今天」；正式環境用台北時間的現在。 */
let fixedNow: Date | null = null;
export function setNow(d: Date | null) { fixedNow = d; }
export function now(): Date { return fixedNow ? new Date(fixedNow) : new Date(); }

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
function parts(d: Date) {
  const o: Record<string, string> = {};
  partsFmt.formatToParts(d).forEach((p) => (o[p.type] = p.value));
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour === "24" ? "00" : o.hour}:${o.minute}:${o.second}` };
}
export const today = (): ISODate => parts(now()).date;
export const nowTime = () => parts(now()).time.slice(0, 5);
/** 台北時間的 ISO 字串："2026-11-03T12:30:00+08:00" */
export function isoDateTime(date: ISODate, time = "12:00"): ISODateTime {
  return `${date}T${time.length === 5 ? time + ":00" : time}+08:00`;
}
export const nowISO = (): ISODateTime => { const p = parts(now()); return `${p.date}T${p.time}+08:00`; };
/** 取 ISODateTime 的台北日期與時間 */
export function splitDT(dt: ISODateTime): { date: ISODate; time: string } {
  const p = parts(new Date(dt));
  return { date: p.date, time: p.time.slice(0, 5) };
}

const noon = (d: ISODate) => new Date(d + "T12:00:00Z");
const iso = (x: Date) => x.toISOString().slice(0, 10);
export const addDays = (d: ISODate, n: number): ISODate => { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export const daysBetween = (a: ISODate, b: ISODate) => Math.round((noon(b).getTime() - noon(a).getTime()) / 864e5);
export const dow = (d: ISODate) => noon(d).getUTCDay(); // 0 = 週日
export const wd = (d: ISODate) => WD[dow(d)];
export const md = (d: ISODate) => d.slice(5, 7) + "/" + d.slice(8, 10);
export const slash = (d: string) => d.replace(/-/g, "/");
export const monthOf = (d: ISODate): ISOMonth => d.slice(0, 7);
export const daysInMonth = (m: ISOMonth) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
export const monthStart = (m: ISOMonth): ISODate => `${m}-01`;
export const monthEnd = (m: ISOMonth): ISODate => `${m}-${String(daysInMonth(m)).padStart(2, "0")}`;
export function addMonths(m: ISOMonth, k: number): ISOMonth {
  const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k;
  const yy = y + Math.floor(mo / 12), mm = ((mo % 12) + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, "0")}`;
}
export const monthLabel = (m: ISOMonth) => `${+m.slice(0, 4)} 年 ${+m.slice(5, 7)} 月`;
/** 週一 */
export const weekStart = (d: ISODate) => addDays(d, -((dow(d) + 6) % 7));
/** ISO 週："2026-W45" */
export function isoWeek(d: ISODate): ISOWeek {
  const t = noon(d);
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3); // 週四
  const y = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((t.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
export function weekToStart(w: ISOWeek): ISODate {
  const [y, n] = w.split("-W").map(Number);
  const jan4 = `${y}-01-04`;
  return addDays(weekStart(jan4), (n - 1) * 7);
}
