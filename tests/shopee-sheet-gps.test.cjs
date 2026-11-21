const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfflineProcess } = require('./helpers/process-offline.cjs');

const offline = createOfflineProcess();
console.info = console.warn = () => {};

const row = {
  original: 'Rua Estados Unidos',
  bairro: 'Setor Planície',
  city: 'Aparecida de Goiânia',
  latFromSheet: -16.83234,
  lngFromSheet: -49.22156,
};
const fixtureFor = (input) => ({
  gemini: { rua: input.original, bairro: input.bairro, cidade: input.city, estado: 'GO' },
});
const run = (input = row, fixture = fixtureFor(input)) => offline.run(input, fixture);
test('byte offsets preserve UTF-8, nested coordinates, duplicate keys and escaped delimiters', () => {
  const { JsonObjectTable } = offline.readModule('app/lib/json-object-table.ts');
  const features = [
    { name: 'São "{Luz}"', coordinates: [[[1, 2], [3, 4]]] },
    { name: 'São "{Luz}"', note: 'barra\\ e },{', coordinates: [] },
  ];
  for (const kind of ['features', 'array']) {
    const source = kind === 'features' ? { type: 'FeatureCollection', features } : features;
    const table = new JsonObjectTable(Buffer.from(JSON.stringify(source, null, 2)));
    const offsets = [];
    assert.equal(table.index(kind, (_, offset) => offsets.push(offset)), features.length);
    assert.deepEqual(offsets.map(i => table.read(i)), features);
  }
  for (const bad of ['[{"a":1}', '[{},]', '[{}{}]', '[{}]invalid']) {
    assert.throws(() => new JsonObjectTable(Buffer.from(bad)).index('array', () => {}));
  }
});

test('Aparecida clears all spatial caches and reproduces the same parcel on cold reload', () => {
  const { lots } = offline;
  const point = [-16.834696, -49.224049];
  const first = lots.lookupStrictAparecidaParcel(...point);
  assert.equal(first.lote, '26');
  assert.equal(lots.getAparecidaLocalLotsCacheSnapshot().datasetLoaded, true);
  lots.clearAparecidaCentroidCaches('test');
  const cold = lots.getAparecidaLocalLotsCacheSnapshot();
  for (const field of ['datasetLoaded', 'centroidsLoaded', 'streetCentroidsLoaded', 'centroidCacheTtlArmed']) {
    assert.equal(cold[field], false);
  }
  assert.deepEqual(lots.lookupStrictAparecidaParcel(...point), first);
});
const assertShopee = ({ result, calls }, input, expectedStatus = "OK") => {
  assert.equal(result.source, 'SHOPEE_GPS');
  assert.equal(result.status, expectedStatus);
  assert.equal(result.coordinatePrecision, 'STREET');
  assert.equal(result.lat, input.latFromSheet);
  assert.equal(result.lng, input.lngFromSheet);
  assert.equal(result.bairro, input.bairro);
  assert.ok(calls.every(call => call.endpoint === 'gemini'));
};

test('uses a locally corroborated sheet point without consulting HERE', async () => {
  assertShopee(await run(), row);
});

