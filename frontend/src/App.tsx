import React, { useCallback, useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { ToastItem, ToastStack } from "./components/ui/Toast";
import { AppsView } from "./features/apps/AppsView";
import { ScriptsView } from "./features/scripts/ScriptsView";
import { LogsView } from "./features/logs/LogsView";
import { SettingsView } from "./features/settings/SettingsView";
import { FloatingBallApp } from "./features/floating/FloatingBallApp";
import { NavTab, ThemeId } from "./types/theme";
import * as SettingsService from "../bindings/nekomanage/internal/service/settingsservice";
import * as WindowService from "../bindings/nekomanage/internal/service/windowservice";
import * as ScriptService from "../bindings/nekomanage/internal/service/scriptservice";
import * as LogService from "../bindings/nekomanage/internal/service/logservice";
import type {
  AppInfo,
  AppSettings,
  FilesDroppedPayload,
  ScriptStatusPayload,
  ThemeChangedPayload,
  ToastPayload,
  WindowState,
} from "../bindings/nekomanage/internal/model/models";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "sakura",
  globalHotkey: "Alt+Space",
  hideOnBlur: true,
  alwaysOnTop: false,
  floatBallEnabled: false,
  floatBallStyle: "avatar",
  floatBallX: -1,
  floatBallY: -1,
  mainWinX: -1,
  mainWinY: -1,
  autoStart: false,
  schedulerPaused: false,
  logRetentionDays: 30,
  logMaxCount: 500,
};

const DEFAULT_WIN_STATE: WindowState = {
  alwaysOnTop: false,
  hideOnBlur: true,
  floatBallEnabled: false,
  floatBallStyle: "avatar",
  globalHotkey: "Alt+Space",
  hotkeyActive: true,
  hotkeyError: "",
  schedulerPaused: false,
};

function getInitialTabFromHash(): NavTab {
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx >= 0) {
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    const tab = params.get("tab");
    if (tab === "apps" || tab === "scripts" || tab === "logs" || tab === "settings") {
      return tab;
    }
  }
  return "apps";
}

const MainApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>(getInitialTabFromHash);
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [windowState, setWindowState] = useState<WindowState>(DEFAULT_WIN_STATE);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pendingDrop, setPendingDrop] = useState<{ id: number; paths: string[] } | null>(null);
  const [runningCount, setRunningCount] = useState(0);
  const [logJump, setLogJump] = useState<{ scriptId: number | null; logId: number | null }>({
    scriptId: null,
    logId: null,
  });
  const searchRef = useRef<HTMLInputElement>(null);

  const pushToast = useCallback((level: ToastItem["level"], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, level, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  useEffect(() => {
    document.body.classList.remove("mode-float");
    document.body.classList.add("mode-main");

    const bootstrap = async () => {
      try {
        const [cfg, st, info, running] = await Promise.all([
          SettingsService.GetSettings(),
          WindowService.GetWindowState(),
          SettingsService.GetAppInfo(),
          ScriptService.ListRunningTasks(),
        ]);
        setSettings(cfg);
        setWindowState(st);
        setAppInfo(info);
        setRunningCount((running || []).length);
        document.documentElement.setAttribute("data-theme", cfg.theme || "sakura");
      } catch (err) {
        console.error("bootstrap failed:", err);
      }
    };
    void bootstrap();

    const offFocus = Events.On("window:focus-search", () => {
      window.setTimeout(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      }, 40);
    });

    const offWinState = Events.On("window:state-changed", (ev: { data?: WindowState }) => {
      if (ev?.data) {
        setWindowState(ev.data);
      }
    });

    const offTheme = Events.On("settings:theme-changed", (ev: { data?: ThemeChangedPayload }) => {
      const nextTheme = (ev?.data?.theme as ThemeId) || "sakura";
      document.documentElement.setAttribute("data-theme", nextTheme);
      setSettings((prev) => ({ ...prev, theme: nextTheme }));
    });

    const offToast = Events.On("app:toast", (ev: { data?: ToastPayload }) => {
      if (ev?.data?.message) {
        const lvl = (ev.data.level as ToastItem["level"]) || "info";
        pushToast(lvl, ev.data.message);
      }
    });

    const offDrop = Events.On("app:files-dropped", (ev: { data?: FilesDroppedPayload }) => {
      const paths = ev?.data?.paths || [];
      if (paths.length > 0) {
        setActiveTab("apps");
        setPendingDrop({ id: Date.now(), paths });
      }
    });

    const offScriptStatus = Events.On("script:status-changed", (ev: { data?: ScriptStatusPayload }) => {
      const p = ev?.data;
      if (!p) return;
      setRunningCount(p.runningCount ?? 0);
      if (p.status === "failed") {
        pushToast("error", `脚本执行失败（退出码 ${p.exitCode ?? "?"}），可在日志中心查看详情`);
      } else if (p.status === "timeout") {
        pushToast("warn", "脚本执行超时，已自动终止进程树");
      }
    });

    // Global in-window Ctrl+K focuses search, Esc clears or hides when unpinned
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      offFocus();
      offWinState();
      offTheme();
      offToast();
      offDrop();
      offScriptStatus();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pushToast]);

  const handleSelectTheme = async (theme: ThemeId) => {
    document.documentElement.setAttribute("data-theme", theme);
    setSettings((prev) => ({ ...prev, theme }));
    try {
      const updated = await SettingsService.SetTheme(theme);
      setSettings(updated);
    } catch (err) {
      pushToast("error", `切换主题失败: ${String(err)}`);
    }
  };

  const handleUpdateSettings = async (patch: Partial<AppSettings>) => {
    const merged: AppSettings = { ...settings, ...patch };
    try {
      const saved = await SettingsService.SaveSettings(merged);
      setSettings(saved);
      const st = await WindowService.GetWindowState();
      setWindowState(st);
      pushToast("success", "偏好设置已保存喵~");
    } catch (err) {
      pushToast("error", `保存失败: ${String(err)}`);
    }
  };

  const handleTogglePin = async () => {
    try {
      const st = await WindowService.SetAlwaysOnTop(!windowState.alwaysOnTop);
      setWindowState(st);
      setSettings((prev) => ({ ...prev, alwaysOnTop: st.alwaysOnTop }));
      pushToast("info", st.alwaysOnTop ? "已置顶主窗口" : "已取消置顶");
    } catch (err) {
      pushToast("error", String(err));
    }
  };

  const handleToggleFloatBall = async () => {
    try {
      const st = await WindowService.ToggleFloatingBall(!windowState.floatBallEnabled);
      setWindowState(st);
      setSettings((prev) => ({ ...prev, floatBallEnabled: st.floatBallEnabled }));
      pushToast("info", st.floatBallEnabled ? "猫娘悬浮球已上线喵~" : "已隐藏猫娘悬浮球");
    } catch (err) {
      pushToast("error", String(err));
    }
  };

  const handleChangeFloatStyle = async (style: "avatar" | "capsule") => {
    try {
      const st = await WindowService.SetFloatBallStyle(style);
      setWindowState(st);
      setSettings((prev) => ({ ...prev, floatBallStyle: st.floatBallStyle }));
      pushToast("success", style === "avatar" ? "已切换为圆形猫娘头像球" : "已切换为迷你圆角胶囊");
    } catch (err) {
      pushToast("error", String(err));
    }
  };

  const handleToggleSchedulerPaused = async () => {
    try {
      const st = await WindowService.ToggleSchedulerPaused();
      setWindowState(st);
      setSettings((prev) => ({ ...prev, schedulerPaused: st.schedulerPaused }));
      pushToast("info", st.schedulerPaused ? "已暂停所有定时任务" : "已恢复定时任务调度");
    } catch (err) {
      pushToast("error", String(err));
    }
  };

  const handleUpdateHotkey = async (spec: string) => {
    try {
      const st = await WindowService.UpdateGlobalHotkey(spec);
      setWindowState(st);
      setSettings((prev) => ({ ...prev, globalHotkey: st.globalHotkey }));
      pushToast("success", `全局快捷键已绑定为 ${st.globalHotkey}`);
    } catch (err) {
      const st = await WindowService.GetWindowState();
      setWindowState(st);
      pushToast("error", String(err));
    }
  };

  const handleOpenDataDir = async () => {
    try {
      await SettingsService.OpenDataDirectory();
    } catch (err) {
      pushToast("error", `打开目录失败: ${String(err)}`);
    }
  };

  const handleExportBackup = async () => {
    try {
      const savedPath = await SettingsService.ExportDataBackup();
      if (savedPath) {
        pushToast("success", `便携数据已打包导出至 ${savedPath}`);
      }
    } catch (err) {
      pushToast("error", `导出备份失败: ${String(err)}`);
    }
  };

  const handleRunLogCleanup = async () => {
    try {
      const n = await LogService.RunLogCleanup();
      const info = await SettingsService.GetAppInfo();
      setAppInfo(info);
      pushToast("success", n > 0 ? `已按保留策略清理 ${n} 条历史日志` : "当前日志均在保留策略内，无需清理");
    } catch (err) {
      pushToast("error", `日志清理失败: ${String(err)}`);
    }
  };

  const currentTheme = (settings.theme as ThemeId) || "sakura";

  return (
    <div
      data-theme={currentTheme}
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: "var(--bg-canvas)", color: "var(--text-primary)" }}
    >
      <TitleBar
        searchRef={searchRef}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        theme={currentTheme}
        onSelectTheme={handleSelectTheme}
        alwaysOnTop={windowState.alwaysOnTop}
        onTogglePin={handleTogglePin}
        floatBallEnabled={windowState.floatBallEnabled}
        onToggleFloatBall={handleToggleFloatBall}
        globalHotkey={windowState.globalHotkey}
        onHideToTray={() => void WindowService.HideMainWindow()}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          schedulerPaused={windowState.schedulerPaused}
          onToggleSchedulerPaused={handleToggleSchedulerPaused}
          hotkeyActive={windowState.hotkeyActive}
          globalHotkey={windowState.globalHotkey}
          runningCount={runningCount}
        />

        <main className="min-w-0 flex-1 overflow-hidden p-4">
          {activeTab === "apps" && (
            <AppsView
              searchQuery={searchQuery}
              pendingDrop={pendingDrop}
              onDropHandled={() => setPendingDrop(null)}
              onToast={pushToast}
            />
          )}
          {activeTab === "scripts" && (
            <ScriptsView
              searchQuery={searchQuery}
              onOpenScriptLogs={(scriptId, focusLogId) => {
                setLogJump({ scriptId, logId: focusLogId ?? null });
                setActiveTab("logs");
              }}
              onToast={pushToast}
            />
          )}
          {activeTab === "logs" && (
            <LogsView
              searchQuery={searchQuery}
              initialScriptId={logJump.scriptId}
              initialLogId={logJump.logId}
              onConsumeInitial={() => setLogJump({ scriptId: null, logId: null })}
              onToast={pushToast}
            />
          )}
          {activeTab === "settings" && (
            <SettingsView
              settings={settings}
              windowState={windowState}
              appInfo={appInfo}
              onSelectTheme={handleSelectTheme}
              onUpdateSettings={handleUpdateSettings}
              onUpdateHotkey={handleUpdateHotkey}
              onTogglePin={handleTogglePin}
              onToggleFloatBall={handleToggleFloatBall}
              onChangeFloatStyle={handleChangeFloatStyle}
              onOpenDataDir={handleOpenDataDir}
              onExportBackup={handleExportBackup}
              onRunLogCleanup={handleRunLogCleanup}
            />
          )}
        </main>
      </div>

      <ToastStack items={toasts} />
    </div>
  );
};

export const App: React.FC = () => {
  const isFloat = window.location.hash.startsWith("#/float");
  return isFloat ? <FloatingBallApp /> : <MainApp />;
};

export default App;
