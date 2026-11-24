package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveAtCreatesPortableSubdirs(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "data")

	p, err := ResolveAt(root, false)
	if err != nil {
		t.Fatalf("ResolveAt failed: %v", err)
	}
	if p.IsDev {
		t.Fatalf("expected IsDev=false")
	}
	for _, dir := range []string{p.RootDir, p.IconsDir, p.ScriptsDir, p.BackupsDir} {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() {
			t.Fatalf("expected directory %q to exist: %v", dir, err)
		}
	}
	if p.DBPath != filepath.Join(p.RootDir, "app.db") {
		t.Fatalf("unexpected DBPath: %s", p.DBPath)
	}
}
