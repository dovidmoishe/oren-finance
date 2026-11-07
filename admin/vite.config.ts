import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3070,
    strictPort: true,
    proxy: {
      "/api/admin": {
        target: process.env.ADMIN_API_TARGET || "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
  preview: { port: 3071, strictPort: true },
});
