import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { getAppMetadata } from "../src/utils/app-metadata.ts";

const metadata = getAppMetadata();
const devHost = process.env.VITE_DEV_HOST?.trim() || "127.0.0.1";
const devPort = Number.parseInt(process.env.VITE_DEV_PORT || "5174", 10);
const backendOrigin =
  process.env.VITE_BACKEND_ORIGIN?.trim() || "http://localhost:3000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(metadata.appVersion),
    "import.meta.env.VITE_APP_GIT_SHA": JSON.stringify(metadata.gitSha),
    "import.meta.env.VITE_APP_BUILD_VERSION": JSON.stringify(
      metadata.buildVersion,
    ),
    "import.meta.env.VITE_APP_ENVIRONMENT": JSON.stringify(metadata.environment),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: devHost,
    port: Number.isFinite(devPort) ? devPort : 5174,
    strictPort: true,
    fs: { allow: [path.resolve(__dirname)] },
    proxy: {
      "/api": {
        target: backendOrigin,
        changeOrigin: true,
      },
      "/ws": {
        target: backendOrigin,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws/, "/ws"),
      },
    },
  },
});
