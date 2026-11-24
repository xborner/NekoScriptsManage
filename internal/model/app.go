package model

// Category represents a launcher grouping tab for apps.
type Category struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
	AppCount  int    `json:"appCount"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// CategoryInput is the DTO for creating or updating a category.
type CategoryInput struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
}

// AppItem represents a desktop application, shortcut, folder, or URL launcher entry.
type AppItem struct {
	ID             int64  `json:"id"`
	CategoryID     *int64 `json:"categoryId"`
	Name           string `json:"name"`
	TargetPath     string `json:"targetPath"`
	Arguments      string `json:"arguments"`
	WorkingDir     string `json:"workingDir"`
	IconType       string `json:"iconType"`  // "extracted" | "custom" | "emoji"
	IconValue      string `json:"iconValue"` // cached filename in data/icons/ or emoji string
	RunAsAdmin     bool   `json:"runAsAdmin"`
	Tags           string `json:"tags"`
	NotesMD        string `json:"notesMd"`
	ClickCount     int    `json:"clickCount"`
	IsPinned       bool   `json:"isPinned"`
	SortOrder      int    `json:"sortOrder"`
	LastLaunchedAt string `json:"lastLaunchedAt"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

// AppInput is the DTO for creating or updating an AppItem.
type AppInput struct {
	ID         int64  `json:"id"`
	CategoryID *int64 `json:"categoryId"`
	Name       string `json:"name"`
	TargetPath string `json:"targetPath"`
	Arguments  string `json:"arguments"`
	WorkingDir string `json:"workingDir"`
	IconType   string `json:"iconType"`
	IconValue  string `json:"iconValue"`
	RunAsAdmin bool   `json:"runAsAdmin"`
	Tags       string `json:"tags"`
	NotesMD    string `json:"notesMd"`
	IsPinned   bool   `json:"isPinned"`
	SortOrder  int    `json:"sortOrder"`
}

// AppFilter defines query filters for ListApps.
type AppFilter struct {
	CategoryID *int64 `json:"categoryId"`
	OnlyPinned bool   `json:"onlyPinned"`
	Keyword    string `json:"keyword"`
}
