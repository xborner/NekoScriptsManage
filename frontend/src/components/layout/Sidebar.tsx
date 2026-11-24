import React from "react";
import {
  LayoutGrid,
  TerminalSquare,
  ScrollText,
  SlidersHorizontal,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import nekoPocky from "../../assets/neko/neko-pocky.png";
import { NavTab } from "../../types/theme";

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  schedulerPaused: boolean;
  onToggleSchedulerPaused: () => void;
  hotkeyActive: boolean;
  globalHotkey: string;
  runningCount: number;
}

const NAV_ITEMS: { id: NavTab; label: string; desc: string; icon: React.FC<{ className?: string }> }[] = [
  { id: "apps", label: "快捷启动", desc: "应用与备忘", icon: LayoutGrid },
  { id: "scripts", label: "脚本管家", desc: "脚本与定时", icon: TerminalSquare },
  { id: "logs", label: "执行日志", desc: "输出与状态", icon: ScrollText },
  { id: "settings", label: "偏好设置", desc: "主题与热键", icon: SlidersHorizontal },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  schedulerPaused,
  onToggleSchedulerPaused,
  hotkeyActive,
  globalHotkey,
  runningCount,
}) => {
  return (
    <aside
      className="flex w-48 shrink-0 flex-col justify-between border-r p-3"
      style={{
        background: "var(--bg-sidebar)",
        borderColor: "var(--border-soft)",
      }}
    >
      {/* Navigation */}
      <nav className="flex flex-col gap-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all"
              style={{
                background: active ? "var(--bg-surface)" : "transparent",
                boxShadow: active ? "var(--shadow-card)" : "none",
                border: active ? "1px solid var(--border-soft)" : "1px solid transparent",
              }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                style={{
                  background: active ? "var(--accent)" : "var(--bg-pill)",
                  color: active ? "#ffffff" : "var(--accent-text)",
                }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <div
                    className="text-xs font-bold leading-snug"
                    style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
                  >
                    {item.label}
                  </div>
                  {item.id === "scripts" && runningCount > 0 && (
                    <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      {runningCount}
                    </span>
                  )}
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {item.desc}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Bottom Cute Catgirl Mascot & Quick Status Card */}
      <div className="mt-4 flex flex-col gap-2">
        <div
          className="relative overflow-visible rounded-2xl border p-3 pt-9 text-center"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-soft)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <img
            src={nekoPocky}
            alt="Neko Mascot"
            draggable={false}
            className="animate-neko-float pointer-events-none absolute -top-11 left-1/2 h-20 w-auto -translate-x-1/2 drop-shadow-sm"
          />
          <div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
            {schedulerPaused ? "定时任务小憩中~" : "猫娘随时待命喵~"}
          </div>
          <div className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            热键{" "}
            <span className="font-semibold" style={{ color: hotkeyActive ? "var(--accent-text)" : "#e11d48" }}>
              {globalHotkey || "未设置"}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleSchedulerPaused}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:opacity-90"
            style={{
              background: schedulerPaused ? "#fef3c7" : "var(--bg-pill)",
              color: schedulerPaused ? "#b45309" : "var(--accent-text)",
            }}
          >
            {schedulerPaused ? (
              <>
                <PlayCircle className="h-3.5 w-3.5" />
                恢复定时调度
              </>
            ) : (
              <>
                <PauseCircle className="h-3.5 w-3.5" />
                暂停定时调度
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
