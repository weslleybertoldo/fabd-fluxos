export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-4 w-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-8 w-72 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="flex gap-3 overflow-x-auto">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
