// src/lib/address.ts
const SMALL_WORDS = new Set([
  "DE","DA","DO","DAS","DOS","E"
]);

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanupSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

// Converte "VINTE E CINCO" -> "25" (até 99 já resolve 99% dos casos de ruas)
function wordsToNumberPT(words: string): number | null {
  const w = words
    .toUpperCase()
    .split(" ")
    .filter(Boolean);

  const units: Record<string, number> = {
    "ZERO":0,"UM":1,"UMA":1,"DOIS":2,"DUAS":2,"TRES":3,"QUATRO":4,"CINCO":5,
    "SEIS":6,"SETE":7,"OITO":8,"NOVE":9
  };
  const teens: Record<string, number> = {
    "DEZ":10,"ONZE":11,"DOZE":12,"TREZE":13,"QUATORZE":14,"CATORZE":14,
    "QUINZE":15,"DEZESSEIS":16,"DEZESSETE":17,"DEZOITO":18,"DEZENOVE":19
  };
  const tens: Record<string, number> = {
    "VINTE":20,"TRINTA":30,"QUARENTA":40,"CINQUENTA":50,
    "SESSENTA":60,"SETENTA":70,"OITENTA":80,"NOVENTA":90
  };

  // tenta padrões:
  // "VINTE E CINCO" = 20 + 5
  // "VINTE CINCO" (sem o E) também
  // "DEZESSETE" etc
  if (w.length === 1) {
    if (w[0] in units) return units[w[0]];
    if (w[0] in teens) return teens[w[0]];
    if (w[0] in tens) return tens[w[0]];
    return null;
  }

  if (w.length === 2) {
    // "VINTE CINCO"
    if (w[0] in tens && w[1] in units) return tens[w[0]] + units[w[1]];
    return null;
  }

  if (w.length === 3) {
    // "VINTE E CINCO"
    if (w[0] in tens && w[1] === "E" && w[2] in units) return tens[w[0]] + units[w[2]];
    return null;
  }

  return null;
}

function normalizeRuaNumeroLetra(s: string) {
  // objetivo: fazer "RUA VINTE E CINCO - E" virar "RUA 25 E"
  // sem mexer no original, só pra busca.
  let t = stripAccents(s.toUpperCase());

  // troca hífen/underscore por espaço pra facilitar
  t = t.replace(/[-_]/g, " ");

  // remove pontuação pesada, mas mantém letras/números
  t = t.replace(/[^\w\s]/g, " ");

  t = cleanupSpaces(t);

  // se tiver algo tipo "RUA VINTE E CINCO E"
  // vamos tentar achar um bloco de número por extenso e converter
  // (bem simples, mas já resolve muito)
  const tokens = t.split(" ");

  // varre e tenta converter janelas de 3, 2, 1 palavras
  for (let i = 0; i < tokens.length; i++) {
    // janela 3
    const w3 = tokens.slice(i, i+3).join(" ");
    const n3 = wordsToNumberPT(w3);
    if (n3 !== null) {
      tokens.splice(i, 3, String(n3));
      break;
    }
    // janela 2
    const w2 = tokens.slice(i, i+2).join(" ");
    const n2 = wordsToNumberPT(w2);
    if (n2 !== null) {
      tokens.splice(i, 2, String(n2));
      break;
    }
    // janela 1
    const w1 = tokens[i];
    const n1 = wordsToNumberPT(w1);
    if (n1 !== null) {
      tokens.splice(i, 1, String(n1));
      break;
    }
  }

  // remove palavras muito pequenas “soltas” tipo DE/DA/DO
  const cleaned = tokens.filter(tok => !(SMALL_WORDS.has(tok) && tok.length <= 3));

  return cleanupSpaces(cleaned.join(" "));
}

export function buildSearchAddress(original: string) {
  return normalizeRuaNumeroLetra(original);
}