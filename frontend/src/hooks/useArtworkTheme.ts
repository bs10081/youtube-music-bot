import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Vibrant } from "node-vibrant/browser";
import { usePlayerStore } from "@/stores/playerStore";
import { getOptimizedThumbnail, ThumbnailQuality } from "@/utils/thumbnail";
import {
  ARTWORK_THEME_TOKEN_NAMES,
  type ArtworkPalette,
  type ArtworkThemeMode,
  type ArtworkThemeTokens,
  buildArtworkProxyUrl,
  getDefaultArtworkThemeTokens,
  normalizeArtworkThemeTokens,
} from "@/utils/artworkTheme";
import { setCappedCacheValue } from "@/utils/cappedCache";

const resolvedThemeCache = new Map<string, ArtworkThemeTokens | null>();
const pendingThemeCache = new Map<string, Promise<ArtworkThemeTokens | null>>();

const THEME_CROSSFADE_DURATION_MS = 640;
const THEME_CACHE_LIMIT = 40;
const IMAGE_LOAD_TIMEOUT_MS = 15000;

export interface ArtworkThemeState {
  currentTokens: ArtworkThemeTokens;
  previousTokens: ArtworkThemeTokens | null;
  transitionKey: number;
}

export function useArtworkTheme(): ArtworkThemeState {
  const currentTrack = usePlayerStore((state) => state.playbackState.currentTrack);
  const [themeMode, setThemeMode] = useState<ArtworkThemeMode>(() =>
    detectThemeMode(),
  );
  const [themeState, setThemeState] = useState<ArtworkThemeState>(() => ({
    currentTokens: getDefaultArtworkThemeTokens(detectThemeMode()),
    previousTokens: null,
    transitionKey: 0,
  }));
  const clearPreviousTimeoutRef = useRef<number | null>(null);
  const artworkUrl = currentTrack?.thumbnail
    ? getOptimizedThumbnail(currentTrack.thumbnail, ThumbnailQuality.STANDARD)
    : null;

  const commitTokens = useEffectEvent((nextTokens: ArtworkThemeTokens) => {
    applyArtworkTheme(nextTokens);

    setThemeState((previousState) => {
      const isSameTheme = ARTWORK_THEME_TOKEN_NAMES.every(
        (tokenName) =>
          previousState.currentTokens[tokenName] === nextTokens[tokenName],
      );

      if (isSameTheme) {
        return previousState;
      }

      return {
        currentTokens: nextTokens,
        previousTokens: previousState.currentTokens,
        transitionKey: previousState.transitionKey + 1,
      };
    });

    if (clearPreviousTimeoutRef.current !== null) {
      window.clearTimeout(clearPreviousTimeoutRef.current);
    }

    clearPreviousTimeoutRef.current = window.setTimeout(() => {
      setThemeState((previousState) => ({
        ...previousState,
        previousTokens: null,
      }));
      clearPreviousTimeoutRef.current = null;
    }, THEME_CROSSFADE_DURATION_MS);
  });

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setThemeMode(detectThemeMode());
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (clearPreviousTimeoutRef.current !== null) {
        window.clearTimeout(clearPreviousTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const fallbackTokens = getDefaultArtworkThemeTokens(themeMode);

    if (!artworkUrl) {
      commitTokens(fallbackTokens);
      return () => {
        isActive = false;
      };
    }

    void getArtworkThemeTokens(artworkUrl, themeMode).then((tokens) => {
      if (!isActive) {
        return;
      }

      commitTokens(tokens ?? fallbackTokens);
    });

    return () => {
      isActive = false;
    };
  }, [artworkUrl, commitTokens, themeMode]);

  return themeState;
}

function detectThemeMode(): ArtworkThemeMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

async function getArtworkThemeTokens(
  artworkUrl: string,
  mode: ArtworkThemeMode,
): Promise<ArtworkThemeTokens | null> {
  const cacheKey = `${mode}::${artworkUrl}`;
  const cachedTokens = resolvedThemeCache.get(cacheKey);

  if (cachedTokens !== undefined) {
    return cachedTokens;
  }

  const pendingTokens = pendingThemeCache.get(cacheKey);
  if (pendingTokens) {
    return pendingTokens;
  }

  const extractionPromise = extractArtworkThemeTokens(artworkUrl, mode)
    .then((tokens) => {
      setCappedCacheValue(resolvedThemeCache, cacheKey, tokens, THEME_CACHE_LIMIT);
      pendingThemeCache.delete(cacheKey);
      return tokens;
    })
    .catch(() => {
      setCappedCacheValue(resolvedThemeCache, cacheKey, null, THEME_CACHE_LIMIT);
      pendingThemeCache.delete(cacheKey);
      return null;
    });

  setCappedCacheValue(pendingThemeCache, cacheKey, extractionPromise, THEME_CACHE_LIMIT);

  return extractionPromise;
}

async function extractArtworkThemeTokens(
  artworkUrl: string,
  mode: ArtworkThemeMode,
): Promise<ArtworkThemeTokens | null> {
  try {
    const directPalette = await extractPaletteFromSource(artworkUrl, true);
    return normalizeArtworkThemeTokens(directPalette, mode);
  } catch {
    try {
      const proxyPalette = await extractPaletteFromSource(
        buildArtworkProxyUrl(artworkUrl),
        false,
      );
      return normalizeArtworkThemeTokens(proxyPalette, mode);
    } catch {
      return null;
    }
  }
}

async function extractPaletteFromSource(
  source: string,
  useCrossOrigin: boolean,
): Promise<ArtworkPalette> {
  const image = await loadImage(source, useCrossOrigin);

  return (await Vibrant.from(image)
    .quality(4)
    .maxDimension(240)
    .getPalette()) as ArtworkPalette;
}

function loadImage(
  source: string,
  useCrossOrigin: boolean,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    // 網路停滯時 onload/onerror 可能永不觸發,逾時後卸掉 handler 與 src,
    // 讓 Image 物件可被回收,避免長時間 session 累積孤兒物件。
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out loading artwork: ${source}`));
    }, IMAGE_LOAD_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      image.src = "";
    };

    if (useCrossOrigin) {
      image.crossOrigin = "anonymous";
    }

    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.onload = () => {
      window.clearTimeout(timeoutId);
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Failed to load artwork: ${source}`));
    };
    image.src = source;
  });
}

function applyArtworkTheme(tokens: ArtworkThemeTokens): void {
  const root = document.documentElement;

  for (const [tokenName, tokenValue] of Object.entries(tokens)) {
    root.style.setProperty(tokenName, tokenValue);
  }
}
