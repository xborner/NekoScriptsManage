import React, { useEffect, useState } from "react";
import {
  X,
  FileCode2,
  FolderOpen,
  Terminal,
  EyeOff,
  Shield,
  Pin,
  Sparkles,
  FileText,
  Clock,
} from "lucide-react";
import * as ScriptService from "../../../bindings/nekomanage/internal/service/scriptservice";
import type { ScriptInput, ScriptItem } from "../../../bindings/nekomanage/internal/model/models";

const SCRIPT_TYPES = [
  { id: "bat", label: "BAT 批处理", ext: ".bat" },
  { id: "cmd", label: "CMD 脚本", ext: ".cmd" },
  { id: "ps1", label: "PowerShell", ext: ".ps1" },
  { id: "py", label: "Python", ext: ".py" },
  { id: "custom", label: "自定义命令", ext: "cmd" },
] as const;

const SAMPLE_TEMPLATES: Record<string, string> = {
  bat: `@echo off\necho [NekoScripts] 开始执行批处理任务喵~\necho 当前目录: %CD%\necho 当前时间: %DATE% %TIME%\necho 任务执行完成！\n`,
  cmd: `@echo off\necho [NekoScripts] CMD 任务启动...\ndir /b\n`,
  ps1: `Write-Host "[NekoScripts] PowerShell 任务开始~" -ForegroundColor Cyan\nGet-Date -Format "yyyy-MM-dd HH:mm:ss"\nWrite-Host "一切顺利，喵！" -ForegroundColor Green\n`,
  py: `import datetime, os\n\nprint("[NekoScripts] Python 脚本启动喵~")\nprint("工作目录:", os.getcwd())\nprint("当前时间:", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))\n`,
  custom: ``,
};

interface ScriptFormModalProps {
  open: boolean;
  editing: ScriptItem | null;
  onClose: () => void;
  onSave: (input: ScriptInput) => Promise<void>;
  onToast: (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

export const ScriptFormModal: React.FC<ScriptFormModalProps> = ({
  open,
  editing,
  onClose,
  onSave,
  onToast,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scriptType, setScriptType] = useState("bat");
  const [sourceMode, setSourceMode] = useState<"inline" | "file">("inline");
  const [filePath, setFilePath] = useState("");
  const [inlineContent, setInlineContent] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [argumentsStr, setArgumentsStr] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [runInTerminal, setRunInTerminal] = useState(false);
  const [runAsAdmin, setRunAsAdmin] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState(300);
  const [tags, setTags] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreviewText(null);
    if (editing) {
      setName(editing.name);
      setDescription(editing.description || "");
      setScriptType(editing.scriptType || "bat");
      setSourceMode(editing.sourceMode === "file" ? "file" : "inline");
      setFilePath(editing.sourceMode === "file" ? editing.filePath : "");
      setInlineContent(editing.inlineContent || "");
      setCustomCommand(editing.customCommand || "");
      setArgumentsStr(editing.arguments || "");
      setWorkingDir(editing.workingDir || "");
      setRunInTerminal(editing.runInTerminal);
      setRunAsAdmin(editing.runAsAdmin);
      setTimeoutSec(editing.timeoutSec);
      setTags(editing.tags || "");
      setIsPinned(editing.isPinned);
    } else {
      setName("");
      setDescription("");
      setScriptType("bat");
      setSourceMode("inline");
      setFilePath("");
      setInlineContent(SAMPLE_TEMPLATES.bat);
      setCustomCommand("");
      setArgumentsStr("");
      setWorkingDir("");
      setRunInTerminal(false);
      setRunAsAdmin(false);
      setTimeoutSec(300);
      setTags("");
      setIsPinned(false);
    }
  }, [open, editing]);

  if (!open) return null;

  const handlePickFile = async () => {
    try {
      const chosen = await ScriptService.PickScriptFile();
      if (!chosen) return;
      setFilePath(chosen);
      const lower = chosen.toLowerCase();
      if (lower.endsWith(".bat")) setScriptType("bat");
      else if (lower.endsWith(".cmd")) setScriptType("cmd");
      else if (lower.endsWith(".ps1")) setScriptType("ps1");
      else if (lower.endsWith(".py")) setScriptType("py");

      if (!name.trim()) {
        const parts = chosen.split("\\");
        const base = parts[parts.length - 1] || chosen;
        setName(base.replace(/\.[^.]+$/, ""));
      }
      if (!workingDir.trim()) {
        const idx = chosen.lastIndexOf("\\");
        if (idx > 0) setWorkingDir(chosen.slice(0, idx));
      }
    } catch (err) {
      onToast("error", `选择文件失败: ${String(err)}`);
    }
  };

