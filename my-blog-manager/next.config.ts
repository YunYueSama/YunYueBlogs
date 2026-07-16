import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  outputFileTracingExcludes: {
    '*': ['workspace/**'],
  },
};

export default nextConfig;
