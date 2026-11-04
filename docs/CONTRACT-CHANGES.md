# FRONTEND-CONTRACT v1.1 修訂提案

FRONTEND-CONTRACT v1.0 是凍結版，不在這個 repo 裡。這份文件列出前端實作**刻意**和 v1.0 不同的地方，請契約維護者併入，並把小版號升為 **v1.1**，讓後端和後續文件一致。

只影響前端路由與 PWA 設定；**API、型別、錯誤碼都沒有變**，後端不用改。

## 1. App 首頁改成帳戶總覽（§8、TECH-SPEC §13.1）

| 項目 | v1.0 | v1.1 |
|---|---|---|
| `/finance` | 總覽（Overview：本月 KPI、預算、提醒…） | **不變**：仍是總覽（畫面標題「每日明細」，含月曆、本月收支、預算、待處理） |
| App 開啟後的第一頁 | `/finance` | `/finance/accounts`（帳戶總覽） |
| 底部導覽第一個按鈕 | 總覽 | 帳戶總覽；第二個是 `/finance`（每日明細） |
| manifest `start_url` | `/finance?source=pwa` | `/finance/accounts?source=pwa` |
| 找不到頁面時的「回首頁」 | `/finance` | `/finance/accounts` |

原因：使用者打開 App 最常看的是各帳戶餘額與淨資產，所以首頁改成帳戶總覽（產品決定，見 commit `48d80d8`）。`/finance` 這個網址的內容不變，從其他地方連到 `/finance` 的連結、書籤都照舊可以用。

## 2. `?source=pwa`

- manifest 的 `start_url` 保留 `source=pwa`，用來分辨是從主畫面圖示開啟還是從 Safari 開啟。
- 前端在啟動時讀取這個參數，存到 sessionStorage（`finova-source`），之後在同一個 App 視窗裡換頁也記得來源（`app.source`），然後用 `history.replaceState` 從網址拿掉，避免使用者複製連結或加書籤時帶著它。
- 目前前端只在本機記錄，不會送給後端。之後如果要統計，可以另外定義（例如加一個 request header），屬於契約的新增項目。

## 3. iOS Web App（TECH-SPEC §13.1，非變更，只是補實作）

以下是 v1.0 已規定、這次補齊的部分，列出來方便核對：

- `apple-mobile-web-app-status-bar-style` = `black-translucent`。iOS 這個模式的狀態列文字固定是白色，所以淺色主題時狀態列底色改成深咖啡色（`--sb`），文字才看得到。
- 觸控裝置上所有 `input`、`select`、`textarea` 字級 16px，聚焦時不會自動放大。
- 從主畫面開啟（standalone）時，總覽、帳戶、明細頁可以下拉更新；瀏覽器分頁裡不啟用，交給瀏覽器內建的下拉重新整理。

## 建議的契約文字（§8 路由表）

```
/finance                 總覽（每日明細）
/finance/accounts        帳戶總覽（App 首頁；manifest start_url = /finance/accounts?source=pwa）
```

## 4. 記一筆新版面需要的新欄位與類型（issue #10，**新增項目，尚未實作**）

新版記一筆（全螢幕「新增記錄」）已經依 v1.0 上線。以下項目在畫面上先顯示「即將推出」或暫不顯示，需要契約 v1.1 和後端支援後再打開：

| 項目 | v1 前端現況 | v1.1 建議 |
|---|---|---|
| **應收款項**（借錢給別人） | 分頁顯示「即將推出」，不能送出 | 新增 `type: "receivable"`：`account_key`（應收帳戶，`group: receivable`）、`counterparty`（對象名稱）、`due_date`（選填）。收回時用一筆「收款」沖銷，API：`POST /transactions`（新 type）、`GET /receivables?status=open` |
| **應付款項**（欠別人的錢） | 同上 | `type: "payable"`，欄位同上，對應負債帳戶；還款時沖銷 |
| **系統** | 分頁說明「餘額調整請從對帳建立」，按鈕前往 `/finance/reconcile` | 不需要新 type：對應既有的 `adjustment`，維持只能從對帳流程建立 |
| **商家**（和名稱分開） | 不顯示；「名稱」就是 `merchant` | 選填 `store: string \| null`（例如名稱「午餐」、商家「八方雲集」），`GET /merchants` 也回傳 `store` |
| **發票號碼／隨機碼** | 不顯示 | `invoice: { number: string; random_code: string } \| null`，格式 `AB-12345678`、4 碼；後續可接雲端發票 |
| **紅利回饋** | 不顯示 | `reward: Money \| null`（信用卡回饋點數或現金回饋），報表可另外統計 |
| **常用範本**（名稱旁的 ☆） | 點了顯示「即將推出」 | `GET/POST/DELETE /templates`：`{ template_id, name, body: Omit<CreateTransactionRequest, "idempotency_key" \| "occurred_at"> }`，catalog 加 `templates` |
| **收據照片** | 相片按鈕顯示「即將推出」（SPEC D-7 不在 v1 範圍） | `POST /transactions/:id/attachments`（multipart），交易加 `attachments: { id, url, thumb_url }[]` |

