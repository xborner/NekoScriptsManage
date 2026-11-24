package config

import (
	"os"
	"path/filepath"
	"strings"
)

// Paths holds all strictly portable runtime directories and file paths.
// In development mode (wails3 dev / go run / NEKO_DEV=1), data lives in <cwd>/dev_data/.
// In production portable mode, data lives in <exe_dir>/data/.
type Paths struct {
	IsDev      bool   `json:"isDev"`
	RootDir    string `json:"rootDir"`
	DBPath     string `json:"dbPath"`
	IconsDir   string `json:"iconsDir"`
	ScriptsDir string `json:"scriptsDir"`
	BackupsDir string `json:"backupsDir"`
}

// Resolve determines the portable data directory and ensures all subdirectories exist.
func Resolve() (*Paths, error) {
	isDev := detectDevMode()
	var rootDir string

	if custom := strings.TrimSpace(os.Getenv("NEKO_DATA_DIR")); custom != "" {
		abs, err := filepath.Abs(custom)
		if err != nil {
			return nil, err
		}
		rootDir = abs
	} else if isDev {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		rootDir = filepath.Join(cwd, "dev_data")
	} else {
		exe, err := os.Executable()
		if err != nil {
			return nil, err
		}
		exeDir := filepath.Dir(exe)
		rootDir = filepath.Join(exeDir, "data")
	}

	return ResolveAt(rootDir, isDev)
}

// ResolveAt builds a Paths layout rooted at rootDir and creates all required subdirectories.
func ResolveAt(rootDir string, isDev bool) (*Paths, error) {
	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		return nil, err
	}
	p := &Paths{
		IsDev:      isDev,
		RootDir:    absRoot,
		DBPath:     filepath.Join(absRoot, "app.db"),
		IconsDir:   filepath.Join(absRoot, "icons"),
		ScriptsDir: filepath.Join(absRoot, "scripts"),
		BackupsDir: filepath.Join(absRoot, "backups"),
	}

	for _, dir := range []string{p.RootDir, p.IconsDir, p.ScriptsDir, p.BackupsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	return p, nil
}

func detectDevMode() bool {
	if v := strings.TrimSpace(os.Getenv("NEKO_DEV")); v == "1" || strings.EqualFold(v, "true") {
		return true
	}
	if strings.TrimSpace(os.Getenv("FRONTEND_DEVSERVER_URL")) != "" {
		return true
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	lower := strings.ToLower(exe)
	// `go run` compiles into Temp/go-build*
	if strings.Contains(lower, "go-build") {
		return true
	}
	// Running inside project's bin/ during `wails3 dev` / local dev while go.mod exists in cwd
	if _, err := os.Stat("go.mod"); err == nil {
		cwd, err := os.Getwd()
		if err == nil && strings.HasPrefix(lower, strings.ToLower(filepath.Join(cwd, "bin"))) {
			return true
		}
	}
	return false
}
