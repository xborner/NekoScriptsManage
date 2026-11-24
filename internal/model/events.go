package model

// Event name constants shared between Go backend and React frontend.
const (
	EventWindowFocusSearch  = "window:focus-search"
	EventWindowStateChanged = "window:state-changed"
	EventThemeChanged       = "settings:theme-changed"
	EventToast              = "app:toast"
	EventFilesDropped       = "app:files-dropped"
	EventIconReady          = "app:icon-ready"
	EventScriptStatus       = "script:status-changed"
	EventScriptLogChunk     = "script:log-chunk"
	EventScheduleChanged    = "schedule:state-changed"
)

type FocusSearchPayload struct {
	Source string `json:"source"` // "hotkey" | "tray" | "float"
}

type ThemeChangedPayload struct {
	Theme string `json:"theme"`
}

type ToastPayload struct {
	Level   string `json:"level"` // "info" | "success" | "warn" | "error"
	Message string `json:"message"`
}

type FilesDroppedPayload struct {
	Paths    []string `json:"paths"`
	TargetID string   `json:"targetId"`
}

type IconReadyPayload struct {
	AppID     int64  `json:"appId"`
	IconType  string `json:"iconType"`
	IconValue string `json:"iconValue"`
}

type ScriptStatusPayload struct {
	ScriptID     int64  `json:"scriptId"`
	LogID        int64  `json:"logId"`
	Status       string `json:"status"`
	ExitCode     *int   `json:"exitCode"`
	DurationMs   int64  `json:"durationMs"`
	RunningCount int    `json:"runningCount"`
}

type ScriptLogChunkPayload struct {
	LogID  int64  `json:"logId"`
	Stream string `json:"stream"` // "stdout" | "stderr"
	Chunk  string `json:"chunk"`
}
