import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["next-auth", "@auth/prisma-adapter"],
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
