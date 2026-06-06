import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@arcgis/core"],
  outputFileTracingIncludes: {
    "/api/process": ["./app/data/goiania_local_first_by_bairro_v4/**/*.json"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals ?? [];
      config.externals.push(/^@arcgis\/core(\/.*)?$/);
    }

    return config;
  },
};

export default nextConfig;
