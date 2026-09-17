export function Loading({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-muted">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent mr-3" />
      <span>{text}</span>
    </div>
  );
}

export function CardGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl overflow-hidden bg-card">
          <div className="aspect-[2/3] skeleton" />
          <div className="p-3">
            <div className="h-3 skeleton rounded mb-2" />
            <div className="h-3 skeleton rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}