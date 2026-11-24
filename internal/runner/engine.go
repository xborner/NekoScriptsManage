package runner

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
	"nekomanage/internal/winapi"
)

const maxCapturedBytes = 2 * 1024 * 1024 // 2 MiB safety cap per stream

// EventCallbacks allows decoupling the runner from Wails runtime (clean for unit tests).
type EventCallbacks struct {
	OnStatus   func(payload model.ScriptStatusPayload)
	OnLogChunk func(payload model.ScriptLogChunkPayload)
}

// Engine executes local/inline scripts asynchronously with Windows no-window support,
// GB18030/UTF-8 decoding, timeout control, Job Object process-tree killing, and SQLite logging.
type Engine struct {
	store    *db.Store
	paths    *config.Paths
	registry *Registry
	mu       sync.RWMutex
	cb       EventCallbacks
}

func NewEngine(store *db.Store, paths *config.Paths) *Engine {
	return &Engine{
		store:    store,
		paths:    paths,
		registry: NewRegistry(),
	}
}

func (e *Engine) SetCallbacks(cb EventCallbacks) {
	e.mu.Lock()
	e.cb = cb
	e.mu.Unlock()
}

func (e *Engine) Registry() *Registry {
	return e.registry
}

// Start creates a running log record and launches script execution in a background goroutine.
// It returns the newly created logID immediately without blocking the caller.
func (e *Engine) Start(script model.ScriptItem, triggerType string, scheduleID *int64) (int64, error) {
	if triggerType == "" {
		triggerType = "manual"
	}

	scriptPath, err := e.resolveScriptFile(script)
	if err != nil {
		return 0, err
	}

	startedAt := time.Now().Format("2006-01-02 15:04:05")
	var schedVal any
	if scheduleID != nil && *scheduleID > 0 {
		schedVal = *scheduleID
	}

	res, err := e.store.DB.Exec(`
		INSERT INTO script_logs (script_id, script_name_snapshot, schedule_id, trigger_type, status, started_at)
		VALUES (?, ?, ?, ?, 'running', ?)
	`, script.ID, script.Name, schedVal, triggerType, startedAt)
	if err != nil {
		return 0, fmt.Errorf("create script log: %w", err)
	}
	logID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	_, _ = e.store.DB.Exec(`
		UPDATE scripts SET last_run_at = ?, last_status = 'running', updated_at = datetime('now', 'localtime')
		WHERE id = ?
	`, startedAt, script.ID)

	ctx, cancel := context.WithCancel(context.Background())
	if script.TimeoutSec > 0 {
		ctx, cancel = context.WithTimeout(ctx, time.Duration(script.TimeoutSec)*time.Second)
	}

	execState := &activeExecution{
		task: model.RunningTask{
			LogID:       logID,
			ScriptID:    script.ID,
			ScriptName:  script.Name,
			TriggerType: triggerType,
			StartedAt:   startedAt,
		},
		cancel: cancel,
	}
	e.registry.Register(execState)

	e.emitStatus(model.ScriptStatusPayload{
		ScriptID:     script.ID,
		LogID:        logID,
		Status:       "running",
		RunningCount: e.registry.Count(),
	})

	go e.runGoroutine(ctx, cancel, execState, script, scriptPath, scheduleID)
	return logID, nil
}

// Stop forcibly terminates a running script and its entire child process tree.
func (e *Engine) Stop(logID int64) error {
	if !e.registry.KillByLogID(logID) {
		return errors.New("该任务当前未在运行")
	}
	return nil
}

