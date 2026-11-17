const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createOfflineProcess } = require('./helpers/process-offline.cjs');
const { fixtureFor, summarize } = require('../scripts/replay-aparecida.cjs');
const root = process.cwd();
const h = createOfflineProcess({ root, overlay: process.env.ROTTA_TEST_OVERLAY || null });
const ql = h.readModule('app/lib/quadra-lote-normalization.ts');
const territory = h.readModule('app/lib/aparecida-territory.ts');
const reuse = h.readModule('app/lib/aparecida-here-reuse.ts');
console.info = console.warn = () => {};
const expected = { rua: 'Rua Estados Unidos', bairro: 'Setor Planície', cidade: 'Aparecida de Goiânia', cep: '74988696' };
const item = (overrides = {}) => ({ position: { lat: -16.83234, lng: -49.22156 }, resultType: 'street',
  address: { street: expected.rua, city: expected.cidade, district: expected.bairro, postalCode: expected.cep }, ...overrides });
const proven = { territory: () => true, street: () => true };
const square = (name, x = 0) => ({ id: 1, name, bbox: [x, 0, x + 1, 1],
  geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });
const normalize = h.lots.normalizeAparecidaTerritoryName;

test('quadra/lote reuse parser canonicalization for numeric and alphanumeric tokens', () => {
  for (const [a,b] of [['09','9'],['06','6'],['000','0'],['07A','7A'],['09-A','9A'],['09 A','9A']]) assert.equal(ql.sameQLValue(a,b),true, `${a}/${b}`);
  for (const [a,b] of [['9','6'],['7A','7B'],['20/21','2021'],['24 25','2425'],['12-23','1223'],['','']]) assert.equal(ql.sameQLValue(a,b),false,`${a}/${b}`);
});
test('merge canonicalizes only Aparecida; preserves compound parcels and other cities', () => {
  assert.equal(h.api.mergeAparecidaLotValue('09','9','',true),'9');
  assert.equal(h.api.mergeAparecidaLotValue('09','9','',false),'09');
  assert.equal(h.api.mergeAparecidaLotValue('20/21','','',true),'20/21');
});
for (const value of ['Real Grandeza 2 Etapa','Real Grandeza - 2ª Etapa','Real Grandeza Segunda Etapa','Real Grandeza – II Etapa']) {
  test(`typography reaches the existing bairro comparator: ${value}`, () => assert.equal(h.lots.areAparecidaBairrosCompatible(value,'Real Grandeza'),true));
}
test('different stages and denied neighborhoods do not become aliases', () => {
  for (const [a,b] of [['Real Grandeza 1 Etapa','Real Grandeza 2 Etapa'],['Jardim Luz','Veiga Jardim'],['Garavelo','Village Garavelo'],['Nova Olinda','Real Grandeza']]) assert.equal(h.lots.areAparecidaBairrosCompatible(a,b),false);
});
test('new aliases require cadastral proof; missing/incorrect territory is rejected', () => {
  assert.equal(territory.checkAparecidaTerritory('Real Grandeza 2 Etapa',{lat:.5,lng:.5},normalize,[square('Real Grandeza')]).matched,false);
  assert.equal(territory.checkAparecidaTerritory('Bairro inexistente',{lat:.5,lng:.5},normalize,[square('Nova Olinda')]).matched,false);
  assert.equal(territory.checkAparecidaTerritory('Nova Olinda',{lat:.5,lng:.5},normalize,null).matched,false);
});
test('subdivision matching is directed and geometric boundaries/overlap remain ambiguous', () => {
  assert.equal(territory.checkAparecidaTerritory('Nova Olinda',{lat:.5,lng:.5},normalize,[square('Nova Olinda 2 Complemento')]).matched,true);
  assert.equal(territory.checkAparecidaTerritory('Nova Olinda 1 Complemento',{lat:.5,lng:.5},normalize,[square('Nova Olinda 2 Complemento')]).matched,false);
  assert.equal(territory.checkAparecidaTerritory('Nova Olinda',{lat:0,lng:.5},normalize,[square('Nova Olinda')]).matched,false);
  assert.equal(territory.checkAparecidaTerritory('Nova Olinda',{lat:.5,lng:.5},normalize,[square('Nova Olinda'),square('Real Grandeza')]).matched,false);
});
test('street names require nonempty identity and compatible street type', () => {
  assert.equal(h.lots.compareAparecidaStreetForValidation('Rua Doutor Pedro Ludovico Teixeira','R Pedro Ludovico Teixeira'),'STREET_MATCH');
  assert.equal(h.lots.compareAparecidaStreetForValidation('Alameda Sampaio Vidal','Avenida Sampaio Vidal'),'STREET_MISMATCH');
  assert.equal(h.lots.compareAparecidaStreetForValidation('Rua Um',''),'STREET_UNKNOWN');
});
test('street geometry proof uses actual segments and a bounded 20m distance', () => {
  const segments=[{name:'Rua A',bbox:[0,0,1,0],geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}];
  const same=(a,b)=>a===b;
  assert.equal(territory.checkAparecidaStreetGeometry('Rua A',{lat:0,lng:.5},same,segments).matched,true);
  assert.equal(territory.checkAparecidaStreetGeometry('Rua A',{lat:.001,lng:.5},same,segments).matched,false);
  assert.equal(territory.checkAparecidaStreetGeometry('Rua B',{lat:0,lng:.5},same,segments).matched,false);
});
test('reuse accepts a low-score returned street only with independent proofs', () => {
  const picked=reuse.selectAparecidaStreetCoordinate([{it:item(),score:-50}],expected,proven);
  assert.equal(picked.reason,'PARTIAL_STREET_LEVEL_MATCH');
  assert.equal(picked.score,-50); // No score inflation.
  for(const evidence of [{...proven,territory:()=>false},{...proven,street:()=>false}]) assert.equal(reuse.selectAparecidaStreetCoordinate([{it:item(),score:999}],expected,evidence),null);
});
for (const [name,change] of [
  ['city',{city:'Goiânia'}], ['street',{street:'Rua Argentina'}], ['postal code',{postalCode:'00000000'}], ['empty street',{street:''}],
]) test(`reuse rejects incorrect ${name}`,()=>assert.equal(reuse.selectAparecidaStreetCoordinate([{it:item({address:{...item().address,...change}}),score:999}],expected,proven),null));
test('reuse never turns houseNumber or locality into a street match', () => {
  for(const resultType of ['houseNumber','locality','place']) assert.equal(reuse.selectAparecidaStreetCoordinate([{it:item({resultType}),score:999}],expected,proven),null);
});
test('ranking considers all eligible candidates; geographic conflict cannot be solved by score', () => {
  const entries=[{it:item(),score:1},{it:item({position:{lat:-16.84,lng:-49.22}}),score:999}];
  assert.equal(reuse.selectAparecidaStreetCoordinate(entries,expected,proven),null);
  const rejectedFirst={it:item({address:{...item().address,city:'Goiânia'}}),score:1000};
  assert.deepEqual(reuse.selectAparecidaStreetCoordinate([rejectedFirst,entries[0]],expected,proven).item,entries[0].it);
});
const fixtureFile=process.env.ROTTA_AUDIT_FIXTURE;
const baseline=process.env.ROTTA_TEST_BASELINE;
test('108 addresses: stage gains, 56 preserved approvals, memory, geography and per-address cost', {skip:!fixtureFile||!baseline}, async () => {
  const rows=JSON.parse(fs.readFileSync(fixtureFile,'utf8'));
  const old=createOfflineProcess({root,overlay:baseline});
  const output=[]; const baselineOutput=[];
  const counts={before:{gemini:0,geocode:0,discover:0},after:{gemini:0,geocode:0,discover:0}};
  const gains=[];
  for(let i=0;i<rows.length;i++) {
    const row=rows[i], fixture=fixtureFor(row,i);
    const input={sequence:row.sequence,original:row.original,bairro:row.bairro,city:row.city,cep:row.cep};
    const a=await old.run(input,fixture), b=await h.run(input,fixture);
    baselineOutput.push(a.result);output.push(b.result);
    for(const endpoint of ['gemini','geocode','discover']) {
      const before=a.calls.filter(c=>c.endpoint===endpoint).length, after=b.calls.filter(c=>c.endpoint===endpoint).length;
      assert.ok(after<=before,`line ${i+1}: ${endpoint} ${before} -> ${after}`);
      counts.before[endpoint]+=before; counts.after[endpoint]+=after;
    }
    if(row.status==='OK') assert.equal(b.result.status,'OK',`original validated line ${i+1}`);
    assert.equal(b.result.bairro,row.bairro,`sheet bairro line ${i+1}`);
    if(row.lat!=null && ![97,98].includes(i+1)) assert.deepEqual([b.result.lat,b.result.lng],[row.lat,row.lng],`retained GPS line ${i+1}`);
    if(row.geocodeConfidenceFlags?.includes('SOURCE_MEMORY_EXACT')) assert.deepEqual([b.result.lat,b.result.lng],[row.lat,row.lng],`memory line ${i+1}`);
    if(row.lat==null && b.result.lat!=null) {
      gains.push(i+1);
      assert.equal(territory.checkAparecidaTerritory(row.bairro,b.result,normalize).matched,true,`territory line ${i+1}`);
    }
  }
  assert.deepEqual(summarize(output),{total:108,OK:76,PARCIAL:32,semGPS:22,validado:76,aproximadoComGPS:10,pendenteSemGPS:22});
  assert.deepEqual(gains,[1,7,8,9,10,11,18,21,35,36,44,59,60,62,68,69,83,84,85,87,93,94]);
  const exactGains=gains.filter(i=>output[i-1].coordinatePrecision==='LOT');
  const streetGains=gains.filter(i=>output[i-1].coordinatePrecision==='STREET');
  assert.equal(exactGains.length,20);assert.deepEqual(streetGains,[9,62]);
  for(const line of streetGains) {
    assert.equal(output[line-1].status,'PARCIAL');
    assert.equal(output[line-1].geocodeConfidenceFlags.includes('STREET_COORDINATE_ONLY'),true);
  }
  assert.equal(output[10].decisionReason,'LOCAL_APARECIDA_LOT_OK');
  assert.equal(baselineOutput[98].status,'OK'); // Known incomplete-export divergence.
  assert.equal(output[98].status,'PARCIAL');assert.equal(output[98].lat,null);
  console.log('OFFLINE_CALL_COUNTS',JSON.stringify(counts));
});
for(const city of ['Goiânia','Trindade','Hidrolândia']) test(`unchanged pipeline and manual memory in ${city}`,{skip:!baseline},async()=>{
  const old=createOfflineProcess({root,overlay:baseline});
  const row={sequence:1,original:'Rua Alfa, Quadra 09 Lote 02',bairro:'Centro',city,cep:'74000000'};
  for(const memory of [null,{lat:-16.8,lng:-49.2,label:'Manually confirmed'}]) {
    const fixture={gemini:{rua:'Rua Alfa',quadra:'09',lote:'02',bairro:'Centro',cidade:city,estado:'GO',cep:'74000000'},here:[],memory};
    const a=await old.run(row,fixture),b=await h.run(row,fixture);
    for(const key of ['status','lat','lng','decisionReason','normalizedLine']) assert.deepEqual(b.result[key],a.result[key],`${city} ${key}`);
    assert.deepEqual(b.calls,a.calls);
  }
});

