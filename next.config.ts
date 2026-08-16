import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon; Next must leave it to Node's own resolver
  // rather than trying to bundle it into the server build.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
