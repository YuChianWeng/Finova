/**
 * FRONTEND-CONTRACT v1.0（凍結版）§1–§4 的型別，原樣複製。
 * 這是前後端共用的正式型別來源；請勿為了配合資料庫而修改（契約 §9）。
 * 檔案最下方「端點回應型別」區塊只是把 §3、§4 表格裡的回傳寫成型別，方便使用。
 */
/* eslint-disable */

export type ApiSuccess<T> = { version: 1; data: T };
export type ApiFailure = { version: 1; error: ApiError };
export type ApiError = {
  code: ErrorCode;
  message: string;                       // 給使用者看的中文訊息（後端提供，前端可覆寫）
  details?: Record<string, string[]>;    // 欄位錯誤：{ amount: ["金額必須大於 0"] }
  current?: unknown;                     // VERSION_CONFLICT 時附上最新資料
};

export type ISODate = string;      // "2026-11-03"
export type ISOMonth = string;     // "2026-11"
export type ISOWeek = string;      // "2026-W45"（ISO 週，週一開始）
export type ISODateTime = string;  // "2026-11-03T12:30:00+08:00"
export type CurrencyCode = "TWD" | "USDT" | "JPY" | "USD" | string;

export type Money = {
  amount: string;           // 十進位字串，不含千分位，可帶負號："-120"、"351342.41"
  currency: CurrencyCode;
};
/** 多幣別合計：只有實際出現的幣別才會有 key，例如 { TWD: "12860" } */
export type MoneyByCurrency = Record<CurrencyCode, string>;

export type Delta = {              // 和上一期比較
  previous: string;         // 上一期同期的值（同幣別）
  change: string;           // 本期 − 上期
  change_ratio: number | null; // 0.154 = +15.4%；上期為 0 時為 null
};

export type TransactionType =
  | "expense" | "income"
  | "transfer" | "credit_card_payment"   // 兩筆一組（轉出／轉入）
  | "adjustment"                         // 對帳調整
  | "investment_settlement"              // 投資交割（顯示即可，網站不新增）
  | "loan_interest_payment" | "loan_principal_repayment";

export type Direction = "in" | "out";           // 對該帳戶而言是流入或流出

export type Source =
  | "web" | "iphone_shortcut" | "chat_bot" | "moze_import" | "auto" | "other";
// 顯示文字：網頁／捷徑／聊天機器人／MOZE 匯入／自動入帳／其他

export type AccountGroup =
  | "cash" | "bank" | "credit_card" | "stored_value"
  | "investment" | "liability" | "receivable" | "other";
// 顯示文字：現金／銀行／信用卡／儲值卡／投資／負債／應收／其他

export type CategoryKind = "expense" | "income" | "system";
export type BudgetStatus = "ok" | "warning" | "over";   // <80%／80–99%／≥100%
export type ProjectStatus = "planned" | "active" | "closed" | "archived";
export type GoalStatus = "active" | "achieved" | "archived";
export type Granularity = "day" | "week" | "month";

export type Catalog = {
  currencies: { code: CurrencyCode; name: string; symbol: string; decimals: number }[];
  accounts: AccountOption[];
  categories: CategoryNode[];          // 主分類陣列，children 為子分類
  tags: Tag[];
  frequent: {
    expense_categories: string[];      // category_key，近 90 天最常用的前 8 個
    income_categories: string[];
    accounts: string[];                // account_key
  };
  projects_active: { project_id: string; name: string; start_date: ISODate; end_date: ISODate }[];
};

export type AccountOption = {
  account_key: string;
  name: string;
  group: AccountGroup;
  currency: CurrencyCode;
  icon: string | null;
  aliases: string[];
  is_archived: boolean;
  can_record: boolean;                 // false：投資市值帳戶、已封存帳戶（不出現在記一筆選單）
};

export type CategoryNode = {
  category_key: string;                // 主："food"；子："food.lunch"
  name: string;
  kind: CategoryKind;
  icon: string | null;
  is_hidden: boolean;
  sort_order: number;
  children: CategoryLeaf[];            // 子分類；子分類本身沒有 children
};
export type CategoryLeaf = Omit<CategoryNode, "children"> & { parent_key: string };

export type Tag = { tag_id: string; name: string };

