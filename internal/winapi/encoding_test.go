package winapi

import (
	"testing"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func TestDecodeWindowsOutputUTF8AndGB18030(t *testing.T) {
	// 1. Valid UTF-8 stays identical
	utf8Text := "你好，猫娘脚本管理器！\r\nDone."
	if got := DecodeWindowsOutput([]byte(utf8Text)); got != utf8Text {
		t.Fatalf("UTF-8 mismatch: got %q, want %q", got, utf8Text)
	}

	// 2. Pure GB18030/GBK bytes decode cleanly to UTF-8
	wantChinese := "正在执行备份任务：成功完成！\r\n"
	gbkBytes, err := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(wantChinese))
	if err != nil {
		t.Fatalf("encode GB18030: %v", err)
	}
	if got := DecodeWindowsOutput(gbkBytes); got != wantChinese {
		t.Fatalf("GB18030 decode mismatch: got %q, want %q", got, wantChinese)
	}

	// 3. Mixed UTF-8 line + GB18030 line
	line1 := "UTF8行：你好喵\n"
	line2 := "GBK行：中文日志测试\n"
	line2GBK, _ := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(line2))
	mixed := append([]byte(line1), line2GBK...)
	if got := DecodeWindowsOutput(mixed); got != line1+line2 {
		t.Fatalf("mixed decode mismatch: got %q, want %q", got, line1+line2)
	}
}

func TestSplitCommandArgs(t *testing.T) {
	got := SplitCommandArgs(`--path "C:\Program Files\Neko App" -v --tag 'hello world'`)
	want := []string{"--path", `C:\Program Files\Neko App`, "-v", "--tag", "hello world"}
	if len(got) != len(want) {
		t.Fatalf("len=%d want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("arg[%d]=%q want %q", i, got[i], want[i])
		}
	}
}
