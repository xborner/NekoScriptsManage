package model

// AppSettings represents all persistent user preferences stored in app_settings.
type AppSettings struct {
	Theme            string `json:"theme"`            // "sakura" | "mint" | "sky" | "cream"
	GlobalHotkey     string `json:"globalHotkey"`     // e.g. "Alt+Space"
	HideOnBlur       bool   `json:"hideOnBlur"`       // Auto hide main window when focus lost (if not pinned)
	AlwaysOnTop      bool   `json:"alwaysOnTop"`      // Main window pin state
	FloatBallEnabled bool   `json:"floatBallEnabled"` // Show mini floating ball window
	FloatBallStyle   string `json:"floatBallStyle"`   // "avatar" (default circular catgirl) | "capsule"
	FloatBallX       int    `json:"floatBallX"`
	FloatBallY       int    `json:"floatBallY"`
	MainWinX         int    `json:"mainWinX"`
	MainWinY         int    `json:"mainWinY"`
	AutoStart        bool   `json:"autoStart"`
	SchedulerPaused  bool   `json:"schedulerPaused"`
	LogRetentionDays int    `json:"logRetentionDays"` // Default 30 days
	LogMaxCount      int    `json:"logMaxCount"`      // Default 500 rows
}

// DefaultSettings returns the initial soft-cute defaults for NekoScriptsManage.
func DefaultSettings() AppSettings {
	return AppSettings{
		Theme:            "sakura",
		GlobalHotkey:     "Alt+Space",
		HideOnBlur:       true,
		AlwaysOnTop:      false,
		FloatBallEnabled: false,
		FloatBallStyle:   "avatar",
		FloatBallX:       -1,
		FloatBallY:       -1,
		MainWinX:         -1,
		MainWinY:         -1,
		AutoStart:        false,
		SchedulerPaused:  false,
		LogRetentionDays: 30,
		LogMaxCount:      500,
	}
}

// WindowState is pushed to frontend whenever pin, float ball, or hotkey state changes.
type WindowState struct {
	AlwaysOnTop      bool   `json:"alwaysOnTop"`
	HideOnBlur       bool   `json:"hideOnBlur"`
	FloatBallEnabled bool   `json:"floatBallEnabled"`
	FloatBallStyle   string `json:"floatBallStyle"`
	GlobalHotkey     string `json:"globalHotkey"`
	HotkeyActive     bool   `json:"hotkeyActive"`
	HotkeyError      string `json:"hotkeyError"`
	SchedulerPaused  bool   `json:"schedulerPaused"`
}

// Point represents a 2D screen coordinate.
type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// AppInfo provides read-only portable runtime diagnostics for the Settings page.
type AppInfo struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	IsDev      bool   `json:"isDev"`
	DataDir    string `json:"dataDir"`
	DBPath     string `json:"dbPath"`
	DBSizeByte int64  `json:"dbSizeByte"`
	IconCount  int    `json:"iconCount"`
}
