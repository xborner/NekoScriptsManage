package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/runner"
	"nekomanage/internal/scheduler"
)

// ScheduleService manages persistent Cron/simple schedules and coordinates robfig/cron/v3 execution.
type ScheduleService struct {
	mu        sync.RWMutex
	store     *db.Store
	manager   *scheduler.Manager
	engine    *runner.Engine
	scriptSvc *ScriptService
	settings  *SettingsService
	windowSvc *WindowService
	app       *application.App
}

func NewScheduleService(
	store *db.Store,
	engine *runner.Engine,
	scriptSvc *ScriptService,
	settings *SettingsService,
	windowSvc *WindowService,
	logSvc *LogService,
) *ScheduleService {
	svc := &ScheduleService{
		store:     store,
		engine:    engine,
		scriptSvc: scriptSvc,
		settings:  settings,
		windowSvc: windowSvc,
	}

	svc.manager = scheduler.NewManager(
		svc.handleTrigger,
		func() {
			if logSvc != nil {
				_, _ = logSvc.RunLogCleanup()
			}
		},
	)
	return svc
}

// Attach connects the Wails runtime for broadcasting schedule updates.
//
//wails:ignore
func (s *ScheduleService) Attach(app *application.App) {
	s.mu.Lock()
	s.app = app
	s.mu.Unlock()
}

// Start loads all enabled schedules from SQLite and starts the background cron engine.
//
//wails:ignore
func (s *ScheduleService) Start() error {
	paused := false
	if s.settings != nil {
		paused = s.settings.GetSettings().SchedulerPaused
	}
	s.manager.Start(paused)

	list, err := s.ListSchedules()
	if err != nil {
		return err
	}
	for _, sc := range list {
		if sc.Enabled {
			_ = s.manager.SyncSchedule(sc.ScheduleItem)
		}
	}
	return nil
}

// Stop stops the cron scheduler gracefully.
//
//wails:ignore
func (s *ScheduleService) Stop() {
	if s.manager != nil {
		s.manager.Stop()
	}
}

func (s *ScheduleService) handleTrigger(scheduleID int64, scriptID int64, allowConcurrent bool) {
	if !allowConcurrent {
		if _, running := s.engine.Registry().RunningLogIDForScript(scriptID); running {
			s.emitToast("info", "定时脚本上次执行尚未结束，已跳过本次重入")
			return
		}
	}

	script, err := s.scriptSvc.GetScript(scriptID)
	if err != nil {
		return
	}
	sid := scheduleID
	if _, err := s.engine.Start(script, "schedule", &sid); err != nil {
		s.emitToast("error", fmt.Sprintf("定时任务「%s」启动失败: %v", script.Name, err))
		return
	}
	s.broadcastState()
}

