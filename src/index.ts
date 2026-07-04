import { createServer } from './server.ts';
import { getAppMetadata } from "./utils/app-metadata.ts";
import { validateEnvironment } from "./utils/env.ts";
import { logRuntimeDependencyStatus } from "./utils/runtime-dependencies.ts";
import {
  isFoliaBridgeEnabled,
  resolveFoliaHost,
  resolveFoliaPort,
  stopFoliaServer,
} from "./websocket/folia-bridge.ts";

const metadata = getAppMetadata();
validateEnvironment();
logRuntimeDependencyStatus();
const server = createServer();
const displayHost = process.env.HOST?.trim() || "localhost";

// player.service 的 SIGINT/SIGTERM handler 只負責清理 mpv,不會結束 process;
// 這裡停止接受新連線後明確退出,避免 Ctrl+C / docker stop 時卡住。
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopFoliaServer();
    server.stop();
    process.exit(0);
  });
}

const foliaBanner = isFoliaBridgeEnabled()
  ? `\n🎤 Folia bridge: ws://${resolveFoliaHost()}:${resolveFoliaPort()}/api/ws/lyric`
  : "";

console.log(`
╔════════════════════════════════════════════╗
║  YouTube Music 點歌機器人 WebUI           ║
╚════════════════════════════════════════════╝

🏷️  Version: ${metadata.buildVersion}
🎵 Server running at: http://${displayHost}:${server.port}
🌐 WebSocket endpoint: ws://${displayHost}:${server.port}/ws${foliaBanner}

請使用瀏覽器開啟 http://${displayHost}:${server.port} 來使用點歌系統。
確保已安裝 mpv 播放器：
  - macOS: brew install mpv
  - Ubuntu: sudo apt install mpv
  - Windows: 從 https://mpv.io 下載

按 Ctrl+C 停止伺服器。
`);
