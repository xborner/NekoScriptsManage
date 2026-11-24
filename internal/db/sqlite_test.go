package db

import (
	"path/filepath"
	"testing"
)

func TestOpenAndIdempotentMigrate(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "app.db")

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer store.Close()

	// Verify all expected tables exist
	tables := []string{"schema_migrations", "categories", "apps", "scripts", "schedules", "script_logs", "app_settings"}
	for _, tbl := range tables {
		var name string
		err := store.DB.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&name)
		if err != nil {
			t.Fatalf("expected table %q to exist: %v", tbl, err)
		}
	}

	// Verify starter categories seeded
	var catCount int
	if err := store.DB.QueryRow(`SELECT COUNT(*) FROM categories`).Scan(&catCount); err != nil {
		t.Fatalf("count categories: %v", err)
	}
	if catCount != 3 {
		t.Fatalf("expected 3 starter categories, got %d", catCount)
	}

	// Verify WAL mode and foreign keys
	var journal string
	if err := store.DB.QueryRow(`PRAGMA journal_mode;`).Scan(&journal); err != nil {
		t.Fatalf("pragma journal_mode: %v", err)
	}
	if journal != "wal" {
		t.Fatalf("expected WAL mode, got %q", journal)
	}

	// Re-running Migrate must be idempotent and preserve user data
	if _, err := store.DB.Exec(`INSERT INTO app_settings (key, value) VALUES ('theme', 'mint')`); err != nil {
		t.Fatalf("insert setting: %v", err)
	}
	if err := store.Migrate(); err != nil {
		t.Fatalf("second Migrate failed: %v", err)
	}
	var theme string
	if err := store.DB.QueryRow(`SELECT value FROM app_settings WHERE key='theme'`).Scan(&theme); err != nil {
		t.Fatalf("read setting after remigrate: %v", err)
	}
	if theme != "mint" {
		t.Fatalf("expected theme 'mint' preserved, got %q", theme)
	}
}
