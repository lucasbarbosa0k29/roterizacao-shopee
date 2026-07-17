import test from "node:test";
import assert from "node:assert/strict";

const { getRowDisplayIdentifier } = await import(
  new URL("./row-display-identifier.ts", import.meta.url).href
);

test("getRowDisplayIdentifier returns cliente only for IMILE rows", () => {
  assert.equal(
    getRowDisplayIdentifier({ sourceType: "IMILE", sequence: "11", cliente: "Bruna Oliveira costa (2)" }),
    "Bruna Oliveira costa (2)",
  );

  assert.equal(
    getRowDisplayIdentifier({ sourceType: "WHATSAPP", sequence: "11", cliente: "Bruna Oliveira costa (2)" }),
    "11",
  );

  assert.equal(getRowDisplayIdentifier({ sequence: "11" }), "11");
});

test("getRowDisplayIdentifier falls back to Pacote N for IMILE without cliente", () => {
  assert.equal(getRowDisplayIdentifier({ sourceType: "IMILE", sequence: "31" }), "Pacote 31");
});
