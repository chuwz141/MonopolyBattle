-- Initial migration script for MonopolyBattle
-- Setup pragmas (these are run per-connection, but added here for documentation/reference)
-- PRAGMA journal_mode = WAL;
-- PRAGMA synchronous = NORMAL;
-- PRAGMA foreign_keys = ON;
-- PRAGMA busy_timeout = 5000;

-- 1. Game Session Table
CREATE TABLE IF NOT EXISTS game (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL UNIQUE,
    host_pin TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('lobby', 'playing', 'paused', 'finished')),
    current_round INTEGER NOT NULL DEFAULT 0,
    total_rounds INTEGER NOT NULL DEFAULT 8,
    round_duration_sec INTEGER NOT NULL DEFAULT 60,
    settings_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_room_code ON game(room_code);
CREATE INDEX IF NOT EXISTS idx_game_status ON game(status);

-- 2. Team Table
CREATE TABLE IF NOT EXISTS team (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    team_number INTEGER NOT NULL,
    money INTEGER NOT NULL DEFAULT 10000,
    market_share REAL NOT NULL DEFAULT 0.0,
    technology INTEGER NOT NULL DEFAULT 0,
    reputation INTEGER NOT NULL DEFAULT 0,
    monopoly_risk INTEGER NOT NULL DEFAULT 0,
    total_score INTEGER NOT NULL DEFAULT 0,
    quiz_score INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('waiting', 'ready', 'playing', 'eliminated')) DEFAULT 'waiting',
    created_at TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE,
    UNIQUE(game_id, team_number)
);

CREATE INDEX IF NOT EXISTS idx_team_game_id ON team(game_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_game_number ON team(game_id, team_number);

-- 3. Player Table
CREATE TABLE IF NOT EXISTS player (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    socket_id TEXT,
    is_connected INTEGER NOT NULL CHECK(is_connected IN (0, 1)) DEFAULT 1,
    last_seen TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_player_team_id ON player(team_id);
CREATE INDEX IF NOT EXISTS idx_player_socket ON player(socket_id);

-- 4. Round Table
CREATE TABLE IF NOT EXISTS round (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('decision', 'event', 'quiz', 'narration', 'results')),
    available_decisions_json TEXT NOT NULL,
    event_id TEXT,
    narration_text TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE,
    UNIQUE(game_id, round_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_round_game ON round(game_id, round_number);

-- 5. Decision Log Table
CREATE TABLE IF NOT EXISTS decision_log (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    decision_type TEXT NOT NULL,
    decision_data_json TEXT NOT NULL,
    money_delta INTEGER NOT NULL,
    market_share_delta REAL NOT NULL,
    technology_delta INTEGER NOT NULL,
    reputation_delta INTEGER NOT NULL,
    monopoly_risk_delta INTEGER NOT NULL,
    score_earned INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (round_id) REFERENCES round(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE CASCADE,
    UNIQUE(round_id, team_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_round_team ON decision_log(round_id, team_id);

-- 6. Round Event Table
CREATE TABLE IF NOT EXISTS round_event (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data_json TEXT NOT NULL,
    narration_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (round_id) REFERENCES round(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_round ON round_event(round_id);

-- 7. Quiz Answer Table
CREATE TABLE IF NOT EXISTS quiz_answer (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    selected_option INTEGER NOT NULL,
    is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
    time_taken_ms INTEGER NOT NULL,
    score_earned INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (round_id) REFERENCES round(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES team(id) ON DELETE CASCADE,
    UNIQUE(round_id, team_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_round_team ON quiz_answer(round_id, team_id);
