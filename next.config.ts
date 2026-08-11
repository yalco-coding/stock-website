import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Keep the standard Node.js server output for Lightsail. */
  agentRules: false,
};

export default nextConfig;