// ListSchedules returns all schedules joined with their script names and live next-run times.
func (s *ScheduleService) ListSchedules() ([]model.ScheduleView, error) {
	rows, err := s.store.DB.Query(`
		SELECT sc.id, sc.script_id, sc.name, sc.enabled, sc.mode, sc.simple_config_json,
		       sc.cron_expr, sc.allow_concurrent, COALESCE(sc.last_run_at, ''), sc.last_status,
		       sc.created_at, sc.updated_at, COALESCE(sp.name, '')
		FROM schedules sc
		LEFT JOIN scripts sp ON sp.id = sc.script_id
		ORDER BY sc.enabled DESC, sc.id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]model.ScheduleView, 0)
	for rows.Next() {
		v, err := s.scanScheduleView(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetScheduleByScript returns the primary schedule configured for a script (or nil if none).
func (s *ScheduleService) GetScheduleByScript(scriptID int64) (*model.ScheduleView, error) {
	row := s.store.DB.QueryRow(`
		SELECT sc.id, sc.script_id, sc.name, sc.enabled, sc.mode, sc.simple_config_json,
		       sc.cron_expr, sc.allow_concurrent, COALESCE(sc.last_run_at, ''), sc.last_status,
		       sc.created_at, sc.updated_at, COALESCE(sp.name, '')
		FROM schedules sc
		LEFT JOIN scripts sp ON sp.id = sc.script_id
		WHERE sc.script_id = ?
		ORDER BY sc.id ASC LIMIT 1
	`, scriptID)
	v, err := s.scanScheduleView(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// SaveSchedule creates or updates a schedule rule, validates its Cron, and hot-reloads the scheduler.
func (s *ScheduleService) SaveSchedule(input model.ScheduleInput) (model.ScheduleView, error) {
	if input.ScriptID <= 0 {
		return model.ScheduleView{}, errors.New("必须关联一个有效脚本")
	}

	mode := "simple"
	if input.Mode == "cron" {
		mode = "cron"
	}

	cronExpr := strings.TrimSpace(input.CronExpr)
	if mode == "simple" {
		built, err := scheduler.BuildCronFromSimple(input.SimpleConfig)
		if err != nil {
			return model.ScheduleView{}, err
		}
		cronExpr = built
	}
	if _, err := scheduler.ValidateAndPreview(cronExpr, 1); err != nil {
		return model.ScheduleView{}, err
	}

	simpleBytes, _ := json.Marshal(input.SimpleConfig)
	simpleJSON := string(simpleBytes)

	// Upsert by ID or existing schedule for this script (1 primary schedule per script for clean UX)
	targetID := input.ID
	if targetID == 0 {
		_ = s.store.DB.QueryRow(`SELECT id FROM schedules WHERE script_id = ? ORDER BY id ASC LIMIT 1`, input.ScriptID).Scan(&targetID)
	}

	if targetID > 0 {
		_, err := s.store.DB.Exec(`
			UPDATE schedules
			SET name = ?, enabled = ?, mode = ?, simple_config_json = ?, cron_expr = ?,
			    allow_concurrent = ?, updated_at = datetime('now', 'localtime')
			WHERE id = ?
		`, strings.TrimSpace(input.Name), boolToInt(input.Enabled), mode, simpleJSON, cronExpr,
			boolToInt(input.AllowConcurrent), targetID)
		if err != nil {
			return model.ScheduleView{}, fmt.Errorf("更新定时规则失败: %w", err)
		}
	} else {
		res, err := s.store.DB.Exec(`
			INSERT INTO schedules (script_id, name, enabled, mode, simple_config_json, cron_expr, allow_concurrent)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, input.ScriptID, strings.TrimSpace(input.Name), boolToInt(input.Enabled), mode, simpleJSON,
			cronExpr, boolToInt(input.AllowConcurrent))
		if err != nil {
			return model.ScheduleView{}, fmt.Errorf("创建定时规则失败: %w", err)
		}
		targetID, _ = res.LastInsertId()
	}

	view, err := s.getScheduleByID(targetID)
	if err != nil {
		return model.ScheduleView{}, err
	}
	if err := s.manager.SyncSchedule(view.ScheduleItem); err != nil {
		return model.ScheduleView{}, err
	}
	view.NextRunAt = s.manager.NextRunAt(view.ID)
	s.broadcastState()
	return view, nil
}

// ToggleSchedule enables or disables a single schedule rule live.
func (s *ScheduleService) ToggleSchedule(id int64, enabled bool) (model.ScheduleView, error) {
	if _, err := s.store.DB.Exec(`
		UPDATE schedules SET enabled = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
	`, boolToInt(enabled), id); err != nil {
		return model.ScheduleView{}, err
	}
	view, err := s.getScheduleByID(id)
	if err != nil {
		return model.ScheduleView{}, err
	}
	if err := s.manager.SyncSchedule(view.ScheduleItem); err != nil {
		return model.ScheduleView{}, err
	}
	view.NextRunAt = s.manager.NextRunAt(view.ID)
	s.broadcastState()
	return view, nil
}

// DeleteSchedule deletes a schedule rule and removes it from the live cron engine.
func (s *ScheduleService) DeleteSchedule(id int64) error {
	s.manager.RemoveSchedule(id)
	if _, err := s.store.DB.Exec(`DELETE FROM schedules WHERE id = ?`, id); err != nil {
		return err
	}
	s.broadcastState()
	return nil
}

