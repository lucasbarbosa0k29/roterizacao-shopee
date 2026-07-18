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
