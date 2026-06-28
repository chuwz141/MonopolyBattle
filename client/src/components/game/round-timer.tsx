"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/utils";
import { vi } from "@/i18n/vi";
import { useGameStore } from "@/stores/game.store";
import { Progress } from "@/components/ui/progress";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoundTimerProps {
  /** Total seconds at the start of the round (for progress bar baseline). */
  totalSeconds: number;
  /** Called once when the timer reaches 0. */
  onExpire: () => void;
  className?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WARNING_THRESHOLD = 10;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * RoundTimer
 *
 * Reads `roundTimeLeft` from the game store (server is source of truth).
 * The server emits `round:tick` every 5 s; the client does NOT drive a local
 * countdown — it only displays the value it receives.
 *
 * - Green progress bar → normal
 * - Red / pulsing → last 10 seconds
 * - Calls `onExpire` once when `roundTimeLeft` reaches 0 during the decision phase.
 */
export function RoundTimer({ totalSeconds, onExpire, className }: RoundTimerProps): React.JSX.Element {
  const timeLeft = useGameStore((s) => s.roundTimeLeft);
  const phase = useGameStore((s) => s.phase);
  const prefersReduced = useReducedMotion();

  const hasExpired = timeLeft <= 0;
  const isWarning = timeLeft <= WARNING_THRESHOLD && !hasExpired;
  const isDecisionPhase = phase === "decision";

  // Fire onExpire once when time reaches 0 in decision phase.
  const expiredRef = React.useRef(false);
  React.useEffect(() => {
    if (isDecisionPhase && hasExpired && !expiredRef.current) {
      expiredRef.current = true;
      onExpire();
    }
    // Reset flag when a new round starts (timeLeft goes back up).
    if (!hasExpired) {
      expiredRef.current = false;
    }
  }, [hasExpired, isDecisionPhase, onExpire]);

  const progressValue = Math.max(0, Math.min(timeLeft, totalSeconds));
  const progressPercent = totalSeconds > 0 ? (progressValue / totalSeconds) * 100 : 0;

  const indicatorColor = hasExpired
    ? "bg-muted"
    : isWarning
    ? "bg-destructive"
    : "bg-primary";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 select-none",
        className
      )}
      role="timer"
      aria-live="polite"
      aria-label={vi.decision.timer.label}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs font-medium tracking-wide">
            {vi.decision.timer.label}
          </span>
        </div>

        {/* Countdown number */}
        <div className="flex items-center gap-1.5">
          <AnimatePresence mode="wait">
            {isWarning && !hasExpired && (
              <motion.div
                key="warning-icon"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={
                  prefersReduced
                    ? { opacity: 1, scale: 1 }
                    : {
                        opacity: [1, 0.4, 1],
                        scale: [1, 1.1, 1],
                      }
                }
                exit={{ opacity: 0, scale: 0.6 }}
                transition={
                  prefersReduced
                    ? { duration: 0.15 }
                    : { duration: 0.8, repeat: Infinity }
                }
              >
                <AlertTriangle className="w-4 h-4 text-destructive" />
              </motion.div>
            )}
          </AnimatePresence>

          <motion.span
            key={timeLeft}
            initial={prefersReduced ? {} : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "text-xl font-mono font-bold tabular-nums transition-colors duration-300",
              hasExpired
                ? "text-muted-foreground"
                : isWarning
                ? "text-destructive"
                : "text-foreground"
            )}
          >
            {hasExpired
              ? vi.decision.timer.expired
              : t(vi.decision.timer.seconds, { seconds: timeLeft })}
          </motion.span>
        </div>
      </div>

      {/* Progress bar */}
      <Progress
        value={progressValue}
        max={totalSeconds}
        indicatorColor={indicatorColor}
        className={cn(
          "h-2 transition-colors duration-500",
          isWarning && !hasExpired && !prefersReduced && "animate-pulse"
        )}
        aria-hidden="true"
      />

      {/* Warning text */}
      <AnimatePresence>
        {isWarning && !hasExpired && (
          <motion.p
            key="warning-text"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="text-[11px] text-destructive font-semibold text-right"
          >
            {vi.decision.timer.warning}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