test('reranking reuses equivalence but retains genuine QL conflicts', () => {
  const rank = (quadra, lote) => h.api.scoreAparecidaRerankCandidate({
    baseScore: 100, item: item(), arc: {found:true,quadra,lote,bairro:expected.bairro},
    wantArc: {quadra:'09',lote:'06',bairro:expected.bairro},
    expected: {...expected,quadra:'09',lote:'06'}, hereSpreadMeters: 0,
  });
  assert.equal(rank('9','6').qlConflict,false);
  assert.equal(rank('10','6').qlConflict,true);
  assert.equal(rank('9','7').qlConflict,true);
});

test('confirmed manual memory has priority over an available cadastral lot', async () => {
  const fixture={gemini:{rua:'Rua Doutor Pedro Ludovico Teixeira',quadra:'51',lote:'09',bairro:'Real Grandeza - 2ª Etapa',cidade:'Aparecida de Goiânia',estado:'GO',cep:'74988802'},
    memory:{lat:-16.830363,lng:-49.222699,label:'Manual confirmation',createdBy:'offline-confirmed-user'},here:[]};
  const {result,calls}=await h.run({original:'Rua Doutor Pedro Ludovico Teixeira Qd 51 Lt 09',bairro:fixture.gemini.bairro,city:fixture.gemini.cidade,cep:fixture.gemini.cep},fixture);
  assert.deepEqual([result.lat,result.lng],[fixture.memory.lat,fixture.memory.lng]);
  assert.equal(result.coordinatePrecision,'MEMORY');
  assert.equal(calls.filter(c=>c.endpoint!=='gemini').length,0);
  assert.equal(result.autoSaveDisabled,true);
});