export type Transaction = {
  id: number;
  version: number;
  type: TransactionType;
  direction: Direction;
  amount: Money;                        // 正數
  occurred_at: ISODateTime;
  date: ISODate;
  account: { account_key: string; name: string; group: AccountGroup };
  category: {
    main: { category_key: string; name: string; icon: string | null };
    sub: { category_key: string; name: string; icon: string | null } | null;
  } | null;                             // 轉帳、調整等為 null
  merchant: string | null;
  note: string | null;
  tags: Tag[];
  project: { project_id: string; name: string } | null;
  source: Source;
  transfer: {                           // 只有 transfer／credit_card_payment 才有
    group_id: string;
    leg: "out" | "in";
    counterpart: { transaction_id: number; account_key: string; account_name: string; amount: Money };
    fee: Money | null;
  } | null;
  recurring_rule_id: string | null;
  balance_after: Money | null;          // 只有篩選單一帳戶、且該帳戶已設定期初時才有值
  is_pending_sync?: boolean;            // 只在前端離線佇列中使用，不會由後端回傳
  statement?: StatementRef | null;      // v1.1 提案（issue #15）：已配對到信用卡帳單的哪一行；v1.0 後端不回傳＝null
  created_at: ISODateTime;
  updated_at: ISODateTime;
};

export type TransactionDetail = Transaction & {
  history: {
    action: "create" | "update" | "delete" | "restore" | "migrate";
    actor: string;                      // "網頁"、"捷徑"、"系統"...
    at: ISODateTime;
    changed_fields: string[];           // ["amount","category"]
    before: Partial<Transaction> | null;
    after: Partial<Transaction> | null;
  }[];
};

export type AccountSummary = {
  account_key: string;
  name: string;
  group: AccountGroup;
  currency: CurrencyCode;
  icon: string | null;
  is_archived: boolean;
  sort_order: number;
  balance: {
    computed: Money | null;             // 由交易計算；未設定期初時為 null
    opening_set: boolean;
    latest_snapshot: { amount: Money; as_of: ISODateTime } | null;
  };
  month_flow: { inflow: Money; outflow: Money };
  reconcile: {
    last_at: ISODateTime | null;
    last_diff: Money | null;
    due: boolean;                       // 超過提醒天數未對帳
    reminder_days: number;
  };
  credit_card: CreditCardInfo | null;   // group = credit_card 時才有
};

export type CreditCardInfo = {
  statement_day: number | null;
  due_day: number | null;
  credit_limit: Money | null;
  current_statement: {
    period_start: ISODate; period_end: ISODate;
    amount: Money;                      // 本期帳單金額（正數 = 應繳）
    due_date: ISODate | null;
    days_until_due: number | null;
    paid: Money;
    is_paid_off: boolean;
  } | null;
  utilization: number | null;           // 0.43 = 43%
};

export type InvestmentTotal = {                // 股票等只顯示總額（D-12）
  account_key: string;
  name: string;
  market_value: Money;
  as_of: ISODateTime;
  is_stale: boolean;                    // 超過 7 天
  link: string;                         // 股票區網址，例如 "/portfolio"
};

export type AccountsResponse = {
  totals: {
    available_cash: MoneyByCurrency;    // cash + bank + stored_value 的計算餘額（沒有計算餘額時用 snapshot）
    credit_card_due: MoneyByCurrency;   // 正數 = 欠款
    liabilities: MoneyByCurrency;       // 正數 = 欠款
  };
  groups: { group: AccountGroup; accounts: AccountSummary[] }[];   // 不含 investment
  investments: InvestmentTotal[];
  archived: AccountSummary[];
};

export type Kpi = {
  income: MoneyByCurrency;
  expense: MoneyByCurrency;
  net: MoneyByCurrency;
  savings_rate: number | null;          // 只算 TWD；收入為 0 時為 null
  compare: {                            // 與上一期「同期」比較（只算 TWD）
    income: Delta; expense: Delta; net: Delta;
  } | null;
};

export type SeriesPoint = {
  date: ISODate;                        // 期間的第一天
  income: string; expense: string;      // TWD
  cumulative_expense?: string;
  budget_line?: string | null;          // 累計預算線
};

