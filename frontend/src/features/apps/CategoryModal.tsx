import React, { useEffect, useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { Category, CategoryInput } from "../../../bindings/nekomanage/internal/model/models";

const PRESET_EMOJIS = ["✨", "💻", "📁", "🎮", "🎨", "📝", "🎵", "🔧", "🌐", "🐾", "🍓", "☁️"];
const PRESET_COLORS = [
  "#FF9EB5",
  "#6CD4B5",
  "#7CC4FA",
  "#F6C667",
  "#C4A7F7",
  "#FFA88A",
  "#8AD6E8",
  "#A9D977",
];

interface CategoryModalProps {
  open: boolean;
  editing: Category | null;
  onClose: () => void;
  onSave: (input: CategoryInput) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}

export const CategoryModal: React.FC<CategoryModalProps> = ({
  open,
  editing,
  onClose,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🐾");
  const [color, setColor] = useState("#FF9EB5");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setIcon(editing.icon || "🐾");
      setColor(editing.color || "#FF9EB5");
    } else {
      setName("");
      setIcon("🐾");
      setColor("#FF9EB5");
    }
  }, [open, editing]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        id: editing?.id || 0,
        name: name.trim(),
        icon: icon.trim() || "🐾",
        color,
        sortOrder: editing?.sortOrder || 0,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
      <form
        onSubmit={handleSubmit}
        className="neko-card w-full max-w-sm rounded-2xl p-5 space-y-4"
        style={{ background: "var(--bg-surface)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {editing ? "编辑应用分类" : "新建应用分类"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1 transition hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            分类名称
          </label>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：效率工具、设计软件..."
            className="h-9 w-full rounded-xl border px-3 text-xs outline-none"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border-soft)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            选择可爱图标
          </label>
          <div className="grid grid-cols-6 gap-1.5">
            {PRESET_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setIcon(em)}
                className="flex h-9 items-center justify-center rounded-xl border text-base transition hover:scale-105"
                style={{
                  background: icon === em ? "var(--accent-soft)" : "var(--bg-elevated)",
                  borderColor: icon === em ? "var(--accent)" : "var(--border-soft)",
                }}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            马卡龙徽章色
          </label>
          <div className="flex items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                style={{
                  background: c,
                  boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : "none",
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          {editing && onDelete ? (
            <button
              type="button"
              onClick={async () => {
                setSaving(true);
                try {
                  await onDelete(editing.id);
                  onClose();
                } finally {
                  setSaving(false);
                }
              }}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除分类
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border px-3.5 py-1.5 text-xs font-semibold"
              style={{
                borderColor: "var(--border-soft)",
                color: "var(--text-secondary)",
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-xl px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
