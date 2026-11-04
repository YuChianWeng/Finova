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
