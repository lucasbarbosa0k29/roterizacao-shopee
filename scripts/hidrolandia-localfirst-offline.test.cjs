/* eslint-disable @typescript-eslint/no-require-imports */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const XLSX = require("xlsx");

const root = process.cwd();
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

function sourceBlock(source, startNeedle, nextNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(nextNeedle, start);
  assert.notEqual(start, -1, `missing source block start: ${startNeedle}`);
  assert.notEqual(end, -1, `missing source block end: ${nextNeedle}`);
  return source.slice(start, end);
}

function loadRouteParser() {
  const routeSource = fs.readFileSync(path.join(root, "app/api/process/route.ts"), "utf8");
  const parserSource = [
    sourceBlock(routeSource, "function separateCompactQuadraLoteTokens", "function stripQuadraLoteFromStreet"),
    sourceBlock(routeSource, "function normalizeQLValue", "function isAparecidaBairroNoise"),
    "exports.__test = { extractQuadraLoteSmart };",
  ].join("\n");
  const output = ts.transpileModule(parserSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleShim = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    moduleShim.exports,
    require,
    moduleShim,
    "hidrolandia-route-parser-slice.ts",
    root,
  );
  return moduleShim.exports.__test.extractQuadraLoteSmart;
}

function loadHereQueryBuilder() {
  const routeSource = fs.readFileSync(path.join(root, "app/api/process/route.ts"), "utf8");
  const builderSource = [
    sourceBlock(routeSource, "function onlyDigits", "function normalizeCep"),
    sourceBlock(routeSource, "function normalizeCep", "function cleanAddressForHere"),
    sourceBlock(routeSource, "function cleanAddressForHere", "function separateCompactQuadraLoteTokens"),
    sourceBlock(routeSource, "function separateCompactQuadraLoteTokens", "function stripQuadraLoteFromStreet"),
    sourceBlock(routeSource, "function stripQuadraLoteFromStreet", "async function getAtByCep"),
    sourceBlock(routeSource, "function streetVariants", "function isHidrolandiaCity"),
    sourceBlock(routeSource, "function isHidrolandiaCity", "function buildAparecidaStreetQuadraQueries"),
    "type HereQueryPlan = { queries: string[]; reasonsByQuery: Record<string, string>; strategy: string; effectiveStreet: string; effectiveNumber: string; };",
    sourceBlock(routeSource, "function buildHereQueryVariants", "function buildAparecidaRecoveryQueries"),
    "exports.__test = { buildHereQueryVariants };",
  ].join("\n");
  const output = ts.transpileModule(builderSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleShim = { exports: {} };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(
    moduleShim.exports,
    require,
    moduleShim,
    "hidrolandia-route-here-query-slice.ts",
    root,
  );
  return moduleShim.exports.__test.buildHereQueryVariants;
}

function loadRows() {
  const workbook = XLSX.readFile(path.join(root, "data/test/Teste/Hidrolandia.xlsx"));
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
}

function loadPreviousRows() {
  return JSON.parse(
    fs.readFileSync(path.join(root, ".tmp/hidrolandia-final-validation/promotion.json"), "utf8"),
  ).rows;
}

async function evaluateRows() {
  const parser = loadRouteParser();
  const localFirst = require(path.join(root, "app/lib/hidrolandia-localfirst-shadow.ts"));
  const rows = loadRows();
  const previousRows = loadPreviousRows();
  const results = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = previousRows[index] || {};
    const previousNormalized = previous.normalized || {};
    const parsed = parser(String(row["Destination Address"] || ""));
    const input = {
      city: String(row.City || ""),
      bairro: String(row.Bairro || previousNormalized.bairro || ""),
      setor: String(row.Bairro || previousNormalized.bairro || ""),
      rua: previousNormalized.rua || "",
      quadra: parsed.quadra || previousNormalized.quadra || "",
      lote: parsed.lote || previousNormalized.lote || "",
      rawAddress: String(row["Destination Address"] || ""),
    };
    const decision = await localFirst.runHidrolandiaLocalFirstForProcess(input);
    results.push({ line: index + 1, input, parsed, decision });
  }

  return results;
}

