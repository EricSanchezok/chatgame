import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/*": ["worlds/blackmarsh/world/**/*", "src/engine/prompts/**/*.md"],
  },
};

export default nextConfig;
