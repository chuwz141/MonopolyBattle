"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Cpu,
  Users,
  Briefcase,
  BarChart2,
  Zap,
  Shield,
} from "lucide-react";
import type { Decision } from "@monopoly/shared";
import { cn } from "@/lib/utils";
import { vi } from "@/i18n/vi";
import { formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionCardProps {
  decision: Decision;
  index: number;
  isSelected: boolean;
  isDisabled: boolean;
  isFocused: boolean;
  onSelect: (decisionType: string) => void;
  onFocus: (index: number) => void;
}

interface EffectRowProps {
  label: string;
  value: number;
  icon: React.ReactNode;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maps a decision type prefix to a Lucide icon. Falls back to Briefcase. */
const DECISION_ICONS: Record<string, React.ReactNode> = {
  invest_tech: <Cpu className="w-5 h-5" />,
  acquire: <Users className="w-5 h-5" />,
  merge: <BarChart2 className="w-5 h-5" />,
  lobby: <Shield className="w-5 h-5" />,
  expand: <Zap className="w-5 h-5" />,
};

function resolveIcon(type: string): React.ReactNode {
  const key = Object.keys(DECISION_ICONS).find((k) => type.startsWith(k));
  return key !== undefined ? DECISION_ICONS[key] : <Briefcase className="w-5 h-5" />;
}

const CARD_VARIANTS = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.07,
      duration: 0.35,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  }),
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function EffectRow({ label, value, icon }: EffectRowProps): React.JSX.Element {
  const isPositive = value > 0;
  const isNegative = value < 0;

  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="opacity-60">{icon}</span>
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "flex items-center gap-0.5 font-semibold",
          isPositive && "text-emerald-400",
          isNegative && "text-destructive",
          !isPositive && !isNegative && "text-muted-foreground"
        )}
      >
        {isPositive ? (
          <TrendingUp className="w-3 h-3" />
        ) : isNegative ? (
          <TrendingDown className="w-3 h-3" />
        ) : (
          <Minus className="w-3 h-3" />
        )}
        <span>
          {isPositive
            ? `+${value}`
            : isNegative
            ? `${value}`
            : vi.decision.effectNeutral}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

/**
 * DecisionCard
 *
 * Displays a single business decision option.
 * Keyboard-accessible: pressing Enter/Space on a focused card triggers selection.
 * Disabled when the panel is locked (after submission or timer expiry).
 */
export function DecisionCard({
  decision,
  index,
  isSelected,
  isDisabled,
  isFocused,
  onSelect,
  onFocus,
}: DecisionCardProps): React.JSX.Element {
  const prefersReduced = useReducedMotion();
  const cardRef = React.useRef<HTMLDivElement>(null);

  // Scroll focused card into view on keyboard navigation.
  React.useEffect(() => {
    if (isFocused) {
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFocused]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isDisabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(decision.type);
    }
  };

  const handleClick = (): void => {
    if (!isDisabled) onSelect(decision.type);
  };

  return (
    <motion.div
      ref={cardRef}
      custom={index}
      variants={prefersReduced ? {} : CARD_VARIANTS}
      initial="hidden"
      animate="visible"
      whileHover={isDisabled || prefersReduced ? {} : { y: -4, scale: 1.02 }}
      whileTap={isDisabled || prefersReduced ? {} : { scale: 0.98 }}
      transition={{ duration: 0.15 }}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-pressed={isSelected}
      aria-disabled={isDisabled}
      aria-label={decision.nameVi}
      onFocus={() => onFocus(index)}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border p-4 cursor-pointer",
        "outline-none transition-all duration-200",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        // Base
        "bg-card/60 border-border backdrop-blur-sm",
        // Selected state
        isSelected && [
          "border-primary bg-primary/10 shadow-[0_0_0_2px_hsl(var(--primary)/0.3)]",
        ],
        // Focused (keyboard) state
        isFocused && !isSelected && "border-accent/60 bg-accent/5",
        // Disabled
        isDisabled && "opacity-50 cursor-not-allowed pointer-events-none",
        // Hover (non-disabled)
        !isDisabled && !isSelected && "hover:border-primary/40 hover:bg-card/80 hover:shadow-md"
      )}
    >
      {/* Selected badge */}
      {isSelected && (
        <div className="absolute top-2.5 right-2.5">
          <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5">
            {vi.decision.selectedLabel}
          </Badge>
        </div>
      )}

      {/* Header: icon + title */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex-shrink-0 p-2 rounded-lg transition-colors duration-200",
            isSelected
              ? "bg-primary/20 text-primary"
              : "bg-secondary text-muted-foreground group-hover:text-foreground group-hover:bg-secondary/80"
          )}
        >
          {resolveIcon(decision.type)}
        </div>
        <div className="flex-1 min-w-0 pr-6">
          <h3 className="text-sm font-semibold text-foreground leading-tight truncate">
            {decision.nameVi}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
            {decision.descriptionVi}
          </p>
        </div>
      </div>

      {/* Cost */}
      <div className="flex items-center justify-between border-t border-border/50 pt-2.5">
        <span className="text-[11px] text-muted-foreground font-medium">
          {vi.decision.cost}
        </span>
        <span className="text-sm font-bold text-destructive">
          {formatMoney(decision.cost)}
        </span>
      </div>

      {/* Expected effects */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
          {vi.decision.effects}
        </p>
        <EffectRow
          label={vi.stats.marketShare}
          value={decision.effects.marketShare}
          icon={<BarChart2 className="w-3 h-3" />}
        />
        <EffectRow
          label={vi.stats.technology}
          value={decision.effects.technology}
          icon={<Cpu className="w-3 h-3" />}
        />
        <EffectRow
          label={vi.stats.reputation}
          value={decision.effects.reputation}
          icon={<Shield className="w-3 h-3" />}
        />
        {decision.effects.monopolyRisk !== 0 && (
          <EffectRow
            label={vi.stats.monopolyRisk}
            value={decision.effects.monopolyRisk}
            icon={<Zap className="w-3 h-3" />}
          />
        )}
      </div>
    </motion.div>
  );
}
