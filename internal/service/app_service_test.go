package service

import (
	"os"
	"path/filepath"
	"testing"

	"nekomanage/internal/config"
	"nekomanage/internal/db"
	"nekomanage/internal/model"
)

func TestAppServiceCategoryAndAppCRUD(t *testing.T) {
	paths, err := config.ResolveAt(filepath.Join(t.TempDir(), "data"), true)
	if err != nil {
		t.Fatalf("ResolveAt: %v", err)
	}
	store, err := db.Open(paths.DBPath)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	defer store.Close()

	svc := NewAppService(store, paths, nil)

	// 1. Starter categories exist
	cats, err := svc.ListCategories()
	if err != nil || len(cats) != 3 {
		t.Fatalf("expected 3 starter categories, got %d (err=%v)", len(cats), err)
	}

	// 2. Create custom category
	cat, err := svc.SaveCategory(model.CategoryInput{Name: "设计绘图", Icon: "🎨", Color: "#F47C9B"})
	if err != nil {
		t.Fatalf("SaveCategory: %v", err)
	}

	// 3. Create app with Markdown notes
	notepad := filepath.Join(os.Getenv("WINDIR"), "notepad.exe")
	appItem, err := svc.SaveApp(model.AppInput{
		CategoryID: &cat.ID,
		Name:       "记事本",
		TargetPath: notepad,
		IconType:   "emoji",
		IconValue:  "📝",
		Tags:       "文本,笔记",
		NotesMD:    "# 快捷键\n- `Ctrl+S` 保存",
		IsPinned:   true,
	})
	if err != nil {
		t.Fatalf("SaveApp: %v", err)
	}

	// 4. Fuzzy search matches Markdown notes content
	found, err := svc.ListApps(model.AppFilter{Keyword: "Ctrl+S"})
	if err != nil || len(found) != 1 || found[0].ID != appItem.ID {
		t.Fatalf("expected fuzzy search to match notes_md, got %d items (err=%v)", len(found), err)
	}

	// 5. Update Markdown notes & toggle pin
	if err := svc.UpdateAppNotes(appItem.ID, "## 更新备忘\n`Ctrl+F` 搜索"); err != nil {
		t.Fatalf("UpdateAppNotes: %v", err)
	}
	pinned, err := svc.TogglePinApp(appItem.ID)
	if err != nil || pinned {
		t.Fatalf("expected TogglePinApp to unpin, got pinned=%v err=%v", pinned, err)
	}

	// 6. ImportDroppedPaths with real executable
	imported, err := svc.ImportDroppedPaths([]string{notepad}, &cat.ID)
	if err != nil || len(imported) != 1 {
		t.Fatalf("ImportDroppedPaths failed: len=%d err=%v", len(imported), err)
	}

	// 7. Delete category leaves apps intact (uncategorized)
	if err := svc.DeleteCategory(cat.ID); err != nil {
		t.Fatalf("DeleteCategory: %v", err)
	}
	all, err := svc.ListApps(model.AppFilter{})
	if err != nil || len(all) != 2 {
		t.Fatalf("expected 2 apps remaining after category delete, got %d (err=%v)", len(all), err)
	}
}
