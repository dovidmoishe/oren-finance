"use client";

import { X as XIcon, Search as SearchIcon } from "lucide-react";

import Link from "next/link";
import { useEffect, useState, type RefObject } from "react";
import { useT } from "@/i18n/i18n";
import { searchStocks } from "@/services/market-service";
import type { StockSummary } from "@/types";

export function AppSearch({ dialog }: { dialog: RefObject<HTMLDialogElement | null> }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; stocks: StockSummary[]; failed?: boolean }>();
  const term = query.trim();
  const current = result?.query === term ? result : undefined;

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.key !== "/" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
        || document.querySelector("dialog[open], :popover-open")
        || (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea, select, button, a")))) return;
      event.preventDefault();
      dialog.current?.showModal();
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [dialog]);

  useEffect(() => {
    if (!term) return;
    const request = new AbortController();
    const timer = window.setTimeout(() => {
      void searchStocks(term, request.signal)
        .then((stocks) => {
          if (!request.signal.aborted) setResult({ query: term, stocks: stocks.slice(0, 8) });
        })
        .catch(() => {
          if (!request.signal.aborted) setResult({ query: term, stocks: [], failed: true });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      request.abort();
    };
  }, [term]);

  return (
    <dialog
      aria-label={t("markets.searchLabel")}
      className="mx-auto mt-[min(12dvh,6rem)] max-h-[76dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-panel p-0 text-foreground shadow-xl backdrop:bg-black/25"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
      }}
      onClose={() => { setQuery(""); setResult(undefined); }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.close();
      }}
      ref={dialog}
    >
      <div className="flex items-center gap-2.5 p-3 sm:px-4">
        <SearchIcon aria-hidden="true" className="shrink-0 text-muted" size={19} strokeWidth={1.7} />
        <input
          aria-label={t("markets.searchLabel")}
          className="h-10 min-w-0 flex-1 rounded-md px-1 text-base placeholder:text-muted focus-visible:outline-2 focus-visible:outline-focus"
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("markets.searchPlaceholder")}
          type="search"
          value={query}
        />
        <button aria-label={t("common.close")} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-focus" onClick={() => dialog.current?.close()} type="button">
          <XIcon aria-hidden="true" size={17} strokeWidth={1.7} />
        </button>
      </div>
      {term && (
        <div className="border-t border-border p-2">
          {current?.stocks.length ? (
            <ul>
              {current.stocks.map((stock) => (
                <li key={stock.assetId}>
                  <Link className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-panel-subtle focus-visible:outline-2 focus-visible:outline-focus" href={"/app/stocks/" + encodeURIComponent(stock.assetId)} onClick={() => dialog.current?.close()}>
                    <span className="min-w-14 text-sm font-semibold">{stock.ticker}</span>
                    <span className="truncate text-sm text-muted">{stock.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-muted" role="status">
              {!current ? t("markets.searching") : current.failed ? t("markets.unavailable") : t("markets.noResults", { query: term })}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}