async function evaluateAfterHereFallbacks() {
  const localFirst = require(path.join(root, "app/lib/hidrolandia-localfirst-shadow.ts"));
  const previousRows = loadPreviousRows();
  const recovered = [];
  const stillWithoutCoords = [];

  for (let index = 0; index < previousRows.length; index += 1) {
    const row = previousRows[index];
    const normalized = row.normalized || {};
    const source = row.source;
    if (source !== "HERE_GEOCODE" && source !== "HERE_DISCOVER") continue;

    const flags = row.geocodeConfidenceDiag?.flags || [];
    const resultCity = String(row.hereBest?.address?.city || row.hereBest?.address?.county || "");
    const cityMismatch =
      flags.includes("CIDADE_MISMATCH") ||
      (resultCity
        ? !resultCity
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
            .includes("HIDROLANDIA")
        : false);
    const streetMismatch = flags.includes("RUA_MISMATCH");
    const hereRejectedReason =
      row.lat == null ||
      row.lng == null ||
      row.decisionReason === "HERE_SPREAD" ||
      row.decisionReason === "LOW_SCORE" ||
      row.decisionReason === "NO_COORD" ||
      cityMismatch ||
      streetMismatch;

    if (!hereRejectedReason) continue;

    const decision = await localFirst.runHidrolandiaStreetFallbackAfterHere({
      city: row.city || "",
      setor: String(row.bairro || normalized.bairro || "").trim(),
      bairro: String(row.bairro || normalized.bairro || "").trim(),
      rua: normalized.rua || "",
      quadra: normalized.quadra || "",
      lote: normalized.lote || "",
      rawAddress: row.original || "",
      currentResult: {
        source,
        lat: row.lat,
        lng: row.lng,
        matchedKey: null,
        matchType: row.matchType,
        confidence: row.geocodeConfidenceDiag?.confidence ?? null,
        status: row.status,
      },
    });

    const item = {
      line: index + 1,
      row,
      decision,
    };
    if (decision.canApplyPartial && decision.partialCandidate) recovered.push(item);
    if (row.lat == null || row.lng == null) {
      if (!(decision.canApplyPartial && decision.partialCandidate)) stillWithoutCoords.push(item);
    }
  }

  return {
    recovered,
    stillWithoutCoords,
  };
}

test("Hidrolandia parser preserves hyphenated lot suffixes and AP quadras", () => {
  const parser = loadRouteParser();

  assert.deepEqual(
    {
      quadra: parser("Alameda Pedro Arroyo, 589, Qd 07 Lt 03-A Casa Amarela").quadra,
      lote: parser("Alameda Pedro Arroyo, 589, Qd 07 Lt 03-A Casa Amarela").lote,
    },
    { quadra: "7", lote: "3A" },
  );
  assert.deepEqual(
    {
      quadra: parser("Rua Manoel Jose Machado, 1, QD Ap 4 LT 1 pamonha da Hosana").quadra,
      lote: parser("Rua Manoel Jose Machado, 1, QD Ap 4 LT 1 pamonha da Hosana").lote,
    },
    { quadra: "AP 4", lote: "1" },
  );
});

test("Hidrolandia LocalFirst offline expected exact and partial levels", async () => {
  const results = await evaluateRows();
  const exact = results.filter((row) => row.decision.canPromote).map((row) => row.line);
  const partialSetorRuaQuadra = results
    .filter((row) => row.decision.canApplyPartial && row.decision.partialLevel === "SETOR_RUA_QUADRA")
    .map((row) => row.line);
  const partialSetorRua = results
    .filter((row) => row.decision.canApplyPartial && row.decision.partialLevel === "SETOR_RUA")
    .map((row) => row.line);

  assert.deepEqual(exact, [1, 5, 50, 51, 52, 53, 64, 65, 68, 76, 77, 78]);
  assert.deepEqual(partialSetorRuaQuadra, [63, 80]);
  assert.deepEqual(partialSetorRua, [2, 43, 44, 81]);

  for (const line of [39, 42]) {
    const result = results[line - 1];
    assert.equal(result.decision.canPromote, false);
    assert.equal(result.decision.canApplyPartial, false);
  }

  const line64 = results[63];
  assert.equal(line64.input.lote, "3A");
  assert.equal(line64.decision.canPromote, true);
  assert.equal(line64.decision.audit.matchedKey, "HIDROLANDIA|JARDIM PRIMAVERA|7|3A");
});

