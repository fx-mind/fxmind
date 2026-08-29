import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-balance">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className = "",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`flex flex-col items-center px-6 py-12 text-center ${className}`}>
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-[var(--color-muted)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "warn" | "danger" | "learned";
}) {
  const tones = {
    default: "bg-white/5 text-[var(--color-muted)]",
    accent: "bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
    warn: "bg-[var(--color-warn)]/15 text-[var(--color-warn)]",
    danger: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
    learned: "bg-[var(--color-learned)]/15 text-[var(--color-learned)]",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
