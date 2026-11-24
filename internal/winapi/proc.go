package winapi

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	// CreationFlags constants
	CreateNoWindow   uint32 = 0x08000000
	CreateNewConsole uint32 = 0x00000010

	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x00002000
)

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectExtendedLimitInfo struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

var (
	procCreateJobObjectW         = kernel32DLL.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32DLL.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32DLL.NewProc("AssignProcessToJobObject")
	procTerminateJobObject       = kernel32DLL.NewProc("TerminateJobObject")
)

// ProcessJob wraps a Windows Job Object handle that owns a script process and all descendants.
type ProcessJob struct {
	handle windows.Handle
}

// AssignProcessToNewJob creates a Windows Job Object configured with KILL_ON_JOB_CLOSE
// and attaches the given process PID so killing the job terminates the entire process tree.
func AssignProcessToNewJob(pid int) (*ProcessJob, error) {
	hJob, _, err := procCreateJobObjectW.Call(0, 0)
	if hJob == 0 {
		return nil, fmt.Errorf("CreateJobObjectW failed: %w", err)
	}

	var info jobObjectExtendedLimitInfo
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	r1, _, err := procSetInformationJobObject.Call(
		hJob,
		jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		unsafe.Sizeof(info),
	)
	if r1 == 0 {
		_ = windows.CloseHandle(windows.Handle(hJob))
		return nil, fmt.Errorf("SetInformationJobObject failed: %w", err)
	}

	hProc, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		_ = windows.CloseHandle(windows.Handle(hJob))
		return nil, fmt.Errorf("OpenProcess(%d) failed: %w", pid, err)
	}
	defer windows.CloseHandle(hProc)

	r1, _, err = procAssignProcessToJobObject.Call(hJob, uintptr(hProc))
	if r1 == 0 {
		_ = windows.CloseHandle(windows.Handle(hJob))
		return nil, fmt.Errorf("AssignProcessToJobObject(%d) failed: %w", pid, err)
	}

	return &ProcessJob{handle: windows.Handle(hJob)}, nil
}

// Terminate kills every process inside the Job Object (root + all children/grandchildren) and closes the handle.
func (j *ProcessJob) Terminate() error {
	if j == nil || j.handle == 0 {
		return nil
	}
	h := j.handle
	j.handle = 0
	_, _, _ = procTerminateJobObject.Call(uintptr(h), 1)
	return windows.CloseHandle(h)
}

// Close releases the Job Object handle cleanly after normal process exit.
func (j *ProcessJob) Close() error {
	if j == nil || j.handle == 0 {
		return nil
	}
	h := j.handle
	j.handle = 0
	return windows.CloseHandle(h)
}

// KillProcessTreeFallback terminates a process and all its children via hidden taskkill /T /F.
func KillProcessTreeFallback(pid int) error {
	if pid <= 0 {
		return nil
	}
	cmd := exec.Command("taskkill.exe", "/PID", strconv.Itoa(pid), "/T", "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: CreateNoWindow,
	}
	return cmd.Run()
}

// SplitCommandArgs splits a Windows-style argument string while respecting double/single quotes.
func SplitCommandArgs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var args []string
	var cur strings.Builder
	var quote rune
	inToken := false

	for _, r := range raw {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
			inToken = true
		case r == ' ' || r == '\t' || r == '\r' || r == '\n':
			if inToken {
				args = append(args, cur.String())
				cur.Reset()
				inToken = false
			}
		default:
			cur.WriteRune(r)
			inToken = true
		}
	}
	if inToken {
		args = append(args, cur.String())
	}
	return args
}
