package service

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/winapi"
)

// AppService manages application categories, launcher shortcuts, drag-and-drop import,
// async icon extraction/caching, Markdown notes, and launching (including runas).
type AppService struct {
	mu        sync.RWMutex
	store     *db.Store
	paths     *config.Paths
	app       *application.App
	mainWin   *application.WebviewWindow
	windowSvc *WindowService
}

func NewAppService(store *db.Store, paths *config.Paths, windowSvc *WindowService) *AppService {
	return &AppService{
		store:     store,
		paths:     paths,
		windowSvc: windowSvc,
	}
}

// Attach connects Wails runtime and main window for dialogs and async events.
//
//wails:ignore
func (s *AppService) Attach(app *application.App, mainWin *application.WebviewWindow) {
	s.mu.Lock()
	s.app = app
	s.mainWin = mainWin
	s.mu.Unlock()
}

// --- Categories ---

// ListCategories returns all categories ordered by sort_order with their app counts.
func (s *AppService) ListCategories() ([]model.Category, error) {
	rows, err := s.store.DB.Query(`
		SELECT c.id, c.name, c.icon, c.color, c.sort_order, c.created_at, c.updated_at,
		       COUNT(a.id) AS app_count
		FROM categories c
		LEFT JOIN apps a ON a.category_id = c.id
		GROUP BY c.id
		ORDER BY c.sort_order ASC, c.id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]model.Category, 0)
	for rows.Next() {
		var c model.Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Icon, &c.Color, &c.SortOrder, &c.CreatedAt, &c.UpdatedAt, &c.AppCount); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

// SaveCategory creates or updates a category.
func (s *AppService) SaveCategory(input model.CategoryInput) (model.Category, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return model.Category{}, errors.New("分类名称不能为空")
	}
	icon := strings.TrimSpace(input.Icon)
	if icon == "" {
		icon = "🐾"
	}
	color := strings.TrimSpace(input.Color)
	if color == "" {
		color = "#FF9EB5"
	}

	var id int64
	if input.ID > 0 {
		_, err := s.store.DB.Exec(`
			UPDATE categories
			SET name = ?, icon = ?, color = ?, sort_order = ?, updated_at = datetime('now', 'localtime')
			WHERE id = ?
		`, name, icon, color, input.SortOrder, input.ID)
		if err != nil {
			return model.Category{}, fmt.Errorf("更新分类失败: %w", err)
		}
		id = input.ID
	} else {
		sortOrder := input.SortOrder
		if sortOrder == 0 {
			_ = s.store.DB.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories`).Scan(&sortOrder)
		}
		res, err := s.store.DB.Exec(`
			INSERT INTO categories (name, icon, color, sort_order)
			VALUES (?, ?, ?, ?)
		`, name, icon, color, sortOrder)
		if err != nil {
			return model.Category{}, fmt.Errorf("创建分类失败（名称可能重复）: %w", err)
		}
		id, _ = res.LastInsertId()
	}

	var out model.Category
	err := s.store.DB.QueryRow(`
		SELECT c.id, c.name, c.icon, c.color, c.sort_order, c.created_at, c.updated_at,
		       (SELECT COUNT(*) FROM apps a WHERE a.category_id = c.id)
		FROM categories c WHERE c.id = ?
	`, id).Scan(&out.ID, &out.Name, &out.Icon, &out.Color, &out.SortOrder, &out.CreatedAt, &out.UpdatedAt, &out.AppCount)
	return out, err
}

// DeleteCategory removes a category (member apps become uncategorized).
func (s *AppService) DeleteCategory(id int64) error {
	_, err := s.store.DB.Exec(`DELETE FROM categories WHERE id = ?`, id)
	return err
}

