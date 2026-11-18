"""Build local GPS evidence tiles from existing exports. Reads no network."""

import hashlib
import gzip
import io
import json
import math
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tmp/shopee-gps-territory/v1"
PACKAGE = ROOT / "data/localfirst/shopee-gps-territory"
SOURCES = {
    "goiania": {
        "bairros": ("public/data/goiania_bairros.geojson", "nm"),
        "ruas": ("public/data/goiania_redeviaria_full.geojson", "nm"),
        "lotes": ("public/data/goiania_lotes.geojson", ("nm_qdr", "nm_lot")),
    },
    "trindade": {
        "bairros": ("public/data/trindade-clean/bairros.geojson", "nmbairro"),
        "ruas": ("public/data/trindade-clean/logradouros.geojson", "nmlogradouro"),
        "lotes": ("public/data/trindade-clean/lotes.geojson", ("cdquadra", "cdlote")),
    },
}


def features(text):
    """Decode a feature at a time so raw WFS attributes are not retained."""
    start = text.index('"features"')
    cursor = text.index("[", start) + 1
    decoder = json.JSONDecoder()
    while True:
        while text[cursor].isspace() or text[cursor] == ",":
            cursor += 1
        if text[cursor] == "]":
            return
        feature, cursor = decoder.raw_decode(text, cursor)
        yield feature


def points(coords):
    if coords and isinstance(coords[0], (int, float)):
        yield coords[:2]
    else:
        for item in coords:
            yield from points(item)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build(city, sources):
    metadata = {}
    for layer, (relative, fields) in sources.items():
        raw = (ROOT / relative).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        text = raw.decode("utf-8-sig")
        del raw
        tiles = defaultdict(list)
        names = set()
        count = 0
        projected = city == "goiania" and layer == "ruas"
        cell = 1000 if projected else 0.01
        types = ("LineString", "MultiLineString") if layer == "ruas" else ("Polygon", "MultiPolygon")
        for feature in features(text):
            geometry = feature.get("geometry") or {}
            if geometry.get("type") not in types:
                continue
            properties = feature.get("properties") or {}
            if projected and str(properties.get("id_mun") or "").lstrip("0") != "500000299":
                continue
            if isinstance(fields, tuple):
                label = [str(properties.get(key) or "").strip() for key in fields]
                if not any(label):
                    continue
            else:
                label = str(properties.get(fields) or "").strip()
                if not label or label.upper() in {"GLEBA", "SEM NOME", "SEM DENOMINACAO"}:
                    continue
            xy = list(points(geometry["coordinates"]))
            if not xy:
                continue
            xs, ys = zip(*xy)
            bounds = [min(xs), min(ys), max(xs), max(ys)]
            expected = (600000, 8000000, 750000, 8300000) if projected else (-50, -18, -48, -15)
            if any(not math.isfinite(v) for v in bounds) or not (
                expected[0] <= bounds[0] <= bounds[2] <= expected[2]
                and expected[1] <= bounds[1] <= bounds[3] <= expected[3]
            ):
                raise ValueError(f"Unexpected coordinate range in {relative}")
            entry = [label, bounds, geometry["type"], geometry["coordinates"]]
            if layer != "lotes":
                names.add(label)
            for x in range(math.floor(bounds[0] / cell), math.floor(bounds[2] / cell) + 1):
                for y in range(math.floor(bounds[1] / cell), math.floor(bounds[3] / cell) + 1):
                    tiles[x, y].append(entry)
            count += 1
        if not count:
            raise ValueError(f"No usable features in {relative}")
        for (x, y), rows in tiles.items():
            write(OUT / city / layer / f"{x}_{y}.json", rows)
        metadata[layer] = {"source": relative, "sha256": digest, "features": count, "names": sorted(names),
                           "cells": [f"{x}_{y}" for x, y in sorted(tiles)]}
        print(city, layer, count, len(tiles), flush=True)
    write(OUT / city / "manifest.json", metadata)


def package(city):
    """Pack tiles as independently readable gzip blocks. Node needs no unpacking step."""
    directory = OUT / city
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    PACKAGE.mkdir(parents=True, exist_ok=True)
    packed = PACKAGE / f"{city}.pack"
    temporary = packed.with_suffix(".pack.tmp")
    digest = hashlib.sha256()
    with temporary.open("wb") as output:
        for layer, info in manifest.items():
            offsets = {}
            for cell in info["cells"]:
                tile = (directory / layer / f"{cell}.json").read_bytes()
                buffer = io.BytesIO()
                with gzip.GzipFile(filename="", fileobj=buffer, mode="wb", mtime=0) as compressed:
                    compressed.write(tile)
                block = buffer.getvalue()
                offsets[cell] = [output.tell(), len(block)]
                output.write(block)
                digest.update(block)
            info["blocks"] = offsets
    temporary.replace(packed)
    write(PACKAGE / f"{city}.json", {
        "version": 1, "bytes": packed.stat().st_size, "sha256": digest.hexdigest(), "layers": manifest,
    })
    print(city, "package", packed.stat().st_size, digest.hexdigest(), flush=True)


if __name__ == "__main__":
    for name, sources in SOURCES.items():
        build(name, sources)
        package(name)
