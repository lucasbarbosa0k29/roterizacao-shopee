import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { checkShopeeGpsAssets } from "./scripts/check-shopee-gps-assets";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@arcgis/core"],
  outputFileTracingIncludes: {
    "/api/process": [
      "./app/data/goiania_local_first_by_bairro_v4/**/*.json",
      "./data/localfirst/aparecida/*.json",
      "./public/data/hidrolandia/hidrolandia_{setores,ruas,lotes}_mapa.web4326.geojson",
      "./public/data/aparecida_lotes.min.geojson",
      "./public/data/aparecida_lot_centroids*.json",
      "./data/localfirst/shopee-gps-territory/*",
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals ?? [];
      config.externals.push(/^@arcgis\/core(\/.*)?$/);
    }

    return config;
  },
};

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) checkShopeeGpsAssets();
  return nextConfig;
}
