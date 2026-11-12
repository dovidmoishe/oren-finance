// Fills the app shell's content area while the next page loads. The header
// lives in the layout and must not be drawn again here. Keep this free of
// client components so it can paint before their JavaScript arrives.
function Block({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-[20px] bg-panel-subtle ${className}`} />;
}

export default function AppLoading() {
  return (
    <div className="mx-auto max-w-[1540px] pb-20" role="status">
      <span className="sr-only">Loading Oren…</span>
      <Block className="h-[min(560px,70vh)] w-full rounded-[24px]" />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Block className="h-56" />
        <Block className="h-56" />
      </div>
    </div>
  );
}
