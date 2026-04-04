/* global jsyaml */

if (typeof importScripts === "function" && typeof jsyaml === "undefined") {
  importScripts("vendor/js-yaml.min.js");
}

const api = browser;

const YAML_SOURCE_URL =
  "https://gitlab.com/stillhq/stillOS/saDB-repo/-/raw/main/repo.yaml";
const CACHE_KEY = "stillrating-cache-v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let inMemoryCache = null;
let indexedDatabaseRef = null;
let indexedDatabase = null;
let inFlightRefreshPromise = null;

function normalizeComparableId(rawValue) {
  if (typeof rawValue !== "string") {
    return "";
  }

  return rawValue
    .trim()
    .toLowerCase()
    .replace(/^app\//, "")
    .replace(/\/x86_64\/stable$/, "")
    .replace(/\/[^/]+\/[^/]+$/, "")
    .replace(/[._]+/g, "");
}

function isValidCachedPayload(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      typeof payload.timestamp === "number" &&
      payload.database &&
      typeof payload.database === "object"
  );
}

function isCacheFresh(payload) {
  return (
    isValidCachedPayload(payload) &&
    Date.now() - payload.timestamp < CACHE_MAX_AGE_MS
  );
}

async function readStoredCache() {
  const stored = await api.storage.local.get(CACHE_KEY);
  const payload = stored?.[CACHE_KEY] ?? null;

  return isValidCachedPayload(payload) ? payload : null;
}

async function persistCache(payload) {
  try {
    await api.storage.local.set({ [CACHE_KEY]: payload });
  } catch (error) {
    // Keep serving from memory even if storage persistence fails.
    console.warn("StillRating: failed to persist cache to storage.local", error);
  }
}

function getYamlParser() {
  if (!jsyaml || typeof jsyaml.load !== "function") {
    throw new Error("js-yaml failed to load in the background worker.");
  }

  return jsyaml;
}

async function fetchAndParseDatabase() {
  const response = await fetch(YAML_SOURCE_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`YAML fetch failed with HTTP ${response.status}`);
  }

  const rawYaml = await response.text();
  const parsed = getYamlParser().load(rawYaml);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Parsed YAML did not produce an object.");
  }

  return {
    timestamp: Date.now(),
    database: parsed
  };
}

async function loadDatabase() {
  if (isCacheFresh(inMemoryCache)) {
    return inMemoryCache.database;
  }

  const storedCache = await readStoredCache();

  if (isCacheFresh(storedCache)) {
    inMemoryCache = storedCache;
    return storedCache.database;
  }

  if (!inFlightRefreshPromise) {
    inFlightRefreshPromise = (async () => {
      try {
        const freshCache = await fetchAndParseDatabase();

        inMemoryCache = freshCache;
        await persistCache(freshCache);

        return freshCache;
      } catch (error) {
        const fallbackCache = storedCache || inMemoryCache;

        if (isValidCachedPayload(fallbackCache)) {
          console.warn(
            "StillRating: refresh failed, falling back to the last cached database",
            error
          );
          inMemoryCache = fallbackCache;
          return fallbackCache;
        }

        throw error;
      } finally {
        inFlightRefreshPromise = null;
      }
    })();
  }

  const resolvedCache = await inFlightRefreshPromise;
  return resolvedCache.database;
}

function getDatabaseEntries(database) {
  if (Array.isArray(database)) {
    return database.filter((item) => item && typeof item === "object");
  }

  if (database && typeof database === "object") {
    return Object.values(database).filter(
      (item) => item && typeof item === "object"
    );
  }

  return [];
}

function getIndexedDatabase(database) {
  if (database === indexedDatabaseRef && indexedDatabase instanceof Map) {
    return indexedDatabase;
  }

  const nextIndex = new Map();

  for (const app of getDatabaseEntries(database)) {
    const normalizedSrcPkgName = normalizeComparableId(app.src_pkg_name);

    if (normalizedSrcPkgName && !nextIndex.has(normalizedSrcPkgName)) {
      nextIndex.set(normalizedSrcPkgName, app);
    }
  }

  indexedDatabaseRef = database;
  indexedDatabase = nextIndex;

  return nextIndex;
}

async function findAppById(appId) {
  const normalizedAppId = normalizeComparableId(appId);

  if (!normalizedAppId) {
    return null;
  }

  const database = await loadDatabase();
  const app = getIndexedDatabase(database).get(normalizedAppId) ?? null;

  return app;
}

async function warmCache() {
  try {
    await loadDatabase();
  } catch (error) {
    console.warn("StillRating: unable to warm cache", error);
  }
}

api.runtime.onInstalled.addListener(() => {
  void warmCache();
});

api.runtime.onStartup.addListener(() => {
  void warmCache();
});

api.runtime.onMessage.addListener(async (message) => {
  if (message?.type !== "stillrating:get-app-data") {
    return undefined;
  }

  try {
    return await findAppById(message.appId);
  } catch (error) {
    console.error("StillRating: failed to resolve app data", error);
    return null;
  }
});