func (e *Engine) runGoroutine(
	ctx context.Context,
	cancel context.CancelFunc,
	execState *activeExecution,
	script model.ScriptItem,
	scriptPath string,
	scheduleID *int64,
) {
	startTime := time.Now()
	defer cancel()

	var stdoutBuf, stderrBuf cappedBuffer
	stdoutBuf.limit = maxCapturedBytes
	stderrBuf.limit = maxCapturedBytes

	status := "success"
	var exitCode *int
	errMsg := ""

	// Special path: Admin + Popup Terminal uses ShellExecuteW("runas")
	if script.RunInTerminal && script.RunAsAdmin {
		exe, argsLine := buildAdminTerminalCommand(script, scriptPath)
		workDir := resolveWorkingDir(script, scriptPath)
		if err := winapi.LaunchTarget(exe, argsLine, workDir, true); err != nil {
			status = "failed"
			errMsg = err.Error()
		} else {
			code := 0
			exitCode = &code
			note := "[NekoScripts] 已在独立管理员终端窗口中启动运行（提权终端无法直接捕获输出流）\n"
			stdoutBuf.WriteString(note)
			e.emitChunk(execState.task.LogID, "stdout", note)
		}
		e.finishExecution(execState, script, scheduleID, startTime, status, exitCode, stdoutBuf.String(), stderrBuf.String(), errMsg)
		return
	}

	cmd, err := buildExecCommand(script, scriptPath)
	if err != nil {
		status = "failed"
		errMsg = err.Error()
		e.finishExecution(execState, script, scheduleID, startTime, status, exitCode, "", "", errMsg)
		return
	}

	cmd.Dir = resolveWorkingDir(script, scriptPath)
	cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8", "PYTHONUNBUFFERED=1")

	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	if script.RunInTerminal {
		cmd.SysProcAttr.HideWindow = false
		cmd.SysProcAttr.CreationFlags = winapi.CreateNewConsole
	} else {
		cmd.SysProcAttr.HideWindow = true
		cmd.SysProcAttr.CreationFlags = winapi.CreateNoWindow
	}

	var stdoutPipe, stderrPipe io.ReadCloser
	if !script.RunInTerminal {
		stdoutPipe, err = cmd.StdoutPipe()
		if err != nil {
			e.finishExecution(execState, script, scheduleID, startTime, "failed", nil, "", "", fmt.Sprintf("stdout pipe: %v", err))
			return
		}
		stderrPipe, err = cmd.StderrPipe()
		if err != nil {
			e.finishExecution(execState, script, scheduleID, startTime, "failed", nil, "", "", fmt.Sprintf("stderr pipe: %v", err))
			return
		}
	}

	if err := cmd.Start(); err != nil {
		e.finishExecution(execState, script, scheduleID, startTime, "failed", nil, "", "", fmt.Sprintf("启动脚本进程失败: %v", err))
		return
	}

	pid := cmd.Process.Pid
	e.registry.SetPID(execState.task.LogID, pid)

	// Attach process to Windows Job Object for clean process-tree termination.
	job, _ := winapi.AssignProcessToNewJob(pid)
	defer func() {
		if job != nil {
			_ = job.Close()
		}
	}()

	// Watch context cancellation (user stop or timeout) and kill entire tree immediately.
	killDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			if job != nil {
				_ = job.Terminate()
			}
			_ = winapi.KillProcessTreeFallback(pid)
		case <-killDone:
		}
	}()

	var wg sync.WaitGroup
	if !script.RunInTerminal {
		wg.Add(2)
		go func() {
			defer wg.Done()
			e.streamPipe(execState.task.LogID, "stdout", stdoutPipe, &stdoutBuf)
		}()
		go func() {
			defer wg.Done()
			e.streamPipe(execState.task.LogID, "stderr", stderrPipe, &stderrBuf)
		}()
	} else {
		note := "[NekoScripts] 正在弹出终端窗口中运行，关闭终端后将自动记录耗时与退出码...\n"
		stdoutBuf.WriteString(note)
		e.emitChunk(execState.task.LogID, "stdout", note)
	}

	wg.Wait()
	waitErr := cmd.Wait()
	close(killDone)

	// Determine final status and exit code.
	if execState.isKilled() {
		status = "killed"
		errMsg = "任务已被用户手动强制终止"
	} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		status = "timeout"
		errMsg = fmt.Sprintf("执行超时（超过 %d 秒）已自动终止进程树", script.TimeoutSec)
	} else if waitErr != nil {
		status = "failed"
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			c := exitErr.ExitCode()
			exitCode = &c
			errMsg = fmt.Sprintf("脚本退出码非零 (%d)", c)
		} else {
			errMsg = waitErr.Error()
		}
	} else {
		status = "success"
		c := 0
		exitCode = &c
	}

	e.finishExecution(execState, script, scheduleID, startTime, status, exitCode, stdoutBuf.String(), stderrBuf.String(), errMsg)
}

