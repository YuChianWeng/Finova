import { describe, expect, it } from "vitest";
import { dailyTotals, buckets, delta, periodInfo } from "../src/lib/series";
import type * as L from "../src/types/ledger";

const tx = (date: string, type: string, amount: string, currency = "TWD"): L.Transaction =>
  ({ id: 1, date, type, direction: type === "income" ? "in" : "out", amount: { amount, currency } } as unknown as L.Transaction);

describe("概覽序列（issue #12）", () => {
  const rows = [tx("2026-01-01", "expense", "0.1"), tx("2026-01-01", "expense", "0.2"), tx("2026-01-02", "income", "100"),
    tx("2026-01-02", "expense", "4.99", "USDT"), tx("2026-01-03", "transfer", "500"), tx("2026-01-05", "expense", "10")];
  it("每日收支：十進位、只算 TWD、不含轉帳", () => {
    const d = dailyTotals(rows, "2026-01-01", "2026-01-05");
    expect(d.map((x) => [x.date, x.inc, x.exp])).toEqual([["2026-01-01", "0", "0.3"], ["2026-01-02", "100", "0"], ["2026-01-03", "0", "0"], ["2026-01-04", "0", "0"], ["2026-01-05", "0", "10"]]);
  });
  it("累積淨額與按週分組（週一開始）", () => {
    const d = dailyTotals(rows, "2026-01-01", "2026-01-05");
    expect(buckets(d, "day").map((b) => b.cum)).toEqual(["-0.3", "99.7", "99.7", "99.7", "89.7"]);
    const w = buckets(d, "week"); // 2026-01-01 是週四；01-05 是下週一
    expect(w.map((b) => [b.from, b.to, b.inc, b.exp, b.cum])).toEqual([["2026-01-01", "2026-01-04", "100", "0.3", "99.7"], ["2026-01-05", "2026-01-05", "0", "10", "89.7"]]);
  });
  it("和上一期比較", () => {
    expect(delta("120", "100")).toEqual({ change: "20", ratio: 0.2 });
    expect(delta("50", "0").ratio).toBeNull();
    expect(delta("-30", "-60")).toEqual({ change: "30", ratio: 0.5 });
  });
  it("週期交易的期數與剩餘期數", () => {
    const m = { freq: "monthly" as const, interval: 1, by_monthday: 31, start_date: "2026-01-31", end_date: null };
    expect(periodInfo(m, "2026-01-31")).toEqual({ index: 1, remaining: null });
    expect(periodInfo(m, "2026-02-28").index).toBe(2);
    expect(periodInfo(m, "2026-04-30").index).toBe(4);
    const w = { freq: "weekly" as const, interval: 2, by_monthday: null, start_date: "2026-01-05", end_date: "2026-03-02" };
    expect(periodInfo(w, "2026-02-02")).toEqual({ index: 3, remaining: 3 });
    expect(periodInfo(w, "2026-02-03").index).toBeNull();
  });
});
