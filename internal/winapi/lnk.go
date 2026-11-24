package winapi

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ole32                = windows.NewLazySystemDLL("ole32.dll")
	procCoInitializeEx   = ole32.NewProc("CoInitializeEx")
	procCoUninitialize   = ole32.NewProc("CoUninitialize")
	procCoCreateInstance = ole32.NewProc("CoCreateInstance")
)

const (
	coinitApartmentThreaded = 0x2
	clsctxInprocServer      = 0x1
	stgmRead                = 0x00000000
	slgpRawPath             = 0x4
)

var (
	// CLSID_ShellLink {00021401-0000-0000-C000-000000000046}
	clsidShellLink = windows.GUID{
		Data1: 0x00021401,
		Data2: 0x0000,
		Data3: 0x0000,
		Data4: [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46},
	}
	// IID_IShellLinkW {000214F9-0000-0000-C000-000000000046}
	iidIShellLinkW = windows.GUID{
		Data1: 0x000214F9,
		Data2: 0x0000,
		Data3: 0x0000,
		Data4: [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46},
	}
	// IID_IPersistFile {0000010B-0000-0000-C000-000000000046}
	iidIPersistFile = windows.GUID{
		Data1: 0x0000010B,
		Data2: 0x0000,
		Data3: 0x0000,
		Data4: [8]byte{0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46},
	}
)

// ShortcutInfo holds parsed metadata from a Windows .lnk shortcut file.
type ShortcutInfo struct {
	TargetPath   string
	Arguments    string
	WorkingDir   string
	IconLocation string
	IconIndex    int
	Description  string
}

// COM vtable layouts (standard Windows SDK ShObjIdl_core.h / ObjIdl.h)
type iUnknownVtbl struct {
	QueryInterface uintptr
	AddRef         uintptr
	Release        uintptr
}

type iPersistFileVtbl struct {
	iUnknownVtbl
	GetClassID    uintptr
	IsDirty       uintptr
	Load          uintptr
	Save          uintptr
	SaveCompleted uintptr
	GetCurFile    uintptr
}

type iShellLinkWVtbl struct {
	iUnknownVtbl
	GetPath             uintptr
	GetIDList           uintptr
	SetIDList           uintptr
	GetDescription      uintptr
	SetDescription      uintptr
	GetWorkingDirectory uintptr
	SetWorkingDirectory uintptr
	GetArguments        uintptr
	SetArguments        uintptr
	GetHotkey           uintptr
	SetHotkey           uintptr
	GetShowCmd          uintptr
	SetShowCmd          uintptr
	GetIconLocation     uintptr
	SetIconLocation     uintptr
	SetRelativePath     uintptr
	Resolve             uintptr
	SetPath             uintptr
}

type comObject struct {
	vtbl uintptr
}