export type CategorySlice = {
  category_key: string;                 // 主分類，或 "<main>.__none__" 代表未細分
  name: string;
  icon: string | null;
  amount: string;                       // TWD
  ratio: number;                        // 占比 0–1
  count: number;
  children?: CategorySlice[];           // 主分類才有
  compare_previous?: string;            // 上一期金額
};

export type MerchantRank = { merchant: string; amount: string; count: number };

export type DailyReport = {
  date: ISODate;
  kpi: Kpi;
  daily_average_expense: string;        // 近 30 天日平均
  transactions: Transaction[];
  categories: CategorySlice[];
};

export type WeeklyReport = {
  week: ISOWeek; start: ISODate; end: ISODate;
  kpi: Kpi;
  series: SeriesPoint[];                // 7 點
  categories: CategorySlice[];
  top_expenses: Transaction[];          // 前 3 筆
  budget: BudgetSummary | null;
};

export type MonthlyReport = {
  month: ISOMonth;
  kpi: Kpi;
  series: SeriesPoint[];                // 每日，含 cumulative_expense、budget_line
  categories: CategorySlice[];          // 含 children 與 compare_previous
  accounts: { account_key: string; name: string; inflow: string; outflow: string }[];
  merchants: MerchantRank[];            // 前 10
  budget: BudgetSummary | null;
  fixed_vs_variable: { fixed: string; variable: string };
  data_notice: string | null;           // 例如 "這個月份的資料待修正"、"這段期間資料不完整"
};

export type RangeReport = {
  from: ISODate; to: ISODate; granularity: "month";
  kpi: Kpi;
  series: SeriesPoint[];
  stacked: { date: ISODate; by_category: Record<string, string> }[]; // key = 主分類 key
  stats: {
    average_expense: string;
    max_month: { month: ISOMonth; expense: string } | null;
    min_month: { month: ISOMonth; expense: string } | null;
  };
};

export type TrendReport = {
  target: { kind: "category" | "merchant"; key: string; name: string };
  granularity: Granularity;
  points: { date: ISODate; amount: string; count: number }[];
};

export type BudgetLine = {
  category_key: string | null;          // null = 月總預算
  name: string;
  limit: string;
  used: string;
  remaining: string;                    // 可能為負
  ratio: number;
  status: BudgetStatus;
  projected: string;                    // 照目前速度的月底預估
  rollover: boolean;
  children?: BudgetLine[];              // 子分類（若有設定）
};

export type BudgetSummary = {
  month: ISOMonth;
  currency: "TWD";
  total: BudgetLine | null;             // 沒設定總預算時為 null
  total_is_sum_of_categories: boolean;
  lines: BudgetLine[];
};

export type Project = {
  project_id: string;
  name: string;
  start_date: ISODate; end_date: ISODate;
  status: ProjectStatus;
  count_in_monthly_budget: boolean;
  budgets: { currency: CurrencyCode; total: string | null; by_category: { category_key: string; amount: string }[] }[];
  spent: MoneyByCurrency;
  remaining: MoneyByCurrency;
  per_day_available: MoneyByCurrency | null;   // 已結束的專案為 null
  days_total: number;
  days_left: number;
  note: string | null;
};

export type ProjectDetail = Project & {
  series: { date: ISODate; amount: MoneyByCurrency }[];
  categories: CategorySlice[];          // 依主要幣別
  summary: {                            // closed 後才有
    total: MoneyByCurrency;
    daily_average: MoneyByCurrency;
    largest: Transaction | null;
  } | null;
};

export type SavingsGoal = {
  goal_id: string;
  name: string;
  currency: CurrencyCode;
  target: string;
  current: string;
  progress: number;                     // 0–1
  start_date: ISODate;
  deadline: ISODate | null;
  progress_mode: "linked_account" | "manual";
  linked_account_key: string | null;
  monthly_required: string | null;      // 沒有期限時為 null
  projected_date: ISODate | null;       // 無法推估時為 null
  is_behind: boolean;
  status: GoalStatus;
  note: string | null;
};

export type SavingsGoalDetail = SavingsGoal & {
  series: { date: ISODate; cumulative: string; target_line: string | null }[];
  entries: { entry_id: string; date: ISODate; amount: string; note: string | null }[]; // amount 正=存入、負=取出
};

