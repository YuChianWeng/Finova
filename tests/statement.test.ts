import { describe, expect, it } from "vitest";
import type * as L from "../src/types/ledger";
import { handle } from "../mocks/handlers";
import { needsAction, canFinalize, statementTotals, sortLines, bulkConfirmable, chipOf, charge } from "../src/lib/statement";

const get = (path: string, q: Record<string, string> = {}) => (handle("GET", path, q, undefined).body as any).data;
const post = (path: string, b: unknown = {}) => handle("POST", path, {}, b);
const data = (r: { body: unknown }) => (r.body as any).data;
const err = (r: { body: unknown }) => (r.body as any).error;

const M = (amount: string): L.Money => ({ amount, currency: "TWD" });
const ln = (p: Partial<L.StatementLine>): L.StatementLine => ({
  line_id: "x", txn_date: "2026-10-01", post_date: null, description: "", amount: M("100"), kind: "purchase", fx: null, state: "missing",
  match: null, candidates: [], suggested_category_key: null, ignore_reason: null, raw_text: null, ...p,
});
const stmt = (status: L.StatementStatus = "in_review") => ({ status } as L.Statement);

describe("逐筆對帳：狀態與完成條件（純邏輯）", () => {
  it("需要處理：漏記、金額不同、疑似重複、已配對但未確認", () => {
    expect(needsAction(ln({ state: "missing" }))).toBe(true);
    expect(needsAction(ln({ state: "amount_differs" }))).toBe(true);
    expect(needsAction(ln({ state: "possible_duplicate" }))).toBe(true);
    expect(needsAction(ln({ state: "matched", match: { transaction_id: 1, confidence: "exact", by: "auto", confirmed: false } }))).toBe(true);
    expect(needsAction(ln({ state: "matched", match: { transaction_id: 1, confidence: "exact", by: "auto", confirmed: true } }))).toBe(false);
    expect(needsAction(ln({ state: "ignored" }))).toBe(false);
    expect(needsAction(ln({ state: "added" }))).toBe(false);
  });
  it("差額：忽略的行不算；沒配對的行帳本側算 0；用十進位運算", () => {
    const ledger = new Map<number, Pick<L.Transaction, "direction" | "amount">>([[1, { direction: "out", amount: M("0.1") }], [2, { direction: "in", amount: M("50") }]]);
    const lines = [
      ln({ amount: M("0.1"), state: "matched", match: { transaction_id: 1, confidence: "exact", by: "auto", confirmed: true } }),
      ln({ amount: M("0.2"), state: "missing" }),
      ln({ amount: M("-50"), kind: "refund", state: "matched", match: { transaction_id: 2, confidence: "exact", by: "auto", confirmed: true } }),
      ln({ amount: M("999"), state: "ignored" }),
    ];
    expect(statementTotals(lines, ledger)).toEqual({ statement: "-49.7", matched: "-49.9", diff: "0.2" });
    expect(charge({ direction: "in", amount: M("50") })).toBe("-50");
  });
  it("完成對帳：還有要處理的、差額不為 0、離線、已完成 都不能按，並說明原因", () => {
    const ok = ln({ state: "matched", match: { transaction_id: 1, confidence: "exact", by: "auto", confirmed: true } });
    expect(canFinalize({ statement: stmt(), lines: [ok], diff: M("0") })).toEqual({ ok: true });
    expect(canFinalize({ statement: stmt(), lines: [ok, ln({ state: "missing" })], diff: M("100") })).toEqual({ ok: false, reason: "還有 1 筆需要處理" });
    expect(canFinalize({ statement: stmt(), lines: [ok], diff: M("-6") })).toEqual({ ok: false, reason: "差額不為 0" });
    expect(canFinalize({ statement: stmt(), lines: [ok], diff: M("0") }, false).ok).toBe(false);
    expect(canFinalize({ statement: stmt("reconciled"), lines: [ok], diff: M("0") }).ok).toBe(false);
  });
  it("排序：需要處理的在前（金額不同 → 帳本沒有 → 疑似重複 → 待確認），其餘依日期", () => {
    const a = ln({ line_id: "a", txn_date: "2026-10-05", state: "matched", match: { transaction_id: 1, confidence: "exact", by: "auto", confirmed: true } });
    const b = ln({ line_id: "b", txn_date: "2026-10-09", state: "missing" });
    const c = ln({ line_id: "c", txn_date: "2026-10-01", state: "amount_differs" });
    const d = ln({ line_id: "d", txn_date: "2026-10-02", state: "ignored" });
    expect(sortLines([a, b, c, d]).map((x) => x.line_id)).toEqual(["c", "b", "a", "d"]);
  });
  it("chip 有文字和圖示，不只靠顏色", () => {
    const c = chipOf(ln({ state: "matched", match: { transaction_id: 1, confidence: "fuzzy", by: "auto", confirmed: false } }));
    expect(c.text).toBe("已配對・有出入");
    expect(c.icon).toBeTruthy();
  });
});

