import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 独立验收目录避免 Windows 上正在运行的桌面服务锁住正式构建。
  distDir: process.env.YUNYUE_BUILD_DIR || '.next',
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  outputFileTracingExcludes: {
    '*': ['workspace/**', 'services/music-gateway/**'],
  },
};

export default nextConfig;
