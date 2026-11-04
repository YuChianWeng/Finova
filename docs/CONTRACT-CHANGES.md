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
