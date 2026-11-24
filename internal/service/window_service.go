package service

import (
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"nekomanage/internal/model"
	"nekomanage/internal/winapi"
)

// WindowService coordinates the main launcher window, floating catgirl ball window,
// always-on-top pinning, focus-lost auto-hide, global hotkey binding, and tray sync.
type WindowService struct {
	mu               sync.Mutex
	app              *application.App
	mainWin          *application.WebviewWindow
	floatWin         *application.WebviewWindow
	settings         *SettingsService
	hotkey           *winapi.HotkeyManager
	hotkeyErr        string
	suppressBlurHide bool
	quitting         bool
	lastShowAt       time.Time
	snappingFloat    bool
	onSyncTray       func(state model.WindowState)
	onPauseChanged   func(paused bool)
}

func NewWindowService(settings *SettingsService) *WindowService {
	return &WindowService{
		settings: settings,
	}
}

// Attach connects Wails runtime windows and tray callback after application initialization.
//
//wails:ignore
func (w *WindowService) Attach(
	app *application.App,
	mainWin *application.WebviewWindow,
	floatWin *application.WebviewWindow,
	onSyncTray func(state model.WindowState),
) {
	w.mu.Lock()
	w.app = app
	w.mainWin = mainWin
	w.floatWin = floatWin
	w.onSyncTray = onSyncTray
	w.mu.Unlock()

	cfg := w.settings.GetSettings()

	// Start Windows global hotkey loop.
	hm := winapi.NewHotkeyManager(func() {
		w.ToggleMainWindow("hotkey")
	})
	w.mu.Lock()
	w.hotkey = hm
	w.mu.Unlock()

	if cfg.GlobalHotkey != "" {
		if err := hm.Register(cfg.GlobalHotkey); err != nil {
			w.mu.Lock()
			w.hotkeyErr = err.Error()
			w.mu.Unlock()
		}
	}

	// Apply initial always-on-top state.
	if cfg.AlwaysOnTop && mainWin != nil {
		mainWin.SetAlwaysOnTop(true)
	}
	w.applyFloatBallGeometry(cfg.FloatBallStyle)
	if cfg.FloatBallEnabled && floatWin != nil {
		floatWin.Show()
	}
	w.syncTrayAndEmit()
}

// Shutdown releases the global hotkey OS thread cleanly.
//
//wails:ignore
func (w *WindowService) Shutdown() {
	w.mu.Lock()
	hm := w.hotkey
	w.hotkey = nil
	w.mu.Unlock()
	if hm != nil {
		hm.Close()
	}
}

// IsQuitting returns true once user explicitly requested exit from tray or UI.
//
//wails:ignore
func (w *WindowService) IsQuitting() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.quitting
}

// QuitApp marks quitting and terminates the Wails application cleanly.
func (w *WindowService) QuitApp() {
	w.mu.Lock()
	w.quitting = true
	app := w.app
	w.mu.Unlock()

	w.Shutdown()
	if app != nil {
		app.Quit()
	}
}

// ShowMainWindow brings up and focuses the main panel, then focuses the search input.
func (w *WindowService) ShowMainWindow(source string) {
	w.mu.Lock()
	mw := w.mainWin
	app := w.app
	w.lastShowAt = time.Now()
	w.mu.Unlock()

	if mw == nil {
		return
	}
	mw.Show()
	mw.Focus()

	if app != nil {
		if source == "" {
			source = "api"
		}
		app.Event.Emit(model.EventWindowFocusSearch, model.FocusSearchPayload{Source: source})
	}
}

// HideMainWindow hides the main window to the system tray.
func (w *WindowService) HideMainWindow() {
	w.mu.Lock()
	mw := w.mainWin
	w.mu.Unlock()
	if mw != nil {
		mw.Hide()
	}
}

// ToggleMainWindow toggles visibility/focus of the main launcher window.
func (w *WindowService) ToggleMainWindow(source string) {
	w.mu.Lock()
	mw := w.mainWin
	w.mu.Unlock()
	if mw == nil {
		return
	}
	if mw.IsVisible() && mw.IsFocused() {
		mw.Hide()
		return
	}
	w.ShowMainWindow(source)
}

