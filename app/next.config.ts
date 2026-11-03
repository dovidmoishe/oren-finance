import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/changelog": ["./content/changelog/*.json"],
    "/changelog/*": ["./content/changelog/*.json"],
  },
  async redirects() {
    return [
      { source: "/activity", destination: "/app/activity", permanent: false },
      { source: "/calendar", destination: "/app/calendar", permanent: false },
      { source: "/deposit", destination: "/app/deposit", permanent: false },
      { source: "/leaderboard/:path*", destination: "/app/leaderboard/:path*", permanent: false },
      { source: "/markets", destination: "/app/markets", permanent: false },
      { source: "/overview", destination: "/app/overview", permanent: false },
      { source: "/portfolio", destination: "/app/portfolio", permanent: false },
      { source: "/stocks/:path*", destination: "/app/stocks/:path*", permanent: false },
      { source: "/vault", destination: "/app/vault", permanent: false },
      { source: "/venues", destination: "/app/venues", permanent: false },
      { source: "/changelog/send-cash-and-stocks", destination: "/changelog/transfer-stablecoins-and-stocks", permanent: true },
    ];
  },
};

export default nextConfig;