export type Reconciliation = {
  reconciliation_id: string;
  account_key: string;
  as_of: ISODateTime;
  actual: Money; computed: Money; diff: Money;
  resolution: "matched" | "adjusted" | "left_open";
  adjustment_transaction_id: number | null;
  note: string | null;
  created_at: ISODateTime;
};

export type OpeningWizard = {
  accounts: {
    account_key: string; name: string; group: AccountGroup; currency: CurrencyCode;
    latest_snapshot: { amount: Money; as_of: ISODateTime } | null;
    opening: { amount: Money; at: ISODateTime } | null;  // 已設定過時有值
    computed_now: Money | null;
    is_liability: boolean;              // true：輸入框顯示「目前欠款」，送出時填正數
  }[];
};

export type RecurringRule = {
  rule_id: string;
  name: string;
  template: CreateTransactionRequest;   // 不含 idempotency_key、occurred_at
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  by_weekday: number | null;            // 1=週一 … 7=週日
  by_monthday: number | null;           // 31 = 月底
  time_local: string;                   // "08:00:00"
  start_date: ISODate; end_date: ISODate | null;
  mode: "confirm" | "auto";
  is_active: boolean;
  next_due: ISODate | null;
};

export type Occurrence = {
  rule_id: string; rule_name: string;
  due_date: ISODate;
  amount: Money;
  status: "pending" | "confirmed" | "skipped";
  transaction_id: number | null;
};

export type Alert =
  | { type: "reconcile_due"; account_key: string; account_name: string; days: number }
  | { type: "uncategorized"; count: number }
  | { type: "recurring_due"; rule_id: string; name: string; due_date: ISODate; amount: Money }
  | { type: "budget_warning" | "budget_over"; category_key: string | null; name: string; ratio: number }
  | { type: "goal_behind"; goal_id: string; name: string }
  | { type: "card_due"; account_key: string; name: string; due_date: ISODate; amount: Money }
  | { type: "opening_missing"; count: number }
  | { type: "data_notice"; message: string };

export type Overview = {
  month: ISOMonth;
  kpi: Kpi;
  today: { expense: string; vs_daily_average: string };
  this_week: { expense: string; vs_weekly_average: string };
  budget: BudgetSummary | null;                 // 前端取 status ≠ ok 的前 3 項顯示
  series: SeriesPoint[];                        // 本月每日
  categories: CategorySlice[];                  // 本月主分類
  projects: Project[];                          // planned + active
  goals: SavingsGoal[];                         // active
  accounts: Pick<AccountsResponse, "totals" | "investments">;
  recent: Transaction[];                        // 最新 10 筆
  alerts: Alert[];
  generated_at: ISODateTime;
};

export type CreateTransactionRequest = {
  idempotency_key: string;               // "web:<uuid>"
  type: "expense" | "income";
  amount: string;                        // 正數
  currency: CurrencyCode;                // 預設帳戶幣別
  account_key: string;
  category_key: string;                  // 主或子；kind 必須和 type 相符
  occurred_at: ISODateTime;              // 預設現在
  merchant?: string | null;              // ≤ 200 字
  note?: string | null;                  // ≤ 200 字
  tag_ids?: string[];                    // ≤ 10
  project_id?: string | null;
};

export type CreateTransferRequest = {
  idempotency_key: string;
  type: "transfer" | "credit_card_payment";   // 卡費：to 必須是信用卡帳戶
  from_account_key: string;
  to_account_key: string;
  amount_out: string;
  amount_in?: string;                    // 跨幣別時必填；同幣別可省略（= amount_out）
  occurred_at: ISODateTime;
  note?: string | null;
  fee?: { amount: string; category_key?: string } | null;   // 預設分類 "personal.fee"
};

export type UpdateTransactionRequest = {
  expected_version: number;
  patch: Partial<Omit<CreateTransactionRequest, "idempotency_key" | "type">> & {
    type?: "expense" | "income";         // 只能在支出和收入之間切換
    // 轉帳類可以改 amount_out / amount_in / occurred_at / note / from/to_account_key
    amount_out?: string; amount_in?: string;
    from_account_key?: string; to_account_key?: string;
  };
};

