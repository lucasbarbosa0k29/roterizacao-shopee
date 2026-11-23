import assert from "node:assert/strict";
import test from "node:test";
import { buildAutoStopGroups } from "./auto-stop-groups";

test("agrupa pelo endereço original e cidade preservando linhas, pacotes, notas e sequências", () => {
  const rows = [
    { sequence: "7", original: "Rua A, Quadra 01 Lote 02", city: "Goiânia", notesAuto: "Loja" },
    { sequence: "2", original: "Rua A, QD 1 LT 2", city: "Trindade", notesAuto: "Frente" },
    { sequence: "9", original: "RUA A QD 1 LT 2 CEP 74000-000", city: "GOIÂNIA", notesAuto: "Fundos" },
    { sequence: "3", original: "Rua A, QD 1 LT 2", city: "Goiânia", notesAuto: "Caixa 2" },
  ];
  const originals = structuredClone(rows);
  const groups = buildAutoStopGroups(rows);
  assert.deepEqual(groups, [{ key: "RUA A QD 1 LT 2|GOIÂNIA", idxs: [0, 2, 3] }]);
  assert.deepEqual(rows, originals);
});

test("apartamentos distintos no mesmo prédio continuam dependendo do agrupamento manual", () => {
  const rows = ["101", "102"].map((apt) => ({
    original: `Rua A, 10, Edifício Central, Apto ${apt}`,
    normalizedLine: "Rua A, 10",
    city: "Goiânia",
  }));
  assert.deepEqual(buildAutoStopGroups(rows), []);
});

test("índices de grupos intercalados sobrevivem ao armazenamento sem repetir pacotes", () => {
  const rows = ["Rua A", "Rua B", "Rua B", "Rua A"].map((original) => ({ original }));
  const saved = JSON.parse(JSON.stringify(buildAutoStopGroups(rows)));
  assert.deepEqual(saved, [
    { key: "RUA A|", idxs: [0, 3] },
    { key: "RUA B|", idxs: [1, 2] },
  ]);
  assert.deepEqual(buildAutoStopGroups([]), []);
});
