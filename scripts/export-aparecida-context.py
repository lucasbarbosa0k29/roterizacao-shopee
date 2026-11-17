"""Offline extraction of existing cadastral layers; requires GDAL in the operator's Python.

Usage: python export-aparecida-context.py --source D:/SHAPES_APGYN --output data/localfirst/aparecida
No simplification, buffers, network calls, provider data or cadastral edits.
"""
import argparse
import hashlib
import json
from pathlib import Path
from osgeo import ogr, osr

parser = argparse.ArgumentParser()
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
ogr.UseExceptions()
target = osr.SpatialReference()
target.ImportFromEPSG(4326)
target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
args.output.mkdir(parents=True, exist_ok=True)
for layer_name, collection, output_name in [
    ("bairros", "boundaries", "bairros.json"),
    ("seg_logradouros", "streets", "logradouros.json"),
]:
    source_file = args.source / (layer_name + ".shp")
    dataset = ogr.Open(str(source_file))
    layer = dataset.GetLayer()
    source_crs = layer.GetSpatialRef()
    source_crs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(source_crs, target)
    entries = []
    for feature in layer:
        geometry = feature.GetGeometryRef().Clone()
        geometry.Transform(transform)
        min_x, max_x, min_y, max_y = geometry.GetEnvelope()
        entries.append({
            "id": feature.GetField("id") if collection == "boundaries" else feature.GetFID(),
            "name": feature.GetField("nm__bai" if collection == "boundaries" else "nm_compl"),
            "bbox": [min_x, min_y, max_x, max_y],
            "geometry": json.loads(geometry.ExportToJson()),
        })
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
              for ext in ("shp", "shx", "dbf", "prj", "cpg")
              if (p := args.source / f"{layer_name}.{ext}").exists()}
    result = {
        "source": str(source_file), "sourceHashes": hashes,
        "sourceCRS": "EPSG:" + source_crs.GetAuthorityCode(None), "crs": "EPSG:4326",
        "provenanceStatus": "Local cadastral layer used in the audit. Publisher and update date not supplied. Requires provenance review before deployment.",
        collection: entries,
    }
    (args.output / output_name).write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(output_name, len(entries))
