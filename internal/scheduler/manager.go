package scheduler

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"nekomanage/internal/model"
)

var standardParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

// TriggerFunc is invoked by the scheduler whenever a scheduled job fires.
type TriggerFunc func(scheduleID int64, scriptID int64, allowConcurrent bool)

// Manager wraps robfig/cron/v3 with live job reloading, global pause, and next-run inspection.
type Manager struct {
	mu           sync.RWMutex
	c            *cron.Cron
	entries      map[int64]cron.EntryID // scheduleID -> cron.EntryID
	paused       bool
	started      bool
	onTrigger    TriggerFunc
	onCleanup    func()
	cleanupEntry cron.EntryID
}

func NewManager(onTrigger TriggerFunc, onCleanup func()) *Manager {
	return &Manager{
		c:         cron.New(cron.WithParser(standardParser), cron.WithLocation(time.Local)),
		entries:   make(map[int64]cron.EntryID),
		onTrigger: onTrigger,
		onCleanup: onCleanup,
	}
}

// Start begins the background cron tick loop and registers the daily log cleanup job.
func (m *Manager) Start(initialPaused bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.paused = initialPaused
	if m.started {
		return
	}
	m.started = true

	if m.onCleanup != nil {
		// Automatically enforce log retention every day at 03:30 local time.
		if id, err := m.c.AddFunc("30 3 * * *", m.onCleanup); err == nil {
			m.cleanupEntry = id
		}
	}
	m.c.Start()
}

// Stop gracefully stops the cron scheduler without killing running scripts.
func (m *Manager) Stop() {
	m.mu.Lock()
	started := m.started
	m.started = false
	m.mu.Unlock()
	if started {
		ctx := m.c.Stop()
		<-ctx.Done()
	}
}

// SetPaused switches global pause mode. Paused jobs stay registered so NextRunAt can still be inspected,
// while firing is skipped immediately when paused.
func (m *Manager) SetPaused(paused bool) {
	m.mu.Lock()
	m.paused = paused
	m.mu.Unlock()
}

func (m *Manager) IsPaused() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.paused
}

// SyncSchedule adds, replaces, or removes a single schedule entry in the live cron engine.
func (m *Manager) SyncSchedule(item model.ScheduleItem) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if oldID, ok := m.entries[item.ID]; ok {
		m.c.Remove(oldID)
		delete(m.entries, item.ID)
	}

	if !item.Enabled || strings.TrimSpace(item.CronExpr) == "" {
		return nil
	}

	schedID := item.ID
	scriptID := item.ScriptID
	allowConc := item.AllowConcurrent

	entryID, err := m.c.AddFunc(strings.TrimSpace(item.CronExpr), func() {
		if m.IsPaused() {
			return
		}
		if m.onTrigger != nil {
			m.onTrigger(schedID, scriptID, allowConc)
		}
	})
	if err != nil {
		return fmt.Errorf("无效的 Cron 表达式 %q: %w", item.CronExpr, err)
	}
	m.entries[item.ID] = entryID
	return nil
}

// RemoveSchedule unregisters a schedule by ID.
func (m *Manager) RemoveSchedule(scheduleID int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if oldID, ok := m.entries[scheduleID]; ok {
		m.c.Remove(oldID)
		delete(m.entries, scheduleID)
	}
}

// NextRunAt returns the next scheduled run time formatted as local timestamp, or "" if inactive/paused.
func (m *Manager) NextRunAt(scheduleID int64) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.paused {
		return ""
	}
	entryID, ok := m.entries[scheduleID]
	if !ok {
		return ""
	}
	entry := m.c.Entry(entryID)
	if entry.ID == 0 || entry.Next.IsZero() {
		return ""
	}
	return entry.Next.Format("2006-01-02 15:04:05")
}

// ActiveCount returns the number of enabled schedules registered in the cron engine.
func (m *Manager) ActiveCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.entries)
}

// BuildCronFromSimple converts a visual simple-mode schedule into a standard 5-field Cron expression.
func BuildCronFromSimple(cfg model.SimpleScheduleConfig) (string, error) {
	switch cfg.Kind {
	case "interval":
		mins := cfg.Minutes
		if mins < 1 || mins > 1440 {
			return "", errors.New("间隔分钟数需在 1 ~ 1440 之间")
		}
		if mins < 60 {
			return fmt.Sprintf("*/%d * * * *", mins), nil
		}
		if mins%60 == 0 {
			hrs := mins / 60
			if hrs == 24 {
				return "0 0 * * *", nil
			}
			return fmt.Sprintf("0 */%d * * *", hrs), nil
		}
		return fmt.Sprintf("@every %dm", mins), nil

	case "daily":
		if cfg.Hour < 0 || cfg.Hour > 23 || cfg.Minute < 0 || cfg.Minute > 59 {
			return "", errors.New("每天执行时间格式无效（小时 0-23，分钟 0-59）")
		}
		return fmt.Sprintf("%d %d * * *", cfg.Minute, cfg.Hour), nil

	case "weekly":
		if cfg.Hour < 0 || cfg.Hour > 23 || cfg.Minute < 0 || cfg.Minute > 59 {
			return "", errors.New("每周执行时间格式无效（小时 0-23，分钟 0-59）")
		}
		if len(cfg.Weekdays) == 0 {
			return "", errors.New("请至少选择一天星期几")
		}
		seen := make(map[int]bool)
		var days []int
		for _, d := range cfg.Weekdays {
			if d < 0 || d > 6 {
				return "", fmt.Errorf("无效的星期值: %d", d)
			}
			if !seen[d] {
				seen[d] = true
				days = append(days, d)
			}
		}
		sort.Ints(days)
		parts := make([]string, len(days))
		for i, d := range days {
			parts[i] = strconv.Itoa(d)
		}
		return fmt.Sprintf("%d %d * * %s", cfg.Minute, cfg.Hour, strings.Join(parts, ",")), nil

	default:
		return "", fmt.Errorf("不支持的简易定时模式: %q", cfg.Kind)
	}
}

// ValidateAndPreview validates a Cron expression and returns the next `count` trigger timestamps.
func ValidateAndPreview(expr string, count int) ([]string, error) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return nil, errors.New("Cron 表达式不能为空")
	}
	sched, err := standardParser.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("Cron 表达式语法错误: %w", err)
	}
	if count <= 0 {
		count = 5
	}
	if count > 20 {
		count = 20
	}

	out := make([]string, 0, count)
	t := time.Now()
	for i := 0; i < count; i++ {
		t = sched.Next(t)
		if t.IsZero() {
			break
		}
		out = append(out, t.Format("2006-01-02 15:04:05"))
	}
	return out, nil
}
