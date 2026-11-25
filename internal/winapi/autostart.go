package winapi

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows/registry"
)

const (
	runRegPath  = `Software\Microsoft\Windows\CurrentVersion\Run`
	runRegValue = "NekoScriptsManage"
)

// SetAutoStart toggles Windows per-user Run registry key ONLY when explicitly requested by the user.
func SetAutoStart(enabled bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runRegPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open startup registry key: %w", err)
	}
	defer k.Close()

	if !enabled {
		err = k.DeleteValue(runRegValue)
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return err
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable path: %w", err)
	}
	absExe, err := filepath.Abs(exePath)
	if err != nil {
		absExe = exePath
	}
	return k.SetStringValue(runRegValue, fmt.Sprintf(`"%s" --silent`, absExe))
}

// IsAutoStartEnabled checks whether the per-user startup entry exists.
func IsAutoStartEnabled() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runRegPath, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	_, _, err = k.GetStringValue(runRegValue)
	return err == nil
}

// OpenInExplorer opens a directory in Windows Explorer.
func OpenInExplorer(dirPath string) error {
	cleaned := filepath.Clean(strings.TrimSpace(dirPath))
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: fmt.Sprintf(`explorer.exe "%s"`, cleaned),
	}
	return cmd.Start()
}
