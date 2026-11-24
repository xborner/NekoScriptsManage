package service

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"testing"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/runner"
)

func TestScheduleServiceAndPortableZipBackup(t *testing.T) {
	paths, err := config.ResolveAt(filepath.Join(t.TempDir(), "data"), true)
	if err != nil {
		t.Fatalf("ResolveAt: %v", err)
	}
	store, err := db.Open(paths.DBPath)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	defer store.Close()

	settingsSvc, err := NewSettingsService(store, paths)
	if err != nil {
		t.Fatalf("NewSettingsService: %v", err)
	}
	eng := runner.NewEngine(store, paths)
	scriptSvc := NewScriptService(store, paths, eng, nil)
	logSvc := NewLogService(store, settingsSvc)
	schedSvc := NewScheduleService(store, eng, scriptSvc, settingsSvc, nil, logSvc)

	if err := schedSvc.Start(); err != nil {
		t.Fatalf("schedSvc.Start: %v", err)
	}
	defer schedSvc.Stop()

	// 1. Create a script
	sc, err := scriptSvc.SaveScript(model.ScriptInput{
		Name:          "每日定时清理",
		ScriptType:    "bat",
		SourceMode:    "inline",
		InlineContent: "@echo off\necho cleanup",
	})
	if err != nil {
		t.Fatalf("SaveScript: %v", err)
	}

	// 2. Save a simple daily schedule
	view, err := schedSvc.SaveSchedule(model.ScheduleInput{
		ScriptID: sc.ID,
		Enabled:  true,
		Mode:     "simple",
		SimpleConfig: model.SimpleScheduleConfig{
			Kind:   "daily",
			Hour:   8,
			Minute: 30,
		},
	})
	if err != nil {
		t.Fatalf("SaveSchedule: %v", err)
	}
	if view.CronExpr != "30 8 * * *" || view.NextRunAt == "" {
		t.Fatalf("unexpected schedule view: cron=%q next=%q", view.CronExpr, view.NextRunAt)
	}

	// 3. Global pause & resume
	st, err := schedSvc.SetGlobalPaused(true)
	if err != nil || !st.GlobalPaused {
		t.Fatalf("SetGlobalPaused(true) failed: %v", err)
	}
	st, err = schedSvc.SetGlobalPaused(false)
	if err != nil || st.GlobalPaused || st.ActiveCount != 1 {
		t.Fatalf("SetGlobalPaused(false) unexpected state: %+v err=%v", st, err)
	}

	// 4. Create a dummy cached icon & test portable ZIP backup
	if err := os.WriteFile(filepath.Join(paths.IconsDir, "sample.png"), []byte("pngdata"), 0o644); err != nil {
		t.Fatalf("write dummy icon: %v", err)
	}
	zipOut := filepath.Join(t.TempDir(), "backup.zip")
	if err := settingsSvc.ExportDataBackupToPath(zipOut); err != nil {
		t.Fatalf("ExportDataBackupToPath: %v", err)
	}

	zr, err := zip.OpenReader(zipOut)
	if err != nil {
		t.Fatalf("open backup zip: %v", err)
	}
	defer zr.Close()

	found := map[string]bool{}
	extractDir := t.TempDir()
	for _, f := range zr.File {
		found[f.Name] = true
		if f.Name == "data/app.db" {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open zipped db: %v", err)
			}
			dstPath := filepath.Join(extractDir, "restored.db")
			dst, _ := os.Create(dstPath)
			_, _ = io.Copy(dst, rc)
			_ = dst.Close()
			_ = rc.Close()

			// Verify extracted SQLite snapshot is intact and contains our script & schedule
			restored, err := db.Open(dstPath)
			if err != nil {
				t.Fatalf("open restored sqlite snapshot: %v", err)
			}
			var cnt int
			if err := restored.DB.QueryRow(`SELECT COUNT(*) FROM schedules`).Scan(&cnt); err != nil || cnt != 1 {
				t.Fatalf("expected 1 schedule in backup db, got %d (err=%v)", cnt, err)
			}
			_ = restored.Close()
		}
	}
	if !found["data/app.db"] || !found["data/icons/sample.png"] {
		t.Fatalf("backup zip missing expected entries: %+v", found)
	}
}
