import type {
  GoogleManualSearchRequest,
  GoogleManualSearchResult,
} from "./google-manual-search";

type PendingEntry<T> = {
  promise: Promise<T>;
};

export const GOOGLE_MANUAL_SEARCH_SINGLE_FLIGHT_MAX_ENTRIES = 100;

export class SingleFlightCache<T> {
  private readonly entries = new Map<string, PendingEntry<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = GOOGLE_MANUAL_SEARCH_SINGLE_FLIGHT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  getOrCreate(
    key: string,
    factory: () => Promise<T>,
  ) {
    const existing = this.entries.get(key);
    if (existing) {
      return existing.promise;
    }

    if (this.entries.size >= this.maxEntries) {
      // Preserve single-flight for retained keys; an excess distinct request
      // runs without being retained instead of evicting an active request.
      return Promise.resolve().then(factory);
    }

    const promise = Promise.resolve()
      .then(factory)
      .finally(() => {
        if (this.entries.get(key)?.promise === promise) {
          this.entries.delete(key);
        }
      });

    this.entries.set(key, { promise });

    return promise;
  }

  clear() {
    this.entries.clear();
  }

  size() {
    return this.entries.size;
  }
}

function normalizeKeyText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGoogleManualSearchCacheKey(input: GoogleManualSearchRequest) {
  return JSON.stringify([
    input.provider,
    normalizeKeyText(input.query),
    normalizeKeyText(input.city),
    normalizeKeyText(input.district),
    input.center.lat.toFixed(6),
    input.center.lng.toFixed(6),
    Math.round(input.radius),
    normalizeKeyText(input.language),
    normalizeKeyText(input.region),
  ]);
}

export const googleManualSearchCache = new SingleFlightCache<GoogleManualSearchResult[]>();

