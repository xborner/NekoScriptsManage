import React, { useEffect, useState } from "react";
import {
  X,
  FileSearch,
  FolderOpen,
  ImagePlus,
  Wand2,
  Shield,
  Pin,
} from "lucide-react";
import { AppIcon } from "./AppIcon";
import * as AppService from "../../../bindings/nekomanage/internal/service/appservice";
import type { AppInput, AppItem, Category } from "../../../bindings/nekomanage/internal/model/models";

const CUTE_EMOJIS = [
  "🐾", "✨", "💻", "🚀", "📁", "📝", "🎨", "🎵",
  "🎮", "🔧", "🌐", "📦", "⚡", "🍓", "🌸", "🐱",
];

interface AppFormModalProps {
  open: boolean;
  editing: AppItem | null;
  defaultCategoryId: number | null;
  categories: Category[];
  onClose: () => void;
  onSave: (input: AppInput) => Promise<void>;
  onToast: (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

export const AppFormModal: React.FC<AppFormModalProps> = ({
  open,
  editing,
  defaultCategoryId,
  categories,
  onClose,
  onSave,
  onToast,
}) => {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [targetPath, setTargetPath] = useState("");
  const [argumentsStr, setArgumentsStr] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [iconType, setIconType] = useState<"extracted" | "custom" | "emoji">("extracted");
  const [iconValue, setIconValue] = useState("");
  const [runAsAdmin, setRunAsAdmin] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [tags, setTags] = useState("");
  const [notesMd, setNotesMd] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setCategoryId(editing.categoryId ? String(editing.categoryId) : "");
      setTargetPath(editing.targetPath);
      setArgumentsStr(editing.arguments || "");
      setWorkingDir(editing.workingDir || "");
      setIconType((editing.iconType as "extracted" | "custom" | "emoji") || "extracted");
      setIconValue(editing.iconValue || "");
      setRunAsAdmin(editing.runAsAdmin);
      setIsPinned(editing.isPinned);
      setTags(editing.tags || "");
      setNotesMd(editing.notesMd || "");
    } else {
      setName("");
      setCategoryId(defaultCategoryId ? String(defaultCategoryId) : "");
      setTargetPath("");
      setArgumentsStr("");
      setWorkingDir("");
      setIconType("extracted");
      setIconValue("");
      setRunAsAdmin(false);
      setIsPinned(false);
      setTags("");
      setNotesMd("");
    }
  }, [open, editing, defaultCategoryId]);

  if (!open) return null;

  const handlePickTarget = async (mode: "file" | "dir") => {
    try {
      const chosen = await AppService.PickTargetFile(mode);
      if (!chosen) return;
      setTargetPath(chosen);
      if (!name.trim()) {
        const parts = chosen.replace(/\\+$/, "").split("\\");
        const base = parts[parts.length - 1] || chosen;
        setName(mode === "dir" ? base : base.replace(/\.[^.]+$/, ""));
      }
      if (!workingDir.trim()) {
        if (mode === "dir") {
          setWorkingDir(chosen);
        } else {
          const idx = chosen.lastIndexOf("\\");
          if (idx > 0) setWorkingDir(chosen.slice(0, idx));
        }
      }
      // Auto extract icon right away for instant preview
      setExtracting(true);
      try {
        const cached = await AppService.ExtractIconForPath(chosen);
        if (cached) {
          setIconType("extracted");
          setIconValue(cached);
        }
      } catch {
        // ignore preview extraction errors
      } finally {
        setExtracting(false);
      }
    } catch (err) {
      onToast("error", `选择路径失败: ${String(err)}`);
    }
  };

  const handlePickWorkingDir = async () => {
    try {
      const chosen = await AppService.PickTargetFile("dir");
      if (chosen) setWorkingDir(chosen);
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleReExtractIcon = async () => {
    if (!targetPath.trim()) {
      onToast("warn", "请先填写目标路径再提取图标喵~");
      return;
    }
    setExtracting(true);
    try {
      const cached = await AppService.ExtractIconForPath(targetPath.trim());
      if (cached) {
        setIconType("extracted");
        setIconValue(cached);
        onToast("success", "已重新提取并缓存高清图标");
      }
    } catch (err) {
      onToast("error", `提取图标失败: ${String(err)}`);
    } finally {
      setExtracting(false);
    }
  };

  const handlePickCustomIcon = async () => {
    try {
      const cached = await AppService.PickCustomIcon();
      if (cached) {
        setIconType("custom");
        setIconValue(cached);
        onToast("success", "已导入自定义图标");
      }
    } catch (err) {
      onToast("error", `导入图标失败: ${String(err)}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !targetPath.trim()) {
      onToast("warn", "请填写应用名称和目标路径");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: editing?.id || 0,
        categoryId: categoryId ? Number(categoryId) : null,
        name: name.trim(),
        targetPath: targetPath.trim(),
        arguments: argumentsStr.trim(),
        workingDir: workingDir.trim(),
        iconType,
        iconValue,
        runAsAdmin,
        tags: tags.trim(),
        notesMd,
        isPinned,
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
        className="neko-card flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl"
        style={{ background: "var(--bg-surface)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-3.5"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <div className="flex items-center gap-2.5">
            <AppIcon iconType={iconType} iconValue={iconValue} name={name || "N"} size="sm" />
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {editing ? "编辑应用快捷方式" : "添加应用快捷方式"}
              </h3>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                支持可执行程序、.lnk 快捷方式、本地文件夹或网址
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 transition hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {/* Name + Category */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                应用名称 *
              </label>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：VS Code、微信、项目目录"
                className="h-9 w-full rounded-xl border px-3 text-xs outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                所属分类
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-9 w-full rounded-xl border px-3 text-xs outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">未分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Target Path */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              目标路径（程序 / 文件夹 / 网址）*
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                placeholder="C:\Program Files\...\app.exe 或 D:\work"
                className="h-9 flex-1 rounded-xl border px-3 font-mono text-[11px] outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
              <button
                type="button"
                onClick={() => void handlePickTarget("file")}
                className="inline-flex h-9 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition hover:opacity-85"
                style={{
                  background: "var(--bg-pill)",
                  borderColor: "var(--border-soft)",
                  color: "var(--accent-text)",
                }}
                title="选择可执行文件或快捷方式"
              >
                <FileSearch className="h-3.5 w-3.5" />
                文件
              </button>
              <button
                type="button"
                onClick={() => void handlePickTarget("dir")}
                className="inline-flex h-9 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition hover:opacity-85"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-secondary)",
                }}
                title="选择本地文件夹"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                文件夹
              </button>
            </div>
          </div>

          {/* Arguments + Working Dir */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                启动参数（可选）
              </label>
              <input
                type="text"
                value={argumentsStr}
                onChange={(e) => setArgumentsStr(e.target.value)}
                placeholder="例如：--incognito"
                className="h-9 w-full rounded-xl border px-3 font-mono text-[11px] outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                工作目录（可选）
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="默认取程序所在目录"
                  className="h-9 flex-1 rounded-xl border px-3 font-mono text-[11px] outline-none"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--border-soft)",
                    color: "var(--text-primary)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handlePickWorkingDir()}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--border-soft)",
                    color: "var(--text-secondary)",
                  }}
                  title="选择工作目录"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Icon Customization */}
          <div
            className="rounded-2xl border p-3 space-y-2.5"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border-soft)",
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <AppIcon iconType={iconType} iconValue={iconValue} name={name || "N"} size="md" />
                <div>
                  <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                    应用图标设置
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    支持提取程序原图标、自定义图片或可爱 Emoji
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleReExtractIcon()}
                  disabled={extracting}
                  className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition hover:opacity-85"
                  style={{
                    background: "var(--bg-surface)",
                    borderColor: "var(--border-soft)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  {extracting ? "提取中..." : "提取图标"}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePickCustomIcon()}
                  className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition hover:opacity-85"
                  style={{
                    background: "var(--bg-surface)",
                    borderColor: "var(--border-soft)",
                    color: "var(--accent-text)",
                  }}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  本地图片
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {CUTE_EMOJIS.map((em) => {
                const active = iconType === "emoji" && iconValue === em;
                return (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      setIconType("emoji");
                      setIconValue(em);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border text-sm transition hover:scale-110"
                    style={{
                      background: active ? "var(--accent-soft)" : "var(--bg-surface)",
                      borderColor: active ? "var(--accent)" : "var(--border-soft)",
                    }}
                  >
                    {em}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags & Switches */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                检索标签（逗号分隔）
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例如：编辑器,代码,前端"
                className="h-9 w-full rounded-xl border px-3 text-xs outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setRunAsAdmin((v) => !v)}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold transition"
                style={{
                  background: runAsAdmin ? "#fef3c7" : "var(--bg-elevated)",
                  borderColor: runAsAdmin ? "#f59e0b" : "var(--border-soft)",
                  color: runAsAdmin ? "#b45309" : "var(--text-secondary)",
                }}
              >
                <Shield className="h-3.5 w-3.5" />
                管理员运行
              </button>
              <button
                type="button"
                onClick={() => setIsPinned((v) => !v)}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold transition"
                style={{
                  background: isPinned ? "var(--accent-soft)" : "var(--bg-elevated)",
                  borderColor: isPinned ? "var(--accent)" : "var(--border-soft)",
                  color: isPinned ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                <Pin className="h-3.5 w-3.5" />
                置顶显示
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border px-4 py-1.5 text-xs font-semibold"
            style={{
              borderColor: "var(--border-soft)",
              color: "var(--text-secondary)",
            }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim() || !targetPath.trim()}
            className="rounded-xl px-5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {saving ? "保存中..." : editing ? "保存修改" : "添加到启动器"}
          </button>
        </div>
      </form>
    </div>
  );
};
