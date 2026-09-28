import { motion, useReducedMotion } from 'motion/react';

type StampTone = 'plain' | 'outline' | 'dashed' | 'solid' | 'danger';
type StampSize = 'sm' | 'md' | 'lg';

const STATE_TONE: Record<string, StampTone> = {
  OPEN: 'plain',
  FINANCED: 'outline',
  PARTIAL: 'dashed',
  REALISED: 'solid',
  DISPUTED: 'danger',
  FAILED: 'danger',
  VALID: 'solid',
  INVALID: 'danger',
  CONFIRMED: 'solid',
  PENDING: 'plain',
};

const TONE_CLS: Record<StampTone, string> = {
  plain: 'border border-line text-muted',
  outline: 'border border-accent text-accent-text',
  dashed: 'border border-dashed border-accent text-accent-text',
  solid: 'border border-accent bg-accent text-accent-ink',
  danger: 'border border-danger text-danger',
};

const SIZE_CLS: Record<StampSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-[11px]',
  lg: 'px-4 py-1.5 text-base',
};

export function Stamp({
  state,
  tone,
  label,
  size = 'md',
}: {
  state?: string;
  tone?: StampTone;
  label?: string;
  size?: StampSize;
}) {
  const reduce = useReducedMotion();
  const resolvedTone = tone ?? STATE_TONE[state ?? ''] ?? 'plain';
  const text = label ?? state ?? '';
  const isRealised = state === 'REALISED';

  const initial = reduce
    ? { opacity: 0 }
    : isRealised
      ? { scale: 1.35, rotate: -6, opacity: 0 }
      : { opacity: 0, y: 4 };
  const animate = isRealised ? { scale: 1, rotate: -2, opacity: 1 } : { opacity: 1, y: 0, rotate: 0 };

  return (
    <motion.span
      key={text}
      initial={initial}
      animate={animate}
      transition={{ duration: isRealised ? 0.28 : 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className={`inline-flex items-center rounded-[var(--radius-stamp)] font-mono font-semibold uppercase tracking-wide ${SIZE_CLS[size]} ${TONE_CLS[resolvedTone]}`}
    >
      {text}
    </motion.span>
  );
}
