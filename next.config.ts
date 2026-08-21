import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop preview opens localhost apps through the loopback IP. Next's
  // development origin guard otherwise serves the HTML while rejecting the
  // client chunks, leaving an apparently loaded but non-interactive shell.
  allowedDevOrigins: ["127.0.0.1"],
  // Script engine code is compiled with esbuild at runtime (route handlers
  // / CLI); keep esbuild out of the server bundle so dynamic compilation
  // works in production builds too.
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
