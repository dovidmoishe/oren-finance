const control =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap disabled:cursor-default disabled:opacity-50";

export const button = `${control} border border-border bg-surface hover:bg-panel`;
export const primaryButton = `${control} bg-primary text-primary-foreground hover:bg-primary-hover`;
export const dangerButton = `${control} bg-danger text-danger-foreground hover:bg-danger-hover`;
export const quietButton = `${control} text-muted hover:bg-panel hover:text-foreground`;
export const iconButton =
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-current/10 disabled:opacity-50";
export const field =
  "min-h-9 max-w-full rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs text-foreground disabled:opacity-60";
export const metricGrid = "mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4";
export const tableScroll =
  "w-full overflow-x-auto [&_table]:w-full [&_table]:text-left [&_table]:text-xs [&_th]:bg-panel [&_th]:font-medium [&_th]:text-muted [&_th]:px-4 [&_th]:py-2.5 [&_td]:border-t [&_td]:border-border [&_td]:px-4 [&_td]:py-3 [&_tbody_tr:hover]:bg-panel [&_tbody_tr:focus-within]:bg-panel";
export const notice =
  "my-3 flex items-start gap-3 rounded-md border border-border bg-panel px-4 py-3 text-xs leading-relaxed [&_svg]:shrink-0 [&_p]:text-muted";
export const panelNote =
  "border-t border-border bg-panel px-5 py-3 text-xs leading-relaxed text-muted";
