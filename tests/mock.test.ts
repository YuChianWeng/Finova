import { describe, expect, it } from "vitest";
import { handle } from "../mocks/handlers";

const get = (path: string, q: Record<string, string> = {}) => (handle("GET", path, q, undefined).body as any).data;
const send = (m: string, path: string, b: unknown) => handle(m, path, {}, b);

describe("mock 資料與 DESIGN-BRIEF §8 一致", () => {
  it("帳戶餘額", () => {
    const a = get("/accounts");
    const bal = Object.fromEntries(a.groups.flatMap((g: any) => g.accounts).map((x: any) => [x.account_key, x.balance.computed?.amount ?? null]));
    expect(bal).toMatchObject({ Wallet_TWD: "1240", ESunBank: "18260", LineBank: "8300", Digital_Sub: "5120", Cube_Card: "-3870", ESun_Unicard: "-1230", EasyCard: "386", Student_Loan: "-50000", Binance_USDT: null });
    expect(a.totals.available_cash).toEqual({ TWD: "33306", USDT: "85.36" });
    expect(a.totals.credit_card_due).toEqual({ TWD: "5100" });
    expect(a.investments.find((i: any) => i.account_key === "Firstrade_USD").is_stale).toBe(true);
  });
  it("11 月 KPI 與 10 月同期比較", () => {
    const o = get("/overview");
    expect(o.kpi.income.TWD).toBe("7500");
    expect(o.kpi.expense.TWD).toBe("2539");
    expect(o.alerts.map((x: any) => x.type)).toEqual(expect.arrayContaining(["reconcile_due", "uncategorized", "recurring_due", "card_due", "opening_missing"]));
    expect(o.alerts.find((x: any) => x.type === "reconcile_due").days).toBe(32);
    expect(o.alerts.find((x: any) => x.type === "uncategorized").count).toBe(3);
  });
  it("10 月報表（不含專案）", () => {
    const m = get("/reports/monthly", { month: "2026-10", exclude_projects: "true" });
    expect(m.kpi.income.TWD).toBe("15200");
    expect(m.kpi.expense.TWD).toBe("12860");
    expect(m.kpi.expense.USDT).toBe("4.99");
    expect(m.kpi.savings_rate).toBeCloseTo(0.154, 3);
  });
  it("寫入：冪等、版本衝突、驗證", () => {
    const body = { idempotency_key: "web:test-1", type: "expense", amount: "120", currency: "TWD", account_key: "Wallet_TWD", category_key: "food.lunch", occurred_at: "2026-11-03T12:00:00+08:00" };
    const a = send("POST", "/transactions", body) as any;
    expect(a.status).toBe(201);
    expect((send("POST", "/transactions", body).body as any).data.status).toBe("duplicate");
    expect((send("POST", "/transactions", { ...body, amount: "130" }).body as any).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((send("POST", "/transactions", { ...body, idempotency_key: "web:test-2", category_key: "income.allowance" }).body as any).error.code).toBe("CATEGORY_KIND_MISMATCH");
    expect((send("POST", "/transactions", { ...body, idempotency_key: "web:test-3", amount: "0" }).body as any).error.code).toBe("AMOUNT_NOT_POSITIVE");
    const id = a.body.data.transaction.id;
    expect((send("PATCH", `/transactions/${id}`, { expected_version: 9, patch: { note: "x" } }).body as any).error.code).toBe("VERSION_CONFLICT");
    const ok = (send("PATCH", `/transactions/${id}`, { expected_version: 1, patch: { amount: "150" } }).body as any).data.transaction;
    expect(ok.version).toBe(2);
    expect((send("DELETE", `/transactions/${id}`, { expected_version: 2 }).body as any).data.deleted_ids).toEqual([id]);
    expect((send("POST", `/trash/transactions/${id}/restore`, {}).body as any).data.restored[0].id).toBe(id);
  });
  it("轉帳兩筆一組、交易後餘額", () => {
    const t = get("/transactions", { accounts: "LineBank", types: "transfer", from: "2026-10-20", to: "2026-10-20" });
    expect(t.rows[0].transfer.counterpart.account_key).toBe("ESunBank");
    expect(t.rows[0].balance_after).not.toBeNull();
  });
});
