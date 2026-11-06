import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { loadConfigFromFile } from "@prisma/config";
import * as XLSX from "xlsx";
import { MAX_IMPORT_FILE_BYTES, readImportRows, SpreadsheetImportError } from "../app/lib/spreadsheet-import";
import { parseImileTxtImport } from "../app/lib/imile-txt-import";

test("NextAuth rejects malformed Bearer headers without throwing (Headers and legacy request)", async () => {
  for (const value of ["%", "%GG", "%E0%A4%A", "", "not-a-jwt"]) {
    const headers = { authorization: `Bearer ${value}` };
    const requests = [new NextRequest("http://localhost/test", { headers }), Object.assign(new IncomingMessage(new Socket()), { headers, cookies: {} })];
    for (const req of requests) {
      assert.equal(await getToken({ req, secret: "isolated-test-secret-not-a-real-credential" }), null);
    }
  }
});

test("SheetJS is pinned to the official distribution with SHA-512 lock integrity", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.equal(manifest.dependencies.xlsx, "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz");
  assert.equal(lock.packages["node_modules/xlsx"].version, "0.20.3");
  assert.match(lock.packages["node_modules/xlsx"].integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  assert.equal(XLSX.version, "0.20.3");
});

function spreadsheet(count = 1, bookType: XLSX.BookType = "xlsx") {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(Array.from({ length: count }, (_, i) => ({
    Sequence: i + 1, "Endereço": `Rua São João, nº ${i + 1}`, Cidade: "Goiânia", CEP: "74000-001", Latitude: -16.68,
  }))), "Entregas");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Não importar"], ["Segunda aba"]]), "Outra aba");
  return XLSX.write(book, { bookType, type: "buffer" }) as Buffer;
}

for (const bookType of ["xlsx", "xls", "csv"] as const) {
  test(`import ${bookType}: preserves accents, numbers, first sheet and 200 stops`, () => {
    const rows = readImportRows(spreadsheet(200, bookType), `.${bookType}`);
    assert.equal(rows.length, 200);
    assert.equal(rows[0]["Endereço"], "Rua São João, nº 1");
    assert.equal(rows[199].Cidade, "Goiânia");
    assert.equal(rows[0].CEP, "74000-001");
    assert.equal(rows[0].Latitude, -16.68);
  });
}

test("CSV supports UTF-8 without BOM, legacy encoding and delivery-list columns", () => {
  const utf8 = "Address,City,Contact,State\n\"Rua São João, 1\",Goiânia,José,GO";
  for (const encoding of ["utf8", "latin1"] as const) {
    const rows = readImportRows(Buffer.from(utf8, encoding), ".csv");
    assert.equal(rows[0].Address, "Rua São João, 1");
    assert.equal(rows[0].City, "Goiânia");
  }
});

test("invalid/empty spreadsheets and file/route limits fail with controlled errors", () => {
  for (const input of [Buffer.alloc(0), Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), Buffer.from("header-only\n")]) {
    assert.throws(() => readImportRows(input, ".xlsx"), SpreadsheetImportError);
  }
  assert.throws(() => readImportRows(Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1), ".xlsx"), /5 MB/);
  assert.throws(() => readImportRows(spreadsheet(201), ".xlsx"), /200 paradas/);
});

test("large spreadsheets are rejected; parser reports local resource usage", () => {
  const buffer = spreadsheet(10_000);
  assert.ok(buffer.length < MAX_IMPORT_FILE_BYTES);
  const start = performance.now();
  assert.throws(() => readImportRows(buffer, ".xlsx"), /200 paradas/);
  console.log(JSON.stringify({ scenario: "reject-10000-rows", fileBytes: buffer.length, elapsedMs: Math.round(performance.now() - start), maxRSSKiB: process.resourceUsage().maxRSS }));
});

test("prototype-like spreadsheet headers do not pollute Object.prototype", () => {
  const csv = "__proto__,constructor,prototype,Endereço\nrotta-probe,x,y,Rua A";
  readImportRows(Buffer.from(csv), ".csv");
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "rotta-probe"), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("TXT import still preserves Brazilian names and addresses", () => {
  const result = parseImileTxtImport("PACOTE 1\nNome: João da Conceição\nEndereço: Rua São João, Goiânia, Goiás");
  assert.equal(result.detected, true);
  assert.equal(result.rows[0].cliente, "João da Conceição");
  assert.match(result.rows[0].original, /São João/);
});

test("Prisma 6 config loader works with the scoped deepmerge-ts 8 override", async () => {
  const folder = await mkdtemp(join(tmpdir(), "rotta-prisma-config-test-"));
  const configFile = join(folder, "prisma.config.cjs");
  await writeFile(configFile, "module.exports = { schema: 'schema.prisma', migrations: { path: 'migrations' } };\n");
  const result = await loadConfigFromFile({ configFile, configRoot: folder });
  assert.equal(result.error, undefined);
  assert.equal(result.config.schema, join(folder, "schema.prisma"));
  assert.equal(result.config.migrations?.path, join(folder, "migrations"));
});
