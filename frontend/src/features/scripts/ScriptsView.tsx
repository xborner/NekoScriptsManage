import React, { useCallback, useEffect, useState } from "react";
import { Events } from "@wailsio/runtime";
import {
  Plus,
  Play,
  Square,
  ScrollText,
  Pencil,
  Trash2,
  Star,
  Terminal,
  EyeOff,
  Clock,
  CalendarClock,
  PauseCircle,
  PlayCircle,
  FileCode2,
  CheckCircle2,
  XCircle,
  Loader2,
  TimerOff,
  Slash,
} from "lucide-react";
import nekoSleep from "../../assets/neko/neko-sleep.png";
import nekoCurious from "../../assets/neko/neko-curious.png";
import { ScriptFormModal } from "./ScriptFormModal";
import { ScheduleModal } from "./ScheduleModal";
import * as ScriptService from "../../../bindings/nekomanage/internal/service/scriptservice";
import * as ScheduleService from "../../../bindings/nekomanage/internal/service/scheduleservice";
import type {
  ScheduleView,
  SchedulerState,
  ScriptInput,
  ScriptItem,
  ScriptStatusPayload,
} from "../../../bindings/nekomanage/internal/model/models";

interface ScriptsViewProps {
  searchQuery: string;
  onOpenScriptLogs: (scriptId: number, focusLogId?: number) => void;
  onToast: (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

const FILTER_TABS = [
  { id: "all", label: "全部脚本" },
  { id: "pinned", label: "⭐ 置顶" },
  { id: "bat", label: "BAT" },
  { id: "ps1", label: "PowerShell" },
  { id: "py", label: "Python" },
  { id: "custom", label: "自定义" },
];

export const ScriptsView: React.FC<ScriptsViewProps> = ({
  searchQuery,
  onOpenScriptLogs,
  onToast,
}) => {
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [schedState, setSchedState] = useState<SchedulerState>({
    globalPaused: false,
    activeCount: 0,
    schedules: [],
  });
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScriptItem | null>(null);
  const [schedModalScript, setSchedModalScript] = useState<ScriptItem | null>(null);

  const loadScripts = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([
        ScriptService.ListScripts(searchQuery, typeFilter),
        ScheduleService.GetSchedulerState(),
      ]);
      setScripts(list || []);
      if (st) setSchedState(st);
    } catch (err) {
      onToast("error", `加载脚本列表失败: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, typeFilter, onToast]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  // Real-time status & schedule updates pushed from Go backend
  useEffect(() => {
    const offStatus = Events.On("script:status-changed", (ev: { data?: ScriptStatusPayload }) => {
      const p = ev?.data;
      if (!p) return;
      setScripts((prev) =>
        prev.map((sc) =>
          sc.id === p.scriptId
            ? {
                ...sc,
                isRunning: p.status === "running",
                runningLogId: p.status === "running" ? p.logId : 0,
                lastStatus: p.status,
              }
            : sc
        )
      );
      if (p.status !== "running") {
        void loadScripts();
      }
    });
    const offSched = Events.On("schedule:state-changed", (ev: { data?: SchedulerState }) => {
      if (ev?.data) setSchedState(ev.data);
    });
    return () => {
      offStatus();
      offSched();
    };
  }, [loadScripts]);

  const scheduleByScript = new Map<number, ScheduleView>();
  for (const sc of schedState.schedules || []) {
    scheduleByScript.set(sc.scriptId, sc);
  }

  const handleToggleGlobalPause = async () => {
    try {
      const next = await ScheduleService.SetGlobalPaused(!schedState.globalPaused);
      setSchedState(next);
      onToast("info", next.globalPaused ? "已暂停全部定时任务" : "已恢复全部定时任务调度");
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleToggleOneSchedule = async (sv: ScheduleView) => {
    try {
      const updated = await ScheduleService.ToggleSchedule(sv.id, !sv.enabled);
      onToast("info", updated.enabled ? `已开启定时任务（下次 ${updated.nextRunAt || "即将计算"}）` : "已暂停该脚本定时规则");
      await loadScripts();
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleSave = async (input: ScriptInput) => {
    try {
      await ScriptService.SaveScript(input);
      onToast("success", input.id ? "脚本已更新喵~" : "已创建新脚本 🐾");
      await loadScripts();
    } catch (err) {
      onToast("error", String(err));
      throw err;
    }
  };

  const handleRun = async (sc: ScriptItem) => {
    try {
      const logId = await ScriptService.RunScript(sc.id);
      onToast("info", `已启动「${sc.name}」执行中...`);
      setScripts((prev) =>
        prev.map((item) =>
          item.id === sc.id
            ? { ...item, isRunning: true, runningLogId: logId, lastStatus: "running" }
            : item
        )
      );
    } catch (err) {
      onToast("error", `启动失败: ${String(err)}`);
    }
  };

  const handleStop = async (sc: ScriptItem) => {
    if (!sc.runningLogId) return;
    try {
      await ScriptService.StopScript(sc.runningLogId);
      onToast("warn", `正在强制终止「${sc.name}」及其子进程树...`);
    } catch (err) {
      onToast("error", `终止失败: ${String(err)}`);
    }
  };

  const handleTogglePin = async (sc: ScriptItem) => {
    try {
      await ScriptService.TogglePinScript(sc.id);
      await loadScripts();
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleDelete = async (sc: ScriptItem) => {
    try {
      await ScriptService.DeleteScript(sc.id);
      onToast("info", `已删除脚本「${sc.name}」`);
      await loadScripts();
    } catch (err) {
      onToast("error", `删除失败: ${String(err)}`);
    }
  };

  const runningCount = scripts.filter((s) => s.isRunning).length;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Top Filter Bar & CTA */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_TABS.map((t) => {
            const active = typeFilter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeFilter(t.id)}
                className="h-7 rounded-xl border px-2.5 text-[11px] font-semibold transition"
                style={{
                  background: active ? "var(--accent)" : "var(--bg-surface)",
                  borderColor: active ? "var(--accent)" : "var(--border-soft)",
                  color: active ? "#ffffff" : "var(--text-secondary)",
                }}
              >
                {t.label}
              </button>
            );
          })}
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              {runningCount} 个脚本运行中
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleToggleGlobalPause()}
            title="一键暂停或恢复全部定时任务（与系统托盘同步）"
            className="inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition hover:opacity-90"
            style={{
              background: schedState.globalPaused ? "#fef3c7" : "var(--bg-surface)",
              borderColor: schedState.globalPaused ? "#f59e0b" : "var(--border-soft)",
              color: schedState.globalPaused ? "#b45309" : "var(--text-secondary)",
            }}
          >
            {schedState.globalPaused ? (
              <>
                <PlayCircle className="h-3.5 w-3.5" />
                定时已暂停 ({schedState.activeCount})
              </>
            ) : (
              <>
                <PauseCircle className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                定时运行中 ({schedState.activeCount})
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95"
            style={{ background: "var(--accent)" }}
          >
            <Plus className="h-3.5 w-3.5" />
            新建脚本
          </button>
        </div>
      </div>

      {/* Script List / Empty State */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
            加载脚本列表中...
          </div>
        ) : scripts.length === 0 ? (
          <div
            className="flex h-full flex-col items-center justify-center rounded-2xl border p-8 text-center"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-soft)",
            }}
          >
            <img
              src={searchQuery ? nekoCurious : nekoSleep}
              alt="Neko Scripts"
              draggable={false}
              className="animate-neko-float mb-3 h-36 w-auto drop-shadow-md"
            />
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {searchQuery
                ? `没有找到与「${searchQuery}」匹配的脚本喵~`
                : "还没有收纳任何本地脚本呢~"}
            </h3>
            <p className="mt-1 max-w-md text-xs" style={{ color: "var(--text-secondary)" }}>
              支持 .bat / .cmd / .ps1 / .py 及自定义命令，可内置编辑器直接保存或关联外部文件，后台无黑框运行并完整记录中文日志。
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                <Plus className="h-3.5 w-3.5" />
                新建第一个脚本
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {scripts.map((sc) => {
              const sched = scheduleByScript.get(sc.id) || null;
              return (
              <div
                key={sc.id}
                className="neko-card neko-card-hover flex flex-col justify-between rounded-2xl p-4"
                style={{
                  borderColor: sc.isRunning ? "#34d399" : undefined,
                }}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TypeBadge scriptType={sc.scriptType} />
                      <h4 className="truncate text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                        {sc.name}
                      </h4>
                      {sc.isPinned && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                    </div>
                    {sc.description && (
                      <p className="mt-1 truncate text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {sc.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                      <span
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
                        style={{ background: "var(--bg-elevated)" }}
                      >
                        <FileCode2 className="h-3 w-3" />
                        {sc.sourceMode === "inline" ? "内联脚本" : "外部文件"}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
                        style={{ background: "var(--bg-elevated)" }}
                      >
                        {sc.runInTerminal ? <Terminal className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {sc.runInTerminal ? "弹出终端" : "静默无黑框"}
                      </span>
                      {sc.timeoutSec > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5"
                          style={{ background: "var(--bg-elevated)" }}
                        >
                          <Clock className="h-3 w-3" />
                          {sc.timeoutSec}s 超时
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Run / Stop Primary Button */}
                  <div className="shrink-0">
                    {sc.isRunning ? (
                      <button
                        type="button"
                        onClick={() => void handleStop(sc)}
                        className="inline-flex h-8 items-center gap-1 rounded-xl bg-rose-500 px-3 text-[11px] font-semibold text-white shadow-sm transition hover:bg-rose-600"
                        title="强制终止脚本及其所有子进程"
                      >
                        <Square className="h-3 w-3 fill-current" />
                        终止
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleRun(sc)}
                        className="inline-flex h-8 items-center gap-1 rounded-xl px-3 text-[11px] font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95"
                        style={{ background: "var(--accent)" }}
                      >
                        <Play className="h-3 w-3 fill-current" />
                        运行
                      </button>
                    )}
                  </div>
                </div>

                {/* Schedule Status Strip (if configured) */}
                {sched && (
                  <div
                    className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-[10px]"
                    style={{
                      background:
                        sched.enabled && !schedState.globalPaused
                          ? "#ecfdf5"
                          : sched.enabled && schedState.globalPaused
                          ? "#fffbeb"
                          : "var(--bg-elevated)",
                      borderColor:
                        sched.enabled && !schedState.globalPaused
                          ? "#a7f3d0"
                          : sched.enabled && schedState.globalPaused
                          ? "#fde68a"
                          : "var(--border-soft)",
                      color:
                        sched.enabled && !schedState.globalPaused
                          ? "#047857"
                          : sched.enabled && schedState.globalPaused
                          ? "#b45309"
                          : "var(--text-muted)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setSchedModalScript(sc)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-semibold hover:underline"
                      title="点击编辑定时规则"
                    >
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                      {sched.enabled ? (
                        schedState.globalPaused ? (
                          <span className="truncate">全局暂停中 · Cron: {sched.cronExpr}</span>
                        ) : (
                          <span className="truncate">下次运行: {sched.nextRunAt || sched.cronExpr}</span>
                        )
                      ) : (
                        <span className="truncate">定时未启用 · Cron: {sched.cronExpr}</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleOneSchedule(sched)}
                      title={sched.enabled ? "停用该脚本定时" : "启用该脚本定时"}
                      className="relative h-4 w-7 shrink-0 rounded-full transition-colors"
                      style={{ background: sched.enabled ? "#10b981" : "#cbd5e1" }}
                    >
                      <span
                        className="absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform"
                        style={{ transform: sched.enabled ? "translateX(14px)" : "translateX(2px)" }}
                      />
                    </button>
                  </div>
                )}

                {/* Footer: Last status + Quick actions */}
                <div
                  className="mt-3 flex items-center justify-between border-t pt-2.5"
                  style={{ borderColor: "var(--border-soft)" }}
                >
                  <div className="flex items-center gap-2 text-[10px]">
                    <StatusBadge status={sc.isRunning ? "running" : sc.lastStatus} />
                    {sc.lastRunAt && (
                      <span style={{ color: "var(--text-muted)" }}>{sc.lastRunAt}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setSchedModalScript(sc)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition hover:opacity-85"
                      style={{
                        background: sched?.enabled ? "#ecfdf5" : "var(--bg-elevated)",
                        color: sched?.enabled ? "#047857" : "var(--text-secondary)",
                      }}
                      title="配置定时调度规则"
                    >
                      <CalendarClock className="h-3 w-3" />
                      定时
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenScriptLogs(sc.id, sc.isRunning ? sc.runningLogId : undefined)
                      }
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition hover:opacity-85"
                      style={{
                        background: sc.isRunning ? "#d1fae5" : "var(--bg-pill)",
                        color: sc.isRunning ? "#047857" : "var(--accent-text)",
                      }}
                    >
                      <ScrollText className="h-3 w-3" />
                      {sc.isRunning ? "实时输出" : "日志"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTogglePin(sc)}
                      title={sc.isPinned ? "取消置顶" : "置顶脚本"}
                      className="rounded-lg p-1.5 transition hover:opacity-80"
                      style={{ color: sc.isPinned ? "#f59e0b" : "var(--text-muted)" }}
                    >
                      <Star className={`h-3.5 w-3.5 ${sc.isPinned ? "fill-current" : ""}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(sc);
                        setModalOpen(true);
                      }}
                      title="编辑脚本"
                      className="rounded-lg p-1.5 transition hover:opacity-80"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(sc)}
                      title="删除脚本"
                      className="rounded-lg p-1.5 transition hover:bg-rose-50 hover:text-rose-500"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <ScriptFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onToast={onToast}
      />

