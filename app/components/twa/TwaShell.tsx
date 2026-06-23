"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TwaBottomNav } from "./TwaBottomNav";

type TwaShellProps = {
  children?: ReactNode;
};

export function TwaShell({ children }: TwaShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f7faf9] text-slate-900">
      <main className="mx-auto w-full max-w-[480px] px-4 pb-[calc(env(safe-area-inset-bottom)+92px)] pt-4">
        {children}
      </main>
      <TwaBottomNav pathname={pathname} />
    </div>
  );
}
