package winapi

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var procShellExecuteW = shell32DLL.NewProc("ShellExecuteW")

const swShowNormal = 1

// LaunchTarget launches an application, shortcut, folder, or URL via Windows ShellExecuteW.
// When runAsAdmin is true, it requests UAC elevation via the "runas" verb.
func LaunchTarget(targetPath, arguments, workingDir string, runAsAdmin bool) error {
	target := strings.TrimSpace(targetPath)
	if target == "" {
		return fmt.Errorf("目标路径不能为空")
	}

	verb := "open"
	if runAsAdmin {
		verb = "runas"
	}

	wd := strings.TrimSpace(workingDir)
	if wd == "" && !strings.HasPrefix(strings.ToLower(target), "http://") && !strings.HasPrefix(strings.ToLower(target), "https://") {
		if info, err := os.Stat(target); err == nil {
			if info.IsDir() {
				wd = target
			} else {
				wd = filepath.Dir(target)
			}
		}
	}

	verbPtr, err := windows.UTF16PtrFromString(verb)
	if err != nil {
		return err
	}
	filePtr, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}

	var argsPtr *uint16
	if strings.TrimSpace(arguments) != "" {
		argsPtr, err = windows.UTF16PtrFromString(arguments)
		if err != nil {
			return err
		}
	}

	var dirPtr *uint16
	if wd != "" {
		dirPtr, err = windows.UTF16PtrFromString(wd)
		if err != nil {
			return err
		}
	}

	ret, _, callErr := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verbPtr)),
		uintptr(unsafe.Pointer(filePtr)),
		uintptr(unsafe.Pointer(argsPtr)),
		uintptr(unsafe.Pointer(dirPtr)),
		swShowNormal,
	)
	// Per MSDN, ShellExecuteW returns a value > 32 on success.
	if ret <= 32 {
		if ret == 5 || ret == 1223 {
			return fmt.Errorf("已取消管理员授权或权限不足")
		}
		return fmt.Errorf("启动失败 (code=%d): %v", ret, callErr)
	}
	return nil
}

// RevealInExplorer opens Windows Explorer and highlights the target file or opens the target folder.
// On Windows, explorer.exe requires `/select,"C:\path\to\file"` with NO space after `/select,`
// and standard backslashes, passed via raw CmdLine so Go does not re-quote or split the token.
func RevealInExplorer(targetPath string) error {
	target := strings.TrimSpace(targetPath)
	if target == "" {
		return fmt.Errorf("目标路径为空")
	}
	lower := strings.ToLower(target)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return fmt.Errorf("网址快捷方式没有本地文件夹")
	}

	expanded := expandEnvIfNeeded(target)
	cleaned := filepath.Clean(expanded)

	if info, err := os.Stat(cleaned); err == nil {
		if info.IsDir() {
			return OpenInExplorer(cleaned)
		}
		cmd := exec.Command("explorer.exe")
		cmd.SysProcAttr = &syscall.SysProcAttr{
			CmdLine: fmt.Sprintf(`explorer.exe /select,"%s"`, cleaned),
		}
		return cmd.Start()
	}

	// If the target file no longer exists, fall back to opening its parent directory if present.
	parent := filepath.Dir(cleaned)
	if info, err := os.Stat(parent); err == nil && info.IsDir() {
		return OpenInExplorer(parent)
	}
	return fmt.Errorf("目标路径不存在: %s", cleaned)
}
