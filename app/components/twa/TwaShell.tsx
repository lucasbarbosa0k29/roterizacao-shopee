"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { TwaBottomNav } from "./TwaBottomNav";

type TwaShellProps = {
  children?: ReactNode;
  notificationAction?: ReactNode;
};

export function TwaShell({ children, notificationAction }: TwaShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isJobRoute = pathname === "/" && searchParams.get("job") !== null;

  return (
    <div className="min-h-screen bg-[#f7faf9] text-slate-900">
      <main className="mx-auto w-full max-w-[480px] px-4 pb-[calc(env(safe-area-inset-bottom)+92px)] pt-4">
        {notificationAction && <div className="mb-2 flex justify-end">{notificationAction}</div>}
        {children}
      </main>
      <TwaBottomNav pathname={pathname} isJobRoute={isJobRoute} />
    </div>
  );
}