// ReorderCategories updates sort_order according to the ordered ID slice.
func (s *AppService) ReorderCategories(ids []int64) error {
	tx, err := s.store.DB.Begin()
	if err != nil {
		return err
	}
	for idx, id := range ids {
		if _, err := tx.Exec(`UPDATE categories SET sort_order = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, idx+1, id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// --- Apps ---

// ListApps returns apps matching category, pinned filter, and fuzzy keyword search
// across name, tags, target_path, and Markdown notes.
func (s *AppService) ListApps(filter model.AppFilter) ([]model.AppItem, error) {
	var conds []string
	var args []any

	if filter.CategoryID != nil && *filter.CategoryID > 0 {
		conds = append(conds, "category_id = ?")
		args = append(args, *filter.CategoryID)
	}
	if filter.OnlyPinned {
		conds = append(conds, "is_pinned = 1")
	}
	kw := strings.TrimSpace(filter.Keyword)
	if kw != "" {
		like := "%" + kw + "%"
		conds = append(conds, "(name LIKE ? OR tags LIKE ? OR notes_md LIKE ? OR target_path LIKE ?)")
		args = append(args, like, like, like, like)
	}

	query := `
		SELECT id, category_id, name, target_path, arguments, working_dir,
		       icon_type, icon_value, run_as_admin, tags, notes_md,
		       click_count, is_pinned, sort_order, COALESCE(last_launched_at, ''),
		       created_at, updated_at
		FROM apps
	`
	if len(conds) > 0 {
		query += " WHERE " + strings.Join(conds, " AND ")
	}
	query += " ORDER BY is_pinned DESC, sort_order ASC, click_count DESC, id DESC"

	rows, err := s.store.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]model.AppItem, 0)
	for rows.Next() {
		item, err := scanAppRow(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

// GetApp returns a single app entry by ID.
func (s *AppService) GetApp(id int64) (model.AppItem, error) {
	row := s.store.DB.QueryRow(`
		SELECT id, category_id, name, target_path, arguments, working_dir,
		       icon_type, icon_value, run_as_admin, tags, notes_md,
		       click_count, is_pinned, sort_order, COALESCE(last_launched_at, ''),
		       created_at, updated_at
		FROM apps WHERE id = ?
	`, id)
	return scanAppRow(row)
}

// SaveApp creates or updates an application shortcut.
func (s *AppService) SaveApp(input model.AppInput) (model.AppItem, error) {
	name := strings.TrimSpace(input.Name)
	target := strings.TrimSpace(input.TargetPath)
	if name == "" {
		return model.AppItem{}, errors.New("应用名称不能为空")
	}
	if target == "" {
		return model.AppItem{}, errors.New("目标路径不能为空")
	}

	iconType := normalizeIconType(input.IconType)
	iconValue := strings.TrimSpace(input.IconValue)
	runAsAdmin := boolToInt(input.RunAsAdmin)
	isPinned := boolToInt(input.IsPinned)

	var catVal any
	if input.CategoryID != nil && *input.CategoryID > 0 {
		catVal = *input.CategoryID
	}

	var id int64
	if input.ID > 0 {
		_, err := s.store.DB.Exec(`
			UPDATE apps
			SET category_id = ?, name = ?, target_path = ?, arguments = ?, working_dir = ?,
			    icon_type = ?, icon_value = ?, run_as_admin = ?, tags = ?, notes_md = ?,
			    is_pinned = ?, sort_order = ?, updated_at = datetime('now', 'localtime')
			WHERE id = ?
		`, catVal, name, target, strings.TrimSpace(input.Arguments), strings.TrimSpace(input.WorkingDir),
			iconType, iconValue, runAsAdmin, strings.TrimSpace(input.Tags), input.NotesMD,
			isPinned, input.SortOrder, input.ID)
		if err != nil {
			return model.AppItem{}, fmt.Errorf("更新应用失败: %w", err)
		}
		id = input.ID
	} else {
		res, err := s.store.DB.Exec(`
			INSERT INTO apps (
				category_id, name, target_path, arguments, working_dir,
				icon_type, icon_value, run_as_admin, tags, notes_md,
				is_pinned, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, catVal, name, target, strings.TrimSpace(input.Arguments), strings.TrimSpace(input.WorkingDir),
			iconType, iconValue, runAsAdmin, strings.TrimSpace(input.Tags), input.NotesMD,
			isPinned, input.SortOrder)
		if err != nil {
			return model.AppItem{}, fmt.Errorf("添加应用失败: %w", err)
		}
		id, _ = res.LastInsertId()
	}

	// If iconType is extracted and no icon cached yet, extract asynchronously.
	if iconType == "extracted" && iconValue == "" {
		s.extractIconAsync(id, target, "", 0)
	}

	return s.GetApp(id)
}

// UpdateAppNotes updates only the Markdown usage notes/shortcuts memo for an app.
func (s *AppService) UpdateAppNotes(id int64, notesMD string) error {
	_, err := s.store.DB.Exec(`
		UPDATE apps SET notes_md = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
	`, notesMD, id)
	return err
}

// DeleteApp deletes an application shortcut.
func (s *AppService) DeleteApp(id int64) error {
	_, err := s.store.DB.Exec(`DELETE FROM apps WHERE id = ?`, id)
	return err
}

// TogglePinApp toggles the pinned flag and returns the updated state.
func (s *AppService) TogglePinApp(id int64) (bool, error) {
	var cur int
	if err := s.store.DB.QueryRow(`SELECT is_pinned FROM apps WHERE id = ?`, id).Scan(&cur); err != nil {
		return false, err
	}
	next := 1
	if cur != 0 {
		next = 0
	}
	if _, err := s.store.DB.Exec(`UPDATE apps SET is_pinned = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`, next, id); err != nil {
		return false, err
	}
	return next == 1, nil
}

// ImportDroppedPaths resolves dropped Windows files (.exe, .lnk, folders, etc.),
// inserts them into SQLite immediately, and extracts high-res PNG icons asynchronously.
func (s *AppService) ImportDroppedPaths(paths []string, categoryID *int64) ([]model.AppItem, error) {
	imported := make([]model.AppItem, 0, len(paths))
	for _, raw := range paths {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}

		name := deriveAppName(p)
		target := p
		args := ""
		workDir := ""
		iconLoc := ""
		iconIdx := 0
		notes := ""
		tags := ""

		ext := strings.ToLower(filepath.Ext(p))
		if ext == ".lnk" {
			if info, err := winapi.ParseLnk(p); err == nil {
				if info.TargetPath != "" {
					target = info.TargetPath
				}
				args = info.Arguments
				workDir = info.WorkingDir
				iconLoc = info.IconLocation
				iconIdx = info.IconIndex
				if info.Description != "" {
					notes = info.Description
				}
			}
		}

		if info, err := os.Stat(target); err == nil {
			if info.IsDir() {
				tags = "文件夹"
				if workDir == "" {
					workDir = target
				}
			} else if workDir == "" {
				workDir = filepath.Dir(target)
			}
		}

		item, err := s.SaveApp(model.AppInput{
			CategoryID: categoryID,
			Name:       name,
			TargetPath: target,
			Arguments:  args,
			WorkingDir: workDir,
			IconType:   "extracted",
			IconValue:  "",
			Tags:       tags,
			NotesMD:    notes,
		})
		if err != nil {
			continue
		}

		// Always extract with lnk iconLocation hint when available.
		if iconLoc != "" {
			s.extractIconAsync(item.ID, target, iconLoc, iconIdx)
		}
		imported = append(imported, item)
	}
	return imported, nil
}

