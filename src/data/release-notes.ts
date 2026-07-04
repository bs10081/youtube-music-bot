import type { ReleaseNotesEntry } from "../types/index.ts";

const fallbackReleaseNotesByVersion: Record<string, ReleaseNotesEntry> = {
  "0.9.1": {
    version: "0.9.1",
    title: "跨曲響度正規化與前端記憶體優化",
    publishedAt: "2026-07-05",
    status: "preview",
    summary:
      "音量平衡改用 EBU R128 loudnorm 濾鏡,歌曲之間的響度真正拉齊;前端修正多處無上限快取與列表渲染成本,長時間使用不再累積記憶體。",
    sections: [
      {
        category: "changed",
        title: "音量平衡改用 loudnorm",
        description: "從動態範圍正規化改為以 -14 LUFS 為目標的響度正規化。",
        items: [
          "dynaudnorm 只會放大安靜段落、壓不下響度戰爭曲目,改用 loudnorm(EBU R128)後偏 loud 的歌會被壓下來、安靜的歌會被拉上去,跨曲聽感一致。",
          "實測:響度差 19.1 dB 的兩首歌(-3.2 與 -22.3 LUFS)套用後收斂到 0.3 dB 以內。",
        ],
      },
      {
        category: "fixed",
        title: "前端記憶體優化",
        description: "移除長時間使用下的記憶體單調增長路徑。",
        items: [
          "Discover 合輯預覽快取加上 30 筆 FIFO 上限,不再隨瀏覽無限累積。",
          "媒體庫刪除紀錄(墓碑)加上 90 天 TTL 與 500 筆上限,同步合併時先套用刪除、持久化前才修剪。",
          "專輯圖色彩擷取加上 15 秒載入逾時,網路停滯不再累積孤兒 Image 物件。",
          "媒體庫、佇列與 Discover 卡片啟用 content-visibility,視窗外的列不再佔用 layout/paint 資源;列表縮圖改為 lazy 載入。",
        ],
      },
    ],
  },
  "0.8.0": {
    version: "0.8.0",
    title: "動態音量平衡與 Discover 個人化",
    publishedAt: "2026-06-12",
    status: "preview",
    summary:
      "音量平衡改用播放器端動態響度濾鏡,新增 UI 開關;Discover 加入由本站點播紀錄驅動的個人化區塊,並補上多項安全與部署強化。",
    sections: [
      {
        category: "changed",
        title: "音量平衡重構",
        description: "從每首歌固定增益改為播放時動態響度正規化。",
        items: [
          "播放管線改用 mpv 的 dynaudnorm 濾鏡即時平衡響度,歌曲內部與歌曲之間的音量起伏都會被拉向一致聽感。",
          "桌面播放器與手機 Now Playing 介面新增「音量平衡」開關,切換後立即生效、不需重新播放。",
          "移除舊的 YouTube loudness metadata 靜態增益路徑,避免與動態濾鏡疊加造成過度衰減。",
        ],
      },
      {
        category: "added",
        title: "Discover 個人化",
        description: "讓 Discover 從通用排行榜變成跟著這個站的口味走。",
        items: [
          "新增「最近常聽」區塊,呈現近 30 天的本站點播紀錄。",
          "新增「為你推薦」區塊,以最常點播的歌曲為種子延伸相似曲目。",
          "尚無點播紀錄時隱藏空白的本站熱門點播卡片,冷啟動直接顯示市場內容。",
        ],
      },
      {
        category: "fixed",
        title: "安全與部署強化",
        description: "收斂預設安全姿態並補齊生產環境基礎設施。",
        items: [
          "CORS 改為可透過 CORS_ORIGIN 白名單設定,未設定時不再同時允許萬用來源與憑證。",
          "Docker 映像建置時驗證 yt-dlp 下載檔的 SHA-256 checksum。",
          "新增 /api/health 健康檢查端點與 docker-compose healthcheck,並補上 .env.example 與啟動環境檢查。",
          "修正 Ctrl+C / docker stop 時伺服器不會確實退出的問題。",
        ],
      },
    ],
  },
  "0.7.11": {
    version: "0.7.11",
    title: "播放器介面全面重整",
    publishedAt: "2026-05-09",
    status: "preview",
    summary:
      "重新整理 WebUI 的視覺系統、手機安全區域與搜尋空狀態，保留專輯封面取色背景，同時降低主要流程被介面裝飾或彈窗打斷的情況。",
    sections: [
      {
        category: "changed",
        title: "視覺系統重整",
        description: "把播放器 UI 收斂到更穩定的 design token 與元件語言。",
        items: [
          "建立更一致的 surface、文字、陰影、圓角與安全區域 token，讓桌面與手機版能共用同一套視覺節奏。",
          "保留專輯封面取色與動態背景，但降低過多光暈與膠囊裝飾，讓歌曲資訊和播放控制更清楚。",
        ],
      },
      {
        category: "fixed",
        title: "手機與搜尋體驗修正",
        description: "修正實機檢視時會直接影響閱讀與操作的 UI 問題。",
        items: [
          "手機內容區改為避開底部迷你播放器與 TabBar，避免 Discover 卡片或列表內容被固定列遮住。",
          "搜尋與空狀態改用動態主題 token，改善淺色背景上文字對比不足的問題。",
          "版本更新視窗不再首次進入就自動覆蓋主畫面，改由版本徽章提示並讓使用者自行開啟。",
        ],
      },
    ],
  },
  "0.7.10": {
    version: "0.7.10",
    title: "Dynamic Voice 保守音量平衡",
    publishedAt: "2026-05-09",
    status: "preview",
    summary:
      "重新收斂 Dynamic Voice 的音量平衡策略，避免系統把較安靜的歌曲額外放大，並讓播放鏈路更容易診斷。",
    sections: [
      {
        category: "fixed",
        title: "音量平衡修復",
        description: "把 Dynamic Voice 固定為只衰減偏 loud 曲目的保守模式。",
        items: [
          "優先使用 YouTube loudnessDb metadata 判斷偏 loud 曲目，只在需要時衰減，不再把安靜歌曲 boost 起來。",
          "播放器套用音量倍率時新增上限防線，確保 Dynamic Voice 開啟後單曲 target volume 不會高於使用者主音量。",
        ],
      },
      {
        category: "changed",
        title: "播放鏈路強化",
        description: "降低串流格式與診斷落差造成的實際聽感偏移。",
        items: [
          "yt-dlp fallback 會優先避開 YouTube DRC 音軌，避免動態壓縮版本再疊加本機音量平衡。",
          "音量平衡 log 新增 metadata source、gain dB、倍率與播放器 target volume，方便追查現場曲目案例。",
          "前端播放 WebSocket 斷線後會持續退避重連，避免本機或部署重啟後畫面停在未連線狀態。",
        ],
      },
    ],
  },
  "0.7.9": {
    version: "0.7.9",
    title: "yt-dlp 播放備援強化",
    publishedAt: "2026-05-08",
    status: "preview",
    summary:
      "強化 yt-dlp 作為生產播放備援路徑，讓 YouTube 串流解析失敗時更快切換、更容易診斷部署環境。",
    sections: [
      {
        category: "changed",
        title: "播放備援強化",
        description: "把 yt-dlp 從最後保底提升為可觀測、可診斷的穩定播放路徑。",
        items: [
          "youtubei.js 直接串流失敗時會清楚記錄錯誤類型，並快速切到 yt-dlp 取得可播放 URL。",
          "yt-dlp fallback 新增 timeout、stderr、exit code 與 URL scheme 驗證，讓生產錯誤更容易定位。",
        ],
      },
      {
        category: "added",
        title: "部署診斷資訊",
        description: "讓部署者能直接確認播放依賴是否真的可用。",
        items: [
          "系統資訊 API 新增 mpv 與 yt-dlp runtime 狀態，包含版本、執行檔、extractor args 與 cookies 可讀狀態。",
          "Docker 部署改用可確認版本的 yt-dlp binary，並保留 cookies 檔掛載範例。",
        ],
      },
    ],
  },
  "0.7.8": {
    version: "0.7.8",
    title: "音量平衡過度放大修正",
    publishedAt: "2026-03-30",
    status: "preview",
    summary:
      "修正音量平衡會把偏安靜歌曲額外放大的問題，讓官方 MV 與一般音軌之間的聽感音量更穩定一致。",
    sections: [
      {
        category: "fixed",
        title: "音量平衡修復",
        description: "避免 normalization 在遇到較安靜的歌曲時反而把它額外放大。",
        items: [
          "修正音量平衡只會衰減偏 loud 的曲目，不再因 YouTube loudness metadata 把較安靜的官方 MV 額外放大。",
          "保留過大曲目的 attenuation cap，讓音量平衡開啟時仍能壓低像 How Sweet 這類本來偏 loud 的歌曲。",
        ],
      },
      {
        category: "fixed",
        title: "回歸驗證補強",
        description: "把這次真實 metadata case 轉成測試，避免 quiet track boost regression 再次出現。",
        items: [
          "補上 ROSÉ 官方 MV 與 loudness fallback 的 regression tests，確認安靜曲目維持 1x、偏 loud 曲目仍會被衰減。",
        ],
      },
    ],
  },
  "0.7.7": {
    version: "0.7.7",
    title: "音量播放與 Discover 修正",
    publishedAt: "2026-03-29",
    status: "preview",
    summary:
      "修正切歌偶發靜音、重新校準音量平衡換算，並補正 Discover 本站排名歌曲長度偶發顯示 0:00 的問題。",
    sections: [
      {
        category: "fixed",
        title: "播放穩定性修復",
        description: "優先處理直接影響切歌可用性的 regression。",
        items: [
          "修正切到下一首時偶發無聲，避免預載與 Crossfade 轉場遺失目標音量。",
        ],
      },
      {
        category: "changed",
        title: "音量平衡調整",
        description: "讓音量平衡改用更穩定、可預期的 metadata 解讀與同步流程。",
        items: [
          "修正音量平衡對 YouTube loudness metadata 的換算與套用時機，讓不同歌曲的體感音量更一致。",
        ],
      },
      {
        category: "fixed",
        title: "回歸驗證補強",
        description: "把這次修正轉成可重複驗證的測試，降低再次發生的機率。",
        items: [
          "補上播放器音量同步與版本說明的 regression tests，降低後續再發機率。",
        ],
      },
      {
        category: "fixed",
        title: "Discover 排行資料補正",
        description: "避免本站排名沿用錯誤的歌曲 metadata，造成時長顯示異常。",
        items: [
          "修正本站排名歌曲長度被 0 覆蓋後持續顯示 0:00 的問題，並在榜單讀取時自動回填缺失 metadata。",
        ],
      },
    ],
  },
  "0.7.6": {
    version: "0.7.6",
    title: "Discover 體驗定稿與播放增強",
    publishedAt: "2026-03-28",
    status: "released",
    summary:
      "把 Discover 補成更完整的探索入口，加入音樂影片焦點展示、榜單化熱門點播，以及更聰明的自動 Mix 與播放調整。",
    sections: [
      {
        category: "added",
        title: "全新功能",
        description: "補上這一輪真正新增的探索與播放能力。",
        items: [
          "新增音樂影片焦點區塊，會把影片型 Discover section 改成大尺寸 hero 版型，方便先看視覺氛圍再決定是否播放。",
          "播放器新增音量平衡開關，會依 YouTube loudness metadata 自動調整增益，讓不同歌曲的實際聽感音量更一致。",
          "版本說明頁可直接整合 GitHub Releases，若目前版本尚未發布，會自動回退到本機版本資料。",
        ],
      },
      {
        category: "changed",
        title: "Discover 體驗增強",
        description: "把原本偏展示的卡片整理成更接近真實產品節奏的探索介面。",
        items: [
          "本站熱門點播改為榜單式版型，加入冠軍焦點卡與後續名次列表，更容易快速理解站內熱門內容。",
          "Discover 卡片支援更完整的專輯、播放清單與歌手導覽，專輯與播放清單卡片也會預先露出曲目 preview。",
          "桌面側欄 idle state 會依目前所在區域切換文案，Discover 模式下會直接提示從市場探索、熱門點播或新專輯開始播放。",
          "Auto Mix / radio 補歌現在會優先使用待播佇列最後一首歌當作 seed，再依序回退到目前播放與上一首歌曲，讓後續推薦更貼近整體播放方向。",
        ],
      },
      {
        category: "fixed",
        title: "問題修復",
        description: "修正 Discover 與播放流程中幾個會直接影響可用性的細節。",
        items: [
          "修正 Discover 專輯、播放清單與音樂影片項目的部分藝人名稱顯示為 Unknown、時長為 0 或封面不一致的解析問題。",
          "改善 Discover 橫向卡片的尺寸、對齊、陰影裁切與操作區布局，避免不同內容類型混排時出現高低不齊或按鈕擠壓。",
          "熱門點播、音樂影片與其他探索卡片的互動層級重新整理後，加入佇列、建立 Mix 與收藏的操作會更穩定且更容易理解。",
        ],
      },
    ],
  },
  "0.7.0": {
    version: "0.7.0",
    title: "Discover 多市場探索",
    publishedAt: "2026-03-28",
    status: "released",
    summary: "把探索體驗從搜尋頁獨立出來，改成可切換 8 個市場的 Discover 首頁。",
    sections: [
      {
        category: "added",
        title: "全新功能",
        description: "加入新的探索入口與跨市場內容瀏覽能力。",
        items: [
          "新增 Discover 頁面，可直接切換台灣、美國、日本、韓國、英國、德國、巴西與墨西哥等 8 個市場。",
          "每個市場會動態載入 YouTube Music 的情境與類型分類，快速切換不同 mood 探索內容。",
          "Discover 頁面加入本站熱門點播區，能看到目前站內最常被主動點播的歌曲。",
        ],
      },
      {
        category: "changed",
        title: "探索流程增強",
        description: "把探索內容做成真正可操作的內容卡片，而不是只做瀏覽展示。",
        items: [
          "探索卡片支援單曲加入佇列、建立 Mix、收藏，以及整張專輯或整個播放清單直接排入佇列。",
          "桌面與手機版都能直接切換到 Discover，不再把探索內容混進搜尋頁。",
        ],
      },
    ],
  },
  "0.6.0": {
    version: "0.6.0",
    title: "性能提升與無縫播放",
    publishedAt: "2026-03-24",
    status: "released",
    summary: "聚焦在播放引擎與切歌體驗，讓等待更短、轉場更自然。",
    sections: [
      {
        category: "changed",
        title: "播放功能增強",
        description: "優先改善切歌、預載與轉場手感。",
        items: [
          "新增下一首預加載機制，降低切歌時等待串流解析的停頓感。",
          "播放器支援可調整秒數的 Crossfade，並優化淡入淡出曲線，讓歌曲之間的銜接更自然。",
          "播放器介面新增 Crossfade 開關與秒數控制，桌面與手機版都可即時同步。",
          "播放核心加入更積極的 stream URL 快取與重用，減少重複解析負擔。",
        ],
      },
      {
        category: "changed",
        title: "歌詞閱讀優化",
        description: "改善操作歌詞時的可讀性與定位效率。",
        items: [
          "手動捲動歌詞時會降低模糊並提升鄰近行可讀性，方便邊看邊找段落。",
        ],
      },
    ],
  },
  "0.5.0": {
    version: "0.5.0",
    title: "搜尋與播放切換修正",
    publishedAt: "2026-03-23",
    status: "released",
    summary: "同時補上搜尋加入播放鏈路、外部連結解析與多項播放穩定性修正。",
    sections: [
      {
        category: "added",
        title: "全新功能",
        description: "擴大可匯入來源，讓搜尋與連結都能直接接到播放流程。",
        items: [
          "支援從 YouTube / YouTube Music 連結解析單曲、歌單、專輯與 Mix 內容。",
          "Mix 列表中的單首歌曲或影片可各自加入播放佇列、歌單與收藏。",
        ],
      },
      {
        category: "changed",
        title: "播放與搜尋增強",
        description: "改善使用者把內容送進播放佇列時的連續性。",
        items: [
          "搜尋結果現在可正確加入播放佇列，並在空佇列時自動開始播放。",
        ],
      },
      {
        category: "fixed",
        title: "問題修復",
        description: "補強播放狀態、顯示與連線穩定性。",
        items: [
          "Mix 內容的作者名稱顯示已修正，不再誤顯示為 Unknown。",
          "WebSocket 連線穩定性已改善，降低前端重複掛載造成的斷線問題。",
          "播放器在手動跳歌與自動切歌時會顯示正確的載入狀態，且不再沿用上一首的進度條位置。",
        ],
      },
    ],
  },
  "0.4.0": {
    version: "0.4.0",
    title: "播放體驗更新",
    publishedAt: "2026-03-19",
    status: "released",
    summary: "建立更完整的播放器操作面，並補上搜尋捷徑與版本說明入口。",
    sections: [
      {
        category: "added",
        title: "全新功能",
        description: "加入更多直接操作播放內容的入口。",
        items: [
          "新增 Cmd/Ctrl + K 快捷鍵，可快速聚焦到搜尋功能。",
          "歌曲項目可開啟專輯檢視，快速瀏覽同專輯的其他曲目。",
          "新增可捲動的版本更新說明對話框，可查看此版本的重點變更與建置資訊。",
        ],
      },
      {
        category: "changed",
        title: "播放介面增強",
        description: "強化桌面播放器、專輯檢視與已儲存 Mix 的可操作性。",
        items: [
          "歌單列右側的加號按鈕現在會直接將歌曲加入播放佇列。",
          "桌面播放器中的長歌名、歌手名稱與專輯名稱會在需要時改為跑馬燈顯示，且只在實際捲動時套用邊緣虛化。",
          "專輯檢視中的歌曲現在可直接加入收藏、加入歌單，並可一次把整張專輯加入播放佇列。",
          "已儲存 Mix 區塊改為可完整展開並以內部捲動瀏覽，不再出現內容被截斷的情況。",
        ],
      },
    ],
  },
};

export function compareReleaseNoteVersionsDesc(
  left: string,
  right: string,
): number {
  const leftParts = left
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return rightPart - leftPart;
    }
  }

  return 0;
}

export function getFallbackReleaseNotesForVersion(
  version: string,
): ReleaseNotesEntry | null {
  return fallbackReleaseNotesByVersion[version] ?? null;
}

export function getFallbackReleaseNotes(): ReleaseNotesEntry[] {
  return Object.values(fallbackReleaseNotesByVersion).sort((left, right) => {
    const publishedDateComparison = right.publishedAt.localeCompare(left.publishedAt);

    if (publishedDateComparison !== 0) {
      return publishedDateComparison;
    }

    return compareReleaseNoteVersionsDesc(left.version, right.version);
  });
}
