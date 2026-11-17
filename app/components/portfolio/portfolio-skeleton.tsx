import { T } from "@/i18n/t";

export function PortfolioSkeleton() {
  return (
    <div className="space-y-5" role="status">
      <span className="sr-only"><T k="common.loading" /></span>
      <div aria-hidden="true" className="rounded-[20px] border border-accent-lavender/45 bg-linear-to-br from-panel to-accent-lavender/30 p-5 @lg:px-8 @lg:py-8">
        <div className="animate-pulse motion-reduce:animate-none">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2.5">
              <div className="h-3 w-20 rounded bg-border/60" />
              <div className="mt-3 h-14 w-48 rounded bg-panel-subtle" />
              <div className="h-3 w-14 rounded bg-panel-subtle" />
            </div>
            <div className="h-9 w-24 rounded-full bg-panel-subtle" />
          </div>

        </div>
      </div>
      <div aria-hidden="true" className="space-y-2 animate-pulse motion-reduce:animate-none">
        <div className="mb-3 h-5 w-40 rounded bg-panel-subtle" />
        {[0, 1, 2, 3].map((item) => <div className="h-16 rounded-lg bg-panel-subtle" key={item} />)}
      </div>
    </div>
  );
}
