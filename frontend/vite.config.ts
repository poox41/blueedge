import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: process.env.VITE_BFF_PROXY_TARGET || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/product-api": {
        target: process.env.VITE_GATEWAY_PROXY_TARGET || "http://127.0.0.1:7001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