test("Hidrolandia HERE query builder removes placeholders and street noise safely", () => {
  const buildHereQueryVariants = loadHereQueryBuilder();

  const placeholderPlan = buildHereQueryVariants({
    rua: "AV GOIANIA",
    numero: "000",
    bairro: "Jardim Primavera",
    cidade: "Hidrolândia",
    estado: "GO",
    cep: "75340-000",
    original: "AV GOIANIA, 000, Jardim Primavera, Hidrolândia, GO",
    normalizedLine: "AV GOIANIA, 000, Jardim Primavera, Hidrolândia, GO",
  });
  assert.equal(placeholderPlan.effectiveNumber, "");
  assert.equal(placeholderPlan.strategy, "HIDROLANDIA_SN_OR_PLACEHOLDER");
  assert.equal(placeholderPlan.queries[0], "Avenida Goiania, 75340000, Hidrolândia, GO");
  assert.ok(placeholderPlan.queries.every((query) => !/,\s*(0|00|000|S\/N|SN)\s*,/i.test(query)));

  const noisyPlan = buildHereQueryVariants({
    rua: "Rua Doutor Virmondes d Ap2",
    numero: "16",
    bairro: "Bairro Nazaré",
    cidade: "Hidrolândia",
    estado: "GO",
    cep: "75340502",
    original: "Rua Doutor Virmondes d Ap2, 16, Bairro Nazaré, Hidrolândia, GO",
    normalizedLine: "Rua Doutor Virmondes d Ap2, 16, Bairro Nazaré, Hidrolândia, GO",
  });
  assert.equal(noisyPlan.effectiveNumber, "16");
  assert.equal(noisyPlan.strategy, "HIDROLANDIA_REAL_NUMBER");
  assert.ok(noisyPlan.queries.every((query) => !/AP2/i.test(query)));

  const pluralAliasPlan = buildHereQueryVariants({
    rua: "Alamedas dos Eucaliptos",
    numero: "0",
    bairro: "Jardim Primavera",
    cidade: "Hidrolândia",
    estado: "GO",
    cep: "75340540",
    original: "Alamedas dos Eucaliptos, 0, Jardim Primavera, Hidrolândia, GO",
    normalizedLine: "Alamedas dos Eucaliptos, 0, Jardim Primavera, Hidrolândia, GO",
  });
  assert.equal(pluralAliasPlan.queries[0], "Alameda dos Eucaliptos, 75340540, Hidrolândia, GO");
});

test("Hidrolandia after-HERE local street fallback only recovers safe rejected cases", async () => {
  const { recovered, stillWithoutCoords } = await evaluateAfterHereFallbacks();
  const recoveredLines = recovered.map((item) => item.line);

  assert.deepEqual(recoveredLines, [61, 67, 88]);

  for (const item of recovered) {
    assert.equal(item.decision.partialLevel, "SETOR_RUA_AFTER_HERE");
    assert.equal(item.decision.partialSource, "LOCALFIRST_HIDROLANDIA_RUA_FALLBACK");
    assert.equal(item.decision.partialMatchType, "LOCALFIRST_HIDROLANDIA_SETOR_RUA_FALLBACK");
    assert.equal(
      item.decision.partialDecisionReason,
      "PARTIAL_LOCALFIRST_HIDROLANDIA_RUA_AFTER_HERE_FAILURE",
    );
  }

  assert.equal(stillWithoutCoords.length, 24);

  for (const blockedLine of [39, 42]) {
    const blocked = recovered.find((item) => item.line === blockedLine);
    assert.equal(blocked, undefined);
  }
});
