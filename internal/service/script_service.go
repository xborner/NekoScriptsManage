package service

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/runner"
	"nekomanage/internal/winapi"
)

// ScriptService manages local and inline scripts and delegates execution to runner.Engine.
type ScriptService struct {
	mu        sync.RWMutex
	store     *db.Store
	paths     *config.Paths
	engine    *runner.Engine
	app       *application.App
	mainWin   *application.WebviewWindow
	windowSvc *WindowService
}

func NewScriptService(store *db.Store, paths *config.Paths, engine *runner.Engine, windowSvc *WindowService) *ScriptService {
	// Recover any orphaned 'running' states from an abrupt process crash.
	_, _ = store.DB.Exec(`UPDATE scripts SET last_status = 'killed' WHERE last_status = 'running'`)
	_, _ = store.DB.Exec(`
		UPDATE script_logs
		SET status = 'killed', finished_at = datetime('now', 'localtime'),
		    error_message = '上次程序异常退出，任务已中断'
		WHERE status = 'running'
	`)
	return &ScriptService{
		store:     store,
		paths:     paths,
		engine:    engine,
		windowSvc: windowSvc,
	}
}

// Attach connects the Wails runtime for file dialogs and event emission.
//
//wails:ignore
func (s *ScriptService) Attach(app *application.App, mainWin *application.WebviewWindow) {
	s.mu.Lock()
	s.app = app
	s.mainWin = mainWin
	s.mu.Unlock()
}

