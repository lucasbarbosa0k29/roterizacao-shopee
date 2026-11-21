// Loads private process functions without adding exports to a Next.js route.
// Run only in an isolated test process. No .env file is loaded and all I/O to
// providers/Prisma is intercepted. Provider fixtures stay outside the repo.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function createOfflineProcess({ root = process.cwd(), overlay = null } = {}) {
  const ts = require(path.join(root, 'node_modules/typescript'));
  const cache = new Map();
  let fixture = {};
  let calls = [];
  const noop = async () => {};
  const prisma = {
    user: { findUnique: async () => ({ id: 'offline', role: 'ADMIN' }) },
    importJob: { create: async () => ({ id: 'offline' }) },
    addressMemory: {
    findUnique: async () => fixture.memory || null,
    findMany: async () => [],
    update: async () => ({}),
    upsert: async () => { throw new Error('Unexpected memory write'); },
  }};
  const mocks = {
    '@/app/lib/prisma': { prisma },
    '@/app/lib/admin-observability': { incrementDailyMetric: noop, incrementHereMetric: noop },
    '@/app/lib/job-storage': {},
    '@/app/lib/auth': {},
    '@/app/lib/access-control': { getUserAccessSnapshot: async () => ({ canStartRoute: true }) },
    '@/app/lib/import-job-cleanup': { cleanupOldImportJobsIfNeeded: noop },
    '@prisma/client': {},
    'next-auth': { getServerSession: async () => ({ user: { id: 'offline' } }) },
    'next/server': { NextResponse: Response },
  };
  function sourceFile(relative) {
    const candidate = overlay && path.join(overlay, relative);
    return candidate && fs.existsSync(candidate) ? candidate : path.join(root, relative);
  }
  function overlayFile(file) {
    if (typeof file !== 'string' || !overlay) return file;
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return file;
    const alternate = path.join(overlay, relative);
    return fs.existsSync(alternate) ? alternate : file;
  }
  function readModule(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const file = path.join(root, relative);
    let src = fs.readFileSync(sourceFile(relative), 'utf8');
    if (relative === 'app/api/process/route.ts') {
      src += '\nmodule.exports.audit = { processOne, createHereJobMetrics, normalizeQLValue, mergeAparecidaLotValue, pickAparecidaPartialStreetCandidate, scoreAparecidaRerankCandidate, buildMemoryKeyCandidates };';
    }
    const mod = new Module(file, module);
    cache.set(relative, mod);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    const realRequire = Module.createRequire(file);
    mod.require = (id) => {
      if (id === 'fs' || id === 'node:fs') return { ...fs,
        readFileSync: (file, ...options) => fs.readFileSync(overlayFile(file), ...options),
        existsSync: file => fs.existsSync(overlayFile(file)),
        openSync: (file, ...options) => fs.openSync(overlayFile(file), ...options),
      };
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('@/')) return readModule(id.slice(2) + (path.extname(id) ? '' : '.ts'));
      if (id.startsWith('.')) {
        const target = path.relative(root, path.resolve(path.dirname(file), id));
        const relativeTarget = target.replaceAll('\\', '/');
        if (fs.existsSync(sourceFile(relativeTarget + '.ts'))) return readModule(relativeTarget + '.ts');
      }
      return realRequire(id);
    };
    mod._compile(ts.transpileModule(src, { fileName: file, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    }}).outputText, file);
    return mod.exports;
  }
  const memory = readModule('app/lib/address-memory-approx.ts');
  mocks['@/app/lib/address-memory-approx'] = {
    ...memory,
    tryApproximateMemoryMatch: async () => fixture.approx || { matched: false },
    tryApproximateMemoryTextHint: async () => ({ matched: false }),
  };
  const budget = readModule('app/lib/here-discover-budget.ts');
  mocks['@/app/lib/here-discover-budget'] = {
    ...budget,
    getDiscoverBudgetDecision: async () => ({ allowed: true, reason: 'OFFLINE', count: 0, projected: 0 }),
    reserveDiscoverUsage: async () => ({ allowed: true, reason: 'OFFLINE', count: 0, projected: 0 }),
  };
  // These exist only inside the child test process. No local env file is read.
  process.env.GEMINI_API_KEY = 'offline-fixture';
  process.env.HERE_API_KEY = 'offline-fixture';
  delete process.env.GEMINI_MODEL;
  const api = readModule('app/api/process/route.ts').audit;
  const lots = readModule('app/lib/aparecida-local-lots.ts');
  const offlineFetch = async (url, options) => {
    const u = new URL(url);
    if (u.hostname === 'audit.invalid' && u.pathname === '/api/aparecida/lot') {
      return Response.json(lots.lookupAparecidaLotByCoordinates(Number(u.searchParams.get('lat')), Number(u.searchParams.get('lng'))));
    }
    const endpoint = u.hostname === 'generativelanguage.googleapis.com' ? 'gemini'
      : u.hostname === 'geocode.search.hereapi.com' ? 'geocode'
      : u.hostname === 'discover.search.hereapi.com' ? 'discover' : null;
    if (!endpoint) throw new Error('External request blocked: ' + u.hostname);
    const q = u.searchParams.get('q') || '';
    calls.push({ endpoint, q });
    if (endpoint === 'gemini') return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(fixture.gemini || {}) }] } }] });
    const queryKey = (text) => text.replace(/\b0+(\d+)\b/g, '$1').replace(/\s+/g, ' ').trim();
    const items = (fixture.here || []).filter(x => x.endpoint === endpoint && queryKey(x.query) === queryKey(q)).map(x => x.item);
    return Response.json({ items });
  };
  return {
    api, lots, readModule,
    async runBatch(rows, concurrency, onRow) {
      globalThis.fetch = offlineFetch;
      fixture = {};
      calls = [];
      let next = 0;
      const results = new Array(rows.length);
      const runState = {
        jobId: 'offline', userId: 'offline', userEmail: null, spreadsheetName: null,
        geminiNormalizeCache: new Map(), hereJobCache: new Map(),
        hereJobMetrics: api.createHereJobMetrics(), goianiaPoiShadowAudits: [],
      };
      async function worker() {
        while (next < rows.length) {
          const index = next++;
          results[index] = await api.processOne(rows[index], 'https://audit.invalid', false, runState);
          onRow();
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker));
      return results;
    },
    async run(row, nextFixture = {}, debugMemory = false) {
      globalThis.fetch = offlineFetch;
      fixture = nextFixture;
      calls = [];
      const result = await api.processOne(row, 'https://audit.invalid', debugMemory);
      return { result, calls: [...calls] };
    },
  };
}

module.exports = { createOfflineProcess };
