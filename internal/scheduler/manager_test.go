package scheduler

import (
	"testing"

	"nekomanage/internal/model"
)

func TestBuildCronFromSimpleAndPreview(t *testing.T) {
	cases := []struct {
		name string
		cfg  model.SimpleScheduleConfig
		want string
	}{
		{"every 15 min", model.SimpleScheduleConfig{Kind: "interval", Minutes: 15}, "*/15 * * * *"},
		{"every 2 hours", model.SimpleScheduleConfig{Kind: "interval", Minutes: 120}, "0 */2 * * *"},
		{"daily 09:30", model.SimpleScheduleConfig{Kind: "daily", Hour: 9, Minute: 30}, "30 9 * * *"},
		{"weekly Mon/Wed/Fri 18:00", model.SimpleScheduleConfig{Kind: "weekly", Hour: 18, Minute: 0, Weekdays: []int{5, 1, 3}}, "0 18 * * 1,3,5"},
	}

	for _, tc := range cases {
		got, err := BuildCronFromSimple(tc.cfg)
		if err != nil {
			t.Fatalf("%s: BuildCronFromSimple failed: %v", tc.name, err)
		}
		if got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
		nexts, err := ValidateAndPreview(got, 5)
		if err != nil || len(nexts) != 5 {
			t.Errorf("%s: ValidateAndPreview(%q) failed: len=%d err=%v", tc.name, got, len(nexts), err)
		}
	}

	if _, err := ValidateAndPreview("bad cron expr", 3); err == nil {
		t.Fatalf("expected error for invalid cron expression")
	}
}

func TestManagerSyncAndPause(t *testing.T) {
	m := NewManager(func(scheduleID, scriptID int64, allowConcurrent bool) {}, nil)
	m.Start(false)
	defer m.Stop()

	err := m.SyncSchedule(model.ScheduleItem{
		ID:       1,
		ScriptID: 10,
		Enabled:  true,
		CronExpr: "*/5 * * * *",
	})
	if err != nil {
		t.Fatalf("SyncSchedule: %v", err)
	}
	if m.ActiveCount() != 1 {
		t.Fatalf("expected ActiveCount=1, got %d", m.ActiveCount())
	}
	if m.NextRunAt(1) == "" {
		t.Fatalf("expected non-empty NextRunAt when active")
	}

	m.SetPaused(true)
	if m.NextRunAt(1) != "" {
		t.Fatalf("expected empty NextRunAt when globally paused")
	}
	m.SetPaused(false)
	if m.NextRunAt(1) == "" {
		t.Fatalf("expected NextRunAt restored after resume")
	}

	m.RemoveSchedule(1)
	if m.ActiveCount() != 0 {
		t.Fatalf("expected ActiveCount=0 after remove, got %d", m.ActiveCount())
	}
}