// ListScripts lists scripts optionally filtered by keyword and type, enriched with live running status.
func (s *ScriptService) ListScripts(keyword string, scriptType string) ([]model.ScriptItem, error) {
	var conds []string
	var args []any

	if st := strings.TrimSpace(scriptType); st != "" && st != "all" {
		if st == "pinned" {
			conds = append(conds, "is_pinned = 1")
		} else {
			conds = append(conds, "script_type = ?")
			args = append(args, st)
		}
	}
	if kw := strings.TrimSpace(keyword); kw != "" {
		like := "%" + kw + "%"
		conds = append(conds, "(name LIKE ? OR description LIKE ? OR tags LIKE ? OR file_path LIKE ? OR custom_command LIKE ?)")
		args = append(args, like, like, like, like, like)
	}

	q := `
		SELECT id, name, description, script_type, source_mode, file_path,
		       inline_content, custom_command, arguments, working_dir,
		       run_in_terminal, run_as_admin, timeout_sec, tags, is_pinned,
		       sort_order, COALESCE(last_run_at, ''), last_status, created_at, updated_at
		FROM scripts
	`
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += " ORDER BY is_pinned DESC, sort_order ASC, id DESC"

	rows, err := s.store.DB.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]model.ScriptItem, 0)
	for rows.Next() {
		item, err := scanScriptRow(rows)
		if err != nil {
			return nil, err
		}
		if logID, running := s.engine.Registry().RunningLogIDForScript(item.ID); running {
			item.IsRunning = true
			item.RunningLogID = logID
			item.LastStatus = "running"
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

// GetScript returns full details for a single script.
func (s *ScriptService) GetScript(id int64) (model.ScriptItem, error) {
	row := s.store.DB.QueryRow(`
		SELECT id, name, description, script_type, source_mode, file_path,
		       inline_content, custom_command, arguments, working_dir,
		       run_in_terminal, run_as_admin, timeout_sec, tags, is_pinned,
		       sort_order, COALESCE(last_run_at, ''), last_status, created_at, updated_at
		FROM scripts WHERE id = ?
	`, id)
	item, err := scanScriptRow(row)
	if err != nil {
		return model.ScriptItem{}, err
	}
	if logID, running := s.engine.Registry().RunningLogIDForScript(item.ID); running {
		item.IsRunning = true
		item.RunningLogID = logID
		item.LastStatus = "running"
	}
	return item, nil
}

// SaveScript creates or updates a script, synchronizing inline content to portable ./data/scripts/.
func (s *ScriptService) SaveScript(input model.ScriptInput) (model.ScriptItem, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return model.ScriptItem{}, errors.New("脚本名称不能为空")
	}

	scriptType := normalizeScriptType(input.ScriptType)
	sourceMode := normalizeSourceMode(input.SourceMode)
	filePath := strings.TrimSpace(input.FilePath)
	customCmd := strings.TrimSpace(input.CustomCommand)

	if sourceMode == "file" && filePath == "" && !(scriptType == "custom" && customCmd != "") {
		return model.ScriptItem{}, errors.New("请选择或填写外部脚本文件路径")
	}
	if sourceMode == "inline" && strings.TrimSpace(input.InlineContent) == "" && !(scriptType == "custom" && customCmd != "") {
		return model.ScriptItem{}, errors.New("内联脚本代码不能为空")
	}

	timeoutSec := input.TimeoutSec
	if timeoutSec < 0 {
		timeoutSec = 0
	}

	var id int64
	if input.ID > 0 {
		_, err := s.store.DB.Exec(`
			UPDATE scripts
			SET name = ?, description = ?, script_type = ?, source_mode = ?, file_path = ?,
			    inline_content = ?, custom_command = ?, arguments = ?, working_dir = ?,
			    run_in_terminal = ?, run_as_admin = ?, timeout_sec = ?, tags = ?,
			    is_pinned = ?, sort_order = ?, updated_at = datetime('now', 'localtime')
			WHERE id = ?
		`, name, strings.TrimSpace(input.Description), scriptType, sourceMode, filePath,
			input.InlineContent, customCmd, strings.TrimSpace(input.Arguments), strings.TrimSpace(input.WorkingDir),
			boolToInt(input.RunInTerminal), boolToInt(input.RunAsAdmin), timeoutSec, strings.TrimSpace(input.Tags),
			boolToInt(input.IsPinned), input.SortOrder, input.ID)
		if err != nil {
			return model.ScriptItem{}, fmt.Errorf("更新脚本失败: %w", err)
		}
		id = input.ID
	} else {
		res, err := s.store.DB.Exec(`
			INSERT INTO scripts (
				name, description, script_type, source_mode, file_path,
				inline_content, custom_command, arguments, working_dir,
				run_in_terminal, run_as_admin, timeout_sec, tags, is_pinned, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, name, strings.TrimSpace(input.Description), scriptType, sourceMode, filePath,
			input.InlineContent, customCmd, strings.TrimSpace(input.Arguments), strings.TrimSpace(input.WorkingDir),
			boolToInt(input.RunInTerminal), boolToInt(input.RunAsAdmin), timeoutSec, strings.TrimSpace(input.Tags),
			boolToInt(input.IsPinned), input.SortOrder)
		if err != nil {
			return model.ScriptItem{}, fmt.Errorf("创建脚本失败: %w", err)
		}
		id, _ = res.LastInsertId()
	}

	// Sync inline script mirror file into portable ./data/scripts/
	if sourceMode == "inline" && strings.TrimSpace(input.InlineContent) != "" {
		relName := fmt.Sprintf("script_%d%s", id, runner.ScriptFileExt(scriptType))
		absPath := filepath.Join(s.paths.ScriptsDir, relName)
		_ = os.WriteFile(absPath, []byte(input.InlineContent), 0o644)
		_, _ = s.store.DB.Exec(`UPDATE scripts SET file_path = ? WHERE id = ?`, relName, id)
	}

	return s.GetScript(id)
}

// DeleteScript stops any running execution of this script, removes its DB row and inline file mirror.
func (s *ScriptService) DeleteScript(id int64) error {
	s.engine.Registry().KillByScriptID(id)

	var sourceMode, filePath string
	_ = s.store.DB.QueryRow(`SELECT source_mode, file_path FROM scripts WHERE id = ?`, id).Scan(&sourceMode, &filePath)

	if _, err := s.store.DB.Exec(`DELETE FROM scripts WHERE id = ?`, id); err != nil {
		return err
	}
	if sourceMode == "inline" && filePath != "" {
		_ = os.Remove(filepath.Join(s.paths.ScriptsDir, filepath.Base(filePath)))
	}
	return nil
}

// TogglePinScript toggles pinned state for a script.
func (s *ScriptService) TogglePinScript(id int64) (bool, error) {
	var cur int
	if err := s.store.DB.QueryRow(`SELECT is_pinned FROM scripts WHERE id = ?`, id).Scan(&cur); err != nil {
		return false, err
	}
	next := 1
	if cur != 0 {
		next = 0
	}
	if _, err := s.store.DB.Exec(`UPDATE scripts SET is_pinned = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, next, id); err != nil {
		return false, err
	}
	return next == 1, nil
}

// PickScriptFile opens a native Windows file picker for associating an external script.
func (s *ScriptService) PickScriptFile() (string, error) {
	s.mu.RLock()
	app := s.app
	mainWin := s.mainWin
	s.mu.RUnlock()
	if app == nil {
		return "", errors.New("application not initialized")
	}

	if s.windowSvc != nil {
		s.windowSvc.SuppressBlurHide(true)
		defer s.windowSvc.SuppressBlurHide(false)
	}

	dlg := app.Dialog.OpenFile().
		SetTitle("选择外部脚本文件").
		CanChooseFiles(true).
		CanChooseDirectories(false).
		AddFilter("脚本文件 (*.bat;*.cmd;*.ps1;*.py;*.sh)", "*.bat;*.cmd;*.ps1;*.py;*.sh").
		AddFilter("所有文件 (*.*)", "*.*")
	if mainWin != nil {
		dlg.AttachToWindow(mainWin)
	}
	chosen, err := dlg.PromptForSingleSelection()
	if err != nil {
		return "", nil
	}
	return strings.TrimSpace(chosen), nil
}

// PickScriptWorkingDir opens a native folder picker for script working directory.
func (s *ScriptService) PickScriptWorkingDir() (string, error) {
	s.mu.RLock()
	app := s.app
	mainWin := s.mainWin
	s.mu.RUnlock()
	if app == nil {
		return "", errors.New("application not initialized")
	}

	if s.windowSvc != nil {
		s.windowSvc.SuppressBlurHide(true)
		defer s.windowSvc.SuppressBlurHide(false)
	}

	dlg := app.Dialog.OpenFile().
		SetTitle("选择脚本工作目录").
		CanChooseFiles(false).
		CanChooseDirectories(true)
	if mainWin != nil {
		dlg.AttachToWindow(mainWin)
	}
	chosen, err := dlg.PromptForSingleSelection()
	if err != nil {
		return "", nil
	}
	return strings.TrimSpace(chosen), nil
}

// ReadExternalFilePreview reads up to 64KB of an external script for read-only UI preview (auto GB18030/UTF-8 decoded).
func (s *ScriptService) ReadExternalFilePreview(filePath string) (string, error) {
	p := strings.TrimSpace(filePath)
	if p == "" {
		return "", errors.New("文件路径为空")
	}
	f, err := os.Open(p)
	if err != nil {
		return "", fmt.Errorf("无法读取文件: %w", err)
	}
	defer f.Close()

	raw, err := io.ReadAll(io.LimitReader(f, 64*1024))
	if err != nil {
		return "", err
	}
	return winapi.DecodeWindowsOutput(raw), nil
}

// RunScript starts executing a script asynchronously and immediately returns the new log ID.
func (s *ScriptService) RunScript(id int64) (int64, error) {
	script, err := s.GetScript(id)
	if err != nil {
		return 0, fmt.Errorf("未找到脚本: %w", err)
	}
	return s.engine.Start(script, "manual", nil)
}

// StopScript forcibly terminates a running script and its entire child process tree by log ID.
func (s *ScriptService) StopScript(logID int64) error {
	return s.engine.Stop(logID)
}

// ListRunningTasks returns all currently executing script tasks.
func (s *ScriptService) ListRunningTasks() []model.RunningTask {
	return s.engine.Registry().List()
}

func scanScriptRow(r rowScanner) (model.ScriptItem, error) {
	var item model.ScriptItem
	var runTerm, runAdmin, pinned int
	err := r.Scan(
		&item.ID, &item.Name, &item.Description, &item.ScriptType, &item.SourceMode, &item.FilePath,
		&item.InlineContent, &item.CustomCommand, &item.Arguments, &item.WorkingDir,
		&runTerm, &runAdmin, &item.TimeoutSec, &item.Tags, &pinned,
		&item.SortOrder, &item.LastRunAt, &item.LastStatus, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return model.ScriptItem{}, err
	}
	item.RunInTerminal = runTerm != 0
	item.RunAsAdmin = runAdmin != 0
	item.IsPinned = pinned != 0
	return item, nil
}

func normalizeScriptType(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "bat", "cmd", "ps1", "py", "custom":
		return strings.ToLower(strings.TrimSpace(t))
	default:
		return "bat"
	}
}

func normalizeSourceMode(m string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "file", "inline":
		return strings.ToLower(strings.TrimSpace(m))
	default:
		return "inline"
	}
}