test('new local street conflicts retain the previous HERE queries and rejected candidates', {skip:!fixtureFile||!baseline}, async () => {
  const rows=JSON.parse(fs.readFileSync(fixtureFile,'utf8'));
  const old=createOfflineProcess({root,overlay:baseline});
  for(const line of [65,66,67]) {
    const row=rows[line-1],fixture=fixtureFor(row,line-1);
    const input={sequence:row.sequence,original:row.original,bairro:row.bairro,city:row.city,cep:row.cep};
    const previous=await old.run(input,fixture), current=await h.run(input,fixture);
    assert.deepEqual(current.calls,previous.calls,`original query plan retained at line ${line}`);
    assert.equal(current.calls.filter(x=>x.endpoint==='geocode').length,4);
    assert.equal(current.result.status,'PARCIAL');
    assert.equal(current.result.lat,null);assert.equal(current.result.lng,null);
    assert.equal(current.result.localLotUsedAsFinal,false);
    assert.ok(current.result.hereRankTop5.some(x=>Number.isFinite(x.pos?.lat)&&Number.isFinite(x.pos?.lng)));
  }
});
test('review UI labels new street references as approximate and preserves manual confirmation priority', () => {
  const ts=require(require('node:path').join(root,'node_modules/typescript'));
  const source=fs.readFileSync(require('node:path').join(root,'app/page.tsx'),'utf8');
  const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const names=new Set(['getRowStatus','getTrindadeShadow','isRowMemoryHitRow','isTrindadeVisuallyValidated','getVisualStatusLabel']);
  const functions=[];
  function visit(node){if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))functions.push(node.getText(ast));ts.forEachChild(node,visit);}
  visit(ast);assert.equal(functions.length,names.size);
  const code=ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const ui=new Function('rows','manualEdits',code+'\nreturn {getRowStatus,getVisualStatusLabel};')(
    [{status:'PARCIAL',coordinatePrecision:'STREET',lat:-16.8,lng:-49.2},{status:'PARCIAL'}],{1:{confirmed:true,lat:-16.8,lng:-49.2}});
  assert.equal(ui.getVisualStatusLabel(ui.getRowStatus(0),{status:'PARCIAL',coordinatePrecision:'STREET',source:'HERE_GEOCODE'}),'Aproximado');
  assert.equal(ui.getRowStatus(1),'CONFIRMADO');
});
