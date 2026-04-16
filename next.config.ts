import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@arcgis/core"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals ?? [];
      config.externals.push(/^@arcgis\/core(\/.*)?$/);
    }

    return config;
  },
};

export default nextConfig;
