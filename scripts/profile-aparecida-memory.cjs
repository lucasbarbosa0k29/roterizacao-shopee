// Offline only. Usage: node --expose-gc --max-old-space-size=384 scripts/profile-aparecida-memory.cjs file.xlsx 1,1,5
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { createOfflineProcess } = require('../tests/helpers/process-offline.cjs');
const [file, schedule = '1,1,5', jobsArg = '1'] = process.argv.slice(2);
const jobs = Number(jobsArg);
if (![1, 2].includes(jobs)) throw Error('Expected one or two simultaneous imports');
const workers = schedule.split(',').map(Number);
if (!file || workers.some(n => !Number.isInteger(n) || n < 1 || n > 5)) throw Error('Expected a workbook and 1–5 workers');
process.env.MEMORY_DIAGNOSTICS = 'true';
const report = data => process.stdout.write(JSON.stringify(data) + '\n');
let peakHeap = 0;
function sample() {
  const { rss, heapUsed } = process.memoryUsage();
  const heap = Math.round(heapUsed / 1048576);
  peakHeap = Math.max(peakHeap, heap);
  return { heap, rss: Math.round(rss / 1048576), peakHeap, peakRSS: Math.round(process.resourceUsage().maxRSS / 1024) };
}
// Forward only the memory counters and known cache load stages. Provider requests and row data stay private.
console.info = (tag, entry) => {
  if (tag === '[MEMORY_DIAGNOSTICS]' && /^(aparecida:|CACHE_LOAD|CACHE_RELOADED)/.test(entry?.label)) {
    report({ stage: entry.label, layer: entry.cacheName, ...sample() });
  }
};
console.warn = console.error = console.log = () => {};
(async () => {
  const offline = createOfflineProcess({ overlay: process.env.ROTTA_TEST_OVERLAY });
  const importer = offline.readModule('app/api/import/route.ts');
  const interval = setInterval(sample, 20);
  interval.unref();
  async function importAndProcess(concurrency, job) {
    report({ stage: 'before-import', concurrency, job, ...sample() });
    const form = new FormData();
    form.append('file', new File([fs.readFileSync(file)], 'offline.xlsx'));
    const response = await importer.POST({ formData: async () => form });
    if (!response.ok) throw Error('Offline import failed: ' + response.status);
    const { rows } = await response.json();
    report({ stage: 'after-import', job, rows: rows.length, ...sample() });
    const results = await offline.runBatch(rows, concurrency, sample);
    const counts = {}, decisions = [];
    for (const r of results) {
      const key = [r.status, r.source || 'NONE', Number.isFinite(r.lat) && Number.isFinite(r.lng)].join('/');
      counts[key] = (counts[key] || 0) + 1;
      decisions.push(createHash('sha256').update(JSON.stringify([r.status,r.source,r.decisionReason,r.lat,r.lng])).digest('hex'));
    }
    report({ stage: 'processed', concurrency, job, counts, decisions, ...sample() });
  }
  for (const concurrency of workers) {
    global.gc?.();
    await Promise.all(Array.from({ length: jobs }, (_, i) => importAndProcess(concurrency, i + 1)));
  }
  global.gc?.();
  report({ stage: 'finished', ...sample() });
})().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });
