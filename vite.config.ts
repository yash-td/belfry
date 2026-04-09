import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Claude Station dev server — frontend on 5173, proxies /api → backend on 5174.
// Both bind to 127.0.0.1 only. Do NOT expose this to the network.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        changeOrigin: false,
      },
      "/ws": {
        target: "ws://127.0.0.1:5174",
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