已經可以用、沿用 v1.0 API 的新功能：

- **週期**：選了每天／每週／每月／每年後，儲存交易時另外呼叫 `POST /api/ledger/recurring` 建立規則（`mode: "confirm"`，從下一期開始），本筆交易照常建立。
- **收入「＋新增」分類**：`POST /api/ledger/categories`（`kind: "income"`，放在收入主分類底下），建立後重新載入 catalog 並自動選取。
- **金額計算機**：只在前端計算（十進位定點運算），送出的 `amount` 仍是一般的十進位字串。

## 5. 平板／桌面版面（issue #12）

新版面全部用 v1.0 既有的 API 組出來，**後端不用改就能上線**。以下是前端目前的做法，以及建議在 v1.1 補上的欄位，讓計算移回後端、減少請求數：

| 需要的資料 | v1 前端做法 | v1.1 建議 |
|---|---|---|
| 概覽 KPI（餘額、支出、收入）與上期比較 | 兩次 `GET /transactions?from&to&limit=1`，用回傳的 `summary`（本期、前一個同長度區間），前端用十進位相減算差額與百分比 | `GET /reports/range` 支援任意區間的 `kpi.compare`（目前只比較「上月同期」） |
| 每日收支長條、累積餘額折線 | `GET /transactions?from&to&types=expense,income` 分頁取完（每頁 200 筆、最多 15 頁），前端依日期加總（只算 TWD，其他幣別另外列出不併入）；累積餘額＝區間內收入 − 支出逐日累加 | `GET /reports/range?granularity=day\|week` 回傳 `series`（目前固定 `month`），省掉逐筆下載 |
| 帳戶記錄的「記帳後餘額」 | 直接用契約的 `balance_after`（篩選單一帳戶時才有值；未設定期初時為 null，畫面不顯示） | 不需要修改 |
| 帳戶「記帳筆數」 | `GET /transactions?accounts=<key>&limit=1` 的 `summary.count` | `AccountSummary` 加 `transaction_count` |
| 帳務統計（支出／收入／轉入／轉出／餘額調整） | 該帳戶該月份的交易分頁取完，前端依 `type`＋`direction` 分組加總 | `AccountDetail.period` 加 `by_type: { type, direction, count, amount }[]` |
| 即將到來：「週期 #期數 / 無限期」 | 從 `RecurringRule.start_date`、`freq`、`interval`、`by_monthday` 推算第幾期；有 `end_date` 時算剩餘期數（Asia/Taipei 日期） | `Occurrence` 加 `index: number`、`remaining: number \| null` |
| 帳戶資訊：主帳戶、紅利回饋、國外交易手續費 | 契約沒有，顯示「—」，**不捏造值** | `AccountSummary` 加 `parent_account_key: string \| null`、`reward_rate: number \| null`（例如 0.01 = 1%）、`foreign_fee_rate: number \| null` |
| 帳戶頁「格狀」檢視 | 按鈕顯示「即將推出」 | 不需要 API，之後前端實作 |

## 6. 信用卡逐筆對帳（issue #15，**新增項目**，前端已用 mock 實作）

v1.0 的對帳只比對整體餘額。這一節新增「依電子帳單逐筆核對」需要的型別與端點，全部是**加法**，不改 v1.0 既有的任何欄位或端點。帳單的取得與解析（信箱、PDF、比對演算法、資料表）由後端／Roha 的流程負責，**不是前端端點**；前端只讀取和處理。型別已放在 `src/types/ledger.ts` 的 v1.1 區塊。

### 路由（§8 新增）

```
/finance/reconcile/statements?account=<key>   每期帳單清單
/finance/reconcile/statements/<statement_id>  逐筆對帳
```

### 型別

issue #15 提出的 `Statement`、`StatementLine` 照用，另外補了幾個欄位（標「補充」）：

