import { detectDeviceInfoSync } from "@/utils/device-info";
import { createId } from "@/utils/createId";
import type {
  LibrarySnapshot,
  PairedDevice,
  SyncDeviceMetadata,
} from "@/types/library";

const DATABASE_NAME = "youtube-music-bot-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";
const SNAPSHOT_KEY = "primary";
const DEFAULT_PROFILE_NAME = "未命名使用者";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function loadLibrarySnapshot(): Promise<LibrarySnapshot> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const rawSnapshot = await requestToPromise(store.get(SNAPSHOT_KEY));

  database.close();

  if (rawSnapshot) {
    return normalizeSnapshot(rawSnapshot as Partial<LibrarySnapshot>);
  }

  const initialSnapshot = createInitialLibrarySnapshot();
  await saveLibrarySnapshot(initialSnapshot);
  return initialSnapshot;
}

export async function saveLibrarySnapshot(
  snapshot: LibrarySnapshot,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  store.put(snapshot, SNAPSHOT_KEY);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Failed to save library snapshot"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Library snapshot transaction aborted"));
  });

  database.close();
}

export function createInitialLibrarySnapshot(): LibrarySnapshot {
  const detected = detectDeviceInfoSync();
  const deviceId = createId();
  const profileId = createId();
  const now = new Date().toISOString();
  const currentDevice: PairedDevice = {
    id: deviceId,
    name: detected.reportedName,
    reportedName: detected.reportedName,
    customName: null,
    displayName: detected.reportedName,
    kind: detected.kind,
    metadata: detected.metadata,
    pairedAt: now,
    isCurrentDevice: true,
    status: "available",
  };

  return {
    profileId,
    profileName: DEFAULT_PROFILE_NAME,
    deviceId,
    updatedAt: now,
    syncSessionId: null,
    syncDeviceToken: null,
    favorites: [],
    history: [],
    savedMixes: [],
    playlists: [],
    pairedDevices: [currentDevice],
  };
}

function normalizeMetadata(raw: unknown): SyncDeviceMetadata | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Partial<SyncDeviceMetadata>;
  const asNullableString = (field: unknown): string | null =>
    typeof field === "string" && field.trim().length > 0 ? field : null;

  return {
    platformFamily: asNullableString(value.platformFamily),
    platformVersion: asNullableString(value.platformVersion),
    architecture: asNullableString(value.architecture),
    browserName: asNullableString(value.browserName),
    browserVersion: asNullableString(value.browserVersion),
    model: asNullableString(value.model),
  };
}

function normalizePairedDevice(
  raw: unknown,
  currentDeviceId: string,
  fallback: PairedDevice,
): PairedDevice {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const source = raw as Partial<PairedDevice>;
  const id = typeof source.id === "string" && source.id.trim() ? source.id : fallback.id;
  const kind = source.kind === "mobile" ? "mobile" : "desktop";
  const metadata = normalizeMetadata(source.metadata);
  const legacyName =
    typeof source.name === "string" && source.name.trim().length > 0
      ? source.name
      : null;
  const reportedName =
    typeof source.reportedName === "string" && source.reportedName.trim().length > 0
      ? source.reportedName
      : legacyName ?? fallback.reportedName;
  const customName =
    typeof source.customName === "string" && source.customName.trim().length > 0
      ? source.customName
      : null;
  const displayName =
    typeof source.displayName === "string" && source.displayName.trim().length > 0
      ? source.displayName
      : customName ?? reportedName;

  return {
    id,
    name: displayName,
    reportedName,
    customName,
    displayName,
    kind,
    metadata: metadata ?? fallback.metadata,
    pairedAt:
      typeof source.pairedAt === "string" && source.pairedAt.trim().length > 0
        ? source.pairedAt
        : fallback.pairedAt,
    isCurrentDevice:
      typeof source.isCurrentDevice === "boolean"
        ? source.isCurrentDevice
        : id === currentDeviceId,
    status: source.status === "coming_soon" ? "coming_soon" : "available",
    connected: source.connected,
    lastSeenAt:
      typeof source.lastSeenAt === "string" && source.lastSeenAt.trim().length > 0
        ? source.lastSeenAt
        : undefined,
  };
}

function normalizeSnapshot(raw: Partial<LibrarySnapshot>): LibrarySnapshot {
  const fallbackSnapshot = createInitialLibrarySnapshot();
  const deviceId =
    typeof raw.deviceId === "string" && raw.deviceId.trim().length > 0
      ? raw.deviceId
      : fallbackSnapshot.deviceId;
  const now = new Date().toISOString();
  const detected = detectDeviceInfoSync();
  const fallbackCurrentDevice: PairedDevice = {
    id: deviceId,
    name: detected.reportedName,
    reportedName: detected.reportedName,
    customName: null,
    displayName: detected.reportedName,
    kind: detected.kind,
    metadata: detected.metadata,
    pairedAt: now,
    isCurrentDevice: true,
    status: "available",
  };

  const rawDevices = Array.isArray(raw.pairedDevices) ? raw.pairedDevices : [];
  const normalizedDevices =
    rawDevices.length > 0
      ? rawDevices.map((device) =>
          normalizePairedDevice(device, deviceId, fallbackCurrentDevice),
        )
      : [fallbackCurrentDevice];

  if (!normalizedDevices.some((device) => device.isCurrentDevice)) {
    const deviceIndex = normalizedDevices.findIndex((device) => device.id === deviceId);
    if (deviceIndex >= 0) {
      normalizedDevices[deviceIndex] = {
        ...normalizedDevices[deviceIndex],
        isCurrentDevice: true,
      };
    } else {
      normalizedDevices.unshift(fallbackCurrentDevice);
    }
  }

  return {
    profileId:
      typeof raw.profileId === "string" && raw.profileId.trim().length > 0
        ? raw.profileId
        : fallbackSnapshot.profileId,
    profileName:
      typeof raw.profileName === "string" && raw.profileName.trim().length > 0
        ? raw.profileName
        : DEFAULT_PROFILE_NAME,
    deviceId,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim().length > 0
        ? raw.updatedAt
        : now,
    syncSessionId: raw.syncSessionId ?? null,
    syncDeviceToken: raw.syncDeviceToken ?? null,
    favorites: raw.favorites ?? [],
    history: raw.history ?? [],
    savedMixes: raw.savedMixes ?? [],
    playlists: raw.playlists ?? [],
    removedFavorites: raw.removedFavorites ?? [],
    deletedPlaylists: raw.deletedPlaylists ?? [],
    deletedSavedMixes: raw.deletedSavedMixes ?? [],
    pairedDevices: normalizedDevices,
  };
}