  const handlePickWorkingDir = async () => {
    try {
      const chosen = await ScriptService.PickScriptWorkingDir();
      if (chosen) setWorkingDir(chosen);
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handlePreviewExternal = async () => {
    if (!filePath.trim()) {
      onToast("warn", "请先选择外部脚本文件");
      return;
    }
    try {
      const text = await ScriptService.ReadExternalFilePreview(filePath.trim());
      setPreviewText(text);
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = inlineContent.substring(0, start) + "  " + inlineContent.substring(end);
      setInlineContent(next);
      window.requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onToast("warn", "请填写脚本名称");
      return;
    }
    if (sourceMode === "file" && !filePath.trim() && !(scriptType === "custom" && customCommand.trim())) {
      onToast("warn", "请选择外部脚本文件路径");
      return;
    }
    if (sourceMode === "inline" && !inlineContent.trim() && !(scriptType === "custom" && customCommand.trim())) {
      onToast("warn", "请编写脚本代码或填写自定义命令");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        id: editing?.id || 0,
        name: name.trim(),
        description: description.trim(),
        scriptType,
        sourceMode,
        filePath: sourceMode === "file" ? filePath.trim() : editing?.filePath || "",
        inlineContent: sourceMode === "inline" ? inlineContent : "",
        customCommand: customCommand.trim(),
        arguments: argumentsStr.trim(),
        workingDir: workingDir.trim(),
        runInTerminal,
        runAsAdmin: runInTerminal ? runAsAdmin : false,
        timeoutSec: Math.max(0, Number(timeoutSec) || 0),
        tags: tags.trim(),
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
        className="neko-card flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
        style={{ background: "var(--bg-surface)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-3.5"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
            >
              <FileCode2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {editing ? "编辑本地脚本" : "新建本地脚本"}
              </h3>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                支持内联代码落盘与外部脚本关联，默认静默无黑框执行并自动防中文乱码
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

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {/* Name + Description */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                脚本名称 *
              </label>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：清理临时缓存、数据库定时备份"
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
                简短说明（可选）
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句话描述脚本用途"
                className="h-9 w-full rounded-xl border px-3 text-xs outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          </div>

          {/* Script Type Selector */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              脚本类型
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SCRIPT_TYPES.map((t) => {
                const active = scriptType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setScriptType(t.id)}
                    className="rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition"
                    style={{
                      background: active ? "var(--accent)" : "var(--bg-elevated)",
                      borderColor: active ? "var(--accent)" : "var(--border-soft)",
                      color: active ? "#ffffff" : "var(--text-secondary)",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Command Field (only when scriptType === custom) */}
          {scriptType === "custom" && (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                自定义执行命令（支持 <code className="rounded bg-black/5 px-1">{"{file}"}</code> 与{" "}
                <code className="rounded bg-black/5 px-1">{"{args}"}</code> 占位符）
              </label>
              <input
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder='例如：node "{file}" {args} 或 ipconfig /flushdns'
                className="h-9 w-full rounded-xl border px-3 font-mono text-[11px] outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          )}

          {/* Source Mode Switcher */}
          <div className="flex items-center justify-between gap-2">
            <div
              className="inline-flex rounded-xl p-0.5"
              style={{ background: "var(--bg-pill)" }}
            >
              <button
                type="button"
                onClick={() => setSourceMode("inline")}
                className="rounded-lg px-3 py-1 text-[11px] font-semibold transition"
                style={{
                  background: sourceMode === "inline" ? "var(--bg-surface)" : "transparent",
                  color: sourceMode === "inline" ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                内联代码编辑器
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("file")}
                className="rounded-lg px-3 py-1 text-[11px] font-semibold transition"
                style={{
                  background: sourceMode === "file" ? "var(--bg-surface)" : "transparent",
                  color: sourceMode === "file" ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                关联外部脚本文件
              </button>
            </div>

            {sourceMode === "inline" && SAMPLE_TEMPLATES[scriptType] && (
              <button
                type="button"
                onClick={() => setInlineContent(SAMPLE_TEMPLATES[scriptType])}
                className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[10px] font-semibold transition hover:opacity-85"
                style={{
                  borderColor: "var(--border-soft)",
                  color: "var(--accent-text)",
                  background: "var(--bg-elevated)",
                }}
              >
                <Sparkles className="h-3 w-3" />
                填入 {scriptType.toUpperCase()} 示例
              </button>
            )}
          </div>

          {/* Inline Editor OR External File Picker */}
          {sourceMode === "inline" ? (
            <div className="space-y-1">
              <textarea
                value={inlineContent}
                onChange={(e) => setInlineContent(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                rows={8}
                spellCheck={false}
                placeholder="在此编写脚本代码，保存时会自动同步写入便携目录 ./data/scripts/..."
                className="w-full resize-y rounded-2xl border p-3.5 font-mono text-xs leading-relaxed outline-none select-text"
                style={{
                  background: "#232530",
                  borderColor: "var(--border-soft)",
                  color: "#f3f4f8",
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="D:\scripts\backup.ps1"
                  className="h-9 flex-1 rounded-xl border px-3 font-mono text-[11px] outline-none"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--border-soft)",
                    color: "var(--text-primary)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handlePickFile()}
                  className="inline-flex h-9 items-center gap-1 rounded-xl border px-3 text-[11px] font-semibold"
                  style={{
                    background: "var(--bg-pill)",
                    borderColor: "var(--border-soft)",
                    color: "var(--accent-text)",
                  }}
                >
                  <FileText className="h-3.5 w-3.5" />
                  浏览文件
                </button>
                <button
                  type="button"
                  onClick={() => void handlePreviewExternal()}
                  className="inline-flex h-9 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--border-soft)",
                    color: "var(--text-secondary)",
                  }}
                >
                  预览内容
                </button>
              </div>
              {previewText !== null && (
                <pre
                  className="max-h-40 overflow-auto rounded-2xl border p-3 font-mono text-[11px] leading-relaxed select-text"
                  style={{
                    background: "#232530",
                    borderColor: "var(--border-soft)",
                    color: "#e2e8f0",
                  }}
                >
                  {previewText || "(空文件)"}
                </pre>
              )}
            </div>
          )}

          {/* Args + Working Dir */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                启动参数（可选）
              </label>
              <input
                type="text"
                value={argumentsStr}
                onChange={(e) => setArgumentsStr(e.target.value)}
                placeholder='例如：--env prod "D:\data"'
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
                  placeholder="默认取脚本所在目录"
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
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Timeout + Tags + Execution Switches */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                <Clock className="h-3 w-3" />
                超时限制（秒，0=不限）
              </label>
              <input
                type="number"
                min={0}
                max={86400}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
                className="h-9 w-full rounded-xl border px-3 text-xs outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                标签（逗号分隔）
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例如：运维,备份,日常"
                className="h-9 w-full rounded-xl border px-3 text-xs outline-none"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => setRunInTerminal((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-semibold transition"
              style={{
                background: runInTerminal ? "#e0f2fe" : "var(--accent-soft)",
                borderColor: runInTerminal ? "#38bdf8" : "var(--accent)",
                color: runInTerminal ? "#0369a1" : "var(--accent-text)",
              }}
            >
              {runInTerminal ? <Terminal className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {runInTerminal ? "弹出终端窗口运行" : "后台静默无黑框运行（推荐）"}
            </button>

            {runInTerminal && (
              <button
                type="button"
                onClick={() => setRunAsAdmin((v) => !v)}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-semibold transition"
                style={{
                  background: runAsAdmin ? "#fef3c7" : "var(--bg-elevated)",
                  borderColor: runAsAdmin ? "#f59e0b" : "var(--border-soft)",
                  color: runAsAdmin ? "#b45309" : "var(--text-secondary)",
                }}
              >
                <Shield className="h-3.5 w-3.5" />
                管理员权限弹窗
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsPinned((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-semibold transition"
              style={{
                background: isPinned ? "var(--accent-soft)" : "var(--bg-elevated)",
                borderColor: isPinned ? "var(--accent)" : "var(--border-soft)",
                color: isPinned ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              <Pin className="h-3.5 w-3.5" />
              置顶脚本
            </button>
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
            disabled={saving}
            className="rounded-xl px-5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {saving ? "保存中..." : editing ? "保存修改" : "保存脚本"}
          </button>
        </div>
      </form>
    </div>
  );
};
