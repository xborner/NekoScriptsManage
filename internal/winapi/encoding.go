package winapi

import (
	"bytes"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

// DecodeWindowsOutput converts raw Windows console output bytes into valid UTF-8 text.
// It checks line-by-line so mixed UTF-8 + GB18030/GBK output streams never produce garbled Chinese.
func DecodeWindowsOutput(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	// Strip UTF-8 BOM if present at start
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})

	if utf8.Valid(raw) {
		return string(raw)
	}

	// Decode line-by-line so valid UTF-8 lines stay untouched while GBK/GB18030 lines decode cleanly.
	lines := bytes.SplitAfter(raw, []byte("\n"))
	var out bytes.Buffer
	out.Grow(len(raw) + len(raw)/4)
	decoder := simplifiedchinese.GB18030.NewDecoder()

	for _, line := range lines {
		if len(line) == 0 {
			continue
		}
		if utf8.Valid(line) {
			out.Write(line)
			continue
		}
		decoded, err := decoder.Bytes(line)
		if err != nil {
			out.Write(line)
		} else {
			out.Write(decoded)
		}
	}
	return out.String()
}
