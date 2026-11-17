// Offline replay of a user-provided export. Keeps provider payloads outside Git.
// Usage: node scripts/replay-aparecida.cjs --fixture <export.json> --output <report.json>
const fs = require('node:fs');
const path = require('node:path');
const { createOfflineProcess } = require('../tests/helpers/process-offline.cjs');
const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
  return out;
}, []));
if (require.main === module && (!args.fixture || !args.output)) throw new Error('Provide --fixture and --output');
const rows = args.fixture ? JSON.parse(fs.readFileSync(args.fixture, 'utf8').replace(/^\uFEFF/, '')) : [];
const evidence = args.evidence ? JSON.parse(fs.readFileSync(args.evidence, 'utf8')).rows : null;
const root = path.resolve(args.root || process.cwd());
const h = require.main === module ? createOfflineProcess({ root, overlay: args.overlay && path.resolve(args.overlay) }) : null;
const log = console.log;
if (require.main === module) console.info = console.warn = () => {};
const valid = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
function itemFromLabel(candidate, full) {
  if (valid(full?.position) && full.position.lat === candidate.pos?.lat && full.position.lng === candidate.pos?.lng && full.address?.label === candidate.label) return { item: full, reconstructed: false };
  const parts = String(candidate.label || '').split(',').map(x => x.trim());
  const cityIndex = parts.findIndex(x => /^Aparecida de Goi.nia(?:\s+-\s+GO)?$/i.test(x));
  return { reconstructed: true, item: {
    position: candidate.pos, resultType: candidate.resultType,
    address: { label: candidate.label, street: parts[0] || '',
      district: cityIndex >= 2 ? parts[cityIndex - 1] : '',
      city: cityIndex >= 0 ? 'Aparecida de Goiânia' : '',
      postalCode: parts.find(x => /^\d{5}-?\d{3}$/.test(x)) || '',
      houseNumber: cityIndex >= 3 ? parts[1] : '',
    },
  }};
}
function fixtureFor(row, index) {
  let reconstructed = 0;
  const here = (row.hereRankTop5 || []).filter(x => x.from !== 'LOCAL_APARECIDA_LOT' && valid(x.pos)).map(candidate => {
    const parsed = itemFromLabel(candidate, row.hereBest);
    if (parsed.reconstructed) reconstructed++;
    return { endpoint: candidate.kind === 'discover' ? 'discover' : 'geocode', query: candidate.from, item: parsed.item };
  });
  return { gemini: JSON.parse(row.raw), here, reconstructed,
    memory: row.geocodeConfidenceFlags?.includes('SOURCE_MEMORY_EXACT') ? { lat: row.lat, lng: row.lng, label: row.normalizedLine } : null,
    approx: row.approxMemoryUsedAsFinal ? { matched: true, lat: row.lat, lng: row.lng, label: row.normalizedLine } : { matched: false },
  };
}
function summarize(rows) {
  return { total: rows.length, OK: rows.filter(x => x.status === 'OK').length,
    PARCIAL: rows.filter(x => x.status === 'PARCIAL').length,
    semGPS: rows.filter(x => !valid(x)).length,
    validado: rows.filter(x => x.status === 'OK' && valid(x)).length,
    aproximadoComGPS: rows.filter(x => x.status === 'PARCIAL' && valid(x)).length,
    pendenteSemGPS: rows.filter(x => !valid(x)).length,
  };
}
if (require.main === module) (async () => {
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fixture = fixtureFor(row, i);
    const { result, calls } = await h.run({ sequence: row.sequence, original: row.original, bairro: row.bairro, city: row.city, cep: row.cep }, fixture);
    const expectedLocal = evidence?.[i]?.replayCounterfactual;
    results.push({ line: i + 1, input: { original: row.original, bairro: row.bairro },
      before: { status: row.status, reason: row.decisionReason, lat: row.lat, lng: row.lng },
      after: { status: result.status, reason: result.decisionReason, lat: result.lat, lng: result.lng,
        normalized: result.normalized, precision: result.coordinatePrecision, localUsed: result.localLotUsedAsFinal,
        localBairro: result.localLotBairro, flags: result.geocodeConfidenceFlags },
      sameReason: row.decisionReason === result.decisionReason,
      sameCoordinates: row.lat === result.lat && row.lng === result.lng,
      reconstructedItems: fixture.reconstructed, calls,
    });
  }
  const totals = { gemini: 0, geocode: 0, discover: 0 };
  for (const r of results) for (const call of r.calls) totals[call.endpoint]++;
  const report = { method: 'Offline processOne replay. Secondary HERE items reconstructed from export labels. Exact/approximate memory replayed from recorded outcomes. Queries absent from the export return an empty mock. No external network or database.',
    actualExternalRequests: 0, reference: summarize(rows), replay: summarize(results.map(x => x.after)),
    mockedProviderCalls: totals, sameReason: results.filter(x => x.sameReason).length,
    sameCoordinates: results.filter(x => x.sameCoordinates).length, rows: results };
  fs.writeFileSync(args.output, JSON.stringify(report, null, 2), 'utf8');
  log(JSON.stringify({ ...report, rows: undefined }));
})().catch(e => { console.error(e.stack); process.exitCode = 1; });

module.exports = { fixtureFor, summarize };
