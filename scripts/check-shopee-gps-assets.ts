import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export function checkShopeeGpsAssets(root = process.cwd()) {
  for (const relative of [
    "data/localfirst/aparecida/bairros.json",
    "data/localfirst/aparecida/logradouros.json",
    "public/data/aparecida_lotes.min.geojson",
    "public/data/hidrolandia/hidrolandia_setores_mapa.web4326.geojson",
    "public/data/hidrolandia/hidrolandia_ruas_mapa.web4326.geojson",
    "public/data/hidrolandia/hidrolandia_lotes_mapa.web4326.geojson",
  ]) {
    try {
      const file = fs.openSync(path.join(root, relative), "r");
      try {
        const header = Buffer.alloc(128);
        const size = fs.readSync(file, header);
        if (!header.toString("utf8", 0, size).trimStart().startsWith("{")) {
          throw new Error("conteúdo JSON ausente ou ponteiro Git LFS");
        }
      } finally {
        fs.closeSync(file);
      }
    } catch (error) {
      throw new Error(`[SHOPEE_GPS_ASSETS] ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const dir = path.join(root, "data/localfirst/shopee-gps-territory");
  for (const city of ["goiania", "trindade"]) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, city + ".json"), "utf8"));
      const bytes = fs.readFileSync(path.join(dir, city + ".pack"));
      if (meta.version !== 1 || meta.bytes !== bytes.length ||
          meta.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
        throw new Error("versão, tamanho ou SHA-256 inválido");
      }
      let cursor = 0;
      for (const layer of ["bairros", "ruas", "lotes"]) {
        const { cells, names, features, blocks } = meta.layers[layer];
        if (!Array.isArray(cells) || cells.length === 0 || !Array.isArray(names) ||
            (layer !== "lotes" && names.length === 0) || !Number.isSafeInteger(features) || features <= 0 ||
            !blocks || Object.keys(blocks).length !== cells.length) throw new Error("camada incompleta: " + layer);
        for (const cell of cells) {
          const [offset, length] = blocks[cell];
          if (offset !== cursor || !Number.isSafeInteger(length) || length <= 0 || offset + length > bytes.length) {
            throw new Error("bloco inválido: " + layer + "/" + cell);
          }
          const rows = JSON.parse(gunzipSync(bytes.subarray(offset, offset + length)).toString("utf8"));
          if (!Array.isArray(rows) || rows.length === 0) throw new Error("bloco vazio: " + layer + "/" + cell);
          cursor += length;
        }
      }
      if (cursor !== bytes.length) throw new Error("bytes fora do índice");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`[SHOPEE_GPS_ASSETS] ${city}: ${detail}. Inclua os índices ou execute python scripts/build-shopee-gps-territory.py com as bases locais.`);
    }
  }
}