// ExtractIconForPath synchronously extracts and caches a PNG icon for the given path.
func (s *AppService) ExtractIconForPath(targetPath string) (string, error) {
	p := strings.TrimSpace(targetPath)
	if p == "" {
		return "", errors.New("路径不能为空")
	}
	iconLoc := ""
	iconIdx := 0
	if strings.EqualFold(filepath.Ext(p), ".lnk") {
		if info, err := winapi.ParseLnk(p); err == nil {
			if info.TargetPath != "" {
				p = info.TargetPath
			}
			iconLoc = info.IconLocation
			iconIdx = info.IconIndex
		}
	}
	return winapi.ExtractIconToPNG(p, iconLoc, iconIdx, s.paths.IconsDir)
}

// PickCustomIcon opens a native file dialog to choose a local PNG/JPG/ICO icon and caches it.
func (s *AppService) PickCustomIcon() (string, error) {
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
		SetTitle("选择自定义应用图标").
		CanChooseFiles(true).
		CanChooseDirectories(false).
		AddFilter("图片与图标 (*.png;*.jpg;*.jpeg;*.ico;*.gif)", "*.png;*.jpg;*.jpeg;*.ico;*.gif").
		AddFilter("所有文件 (*.*)", "*.*")
	if mainWin != nil {
		dlg.AttachToWindow(mainWin)
	}

	chosen, err := dlg.PromptForSingleSelection()
	if err != nil || strings.TrimSpace(chosen) == "" {
		return "", nil
	}
	return winapi.ImportCustomImageIcon(chosen, s.paths.IconsDir)
}

