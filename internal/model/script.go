package model

// ScriptItem represents a managed local or inline script.
type ScriptItem struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	ScriptType    string `json:"scriptType"`    // "bat" | "cmd" | "ps1" | "py" | "custom"
	SourceMode    string `json:"sourceMode"`    // "file" | "inline"
	FilePath      string `json:"filePath"`      // External path for "file", or relative filename in data/scripts/ for "inline"
	InlineContent string `json:"inlineContent"` // Script source code when sourceMode == "inline"
	CustomCommand string `json:"customCommand"` // Custom executable / command template when scriptType == "custom"
	Arguments     string `json:"arguments"`
	WorkingDir    string `json:"workingDir"`
	RunInTerminal bool   `json:"runInTerminal"` // false = silent CREATE_NO_WINDOW; true = popup terminal
	RunAsAdmin    bool   `json:"runAsAdmin"`
	TimeoutSec    int    `json:"timeoutSec"` // 0 = no timeout
	Tags          string `json:"tags"`
	IsPinned      bool   `json:"isPinned"`
	SortOrder     int    `json:"sortOrder"`
	LastRunAt     string `json:"lastRunAt"`
	LastStatus    string `json:"lastStatus"` // "idle" | "running" | "success" | "failed" | "timeout" | "killed"
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`

	// Runtime-computed fields (not stored in scripts table)
	IsRunning    bool  `json:"isRunning"`
	RunningLogID int64 `json:"runningLogId"`
}

// ScriptInput is the DTO for creating or updating a script.
type ScriptInput struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	ScriptType    string `json:"scriptType"`
	SourceMode    string `json:"sourceMode"`
	FilePath      string `json:"filePath"`
	InlineContent string `json:"inlineContent"`
	CustomCommand string `json:"customCommand"`
	Arguments     string `json:"arguments"`
	WorkingDir    string `json:"workingDir"`
	RunInTerminal bool   `json:"runInTerminal"`
	RunAsAdmin    bool   `json:"runAsAdmin"`
	TimeoutSec    int    `json:"timeoutSec"`
	Tags          string `json:"tags"`
	IsPinned      bool   `json:"isPinned"`
	SortOrder     int    `json:"sortOrder"`
}

// RunningTask summarizes an active in-flight script execution.
type RunningTask struct {
	LogID       int64  `json:"logId"`
	ScriptID    int64  `json:"scriptId"`
	ScriptName  string `json:"scriptName"`
	TriggerType string `json:"triggerType"`
	StartedAt   string `json:"startedAt"`
	PID         int    `json:"pid"`
}
