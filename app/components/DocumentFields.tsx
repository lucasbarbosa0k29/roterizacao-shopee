"use client";

export function DocumentFields({ type, setType, value, setValue, dark = false }: {
  type: "CPF" | "CNPJ"; setType: (value: "CPF" | "CNPJ") => void;
  value: string; setValue: (value: string) => void; dark?: boolean;
}) {
  const field = `w-full rounded-2xl border px-4 py-3.5 outline-none focus:ring-2 focus:ring-teal-500 ${dark ? "border-white/20 bg-[#17313b] text-white" : "border-slate-200 bg-slate-50 text-slate-900"}`;
  function mask(input: string) {
    const digits = (type === "CPF" ? input.replace(/\D/g, "") : input.toUpperCase().replace(/[^A-Z0-9]/g, "")).slice(0, type === "CPF" ? 11 : 14);
    if (type === "CPF") return digits.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 8)].filter(Boolean).join(".")
      + (digits.length > 8 ? `/${digits.slice(8, 12)}` : "")
      + (digits.length > 12 ? `-${digits.slice(12)}` : "");
  }
  return <div className="space-y-3">
    <label className="block text-sm">Tipo de cadastro
      <select value={type} onChange={e => setType(e.target.value as "CPF" | "CNPJ")} className={`${field} mt-2`}>
        <option value="CPF">Pessoa física — CPF</option><option value="CNPJ">Pessoa jurídica — CNPJ</option>
      </select>
    </label>
    <label className="block text-sm">{type}
      <input required inputMode={type === "CPF" ? "numeric" : "text"} autoCapitalize="characters" autoComplete="off" value={value} onChange={e => setValue(mask(e.target.value))} className={`${field} mt-2`} placeholder={type === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"} />
    </label>
    <p className="text-xs opacity-80">{type === "CPF" ? "1 crédito experimental após confirmar seu e-mail, uma única vez por CPF. A validação dos dígitos não comprova a titularidade do documento." : "2 créditos gratuitos após confirmar seu e-mail, uma única vez por CNPJ."}</p>
  </div>;
}
