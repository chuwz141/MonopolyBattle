"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Trophy, BarChart2, BookOpen, Home, RefreshCw } from "lucide-react";
import { vi } from "@/i18n/vi";
import { STORAGE_KEYS } from "@/lib/constants";
import { apiRequest } from "@/lib/api";
import { formatScore, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/lib/utils";
import type { LeaderboardEntry } from "@monopoly/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResultsResponse {
  success: boolean;
  gameId: string;
  leaderboard: LeaderboardEntry[];
  statistics: {
    totalTeams: number;
    roundsPlayed: number;
    avgScore: number;
    topDecision: string | null;
    quizAccuracyPercent: number;
    totalQuizAnswers: number;
    correctQuizAnswers: number;
  };
  educationalSummary: {
    roundCount: number;
    conceptsCovered: string[];
    quizRounds: Array<{
      round: number;
      conceptId: string;
    }>;
    highlights: string[];
  } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAM_COLORS: Record<number, string> = {
  1: "#3B82F6",
  2: "#10B981",
  3: "#F59E0B",
  4: "#EF4444",
  5: "#8B5CF6",
  6: "#06B6D4",
  7: "#EC4899",
  8: "#14B8A6",
  9: "#F43F5E",
};
const DEFAULT_COLOR = "#64748B";

const MEDALS = ["🥇", "🥈", "🥉"] as const;
const PODIUM_HEIGHTS = ["h-32", "h-44", "h-24"] as const; // [2nd, 1st, 3rd]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border/60 bg-background/30">
      <div className="text-accent shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          {label}
        </p>
        <p className="text-xl font-black text-foreground truncate">{value}</p>
      </div>
    </div>
  );
}

