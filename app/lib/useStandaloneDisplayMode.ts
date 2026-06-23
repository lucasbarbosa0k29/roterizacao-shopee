"use client";

import { useEffect, useState } from "react";

const TWA_FLAG_KEY = "rotta_twa";

function isLocalTwaTest(url: URL) {
  return (
    url.searchParams.get("source") === "twa" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

function clearLegacyTwaFlags() {
  try {
    window.sessionStorage.removeItem(TWA_FLAG_KEY);
    window.localStorage.removeItem(TWA_FLAG_KEY);
  } catch (error) {}
}

export function useStandaloneDisplayMode() {
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === "undefined") return false;

    const url = new URL(window.location.href);
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      isLocalTwaTest(url)
    );
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(display-mode: standalone)");
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("source") === "twa";
    const fromStandalone = mq.matches;
    const twa = fromStandalone || isLocalTwaTest(url);

    clearLegacyTwaFlags();

    if (fromQuery) {
      url.searchParams.delete("source");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    setIsStandalone(twa);
  }, []);

  return isStandalone;
}
