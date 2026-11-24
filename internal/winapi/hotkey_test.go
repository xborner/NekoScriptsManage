package winapi

import "testing"

func TestParseHotkey(t *testing.T) {
	tests := []struct {
		in        string
		wantCanon string
		wantMods  uint32
		wantVK    uint32
		wantErr   bool
	}{
		{"Alt+Space", "Alt+Space", modAlt, 0x20, false},
		{"ctrl + alt + n", "Ctrl+Alt+N", modControl | modAlt, 'N', false},
		{"Shift+F2", "Shift+F2", modShift, 0x71, false},
		{"Space", "", 0, 0, true},         // missing modifier
		{"Alt+", "", 0, 0, true},          // missing key
		{"Alt+Ctrl+A+B", "", 0, 0, true},  // multiple main keys
		{"Alt+UnknownKey", "", 0, 0, true},
	}

	for _, tc := range tests {
		mods, vk, canon, err := ParseHotkey(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("ParseHotkey(%q) expected error, got nil", tc.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseHotkey(%q) unexpected error: %v", tc.in, err)
			continue
		}
		if mods != tc.wantMods || vk != tc.wantVK || canon != tc.wantCanon {
			t.Errorf("ParseHotkey(%q) = (%#x, %#x, %q), want (%#x, %#x, %q)",
				tc.in, mods, vk, canon, tc.wantMods, tc.wantVK, tc.wantCanon)
		}
	}
}