// HandleMainWindowBlur hides the main window if hide-on-blur is enabled and window is not pinned.
//
//wails:ignore
func (w *WindowService) HandleMainWindowBlur() {
	w.mu.Lock()
	suppress := w.suppressBlurHide
	sinceShow := time.Since(w.lastShowAt)
	mw := w.mainWin
	w.mu.Unlock()

	if suppress || sinceShow < 220*time.Millisecond || mw == nil {
		return
	}
	cfg := w.settings.GetSettings()
	if cfg.HideOnBlur && !cfg.AlwaysOnTop && mw.IsVisible() {
		mw.Hide()
	}
}

// SaveMainWindowPosition persists the last moved position of the main panel.
//
//wails:ignore
func (w *WindowService) SaveMainWindowPosition() {
	w.mu.Lock()
	mw := w.mainWin
	w.mu.Unlock()
	if mw == nil || !mw.IsVisible() {
		return
	}
	x, y := mw.Position()
	if x < -10000 || y < -10000 {
		return
	}
	_ = w.settings.UpdateField(func(s *model.AppSettings) {
		s.MainWinX = x
		s.MainWinY = y
	})
}

// SetPauseChangeHandler connects WindowService tray/toggle pause actions to ScheduleService.
//
//wails:ignore
func (w *WindowService) SetPauseChangeHandler(fn func(paused bool)) {
	w.mu.Lock()
	w.onPauseChanged = fn
	w.mu.Unlock()
}

// SyncExternalTray refreshes tray label/icon and emits window:state-changed when updated externally.
//
//wails:ignore
func (w *WindowService) SyncExternalTray() {
	w.syncTrayAndEmit()
}

