package winapi

import (
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractIconToPNGFromSystemExeAndFolder(t *testing.T) {
	iconsDir := t.TempDir()

	// 1. Extract from notepad.exe
	notepad := filepath.Join(os.Getenv("WINDIR"), "notepad.exe")
	if _, err := os.Stat(notepad); err != nil {
		t.Skipf("notepad.exe not found at %s", notepad)
	}
	fname, err := ExtractIconToPNG(notepad, "", 0, iconsDir)
	if err != nil {
		t.Fatalf("ExtractIconToPNG(notepad.exe) failed: %v", err)
	}
	f, err := os.Open(filepath.Join(iconsDir, fname))
	if err != nil {
		t.Fatalf("open cached png: %v", err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatalf("decode cached png: %v", err)
	}
	if img.Bounds().Dx() < 16 || img.Bounds().Dy() < 16 {
		t.Fatalf("unexpected tiny icon dimensions: %v", img.Bounds())
	}

	// 2. Extract from Windows folder via SHGetFileInfoW fallback
	folderIcon, err := ExtractIconToPNG(os.Getenv("WINDIR"), "", 0, iconsDir)
	if err != nil {
		t.Fatalf("ExtractIconToPNG(folder) failed: %v", err)
	}
	if folderIcon == "" {
		t.Fatalf("expected non-empty folder icon filename")
	}
}

func TestParseLnkRealShortcut(t *testing.T) {
	tmp := t.TempDir()
	lnkPath := filepath.Join(tmp, "test_notepad.lnk")
	notepad := filepath.Join(os.Getenv("WINDIR"), "notepad.exe")

	// Create a real Windows .lnk shortcut using built-in WScript.Shell COM via PowerShell
	psScript := `$s=(New-Object -COM WScript.Shell).CreateShortcut('` + lnkPath + `');` +
		`$s.TargetPath='` + notepad + `';` +
		`$s.Arguments='--demo-arg';` +
		`$s.WorkingDirectory='` + tmp + `';` +
		`$s.Description='Neko Test Shortcut';` +
		`$s.Save()`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-Command", psScript)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to create test .lnk: %v (%s)", err, string(out))
	}

	info, err := ParseLnk(lnkPath)
	if err != nil {
		t.Fatalf("ParseLnk failed: %v", err)
	}
	if !strings.EqualFold(info.TargetPath, notepad) {
		t.Errorf("TargetPath = %q, want %q", info.TargetPath, notepad)
	}
	if info.Arguments != "--demo-arg" {
		t.Errorf("Arguments = %q, want --demo-arg", info.Arguments)
	}
	if !strings.EqualFold(info.WorkingDir, tmp) {
		t.Errorf("WorkingDir = %q, want %q", info.WorkingDir, tmp)
	}
	if info.Description != "Neko Test Shortcut" {
		t.Errorf("Description = %q, want 'Neko Test Shortcut'", info.Description)
	}
}
