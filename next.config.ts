import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Script engine code is compiled with esbuild at runtime (route handlers
  // / CLI); keep esbuild out of the server bundle so dynamic compilation
  // works in production builds too.
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
