'use client';

import type { RefObject } from 'react';
import { ArrowUp as ArrowUpIcon, CircleStop as CircleStopIcon } from "lucide-react";

import { Button } from '@/components/ui';
import { useT } from "@/i18n/i18n";

export function resizeAgentComposer(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto';
  const maxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight) || 112;
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
}

export function AgentComposerView({
  placeholder,
  connected,
  isSending,
  composer,
  composerRef,
  onComposerChange,
  onSubmit,
  onStop,
}: {
  placeholder: string;
  connected: boolean;
  isSending: boolean;
  composer: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onComposerChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const t = useT();
  return (
    <footer className="min-w-0 shrink-0 border-t border-border bg-panel px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-end gap-2 rounded-2xl border border-border-strong bg-panel-subtle p-1.5 focus-within:border-foreground">
        <textarea
          aria-label={t("agent.ask")}
          className="block max-h-28 min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-2 [overflow-wrap:anywhere]"
          disabled={!connected || isSending}
          maxLength={4000}
          onChange={(event) => onComposerChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          ref={composerRef}
          rows={1}
          value={composer}
        />
        {isSending ? (
          <Button
            aria-label={t("agent.stop")}
            className="size-9 shrink-0 rounded-xl pointer-coarse:size-11"
            onClick={onStop}
            size="icon"
            variant="secondary"
          >
            <CircleStopIcon color="currentColor" size={16} strokeWidth={1.8} />
          </Button>
        ) : (
          <Button
            aria-label={t("agent.send")}
            className="size-9 shrink-0 rounded-xl pointer-coarse:size-11"
            disabled={!connected || !composer.trim()}
            onClick={() => onSubmit()}
            size="icon"
            variant="primary"
          >
            <ArrowUpIcon color="currentColor" size={16} strokeWidth={1.8} />
          </Button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[10px] leading-4 text-muted">{t("agent.proposes")}</p>
    </footer>
  );
}