test('falls back for absent, invalid, swapped or territorially incompatible points', async () => {
  for (const [name, changes, reason] of [
    ['absent', { latFromSheet: undefined, lngFromSheet: undefined }, 'GPS_ABSENT'],
    ['missing longitude', { lngFromSheet: null }, 'INVALID_COORDINATES'],
    ['non-numeric', { latFromSheet: '-16.83234' }, 'INVALID_COORDINATES'],
    ['zero', { latFromSheet: 0 }, 'INVALID_COORDINATES'],
    ['infinite', { lngFromSheet: Infinity }, 'INVALID_COORDINATES'],
    ['out of range', { latFromSheet: -91 }, 'INVALID_COORDINATES'],
    ['swapped', { latFromSheet: row.lngFromSheet, lngFromSheet: row.latFromSheet }, 'CITY_CONFLICT'],
    ['outside city', { latFromSheet: -23.55, lngFromSheet: -46.63 }, 'CITY_CONFLICT'],
    ['wrong spreadsheet neighborhood', { bairro: 'Nova Olinda' }, 'BAIRRO_CONFLICT'],
  ]) {
    const input = { ...row, ...changes };
    // Gemini retaining the expected bairro must not override the spreadsheet.
    const fixture = { gemini: { ...fixtureFor(input).gemini, bairro: row.bairro } };
    const baseline = await run({ ...input, latFromSheet: null, lngFromSheet: null }, fixture);
    const candidate = await run(input, fixture);
    assert.notEqual(candidate.result.source, 'SHOPEE_GPS', name);
    const { shopeeGpsRecoveryRejectedReason, shopeeGpsValidationRejectedReason, ...remaining } = candidate.result;
    assert.equal(shopeeGpsRecoveryRejectedReason, reason, name);
    assert.equal(shopeeGpsValidationRejectedReason, reason === 'GPS_ABSENT' ? undefined : reason, name);
    for (const field of ['status', 'source', 'lat', 'lng', 'decisionReason']) assert.equal(remaining[field], baseline.result[field], name);
    assert.deepEqual(candidate.calls, baseline.calls, name);
    assert.ok(candidate.calls.some(call => call.endpoint === 'geocode'), name);
  }
});

test('preserves a confirmed memory point ahead of sheet GPS', async () => {
  const fixture = {
    ...fixtureFor(row),
    memory: { lat: -16.830363, lng: -49.222699, label: 'Manual confirmation', createdBy: 'offline-user' },
  };
  const { result, calls } = await run(row, fixture);
  assert.equal(result.source, 'MEMORY');
  assert.equal(result.status, 'CONFIRMADO');
  assert.equal(result.lat, fixture.memory.lat);
  assert.equal(result.lng, fixture.memory.lng);
  assert.ok(calls.every(call => call.endpoint === 'gemini'));
});

test('preserves a verified Aparecida parcel ahead of eligible sheet GPS', async () => {
  const input = {
    ...row,
    original: 'Rua Guaporé, Qd 2, Lt 26',
    bairro: 'Nova Olinda',
    latFromSheet: -16.834696,
    lngFromSheet: -49.224049,
  };
  const fixture = {
    gemini: { ...fixtureFor(input).gemini, rua: 'Rua Guaporé', quadra: '2', lote: '26' },
  };
  const validate = offline.readModule('app/lib/shopee-sheet-gps.ts').validateShopeeSheetGps;
  assert.ok(validate({
    ...input, lat: input.latFromSheet, lng: input.lngFromSheet, street: 'Rua Guaporé',
  }));
  const { result } = await run(input, fixture);
  assert.equal(result.localLotUsedAsFinal, true);
  assert.equal(result.status, 'OK');
  assert.equal(result.coordinatePrecision, 'LOT');
  assert.notEqual(result.source, 'SHOPEE_GPS');
});

test('a known parcel near its edge is evidence of uncertainty, not a veto', async () => {
  const input = {
    ...row,
    original: 'Rua Guaporé, Qd 2, Lt 999',
    bairro: 'Nova Olinda',
    latFromSheet: -16.834696,
    lngFromSheet: -49.224049,
  };
  const {result} = await offline.run(input, fixtureFor(input), true);
  assert.equal(result.source, 'SHOPEE_GPS');
  assert.equal(result.status, 'PARCIAL');
  assert.equal(result.shopeeGpsEvidence.containingParcel.lote, '26');
  assert.ok(result.shopeeGpsEvidence.containingParcel.edgeDistanceM < 12);
});
test('uses validated GPS ahead of a Hidrolandia Local First street anchor', async (t) => {
  const flag = 'ROTTA_HIDROLANDIA_LOCALFIRST_PROMOTION';
  const previous = process.env[flag];
  process.env[flag] = '1';
  t.after(() => {
    if (previous === undefined) delete process.env[flag];
    else process.env[flag] = previous;
  });
  const input = {
    original: 'Alameda Manoel Gustavo de Souza',
    bairro: 'SITIOS DE RECREIO SAVANNAH',
    city: 'Hidrolândia',
    latFromSheet: -17.006916324191177,
    lngFromSheet: -49.219641635319256,
  };
  const { result } = await run({ ...input, latFromSheet: null, lngFromSheet: null });
  assert.equal(result.source, 'LOCALFIRST_HIDROLANDIA_SETOR_RUA');
  assert.equal(result.status, 'PARCIAL');
  assert.equal((await run(input)).result.source, "SHOPEE_GPS");
});

