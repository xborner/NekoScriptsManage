-- 001_init.sql: Initial schema for NekoScriptsManage (SQLite)

CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    icon        TEXT NOT NULL DEFAULT '🐾',
    color       TEXT NOT NULL DEFAULT '#FF9EB5',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS apps (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    target_path      TEXT NOT NULL,
    arguments        TEXT NOT NULL DEFAULT '',
    working_dir      TEXT NOT NULL DEFAULT '',
    icon_type        TEXT NOT NULL DEFAULT 'extracted',
    icon_value       TEXT NOT NULL DEFAULT '',
    run_as_admin     INTEGER NOT NULL DEFAULT 0,
    tags             TEXT NOT NULL DEFAULT '',
    notes_md         TEXT NOT NULL DEFAULT '',
    click_count      INTEGER NOT NULL DEFAULT 0,
    is_pinned        INTEGER NOT NULL DEFAULT 0,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    last_launched_at TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS scripts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    script_type      TEXT NOT NULL DEFAULT 'bat',
    source_mode      TEXT NOT NULL DEFAULT 'inline',
    file_path        TEXT NOT NULL DEFAULT '',
    inline_content   TEXT NOT NULL DEFAULT '',
    custom_command   TEXT NOT NULL DEFAULT '',
    arguments        TEXT NOT NULL DEFAULT '',
    working_dir      TEXT NOT NULL DEFAULT '',
    run_in_terminal  INTEGER NOT NULL DEFAULT 0,
    run_as_admin     INTEGER NOT NULL DEFAULT 0,
    timeout_sec      INTEGER NOT NULL DEFAULT 300,
    tags             TEXT NOT NULL DEFAULT '',
    is_pinned        INTEGER NOT NULL DEFAULT 0,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    last_run_at      TEXT,
    last_status      TEXT NOT NULL DEFAULT 'idle',
    created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS schedules (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id          INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    name               TEXT NOT NULL DEFAULT '',
    enabled            INTEGER NOT NULL DEFAULT 0,
    mode               TEXT NOT NULL DEFAULT 'simple',
    simple_config_json TEXT NOT NULL DEFAULT '{}',
    cron_expr          TEXT NOT NULL DEFAULT '',
    allow_concurrent   INTEGER NOT NULL DEFAULT 0,
    last_run_at        TEXT,
    last_status        TEXT NOT NULL DEFAULT 'idle',
    created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS script_logs (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id            INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
    script_name_snapshot TEXT NOT NULL,
    schedule_id          INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
    trigger_type         TEXT NOT NULL DEFAULT 'manual',
    status               TEXT NOT NULL DEFAULT 'running',
    exit_code            INTEGER,
    started_at           TEXT NOT NULL,
    finished_at          TEXT,
    duration_ms          INTEGER NOT NULL DEFAULT 0,
    stdout_text          TEXT NOT NULL DEFAULT '',
    stderr_text          TEXT NOT NULL DEFAULT '',
    error_message        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_categories_sort        ON categories(sort_order, id);
CREATE INDEX IF NOT EXISTS idx_apps_category_sort     ON apps(category_id, is_pinned DESC, sort_order, click_count DESC);
CREATE INDEX IF NOT EXISTS idx_apps_pinned_clicks     ON apps(is_pinned DESC, click_count DESC);
CREATE INDEX IF NOT EXISTS idx_scripts_pinned_sort    ON scripts(is_pinned DESC, sort_order, id DESC);
CREATE INDEX IF NOT EXISTS idx_schedules_script_id    ON schedules(script_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled      ON schedules(enabled);
CREATE INDEX IF NOT EXISTS idx_logs_script_started    ON script_logs(script_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_status_started    ON script_logs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_started_at        ON script_logs(started_at DESC);

-- Seed default starter categories (idempotent)
INSERT OR IGNORE INTO categories (id, name, icon, color, sort_order) VALUES
    (1, '常用软件', '✨', '#FF9EB5', 1),
    (2, '开发工具', '💻', '#7CC4FA', 2),
    (3, '实用文件夹', '📁', '#6CD4B5', 3);