function Podium({
  leaderboard,
}: {
  leaderboard: LeaderboardEntry[];
}): React.JSX.Element {
  const top3 = leaderboard.slice(0, 3);
  // Classic podium order: 2nd | 1st | 3rd
  const displayOrder = [top3[1] ?? null, top3[0] ?? null, top3[2] ?? null] as const;
  const heightClasses = PODIUM_HEIGHTS;
  const ranks = [2, 1, 3] as const;

  return (
    <div className="flex items-end justify-center gap-4 py-8">
      {displayOrder.map((entry, position) => {
        if (!entry) return <div key={position} className="w-36" />;
        const rank = ranks[position] ?? position + 1;
        const medal = MEDALS[rank - 1];
        const color = TEAM_COLORS[entry.teamNumber] ?? DEFAULT_COLOR;
        const heightClass = heightClasses[position] ?? "h-24";

        return (
          <div key={entry.teamId} className="flex flex-col items-center gap-3">
            {/* Name + medal */}
            <div className="text-center space-y-1">
              <span className="text-4xl">{medal}</span>
              <p
                className="text-base font-black text-foreground max-w-[130px] truncate"
                title={entry.teamName}
              >
                {entry.teamName}
              </p>
              <p className="text-sm font-mono font-black text-accent">
                {formatScore(entry.totalScore)}
              </p>
            </div>

            {/* Podium block */}
            <div
              className={cn("w-36 rounded-t-2xl flex items-start justify-center pt-4", heightClass)}
              style={{
                backgroundColor: `${color}20`,
                borderTop: `3px solid ${color}`,
                borderLeft: `1px solid ${color}40`,
                borderRight: `1px solid ${color}40`,
              }}
            >
              <span className="text-4xl font-black" style={{ color }}>
                {rank}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results Page
// ---------------------------------------------------------------------------

function ResultsContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const gameId = searchParams.get("gameId") ?? "";

  const [results, setResults] = React.useState<ResultsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const fetchResults = React.useCallback(async (): Promise<void> => {
    if (!gameId) {
      setError(vi.errors.invalidInput);
      setLoading(false);
      return;
    }

    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);

    const response = await apiRequest<ResultsResponse>(
      `/api/games/${gameId}/results`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    );

    if (response.data) {
      setResults(response.data);
    } else {
      setError(response.error ?? vi.errors.serverError);
    }
    setLoading(false);
  }, [gameId]);

  React.useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse text-sm">{vi.pages.results.loading}</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Error state
  // --------------------------------------------------------------------------

  if (error || !results) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-8">
        <div className="text-center space-y-3">
          <Trophy className="w-12 h-12 text-muted-foreground mx-auto" />
          <h1 className="text-2xl font-black text-foreground">{vi.pages.results.errorTitle}</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            id="results-retry-btn"
            onClick={() => {
              setLoading(true);
              setError("");
              fetchResults();
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border text-sm font-bold text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {vi.pages.results.errorRetry}
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-bold hover:bg-accent/90 transition-colors"
            id="results-home-btn"
          >
            <Home className="w-4 h-4" />
            {vi.pages.results.backToHome}
          </Link>
        </div>
      </div>
    );
  }

  const { leaderboard, statistics, educationalSummary } = results;

  // --------------------------------------------------------------------------
  // Full results view
  // --------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-background text-foreground font-sans relative overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-20">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-accent blur-[180px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-primary blur-[160px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-12 space-y-14">
        {/* ── Page Header ─────────────────────────────────────────────── */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-accent via-yellow-300 to-accent bg-clip-text text-transparent">
            {vi.pages.results.title}
          </h1>
          <p className="text-muted-foreground text-base">{vi.pages.results.subtitle}</p>
        </div>

        {/* ── Podium ──────────────────────────────────────────────────── */}
        {leaderboard.length >= 3 && (
          <section>
            <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground text-center mb-2 flex items-center justify-center gap-2">
              <Trophy className="w-4 h-4 text-accent" />
              {vi.pages.results.podiumTitle}
            </h2>
            <Podium leaderboard={leaderboard} />
          </section>
        )}

        {/* ── Leaderboard ─────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-black text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-accent" />
            {vi.pages.results.leaderboardTitle}
          </h2>

          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">{vi.pages.results.noResults}</p>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((entry) => {
                const color = TEAM_COLORS[entry.teamNumber] ?? DEFAULT_COLOR;
                const medal = MEDALS[entry.rank - 1];

                return (
                  <div
                    key={entry.teamId}
                    className={cn(
                      "flex items-center gap-4 rounded-2xl border-2 px-6 py-4 transition-all",
                      entry.rank === 1
                        ? "border-accent/50 bg-accent/10 shadow-[0_0_30px_rgba(245,166,35,0.1)]"
                        : entry.rank === 2
                        ? "border-slate-500/30 bg-slate-500/5"
                        : entry.rank === 3
                        ? "border-amber-700/30 bg-amber-900/5"
                        : "border-border bg-card/30"
                    )}
                  >
                    {/* Rank */}
                    <div className="w-10 text-center shrink-0">
                      {medal ? (
                        <span className="text-2xl">{medal}</span>
                      ) : (
                        <span className="text-xl font-black text-muted-foreground">
                          {entry.rank}
                        </span>
                      )}
                    </div>

                    {/* Colour dot + name */}
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="flex-1 text-base font-black text-foreground/90 truncate">
                      {entry.teamName}
                    </span>

                    {/* Market share */}
                    <div className="text-right min-w-[90px] hidden sm:block">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {vi.pages.results.marketShareLabel}
                      </div>
                      <div className="text-base font-black font-mono text-muted-foreground">
                        {formatPercent(entry.marketShare)}
                      </div>
                    </div>

                    {/* Quiz score */}
                    <div className="text-right min-w-[90px] hidden md:block">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {vi.pages.results.quizScoreLabel}
                      </div>
                      <div className="text-base font-black font-mono text-purple-400">
                        +{formatScore(entry.quizScore ?? 0)}
                      </div>
                    </div>

                    {/* Total score */}
                    <div className="text-right min-w-[110px]">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                        {vi.pages.results.totalScoreLabel}
                      </div>
                      <div
                        className={cn(
                          "text-xl font-black font-mono",
                          entry.rank === 1 ? "text-accent" : "text-foreground"
                        )}
                      >
                        {formatScore(entry.totalScore)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Statistics ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-black text-foreground flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-accent" />
            {vi.pages.results.statsTitle}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatItem
              label={vi.pages.results.statsTotalTeams}
              value={statistics.totalTeams}
              icon={<BarChart2 className="w-5 h-5" />}
            />
            <StatItem
              label={vi.pages.results.statsRoundsPlayed}
              value={statistics.roundsPlayed}
              icon={<BarChart2 className="w-5 h-5" />}
            />
            <StatItem
              label={vi.pages.results.statsAvgScore}
              value={formatScore(statistics.avgScore)}
              icon={<BarChart2 className="w-5 h-5" />}
            />
            <StatItem
              label={vi.pages.results.statsQuizAccuracy}
              value={`${statistics.quizAccuracyPercent}%`}
              icon={<BookOpen className="w-5 h-5" />}
            />
            {statistics.topDecision && (
              <StatItem
                label={vi.pages.results.statsTopDecision}
                value={statistics.topDecision}
                icon={<BarChart2 className="w-5 h-5" />}
              />
            )}
          </div>
        </section>

        {/* ── Educational Summary ──────────────────────────────────────── */}
        {educationalSummary && (
          <section className="space-y-4">
            <h2 className="text-lg font-black text-foreground flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-accent" />
              {vi.pages.results.educationTitle}
            </h2>

            <div className="rounded-2xl border border-border bg-card/40 backdrop-blur p-6 space-y-6">
              {/* Concepts covered */}
              {educationalSummary.conceptsCovered.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {vi.pages.results.educationConceptsLabel}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {educationalSummary.conceptsCovered.map((c) => (
                      <span
                        key={c}
                        className="px-3 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300 text-xs font-black"
                      >
                        {vi.concepts[c] ?? c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Quiz rounds */}
              {educationalSummary.quizRounds.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {vi.pages.results.educationQuizRoundsLabel}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {educationalSummary.quizRounds.map((qr) => (
                      <div
                        key={qr.round}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-purple-500/30 bg-purple-500/10"
                      >
                        <span className="text-xs font-bold text-purple-400">
                          {t(vi.pages.results.rankLabel, { rank: qr.round })}
                        </span>
                        <span className="text-xs text-slate-400">—</span>
                        <span className="text-xs font-semibold text-slate-300">
                          {vi.concepts[qr.conceptId] ?? qr.conceptId}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Highlights */}
              {educationalSummary.highlights.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    {vi.pages.results.educationHighlightsLabel}
                  </p>
                  <ul className="space-y-2">
                    {educationalSummary.highlights.map((h, i) => (
                      <li
                        key={i}
                        className="text-sm text-slate-300 leading-relaxed flex items-start gap-2"
                      >
                        <span className="text-accent mt-0.5">•</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Bottom navigation ──────────────────────────────────────── */}
        <div className="flex justify-center pt-4">
          <Link
            href="/"
            id="results-back-home"
            className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-accent text-accent-foreground font-black text-sm hover:bg-accent/90 transition-colors shadow-[0_0_20px_rgba(245,166,35,0.2)]"
          >
            <Home className="w-4 h-4" />
            {vi.pages.results.backToHome}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage(): React.JSX.Element {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="text-muted-foreground animate-pulse text-sm">
            {vi.pages.results.loading}
          </p>
        </div>
      }
    >
      <ResultsContent />
    </React.Suspense>
  );
}
