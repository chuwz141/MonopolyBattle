"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock } from "lucide-react";
import { SOCKET_EVENTS } from "@monopoly/shared";
import type { Decision } from "@monopoly/shared";
import { cn } from "@/lib/utils";
import { vi } from "@/i18n/vi";
import { useGameStore } from "@/stores/game.store";
import { useSocketStore } from "@/stores/socket.store";
import { DecisionCard } from "./decision-card";
import { DecisionConfirmDialog } from "./decision-confirm-dialog";
import { DecisionSubmitted } from "./decision-submitted";
import { RoundTimer } from "./round-timer";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Submission lifecycle managed by DecisionPanel locally. */
type SubmitState =
  | { status: "idle" }
  | { status: "confirming"; pendingType: string }
  | { status: "loading"; pendingType: string }
  | { status: "submitted"; confirmedByServer: boolean }
  | { status: "error" };

// ─── Constants ────────────────────────────────────────────────────────────────

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2",
  5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  6: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

function resolveGridClass(count: number): string {
  const col = GRID_COLS[Math.min(count, 6)];
  return col ?? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * DecisionPanel
 *
 * Orchestrates the full decision-making flow for a player in a single round:
 *
 *  1. IDLE   — displays 4–6 decision cards, timer running
 *  2. CONFIRMING — player picked a card, confirm dialog open
 *  3. LOADING — emit `player:decision` in flight
 *  4. SUBMITTED — optimistic ack shown; waiting for `round:decision-received`
 *  5. ERROR  — socket emit failed; retry available
 *
 * Keyboard navigation:
 *   ← → ArrowLeft/Right  — move focus between cards
 *   Enter / Space        — select the focused card (opens confirm dialog)
 *
 * Rules enforced here (no business logic):
 *   - Panel is disabled after successful submission.
 *   - Panel is disabled when `roundTimeLeft <= 0`.
 *   - `selectedDecision` in the store is updated optimistically; server confirms.
 *
 * Server remains source of truth — no local stat calculations.
 */
export function DecisionPanel(): React.JSX.Element {
  // ── Store selectors (narrow — prevents unwanted re-renders) ──────────────
  const decisions = useGameStore((s) => s.availableDecisions);
  const selectedDecision = useGameStore((s) => s.selectedDecision);
  const roundTimeLeft = useGameStore((s) => s.roundTimeLeft);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const currentRound = useGameStore((s) => s.currentRound);
  const myTeam = useGameStore((s) => s.myTeam);
  const setSelectedDecision = useGameStore((s) => s.setSelectedDecision);

  const socket = useSocketStore((s) => s.socket);

  // ── Local state ──────────────────────────────────────────────────────────
  const [submitState, setSubmitState] = React.useState<SubmitState>({ status: "idle" });
  const [focusedIndex, setFocusedIndex] = React.useState(0);
  const [timerExpired, setTimerExpired] = React.useState(false);

  // roundId from current game state (myTeam or a round store would provide this;
  // here we derive a stable ref from store-provided currentRound).
  // A real implementation would store roundId in the game store via round:start.
  const roundIdRef = React.useRef<string>(`round-${currentRound}`);
  React.useEffect(() => {
    roundIdRef.current = `round-${currentRound}`;
    // Reset panel when a new round starts.
    setSubmitState({ status: "idle" });
    setTimerExpired(false);
    setFocusedIndex(0);
    setSelectedDecision(null);
  }, [currentRound, setSelectedDecision]);

  // ── Server event listener — round:decision-received ──────────────────────
  React.useEffect(() => {
    if (socket === null) return;

    const handleDecisionReceived = (): void => {
      setSubmitState((prev) =>
        prev.status === "submitted"
          ? { status: "submitted", confirmedByServer: true }
          : prev
      );
    };

    socket.on(SOCKET_EVENTS.ROUND_DECISION_RECEIVED, handleDecisionReceived);
    return () => {
      socket.off(SOCKET_EVENTS.ROUND_DECISION_RECEIVED, handleDecisionReceived);
    };
  }, [socket]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isSubmitted =
    submitState.status === "submitted" || submitState.status === "loading";
  const isDisabled = isSubmitted || timerExpired;

  // ── Keyboard navigation handler on the grid container ────────────────────
  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (isDisabled) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, decisions.length - 1));
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    }
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleCardSelect = (decisionType: string): void => {
    if (isDisabled) return;
    setSelectedDecision(decisionType);
    setSubmitState({ status: "confirming", pendingType: decisionType });
  };

  const handleConfirmCancel = (): void => {
    setSubmitState({ status: "idle" });
  };

  const handleConfirmSubmit = (): void => {
    if (submitState.status !== "confirming") return;
    if (socket === null || myTeam === null) return;

    const { pendingType } = submitState;
    setSubmitState({ status: "loading", pendingType });

    socket.emit(
      SOCKET_EVENTS.PLAYER_DECISION,
      {
        roundId: roundIdRef.current,
        teamId: myTeam.id,
        decisionType: pendingType,
      },
      // Optional ack callback (server may not send one, handled by ROUND_DECISION_RECEIVED)
      (ackError?: { message: string }) => {
        if (ackError !== undefined) {
          setSubmitState({ status: "error" });
          return;
        }
        setSubmitState({ status: "submitted", confirmedByServer: false });
      }
    );
  };

  const handleTimerExpire = React.useCallback((): void => {
    setTimerExpired(true);
  }, []);

  const handleRetry = (): void => {
    setSubmitState({ status: "idle" });
    setSelectedDecision(null);
  };

  // ── Look up pending decision object for dialog / submitted view ───────────
  const pendingDecision: Decision | null = React.useMemo(() => {
    const type =
      submitState.status === "confirming" || submitState.status === "loading"
        ? submitState.pendingType
        : selectedDecision;
    if (type === null) return null;
    return decisions.find((d) => d.type === type) ?? null;
  }, [submitState, selectedDecision, decisions]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section
      className="flex flex-col gap-5"
      aria-label={vi.decision.panelTitle}
    >
      {/* Panel header + timer row */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-bold text-foreground tracking-tight">
            {vi.decision.panelTitle}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {vi.decision.panelSubtitle}
          </p>
        </div>

        <RoundTimer
          totalSeconds={totalRounds * 60}
          onExpire={handleTimerExpire}
        />
      </div>

      {/* Main content area — cards OR submitted state */}
      <AnimatePresence mode="wait">
        {submitState.status === "submitted" ||
        submitState.status === "loading" ? (
          <motion.div
            key="submitted"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25 }}
          >
            {pendingDecision !== null && (
              <DecisionSubmitted
                decision={pendingDecision}
                isAwaitingServer={
                  submitState.status === "loading" ||
                  (submitState.status === "submitted" &&
                    !submitState.confirmedByServer)
                }
              />
            )}
          </motion.div>
        ) : submitState.status === "error" ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center gap-3 py-8"
          >
            <p className="text-xs text-center text-muted-foreground">
              {vi.errors.serverError}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="text-xs underline text-primary"
            >
              {vi.ui.error.retry}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="cards"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Timer-expired banner */}
            <AnimatePresence>
              {timerExpired && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 mb-4"
                >
                  <Lock className="w-3.5 h-3.5 text-destructive" />
                  <p className="text-xs text-destructive font-medium">
                    {vi.decision.timerExpiredLabel}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Decision cards grid */}
            <div
              role="group"
              aria-label={vi.decision.panelTitle}
              onKeyDown={handleGridKeyDown}
              className={cn(
                "grid gap-4",
                resolveGridClass(decisions.length)
              )}
            >
              {decisions.map((decision, index) => (
                <DecisionCard
                  key={decision.id}
                  decision={decision}
                  index={index}
                  isSelected={selectedDecision === decision.type}
                  isDisabled={isDisabled}
                  isFocused={focusedIndex === index}
                  onSelect={handleCardSelect}
                  onFocus={setFocusedIndex}
                />
              ))}
            </div>

            {/* Keyboard hint */}
            {decisions.length > 1 && !isDisabled && (
              <p className="text-[10px] text-muted-foreground/50 text-center mt-3">
                {vi.decision.keyboardHint}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm dialog (portal — always rendered when open) */}
      <DecisionConfirmDialog
        open={
          submitState.status === "confirming" ||
          submitState.status === "loading"
        }
        decision={pendingDecision}
        isLoading={submitState.status === "loading"}
        onCancel={handleConfirmCancel}
        onConfirm={handleConfirmSubmit}
      />
    </section>
  );
}
