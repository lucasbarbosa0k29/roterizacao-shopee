"use client";

import { useEffect, useState } from "react";

const TWA_FLAG_KEY = "rotta_twa";

export function useStandaloneDisplayMode() {
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === "undefined") return false;

    return (
      window.sessionStorage.getItem(TWA_FLAG_KEY) === "1" ||
      window.matchMedia("(display-mode: standalone)").matches
    );
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(display-mode: standalone)");
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("source") === "twa";
    const fromStorage = window.sessionStorage.getItem(TWA_FLAG_KEY) === "1";
    const fromStandalone = mq.matches;
    const twa = fromQuery || fromStorage || fromStandalone;

    if (fromQuery) {
      window.sessionStorage.setItem(TWA_FLAG_KEY, "1");
      url.searchParams.delete("source");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    setIsStandalone(twa);
  }, []);

  return isStandalone;
}
