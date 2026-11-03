# Finova 記帳（前端）

依 **FRONTEND-CONTRACT v1.0（凍結版）** 開發的記帳前端。頁面在 `/finance`，只呼叫 `/api/ledger/*`。後端還沒好之前，用 `mocks/` 裡的 mock API 開發。

- 首頁：帳戶總覽 `/finance/accounts`（iOS 加到主畫面的 `start_url`）
- 第二頁：每日明細 `/finance`（月曆＋當日明細＋本月總覽，對應契約的「總覽」）
- 深色／淺色主題，手機與桌面版

## 開始

```bash
npm install
npm run dev          # http://localhost:5173/finance/ ，使用 mock API
npm test             # mock 資料與契約行為的測試
npm run typecheck
```

接真實後端：

```bash
VITE_API_TARGET=https://你的網站 npm run dev:api   # 不載入 mock，/api 轉送到後端
npm run build                                    # 正式版輸出到 dist/（不含 mock）
```

部署時，伺服器要把 `/finance/*` 都回 `dist/index.html`（前端用 history 路由）。`dist/sw.js` 必須放在 `/finance/` 底下。

## 目錄

| 路徑 | 內容 |
|---|---|
| `src/types/ledger.ts` | 契約 §1–§4 的型別，**原樣複製**，前後端共用的正式來源 |
| `src/api/client.ts` | 回應信封、錯誤碼、503 自動重試 2 次、登入過期偵測（401／被導向／收到 HTML） |
| `src/api/ledger.ts` | 每個端點的型別化函式（契約 §3、§4） |
| `src/api/offline.ts` | 離線新增佇列（IndexedDB）與同步 |
| `src/lib/money.ts` | 金額字串的十進位運算（BigInt）與顯示格式；不同幣別絕不相加 |
| `src/lib/dates.ts` | Asia/Taipei 時區、週一開始、ISO 週 |
| `src/views/*` | 各頁面 |
| `src/ui/entry.ts` | ＋ 記一筆／編輯表單 |
| `public/sw.js` | Service worker：離線時讀快取（catalog、overview、最近一頁明細） |
| `mocks/fixtures/*.json` | DESIGN-BRIEF §8 的假資料，加上契約 §7 要求的情境 |
| `mocks/db.ts`、`mocks/handlers.ts` | 記憶體資料庫、各端點實作 |
| `mocks/browser.ts` | 在瀏覽器攔截 `fetch('/api/ledger/*')`、模擬錯誤 |

## 契約對照

| 契約 | 前端做法 |
|---|---|
| §1.2 金額是字串 | 顯示一律由 `lib/money` 格式化；加總用 BigInt；多幣別分開列出 |
| §1.5 冪等 | 開表單時產生 `web:<uuid>`，重送與離線佇列沿用同一把；`duplicate` 視同成功；`IDEMPOTENCY_CONFLICT` 會先問你，再決定是否當成新的一筆 |
| §1.6 樂觀鎖 | PATCH／DELETE 帶 `expected_version`；`VERSION_CONFLICT` 時顯示 `error.current` 的最新內容並提供「重新載入」 |
| §2.1 catalog | 啟動時載入、快取 5 分鐘；遇到 `UNKNOWN_*` 錯誤時強制重新載入。分類、帳戶、標籤、常用項目都來自 catalog，前端沒有寫死 |
| §2.3 符號約定 | 信用卡、負債的負數餘額顯示成「欠款 NT$ 6,354」 |
| §5 錯誤碼 | `details` 顯示在對應欄位旁；503 自動重試 2 次（同一把 key），仍失敗時顯示重試按鈕 |
| §6 登入過期 | 表單存到 sessionStorage，顯示「重新登入」，導向 `/cdn-cgi/access/login?redirect_url=…`；回來後自動還原 |
| §6 離線 | 新增進佇列並標「待同步」；`online`、回到前景或按「同步」時依序送出；4xx 留在佇列等你修正；編輯、刪除、對帳在離線時停用 |
| §8 路由 | `/finance`、`/transactions`（篩選放在 query，名稱和 API 參數相同）、`/transactions/:id`、`/new?type=`、`/accounts[/:key]`、`/reports/daily…trend`、`/budgets`、`/projects[/:id]`、`/goals[/:id]`、`/reconcile?account=`、`/settings/*` |

## Mock 錯誤模擬

在「設定 › 開發用 Mock」切換，或在網址加 `?mock=<情境>`：

| 情境 | 效果 |
|---|---|
| `validation` | 下一次寫入回 `VALIDATION_ERROR`，附欄位錯誤 |
| `version` | 下一次修改或刪除回 `VERSION_CONFLICT`（模擬別處先改過） |
| `idempotency` | 下一次新增回 `IDEMPOTENCY_CONFLICT` |
| `auth` | 下一個請求被導向登入頁（HTML）→ `AUTH_EXPIRED` |
| `busy` | 寫入先回 503 兩次後成功（看自動重試） |
| `down` | 寫入一律回 503（看重試按鈕） |
| `offline` | 模擬離線 |
| `slow` | 每個請求延遲 1.2 秒 |

Mock 的「今天」固定是 2026-11-03，和 DESIGN-BRIEF 的假資料一致。1–10 月的歷史交易由 `mocks/db.ts` 依 `history.json` 決定性產生，所以每次重新整理數字都相同；重新整理也會把 mock 資料還原。

## 單檔預覽版

```bash
npm run build:preview   # dist-preview/finova-preview.html：含 mock、記憶體路由，可直接開啟或分享
```