test('rejects a point with evidence that belongs to another city', async () => {
  for (const city of ['Goiânia', 'Trindade']) {
    const input = { ...row, city };
    const baseline = await run({ ...input, latFromSheet: null, lngFromSheet: null });
    const candidate = await run(input);
    const { shopeeGpsRecoveryRejectedReason, shopeeGpsValidationRejectedReason, ...remaining } = candidate.result;
    assert.equal(shopeeGpsRecoveryRejectedReason, 'CITY_CONFLICT', city);
    assert.equal(shopeeGpsValidationRejectedReason, 'CITY_CONFLICT', city);
    for (const field of ['status', 'source', 'lat', 'lng', 'decisionReason']) assert.equal(remaining[field], baseline.result[field], city);
  }
});

test('uses city-compatible GPS before HERE when the sheet bairro and street are unverified', async () => {
  const input = { ...row, original: 'Rua Inexistente', bairro: 'Bairro fora do cadastro' };
  const baseline = await run({ ...input, latFromSheet: null, lngFromSheet: null });
  assert.equal(baseline.result.status, 'PARCIAL');
  assert.equal(baseline.result.lat, null);
  assert.equal(baseline.result.decisionReason, 'LOW_SCORE');
  const candidate = await run(input);
  assert.equal(candidate.result.status, 'PARCIAL');
  assert.equal(candidate.result.lat, input.latFromSheet);
  assert.equal(candidate.result.lng, input.lngFromSheet);
  assert.equal(candidate.result.coordinatePrecision, undefined);
  assert.equal(candidate.result.decisionReason, 'SHOPEE_GPS_BAIRRO_UNVERIFIED_APPROXIMATE');
  assert.ok(candidate.calls.every(x => x.endpoint === 'gemini'));
});

test('eligible primary GPS takes priority over approximate memory while empty addresses remain unresolved', async () => {
  const input = { ...row, original: 'Rua Inexistente', bairro: 'Bairro fora do cadastro' };
  const fixture = { ...fixtureFor(input), approx: { matched: true, lat: -16.831, lng: -49.22 } };
  const candidate = await run(input, fixture);
  const baseline = await run({ ...input, latFromSheet: null, lngFromSheet: null }, fixture);
  assert.equal(baseline.result.lat, fixture.approx.lat);
  assert.equal(candidate.result.source, 'SHOPEE_GPS');
  assert.equal(candidate.result.status, 'PARCIAL');
  assert.equal(candidate.result.lat, input.latFromSheet);
  assert.equal(candidate.result.shopeeGpsPreviousDecisionReason, undefined);
  const empty = await run({ ...row, original: '' });
  assert.equal(empty.result.status, 'PARCIAL');
  assert.equal(empty.result.decisionReason, 'SHOPEE_GPS_ADDRESS_EMPTY');
  assert.equal(empty.result.lat, null);
});

