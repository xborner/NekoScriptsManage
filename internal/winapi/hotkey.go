package winapi

import (
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32               = windows.NewLazySystemDLL("user32.dll")
	procRegisterHotKey   = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procPostThreadMsgW   = user32.NewProc("PostThreadMessageW")
	procPeekMessageW     = user32.NewProc("PeekMessageW")
)

const (
	modAlt      uint32 = 0x0001
	modControl  uint32 = 0x0002
	modShift    uint32 = 0x0004
	modWin      uint32 = 0x0008
	modNoRepeat uint32 = 0x4000

	wmQuit        uint32 = 0x0012
	wmHotKey      uint32 = 0x0312
	wmAppRebind   uint32 = 0x8001
	pmNoRemove    uint32 = 0x0000
	hotkeySlotID  uintptr = 1
)

type winMSG struct {
	HWND    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}

type rebindRequest struct {
	spec string
	mods uint32
	vk   uint32
	resp chan error
}

// HotkeyManager listens to a single global Windows hotkey on a dedicated locked OS thread.
// It supports live rebinding and clean shutdown without CGO.
type HotkeyManager struct {
	mu          sync.Mutex
	threadID    uint32
	activeSpec  string
	registered  bool
	closed      bool
	pendingReq  *rebindRequest
	onTrigger   func()
	readyCh     chan struct{}
	doneCh      chan struct{}
}

// NewHotkeyManager starts the dedicated message-loop OS thread.
func NewHotkeyManager(onTrigger func()) *HotkeyManager {
	m := &HotkeyManager{
		onTrigger: onTrigger,
		readyCh:   make(chan struct{}),
		doneCh:    make(chan struct{}),
	}
	go m.loop()
	<-m.readyCh
	return m
}

func (m *HotkeyManager) loop() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(m.doneCh)

	tid := windows.GetCurrentThreadId()

	// Ensure thread message queue exists before signalling ready.
	var dummy winMSG
	_, _, _ = procPeekMessageW.Call(uintptr(unsafe.Pointer(&dummy)), 0, 0, 0, uintptr(pmNoRemove))

	m.mu.Lock()
	m.threadID = tid
	m.mu.Unlock()
	close(m.readyCh)

	var msg winMSG
	for {
		ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(ret) <= 0 {
			// 0 == WM_QUIT, -1 == error
			break
		}

		switch msg.Message {
		case wmHotKey:
			if msg.WParam == hotkeySlotID && m.onTrigger != nil {
				// Run callback off the message loop thread so window ops never stall WM_HOTKEY.
				go m.onTrigger()
			}
		case wmAppRebind:
			m.handleRebindOnThread()
		}
	}

	m.mu.Lock()
	if m.registered {
		_, _, _ = procUnregisterHotKey.Call(0, hotkeySlotID)
		m.registered = false
	}
	m.mu.Unlock()
}

func (m *HotkeyManager) handleRebindOnThread() {
	m.mu.Lock()
	req := m.pendingReq
	m.pendingReq = nil
	wasRegistered := m.registered
	m.mu.Unlock()

	if req == nil {
		return
	}

	if wasRegistered {
		_, _, _ = procUnregisterHotKey.Call(0, hotkeySlotID)
		m.mu.Lock()
		m.registered = false
		m.mu.Unlock()
	}

	// Empty spec means disable global hotkey.
	if req.spec == "" {
		m.mu.Lock()
		m.activeSpec = ""
		m.mu.Unlock()
		req.resp <- nil
		return
	}

	r1, _, err := procRegisterHotKey.Call(
		0,
		hotkeySlotID,
		uintptr(req.mods|modNoRepeat),
		uintptr(req.vk),
	)
	if r1 == 0 {
		if errors.Is(err, syscall.Errno(1409)) {
			req.resp <- fmt.Errorf("快捷键 %s 已被其他软件占用，请换一个组合", req.spec)
		} else {
			req.resp <- fmt.Errorf("注册快捷键 %s 失败: %v", req.spec, err)
		}
		return
	}

	m.mu.Lock()
	m.registered = true
	m.activeSpec = req.spec
	m.mu.Unlock()
	req.resp <- nil
}