func (e *Engine) streamPipe(logID int64, stream string, r io.ReadCloser, dst *cappedBuffer) {
	if r == nil {
		return
	}
	reader := bufio.NewReaderSize(r, 8192)
	buf := make([]byte, 4096)
	var pending []byte

	for {
		n, err := reader.Read(buf)
		if n > 0 {
			pending = append(pending, buf[:n]...)
			// Flush up to last newline (or flush entire chunk if line is long) so multi-byte GBK/UTF-8 sequences stay intact.
			if idx := bytes.LastIndexByte(pending, '\n'); idx >= 0 {
				decoded := winapi.DecodeWindowsOutput(pending[:idx+1])
				pending = append([]byte(nil), pending[idx+1:]...)
				if decoded != "" {
					dst.WriteString(decoded)
					e.emitChunk(logID, stream, decoded)
				}
			} else if len(pending) >= 4096 {
				decoded := winapi.DecodeWindowsOutput(pending)
				pending = nil
				if decoded != "" {
					dst.WriteString(decoded)
					e.emitChunk(logID, stream, decoded)
				}
			}
		}
		if err != nil {
			if len(pending) > 0 {
				decoded := winapi.DecodeWindowsOutput(pending)
				if decoded != "" {
					dst.WriteString(decoded)
					e.emitChunk(logID, stream, decoded)
				}
			}
			return
		}
	}
}

func (e *Engine) finishExecution(
	execState *activeExecution,
	script model.ScriptItem,
	scheduleID *int64,
	startTime time.Time,
	status string,
	exitCode *int,
	stdoutText string,
	stderrText string,
	errMsg string,
) {
	durationMs := time.Since(startTime).Milliseconds()
	finishedAt := time.Now().Format("2006-01-02 15:04:05")

	e.registry.Unregister(execState.task.LogID)

	var exitVal any
	if exitCode != nil {
		exitVal = *exitCode
	}

	_, _ = e.store.DB.Exec(`
		UPDATE script_logs
		SET status = ?, exit_code = ?, finished_at = ?, duration_ms = ?,
		    stdout_text = ?, stderr_text = ?, error_message = ?
		WHERE id = ?
	`, status, exitVal, finishedAt, durationMs, stdoutText, stderrText, errMsg, execState.task.LogID)

	_, _ = e.store.DB.Exec(`
		UPDATE scripts
		SET last_status = ?, updated_at = datetime('now', 'localtime')
		WHERE id = ?
	`, status, script.ID)

	if scheduleID != nil && *scheduleID > 0 {
		_, _ = e.store.DB.Exec(`
			UPDATE schedules
			SET last_run_at = ?, last_status = ?, updated_at = datetime('now', 'localtime')
			WHERE id = ?
		`, finishedAt, status, *scheduleID)
	}

	e.emitStatus(model.ScriptStatusPayload{
		ScriptID:     script.ID,
		LogID:        execState.task.LogID,
		Status:       status,
		ExitCode:     exitCode,
		DurationMs:   durationMs,
		RunningCount: e.registry.Count(),
	})
}

