package winapi

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32DLL              = windows.NewLazySystemDLL("shell32.dll")
	gdi32DLL                = windows.NewLazySystemDLL("gdi32.dll")
	procSHGetFileInfoW      = shell32DLL.NewProc("SHGetFileInfoW")
	procPrivateExtractIcons = user32.NewProc("PrivateExtractIconsW")
	procGetIconInfo         = user32.NewProc("GetIconInfo")
	procDestroyIcon         = user32.NewProc("DestroyIcon")
	procGetDC               = user32.NewProc("GetDC")
	procReleaseDC           = user32.NewProc("ReleaseDC")
	procGetObjectW          = gdi32DLL.NewProc("GetObjectW")
	procGetDIBits           = gdi32DLL.NewProc("GetDIBits")
	procDeleteObject        = gdi32DLL.NewProc("DeleteObject")
)

const (
	shgfiIcon      = 0x000000100
	shgfiLargeIcon = 0x000000000
	biRGB          = 0
	dibRGBColors   = 0
)

type shFileInfoW struct {
	HIcon         uintptr
	IIcon         int32
	DwAttributes  uint32
	SzDisplayName [260]uint16
	SzTypeName    [80]uint16
}

type iconInfo struct {
	FIcon    int32
	XHotspot uint32
	YHotspot uint32
	HbmMask  uintptr
	HbmColor uintptr
}

type winBitmap struct {
	BmType       int32
	BmWidth      int32
	BmHeight     int32
	BmWidthBytes int32
	BmPlanes     uint16
	BmBitsPixel  uint16
	BmBits       uintptr
}

type bitmapInfoHeader struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

// ExtractIconToPNG extracts a high-resolution icon from an .exe/.ico/.dll/.lnk/folder
// and caches it as a PNG in iconsDir, returning the cached filename (basename only).
func ExtractIconToPNG(targetPath string, iconLocation string, iconIndex int, iconsDir string) (string, error) {
	if targetPath == "" && iconLocation == "" {
		return "", errors.New("empty icon source path")
	}

	var hIcon uintptr

	// 1. Try explicit iconLocation (from .lnk) at 64x64 first.
	if iconLocation != "" {
		hIcon = privateExtractHICON(iconLocation, iconIndex, 64)
		if hIcon == 0 {
			hIcon = privateExtractHICON(iconLocation, iconIndex, 48)
		}
	}

	// 2. Try targetPath directly if executable/ico/dll at 64x64 or 48x48.
	if hIcon == 0 && targetPath != "" {
		ext := strings.ToLower(filepath.Ext(targetPath))
		if ext == ".exe" || ext == ".ico" || ext == ".dll" {
			hIcon = privateExtractHICON(targetPath, 0, 64)
			if hIcon == 0 {
				hIcon = privateExtractHICON(targetPath, 0, 48)
			}
		}
	}

	// 3. Fallback to SHGetFileInfoW (works for folders, .lnk, documents, etc.).
	if hIcon == 0 {
		src := targetPath
		if src == "" {
			src = iconLocation
		}
		hIcon = shellExtractHICON(src)
	}

	if hIcon == 0 {
		return "", fmt.Errorf("无法提取图标: %s", targetPath)
	}
	defer procDestroyIcon.Call(hIcon)

	img, err := hiconToNRGBA(hIcon)
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(iconsDir, 0o755); err != nil {
		return "", err
	}
	hashKey := fmt.Sprintf("%s|%s|%d", strings.ToLower(targetPath), strings.ToLower(iconLocation), iconIndex)
	sum := sha1.Sum([]byte(hashKey))
	fileName := "icon_" + hex.EncodeToString(sum[:8]) + ".png"
	outPath := filepath.Join(iconsDir, fileName)

	f, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		return "", err
	}
	return fileName, nil
}

// ImportCustomImageIcon imports a user-chosen PNG/JPG/GIF/ICO image into iconsDir as an optimized 128x128 PNG.
func ImportCustomImageIcon(srcPath string, iconsDir string) (string, error) {
	ext := strings.ToLower(filepath.Ext(srcPath))
	if ext == ".ico" || ext == ".exe" {
		return ExtractIconToPNG(srcPath, srcPath, 0, iconsDir)
	}

	f, err := os.Open(srcPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	decoded, _, err := image.Decode(f)
	if err != nil {
		return "", fmt.Errorf("无法解析图片格式: %w", err)
	}

	resized := resizeToFit(decoded, 128)
	if err := os.MkdirAll(iconsDir, 0o755); err != nil {
		return "", err
	}
	sum := sha1.Sum([]byte(srcPath + fmt.Sprintf("%d", resized.Bounds().Dx())))
	fileName := "custom_" + hex.EncodeToString(sum[:8]) + ".png"
	outPath := filepath.Join(iconsDir, fileName)

	out, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if err := png.Encode(out, resized); err != nil {
		return "", err
	}
	return fileName, nil
}

func privateExtractHICON(path string, index int, size int) uintptr {
	p16, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0
	}
	var hIcon uintptr
	var iconID uint32
	ret, _, _ := procPrivateExtractIcons.Call(
		uintptr(unsafe.Pointer(p16)),
		uintptr(index),
		uintptr(size),
		uintptr(size),
		uintptr(unsafe.Pointer(&hIcon)),
		uintptr(unsafe.Pointer(&iconID)),
		1,
		0,
	)
	if ret == 0 || ret == 0xFFFFFFFF || hIcon == 0 {
		return 0
	}
	return hIcon
}

