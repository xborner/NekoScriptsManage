package model

// ScriptLog represents a full persisted script execution record including stdout/stderr.
type ScriptLog struct {
	ID                 int64  `json:"id"`
	ScriptID           *int64 `json:"scriptId"`
	ScriptNameSnapshot string `json:"scriptNameSnapshot"`
	ScheduleID         *int64 `json:"scheduleId"`
	TriggerType        string `json:"triggerType"` // "manual" | "schedule"
	Status             string `json:"status"`      // "running" | "success" | "failed" | "timeout" | "killed"
	ExitCode           *int   `json:"exitCode"`
	StartedAt          string `json:"startedAt"`
	FinishedAt         string `json:"finishedAt"`
	DurationMs         int64  `json:"durationMs"`
	StdoutText         string `json:"stdoutText"`
	StderrText         string `json:"stderrText"`
	ErrorMessage       string `json:"errorMessage"`
}

// LogSummary is a lightweight row returned in paginated list views (without huge stdout blobs).
type LogSummary struct {
	ID                 int64  `json:"id"`
	ScriptID           *int64 `json:"scriptId"`
	ScriptNameSnapshot string `json:"scriptNameSnapshot"`
	ScheduleID         *int64 `json:"scheduleId"`
	TriggerType        string `json:"triggerType"`
	Status             string `json:"status"`
	ExitCode           *int   `json:"exitCode"`
	StartedAt          string `json:"startedAt"`
	FinishedAt         string `json:"finishedAt"`
	DurationMs         int64  `json:"durationMs"`
	ErrorMessage       string `json:"errorMessage"`
	HasOutput          bool   `json:"hasOutput"`
}

// LogQuery defines filter & pagination parameters for QueryLogs.
type LogQuery struct {
	ScriptID    *int64 `json:"scriptId"`
	OnlyFailed  bool   `json:"onlyFailed"`
	TriggerType string `json:"triggerType"` // "" | "manual" | "schedule"
	Keyword     string `json:"keyword"`
	Page        int    `json:"page"`
	PageSize    int    `json:"pageSize"`
}

// LogPage is the paginated response of QueryLogs.
type LogPage struct {
	Items    []LogSummary `json:"items"`
	Total    int          `json:"total"`
	Page     int          `json:"page"`
	PageSize int          `json:"pageSize"`
}