func (e *Engine) resolveScriptFile(script model.ScriptItem) (string, error) {
	if script.ScriptType == "custom" && script.SourceMode == "inline" && strings.TrimSpace(script.CustomCommand) != "" && strings.TrimSpace(script.InlineContent) == "" {
		return "", nil
	}

	if script.SourceMode == "file" {
		p := strings.TrimSpace(script.FilePath)
		if p == "" {
			if script.ScriptType == "custom" && strings.TrimSpace(script.CustomCommand) != "" {
				return "", nil
			}
			return "", errors.New("外部脚本文件路径不能为空")
		}
		if _, err := os.Stat(p); err != nil {
			return "", fmt.Errorf("找不到外部脚本文件: %s", p)
		}
		return p, nil
	}

	// Inline mode: ensure script is materialized to portable ./data/scripts/
	ext := ScriptFileExt(script.ScriptType)
	fileName := fmt.Sprintf("script_%d%s", script.ID, ext)
	absPath := filepath.Join(e.paths.ScriptsDir, fileName)
	content := normalizeInlineContent(script.ScriptType, script.InlineContent)
	if err := os.WriteFile(absPath, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("写入内联脚本文件失败: %w", err)
	}
	return absPath, nil
}

// ScriptFileExt returns the canonical file extension for a script type.
func ScriptFileExt(scriptType string) string {
	switch scriptType {
	case "bat":
		return ".bat"
	case "cmd":
		return ".cmd"
	case "ps1":
		return ".ps1"
	case "py":
		return ".py"
	default:
		return ".cmd"
	}
}

func normalizeInlineContent(scriptType, content string) string {
	if scriptType == "bat" || scriptType == "cmd" {
		// Windows batch files require CRLF line endings and a trailing CRLF on the last line.
		norm := strings.ReplaceAll(content, "\r\n", "\n")
		norm = strings.ReplaceAll(norm, "\n", "\r\n")
		if !strings.HasSuffix(norm, "\r\n") {
			norm += "\r\n"
		}
		return norm
	}
	if scriptType == "ps1" {
		// UTF-8 BOM guarantees Windows PowerShell 5.1 parses UTF-8 Chinese characters accurately.
		if !strings.HasPrefix(content, "\xef\xbb\xbf") {
			content = "\xef\xbb\xbf" + content
		}
	}
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return content
}

func buildExecCommand(script model.ScriptItem, scriptPath string) (*exec.Cmd, error) {
	extraArgs := winapi.SplitCommandArgs(script.Arguments)

	switch script.ScriptType {
	case "bat", "cmd":
		var cmdLine string
		if script.SourceMode == "inline" {
			// Inline batch scripts are UTF-8 encoded, so switch code page to 65001 silently.
			cmdLine = fmt.Sprintf(`chcp 65001 >nul & call "%s"`, scriptPath)
		} else {
			cmdLine = fmt.Sprintf(`call "%s"`, scriptPath)
		}
		if strings.TrimSpace(script.Arguments) != "" {
			cmdLine += " " + strings.TrimSpace(script.Arguments)
		}
		if script.RunInTerminal {
			cmdLine += " & echo. & pause"
		}
		cmd := exec.Command("cmd.exe")
		cmd.SysProcAttr = &syscall.SysProcAttr{}
		cmd.Args = []string{"cmd.exe", "/C", cmdLine}
		// Use raw CmdLine via syscall on Windows so quotes around scriptPath are never double-escaped by Go.
		return wrapCmdRaw(cmdLine), nil

	case "ps1":
		args := []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath}
		args = append(args, extraArgs...)
		if script.RunInTerminal {
			args = append([]string{"-NoExit"}, args...)
		}
		return exec.Command("powershell.exe", args...), nil

	case "py":
		args := []string{"-u", scriptPath}
		args = append(args, extraArgs...)
		if script.RunInTerminal {
			line := fmt.Sprintf(`python -u "%s"`, scriptPath)
			if strings.TrimSpace(script.Arguments) != "" {
				line += " " + strings.TrimSpace(script.Arguments)
			}
			line += " & echo. & pause"
			return wrapCmdRaw(line), nil
		}
		return exec.Command("python.exe", args...), nil

	case "custom":
		customCmd := strings.TrimSpace(script.CustomCommand)
		if customCmd == "" {
			if scriptPath == "" {
				return nil, errors.New("自定义命令不能为空")
			}
			line := fmt.Sprintf(`call "%s" %s`, scriptPath, strings.TrimSpace(script.Arguments))
			return wrapCmdRaw(strings.TrimSpace(line)), nil
		}
		replaced := strings.ReplaceAll(customCmd, "{file}", scriptPath)
		replaced = strings.ReplaceAll(replaced, "{args}", strings.TrimSpace(script.Arguments))
		if !strings.Contains(customCmd, "{file}") && scriptPath != "" && script.SourceMode == "file" {
			replaced += fmt.Sprintf(` "%s"`, scriptPath)
		}
		if !strings.Contains(customCmd, "{args}") && strings.TrimSpace(script.Arguments) != "" {
			replaced += " " + strings.TrimSpace(script.Arguments)
		}
		if script.RunInTerminal {
			replaced += " & echo. & pause"
		}
		return wrapCmdRaw(replaced), nil

	default:
		return nil, fmt.Errorf("不支持的脚本类型: %s", script.ScriptType)
	}
}

