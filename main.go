package main

import (
	"embed"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/runner"
	"nekomanage/internal/service"
)

//go:embed all:frontend/dist
var frontendAssets embed.FS

//go:embed assets/tray/tray.png
var trayIconNormal []byte

//go:embed assets/tray/tray_paused.png
var trayIconPaused []byte

func init() {
	application.RegisterEvent[model.FocusSearchPayload](model.EventWindowFocusSearch)
	application.RegisterEvent[model.WindowState](model.EventWindowStateChanged)
	application.RegisterEvent[model.ThemeChangedPayload](model.EventThemeChanged)
	application.RegisterEvent[model.ToastPayload](model.EventToast)
	application.RegisterEvent[model.FilesDroppedPayload](model.EventFilesDropped)
	application.RegisterEvent[model.IconReadyPayload](model.EventIconReady)
	application.RegisterEvent[model.ScriptStatusPayload](model.EventScriptStatus)
	application.RegisterEvent[model.ScriptLogChunkPayload](model.EventScriptLogChunk)
	application.RegisterEvent[model.SchedulerState](model.EventScheduleChanged)
}

func main() {
	paths, err := config.Resolve()
	if err != nil {
		log.Fatalf("resolve portable paths: %v", err)
	}

	store, err := db.Open(paths.DBPath)
	if err != nil {
		log.Fatalf("open sqlite db: %v", err)
	}
	defer store.Close()

	settingsSvc, err := service.NewSettingsService(store, paths)
	if err != nil {
		log.Fatalf("init settings service: %v", err)
	}
	windowSvc := service.NewWindowService(settingsSvc)
	appSvc := service.NewAppService(store, paths, windowSvc)
	scriptEngine := runner.NewEngine(store, paths)
	scriptSvc := service.NewScriptService(store, paths, scriptEngine, windowSvc)
	logSvc := service.NewLogService(store, settingsSvc)
	scheduleSvc := service.NewScheduleService(store, scriptEngine, scriptSvc, settingsSvc, windowSvc, logSvc)

	silentStart := hasFlag("--silent")

	app := application.New(application.Options{
		Name:        "NekoScriptsManage",
		Description: "清爽可爱风悬浮快速启动器与本地脚本定时管家",
		Services: []application.Service{
			application.NewService(settingsSvc),
			application.NewService(windowSvc),
			application.NewService(appSvc),
			application.NewService(scriptSvc),
			application.NewService(logSvc),
			application.NewService(scheduleSvc),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(frontendAssets),
			Middleware: localIconsMiddleware(paths.IconsDir),
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
			WebviewUserDataPath:           filepath.Join(paths.RootDir, "webview2"),
		},
	})

	cfg := settingsSvc.GetSettings()

	mainURL := "/#/main"
	if initTab := flagValue("--tab"); initTab != "" {
		mainURL = "/#/main?tab=" + initTab
	}

	// 1. Main launcher window (Maye Lite-inspired frameless rounded window)
	mainOpts := application.WebviewWindowOptions{
		Name:             "main",
		Title:            "NekoScriptsManage",
		Width:            960,
		Height:           640,
		MinWidth:         760,
		MinHeight:        500,
		Frameless:        true,
		AlwaysOnTop:      cfg.AlwaysOnTop,
		EnableFileDrop:   true,
		Hidden:           silentStart,
		BackgroundType:   application.BackgroundTypeSolid,
		BackgroundColour: application.NewRGB(250, 249, 246),
		URL:              mainURL,
		Windows: application.WindowsWindow{
			Theme:                   application.Light,
			WindowDidMoveDebounceMS: 250,
		},
	}
	if cfg.MainWinX >= 0 && cfg.MainWinY >= 0 {
		mainOpts.InitialPosition = application.WindowXY
		mainOpts.X = cfg.MainWinX
		mainOpts.Y = cfg.MainWinY
	} else {
		mainOpts.InitialPosition = application.WindowCentered
	}
	mainWin := app.Window.NewWithOptions(mainOpts)

	// Intercept close button -> hide to tray so scheduled tasks stay alive.
	mainWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if !windowSvc.IsQuitting() {
			e.Cancel()
			mainWin.Hide()
		}
	})
	mainWin.OnWindowEvent(events.Common.WindowLostFocus, func(e *application.WindowEvent) {
		windowSvc.HandleMainWindowBlur()
	})
	mainWin.OnWindowEvent(events.Common.WindowDidMove, func(e *application.WindowEvent) {
		windowSvc.SaveMainWindowPosition()
	})
	mainWin.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		dropped := e.Context().DroppedFiles()
		targetID := ""
		if d := e.Context().DropTargetDetails(); d != nil {
			targetID = d.ElementID
		}
		if len(dropped) > 0 {
			app.Event.Emit(model.EventFilesDropped, model.FilesDroppedPayload{
				Paths:    dropped,
				TargetID: targetID,
			})
		}
	})

	// 2. Mini floating catgirl avatar ball window (default circular 82x82, transparent & always-on-top)
	floatW, floatH := 82, 82
	if cfg.FloatBallStyle == "capsule" {
		floatW, floatH = 148, 52
	}
	floatOpts := application.WebviewWindowOptions{
		Name:             "floating",
		Title:            "NekoFloat",
		Width:            floatW,
		Height:           floatH,
		Frameless:        true,
		AlwaysOnTop:      true,
		DisableResize:    true,
		Hidden:           !cfg.FloatBallEnabled,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/#/float",
		Windows: application.WindowsWindow{
			DisableFramelessWindowDecorations: true,
			HiddenOnTaskbar:                   true,
			WindowDidMoveDebounceMS:           250,
		},
	}
	if cfg.FloatBallX >= 0 && cfg.FloatBallY >= 0 {
		floatOpts.InitialPosition = application.WindowXY
		floatOpts.X = cfg.FloatBallX
		floatOpts.Y = cfg.FloatBallY
	} else {
		floatOpts.InitialPosition = application.WindowXY
		floatOpts.X = 1120
		floatOpts.Y = 180
	}
	floatWin := app.Window.NewWithOptions(floatOpts)
	floatWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if !windowSvc.IsQuitting() {
			e.Cancel()
			floatWin.Hide()
		}
	})
	floatWin.OnWindowEvent(events.Common.WindowDidMove, func(e *application.WindowEvent) {
		windowSvc.SaveFloatBallPosition()
	})

	// 3. Wails v3 native SystemTray
	tray := app.SystemTray.New()
	tray.SetIcon(trayIconNormal)
	tray.SetTooltip("NekoScriptsManage · 猫娘启动器与脚本管家")
	tray.OnClick(func() {
		windowSvc.ToggleMainWindow("tray")
	})

	trayMenu := app.NewMenu()
	trayMenu.Add("🐾 显示主面板").OnClick(func(ctx *application.Context) {
		windowSvc.ShowMainWindow("tray")
	})
	floatMenuItem := trayMenu.Add("✨ 显示猫娘悬浮球")
	floatMenuItem.OnClick(func(ctx *application.Context) {
		cur := windowSvc.GetWindowState()
		_, _ = windowSvc.ToggleFloatingBall(!cur.FloatBallEnabled)
	})
	pauseMenuItem := trayMenu.Add("⏸️ 暂停所有定时任务")
	pauseMenuItem.OnClick(func(ctx *application.Context) {
		_, _ = windowSvc.ToggleSchedulerPaused()
	})
	trayMenu.AddSeparator()
	trayMenu.Add("🚪 退出 NekoScriptsManage").OnClick(func(ctx *application.Context) {
		windowSvc.QuitApp()
	})
	tray.SetMenu(trayMenu)

	syncTray := func(st model.WindowState) {
		if st.FloatBallEnabled {
			floatMenuItem.SetLabel("🌙 隐藏猫娘悬浮球")
		} else {
			floatMenuItem.SetLabel("✨ 显示猫娘悬浮球")
		}
		if st.SchedulerPaused {
			pauseMenuItem.SetLabel("▶️ 恢复所有定时任务")
			tray.SetIcon(trayIconPaused)
			tray.SetTooltip("NekoScriptsManage · 定时任务已暂停")
		} else {
			pauseMenuItem.SetLabel("⏸️ 暂停所有定时任务")
			tray.SetIcon(trayIconNormal)
			tray.SetTooltip("NekoScriptsManage · 猫娘启动器与脚本管家")
		}
		trayMenu.Update()
	}

	settingsSvc.AttachApp(app, mainWin, windowSvc)
	windowSvc.Attach(app, mainWin, floatWin, syncTray)
	windowSvc.SetPauseChangeHandler(func(paused bool) {
		scheduleSvc.SyncPausedFromExternal(paused)
	})
	appSvc.Attach(app, mainWin)
	scriptSvc.Attach(app, mainWin)
	scheduleSvc.Attach(app)
	if err := scheduleSvc.Start(); err != nil {
		log.Printf("start scheduler: %v", err)
	}
	// Run a background retention cleanup shortly after startup so old logs never bloat SQLite.
	go func() {
		time.Sleep(10 * time.Second)
		_, _ = logSvc.RunLogCleanup()
	}()
	scriptEngine.SetCallbacks(runner.EventCallbacks{
		OnStatus: func(p model.ScriptStatusPayload) {
			app.Event.Emit(model.EventScriptStatus, p)
		},
		OnLogChunk: func(p model.ScriptLogChunkPayload) {
			app.Event.Emit(model.EventScriptLogChunk, p)
		},
	})
	defer scheduleSvc.Stop()
	defer scriptEngine.Registry().KillAll()
	defer windowSvc.Shutdown()

	// Sync settings changes back to WindowService (e.g. hotkey or float ball saved from Settings page).
	settingsSvc.SetChangeHandler(func(prev, next model.AppSettings) error {
		if next.GlobalHotkey != prev.GlobalHotkey {
			if _, err := windowSvc.UpdateGlobalHotkey(next.GlobalHotkey); err != nil {
				return err
			}
		}
		if next.AlwaysOnTop != prev.AlwaysOnTop {
			mainWin.SetAlwaysOnTop(next.AlwaysOnTop)
		}
		if next.FloatBallEnabled != prev.FloatBallEnabled {
			if next.FloatBallEnabled {
				floatWin.Show()
			} else {
				floatWin.Hide()
			}
		}
		if next.FloatBallStyle != prev.FloatBallStyle {
			if next.FloatBallStyle == "capsule" {
				floatWin.SetSize(148, 52)
			} else {
				floatWin.SetSize(82, 82)
			}
		}
		return nil
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// localIconsMiddleware serves cached PNG icons from ./data/icons/ under /local-icons/<filename>.
func localIconsMiddleware(iconsDir string) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/local-icons/") {
				name := filepath.Base(strings.TrimPrefix(r.URL.Path, "/local-icons/"))
				if name == "" || name == "." || name == "/" {
					http.NotFound(w, r)
					return
				}
				fullPath := filepath.Join(iconsDir, name)
				w.Header().Set("Cache-Control", "public, max-age=86400")
				http.ServeFile(w, r, fullPath)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func hasFlag(flag string) bool {
	for _, arg := range os.Args[1:] {
		if arg == flag {
			return true
		}
	}
	return false
}

func flagValue(prefix string) string {
	p := prefix + "="
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, p) {
			return strings.TrimSpace(strings.TrimPrefix(arg, p))
		}
	}
	return ""
}
