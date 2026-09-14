import { apiRequest } from "./api-client";
import { mapActivityItem, mapPortfolio } from "./portfolio-service";
import type {
  CopyPortfolioProposal,
  LeaderboardResponse,
  SocialTimeframe,
  TraderDetailResponse,
  UpdateTraderVisibilityRequest,
} from "@/types";

export function getLeaderboard(timeframe: SocialTimeframe = "30D", limit = 50) {
  return apiRequest<LeaderboardResponse>("/social/leaderboard", {
    query: { timeframe, limit },
  });
}

export function getTraderProfile(slug: string, timeframe: SocialTimeframe = "30D") {
  return apiRequest<ApiTraderDetailResponse>(`/social/traders/${slug}`, {
    query: { timeframe },
  }).then(mapTraderDetail);
}

export function prepareCopyPortfolio(input: {
  sourceSlug: string;
  wallet: string;
  amountUsd: number;
}) {
  return apiRequest<CopyPortfolioProposal>("/social/copy-portfolio/prepare", {
    method: "POST",
    body: input,
  });
}

export function updateTraderVisibility(wallet: string, input: UpdateTraderVisibilityRequest) {
  return apiRequest(`/social/profiles/${wallet}/visibility`, {
    method: "POST",
    body: input,
  });
}

export function buildVisibilityMessage(input: {
  walletAddress: string;
  isPublic: boolean;
  slug: string;
  displayName: string;
}) {
  return [
    "Oren social profile visibility",
    `Wallet: ${input.walletAddress}`,
    `Public: ${input.isPublic ? "true" : "false"}`,
    `Slug: ${input.slug}`,
    `Display name: ${input.displayName}`,
  ].join("\n");
}

export function normalizeTraderSlug(value: string, fallbackWallet?: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  if (normalized.length >= 3) return normalized;
  return fallbackWallet ? `trader-${fallbackWallet.slice(0, 8).toLowerCase()}` : normalized;
}

interface ApiTraderDetailResponse extends Omit<TraderDetailResponse, "portfolio" | "activity"> {
  portfolio: Parameters<typeof mapPortfolio>[0];
  activity: {
    walletAddress: string;
    items: Parameters<typeof mapActivityItem>[0][];
  };
}

function mapTraderDetail(detail: ApiTraderDetailResponse): TraderDetailResponse {
  return {
    ...detail,
    portfolio: mapPortfolio(detail.portfolio),
    activity: {
      walletAddress: detail.activity.walletAddress,
      items: detail.activity.items.map(mapActivityItem),
    },
  };
}
