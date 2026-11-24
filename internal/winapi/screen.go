package winapi

import "unsafe"

var (
	procMonitorFromPoint = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfoW  = user32.NewProc("GetMonitorInfoW")
)

const monitorDefaultToNearest = 0x00000002

type winRect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type monitorInfo struct {
	CbSize    uint32
	RcMonitor winRect
	RcWork    winRect
	DwFlags   uint32
}

// SnapToScreenEdge clamps a floating window into the nearest monitor's work area (avoiding taskbar)
// and gently snaps it to the left or right edge when within snapThreshold pixels.
func SnapToScreenEdge(x, y, winW, winH, snapThreshold int) (int, int) {
	cx := int32(x + winW/2)
	cy := int32(y + winH/2)
	// Pack POINT (two int32s) into uintptr for x64 MonitorFromPoint by-value ABI.
	ptPacked := uintptr(uint32(cx)) | (uintptr(uint32(cy)) << 32)
	hMon, _, _ := procMonitorFromPoint.Call(ptPacked, monitorDefaultToNearest)
	if hMon == 0 {
		return x, y
	}

	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	r1, _, _ := procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi)))
	if r1 == 0 {
		return x, y
	}

	margin := 8
	minX := int(mi.RcWork.Left) + margin
	maxX := int(mi.RcWork.Right) - winW - margin
	minY := int(mi.RcWork.Top) + margin
	maxY := int(mi.RcWork.Bottom) - winH - margin

	if maxX < minX {
		maxX = minX
	}
	if maxY < minY {
		maxY = minY
	}

	nx, ny := x, y
	if nx < minX {
		nx = minX
	} else if nx > maxX {
		nx = maxX
	}
	if ny < minY {
		ny = minY
	} else if ny > maxY {
		ny = maxY
	}

	if snapThreshold > 0 {
		if nx-minX <= snapThreshold {
			nx = minX
		} else if maxX-nx <= snapThreshold {
			nx = maxX
		}
	}

	return nx, ny
}