describe("逐筆對帳：mock 走完整個流程", () => {
  it("帳單清單只有信用卡，最新一期待核對", () => {
    const rows: L.Statement[] = get("/statements", { account: "Cube_Card" }).rows;
    expect(rows.map((r) => r.status)).toEqual(["in_review", "reconciled", "reconciled"]);
    expect(get("/statements", { account: "ESunBank" }).rows).toEqual([]);
  });
  it("Cube 最新一期涵蓋所有狀況，處理完才能完成對帳", () => {
    const id = get("/statements", { account: "Cube_Card" }).rows[0].statement_id;
    let d: L.StatementDetail = get(`/statements/${id}`);
    const states = new Set(d.lines.map((l) => l.state));
    for (const s of ["matched", "missing", "amount_differs", "possible_duplicate"]) expect(states.has(s as L.StatementLineState)).toBe(true);
    const kinds = new Set(d.lines.map((l) => l.kind));
    for (const k of ["purchase", "refund", "fee", "installment", "payment"]) expect(kinds.has(k as L.StatementLineKind)).toBe(true);
    expect(d.lines.some((l) => l.fx)).toBe(true);
    expect(d.lines.some((l) => l.match?.confidence === "fuzzy")).toBe(true);
    expect(d.unmatched_ledger.length).toBeGreaterThan(0);
    // 金額都是整數
    expect(d.lines.every((l) => /^-?\d+$/.test(l.amount.amount))).toBe(true);
    // 還不能完成
    expect(err(post(`/statements/${id}/finalize`)).code).toBe("STATEMENT_NOT_BALANCED");
    // 差額和前端算法一致
    const ledger = new Map(d.ledger.map((t) => [t.id, t] as const));
    expect(statementTotals(d.lines, ledger).diff).toBe(d.diff.amount);

    // 0) 手動配對：漏記的行有候選；不能配到別張卡、不能配到已配對的記錄
    const miss = d.lines.find((l) => l.state === "missing")!;
    expect(miss.candidates.length).toBeGreaterThan(0);
    const otherCard = get("/transactions", { accounts: "Wallet_TWD", limit: "1" }).rows[0].id;
    expect(err(post(`/statements/${id}/lines/${miss.line_id}/match`, { transaction_id: otherCard })).code).toBe("VALIDATION_ERROR");
    const taken = d.lines.find((l) => l.match)!.match!.transaction_id;
    expect(err(post(`/statements/${id}/lines/${miss.line_id}/match`, { transaction_id: taken })).code).toBe("VALIDATION_ERROR");
    // 1) 一次確認所有完全吻合
    for (const l of bulkConfirmable(d.lines)) d = data(post(`/statements/${id}/lines/${l.line_id}/confirm`));
    // 2) 模糊配對：確認
    const fz = d.lines.find((l) => l.state === "matched" && !l.match!.confirmed)!;
    d = data(post(`/statements/${id}/lines/${fz.line_id}/confirm`));
    // 3) 金額不同：不能直接確認；用帳單金額更新帳本後確認
    const df = d.lines.find((l) => l.state === "amount_differs")!;
    expect(err(post(`/statements/${id}/lines/${df.line_id}/confirm`)).code).toBe("VALIDATION_ERROR");
    const t = d.ledger.find((x) => x.id === df.match!.transaction_id)!;
    expect(handle("PATCH", `/transactions/${t.id}`, {}, { expected_version: t.version, patch: { amount: df.amount.amount } }).status).toBe(200);
    d = data(post(`/statements/${id}/lines/${df.line_id}/confirm`));
    // 4) 疑似重複、分期：忽略
    for (const l of d.lines.filter((x) => x.state === "possible_duplicate" || x.kind === "installment")) d = data(post(`/statements/${id}/lines/${l.line_id}/ignore`, { reason: "測試" }));
    // 5) 其餘漏記（含退款、外幣、手續費）：新增到帳本，冪等 key 由 line_id 推導
    for (const l of d.lines.filter((x) => x.state === "missing")) {
      const refund = l.amount.amount.startsWith("-");
      const body = { idempotency_key: "web:any", type: refund ? "income" : "expense", amount: l.amount.amount.replace("-", ""), currency: "TWD", account_key: "Cube_Card",
        category_key: l.suggested_category_key, occurred_at: `${l.txn_date}T12:00:00+08:00`, merchant: l.description };
      const raw = post(`/statements/${id}/lines/${l.line_id}/add`, body)
      const r = data(raw);
      expect(r.status).toBe("created");
      expect(data(post(`/statements/${id}/lines/${l.line_id}/add`, body)).status).toBe("duplicate");
      d = r.detail;
    }
    expect(d.lines.filter(needsAction)).toEqual([]);
    expect(d.diff.amount).toBe("0");
    d = data(post(`/statements/${id}/finalize`));
    expect(d.statement.status).toBe("reconciled");
    // 已配對的帳本記錄帶「已對帳」標記；已完成的帳單不能再改
    const added = d.lines.find((l) => l.state === "added")!;
    expect(get(`/transactions/${added.match!.transaction_id}`).statement).toMatchObject({ statement_id: id, reconciled: true });
    expect(err(post(`/statements/${id}/lines/${added.line_id}/ignore`)).code).toBe("STATEMENT_FINALIZED");
  });
  it("全部吻合的一期：一次確認後就能完成", () => {
    const id = get("/statements", { account: "ESun_Unicard" }).rows[0].statement_id;
    let d: L.StatementDetail = get(`/statements/${id}`);
    expect(d.lines.every((l) => l.state === "matched" && l.match!.confidence === "exact")).toBe(true);
    expect(d.diff.amount).toBe("0");
    for (const l of bulkConfirmable(d.lines)) d = data(post(`/statements/${id}/lines/${l.line_id}/confirm`));
    expect(canFinalize(d)).toEqual({ ok: true });
    expect(data(post(`/statements/${id}/finalize`)).statement.status).toBe("reconciled");
  });
});
