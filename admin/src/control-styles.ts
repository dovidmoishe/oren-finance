const control =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 pointer-coarse:h-11";

export const button = `${control} border border-border bg-surface text-foreground shadow-xs hover:bg-panel`;
export const primaryButton = `${control} bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover`;
export const dangerButton = `${control} bg-danger text-danger-foreground hover:bg-danger-hover`;
export const quietButton = `${control} text-muted hover:bg-panel hover:text-foreground`;
export const iconButton =
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel hover:text-foreground disabled:cursor-default disabled:opacity-50";
export const field =
  "h-9 max-w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground shadow-xs disabled:opacity-60 pointer-coarse:h-11";
export const metricGrid = "grid grid-cols-2 gap-4 mobile:gap-3 xl:grid-cols-4";
export const card =
  "min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-card";
export const tableScroll =
  "w-full overflow-x-auto px-3 pb-2 [&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:text-left [&_table]:text-[13px] [&_th]:h-10 [&_th]:bg-panel [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-muted [&_th:first-child]:rounded-l-lg [&_th:last-child]:rounded-r-lg [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-3.5 [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:hover_td]:bg-panel/60 [&_tbody_tr:focus-within_td]:bg-panel/60";
export const notice =
  "flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed shadow-card [&_svg]:mt-0.5 [&_svg]:shrink-0 [&_svg]:text-muted [&_p]:text-muted";
/** A message inside a card, form or dialog. */
export const inlineNotice =
  "flex items-start gap-3 rounded-lg bg-panel px-3.5 py-3 text-xs leading-relaxed [&_svg]:mt-0.5 [&_svg]:shrink-0 [&_p]:text-muted";
export const panelNote =
  "mt-auto border-t border-border px-5 py-3.5 text-xs leading-relaxed text-muted";
