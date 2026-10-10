import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@xichu-risk/shared", "@xichu-risk/validators"],
};

export default nextConfig;
