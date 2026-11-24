package model

// SimpleScheduleConfig represents the user-friendly visual scheduling options.
type SimpleScheduleConfig struct {
	Kind     string `json:"kind"`     // "interval" | "daily" | "weekly"
	Minutes  int    `json:"minutes"`  // interval: 1..59 or multiples of 60 (1..1440)
	Hour     int    `json:"hour"`     // daily/weekly: 0..23
	Minute   int    `json:"minute"`   // daily/weekly: 0..59
	Weekdays []int  `json:"weekdays"` // weekly: 0=Sun, 1=Mon ... 6=Sat
}

// ScheduleItem represents a persisted schedule row in SQLite.
type ScheduleItem struct {
	ID               int64                `json:"id"`
	ScriptID         int64                `json:"scriptId"`
	Name             string               `json:"name"`
	Enabled          bool                 `json:"enabled"`
	Mode             string               `json:"mode"` // "simple" | "cron"
	SimpleConfig     SimpleScheduleConfig `json:"simpleConfig"`
	SimpleConfigJSON string               `json:"simpleConfigJson"`
	CronExpr         string               `json:"cronExpr"`
	AllowConcurrent  bool                 `json:"allowConcurrent"`
	LastRunAt        string               `json:"lastRunAt"`
	LastStatus       string               `json:"lastStatus"`
	CreatedAt        string               `json:"createdAt"`
	UpdatedAt        string               `json:"updatedAt"`
}

// ScheduleView enriches ScheduleItem with script name and live next-run timestamp.
type ScheduleView struct {
	ScheduleItem
	ScriptName string `json:"scriptName"`
	NextRunAt  string `json:"nextRunAt"` // Formatted "2006-01-02 15:04:05" or ""
}

// ScheduleInput is the DTO for creating or updating a script's schedule.
type ScheduleInput struct {
	ID              int64                `json:"id"`
	ScriptID        int64                `json:"scriptId"`
	Name            string               `json:"name"`
	Enabled         bool                 `json:"enabled"`
	Mode            string               `json:"mode"` // "simple" | "cron"
	SimpleConfig    SimpleScheduleConfig `json:"simpleConfig"`
	CronExpr        string               `json:"cronExpr"`
	AllowConcurrent bool                 `json:"allowConcurrent"`
}

// SchedulerState summarizes the global scheduler status for UI and tray sync.
type SchedulerState struct {
	GlobalPaused bool           `json:"globalPaused"`
	ActiveCount  int            `json:"activeCount"`
	Schedules    []ScheduleView `json:"schedules"`
}
