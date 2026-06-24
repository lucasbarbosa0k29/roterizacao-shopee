"use client";

import { useEffect, useState } from "react";

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
    typeof window !== "undefined" ? window.sessionStorage.getItem(TWA_DEV_FLAG_KEY) === "1" : false;
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
  } catch (error) {}
}

export function useStandaloneDisplayMode() {
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === "undefined") return false;

    const url = new URL(window.location.href);
    return shouldUseTwa(url);
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(display-mode: standalone)");
    const url = new URL(window.location.href);
    const isLocalhost = isLocalTwaHost(url.hostname);
    const hasTwaSource = url.searchParams.get("source") === "twa";
    const hasDevFlag = window.sessionStorage.getItem(TWA_DEV_FLAG_KEY) === "1";
    const twa = mq.matches || (isLocalhost && (hasTwaSource || hasDevFlag));

    clearLegacyTwaFlags();

    if (isLocalhost && hasTwaSource) {
      window.sessionStorage.setItem(TWA_DEV_FLAG_KEY, "1");
    }

    if (!isLocalhost && hasTwaSource) {
      url.searchParams.delete("source");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    setIsStandalone(twa);
  }, []);

  return isStandalone;
}