// PreviewCron validates a Cron expression and returns the next N trigger times.
func (s *ScheduleService) PreviewCron(expr string, count int) ([]string, error) {
	return scheduler.ValidateAndPreview(expr, count)
}

// BuildCronFromSimple builds a standard Cron expression from a visual simple config.
func (s *ScheduleService) BuildCronFromSimple(cfg model.SimpleScheduleConfig) (string, error) {
	return scheduler.BuildCronFromSimple(cfg)
}

// SetGlobalPaused pauses or resumes all scheduled jobs globally (synced with tray and UI).
func (s *ScheduleService) SetGlobalPaused(paused bool) (model.SchedulerState, error) {
	s.manager.SetPaused(paused)
	if s.settings != nil {
		if err := s.settings.UpdateField(func(cfg *model.AppSettings) {
			cfg.SchedulerPaused = paused
		}); err != nil {
			return s.GetSchedulerState(), err
		}
	}
	if s.windowSvc != nil {
		s.windowSvc.SyncExternalTray()
	}
	s.broadcastState()
	return s.GetSchedulerState(), nil
}

// SyncPausedFromExternal updates the live cron manager when tray/window toggles pause state.
//
//wails:ignore
func (s *ScheduleService) SyncPausedFromExternal(paused bool) {
	s.manager.SetPaused(paused)
	s.broadcastState()
}

// GetSchedulerState returns a complete snapshot of global pause flag, active job count, and all schedules.
func (s *ScheduleService) GetSchedulerState() model.SchedulerState {
	list, _ := s.ListSchedules()
	return model.SchedulerState{
		GlobalPaused: s.manager.IsPaused(),
		ActiveCount:  s.manager.ActiveCount(),
		Schedules:    list,
	}
}

func (s *ScheduleService) getScheduleByID(id int64) (model.ScheduleView, error) {
	row := s.store.DB.QueryRow(`
		SELECT sc.id, sc.script_id, sc.name, sc.enabled, sc.mode, sc.simple_config_json,
		       sc.cron_expr, sc.allow_concurrent, COALESCE(sc.last_run_at, ''), sc.last_status,
		       sc.created_at, sc.updated_at, COALESCE(sp.name, '')
		FROM schedules sc
		LEFT JOIN scripts sp ON sp.id = sc.script_id
		WHERE sc.id = ?
	`, id)
	return s.scanScheduleView(row)
}

func (s *ScheduleService) scanScheduleView(r rowScanner) (model.ScheduleView, error) {
	var v model.ScheduleView
	var enabled, allowConc int
	err := r.Scan(
		&v.ID, &v.ScriptID, &v.Name, &enabled, &v.Mode, &v.SimpleConfigJSON,
		&v.CronExpr, &allowConc, &v.LastRunAt, &v.LastStatus,
		&v.CreatedAt, &v.UpdatedAt, &v.ScriptName,
	)
	if err != nil {
		return model.ScheduleView{}, err
	}
	v.Enabled = enabled != 0
	v.AllowConcurrent = allowConc != 0
	if v.SimpleConfigJSON != "" {
		_ = json.Unmarshal([]byte(v.SimpleConfigJSON), &v.SimpleConfig)
	}
	if v.SimpleConfig.Kind == "" {
		v.SimpleConfig = model.SimpleScheduleConfig{
			Kind:     "daily",
			Minutes:  30,
			Hour:     9,
			Minute:   0,
			Weekdays: []int{1, 2, 3, 4, 5},
		}
	}
	v.NextRunAt = s.manager.NextRunAt(v.ID)
	return v, nil
}

func (s *ScheduleService) broadcastState() {
	s.mu.RLock()
	app := s.app
	s.mu.RUnlock()
	if app != nil {
		app.Event.Emit(model.EventScheduleChanged, s.GetSchedulerState())
	}
}

func (s *ScheduleService) emitToast(level, msg string) {
	s.mu.RLock()
	app := s.app
	s.mu.RUnlock()
	if app != nil {
		app.Event.Emit(model.EventToast, model.ToastPayload{Level: level, Message: msg})
	}
}