// SaveFloatBallPosition clamps/snaps the floating ball to screen edges and persists its position.
//
//wails:ignore
func (w *WindowService) SaveFloatBallPosition() {
	w.mu.Lock()
	fw := w.floatWin
	if w.snappingFloat || fw == nil || !fw.IsVisible() {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()

	x, y := fw.Position()
	if x < -10000 || y < -10000 {
		return
	}
	winW, winH := fw.Size()
	if winW <= 0 || winH <= 0 {
		winW, winH = 82, 82
	}

	nx, ny := winapi.SnapToScreenEdge(x, y, winW, winH, 36)
	if nx != x || ny != y {
		w.mu.Lock()
		w.snappingFloat = true
		w.mu.Unlock()
		fw.SetPosition(nx, ny)
		go func() {
			time.Sleep(180 * time.Millisecond)
			w.mu.Lock()
			w.snappingFloat = false
			w.mu.Unlock()
		}()
		x, y = nx, ny
	}

	_ = w.settings.UpdateField(func(s *model.AppSettings) {
		s.FloatBallX = x
		s.FloatBallY = y
	})
}

// SuppressBlurHide temporarily prevents hide-on-blur while native dialogs are active.
func (w *WindowService) SuppressBlurHide(suppress bool) {
	w.mu.Lock()
	w.suppressBlurHide = suppress
	w.mu.Unlock()
}

// SetAlwaysOnTop toggles the pin button on the main window.
func (w *WindowService) SetAlwaysOnTop(pinned bool) (model.WindowState, error) {
	w.mu.Lock()
	mw := w.mainWin
	w.mu.Unlock()

	if mw != nil {
		mw.SetAlwaysOnTop(pinned)
	}
	if err := w.settings.UpdateField(func(s *model.AppSettings) {
		s.AlwaysOnTop = pinned
	}); err != nil {
		return w.GetWindowState(), err
	}
	w.syncTrayAndEmit()
	return w.GetWindowState(), nil
}

// SetHideOnBlur toggles automatic hiding when the unpinned main window loses focus.
func (w *WindowService) SetHideOnBlur(enabled bool) (model.WindowState, error) {
	if err := w.settings.UpdateField(func(s *model.AppSettings) {
		s.HideOnBlur = enabled
	}); err != nil {
		return w.GetWindowState(), err
	}
	w.syncTrayAndEmit()
	return w.GetWindowState(), nil
}

// ToggleFloatingBall shows or hides the independent mini catgirl floating ball window.
func (w *WindowService) ToggleFloatingBall(visible bool) (model.WindowState, error) {
	w.mu.Lock()
	fw := w.floatWin
	w.mu.Unlock()

	if fw != nil {
		if visible {
			fw.Show()
		} else {
			fw.Hide()
		}
	}
	if err := w.settings.UpdateField(func(s *model.AppSettings) {
		s.FloatBallEnabled = visible
	}); err != nil {
		return w.GetWindowState(), err
	}
	w.syncTrayAndEmit()
	return w.GetWindowState(), nil
}

// SetFloatBallStyle switches between circular catgirl avatar ball ("avatar") and mini capsule ("capsule").
func (w *WindowService) SetFloatBallStyle(style string) (model.WindowState, error) {
	style = normalizeFloatStyle(style)
	if err := w.settings.UpdateField(func(s *model.AppSettings) {
		s.FloatBallStyle = style
	}); err != nil {
		return w.GetWindowState(), err
	}
	w.applyFloatBallGeometry(style)
	w.syncTrayAndEmit()
	return w.GetWindowState(), nil
}

func (w *WindowService) applyFloatBallGeometry(style string) {
	w.mu.Lock()
	fw := w.floatWin
	w.mu.Unlock()
	if fw == nil {
		return
	}
	if style == "capsule" {
		fw.SetSize(148, 52)
	} else {
		fw.SetSize(82, 82)
	}
}

// ToggleSchedulerPaused toggles the global scheduled-task pause flag (synced with tray icon/menu and scheduler).
func (w *WindowService) ToggleSchedulerPaused() (model.WindowState, error) {
	cur := w.settings.GetSettings()
	nextPaused := !cur.SchedulerPaused
	if err := w.settings.UpdateField(func(s *model.AppSettings) {
		s.SchedulerPaused = nextPaused
	}); err != nil {
		return w.GetWindowState(), err
	}
	w.mu.Lock()
	pauseCb := w.onPauseChanged
	w.mu.Unlock()
	if pauseCb != nil {
		pauseCb(nextPaused)
	}
	w.syncTrayAndEmit()
	return w.GetWindowState(), nil
}

// UpdateGlobalHotkey live-rebinds the global hotkey and persists the canonical string.
func (w *WindowService) UpdateGlobalHotkey(spec string) (model.WindowState, error) {
	w.mu.Lock()
	hm := w.hotkey
	w.mu.Unlock()

	if hm != nil {
		if err := hm.Register(spec); err != nil {
			w.mu.Lock()
			w.hotkeyErr = err.Error()
			w.mu.Unlock()
			w.syncTrayAndEmit()
			return w.GetWindowState(), err
		}
	}

	_, canonical := false, ""
	if hm != nil {
		_, canonical = hm.Active()
	}
	w.mu.Lock()
	w.hotkeyErr = ""
	w.mu.Unlock()

	if err := w.settings.UpdateField(func(s *model.AppSettings) {
		s.GlobalHotkey = canonical
	}); err != nil {
		return w.GetWindowState(), err
	}
	w.syncTrayAndEmit()
	return w.GetWindowState(), nil
}

// GetWindowState returns a snapshot of current window/hotkey/tray flags.
func (w *WindowService) GetWindowState() model.WindowState {
	cfg := w.settings.GetSettings()
	w.mu.Lock()
	hm := w.hotkey
	hkErr := w.hotkeyErr
	w.mu.Unlock()

	active := false
	spec := cfg.GlobalHotkey
	if hm != nil {
		var actSpec string
		active, actSpec = hm.Active()
		if active {
			spec = actSpec
		}
	}

	return model.WindowState{
		AlwaysOnTop:      cfg.AlwaysOnTop,
		HideOnBlur:       cfg.HideOnBlur,
		FloatBallEnabled: cfg.FloatBallEnabled,
		FloatBallStyle:   cfg.FloatBallStyle,
		GlobalHotkey:     spec,
		HotkeyActive:     active,
		HotkeyError:      hkErr,
		SchedulerPaused:  cfg.SchedulerPaused,
	}
}

func (w *WindowService) syncTrayAndEmit() {
	state := w.GetWindowState()
	w.mu.Lock()
	cb := w.onSyncTray
	app := w.app
	w.mu.Unlock()

	if cb != nil {
		cb(state)
	}
	if app != nil {
		app.Event.Emit(model.EventWindowStateChanged, state)
	}
}
