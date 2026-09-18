export function RailSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="container-x mt-10">
      <div className="skeleton mb-3 h-6 w-44" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="w-36 shrink-0 sm:w-40 md:w-44">
            <div className="skeleton aspect-[2/3]" />
            <div className="skeleton mt-2 h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="container-x grid grid-cols-2 gap-4 py-8 sm:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="skeleton aspect-[2/3]" />
          <div className="skeleton mt-2 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}