test('keeps both Hidrolandia B-to-C regression rows near their parcel edges', async () => {
  for (const input of [
    { original: 'Rua das Laranjeiras, 0, Qd. 11 Lt. 10', bairro: 'Jardim Primavera', latFromSheet: -16.9700222, lngFromSheet: -49.2298241 },
    { original: 'Rua Florismundo Pires, 0, quadra 49 lote 01', bairro: 'Vila Grimpas', latFromSheet: -16.9682503, lngFromSheet: -49.226532 },
  ]) {
    input.city = 'Hidrolândia';
    const {result} = await offline.run(input, fixtureFor(input), true);
    assert.equal(result.status, 'PARCIAL');
    assert.equal(result.source, 'SHOPEE_GPS');
    assert.equal(result.shopeeGpsEvidence.parcelMatches, false);
    assert.ok(result.shopeeGpsEvidence.containingParcel.edgeDistanceM < 12);
  }
});
test('preserves the late Aparecida cadastral result ahead of an eligible sheet GPS', async () => {
  const input = {
    ...row,
    original: 'Avenida 8 E, 00, Quadra 8 Lote 10',
    bairro: 'Garavelo Residencial Park',
    latFromSheet: -16.762459,
    lngFromSheet: -49.342411,
  };
  const baseline = await offline.run({ ...input, latFromSheet: null, lngFromSheet: null });
  const candidate = await offline.run(input);
  assert.equal(baseline.result.decisionReason, 'LOCAL_APARECIDA_LOT_OK');
  assert.equal(candidate.result.shopeeGpsValidation, 'ACCEPTED');
  for (const field of ['status', 'lat', 'lng', 'decisionReason']) assert.equal(candidate.result[field], baseline.result[field], field);
  assert.ok(candidate.calls.every(call => call.endpoint === 'gemini'));
});

test('coordinate import recognizes header variants, number formats and deliberate blanks', () => {
  const { readShopeeSheetCoordinates } = offline.readModule('app/lib/shopee-sheet-coordinates.ts');
  assert.deepEqual(readShopeeSheetCoordinates({ ' GPS Latitude ': '-16,83', DESTINATION_LONGITUDE: -49.22 }),
    { latFromSheet: -16.83, lngFromSheet: -49.22 });
  assert.deepEqual(readShopeeSheetCoordinates({ LAT: ' ', 'Longitude GPS': 'irrelevant' }),
    { latFromSheet: null, lngFromSheet: null });
  assert.deepEqual(readShopeeSheetCoordinates({ Latitude: -49.22, Longitude: '-16.83' }),
    { latFromSheet: -49.22, lngFromSheet: -16.83 });
});

test('street tolerance uses a closed 300 m limit while the legacy HERE check keeps 20 m', () => {
  const { checkStreetGeometry } = offline.readModule('app/lib/aparecida-territory.ts');
  const streets = [{
    name: 'Rua A', bbox: [-10, 0, 10, 0],
    geometry: { type: 'LineString', coordinates: [[-10, 0], [10, 0]] },
  }];
  for (const distance of [20, 50, 100, 200, 299, 300, 301]) {
    const at = [0, distance];
    assert.equal(checkStreetGeometry('Rua A', at, (a, b) => a === b, streets, 300).matched, distance <= 300);
    assert.equal(checkStreetGeometry('Rua A', at, (a, b) => a === b, streets, 20).matched, distance === 20);
  }
});

