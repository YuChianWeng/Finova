# 部署：把記帳頁掛到財富儀表板的 `/finance`

依 FRONTEND-CONTRACT §0 F-2、F-3、§6、§8 與 TECH-SPEC §13.1：記帳頁和財富儀表板在**同一個網站**，頁面在 `/finance`，API 在同源的 `/api/ledger/*`，全部由同一個 Cloudflare Access application 保護。

## 0. 上線前提（先看這段）

| 條件 | 為什麼 |
|---|---|
| 後端 `/api/ledger/*` 已在同一個網域上線，至少有 `GET /catalog`、`/overview`、`/accounts`、`/transactions` | 正式建置（`npm run build`）**不含 mock**。後端還沒好就切到正式的 `/finance`，每一頁都會顯示錯誤 |
| 財富儀表板原本的 `/finance`、`/finance/accounts`、`/finance/reviews` 已搬到別的路徑（建議 `/wealth/...`），或確定要被記帳頁取代 | 兩邊都要用 `/finance/*`，不能同時存在 |
| Cloudflare Access 同一個 application 涵蓋 `/finance*` 和 `/api/ledger*`（或整個網域） | 前端在 401 或被導向時會跳到 `/cdn-cgi/access/login?redirect_url=…`，這要求頁面和 API 共用同一個 Access session |

後端還沒好之前：只部署到 **staging 網域**（例如 `staging.你的網域`，一樣用 `/finance` 路徑、一樣有 Access），正式網域維持原狀。`base` 固定是 `/finance/`，所以 staging 用不同網域，而不是不同路徑。

## 1. 選定的整合方式：由 Next.js 提供 `dist/`

財富儀表板已經是 Next.js，記帳頁的建置結果是純靜態檔，直接放進 Next 的 `public/`，用 `beforeFiles` rewrite 接管 `/finance/*`。不用多一台伺服器，也不用另外設定 reverse proxy。

```
財富儀表板/
├─ next.config.mjs
├─ finance/next-finance.mjs      ← 從這個 repo 的 deploy/next-finance.mjs 複製
└─ public/finance-spa/           ← 這個 repo 的 dist/ 內容
   ├─ index.html
   ├─ assets/…
   ├─ sw.js、manifest.webmanifest
   └─ logo-*.png、apple-touch-icon.png、icon-maskable-*.png、favicon-64.png
```

`next.config.mjs`：

```js
import { financeRewrites, financeHeaders } from "./finance/next-finance.mjs";

export default {
  async rewrites() {
    return { beforeFiles: financeRewrites() };
  },
  async headers() {
    return [...financeHeaders()];
  },
};
```

`deploy/next-finance.mjs` 做的事：

| 請求 | 回什麼 |
|---|---|
| `/finance/assets/*` | `public/finance-spa/assets/*`（缺檔就 404，不會回 index.html） |
| `/finance/sw.js`、`manifest.webmanifest`、各圖示 | `public/finance-spa/` 裡的同名檔案 |
| `/finance`、`/finance/` 以及其他 `/finance/*` | `public/finance-spa/index.html`（SPA fallback） |

如果 Next 已經有自己的 `rewrites()` 或 `headers()`，把上面兩個函式的結果併進去即可。

### Service worker scope

`sw.js` 的網址必須是 `/finance/sw.js`，scope 才會是 `/finance/`。上面的 rewrite 讓瀏覽器看到的網址就是 `/finance/sw.js`（實際檔案在 `public/finance-spa/`），所以不需要額外設定；保險起見也加了 `Service-Worker-Allowed: /finance/`。

不要讓 `/finance-spa/sw.js` 被註冊：前端只會註冊 `${BASE_URL}sw.js`，也就是 `/finance/sw.js`。

### 快取標頭

| 路徑 | `Cache-Control` | 原因 |
|---|---|---|
| `/finance`、`/finance/*`（index.html） | `no-cache` | 部署後下一次開啟就拿到新版 |
| `/finance/sw.js` | `no-cache` | 瀏覽器才會檢查 service worker 更新 |
| `/finance/manifest.webmanifest`、圖示 | `no-cache` | 換圖示時才會更新 |
| `/finance/assets/*` | `public, max-age=31536000, immutable` | 檔名含 hash，內容不會變 |

### 替代做法：前面有 nginx

如果網站前面本來就有 nginx，也可以讓 nginx 直接提供 `dist/`，其他路徑再轉給 Next。設定在 `deploy/nginx-finance.conf`，內容涵蓋同樣的 fallback、例外檔案和快取標頭。兩種做法擇一，不要同時用。

## 2. Cloudflare Access

- **Application**：同一個 self-hosted application，路徑涵蓋 `/finance*` 與 `/api/ledger*`（或整個網域）。不要把 API 拆成另一個 application，否則頁面登入了、API 仍會回 401。
- **Session duration**：建議 30 天（TECH-SPEC §13.1），減少手機上重新登入的次數。
- **登入過期**：API 回 401、被導向登入頁或回 HTML 時，前端會把填到一半的表單存到 sessionStorage，顯示「重新登入」，導向 `/cdn-cgi/access/login?redirect_url=<目前網址>`，回來後自動還原。
- **iOS 主畫面 App**：從主畫面開啟的 App 和 Safari **不共用 cookie**，所以第一次從主畫面開啟時要在 App 裡再登入一次；之後由 Access session 期限決定。如果身分提供者（例如 Google）的登入頁跳到 Safari 後回不來，改用 Access 的 One-time PIN 登入，整個流程會留在 App 裡。

## 3. 上線步驟

1. **後端**：`/api/ledger/*` 部署到 staging，確認 `GET /api/ledger/catalog` 回 `{ "version": 1, "data": … }`。
2. **建置**：
   ```bash
   npm ci
   npm test
   npm run build
   ```
   確認 `dist/` 裡沒有 mock 資料（`grep -rl Wallet_TWD dist/` 應該沒有結果）。
3. **staging**：把 `dist/` 複製到財富儀表板的 `public/finance-spa/`，加上 rewrite／headers，部署到 staging 網域。
4. **驗收**（staging，iPhone 實機，TECH-SPEC §13.1）：
   - `/finance`、`/finance/accounts`、`/finance/transactions?type=expense` 直接開啟（重新整理）都正常，不是 404。
   - `/finance/assets/不存在.js` 回 404，不是 index.html。
   - DevTools → Application → Service Workers：scope 是 `/finance/`。
   - 加入主畫面，從圖示開啟：直接進入帳戶總覽、狀態列文字看得到、聚焦輸入框不會放大、下拉可以更新。
   - 關掉網路記一筆，顯示「待同步」；恢復網路後自動送出。
   - Access 登出後操作，出現「重新登入」，登入後表單還原。
5. **正式**：同一個 commit 部署到正式網域。

## 4. 回滾

- **前端**：把 `public/finance-spa/` 換回上一版的 `dist/` 重新部署（或回滾財富儀表板的部署）。因為 `index.html` 和 `sw.js` 都是 `no-cache`，使用者下一次開啟就會拿到舊版。
- **完全撤下記帳頁**：移除 `beforeFiles` 裡的 `financeRewrites()`，`/finance` 就回到 Next 自己的頁面。已安裝的 service worker 仍在 `/finance/` scope，但它是「先走網路」，有網路時不會擋住 Next 的頁面；要徹底移除，可以暫時提供一個只做 `self.registration.unregister()` 的 `/finance/sw.js`。
- **改版 service worker 快取**：修改 `public/sw.js` 的 `VERSION`，舊快取會在新 service worker 啟用時刪除。
