package service

import (
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/winapi"
)

const AppVersion = "0.1.0"

// SettingsService persists and broadcasts user preferences in portable SQLite.
type SettingsService struct {
	mu        sync.RWMutex
	store     *db.Store
	paths     *config.Paths
	app       *application.App
	mainWin   *application.WebviewWindow
	windowSvc *WindowService
	cached    model.AppSettings
	onChange  func(prev, next model.AppSettings) error
}

// NewSettingsService loads persisted preferences from SQLite, falling back to defaults.
func NewSettingsService(store *db.Store, paths *config.Paths) (*SettingsService, error) {
	s := &SettingsService{
		store:  store,
		paths:  paths,
		cached: model.DefaultSettings(),
	}
	if err := s.loadFromDB(); err != nil {
		return nil, err
	}
	return s, nil
}

// AttachApp wires the Wails application instance, main window, and WindowService.
//
//wails:ignore
func (s *SettingsService) AttachApp(app *application.App, mainWin *application.WebviewWindow, windowSvc *WindowService) {
	s.mu.Lock()
	s.app = app
	s.mainWin = mainWin
	s.windowSvc = windowSvc
	s.mu.Unlock()
}

// SetChangeHandler registers an internal callback invoked when settings are saved.
//
//wails:ignore
func (s *SettingsService) SetChangeHandler(fn func(prev, next model.AppSettings) error) {
	s.mu.Lock()
	s.onChange = fn
	s.mu.Unlock()
}

// GetSettings returns the current user preferences.
func (s *SettingsService) GetSettings() model.AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cached
}

// SaveSettings persists all user preferences and broadcasts updates.
func (s *SettingsService) SaveSettings(next model.AppSettings) (model.AppSettings, error) {
	next = normalizeSettings(next)

	s.mu.RLock()
	prev := s.cached
	handler := s.onChange
	app := s.app
	s.mu.RUnlock()

	// Only touch Windows startup registry if user explicitly changed AutoStart.
	if next.AutoStart != prev.AutoStart {
		if err := winapi.SetAutoStart(next.AutoStart); err != nil {
			return prev, fmt.Errorf("更新开机自启失败: %w", err)
		}
	}

	if handler != nil {
		if err := handler(prev, next); err != nil {
			return prev, err
		}
	}

	if err := s.persistAll(next); err != nil {
		return prev, err
	}

	s.mu.Lock()
	s.cached = next
	s.mu.Unlock()

	if app != nil && next.Theme != prev.Theme {
		app.Event.Emit(model.EventThemeChanged, model.ThemeChangedPayload{Theme: next.Theme})
	}
	return next, nil
}

// SetTheme switches the active macaron theme and syncs across all windows.
func (s *SettingsService) SetTheme(theme string) (model.AppSettings, error) {
	cur := s.GetSettings()
	cur.Theme = normalizeTheme(theme)
	return s.SaveSettings(cur)
}

// UpdateField allows internal services to atomically update cached + persisted settings.
//
//wails:ignore
func (s *SettingsService) UpdateField(mutate func(*model.AppSettings)) error {
	s.mu.Lock()
	next := s.cached
	mutate(&next)
	next = normalizeSettings(next)
	if err := s.persistAll(next); err != nil {
		s.mu.Unlock()
		return err
	}
	s.cached = next
	s.mu.Unlock()
	return nil
}

// OpenDataDirectory opens the portable data folder in Windows Explorer.
func (s *SettingsService) OpenDataDirectory() error {
	return winapi.OpenInExplorer(s.paths.RootDir)
}

// GetAppInfo returns portable runtime paths and storage statistics.
func (s *SettingsService) GetAppInfo() model.AppInfo {
	var dbSize int64
	if st, err := os.Stat(s.paths.DBPath); err == nil {
		dbSize = st.Size()
	}
	iconCount := 0
	if entries, err := os.ReadDir(s.paths.IconsDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				iconCount++
			}
		}
	}
	return model.AppInfo{
		Name:       "NekoScriptsManage",
		Version:    AppVersion,
		IsDev:      s.paths.IsDev,
		DataDir:    s.paths.RootDir,
		DBPath:     s.paths.DBPath,
		DBSizeByte: dbSize,
		IconCount:  iconCount,
	}
}

