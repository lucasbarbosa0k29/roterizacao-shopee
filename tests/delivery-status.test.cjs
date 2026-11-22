const test = require('node:test');
const assert = require('node:assert/strict');
const { createOfflineProcess } = require('./helpers/process-offline.cjs');

const coord = {lat: -16.78, lng: -49.24};
const gps = {
  ...coord, city: 'Aparecida de Goiania', sequence: '24', original: 'Duplicate',
  latFromSheet: coord.lat, lngFromSheet: coord.lng, status: 'PARCIAL',
  source: 'SHOPEE_GPS', shopeeGpsValidation: 'ACCEPTED',
};

test('accepted GPS including final recovery, rejected GPS and alternate winners', () => {
  const {deliveryStatus} = createOfflineProcess().readModule('app/lib/delivery-status.ts');
  const status = overrides => deliveryStatus({...gps, ...overrides}, undefined, 'job', 0);
  for (const city of ['Goiania', 'Aparecida de Goiania', 'Hidrolandia', 'Trindade']) {
    assert.equal(status({city}), 'OK');
    assert.equal(status({city, shopeeGpsValidation: undefined, decisionReason: 'SHOPEE_GPS_RECOVERED_NO_COORDS',
      shopeeGpsValidationRejectedReason: 'STREET_OVER_300M'}), 'OK');
  }
  for (const reason of ['CITY_CONFLICT', 'BAIRRO_CONFLICT', 'PARCEL_CONFLICT', 'INVALID_COORDINATES']) {
    assert.equal(status({shopeeGpsValidationRejectedReason: reason}), 'PARCIAL');
  }
  assert.equal(status({lat: null}), 'NAO_ENCONTRADO');
  assert.equal(deliveryStatus(gps, {lat: gps.lat + 1, lng: gps.lng}, 'job', 0), 'PARCIAL');
  assert.equal(status({latFromSheet: coord.lat + 0.1}), 'PARCIAL');
  assert.equal(status({source: 'HERE_GEOCODE'}), 'PARCIAL');
  assert.equal(status({source: 'MEMORY', status: 'CONFIRMADO'}), 'OK');
});

test('history PATCH and reload isolate the clicked delivery from duplicates and other jobs', async () => {
  const job = {id: 'route-a', status: 'DONE', totalStops: 2, resultJson: [gps, {...gps}], workspaceJson: null};
  const offline = createOfflineProcess({historyJob: job});
  const {GET, PATCH} = offline.readModule('app/api/history/[id]/route.ts');
  const {applyManualCoordinateToState} = offline.readModule('app/lib/manual-correction-persistence.ts');
  const {deliveryStatus, groupDeliveryStatus} = offline.readModule('app/lib/delivery-status.ts');
  const context = {params: Promise.resolve({id: job.id})};
  const url = 'https://audit.invalid/api/history/route-a';
  const reload = async () => {
    const response = await GET(new Request(url), context);
    assert.equal(response.status, 200);
    return (await response.json()).job.resultJson.rows;
  };
  const save = async body => {
    const response = await PATCH(new Request(url, {method: 'PATCH', body: JSON.stringify(body)}), context);
    assert.equal(response.status, 200);
  };
  const progress = async () => {
    const response = await GET(new Request(url + '?mode=progress'), context);
    return (await response.json()).job.displayStatus;
  };
  const rows = await reload();
  assert.deepEqual(rows.map(row => row.status), ['OK','OK']);
  const clicked = applyManualCoordinateToState({rows, manualEdits: {}, index: 1, coord, confirmedInJob: job.id});
  await save({...clicked, confirmationIndex: 1});
  const reopened = await reload();
  assert.deepEqual(reopened.map(row => row.status), ['OK','CONFIRMADO']);
  assert.equal(groupDeliveryStatus(reopened.map(row => row.status)), 'OK');
  assert.equal(await progress(), 'REVIEW');
  assert.equal(groupDeliveryStatus(['CONFIRMADO','PARCIAL']), 'PARCIAL');
  assert.equal(deliveryStatus(reopened[1], clicked.manualEdits[1], 'route-b', 1), 'OK');
  // A generic autosave cannot mint a second confirmation, even with the same sequence and address.
  const copied = {...clicked.manualEdits[1], mapConfirmation: {...clicked.manualEdits[1].mapConfirmation, index: 0}};
  await save({manualEdits: {...clicked.manualEdits, 0: copied}, manualGroups: {group: [0, 1]}});
  assert.deepEqual((await reload()).map(row => row.status), ['OK','CONFIRMADO']);
  const moved = applyManualCoordinateToState({...clicked, index: 1, coord: {...coord, lng: -49.25}, confirmedInJob: null});
  await save(moved);
  assert.equal((await reload())[1].status, 'PARCIAL');
  assert.equal(groupDeliveryStatus(['CONFIRMADO','CONFIRMADO']), 'CONFIRMADO');
});

test('opening an Aparecida parcel preview leaves the delivery untouched, Confirmar targets only the open row', async () => {
  const fs = require('node:fs');
  const ts = require('typescript');
  const source = fs.readFileSync('app/page.tsx', 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ['fetchQuadraLote', 'confirmManualModal'].includes(node.name?.text)) {
      declarations.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(declarations.length, 2);
  const saves = [];
  const preview = [];
  const bindings = {
    modalIdx: 1, historyId: 'route', jobId: 'route', rows: [gps, gps], pinLatLng: coord,
    getArcgisCityKey: () => 'aparecida', isAparecidaCity: () => true, pickedLabel: '',
    pickedQuadra: '1', pickedLote: '2', closeManualModal: () => {},
    quadraCacheRef: {current: new Map([[`${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}`, {quadra: '1', lote: '2'}]])},
    setPickedQuadra: value => preview.push(value), setPickedLote: value => preview.push(value),
    saveDeliveryCoordinate: async args => saves.push(args),
  };
  const js = ts.transpileModule(declarations.join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const modal = new Function(...Object.keys(bindings), js + '\nreturn {fetchQuadraLote, confirmManualModal};')(...Object.values(bindings));
  await modal.fetchQuadraLote(coord.lat, coord.lng);
  assert.deepEqual(preview, ['1', '2']);
  assert.deepEqual(saves, []);
  await modal.confirmManualModal();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].index, 1);
  assert.equal(saves[0].confirmedInJob, 'route');
  assert.deepEqual(saves[0].coord, coord);
});
