/**
 * 把 Finova 記帳 SPA 掛到財富儀表板（Next.js）的 /finance。
 *
 * 用法（財富儀表板的 next.config.mjs）：
 *
 *   import { financeRewrites, financeHeaders } from "./finance/next-finance.mjs";
 *   export default {
 *     async rewrites() { return { beforeFiles: financeRewrites() }; },
 *     async headers() { return [...financeHeaders()]; },
 *   };
 *
 * 前提：`npm run build` 的 dist/ 內容複製到 Next 專案的 public/finance-spa/（見 docs/DEPLOY.md）。
 * 使用 beforeFiles，所以優先於 Next 原本的 /finance 頁面；原本的 /finance、/finance/accounts、
 * /finance/reviews 要先搬走（例如 /wealth/*），否則會被這裡蓋掉。
 */
const SPA_DIR = "/finance-spa";
// public/ 底下要原樣提供的檔案（不能被 SPA fallback 吃掉）
const STATIC_FILES = [
  "sw.js", "manifest.webmanifest", "favicon-64.png", "logo-192.png", "logo-512.png",
  "apple-touch-icon.png", "icon-maskable-192.png", "icon-maskable-512.png",
];

export function financeRewrites() {
  return [
    { source: "/finance/assets/:path*", destination: `${SPA_DIR}/assets/:path*` },
    ...STATIC_FILES.map((f) => ({ source: `/finance/${f}`, destination: `${SPA_DIR}/${f}` })),
    // 其他 /finance 路徑都回 index.html（前端用 history 路由）
    { source: "/finance", destination: `${SPA_DIR}/index.html` },
    { source: "/finance/:path*", destination: `${SPA_DIR}/index.html` },
  ];
}

export function financeHeaders() {
  const noCache = [{ key: "Cache-Control", value: "no-cache" }];
  return [
    // 頁面與 service worker 每次都要重新驗證，部署後才會立刻生效
    { source: "/finance", headers: noCache },
    { source: "/finance/:path*", headers: noCache },
    { source: "/finance/sw.js", headers: [...noCache, { key: "Service-Worker-Allowed", value: "/finance/" }] },
    // 檔名帶 hash，可以長期快取（這條放在後面，會覆蓋上面的 no-cache）
    { source: "/finance/assets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    // 直接存取 public/finance-spa/ 的路徑不對外
    { source: `${SPA_DIR}/:path*`, headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
  ];
}