func wrapCmdRaw(cmdLine string) *exec.Cmd {
	cmd := exec.Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: fmt.Sprintf(`cmd.exe /C "%s"`, cmdLine),
	}
	return cmd
}

func buildAdminTerminalCommand(script model.ScriptItem, scriptPath string) (string, string) {
	switch script.ScriptType {
	case "ps1":
		args := fmt.Sprintf(`-NoProfile -NoExit -ExecutionPolicy Bypass -File "%s"`, scriptPath)
		if strings.TrimSpace(script.Arguments) != "" {
			args += " " + strings.TrimSpace(script.Arguments)
		}
		return "powershell.exe", args
	case "py":
		line := fmt.Sprintf(`python -u "%s" %s & echo. & pause`, scriptPath, strings.TrimSpace(script.Arguments))
		return "cmd.exe", fmt.Sprintf(`/C "%s"`, strings.TrimSpace(line))
	case "custom":
		c := strings.ReplaceAll(strings.TrimSpace(script.CustomCommand), "{file}", scriptPath)
		c = strings.ReplaceAll(c, "{args}", strings.TrimSpace(script.Arguments))
		return "cmd.exe", fmt.Sprintf(`/K "%s"`, c)
	default:
		line := fmt.Sprintf(`chcp 65001 >nul & call "%s" %s & echo. & pause`, scriptPath, strings.TrimSpace(script.Arguments))
		return "cmd.exe", fmt.Sprintf(`/C "%s"`, strings.TrimSpace(line))
	}
}

func resolveWorkingDir(script model.ScriptItem, scriptPath string) string {
	if wd := strings.TrimSpace(script.WorkingDir); wd != "" {
		if st, err := os.Stat(wd); err == nil && st.IsDir() {
			return wd
		}
	}
	if scriptPath != "" {
		return filepath.Dir(scriptPath)
	}
	cwd, _ := os.Getwd()
	return cwd
}

func (e *Engine) emitStatus(p model.ScriptStatusPayload) {
	e.mu.RLock()
	fn := e.cb.OnStatus
	e.mu.RUnlock()
	if fn != nil {
		fn(p)
	}
}

func (e *Engine) emitChunk(logID int64, stream, chunk string) {
	e.mu.RLock()
	fn := e.cb.OnLogChunk
	e.mu.RUnlock()
	if fn != nil {
		fn(model.ScriptLogChunkPayload{LogID: logID, Stream: stream, Chunk: chunk})
	}
}

type cappedBuffer struct {
	mu        sync.Mutex
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (b *cappedBuffer) WriteString(s string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.limit <= 0 || b.buf.Len() < b.limit {
		remain := b.limit - b.buf.Len()
		if b.limit > 0 && len(s) > remain {
			b.buf.WriteString(s[:remain])
			if !b.truncated {
				b.buf.WriteString("\n... [输出超过 2MB 已自动截断] ...\n")
				b.truncated = true
			}
			return
		}
		b.buf.WriteString(s)
	}
}

func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
