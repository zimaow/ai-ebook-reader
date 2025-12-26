import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/ai-ebook-reader',
  assetPrefix: '/ai-ebook-reader',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
