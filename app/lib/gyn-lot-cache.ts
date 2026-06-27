type GynLotRouteCache = {
  geo?: unknown;
  tree?: unknown;
  filePath?: string;
  missing?: boolean;
};

export type GynLotCacheState = {
  cached: GynLotRouteCache;
  gynLotCache: Map<string, any>;
};

export const gynLotCacheState: GynLotCacheState = {
  cached: {},
  gynLotCache: new Map<string, any>(),
};

export function getGynLotCacheSnapshot(state: GynLotCacheState = gynLotCacheState) {
  return {
    geoLoaded: !!state.cached.geo,
    treeLoaded: !!state.cached.tree,
    gynLotCacheSize: state.gynLotCache.size,
  };
}
