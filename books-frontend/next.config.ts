import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Monorepo: pin the file-tracing root to the repo root so Next doesn't guess
  // it from a stray lockfile elsewhere.
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  // The heavy editor (Konva, jsPDF, html-to-image) is mounted client-only via
  // `next/dynamic({ ssr: false })`, so it never runs during SSR.
  eslint: { ignoreDuringBuilds: true },
  // Landing-page illustrations are served from public Firebase Storage download
  // URLs (see functions/src/storage.ts `publicMediaUrl`). Allow next/image to
  // optimize them in prod, and the Storage emulator host in local dev.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "http", hostname: "127.0.0.1" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
};

export default nextConfig;
