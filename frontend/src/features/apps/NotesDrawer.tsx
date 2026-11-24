import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Eye, Edit3, Save, Sparkles, Play } from "lucide-react";
import { AppIcon } from "./AppIcon";
import type { AppItem } from "../../../bindings/nekomanage/internal/model/models";

const SHORTCUT_TEMPLATE = `## 🐾 常用快捷键备忘

| 快捷键 | 功能说明 |
| :--- | :--- |
| \`Ctrl + K\` | 快速搜索 |
| \`Ctrl + S\` | 保存当前更改 |

## 💡 使用小贴士
- 在这里记录常用命令行参数、配置路径或注意事项~
`;

interface NotesDrawerProps {
  app: AppItem | null;
  onClose: () => void;
  onSaveNotes: (appId: number, notesMd: string) => Promise<void>;
  onLaunch: (app: AppItem) => void;
}

export const NotesDrawer: React.FC<NotesDrawerProps> = ({
  app,
  onClose,
  onSaveNotes,
  onLaunch,
}) => {
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!app) return;
    setDraft(app.notesMd || "");
    setMode(app.notesMd?.trim() ? "preview" : "edit");
  }, [app]);

  const dirty = app ? draft !== (app.notesMd || "") : false;

  const handleSave = async () => {
    if (!app) return;
    setSaving(true);
    try {
      await onSaveNotes(app.id, draft);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!app) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!app) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l shadow-2xl"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-soft)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div
          className="flex items-center justify-between gap-2 border-b px-4 py-3.5"
          style={{ borderColor: "var(--border-soft)", background: "var(--bg-elevated)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AppIcon iconType={app.iconType} iconValue={app.iconValue} name={app.name} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                {app.name} · 使用说明与备忘
              </div>
              <div className="truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                {app.targetPath}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onLaunch(app)}
              title="立即启动该应用"
              className="flex h-7 items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold text-white transition hover:opacity-90"
              style={{ background: "var(--accent)" }}
            >
              <Play className="h-3 w-3 fill-current" />
              启动
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-1.5 transition hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mode Switcher Toolbar */}
        <div
          className="flex items-center justify-between border-b px-4 py-2"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <div
            className="inline-flex rounded-xl p-0.5"
            style={{ background: "var(--bg-pill)" }}
          >
            <button
              type="button"
              onClick={() => setMode("preview")}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition"
              style={{
                background: mode === "preview" ? "var(--bg-surface)" : "transparent",
                color: mode === "preview" ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition"
              style={{
                background: mode === "edit" ? "var(--bg-surface)" : "transparent",
                color: mode === "edit" ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              <Edit3 className="h-3.5 w-3.5" />
              Markdown 编辑
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {mode === "edit" && (
              <button
                type="button"
                onClick={() => setDraft((prev) => (prev ? prev + "\n\n" + SHORTCUT_TEMPLATE : SHORTCUT_TEMPLATE))}
                className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 text-[10px] font-semibold transition hover:opacity-80"
                style={{
                  borderColor: "var(--border-soft)",
                  color: "var(--text-secondary)",
                }}
              >
                <Sparkles className="h-3 w-3" style={{ color: "var(--accent)" }} />
                快捷键模板
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold text-white transition disabled:opacity-40"
              style={{ background: "var(--accent)" }}
              title="Ctrl+S 快捷保存"
            >
              <Save className="h-3 w-3" />
              {saving ? "保存中" : dirty ? "保存" : "已保存"}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {mode === "edit" ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="支持完整 Markdown 语法（标题、表格、代码块、快捷键反引号等）&#10;保存后顶部搜索框也可以直接检索这里的备忘内容喵~"
              className="h-full w-full resize-none rounded-2xl border p-3.5 font-mono text-xs leading-relaxed outline-none select-text"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--border-soft)",
                color: "var(--text-primary)",
              }}
            />
          ) : draft.trim() ? (
            <div className="neko-markdown select-text text-xs leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                还没有写使用说明或快捷键备忘呢~
              </p>
              <button
                type="button"
                onClick={() => {
                  setDraft(SHORTCUT_TEMPLATE);
                  setMode("edit");
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold"
                style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                套用快捷键备忘模板
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
