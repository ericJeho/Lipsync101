'use client';

import {
  forwardRef,
  useId,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { motion } from 'framer-motion';
import { Check, Info } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  className,
  glow,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { glow?: boolean }) {
  return (
    <div
      className={cn(
        'glass rounded-panel p-5 transition-colors',
        glow && 'gradient-ring shadow-panel',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', className)}>
      {eyebrow && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
          {eyebrow}
        </p>
      )}
      <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {description && (
        <p className="mt-4 text-pretty text-base leading-relaxed text-ink-muted">{description}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-raised text-ink-muted border-line',
  brand: 'bg-brand/15 text-brand border-brand/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  dot,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        'text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export function Progress({
  value,
  className,
  label,
  indeterminate,
}: {
  value: number;
  className?: string;
  label?: string;
  indeterminate?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <motion.div
        className="h-full rounded-full gradient-brand"
        initial={{ width: 0 }}
        animate={{ width: indeterminate ? '40%' : `${clamped}%` }}
        transition={
          indeterminate
            ? { repeat: Infinity, repeatType: 'reverse', duration: 1.1 }
            : { type: 'spring', stiffness: 120, damping: 22 }
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slider                                                              */
/* ------------------------------------------------------------------ */

export function Slider({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
  disabled,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn('group', disabled && 'opacity-50')}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums text-ink-muted">
          {value}
          {suffix}
        </span>
      </div>

      <div className="relative">
        {/* The filled portion is a separate layer because a range input's
            track cannot be split into filled and unfilled halves. */}
        <div
          className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full gradient-brand"
          style={{ width: `${percent}%` }}
          aria-hidden
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="relative w-full"
        />
      </div>

      {hint && (
        <p
          id={`${id}-hint`}
          className="mt-2 text-xs leading-relaxed text-ink-subtle opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle                                                              */
/* ------------------------------------------------------------------ */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-3', disabled && 'opacity-50')}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'gradient-brand' : 'bg-line-strong',
        )}
      >
        <motion.span
          className="absolute top-0.5 size-4 rounded-full bg-white shadow"
          animate={{ left: checked ? 18 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-sm font-medium">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">
            {description}
          </span>
        )}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Checkbox card                                                       */
/* ------------------------------------------------------------------ */

export function CheckCard({
  checked,
  onChange,
  title,
  detail,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all',
        checked
          ? 'border-brand/50 bg-brand/10'
          : 'border-line bg-surface-raised/50 hover:border-line-strong',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
          checked ? 'border-brand gradient-brand' : 'border-line-strong',
        )}
      >
        {checked && <Check className="size-3 text-white" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {detail && (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">{detail}</span>
        )}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Input / Field                                                       */
/* ------------------------------------------------------------------ */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, icon, className, id: providedId, ...props },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          // Pointing at the message makes a screen reader announce the reason
          // the field was rejected, not just that it was.
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(
            'h-11 w-full rounded-xl border bg-surface-raised/60 px-3.5 text-sm',
            'placeholder:text-ink-subtle transition-colors',
            'focus:border-brand focus:bg-surface-raised focus:outline-none',
            icon && 'pl-10',
            error ? 'border-danger' : 'border-line',
            className,
          )}
          {...props}
        />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Empty state / Callout                                               */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-panel border border-dashed border-line px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-raised text-ink-subtle">
          {icon}
        </div>
      )}
      <p className="text-base font-medium">{title}</p>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Callout({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-xl border p-3.5 text-sm leading-relaxed',
        TONES[tone],
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="mb-1 font-medium">{title}</p>}
        <div className="text-ink-muted">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg', className)} aria-hidden />;
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
  wrap,
}: {
  tabs: { id: T; label: string; count?: number; icon?: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
  /** Wrap onto multiple rows instead of scrolling — for narrow side panels. */
  wrap?: boolean;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex gap-1 rounded-xl border border-line bg-surface-raised/50 p-1',
        wrap ? 'flex-wrap' : 'hide-scrollbar overflow-x-auto',
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2',
              'text-sm font-medium transition-colors',
              selected ? 'text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {selected && (
              // A shared layoutId makes the pill glide between tabs instead of
              // popping, which reads as one object moving rather than two.
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-lg bg-surface shadow-sm"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-line px-1.5 py-0.5 text-[10px] tabular-nums">
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