// ParseLnk resolves a Windows .lnk file via pure-Go COM IShellLinkW + IPersistFile (zero CGO).
func ParseLnk(lnkPath string) (*ShortcutInfo, error) {
	absPath, err := filepath.Abs(lnkPath)
	if err != nil {
		return nil, err
	}

	// COM apartment must remain bound to a single OS thread.
	type result struct {
		info *ShortcutInfo
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		hr, _, _ := procCoInitializeEx.Call(0, coinitApartmentThreaded)
		// S_OK (0) or S_FALSE (1) means we must call CoUninitialize; RPC_E_CHANGED_MODE means already initialized.
		needUninit := hr == 0 || hr == 1
		if needUninit {
			defer procCoUninitialize.Call()
		}

		var slPtr uintptr
		hr, _, _ = procCoCreateInstance.Call(
			uintptr(unsafe.Pointer(&clsidShellLink)),
			0,
			clsctxInprocServer,
			uintptr(unsafe.Pointer(&iidIShellLinkW)),
			uintptr(unsafe.Pointer(&slPtr)),
		)
		if int32(hr) < 0 || slPtr == 0 {
			ch <- result{nil, fmt.Errorf("CoCreateInstance(IShellLinkW) failed: 0x%08x", uint32(hr))}
			return
		}
		slObj := (*comObject)(unsafe.Pointer(slPtr))
		slVtbl := (*iShellLinkWVtbl)(unsafe.Pointer(slObj.vtbl))
		defer syscall.SyscallN(slVtbl.Release, slPtr)

		var pfPtr uintptr
		hr, _, _ = syscall.SyscallN(
			slVtbl.QueryInterface,
			slPtr,
			uintptr(unsafe.Pointer(&iidIPersistFile)),
			uintptr(unsafe.Pointer(&pfPtr)),
		)
		if int32(hr) < 0 || pfPtr == 0 {
			ch <- result{nil, fmt.Errorf("QueryInterface(IPersistFile) failed: 0x%08x", uint32(hr))}
			return
		}
		pfObj := (*comObject)(unsafe.Pointer(pfPtr))
		pfVtbl := (*iPersistFileVtbl)(unsafe.Pointer(pfObj.vtbl))
		defer syscall.SyscallN(pfVtbl.Release, pfPtr)

		pathUTF16, err := windows.UTF16PtrFromString(absPath)
		if err != nil {
			ch <- result{nil, err}
			return
		}
		hr, _, _ = syscall.SyscallN(pfVtbl.Load, pfPtr, uintptr(unsafe.Pointer(pathUTF16)), stgmRead)
		if int32(hr) < 0 {
			ch <- result{nil, fmt.Errorf("IPersistFile.Load(%q) failed: 0x%08x", absPath, uint32(hr))}
			return
		}

		info := &ShortcutInfo{}

		// GetPath
		pathBuf := make([]uint16, 1024)
		hr, _, _ = syscall.SyscallN(
			slVtbl.GetPath,
			slPtr,
			uintptr(unsafe.Pointer(&pathBuf[0])),
			uintptr(len(pathBuf)),
			0,
			slgpRawPath,
		)
		if int32(hr) >= 0 {
			info.TargetPath = expandEnvIfNeeded(windows.UTF16ToString(pathBuf))
		}

		// GetArguments
		argBuf := make([]uint16, 2048)
		hr, _, _ = syscall.SyscallN(slVtbl.GetArguments, slPtr, uintptr(unsafe.Pointer(&argBuf[0])), uintptr(len(argBuf)))
		if int32(hr) >= 0 {
			info.Arguments = strings.TrimSpace(windows.UTF16ToString(argBuf))
		}

		// GetWorkingDirectory
		wdBuf := make([]uint16, 1024)
		hr, _, _ = syscall.SyscallN(slVtbl.GetWorkingDirectory, slPtr, uintptr(unsafe.Pointer(&wdBuf[0])), uintptr(len(wdBuf)))
		if int32(hr) >= 0 {
			info.WorkingDir = expandEnvIfNeeded(strings.TrimSpace(windows.UTF16ToString(wdBuf)))
		}

		// GetIconLocation
		iconBuf := make([]uint16, 1024)
		var iconIdx int32
		hr, _, _ = syscall.SyscallN(
			slVtbl.GetIconLocation,
			slPtr,
			uintptr(unsafe.Pointer(&iconBuf[0])),
			uintptr(len(iconBuf)),
			uintptr(unsafe.Pointer(&iconIdx)),
		)
		if int32(hr) >= 0 {
			info.IconLocation = expandEnvIfNeeded(strings.TrimSpace(windows.UTF16ToString(iconBuf)))
			info.IconIndex = int(iconIdx)
		}

		// GetDescription
		descBuf := make([]uint16, 1024)
		hr, _, _ = syscall.SyscallN(slVtbl.GetDescription, slPtr, uintptr(unsafe.Pointer(&descBuf[0])), uintptr(len(descBuf)))
		if int32(hr) >= 0 {
			info.Description = strings.TrimSpace(windows.UTF16ToString(descBuf))
		}

		ch <- result{info, nil}
	}()

	res := <-ch
	return res.info, res.err
}

func expandEnvIfNeeded(p string) string {
	if p == "" || !strings.Contains(p, "%") {
		return p
	}
	in, err := windows.UTF16PtrFromString(p)
	if err != nil {
		return p
	}
	out := make([]uint16, 1024)
	n, _, _ := kernel32ExpandEnv.Call(uintptr(unsafe.Pointer(in)), uintptr(unsafe.Pointer(&out[0])), uintptr(len(out)))
	if n == 0 || int(n) > len(out) {
		return p
	}
	return windows.UTF16ToString(out)
}

var (
	kernel32DLL       = windows.NewLazySystemDLL("kernel32.dll")
	kernel32ExpandEnv = kernel32DLL.NewProc("ExpandEnvironmentStringsW")
)