test('Goiânia and Trindade use strong territorial evidence for vetos and allow unverified bairros as approximate', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const overlay = fs.mkdtempSync(path.join(os.tmpdir(), 'shopee-test-tiles-'));
  const dir = path.join(overlay, 'data/localfirst/shopee-gps-territory');
  fs.mkdirSync(dir, {recursive:true});
  const gzip = require('node:zlib').gzipSync;
  for (const entry of [
    { key: 'goiania', city: 'Goiânia', lng: -49.281, lat: -16.671, streetAt: [683315.305, 8156050.943], cell: 1000, gap: 200 },
    { key: 'trindade', city: 'Trindade', lng: -49.501, lat: -16.651, streetAt: [-49.501, -16.651], cell: .01, gap: .0018 },
  ]) {
    const { key, city, lng, lat, streetAt: [x, y], cell, gap } = entry;
    const tileName = (a, b, size) => Math.floor(a / size) + '_' + Math.floor(b / size);
    const polygonCell = tileName(lng, lat, .01);
    const lineCell = tileName(x, y + gap, cell);
    const bounds = [lng - .001, lat - .001, lng + .001, lat + .001];
    const [w, s, e, n] = bounds;
    const outline = [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
    const layers = {
      bairros: { names: ['Setor Teste', 'Setor Vizinho'], cell: polygonCell, data: [['Setor Teste', bounds, 'Polygon', outline]] },
      lotes: { names: [], cell: polygonCell, data: [[['2', '7'], bounds, 'Polygon', outline]] },
      ruas: { names: ['Rua A'], cell: lineCell, data: [['Rua A', [x - gap / 2, y + gap, x + gap / 2, y + gap],
        'LineString', [[x - gap / 2, y + gap], [x + gap / 2, y + gap]]]] },
    };
    let offset = 0;
    const data = Object.values(layers).map(layer => {
      const block = gzip(JSON.stringify(layer.data));
      layer.blocks = {[layer.cell]: [offset, block.length]};
      offset += block.length;
      delete layer.data;
      return block;
    });
    fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify({version:1,layers}));
    fs.writeFileSync(path.join(dir, key + '.pack'), Buffer.concat(data));
    const process = createOfflineProcess({ overlay });
    const { assessShopeeSheetGps, recoverShopeeSheetGps } = process.readModule('app/lib/shopee-sheet-gps.ts');
    const input = { city, lat, lng, bairro: 'Setor Teste', street: 'Rua A' };
    assert.equal(assessShopeeSheetGps(input).position.quality, 'STREET_NEAR', city);
    assert.equal(assessShopeeSheetGps({ ...input, street: 'Rua B' }).position.quality, 'BAIRRO_ONLY');
    assert.equal(assessShopeeSheetGps({ ...input, bairro: 'Bairro desconhecido' }).position.quality, 'CITY_ONLY');
    assert.equal(assessShopeeSheetGps({ ...input, bairro: 'Setor Vizinho' }).reason, 'BAIRRO_CONFLICT');
    assert.equal(assessShopeeSheetGps({ ...input, quadra: '2', lote: '9' }).reason, 'PARCEL_CONFLICT');
    assert.deepEqual(recoverShopeeSheetGps({ ...input, bairro: '', normalizedCity: city, state: 'GO',
      quadra: '', lote: '' }).position, { lat, lng });
    const farther = { ...input, lat: lat - .00095 };
    assert.equal(assessShopeeSheetGps(farther).reason, 'STREET_OVER_300M');
    assert.deepEqual(recoverShopeeSheetGps({ ...farther, normalizedCity: city, state: 'GO',
      quadra: '', lote: '' }).position, { lat: farther.lat, lng });
    const uploaded = { original: 'Rua A', city, bairro: input.bairro, latFromSheet: lat, lngFromSheet: lng };
    assertShopee(await process.run(uploaded, fixtureFor(uploaded)), uploaded, 'PARCIAL');
    const distant = { ...uploaded, latFromSheet: farther.lat };
    const recovered = await process.run(distant, fixtureFor(distant));
    assert.equal(recovered.result.decisionReason, 'SHOPEE_GPS_RECOVERED_NO_COORDS');
    assert.equal(recovered.result.status, 'PARCIAL');
    assert.equal(recovered.result.lat, farther.lat);
    const approximate = { matched: true, lat: lat + .0001, lng };
    const kept = await process.run(distant, { ...fixtureFor(distant), approx: approximate });
    assert.equal(kept.result.lat, approximate.lat);
    assert.equal(kept.result.shopeeGpsPreviousDecisionReason, undefined);
  }
});

test('a positive bairro with an unverified street uses Shopee as Approximate ahead of HERE', async () => {
  const input = { ...row, original: 'Rua Inexistente' };
  const fixture = { gemini: { ...fixtureFor(input).gemini, rua: 'Rua Inferida Pelo Gemini' } };
  const {result,calls} = await run(input, fixture);
  assert.equal(result.status, 'PARCIAL');
  assert.equal(result.decisionReason, 'SHOPEE_GPS_BAIRRO_VERIFIED');
  assert.ok(calls.every(call => call.endpoint === 'gemini'));
});