      <ScheduleModal
        open={Boolean(schedModalScript)}
        script={schedModalScript}
        existing={schedModalScript ? scheduleByScript.get(schedModalScript.id) || null : null}
        onClose={() => setSchedModalScript(null)}
        onSaved={loadScripts}
        onToast={onToast}
      />
    </div>
  );
};

const TypeBadge: React.FC<{ scriptType: string }> = ({ scriptType }) => {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    bat: { bg: "#ffe4ec", text: "#be185d", label: "BAT" },
    cmd: { bg: "#fce7f3", text: "#9d174d", label: "CMD" },
    ps1: { bg: "#dbeafe", text: "#1d4ed8", label: "PS1" },
    py: { bg: "#fef3c7", text: "#b45309", label: "PY" },
    custom: { bg: "#ede9fe", text: "#6d28d9", label: "CMD" },
  };
  const s = styles[scriptType] || styles.custom;
  return (
    <span
      className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold"
      style={{ background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case "running":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          运行中
        </span>
      );
    case "success":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          成功
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">
          <XCircle className="h-3 w-3" />
          失败
        </span>
      );
    case "timeout":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
          <TimerOff className="h-3 w-3" />
          超时
        </span>
      );
    case "killed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
          <Slash className="h-3 w-3" />
          已终止
        </span>
      );
    default:
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
        >
          待运行
        </span>
      );
  }
};
