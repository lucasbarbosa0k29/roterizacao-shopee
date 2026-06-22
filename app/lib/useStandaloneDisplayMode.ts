"use client";

import { useEffect, useState } from "react";

export function useStandaloneDisplayMode() {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () => setIsStandalone(mq.matches);

    update();

    mq.addEventListener?.("change", update);
    return () => {
      mq.removeEventListener?.("change", update);
    };
  }, []);

  return isStandalone;
}