test('chooses GPS ahead of an approximate HERE point without consulting the provider', async () => {
  const input = { ...row, city: 'Aparecida de Goiania', bairro: 'Setor Planicie' };
  const control = { ...input, latFromSheet: null, lngFromSheet: null };
  const fixture = fixtureFor(input);
  const probe = await run(control, fixture);
  const providerPoint = { lat: -16.8327, lng: -49.22156 };
  const item = { title: input.original, resultType: 'street', position: providerPoint,
    address: { street: input.original, city: input.city, district: input.bairro, stateCode: 'GO' } };
  fixture.here = probe.calls.filter(c => c.endpoint === 'geocode')
    .map(c => ({endpoint: c.endpoint, query: c.q, item}));
  const before = await run(control, fixture);
  assert.equal(before.result.status, 'PARCIAL');
  assert.equal(before.result.lat, providerPoint.lat);
  assertShopee(await run(input, fixture), input);
});
test('validated exact automatic memory keeps OK, and uncorroborated memory loses to GPS', async () => {
  const fixture = { ...fixtureFor(row), memory: { lat: row.latFromSheet, lng: row.lngFromSheet, createdBy: null } };
  const verified = (await run(row, fixture)).result;
  assert.equal(verified.source, 'MEMORY_AUTOMATIC');
  assert.equal(verified.status, 'OK');
  const weak = (await run(row, { ...fixture, memory: {lat:-16.8100,lng:-49.25,createdBy:null} })).result;
  assert.equal(weak.source, 'SHOPEE_GPS');
  assert.equal(weak.status, 'OK');
});

test('original address parcel evidence never treats compounds or block text as an exact lot', () => {
  const {readShopeeAddressParcel} = offline.readModule('app/lib/shopee-sheet-gps.ts');
  assert.deepEqual(readShopeeAddressParcel('Rua VC 76B cond Nelson Mandela, Qd A12 lt bl 225/232'), {quadra:'A12',lote:''});
  assert.deepEqual(readShopeeAddressParcel('Rua Lee Hundley, Qd 11 lt 23/24'), {quadra:'11',lote:''});
  assert.deepEqual(readShopeeAddressParcel('Av palmeiras QD 09 LT 24 25'), {quadra:'09',lote:''});
  assert.deepEqual(readShopeeAddressParcel('Av Zoroastro, Qd 19 LT 10 A'), {quadra:'19',lote:'10A'});
});

test('legacy automatic exact coordinates without Shopee are retained as approximate near a parcel edge', async () => {
  const input = { ...row, original: 'Avenida das Palmeiras, 0, Qd 14 LT 26B sem número',
    bairro: 'Parque Montreal', latFromSheet: null, lngFromSheet: null };
  const memory = { lat: -16.83847677474916, lng: -49.21913899562804, createdBy: null };
  const {result} = await run(input, {...fixtureFor(input), memory});
  assert.equal(result.status, 'PARCIAL');
  assert.equal(result.source, 'MEMORY_APPROX');
  assert.equal(result.lat, memory.lat);
  assert.equal(result.lng, memory.lng);
});

test('Goiânia regression does not treat AREA as a quadra code in a condominium', async () => {
  const input = {
    original: 'Rua VC 76B cond Nelson Mandela 03, 03, Qd A12 lt bl 225/232',
    bairro: 'Conjunto Vera Cruz', city: 'Goiânia',
    latFromSheet: -16.6804199, lngFromSheet: -49.3872261,
  };
  const {result} = await offline.run(input, fixtureFor(input), true);
  assert.equal(result.shopeeGpsEvidence.containingParcel.quadra, 'AREA');
  assert.equal(result.shopeeGpsEvidence.expectedParcel.lote, '');
  assert.equal(result.source, 'SHOPEE_GPS');
  assert.equal(result.status, 'PARCIAL');
});

test('does not activate any Shopee geocoding in other cities', async () => {
  for (const city of ['Abadia de Goiás', 'Anápolis', 'São Paulo']) {
    const input = { ...row, city };
    const {result,calls} = await run(input);
    const before = await run({...input,latFromSheet:null,lngFromSheet:null});
    assert.deepEqual({result,calls}, before);
  }
});