// PickTargetFile opens a native file or folder picker ("file" | "dir").
func (s *AppService) PickTargetFile(mode string) (string, error) {
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

	dlg := app.Dialog.OpenFile()
	if mode == "dir" {
		dlg.SetTitle("选择目标文件夹").
			CanChooseFiles(false).
			CanChooseDirectories(true)
	} else {
		dlg.SetTitle("选择可执行程序或快捷方式").
			CanChooseFiles(true).
			CanChooseDirectories(false).
			AddFilter("可执行文件与快捷方式 (*.exe;*.lnk;*.bat;*.cmd)", "*.exe;*.lnk;*.bat;*.cmd").
			AddFilter("所有文件 (*.*)", "*.*")
	}
	if mainWin != nil {
		dlg.AttachToWindow(mainWin)
	}

	chosen, err := dlg.PromptForSingleSelection()
	if err != nil {
		return "", nil
	}
	return strings.TrimSpace(chosen), nil
}

// LaunchApp launches the application shortcut, increments click_count, and updates last_launched_at.
func (s *AppService) LaunchApp(id int64, forceAdmin bool) error {
	item, err := s.GetApp(id)
	if err != nil {
		return fmt.Errorf("未找到该应用: %w", err)
	}

	if err := winapi.LaunchTarget(item.TargetPath, item.Arguments, item.WorkingDir, item.RunAsAdmin || forceAdmin); err != nil {
		return err
	}

	_, _ = s.store.DB.Exec(`
		UPDATE apps
		SET click_count = click_count + 1,
		    last_launched_at = datetime('now', 'localtime'),
		    updated_at = datetime('now', 'localtime')
		WHERE id = ?
	`, id)
	return nil
}

// OpenAppFolder reveals the app's target executable/folder in Windows Explorer.
func (s *AppService) OpenAppFolder(id int64) error {
	item, err := s.GetApp(id)
	if err != nil {
		return err
	}
	return winapi.RevealInExplorer(item.TargetPath)
}

func (s *AppService) extractIconAsync(appID int64, targetPath, iconLoc string, iconIdx int) {
	go func() {
		fileName, err := winapi.ExtractIconToPNG(targetPath, iconLoc, iconIdx, s.paths.IconsDir)
		if err != nil || fileName == "" {
			return
		}
		_, _ = s.store.DB.Exec(`
			UPDATE apps SET icon_type = 'extracted', icon_value = ?, updated_at = datetime('now', 'localtime')
			WHERE id = ? AND icon_type = 'extracted'
		`, fileName, appID)

		s.mu.RLock()
		app := s.app
		s.mu.RUnlock()
		if app != nil {
			app.Event.Emit(model.EventIconReady, model.IconReadyPayload{
				AppID:     appID,
				IconType:  "extracted",
				IconValue: fileName,
			})
		}
	}()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanAppRow(r rowScanner) (model.AppItem, error) {
	var item model.AppItem
	var catID sql.NullInt64
	var runAdmin, pinned int
	err := r.Scan(
		&item.ID, &catID, &item.Name, &item.TargetPath, &item.Arguments, &item.WorkingDir,
		&item.IconType, &item.IconValue, &runAdmin, &item.Tags, &item.NotesMD,
		&item.ClickCount, &pinned, &item.SortOrder, &item.LastLaunchedAt,
		&item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return model.AppItem{}, err
	}
	if catID.Valid {
		v := catID.Int64
		item.CategoryID = &v
	}
	item.RunAsAdmin = runAdmin != 0
	item.IsPinned = pinned != 0
	return item, nil
}

func deriveAppName(p string) string {
	cleaned := filepath.Clean(p)
	base := filepath.Base(cleaned)
	ext := filepath.Ext(base)
	if ext != "" && len(ext) < len(base) {
		// Preserve folder names that happen to contain dots if it's a directory.
		if st, err := os.Stat(cleaned); err != nil || !st.IsDir() {
			base = strings.TrimSuffix(base, ext)
		}
	}
	if base == "" || base == "." || base == `\` {
		return cleaned
	}
	return base
}

func normalizeIconType(t string) string {
	switch t {
	case "extracted", "custom", "emoji":
		return t
	default:
		return "extracted"
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
