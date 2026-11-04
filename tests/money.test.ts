import { describe, expect, it } from "vitest";
import { add, sub, div, mulDiv, sumByCurrency, fmt } from "../src/lib/money";
import { groupHead } from "../src/ui/components";
import type * as L from "../src/types/ledger";

describe("十進位金額運算（契約 F-8）", () => {
  it("0.1 + 0.2 沒有浮點誤差", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // 對照：浮點數會出錯
    expect(add("0.1", "0.2")).toBe("0.3");
  });
  it("USDT 111.13 + 4.99", () => {
    expect(add("111.13", "4.99")).toBe("116.12");
    expect(fmt(add("111.13", "4.99"), "USDT")).toBe("USDT 116.12");
  });
  it("台幣 .5 相加與相減", () => {
    expect(add("0.5", "0.5", "120")).toBe("121");
    expect(sub("100", "100.5")).toBe("-0.5");
  });
  it("依幣別加總，不同幣別不相加", () => {
    const s = sumByCurrency([
      { currency: "TWD", amount: "0.1" }, { currency: "USDT", amount: "111.13" },
      { currency: "TWD", amount: "0.2" }, { currency: "USDT", amount: "4.99" },
    ]);
    expect(s).toEqual({ TWD: "0.3", USDT: "116.12" });
  });
  it("平均與比例四捨五入", () => {
    expect(div("100", 3, 0)).toBe("33");
    expect(div("200", 3, 2)).toBe("66.67");
    expect(div("-5", 2, 0)).toBe("-3");
    expect(mulDiv("12000", 7, 30, 0)).toBe("2800");
  });
});

describe("每日小計（groupHead）", () => {
  const tx = (id: number, amount: string, currency: string): L.Transaction => ({
    id, date: "2026-11-03", type: "expense", direction: "out", amount: { amount, currency }, merchant: "x",
  } as unknown as L.Transaction);
  it("小數金額加總正確", () => {
    const h = groupHead("2026-11-03", [tx(1, "0.1", "USDT"), tx(2, "0.2", "USDT"), tx(3, "111.13", "USDT"), tx(4, "4.99", "USDT")]);
    expect(h).toContain("USDT 116.42");
    expect(h).not.toContain("0000000");
  });
  it("多幣別分開列出，TWD 在前", () => {
    const h = groupHead("2026-11-03", [tx(1, "4.99", "USDT"), tx(2, "120", "TWD"), tx(3, "80", "TWD")]);
    expect(h).toMatch(/NT\$ 200.*USDT 4\.99/);
  });
});

describe("金額欄簡易計算機（issue #10）", () => {
  it("沒有運算子時原樣回傳", async () => {
    const { calc } = await import("../src/lib/money");
    expect(calc("120")).toBe("120");
    expect(calc("")).toBe("");
  });
  it("加減乘除與先乘除後加減", async () => {
    const { calc } = await import("../src/lib/money");
    expect(calc("120+35", 0)).toBe("155");
    expect(calc("0.1+0.2", 2)).toBe("0.3");
    expect(calc("2+3×4", 0)).toBe("14");
    expect(calc("100÷3", 2)).toBe("33.33");
    expect(calc("100÷3", 0)).toBe("33");
    expect(calc("1,200-200*2", 0)).toBe("800");
    expect(calc("111.13+4.99", 2)).toBe("116.12");
  });
  it("算式不完整或除以 0 回傳 null", async () => {
    const { calc } = await import("../src/lib/money");
    expect(calc("12+")).toBeNull();
    expect(calc("12*/3")).toBeNull();
    expect(calc("12+-3", 0)).toBe("9"); // 一元負號可以
    expect(calc("5÷0")).toBeNull();
    expect(calc("abc+1")).toBeNull();
  });
});
