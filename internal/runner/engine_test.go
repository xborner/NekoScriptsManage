package runner

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
)

func setupTestEngine(t *testing.T) (*Engine, *db.Store) {
	t.Helper()
	paths, err := config.ResolveAt(filepath.Join(t.TempDir(), "data"), true)
	if err != nil {
		t.Fatalf("ResolveAt: %v", err)
	}
	store, err := db.Open(paths.DBPath)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return NewEngine(store, paths), store
}

func insertDummyScript(t *testing.T, store *db.Store, s model.ScriptItem) model.ScriptItem {
	t.Helper()
	res, err := store.DB.Exec(`
		INSERT INTO scripts (name, script_type, source_mode, inline_content, timeout_sec)
		VALUES (?, ?, ?, ?, ?)
	`, s.Name, s.ScriptType, s.SourceMode, s.InlineContent, s.TimeoutSec)
	if err != nil {
		t.Fatalf("insert script: %v", err)
	}
	id, _ := res.LastInsertId()
	s.ID = id
	return s
}

func TestEngineInlineBatChineseOutput(t *testing.T) {
	eng, store := setupTestEngine(t)

	done := make(chan model.ScriptStatusPayload, 4)
	eng.SetCallbacks(EventCallbacks{
		OnStatus: func(p model.ScriptStatusPayload) {
			if p.Status != "running" {
				done <- p
			}
		},
	})

	sc := insertDummyScript(t, store, model.ScriptItem{
		Name:          "中文测试脚本",
		ScriptType:    "bat",
		SourceMode:    "inline",
		InlineContent: "@echo off\necho 你好，猫娘脚本引擎！\necho 第二行输出喵",
		TimeoutSec:    15,
	})

	logID, err := eng.Start(sc, "manual", nil)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	select {
	case st := <-done:
		if st.Status != "success" {
			t.Fatalf("expected status=success, got %q", st.Status)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for bat script completion")
	}

	var stdout string
	if err := store.DB.QueryRow(`SELECT stdout_text FROM script_logs WHERE id = ?`, logID).Scan(&stdout); err != nil {
		t.Fatalf("query log: %v", err)
	}
	if !strings.Contains(stdout, "你好，猫娘脚本引擎！") {
		t.Fatalf("expected crisp Chinese stdout, got %q", stdout)
	}
}

func TestEngineTimeoutAndManualKill(t *testing.T) {
	eng, store := setupTestEngine(t)

	done := make(chan model.ScriptStatusPayload, 4)
	eng.SetCallbacks(EventCallbacks{
		OnStatus: func(p model.ScriptStatusPayload) {
			if p.Status != "running" {
				done <- p
			}
		},
	})

	// 1. Timeout test (1s timeout on a 10s ping sleep)
	timeoutScript := insertDummyScript(t, store, model.ScriptItem{
		Name:          "超时测试",
		ScriptType:    "bat",
		SourceMode:    "inline",
		InlineContent: "@echo off\nping -n 10 127.0.0.1 >nul",
		TimeoutSec:    1,
	})
	if _, err := eng.Start(timeoutScript, "manual", nil); err != nil {
		t.Fatalf("Start timeout script: %v", err)
	}
	select {
	case st := <-done:
		if st.Status != "timeout" {
			t.Fatalf("expected status=timeout, got %q", st.Status)
		}
	case <-time.After(8 * time.Second):
		t.Fatalf("timed out waiting for timeout status")
	}

	// 2. Manual process-tree kill test
	killScript := insertDummyScript(t, store, model.ScriptItem{
		Name:          "强杀测试",
		ScriptType:    "bat",
		SourceMode:    "inline",
		InlineContent: "@echo off\nping -n 20 127.0.0.1 >nul",
		TimeoutSec:    30,
	})
	logID, err := eng.Start(killScript, "manual", nil)
	if err != nil {
		t.Fatalf("Start kill script: %v", err)
	}
	time.Sleep(350 * time.Millisecond)
	if err := eng.Stop(logID); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	select {
	case st := <-done:
		if st.Status != "killed" {
			t.Fatalf("expected status=killed, got %q", st.Status)
		}
	case <-time.After(8 * time.Second):
		t.Fatalf("timed out waiting for killed status")
	}
}
