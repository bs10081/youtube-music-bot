import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import api from "./routes/api.ts";
import {
  handleWebSocketMessage,
  handleWebSocketOpen,
  handleWebSocketClose,
  initializeWebSocket,
} from "./websocket/handler.ts";
import {
  handleSyncWebSocketClose,
  handleSyncWebSocketMessage,
  handleSyncWebSocketOpen,
} from "./websocket/sync-handler.ts";
import {
  initializeFoliaBridge,
  isFoliaBridgeEnabled,
  startFoliaServer,
} from "./websocket/folia-bridge.ts";

type SocketData = {
  channel: "playback" | "sync";
};

const app = new Hono();

// CORS_ORIGIN:逗號分隔的允許來源白名單(例如 "https://music.example.com,http://192.168.1.10:3000")。
// 未設定時退回開放 origin,但不可與 credentials 並用(W3C 規範禁止 "*" + credentials 組合)。
function resolveCorsOrigins(): string[] | null {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) {
    return null;
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : null;
}

const corsOrigins = resolveCorsOrigins();

// 添加 CORS 支持（必須放在 serveStatic 之前）
app.use(
  "/*",
  cors(
    corsOrigins
      ? {
          origin: corsOrigins,
          allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
          allowHeaders: ["Content-Type", "Authorization"],
          credentials: true,
        }
      : {
          origin: "*",
          allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
          allowHeaders: ["Content-Type", "Authorization"],
        },
  ),
);

// 提供靜態檔案
// 生產環境使用 frontend/dist，開發環境使用 public
const staticRoot =
  process.env.NODE_ENV === "production" ? "./frontend/dist" : "./public";
app.use("/*", serveStatic({ root: staticRoot }));

// API 路由
app.route("/api", api);

// WebSocket 路由（Bun 原生支援）
export function createServer() {
  // 初始化 WebSocket 廣播
  initializeWebSocket();

  // Folia Now Playing bridge(選配,獨立 port,預設關閉)
  if (isFoliaBridgeEnabled()) {
    initializeFoliaBridge();
    startFoliaServer();
  }
  const configuredPort = Number.parseInt(process.env.PORT || "3000", 10);
  const port = Number.isFinite(configuredPort) ? configuredPort : 3000;
  const hostname = process.env.HOST?.trim() || undefined;

  return Bun.serve<SocketData>({
    port,
    hostname,
    fetch(req, server) {
      // WebSocket 升級
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const success = server.upgrade(req, {
          data: { channel: "playback" } satisfies SocketData,
        });
        return success
          ? undefined
          : new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (url.pathname === "/ws/sync") {
        const success = server.upgrade(req, {
          data: { channel: "sync" } satisfies SocketData,
        });
        return success
          ? undefined
          : new Response("WebSocket upgrade failed", { status: 500 });
      }

      // 一般 HTTP 請求
      return app.fetch(req, server);
    },
    websocket: {
      open(ws) {
        if (ws.data?.channel === "sync") {
          handleSyncWebSocketOpen(ws);
          return;
        }

        handleWebSocketOpen(ws);
      },
      message(ws, message) {
        if (ws.data?.channel === "sync") {
          handleSyncWebSocketMessage(ws, message.toString());
          return;
        }

        handleWebSocketMessage(ws, message.toString());
      },
      close(ws) {
        if (ws.data?.channel === "sync") {
          handleSyncWebSocketClose(ws);
          return;
        }

        handleWebSocketClose(ws);
      },
    },
  });
}
