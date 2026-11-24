import React from "react";
import {
  Search,
  Pin,
  PinOff,
  Sparkles,
  Minus,
  X,
} from "lucide-react";
import nekoAvatar from "../../assets/neko/neko-avatar.png";
import { THEMES, ThemeId } from "../../types/theme";

interface TitleBarProps {
  searchRef: React.RefObject<HTMLInputElement>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  theme: ThemeId;
  onSelectTheme: (theme: ThemeId) => void;
  alwaysOnTop: boolean;
  onTogglePin: () => void;
  floatBallEnabled: boolean;
  onToggleFloatBall: () => void;
  globalHotkey: string;
  onHideToTray: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  searchRef,
  searchQuery,
  onSearchChange,
  theme,
  onSelectTheme,
  alwaysOnTop,
  onTogglePin,
  floatBallEnabled,
  onToggleFloatBall,
  globalHotkey,
  onHideToTray,
}) => {
  return (
    <header
      className="wails-drag flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4"
      style={{
        background: "var(--bg-surface)",
        borderColor: "var(--border-soft)",
      }}
    >
      {/* Left: Cute Neko Brand */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div
          className="relative h-8 w-8 rounded-full p-0.5 shadow-sm"
          style={{ background: "var(--accent-soft)" }}
        >
          <img
            src={nekoAvatar}
            alt="Neko"
            className="h-full w-full rounded-full object-cover"
            draggable={false}
          />
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white"
            style={{ background: "var(--accent)" }}
          />
        </div>
        <div className="leading-tight">
          <div
            className="text-sm font-bold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            NekoScripts
          </div>
          <div className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
            猫娘桌面管家
          </div>
        </div>
      </div>

      {/* Center: Quick Search Pill */}
      <div className="wails-no-drag relative flex-1 max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        />
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索应用、脚本、标签或使用说明..."
          className="h-9 w-full rounded-xl border pl-9 pr-16 text-xs outline-none transition-all"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-soft)",
            color: "var(--text-primary)",
          }}
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 transition hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
            title="清空搜索"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: "var(--bg-pill)",
              color: "var(--accent-text)",
            }}
          >
            {globalHotkey || "Alt+Space"}
          </span>
        )}
      </div>

      {/* Right: Theme Swatches + Window Controls */}
      <div className="wails-no-drag flex items-center gap-1.5 shrink-0">
        {/* Quick 4-theme dot picker */}
        <div
          className="mr-1 flex items-center gap-1.5 rounded-xl border px-2 py-1.5"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-soft)",
          }}
          title="一键切换马卡龙主题"
        >
          {THEMES.map((t) => {
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTheme(t.id)}
                title={t.name}
                className="h-3.5 w-3.5 rounded-full transition-transform hover:scale-115"
                style={{
                  background: t.dot,
                  boxShadow: active ? `0 0 0 2px #fff, 0 0 0 3.5px ${t.dot}` : "none",
                  transform: active ? "scale(1.1)" : undefined,
                }}
              />
            );
          })}
        </div>

        {/* Always-on-top Pin toggle */}
        <button
          type="button"
          onClick={onTogglePin}
          title={alwaysOnTop ? "已置顶（点击取消置顶）" : "置顶主窗口（防止失焦自动隐藏）"}
          className="flex h-8 w-8 items-center justify-center rounded-xl border transition-all hover:scale-105"
          style={{
            background: alwaysOnTop ? "var(--accent)" : "var(--bg-elevated)",
            borderColor: alwaysOnTop ? "var(--accent)" : "var(--border-soft)",
            color: alwaysOnTop ? "#ffffff" : "var(--text-secondary)",
          }}
        >
          {alwaysOnTop ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
        </button>

        {/* Floating Catgirl Ball toggle */}
        <button
          type="button"
          onClick={onToggleFloatBall}
          title={floatBallEnabled ? "隐藏猫娘悬浮球" : "开启猫娘悬浮球"}
          className="flex h-8 items-center gap-1 rounded-xl border px-2.5 text-xs font-medium transition-all hover:scale-105"
          style={{
            background: floatBallEnabled ? "var(--accent-soft)" : "var(--bg-elevated)",
            borderColor: floatBallEnabled ? "var(--accent)" : "var(--border-soft)",
            color: floatBallEnabled ? "var(--accent-text)" : "var(--text-secondary)",
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>悬浮球</span>
        </button>

        {/* Hide to System Tray */}
        <button
          type="button"
          onClick={onHideToTray}
          title="收纳到系统托盘（后台继续运行定时任务）"
          className="flex h-8 w-8 items-center justify-center rounded-xl border transition-all hover:scale-105"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-soft)",
            color: "var(--text-secondary)",
          }}
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
