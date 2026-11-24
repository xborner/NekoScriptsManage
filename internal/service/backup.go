package service

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ExportDataBackup prompts the user for a destination .zip path and exports a consistent
// portable snapshot of ./data/ (hot SQLite VACUUM INTO snapshot + icons/ + scripts/).
func (s *SettingsService) ExportDataBackup() (string, error) {
	s.mu.RLock()
	app := s.app
	mainWin := s.mainWin
	winSvc := s.windowSvc
	s.mu.RUnlock()
	if app == nil {
		return "", errors.New("application not initialized")
	}

	if winSvc != nil {
		winSvc.SuppressBlurHide(true)
		defer winSvc.SuppressBlurHide(false)
	}

	defaultName := fmt.Sprintf("NekoScriptsManage_backup_%s.zip", time.Now().Format("20060102_150405"))
	dlg := app.Dialog.SaveFile().
		SetMessage("导出 NekoScriptsManage 便携数据备份").
		SetDirectory(s.paths.BackupsDir).
		SetFilename(defaultName).
		AddFilter("ZIP 备份压缩包 (*.zip)", "*.zip")
	if mainWin != nil {
		dlg.AttachToWindow(mainWin)
	}

	chosen, err := dlg.PromptForSingleSelection()
	if err != nil || strings.TrimSpace(chosen) == "" {
		return "", nil
	}
	if !strings.HasSuffix(strings.ToLower(chosen), ".zip") {
		chosen += ".zip"
	}

	if err := s.ExportDataBackupToPath(chosen); err != nil {
		return "", err
	}
	return chosen, nil
}

// ExportDataBackupToPath creates a portable ZIP containing a consistent SQLite snapshot,
// cached icons, and inline scripts under a top-level `data/` directory.
//
//wails:ignore
func (s *SettingsService) ExportDataBackupToPath(outZipPath string) error {
	tmpDir, err := os.MkdirTemp("", "neko_backup_*")
	if err != nil {
		return fmt.Errorf("create temp backup dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// 1. Hot consistent SQLite snapshot using VACUUM INTO (safe under WAL mode).
	snapDBPath := filepath.Join(tmpDir, "app.db")
	escapedPath := strings.ReplaceAll(snapDBPath, "'", "''")
	if _, err := s.store.DB.Exec(fmt.Sprintf(`VACUUM INTO '%s'`, escapedPath)); err != nil {
		return fmt.Errorf("create sqlite snapshot: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(outZipPath), 0o755); err != nil {
		return err
	}

	outFile, err := os.Create(outZipPath)
	if err != nil {
		return fmt.Errorf("create zip file: %w", err)
	}
	defer outFile.Close()

	zw := zip.NewWriter(outFile)
	defer zw.Close()

	// Add consistent app.db
	if err := addFileToZip(zw, snapDBPath, "data/app.db"); err != nil {
		return err
	}

	// Add icons/ and scripts/ directories
	if err := addDirToZip(zw, s.paths.IconsDir, "data/icons"); err != nil {
		return err
	}
	if err := addDirToZip(zw, s.paths.ScriptsDir, "data/scripts"); err != nil {
		return err
	}

	return zw.Close()
}

func addFileToZip(zw *zip.Writer, srcPath, zipEntryName string) error {
	f, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	hdr, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	hdr.Name = filepath.ToSlash(zipEntryName)
	hdr.Method = zip.Deflate

	w, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	_, err = io.Copy(w, f)
	return err
}

func addDirToZip(zw *zip.Writer, srcDir, zipPrefix string) error {
	if _, err := os.Stat(srcDir); err != nil {
		return nil
	}
	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		return addFileToZip(zw, path, filepath.ToSlash(filepath.Join(zipPrefix, rel)))
	})
}
