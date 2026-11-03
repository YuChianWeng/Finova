import { defineConfig, loadEnv } from "vite";

// 頁面在 /finance，API 在 /api/ledger（FRONTEND-CONTRACT §0 F-2）。
// 模式：
//   npm run dev        → 使用 mocks/（瀏覽器內攔截 fetch，不需要後端）
//   npm run dev:api    → 不載入 mock，/api 轉送到 VITE_API_TARGET（真實後端）
//   build:preview      → 單一 HTML 預覽版（含 mock、記憶體路由）
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "/finance/",
    plugins: [{
      name: "finance-no-slash",
      configureServer(server) {
        // /finance（沒有斜線）→ /finance/，和正式環境的行為一致
        server.middlewares.use((req, res, next) => {
          if (req.url === "/finance" || req.url?.startsWith("/finance?")) { res.statusCode = 302; res.setHeader("Location", "/finance/" + req.url.slice(8)); res.end(); return; }
          next();
        });
      },
    }],
    server: {
      proxy: env.VITE_API_TARGET
        ? { "/api": { target: env.VITE_API_TARGET, changeOrigin: true } }
        : undefined,
    },
    build: {
      outDir: mode === "preview" ? "dist-preview" : "dist",
      assetsInlineLimit: mode === "preview" ? 100_000_000 : 4096,
      cssCodeSplit: mode !== "preview",
      rollupOptions: mode === "preview" ? { output: { inlineDynamicImports: true } } : undefined,
    },
  };
});
