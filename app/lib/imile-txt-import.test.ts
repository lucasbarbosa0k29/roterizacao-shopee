import test from "node:test";
import assert from "node:assert/strict";

const { parseImileTxtImport } = await import(new URL("./imile-txt-import.ts", import.meta.url).href);

test("parseImileTxtImport parses common packages and preserves order", () => {
  const result = parseImileTxtImport(`
PACOTE 1
Nome: italox7\u200e (1)\u200e
Endereço: Rua Ema8 s/n qd 23 LT 15, Residencial Recanto das Emas, Goiânia, Goiás

PACOTE 2
Nome: geannetorres1\u200e (1)\u200e
Endereço: Rua Ema2 48, Residencial Recanto das Emas, Goiânia, Goiás
`);

  assert.equal(result.detected, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row: any) => row.sequence),
    ["1", "2"],
  );
  assert.equal(result.rows[0].cliente, "italox7 (1)");
  assert.equal(result.rows[1].cliente, "geannetorres1 (1)");
  assert.equal(result.rows[0].original, "Rua Ema8 s/n qd 23 LT 15, Residencial Recanto das Emas, Goiânia, Goiás");
  assert.equal(result.rows[0].bairro, "Residencial Recanto das Emas");
  assert.equal(result.rows[0].city, "Goiânia");
  assert.equal(result.rows[0].cep, "");
  assert.equal(result.rows[0].sourceType, "IMILE");
});

test("parseImileTxtImport preserves quantity suffix and does not duplicate rows for quantity 2", () => {
  const result = parseImileTxtImport(`
PACOTE 11
Nome: Bruna Oliveira costa (2)
Endereço: SN, Rua Ema11 Rua ema 11 quadra 25, lote 20- casa 1 PORTÃO PRETO, Residencial Recanto das Emas, Goiânia, Goiás
`);

  assert.equal(result.detected, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sequence, "11");
  assert.equal(result.rows[0].cliente, "Bruna Oliveira costa (2)");
  assert.equal(result.rows[0].quantidadePacotes, 2);
});

test("parseImileTxtImport preserves legitimate digits and accents in names", () => {
  const result = parseImileTxtImport(`
PACOTE 1
Nome: Keli Borges755 (1)
Endereço: Rua Ema 10 s/n muro verde, Residencial Recanto das Emas, Goiânia, Goiás

PACOTE 2
Nome: Cauã Sousa de jesus (1)
Endereço: Rua Ema8 s/n qd 23 LT 15, Residencial Recanto das Emas, Goiânia, Goiás
`);

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].cliente, "Keli Borges755 (1)");
  assert.equal(result.rows[1].cliente, "Cauã Sousa de jesus (1)");
});

test("parseImileTxtImport removes Android invisible Unicode and BOM", () => {
  const result = parseImileTxtImport(
    "\uFEFFPACOTE 1\nNome: Rizzy\u200e\u200f\u202a (2)\u202e\nEndereço: Rua 1, Bairro A, Goiânia, Goiás",
  );

  assert.equal(result.detected, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].cliente, "Rizzy (2)");
  assert.equal(result.rows[0].quantidadePacotes, 2);
});

test("parseImileTxtImport accepts blank lines between blocks", () => {
  const result = parseImileTxtImport(`

PACOTE 1
Nome: Maria (1)
Endereço: Rua 1, Bairro A, Goiânia, Goiás


PACOTE 2
Nome: João (1)
Endereço: Rua 2, Bairro B, Goiânia, Goiás

`);

  assert.equal(result.detected, true);
  assert.equal(result.rows.length, 2);
});

test("parseImileTxtImport rejects invalid TXT and does not detect WhatsApp TXT", () => {
  const invalid = parseImileTxtImport("Nome: Sem pacote\nEndereço: Rua 1, Bairro, Goiânia, Goiás");
  assert.equal(invalid.detected, false);
  assert.equal(invalid.rows.length, 0);

  const whatsapp = parseImileTxtImport(`
Maria Cliente
Rua 1, Bairro A Goiânia - GO 74000000
Pacote de Loja Teste
BR123456789
`);
  assert.equal(whatsapp.detected, false);
  assert.equal(whatsapp.rows.length, 0);
});
