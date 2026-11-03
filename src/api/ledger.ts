/** /api/ledger/* 的型別化端點（契約 §3、§4）。前端只透過這裡呼叫後端。 */
import type * as L from "../types/ledger";
import { request } from "./client";

const get = <T>(p: string, query?: Record<string, any>) => request<T>("GET", p, { query });
const post = <T>(p: string, body?: unknown) => request<T>("POST", p, { body: body ?? {} });
const patch = <T>(p: string, body: unknown) => request<T>("PATCH", p, { body });
const put = <T>(p: string, body: unknown) => request<T>("PUT", p, { body });
const del = <T>(p: string, body?: unknown) => request<T>("DELETE", p, { body });
const e = encodeURIComponent;

export const api = {
  /* ---------- 讀取 §3 ---------- */
  catalog: () => get<L.Catalog>("/catalog"),
  overview: (month?: L.ISOMonth) => get<L.Overview>("/overview", { month }),
  transactions: (q: L.TransactionsQuery = {}) => get<L.TransactionsPage>("/transactions", q),
  transaction: (id: number) => get<L.TransactionDetail>(`/transactions/${id}`),
  accounts: (include_archived = true) => get<L.AccountsResponse>("/accounts", { include_archived }),
  account: (key: string, from?: L.ISODate, to?: L.ISODate) => get<L.AccountDetail>(`/accounts/${e(key)}`, { from, to }),
  balanceSeries: (key: string, from: L.ISODate, to: L.ISODate, granularity: L.Granularity) =>
    get<L.BalanceSeries>(`/accounts/${e(key)}/balance-series`, { from, to, granularity }),
  deletePreview: (key: string) => get<L.DeletePreview>(`/accounts/${e(key)}/delete-preview`),
  opening: () => get<L.OpeningWizard>("/accounts/opening"),
  daily: (date: L.ISODate) => get<L.DailyReport>("/reports/daily", { date }),
  weekly: (week: L.ISOWeek, o: { exclude_projects?: boolean; compare?: boolean } = {}) => get<L.WeeklyReport>("/reports/weekly", { week, ...o }),
  monthly: (month: L.ISOMonth, o: { exclude_projects?: boolean; compare?: boolean } = {}) => get<L.MonthlyReport>("/reports/monthly", { month, ...o }),
  range: (from: L.ISODate, to: L.ISODate, o: { exclude_projects?: boolean; compare?: boolean } = {}) => get<L.RangeReport>("/reports/range", { from, to, ...o }),
  trend: (q: { category?: string; merchant?: string; from: L.ISODate; to: L.ISODate; granularity: L.Granularity }) => get<L.TrendReport>("/reports/trend", q),
  budgets: (month: L.ISOMonth) => get<L.BudgetSummary>("/budgets", { month }),
  projects: (status?: L.ProjectStatus) => get<{ rows: L.Project[] }>("/projects", { status }),
  project: (id: string) => get<L.ProjectDetail>(`/projects/${e(id)}`),
  goals: (status?: L.GoalStatus) => get<{ rows: L.SavingsGoal[] }>("/goals", { status }),
  goal: (id: string) => get<L.SavingsGoalDetail>(`/goals/${e(id)}`),
  reconciliations: (account?: string) => get<{ rows: L.Reconciliation[] }>("/reconciliations", { account }),
  recurring: () => get<L.RecurringResponse>("/recurring"),
  merchants: (q: string, limit = 10) => get<{ rows: L.MerchantSuggestion[] }>("/merchants", { q, limit }),
  trash: () => get<L.TrashResponse>("/trash"),
  exportCsv: (q: L.TransactionsQuery = {}) => request<Blob>("GET", "/export.csv", { query: q as any, raw: true }),

  /* ---------- 寫入 §4 ---------- */
  createTransaction: (b: L.CreateTransactionRequest) => post<L.CreateResult>("/transactions", b),
  createTransfer: (b: L.CreateTransferRequest) => post<L.TransferResult>("/transfers", b),
  updateTransaction: (id: number, b: L.UpdateTransactionRequest) => patch<L.UpdateResult>(`/transactions/${id}`, b),
  deleteTransaction: (id: number, expected_version: number, reason?: string) => del<L.DeleteResult>(`/transactions/${id}`, { expected_version, reason }),
  restoreTransaction: (id: number) => post<{ restored: L.Transaction[] }>(`/trash/transactions/${id}/restore`),
  bulk: (b: L.BulkRequest) => post<{ affected: number }>("/transactions/bulk", b),

  createAccount: (b: L.AccountInput & { opening?: { amount: string; at: L.ISODateTime } }) => post<{ account: L.AccountSummary }>("/accounts", b),
  updateAccount: (key: string, b: Partial<L.AccountInput>) => patch<{ account: L.AccountSummary }>(`/accounts/${e(key)}`, b),
  archiveAccount: (key: string, archived: boolean) => post<{ account: L.AccountSummary }>(`/accounts/${e(key)}/${archived ? "archive" : "unarchive"}`),
  deleteAccount: (key: string, b: L.DeleteAccountRequest) => del<L.DeleteAccountResult>(`/accounts/${e(key)}`, b),
  restoreAccount: (key: string) => post<{ account: L.AccountSummary; restored_transactions: number }>(`/trash/accounts/${e(key)}/restore`),
  setOpening: (b: L.OpeningRequest) => post<L.OpeningPreview | { updated: string[] }>("/accounts/opening", b),
  reconcile: (b: L.ReconcileRequest) => post<{ reconciliation: L.Reconciliation; adjustment: L.Transaction | null }>("/reconciliations", b),
  reconcilePreview: (b: { account_key: string; as_of: L.ISODateTime; actual: string }) => post<L.ReconcilePreview>("/reconciliations/preview", b),

  createCategory: (b: L.CategoryInput) => post<{ category: L.CategoryNode | L.CategoryLeaf }>("/categories", b),
  updateCategory: (key: string, b: L.CategoryPatch) => patch<{ category: L.CategoryNode | L.CategoryLeaf }>(`/categories/${e(key)}`, b),
  mergeCategory: (from_key: string, to_key: string) => post<{ moved_transactions: number }>("/categories/merge", { from_key, to_key }),
  createTag: (name: string) => post<{ tag: L.Tag }>("/tags", { name }),
  updateTag: (id: string, name: string) => patch<{ tag: L.Tag }>(`/tags/${e(id)}`, { name }),
  deleteTag: (id: string) => del<{ deleted: true }>(`/tags/${e(id)}`),

  putBudgets: (b: L.BudgetPut) => put<L.BudgetSummary>("/budgets", b),
  suggestBudgets: (months = 3) => post<{ lines: { category_key: string; amount: string }[] }>("/budgets/suggest", { months }),
  createProject: (b: L.ProjectInput) => post<{ project: L.Project }>("/projects", b),
  updateProject: (id: string, b: Partial<L.ProjectInput>) => patch<{ project: L.Project }>(`/projects/${e(id)}`, b),
  createGoal: (b: L.GoalInput) => post<{ goal: L.SavingsGoal }>("/goals", b),
  updateGoal: (id: string, b: Partial<L.GoalInput>) => patch<{ goal: L.SavingsGoal }>(`/goals/${e(id)}`, b),
  goalEntry: (id: string, b: { idempotency_key: string; date: L.ISODate; amount: string; note?: string | null }) => post<{ goal: L.SavingsGoalDetail }>(`/goals/${e(id)}/entries`, b),
  createRecurring: (b: Omit<L.RecurringRule, "rule_id" | "next_due">) => post<{ rule: L.RecurringRule }>("/recurring", b),
  updateRecurring: (id: string, b: Partial<Omit<L.RecurringRule, "rule_id" | "next_due">>) => patch<{ rule: L.RecurringRule }>(`/recurring/${e(id)}`, b),
  confirmOccurrence: (id: string, date: L.ISODate, amount?: string) => post<{ transaction: L.Transaction }>(`/recurring/${e(id)}/occurrences/${date}/confirm`, amount ? { amount } : {}),
  skipOccurrence: (id: string, date: L.ISODate) => post<{ occurrence: L.Occurrence }>(`/recurring/${e(id)}/occurrences/${date}/skip`),
};
export type Api = typeof api;
