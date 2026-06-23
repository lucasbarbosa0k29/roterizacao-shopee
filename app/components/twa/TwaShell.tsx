"use client";

import type { ReactNode } from "react";

type TwaShellProps = {
  children?: ReactNode;
};

export function TwaShell({ children }: TwaShellProps) {
  return (
    <div className="min-h-screen bg-[#f7faf9] text-slate-900">
      <main className="mx-auto w-full max-w-[480px] px-4 pb-6 pt-4">
        {children}
      </main>
    </div>
  );
}
