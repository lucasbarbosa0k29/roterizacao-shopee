import React from "react";

type BrandProps = {
  subtitle?: string;
  className?: string;
  compact?: boolean;
};

export default function Brand({ subtitle = "Gerencie suas rotas", className = "", compact = false }: BrandProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={[
          "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl shadow-md",
          "bg-white text-[var(--brand-600)] ring-1 ring-white/30",
        ].join(" ")}
      >
        RT
      </div>

      <div className="leading-tight">
        <div className="font-black tracking-tight text-[16px]">
          RT <span className="opacity-95">Shopee</span>
        </div>

        {!compact && (
          <div className="text-[12px] opacity-85 -mt-0.5">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}