export function Badge({
  children,
  variant = 'default',
  active = false,
  onClick,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'violet' | 'cyan';
  active?: boolean;
  onClick?: () => void;
}) {
  const base = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border transition';
  const variants = {
    default: active
      ? 'bg-white/10 border-accent text-white'
      : 'bg-white/5 border-border text-gray-300 hover:border-accent',
    violet: 'bg-violet-500/20 border-violet-500/30 text-violet-200',
    cyan: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-200',
  };
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag className={`${base} ${variants[variant]}`} onClick={onClick}>
      {children}
    </Tag>
  );
}