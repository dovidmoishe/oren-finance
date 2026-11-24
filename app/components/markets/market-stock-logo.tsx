"use client";

import { useState } from "react";
import { useT } from "@/i18n/i18n";
import type { StockSummary } from "@/types";

export function MarketStockLogo({ stock }: { stock: StockSummary }) {
  const t = useT();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const logoUrl = stock.logoUrl;

  if (logoUrl && logoUrl !== failedUrl) {
    const src = logoUrl.startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${logoUrl.slice("ipfs://".length)}`
      : logoUrl.startsWith("//") ? `https:${logoUrl}` : logoUrl;

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={t("markets.logoAlt", { name: stock.name })}
        className="size-8 shrink-0 rounded-full object-contain"
        width={32}
        height={32}
        loading="lazy"
        onError={() => setFailedUrl(logoUrl)}
        src={src}
      />
    );
  }

  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel-subtle text-[10px] font-semibold">
      {stock.ticker.slice(0, 2)}
    </span>
  );
}