export type AccountInput = {
  account_key?: string;                  // 新增時選填，後端可自動產生；建立後不可修改
  name: string;
  group: AccountGroup;                   // 不可設為 investment（市值帳戶由股票模組管理）
  currency: CurrencyCode;                // 有交易後不可修改
  aliases?: string[];
  icon?: string | null;
  sort_order?: number;
  statement_day?: number | null;         // 信用卡
  due_day?: number | null;
  credit_limit?: string | null;
  reconcile_reminder_days?: number;
};

/* ===================== 端點回應型別（由 §3、§4 表格整理） ===================== */

export type TransactionsSummary = {
  count: number;
  income: MoneyByCurrency;
  expense: MoneyByCurrency;
  net: MoneyByCurrency;
};
export type TransactionsPage = { rows: Transaction[]; summary: TransactionsSummary; next_cursor: string | null };

export type TransactionsQuery = {
  from?: ISODate; to?: ISODate;
  accounts?: string[]; categories?: string[]; types?: TransactionType[];
  projects?: string[]; tags?: string[];
  min?: string; max?: string;
  sources?: Source[]; currency?: CurrencyCode; q?: string;
  sort?: "date" | "amount"; order?: "desc" | "asc";
  cursor?: string; limit?: number;
};

export type AccountDetail = AccountSummary & {
  top_categories: CategorySlice[];
  period: { from: ISODate; to: ISODate; inflow: Money; outflow: Money };
};
export type BalanceSeries = {
  points: { date: ISODate; balance: string }[];
  reconciliations: { as_of: ISODateTime; actual: string }[];
  opening_at: ISODateTime | null;
};
export type DeletePreview = {
  transactions: number; transfer_groups: number; reconciliations: number; snapshots: number;
  used_by: { goals: string[]; recurring: string[]; loans: string[] };
  allowed_modes: ("empty" | "merge" | "with_transactions")[];
  merge_targets: string[];
};
export type MerchantSuggestion = {
  merchant: string; use_count: number; last_category_key: string | null; last_account_key: string | null;
};
export type TrashResponse = {
  transactions: (Transaction & { deleted_at: ISODateTime; purge_after: ISODateTime })[];
  accounts: { account_key: string; name: string; deleted_at: ISODateTime; purge_after: ISODateTime; transactions: number }[];
};
export type RecurringResponse = { rules: RecurringRule[]; upcoming: Occurrence[] };

export type CreateResult = { status: "created" | "duplicate"; transaction: Transaction };
export type TransferResult = { status: "created" | "duplicate"; legs: [Transaction, Transaction]; fee: Transaction | null };
export type UpdateResult = { transaction: Transaction; legs?: [Transaction, Transaction] };
export type DeleteResult = { deleted_ids: number[]; purge_after: ISODateTime };
export type BulkRequest =
  | { action: "update"; ids: number[]; patch: { category_key?: string; account_key?: string; tag_ids_add?: string[]; tag_ids_remove?: string[]; project_id?: string | null } }
  | { action: "delete"; ids: number[] };

export type DeleteAccountRequest = { mode: "empty" | "merge" | "with_transactions"; target_key?: string; confirm_name?: string };
export type DeleteAccountResult = { mode: DeleteAccountRequest["mode"]; moved_transactions?: number; deleted_transactions?: number; purge_after?: ISODateTime };
export type OpeningRequest = { preview: boolean; items: { account_key: string; amount: string; at: ISODateTime }[] };
export type OpeningPreview = { preview: OpeningWizard["accounts"]; totals: AccountsResponse["totals"] };
export type ReconcileRequest = { account_key: string; as_of: ISODateTime; actual: string; resolution: Reconciliation["resolution"]; note?: string | null };
export type ReconcilePreview = { computed: Money; diff: Money; transactions_since_last: Transaction[] };

