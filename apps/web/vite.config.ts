import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const API_TARGET = process.env["LEXORA_API_URL"] ?? "http://127.0.0.1:3000";

/**
 * The Content Security Policy the production reverse proxy will send
 * (Phase 9). `vite preview` sends it too, so end-to-end tests run the built
 * app under the real policy and fail if anything needs inline scripts,
 * inline styles or outside origins.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const productionHeaders = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const apiProxy = {
  "/api": { target: API_TARGET, changeOrigin: false },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@lexora/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
    headers: productionHeaders,
  },
  build: {
    sourcemap: false,
    // Fonts and icons stay as separate files, never inlined as data: URLs.
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        // Libraries change less often than our code; separate chunks let
        // browsers keep them cached across deployments.
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
              priority: 3,
            },
            { name: "data", test: /[\\/]node_modules[\\/](@tanstack|zod)[\\/]/, priority: 2 },
            {
              name: "i18n",
              test: /[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/,
              priority: 2,
            },
            { name: "vendor", test: /[\\/]node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    css: false,
  },
});
