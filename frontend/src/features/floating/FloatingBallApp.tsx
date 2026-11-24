import React, { useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import nekoAvatar from "../../assets/neko/neko-avatar.png";
import * as SettingsService from "../../../bindings/nekomanage/internal/service/settingsservice";
import * as WindowService from "../../../bindings/nekomanage/internal/service/windowservice";
import * as ScriptService from "../../../bindings/nekomanage/internal/service/scriptservice";
import type {
  ScriptStatusPayload,
  WindowState,
} from "../../../bindings/nekomanage/internal/model/models";
import type { ThemeId } from "../../types/theme";

export const FloatingBallApp: React.FC = () => {
  const [theme, setTheme] = useState<ThemeId>("sakura");
  const [style, setStyle] = useState<"avatar" | "capsule">("avatar");
  const [paused, setPaused] = useState(false);
  const [runningCount, setRunningCount] = useState(0);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    document.body.classList.remove("mode-main");
    document.body.classList.add("mode-float");

    const init = async () => {
      try {
        const [cfg, st, tasks] = await Promise.all([
          SettingsService.GetSettings(),
          WindowService.GetWindowState(),
          ScriptService.ListRunningTasks(),
        ]);
        const t = (cfg.theme as ThemeId) || "sakura";
        setTheme(t);
        document.documentElement.setAttribute("data-theme", t);
        setStyle(st.floatBallStyle === "capsule" ? "capsule" : "avatar");
        setPaused(st.schedulerPaused);
        setRunningCount((tasks || []).length);
      } catch {
        // fallback for browser preview
      }
    };
    void init();

    const offTheme = Events.On("settings:theme-changed", (ev: { data?: { theme?: string } }) => {
      const next = (ev?.data?.theme as ThemeId) || "sakura";
      setTheme(next);
      document.documentElement.setAttribute("data-theme", next);
    });

    const offWin = Events.On("window:state-changed", (ev: { data?: WindowState }) => {
      if (!ev?.data) return;
      setStyle(ev.data.floatBallStyle === "capsule" ? "capsule" : "avatar");
      setPaused(ev.data.schedulerPaused);
    });

    const offScript = Events.On("script:status-changed", (ev: { data?: ScriptStatusPayload }) => {
      if (ev?.data) {
        setRunningCount(ev.data.runningCount ?? 0);
      }
    });

    return () => {
      offTheme();
      offWin();
      offScript();
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    pointerDownPos.current = { x: e.screenX, y: e.screenY };
  };

  const handleClick = (e: React.MouseEvent) => {
    if (pointerDownPos.current) {
      const dist = Math.hypot(
        e.screenX - pointerDownPos.current.x,
        e.screenY - pointerDownPos.current.y
      );
      if (dist > 6) return;
    }
    void WindowService.ToggleMainWindow("float");
  };

  const handleDoubleClick = () => {
    void WindowService.ShowMainWindow("float");
  };

  const statusText =
    runningCount > 0
      ? `${runningCount} 个脚本运行中`
      : paused
      ? "定时已暂停"
      : "快速启动";

  const tooltip = `NekoScriptsManage · ${statusText}（拖拽自动贴边 · 单击呼出主面板）`;

  if (style === "capsule") {
    return (
      <div
        data-theme={theme}
        className="wails-drag flex h-full w-full items-center justify-center p-1.5"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={tooltip}
      >
        <div
          className="animate-neko-breathe flex h-10 w-full cursor-pointer items-center gap-2 rounded-full border-2 bg-white/92 px-2 shadow-lg backdrop-blur-md transition-transform hover:scale-[1.03]"
          style={{ borderColor: runningCount > 0 ? "#10b981" : "var(--accent)" }}
        >
          <img
            src={nekoAvatar}
            alt="Neko"
            draggable={false}
            className="h-7 w-7 rounded-full object-cover"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
              Neko
            </div>
            <div className="truncate text-[9px] font-medium" style={{ color: runningCount > 0 ? "#059669" : "var(--text-muted)" }}>
              {statusText}
            </div>
          </div>
          {runningCount > 0 ? (
            <span className="mr-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
              {runningCount}
            </span>
          ) : (
            <span
              className="mr-1 h-2 w-2 rounded-full"
              style={{ background: paused ? "#f59e0b" : "var(--accent)" }}
            />
          )}
        </div>
      </div>
    );
  }

  // Default circular catgirl avatar ball
  return (
    <div
      data-theme={theme}
      className="wails-drag flex h-full w-full items-center justify-center p-2"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={tooltip}
    >
      <div
        className="animate-neko-breathe relative h-16 w-16 cursor-pointer rounded-full p-[3px] transition-transform hover:scale-105 active:scale-95"
        style={{
          background:
            runningCount > 0
              ? "linear-gradient(135deg, #10b981, #6ee7b7)"
              : "linear-gradient(135deg, var(--accent), #ffffff)",
        }}
      >
        <img
          src={nekoAvatar}
          alt="Neko Avatar Ball"
          draggable={false}
          className="h-full w-full rounded-full object-cover border-2 border-white"
        />
        {runningCount > 0 ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1 text-[10px] font-bold text-white shadow-sm">
            {runningCount}
          </span>
        ) : (
          <span
            className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm"
            style={{ background: paused ? "#f59e0b" : "#34d399" }}
          />
        )}
      </div>
    </div>
  );
};