export type CategoryInput = { name: string; kind: "expense" | "income"; parent_key?: string; icon?: string | null; sort_order?: number };
export type CategoryPatch = { name?: string; icon?: string | null; sort_order?: number; is_hidden?: boolean; parent_key?: string };
export type BudgetPut = { effective_from: ISOMonth; lines: { category_key: string | null; amount: string; rollover?: boolean }[] };
export type ProjectInput = { name: string; start_date: ISODate; end_date: ISODate; count_in_monthly_budget?: boolean; budgets?: Project["budgets"]; note?: string | null; status?: ProjectStatus };
export type GoalInput = { name: string; currency: CurrencyCode; target: string; start_amount?: string; start_date: ISODate; deadline?: ISODate | null; progress_mode: SavingsGoal["progress_mode"]; linked_account_key?: string | null; note?: string | null; status?: GoalStatus };
export type ErrorCode = (typeof ERROR_CODES)[number];
export const ERROR_CODES = [
  "VALIDATION_ERROR", "UNKNOWN_ACCOUNT", "UNKNOWN_CATEGORY", "UNKNOWN_PROJECT", "CATEGORY_KIND_MISMATCH",
  "AMOUNT_PRECISION", "AMOUNT_NOT_POSITIVE", "TRANSFER_SAME_ACCOUNT", "CARD_PAYMENT_TARGET_NOT_CARD",
  "ACCOUNT_INACTIVE", "ACCOUNT_IN_USE", "MERGE_INCOMPATIBLE", "MERGE_CREATES_SELF_TRANSFER", "CONFIRM_NAME_MISMATCH",
  "IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT", "RESTORE_CONFLICT", "NOT_FOUND", "AUTH_EXPIRED", "FORBIDDEN",
  "DB_BUSY", "WRITE_SERVICE_UNAVAILABLE",
  // v1.1 提案（issue #15）：信用卡逐筆對帳
  "STATEMENT_NOT_BALANCED", "STATEMENT_FINALIZED",
] as const;

/* ================================================================
 * v1.1 提案（issue #15）：信用卡逐筆對帳。全部是新增項目，不影響 v1.0。
 * 說明見 docs/CONTRACT-CHANGES.md §6。
 * ================================================================ */
export type StatementStatus = "draft" | "in_review" | "reconciled";
export type Statement = {
  statement_id: string;
  account_key: string;
  period_start: ISODate; period_end: ISODate;      // 帳單期間（依入帳日）
  close_date: ISODate; due_date: ISODate | null;   // 結帳日／繳款截止日
  total_due: Money; min_due: Money | null;
  prev_balance: Money | null; payments: Money | null;
  status: StatementStatus;
  counts: { lines: number; matched: number; needs_action: number };
  source: { kind: "email" | "upload"; received_at: ISODateTime } | null;
  reconciled_at: ISODateTime | null;               // 提案補充：完成對帳的時間
};
export type StatementLineKind = "purchase" | "refund" | "fee" | "interest" | "installment" | "payment" | "other";
export type StatementLineState = "matched" | "missing" | "amount_differs" | "possible_duplicate" | "ignored" | "added";
export type StatementLine = {
  line_id: string;
  txn_date: ISODate; post_date: ISODate | null;    // 消費日／入帳日
  description: string;                             // 帳單上的原文
  amount: Money;                                   // 正數 = 消費，負數 = 退款或繳款（以信用卡的角度）
  kind: StatementLineKind;
  fx: { amount: string; currency: CurrencyCode } | null;
  state: StatementLineState;
  match: {
    transaction_id: number; confidence: "exact" | "fuzzy"; by: "auto" | "manual";
    confirmed: boolean;                            // 提案補充：使用者確認過（自動配對預設 false）
  } | null;
  candidates: number[];                            // 候選的 transaction_id
  suggested_category_key: string | null;           // 提案補充：「新增到帳本」預設分類
  ignore_reason: string | null;                    // 提案補充
  raw_text: string | null;                         // 提案補充：解析前的原始文字（查看用）
};
export type StatementDetail = {
  statement: Statement;
  lines: StatementLine[];
  /** 帳本有、帳單沒有：同一張卡、帳單期間內、沒有配對到任何一行的記錄 */
  unmatched_ledger: Transaction[];
  /** 提案補充：lines 的 match／candidates 參照到的帳本記錄，畫面並排顯示用 */
  ledger: Transaction[];
  /** 差額 = 帳單（未忽略的行）合計 − 已配對帳本記錄合計（皆以信用卡角度：消費為正） */
  diff: Money;
  /** 提案補充：帳單未忽略行合計、已配對帳本合計、帳本同期間合計（含帳單沒有的記錄） */
  totals: { statement: Money; matched_ledger: Money; ledger_period: Money };
};
export type StatementRef = { statement_id: string; line_id: string; reconciled: boolean; close_date: ISODate };

