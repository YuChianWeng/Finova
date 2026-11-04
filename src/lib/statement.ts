/**
 * 信用卡逐筆對帳的純邏輯（issue #15）：狀態、需要處理、差額、能不能完成對帳。
 * 畫面、mock、測試共用；金額一律用 money.ts 的十進位字串運算。
 */
import type * as L from "../types/ledger";
import { add, sub, sign } from "./money";

/** 以信用卡的角度：流出（消費）為正，流入（退款、繳款）為負 */
export const charge = (t: Pick<L.Transaction, "direction" | "amount">) => (t.direction === "out" ? t.amount.amount : "-" + t.amount.amount.replace(/^-/, ""));

/** 這一行還需要使用者處理嗎？已配對但還沒確認的也算 */
export function needsAction(l: Pick<L.StatementLine, "state" | "match">): boolean {
  if (l.state === "missing" || l.state === "amount_differs" || l.state === "possible_duplicate") return true;
  return l.state === "matched" && !l.match?.confirmed;
}

/** 可以「一次確認」的：自動配對、完全吻合、還沒確認 */
export const bulkConfirmable = (lines: L.StatementLine[]) => lines.filter((l) => l.state === "matched" && l.match && !l.match.confirmed && l.match.confidence === "exact");

/**
 * 差額 = 帳單（未忽略的行）合計 − 已配對帳本記錄合計。
 * 沒配對到的行，帳本那一側算 0；金額不同的行，用帳本的實際金額。
 */
export function statementTotals(lines: L.StatementLine[], ledger: Map<number, Pick<L.Transaction, "direction" | "amount">>) {
  let st = "0", ml = "0";
  for (const l of lines) {
    if (l.state === "ignored") continue;
    st = add(st, l.amount.amount);
    const t = l.match ? ledger.get(l.match.transaction_id) : undefined;
    if (t) ml = add(ml, charge(t));
  }
  return { statement: st, matched: ml, diff: sub(st, ml) };
}

export type FinalizeCheck = { ok: true } | { ok: false; reason: string };
/** 「完成對帳」按鈕能不能按；不能時給使用者看的原因 */
export function canFinalize(d: Pick<L.StatementDetail, "statement" | "lines" | "diff">, online = true): FinalizeCheck {
  if (d.statement.status === "reconciled") return { ok: false, reason: "這一期已經完成對帳" };
  if (!online) return { ok: false, reason: "離線中，對帳畫面只能查看" };
  const n = d.lines.filter(needsAction).length;
  if (n) return { ok: false, reason: `還有 ${n} 筆需要處理` };
  if (sign(d.diff.amount) !== 0) return { ok: false, reason: "差額不為 0" };
  return { ok: true };
}

const RANK: Record<L.StatementLineState, number> = { amount_differs: 0, missing: 1, possible_duplicate: 2, matched: 3, added: 4, ignored: 5 };
/** 需要處理的排前面（依狀態、再依日期），其餘依日期，已忽略的最後 */
export function sortLines(lines: L.StatementLine[]): L.StatementLine[] {
  return lines.slice().sort((a, b) => {
    const na = needsAction(a) ? 0 : 1, nb = needsAction(b) ? 0 : 1;
    if (na !== nb) return na - nb;
    if (na === 0 && RANK[a.state] !== RANK[b.state]) return RANK[a.state] - RANK[b.state];
    const ia = a.state === "ignored" ? 1 : 0, ib = b.state === "ignored" ? 1 : 0;
    if (ia !== ib) return ia - ib;
    return a.txn_date.localeCompare(b.txn_date) || a.line_id.localeCompare(b.line_id);
  });
}

/** 狀態 chip：文字＋圖示（不能只靠顏色） */
export const STATE_UI: Record<L.StatementLineState | "unconfirmed" | "fuzzy", { text: string; icon: string; tone: "ok" | "warn" | "bad" | "mu" | "info" }> = {
  matched: { text: "已配對", icon: "check", tone: "ok" },
  unconfirmed: { text: "已配對・待確認", icon: "swap", tone: "info" },
  fuzzy: { text: "已配對・有出入", icon: "alert", tone: "warn" },
  missing: { text: "帳本沒有", icon: "plus", tone: "bad" },
  amount_differs: { text: "金額不同", icon: "scale", tone: "warn" },
  possible_duplicate: { text: "疑似重複", icon: "copy", tone: "warn" },
  ignored: { text: "已忽略", icon: "x", tone: "mu" },
  added: { text: "已新增到帳本", icon: "check", tone: "ok" },
};
export function chipOf(l: Pick<L.StatementLine, "state" | "match">) {
  if (l.state === "matched" && l.match && !l.match.confirmed) return STATE_UI[l.match.confidence === "fuzzy" ? "fuzzy" : "unconfirmed"];
  return STATE_UI[l.state];
}

export const KIND_TEXT: Record<L.StatementLineKind, string> = { purchase: "消費", refund: "退款", fee: "手續費", interest: "利息", installment: "分期", payment: "繳款", other: "其他" };