func (s *SettingsService) loadFromDB() error {
	rows, err := s.store.DB.Query(`SELECT key, value FROM app_settings`)
	if err != nil {
		return fmt.Errorf("load app_settings: %w", err)
	}
	defer rows.Close()

	kv := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return err
		}
		kv[k] = v
	}
	if err := rows.Err(); err != nil {
		return err
	}

	cfg := model.DefaultSettings()
	if v, ok := kv["theme"]; ok {
		cfg.Theme = normalizeTheme(v)
	}
	if v, ok := kv["global_hotkey"]; ok {
		cfg.GlobalHotkey = v
	}
	if v, ok := kv["hide_on_blur"]; ok {
		cfg.HideOnBlur = parseBool(v, cfg.HideOnBlur)
	}
	if v, ok := kv["always_on_top"]; ok {
		cfg.AlwaysOnTop = parseBool(v, cfg.AlwaysOnTop)
	}
	if v, ok := kv["float_ball_enabled"]; ok {
		cfg.FloatBallEnabled = parseBool(v, cfg.FloatBallEnabled)
	}
	if v, ok := kv["float_ball_style"]; ok {
		cfg.FloatBallStyle = normalizeFloatStyle(v)
	}
	if v, ok := kv["float_ball_x"]; ok {
		cfg.FloatBallX = parseInt(v, cfg.FloatBallX)
	}
	if v, ok := kv["float_ball_y"]; ok {
		cfg.FloatBallY = parseInt(v, cfg.FloatBallY)
	}
	if v, ok := kv["main_win_x"]; ok {
		cfg.MainWinX = parseInt(v, cfg.MainWinX)
	}
	if v, ok := kv["main_win_y"]; ok {
		cfg.MainWinY = parseInt(v, cfg.MainWinY)
	}
	if v, ok := kv["auto_start"]; ok {
		cfg.AutoStart = parseBool(v, cfg.AutoStart)
	}
	if v, ok := kv["scheduler_paused"]; ok {
		cfg.SchedulerPaused = parseBool(v, cfg.SchedulerPaused)
	}
	if v, ok := kv["log_retention_days"]; ok {
		cfg.LogRetentionDays = parseInt(v, cfg.LogRetentionDays)
	}
	if v, ok := kv["log_max_count"]; ok {
		cfg.LogMaxCount = parseInt(v, cfg.LogMaxCount)
	}

	s.cached = normalizeSettings(cfg)
	return nil
}

func (s *SettingsService) persistAll(cfg model.AppSettings) error {
	kv := map[string]string{
		"theme":              cfg.Theme,
		"global_hotkey":      cfg.GlobalHotkey,
		"hide_on_blur":       strconv.FormatBool(cfg.HideOnBlur),
		"always_on_top":      strconv.FormatBool(cfg.AlwaysOnTop),
		"float_ball_enabled": strconv.FormatBool(cfg.FloatBallEnabled),
		"float_ball_style":   cfg.FloatBallStyle,
		"float_ball_x":       strconv.Itoa(cfg.FloatBallX),
		"float_ball_y":       strconv.Itoa(cfg.FloatBallY),
		"main_win_x":         strconv.Itoa(cfg.MainWinX),
		"main_win_y":         strconv.Itoa(cfg.MainWinY),
		"auto_start":         strconv.FormatBool(cfg.AutoStart),
		"scheduler_paused":   strconv.FormatBool(cfg.SchedulerPaused),
		"log_retention_days": strconv.Itoa(cfg.LogRetentionDays),
		"log_max_count":      strconv.Itoa(cfg.LogMaxCount),
	}

	tx, err := s.store.DB.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`
		INSERT INTO app_settings (key, value, updated_at)
		VALUES (?, ?, datetime('now', 'localtime'))
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
	`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()

	for k, v := range kv {
		if _, err := stmt.Exec(k, v); err != nil && err != sql.ErrNoRows {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func normalizeSettings(cfg model.AppSettings) model.AppSettings {
	cfg.Theme = normalizeTheme(cfg.Theme)
	cfg.FloatBallStyle = normalizeFloatStyle(cfg.FloatBallStyle)
	if cfg.LogRetentionDays < 1 {
		cfg.LogRetentionDays = 30
	}
	if cfg.LogMaxCount < 50 {
		cfg.LogMaxCount = 500
	}
	return cfg
}

func normalizeTheme(t string) string {
	switch t {
	case "sakura", "mint", "sky", "cream":
		return t
	default:
		return "sakura"
	}
}

func normalizeFloatStyle(s string) string {
	switch s {
	case "avatar", "capsule":
		return s
	default:
		return "avatar"
	}
}

func parseBool(s string, fallback bool) bool {
	v, err := strconv.ParseBool(s)
	if err != nil {
		return fallback
	}
	return v
}

func parseInt(s string, fallback int) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return v
}
