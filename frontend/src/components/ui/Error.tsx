export function Error({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 my-4">
      <div className="text-red-300 font-medium mb-2">Something went wrong</div>
      <div className="text-red-400/80 text-sm">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg text-sm transition"
        >
          Try again
        </button>
      )}
    </div>
  );
}