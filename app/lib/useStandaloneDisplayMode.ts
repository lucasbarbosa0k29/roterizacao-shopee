"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readSessionHint, writeSessionHint } from "./browser-session";

const TWA_FLAG_KEY = "rotta_twa";
const TWA_DEV_FLAG_KEY = "rotta_twa_dev";

function isLocalTwaHost(hostname: string) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("192.168.")) return true;
  if (hostname.startsWith("10.")) return true;

  const match = hostname.match(/^172\.(\d{1,2})\./);
  if (!match) return false;

  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function isProductionLikeHost(hostname: string) {
  return !isLocalTwaHost(hostname);
}

function shouldUseTwa(url: URL) {
  const isLocalhost = isLocalTwaHost(url.hostname);
  const hasTwaSource = url.searchParams.get("source") === "twa";
  const devFlag =
    typeof window !== "undefined" ? readSessionHint(TWA_DEV_FLAG_KEY) === "1" : false;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

  return isStandalone || (isLocalhost && (hasTwaSource || devFlag));
}

function clearLegacyTwaFlags() {
  try {
    window.sessionStorage.removeItem(TWA_FLAG_KEY);
    window.localStorage.removeItem(TWA_FLAG_KEY);
    if (isProductionLikeHost(window.location.hostname)) {
      window.sessionStorage.removeItem(TWA_DEV_FLAG_KEY);
      window.localStorage.removeItem(TWA_DEV_FLAG_KEY);
    }
  } catch { /* Storage is optional for display-mode detection. */ }
}

function standaloneSnapshot() {
  return typeof window !== "undefined" && shouldUseTwa(new URL(window.location.href));
}

function subscribeStandalone(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const serverStandaloneSnapshot = () => false;

export function useStandaloneDisplayMode() {
  const isStandalone = useSyncExternalStore(subscribeStandalone, standaloneSnapshot, serverStandaloneSnapshot);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const isLocalhost = isLocalTwaHost(url.hostname);
    const hasTwaSource = url.searchParams.get("source") === "twa";

    clearLegacyTwaFlags();

    if (isLocalhost && hasTwaSource) {
      writeSessionHint(TWA_DEV_FLAG_KEY, "1");
    }

    if (!isLocalhost && hasTwaSource) {
      url.searchParams.delete("source");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

  }, []);

  return isStandalone;
}