func shellExtractHICON(path string) uintptr {
	p16, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0
	}
	var sfi shFileInfoW
	ret, _, _ := procSHGetFileInfoW.Call(
		uintptr(unsafe.Pointer(p16)),
		0,
		uintptr(unsafe.Pointer(&sfi)),
		unsafe.Sizeof(sfi),
		shgfiIcon|shgfiLargeIcon,
	)
	if ret == 0 {
		return 0
	}
	return sfi.HIcon
}

func hiconToNRGBA(hIcon uintptr) (*image.NRGBA, error) {
	var ii iconInfo
	r1, _, err := procGetIconInfo.Call(hIcon, uintptr(unsafe.Pointer(&ii)))
	if r1 == 0 {
		return nil, fmt.Errorf("GetIconInfo failed: %v", err)
	}
	if ii.HbmColor != 0 {
		defer procDeleteObject.Call(ii.HbmColor)
	}
	if ii.HbmMask != 0 {
		defer procDeleteObject.Call(ii.HbmMask)
	}

	if ii.HbmColor == 0 {
		return nil, errors.New("monochrome icon without color bitmap")
	}

	var bm winBitmap
	r1, _, _ = procGetObjectW.Call(ii.HbmColor, unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm)))
	if r1 == 0 || bm.BmWidth <= 0 || bm.BmHeight <= 0 {
		return nil, errors.New("GetObjectW failed for icon bitmap")
	}

	w := int(bm.BmWidth)
	h := int(bm.BmHeight)

	hdc, _, _ := procGetDC.Call(0)
	if hdc == 0 {
		return nil, errors.New("GetDC failed")
	}
	defer procReleaseDC.Call(0, hdc)

	colorPixels, err := readBitmapBGRA(hdc, ii.HbmColor, w, h)
	if err != nil {
		return nil, err
	}

	// Check whether icon carries real alpha channel.
	hasAlpha := false
	for i := 3; i < len(colorPixels); i += 4 {
		if colorPixels[i] != 0 {
			hasAlpha = true
			break
		}
	}

	var maskPixels []byte
	if !hasAlpha && ii.HbmMask != 0 {
		maskPixels, _ = readBitmapBGRA(hdc, ii.HbmMask, w, h)
	}

	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			off := (y*w + x) * 4
			b := colorPixels[off]
			g := colorPixels[off+1]
			r := colorPixels[off+2]
			a := colorPixels[off+3]

			if !hasAlpha {
				if len(maskPixels) == len(colorPixels) {
					// In Windows icon AND mask, white (255) = transparent, black (0) = opaque.
					if maskPixels[off] > 127 && maskPixels[off+1] > 127 && maskPixels[off+2] > 127 {
						a = 0
					} else {
						a = 255
					}
				} else {
					a = 255
				}
			}
			dst.SetNRGBA(x, y, color.NRGBA{R: r, G: g, B: b, A: a})
		}
	}
	return dst, nil
}

func readBitmapBGRA(hdc, hbm uintptr, w, h int) ([]byte, error) {
	bih := bitmapInfoHeader{
		BiSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		BiWidth:       int32(w),
		BiHeight:      -int32(h), // negative height => top-down DIB
		BiPlanes:      1,
		BiBitCount:    32,
		BiCompression: biRGB,
	}
	buf := make([]byte, w*h*4)
	r1, _, err := procGetDIBits.Call(
		hdc,
		hbm,
		0,
		uintptr(h),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&bih)),
		dibRGBColors,
	)
	if r1 == 0 {
		return nil, fmt.Errorf("GetDIBits failed: %v", err)
	}
	return buf, nil
}

func resizeToFit(src image.Image, maxDim int) *image.NRGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	dw, dh := sw, sh
	if sw > maxDim || sh > maxDim {
		if sw >= sh {
			dw = maxDim
			dh = int(math.Max(1, math.Round(float64(sh)*float64(maxDim)/float64(sw))))
		} else {
			dh = maxDim
			dw = int(math.Max(1, math.Round(float64(sw)*float64(maxDim)/float64(sh))))
		}
	}

	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < dh; y++ {
		sy := b.Min.Y + int(float64(y)*float64(sh)/float64(dh))
		if sy >= b.Max.Y {
			sy = b.Max.Y - 1
		}
		for x := 0; x < dw; x++ {
			sx := b.Min.X + int(float64(x)*float64(sw)/float64(dw))
			if sx >= b.Max.X {
				sx = b.Max.X - 1
			}
			dst.Set(x, y, color.NRGBAModel.Convert(src.At(sx, sy)))
		}
	}
	return dst
}
