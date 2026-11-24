package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/runner"
)

func TestScriptAndLogServiceFlow(t *testing.T) {
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

	done := make(chan model.ScriptStatusPayload, 4)
	eng.SetCallbacks(runner.EventCallbacks{
		OnStatus: func(p model.ScriptStatusPayload) {
			if p.Status != "running" {
				done <- p
			}
		},
	})

	// 1. Save inline script and verify mirror file written to portable scripts/
	sc, err := scriptSvc.SaveScript(model.ScriptInput{
		Name:          "打印问候",
		Description:   "测试内联脚本",
		ScriptType:    "bat",
		SourceMode:    "inline",
		InlineContent: "@echo off\necho 喵帕斯日志测试",
		TimeoutSec:    15,
		Tags:          "演示,测试",
	})
	if err != nil {
		t.Fatalf("SaveScript: %v", err)
	}
	if _, err := os.Stat(filepath.Join(paths.ScriptsDir, sc.FilePath)); err != nil {
		t.Fatalf("expected inline script mirror file at %s: %v", sc.FilePath, err)
	}

	// 2. Run script asynchronously and wait for completion
	logID, err := scriptSvc.RunScript(sc.ID)
	if err != nil {
		t.Fatalf("RunScript: %v", err)
	}
	select {
	case st := <-done:
		if st.Status != "success" {
			t.Fatalf("expected success, got %q", st.Status)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("timeout waiting for script execution")
	}

	// 3. Query logs & inspect detail
	page, err := logSvc.QueryLogs(model.LogQuery{ScriptID: &sc.ID, Page: 1, PageSize: 10})
	if err != nil || page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("QueryLogs failed: total=%d len=%d err=%v", page.Total, len(page.Items), err)
	}
	detail, err := logSvc.GetLogDetail(logID)
	if err != nil {
		t.Fatalf("GetLogDetail: %v", err)
	}
	if !strings.Contains(detail.StdoutText, "喵帕斯日志测试") {
		t.Fatalf("unexpected stdout: %q", detail.StdoutText)
	}

	// 4. Filter only failed should return 0
	failedPage, err := logSvc.QueryLogs(model.LogQuery{OnlyFailed: true})
	if err != nil || failedPage.Total != 0 {
		t.Fatalf("expected 0 failed logs, got %d (err=%v)", failedPage.Total, err)
	}

	// 5. Cleanup & DeleteScript
	if err := scriptSvc.DeleteScript(sc.ID); err != nil {
		t.Fatalf("DeleteScript: %v", err)
	}
}
