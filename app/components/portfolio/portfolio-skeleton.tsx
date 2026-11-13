import { T } from "@/i18n/t";

export function PortfolioSkeleton() {
  return (
    <div className="space-y-5" role="status">
      <span className="sr-only"><T k="common.loading" /></span>
      <div aria-hidden="true" className="rounded-2xl border border-border bg-panel p-4 sm:p-5">
        <div className="animate-pulse motion-reduce:animate-none">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2.5">
              <div className="h-3 w-20 rounded bg-panel-subtle" />
              <div className="h-8 w-36 rounded bg-panel-subtle" />
              <div className="h-3 w-14 rounded bg-panel-subtle" />
            </div>
            <div className="h-9 w-24 rounded-full bg-panel-subtle" />
          </div>
          <div className="mt-7 h-2 w-full rounded-full bg-panel-subtle" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div className="h-7 rounded bg-panel-subtle" key={item} />)}
          </div>
          <div className="mt-6 h-10 border-t border-border" />
        </div>
      </div>
      <div aria-hidden="true" className="space-y-2 animate-pulse motion-reduce:animate-none">
        <div className="mb-3 h-5 w-40 rounded bg-panel-subtle" />
        {[0, 1, 2, 3].map((item) => <div className="h-10 rounded-lg bg-panel-subtle" key={item} />)}
      </div>
    </div>
  );
}
