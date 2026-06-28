"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CheckCircle2, Loader2, ServerCrash } from "lucide-react";
import type { Decision } from "@monopoly/shared";
import { cn } from "@/lib/utils";
import { vi } from "@/i18n/vi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionConfirmDialogProps {
  open: boolean;
  decision: Decision | null;
  /** True while waiting for the server to acknowledge. */
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * DecisionConfirmDialog
 *
 * Two-step confirmation gate before emitting `player:decision` to the server.
 *
 * Interaction flow:
 *   1. Player picks a card  → parent opens this dialog.
 *   2. Player clicks "Xác nhận nộp" → `onConfirm` fires, `isLoading` becomes true.
 *   3. Server emits `round:decision-received` → parent closes dialog.
 *
 * The dialog is intentionally non-dismissable (no close button, no backdrop click)
 * once `isLoading` is true so the loading state is always visible.
 */
export function DecisionConfirmDialog({
  open,
  decision,
  isLoading,
  onCancel,
  onConfirm,
}: DecisionConfirmDialogProps): React.JSX.Element {
  const prefersReduced = useReducedMotion();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isLoading && onCancel()}>
      <DialogContent
        className={cn(
          "max-w-md border-border/80 bg-card/95 backdrop-blur-md shadow-2xl",
          // Block outside clicks while loading
          isLoading && "pointer-events-none"
        )}
      >
        <DialogHeader className="gap-2">
          <DialogTitle className="text-base font-bold">
            {vi.decision.confirm.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {vi.decision.confirm.description}
          </DialogDescription>
        </DialogHeader>

        {/* Selected decision preview */}
        {decision !== null && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-widest text-primary/70 font-semibold">
              {vi.decision.confirm.selectedDecision}
            </p>
            <p className="text-sm font-bold text-foreground">{decision.nameVi}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {decision.descriptionVi}
            </p>
          </div>
        )}

        {/* Warning note */}
        <p className="text-[11px] text-muted-foreground/70 italic">
          {vi.decision.confirm.warningNote}
        </p>

        <DialogFooter className="gap-2 mt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={onCancel}
          >
            {vi.decision.confirm.cancel}
          </Button>

          <Button
            variant="default"
            size="sm"
            disabled={isLoading}
            onClick={onConfirm}
            id="confirm-decision-btn"
            className="min-w-[140px]"
          >
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.span
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: prefersReduced ? 0 : 0.15 }}
                  className="flex items-center gap-2"
                >
                  <Loader2
                    className={cn(
                      "w-4 h-4",
                      !prefersReduced && "animate-spin"
                    )}
                  />
                  {vi.decision.confirm.loading}
                </motion.span>
              ) : (
                <motion.span
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: prefersReduced ? 0 : 0.15 }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {vi.decision.confirm.confirm}
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </DialogFooter>

        {/* Global loading overlay — prevents interaction while keeping content visible */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 rounded-lg flex items-center justify-center bg-background/60 backdrop-blur-sm z-10"
            >
              <div className="flex flex-col items-center gap-3">
                <Loader2
                  className={cn(
                    "w-8 h-8 text-primary",
                    !prefersReduced && "animate-spin"
                  )}
                />
                <p className="text-xs font-semibold text-muted-foreground">
                  {vi.decision.confirm.loading}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

// ─── Error fallback ────────────────────────────────────────────────────────────

interface DecisionConfirmErrorProps {
  onRetry: () => void;
}

/**
 * Shown if the socket emit fails before the server acks.
 * Used by the parent — exported as a standalone component.
 */
export function DecisionConfirmError({
  onRetry,
}: DecisionConfirmErrorProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <ServerCrash className="w-8 h-8 text-destructive" />
      <p className="text-xs text-center text-muted-foreground">
        {vi.errors.serverError}
      </p>
      <Button size="sm" variant="destructive" onClick={onRetry}>
        {vi.ui.error.retry}
      </Button>
    </div>
  );
}