| 型別 | 欄位 | 說明 |
|---|---|---|
| `Statement` | `reconciled_at: ISODateTime \| null` | 補充：完成對帳的時間 |
| `StatementLine` | `amount` | 以信用卡角度：消費為正，退款、繳款為負 |
| | `match.confirmed: boolean` | 補充：自動配對預設 `false`，使用者確認後為 `true`；手動配對、新增到帳本直接是 `true` |
| | `suggested_category_key: string \| null` | 補充：「新增到帳本」時預設的分類 |
| | `ignore_reason: string \| null` | 補充：忽略時填的原因 |
| | `raw_text: string \| null` | 補充：解析前的原文，「查看原始帳單文字」用（只有這一行，不含帳單其他個資） |
| `StatementDetail` | `ledger: Transaction[]` | 補充：`lines[].match` 和 `candidates` 參照到的帳本記錄，畫面並排顯示用（不用再逐筆查詢） |
| | `totals: { statement, matched_ledger, ledger_period }` | 補充：帳單未忽略行合計、已配對帳本合計、帳本同期間合計 |
| `Transaction` | `statement?: { statement_id; line_id; reconciled; close_date } \| null` | 補充：這筆配對到哪一期帳單的哪一行；`reconciled` 為 `true` 時明細顯示「已對帳」，編輯、刪除前提醒。v1.0 後端不回傳＝視為 `null` |

### 端點

issue #15 的端點照用；所有寫入端點都回傳更新後的 `StatementDetail`，畫面不用再查一次：

| 端點 | 回傳 | 說明 |
|---|---|---|
| GET `/statements?account=` | `{ rows: Statement[] }` | 依結帳日新到舊 |
| GET `/statements/:id` | `StatementDetail` | |
| POST `/statements/:id/lines/:line_id/match` | `StatementDetail` | `{ transaction_id }`；必須是同一張卡、還沒配對到其他行的記錄，否則 `VALIDATION_ERROR` |
| POST `/statements/:id/lines/:line_id/confirm` | `StatementDetail` | 只能確認金額相同的配對；金額不同回 `VALIDATION_ERROR` |
| POST `/statements/:id/lines/:line_id/ignore` | `StatementDetail` | `{ reason? }` |
| POST `/statements/:id/lines/:line_id/add` | `CreateResult & { detail: StatementDetail }` | body 和 `POST /transactions` 相同（只接受支出／收入，帳戶必須是這張卡）；冪等 key 由後端依 `statement_id`＋`line_id` 推導，同一行重送回 `duplicate` |
| POST `/statements/:id/finalize` | `StatementDetail` | 條件不符回 409 `STATEMENT_NOT_BALANCED` |

「金額不同」時的「用帳單金額更新帳本」沿用 v1.0 的 `PATCH /transactions/:id`（帶 `expected_version`），成功後再呼叫 `confirm`；不需要新端點。

### 狀態與完成條件（前端 `src/lib/statement.ts`，後端請用同樣的定義）

- 每一行的 `state` 由後端依配對與帳本即時推算：
  - `ignored`：使用者忽略。
  - 有配對：帳本金額 ≠ 帳單金額 → `amount_differs`；由「新增到帳本」建立 → `added`；其他 → `matched`。配對到的帳本記錄被刪除時，配對自動解除。
  - 沒有配對：同一期有另一行同一天、同金額 → `possible_duplicate`；否則 `missing`。
- **需要處理**：`missing`、`amount_differs`、`possible_duplicate`，以及 `matched` 但 `confirmed = false`。`counts.needs_action` 就是這個數字。
- **差額** = 帳單未忽略行的金額合計 − 已配對帳本記錄的金額合計（信用卡角度）。沒配對的行，帳本那一側算 0。
- 「帳單沒有的帳本記錄」（`unmatched_ledger`）**不計入差額**：卡片消費常常跨期入帳，若用「帳本同期間合計」計算，這些記錄會讓差額永遠不為 0。畫面另外顯示 `totals.ledger_period` 供參考。
- **完成對帳**：需要處理 = 0，且差額 = 0。完成後 `status = "reconciled"`，這一期的寫入端點回 409 `STATEMENT_FINALIZED`。

### 錯誤碼（§5 新增）

| 代碼 | HTTP | 說明 |
|---|---|---|
| `STATEMENT_NOT_BALANCED` | 409 | 還有需要處理的行，或差額不為 0 |
| `STATEMENT_FINALIZED` | 409 | 這一期已完成對帳，不能再修改 |

### 離線

這個畫面離線時唯讀（和 §6 一致）：動作按鈕停用並說明原因，「新增到帳本」不會進離線佇列。
