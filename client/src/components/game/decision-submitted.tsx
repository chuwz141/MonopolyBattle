"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle2, Clock, ServerCrash } from "lucide-react";
import type { Decision } from "@monopoly/shared";
import { cn } from "@/lib/utils";
import { vi } from "@/i18n/vi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionSubmittedProps {
  decision: Decision;
  /** True until `round:decision-received` arrives from the server. */
  isAwaitingServer: boolean;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * DecisionSubmitted
 *
 * Rendered inside the DecisionPanel after the player has submitted.
 * Shows an optimistic acknowledgement immediately, then switches to a
 * "server confirmed" state once the server emits `round:decision-received`.
 *
 * Server remains source of truth — the parent updates `isAwaitingServer`
 * based on the socket event.
 */
export function DecisionSubmitted({
  decision,
  isAwaitingServer,
  className,
}: DecisionSubmittedProps): React.JSX.Element {
  const prefersReduced = useReducedMotion();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-5 py-8 px-4 text-center",
        className
      )}
    >
      {/* Status icon */}
      <AnimatePresence mode="wait">
        {isAwaitingServer ? (
          <motion.div
            key="pending-icon"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={
              prefersReduced
                ? { opacity: 1, scale: 1 }
                : {
                    opacity: [1, 0.5, 1],
                    scale: [1, 0.95, 1],
                  }
            }
            exit={{ opacity: 0, scale: 0.7 }}
            transition={
              prefersReduced
                ? { duration: 0.15 }
                : { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <Clock className="w-14 h-14 text-primary/60" />
          </motion.div>
        ) : (
          <motion.div
            key="confirmed-icon"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              prefersReduced
                ? { duration: 0.15 }
                : { type: "spring", stiffness: 300, damping: 18 }
            }
          >
            <CheckCircle2 className="w-14 h-14 text-emerald-400" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <AnimatePresence mode="wait">
          <motion.h2
            key={isAwaitingServer ? "pending-title" : "confirmed-title"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: prefersReduced ? 0 : 0.2 }}
            className="text-base font-bold text-foreground"
          >
            {isAwaitingServer
              ? vi.decision.submitted.pending
              : vi.decision.submitted.title}
          </motion.h2>
        </AnimatePresence>

        <p className="text-xs text-muted-foreground max-w-xs">
          {isAwaitingServer
            ? vi.decision.submitted.subtitle
            : vi.decision.submitted.confirmed}
        </p>
      </div>

      {/* Submitted decision card (read-only preview) */}
      <div className="w-full max-w-sm rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-1.5 text-left">
        <p className="text-[10px] uppercase tracking-widest text-primary/60 font-semibold">
          {vi.decision.submitted.yourDecision}
        </p>
        <p className="text-sm font-bold text-foreground">{decision.nameVi}</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {decision.descriptionVi}
        </p>
      </div>

      {/* Server confirmation status dot */}
      <div className="flex items-center gap-2">
        <motion.div
          className={cn(
            "w-2 h-2 rounded-full",
            isAwaitingServer ? "bg-amber-400" : "bg-emerald-400"
          )}
          animate={
            isAwaitingServer && !prefersReduced
              ? { opacity: [1, 0.3, 1] }
              : { opacity: 1 }
          }
          transition={
            isAwaitingServer && !prefersReduced
              ? { duration: 1.2, repeat: Infinity }
              : { duration: 0 }
          }
        />
        <span className="text-xs text-muted-foreground">
          {isAwaitingServer
            ? vi.decision.submitted.pending
            : vi.decision.submitted.confirmed}
        </span>
      </div>
    </div>
  );
}

// ─── Error state ───────────────────────────────────────────────────────────────

interface DecisionSubmitErrorProps {
  onRetry: () => void;
}

export function DecisionSubmitError({ onRetry }: DecisionSubmitErrorProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <ServerCrash className="w-10 h-10 text-destructive" />
      <p className="text-xs text-center text-muted-foreground max-w-xs">
        {vi.errors.serverError}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs underline text-primary"
      >
        {vi.ui.error.retry}
      </button>
    </div>
  );
}