// Register binds (or rebinds) the global hotkey string, e.g. "Alt+Space" or "Ctrl+Alt+N".
// Passing an empty string unregisters the current hotkey.
func (m *HotkeyManager) Register(spec string) error {
	clean := strings.TrimSpace(spec)
	var mods, vk uint32
	if clean != "" {
		var err error
		mods, vk, clean, err = ParseHotkey(clean)
		if err != nil {
			return err
		}
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return errors.New("hotkey manager is closed")
	}
	resp := make(chan error, 1)
	m.pendingReq = &rebindRequest{
		spec: clean,
		mods: mods,
		vk:   vk,
		resp: resp,
	}
	tid := m.threadID
	m.mu.Unlock()

	r1, _, err := procPostThreadMsgW.Call(uintptr(tid), uintptr(wmAppRebind), 0, 0)
	if r1 == 0 {
		return fmt.Errorf("post rebind message failed: %v", err)
	}
	return <-resp
}

// Active returns whether a hotkey is currently registered and its normalized spec.
func (m *HotkeyManager) Active() (bool, string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.registered, m.activeSpec
}

// Close unregisters any active hotkey and stops the message loop thread.
func (m *HotkeyManager) Close() {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.closed = true
	tid := m.threadID
	m.mu.Unlock()

	_, _, _ = procPostThreadMsgW.Call(uintptr(tid), uintptr(wmQuit), 0, 0)
	<-m.doneCh
}

// ParseHotkey parses a human-readable hotkey like "Alt+Space", "Ctrl+Shift+K", "Alt+F2"
// into Windows modifier flags, virtual-key code, and canonical formatting.
func ParseHotkey(spec string) (mods uint32, vk uint32, canonical string, err error) {
	rawParts := strings.Split(spec, "+")
	var keyPart string
	var hasCtrl, hasAlt, hasShift, hasWin bool

	for _, p := range rawParts {
		token := strings.TrimSpace(p)
		if token == "" {
			continue
		}
		switch strings.ToLower(token) {
		case "ctrl", "control":
			hasCtrl = true
		case "alt", "option":
			hasAlt = true
		case "shift":
			hasShift = true
		case "win", "super", "meta":
			hasWin = true
		default:
			if keyPart != "" {
				return 0, 0, "", fmt.Errorf("快捷键只能包含一个主键: %q", spec)
			}
			keyPart = token
		}
	}

	if hasCtrl {
		mods |= modControl
	}
	if hasAlt {
		mods |= modAlt
	}
	if hasShift {
		mods |= modShift
	}
	if hasWin {
		mods |= modWin
	}
	if mods == 0 {
		return 0, 0, "", errors.New("全局快捷键必须包含至少一个修饰键（Ctrl / Alt / Shift / Win）")
	}
	if keyPart == "" {
		return 0, 0, "", errors.New("请指定一个主键（如 Space、Q、F2）")
	}

	vk, normKey, ok := parseVirtualKey(keyPart)
	if !ok {
		return 0, 0, "", fmt.Errorf("不支持的按键: %q", keyPart)
	}

	var parts []string
	if hasCtrl {
		parts = append(parts, "Ctrl")
	}
	if hasAlt {
		parts = append(parts, "Alt")
	}
	if hasShift {
		parts = append(parts, "Shift")
	}
	if hasWin {
		parts = append(parts, "Win")
	}
	parts = append(parts, normKey)
	return mods, vk, strings.Join(parts, "+"), nil
}

func parseVirtualKey(key string) (uint32, string, bool) {
	upper := strings.ToUpper(strings.TrimSpace(key))
	if len(upper) == 1 {
		ch := upper[0]
		if (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') {
			return uint32(ch), upper, true
		}
	}
	switch upper {
	case "SPACE", "SPACEBAR":
		return 0x20, "Space", true
	case "TAB":
		return 0x09, "Tab", true
	case "ENTER", "RETURN":
		return 0x0D, "Enter", true
	case "ESC", "ESCAPE":
		return 0x1B, "Esc", true
	case "BACKQUOTE", "`", "~":
		return 0xC0, "`", true
	case "MINUS", "-":
		return 0xBD, "-", true
	case "EQUAL", "=":
		return 0xBB, "=", true
	case "UP":
		return 0x26, "Up", true
	case "DOWN":
		return 0x28, "Down", true
	case "LEFT":
		return 0x25, "Left", true
	case "RIGHT":
		return 0x27, "Right", true
	}
	if strings.HasPrefix(upper, "F") && len(upper) >= 2 {
		if n, err := strconv.Atoi(upper[1:]); err == nil && n >= 1 && n <= 12 {
			return uint32(0x70 + n - 1), fmt.Sprintf("F%d", n), true
		}
	}
	return 0, "", false
}
