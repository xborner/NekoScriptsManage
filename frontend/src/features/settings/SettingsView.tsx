import React, { useEffect, useState } from "react";
import {
  Palette,
  Keyboard,
  FolderOpen,
  Sparkles,
  ShieldCheck,
  Database,
  Power,
  EyeOff,
  Pin,
  Check,
  AlertCircle,
  Archive,
  Trash2,
} from "lucide-react";
import nekoBanner from "../../assets/neko/neko-banner.png";
import nekoAvatar from "../../assets/neko/neko-avatar.png";
import { THEMES, ThemeId } from "../../types/theme";
import type { AppInfo, AppSettings, WindowState } from "../../../bindings/nekomanage/internal/model/models";

interface SettingsViewProps {
  settings: AppSettings;
  windowState: WindowState;
  appInfo: AppInfo | null;
  onSelectTheme: (theme: ThemeId) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onUpdateHotkey: (spec: string) => Promise<void>;
  onTogglePin: () => void;
  onToggleFloatBall: () => void;
  onChangeFloatStyle: (style: "avatar" | "capsule") => void;
  onOpenDataDir: () => void;
  onExportBackup: () => Promise<void>;
  onRunLogCleanup: () => Promise<void>;
}

function formatKeyEventToHotkey(e: KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;

  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Win");
  if (mods.length === 0) return null;

  let mainKey = "";
  if (e.code === "Space" || key === " ") {
    mainKey = "Space";
  } else if (/^Key[A-Z]$/.test(e.code)) {
    mainKey = e.code.slice(3);
  } else if (/^Digit[0-9]$/.test(e.code)) {
    mainKey = e.code.slice(5);
  } else if (/^F([1-9]|1[0-2])$/.test(e.code)) {
    mainKey = e.code;
  } else if (e.code === "Backquote") {
    mainKey = "`";
  } else if (e.code === "Tab") {
    mainKey = "Tab";
  } else {
    return null;
  }

  return [...mods, mainKey].join("+");
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  windowState,
  appInfo,
  onSelectTheme,
  onUpdateSettings,
  onUpdateHotkey,
  onTogglePin,
  onToggleFloatBall,
  onChangeFloatStyle,
  onOpenDataDir,
  onExportBackup,
  onRunLogCleanup,
}) => {
  const [recording, setRecording] = useState(false);
  const [retDays, setRetDays] = useState(settings.logRetentionDays || 30);
  const [retMax, setRetMax] = useState(settings.logMaxCount || 500);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setRetDays(settings.logRetentionDays || 30);
    setRetMax(settings.logMaxCount || 500);
  }, [settings.logRetentionDays, settings.logMaxCount]);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const combo = formatKeyEventToHotkey(e);
      if (combo) {
        setRecording(false);
        void onUpdateHotkey(combo);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onUpdateHotkey]);

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      {/* Top Cute Catgirl Banner */}
      <div
        className="neko-card relative overflow-hidden rounded-2xl p-4"
        style={{ background: "var(--grad-banner)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-0.5 text-[10px] font-bold" style={{ color: "var(--accent-text)" }}>
              <ShieldCheck className="h-3 w-3" />
              严格绿色免安装 · {appInfo?.isDev ? "开发目录 dev_data" : "便携目录 ./data"}
            </div>
            <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              NekoScriptsManage v{appInfo?.version || "0.1.0"}
            </h2>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              轻盈高效的马卡龙悬浮启动器 + 本地脚本与定时任务管家
            </p>
          </div>
          <img
            src={nekoBanner}
            alt="Shizuku Banner"
            draggable={false}
            className="h-20 w-36 rounded-2xl object-cover shadow-sm border-2 border-white/80 shrink-0"
          />
        </div>
      </div>

      {/* 1. Macaron Theme Switcher */}
      <section className="neko-card rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <Palette className="h-4 w-4" style={{ color: "var(--accent)" }} />
          <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
            马卡龙外观主题（主窗口与悬浮球实时联动）
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {THEMES.map((t) => {
            const active = settings.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTheme(t.id)}
                className="relative flex flex-col items-start rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5"
                style={{
                  background: t.bg,
                  borderColor: active ? t.dot : t.border,
                  boxShadow: active ? `0 0 0 2px ${t.dot}44` : "none",
                }}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className="h-5 w-5 rounded-full border-2 border-white shadow-sm"
                    style={{ background: t.dot }}
                  />
                  {active && (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-white"
                      style={{ background: t.dot }}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <div className="mt-2.5 text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                  {t.name}
                </div>
                <div className="mt-0.5 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  {t.tagline}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Window & Floating Catgirl Ball */}
      <section className="neko-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" style={{ color: "var(--accent)" }} />
          <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
            窗口交互与猫娘悬浮球
          </h3>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {/* Hide on blur */}
          <ToggleRow
            icon={<EyeOff className="h-4 w-4" />}
            title="失焦自动隐藏"
            desc="未置顶时点击窗口外自动收纳到托盘"
            checked={windowState.hideOnBlur}
            onChange={(v) => void onUpdateSettings({ hideOnBlur: v })}
          />
          {/* Always on top */}
          <ToggleRow
            icon={<Pin className="h-4 w-4" />}
            title="主窗口始终置顶"
            desc="开启后锁定在最前，不触发失焦隐藏"
            checked={windowState.alwaysOnTop}
            onChange={() => onTogglePin()}
          />
          {/* Floating ball switch */}
          <ToggleRow
            icon={<Sparkles className="h-4 w-4" />}
            title="启用桌面悬浮球"
            desc="始终置顶、自由拖拽、单击唤起主面板"
            checked={windowState.floatBallEnabled}
            onChange={() => onToggleFloatBall()}
          />
          {/* AutoStart */}
          <ToggleRow
            icon={<Power className="h-4 w-4" />}
            title="开机静默自启"
            desc="启动后自动驻留系统托盘运行定时任务"
            checked={settings.autoStart}
            onChange={(v) => void onUpdateSettings({ autoStart: v })}
          />
        </div>

        {/* Floating ball shape selector */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-soft)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <img
              src={nekoAvatar}
              alt="Avatar Ball"
              className="h-9 w-9 rounded-full border-2 border-white shadow-sm"
            />
            <div>
              <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                悬浮球默认形态
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                可自由在圆形猫娘头像球与迷你圆角胶囊之间切换
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeFloatStyle("avatar")}
              className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all"
              style={{
                background: windowState.floatBallStyle === "avatar" ? "var(--accent)" : "var(--bg-surface)",
                borderColor: windowState.floatBallStyle === "avatar" ? "var(--accent)" : "var(--border-soft)",
                color: windowState.floatBallStyle === "avatar" ? "#ffffff" : "var(--text-secondary)",
              }}
            >
              圆形猫娘头像球
            </button>
            <button
              type="button"
              onClick={() => onChangeFloatStyle("capsule")}
              className="rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all"
              style={{
                background: windowState.floatBallStyle === "capsule" ? "var(--accent)" : "var(--bg-surface)",
                borderColor: windowState.floatBallStyle === "capsule" ? "var(--accent)" : "var(--border-soft)",
                color: windowState.floatBallStyle === "capsule" ? "#ffffff" : "var(--text-secondary)",
              }}
            >
              迷你圆角胶囊
            </button>
          </div>
        </div>
      </section>

      {/* 3. Global Hotkey */}
      <section className="neko-card rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ background: "var(--bg-pill)", color: "var(--accent-text)" }}
            >
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                全局呼出/隐藏快捷键
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                任意窗口下按下即可呼出主面板并聚焦搜索框（支持 Ctrl/Alt/Shift + 键）
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRecording((r) => !r)}
              className="rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-all"
              style={{
                background: recording ? "var(--accent)" : "var(--bg-elevated)",
                borderColor: recording ? "var(--accent)" : "var(--border-strong)",
                color: recording ? "#ffffff" : "var(--accent-text)",
              }}
            >
              {recording ? "请按下新组合键 (Esc 取消)..." : windowState.globalHotkey || "点击录制快捷键"}
            </button>
            <button
              type="button"
              onClick={() => void onUpdateHotkey("Alt+Space")}
              className="rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition hover:opacity-80"
              style={{
                background: "var(--bg-surface)",
                borderColor: "var(--border-soft)",
                color: "var(--text-secondary)",
              }}
            >
              恢复默认
            </button>
          </div>
        </div>

        {windowState.hotkeyError && (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{windowState.hotkeyError}</span>
          </div>
        )}
      </section>

      {/* 4. Log Auto-Cleanup Policy */}
      <section className="neko-card rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" style={{ color: "var(--accent)" }} />
            <div>
              <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                脚本日志自动清理策略
              </h3>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                启动后与每天凌晨 03:30 自动按以下策略精简历史日志，保持数据库轻盈
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({
                  logRetentionDays: Math.max(1, Number(retDays) || 30),
                  logMaxCount: Math.max(50, Number(retMax) || 500),
                })
              }
              className="rounded-xl px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90"
              style={{ background: "var(--accent)" }}
            >
              保存策略
            </button>
            <button
              type="button"
              onClick={() => void onRunLogCleanup()}
              className="rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition hover:opacity-85"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--border-soft)",
                color: "var(--text-secondary)",
              }}
            >
              立即清理
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border px-3 py-2 text-xs" style={{ background: "var(--bg-elevated)", borderColor: "var(--border-soft)" }}>
            <span style={{ color: "var(--text-secondary)" }}>仅保留最近天数</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={3650}
                value={retDays}
                onChange={(e) => setRetDays(Number(e.target.value))}
                className="h-7 w-20 rounded-lg border px-2 text-center font-bold outline-none"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border-soft)", color: "var(--text-primary)" }}
              />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>天</span>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border px-3 py-2 text-xs" style={{ background: "var(--bg-elevated)", borderColor: "var(--border-soft)" }}>
            <span style={{ color: "var(--text-secondary)" }}>最多保留总条数</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={50}
                max={50000}
                step={50}
                value={retMax}
                onChange={(e) => setRetMax(Number(e.target.value))}
                className="h-7 w-20 rounded-lg border px-2 text-center font-bold outline-none"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border-soft)", color: "var(--text-primary)" }}
              />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>条</span>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Portable Data & One-Click ZIP Backup */}
      <section className="neko-card rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "var(--bg-pill)", color: "var(--accent-text)" }}
            >
              <Database className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                便携数据目录（SQLite · {formatBytes(appInfo?.dbSizeByte || 0)} · 已缓存 {appInfo?.iconCount || 0} 个图标）
              </div>
              <div
                className="truncate font-mono text-[11px]"
                style={{ color: "var(--text-muted)" }}
                title={appInfo?.dataDir}
              >
                {appInfo?.dataDir || "./data"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await onExportBackup();
                } finally {
                  setExporting(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition hover:opacity-85 disabled:opacity-50"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--border-strong)",
                color: "var(--accent-text)",
              }}
            >
              <Archive className="h-3.5 w-3.5" />
              {exporting ? "打包中..." : "一键导出 ZIP 备份"}
            </button>
            <button
              type="button"
              onClick={onOpenDataDir}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white transition hover:opacity-90"
              style={{ background: "var(--accent)" }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开数据目录
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

interface ToggleRowProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ icon, title, desc, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-all"
    style={{
      background: "var(--bg-elevated)",
      borderColor: checked ? "var(--border-strong)" : "var(--border-soft)",
    }}
  >
    <div className="flex items-center gap-2.5 min-w-0">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: checked ? "var(--accent-soft)" : "var(--bg-surface)",
          color: checked ? "var(--accent-text)" : "var(--text-muted)",
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </div>
        <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
          {desc}
        </div>
      </div>
    </div>

    <div
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? "var(--accent)" : "#d6d3d1" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </div>
  </button>
);
