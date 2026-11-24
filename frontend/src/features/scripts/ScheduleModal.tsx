import React, { useEffect, useState } from "react";
import { X, Clock, CalendarClock, Trash2, AlertCircle, CheckCircle2, ShieldAlert } from "lucide-react";
import * as ScheduleService from "../../../bindings/nekomanage/internal/service/scheduleservice";
import type {
  ScheduleInput,
  ScheduleView,
  ScriptItem,
  SimpleScheduleConfig,
} from "../../../bindings/nekomanage/internal/model/models";

const WEEKDAY_LABELS = [
  { val: 1, label: "一" },
  { val: 2, label: "二" },
  { val: 3, label: "三" },
  { val: 4, label: "四" },
  { val: 5, label: "五" },
  { val: 6, label: "六" },
  { val: 0, label: "日" },
];

const CRON_PRESETS = [
  { label: "每 10 分钟", expr: "*/10 * * * *" },
  { label: "每小时整点", expr: "0 * * * *" },
  { label: "工作日 09:00", expr: "0 9 * * 1-5" },
  { label: "每天 02:00", expr: "0 2 * * *" },
];

interface ScheduleModalProps {
  open: boolean;
  script: ScriptItem | null;
  existing: ScheduleView | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onToast: (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  open,
  script,
  existing,
  onClose,
  onSaved,
  onToast,
}) => {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<"simple" | "cron">("simple");
  const [simpleKind, setSimpleKind] = useState<"interval" | "daily" | "weekly">("daily");
  const [minutes, setMinutes] = useState(30);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [cronExpr, setCronExpr] = useState("0 9 * * *");
  const [allowConcurrent, setAllowConcurrent] = useState(false);

  const [previewTimes, setPreviewTimes] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !script) return;
    if (existing) {
      setEnabled(existing.enabled);
      setMode(existing.mode === "cron" ? "cron" : "simple");
      const sc = existing.simpleConfig;
      setSimpleKind((sc?.kind as "interval" | "daily" | "weekly") || "daily");
      setMinutes(sc?.minutes || 30);
      setHour(typeof sc?.hour === "number" ? sc.hour : 9);
      setMinute(typeof sc?.minute === "number" ? sc.minute : 0);
      setWeekdays(sc?.weekdays && sc.weekdays.length > 0 ? sc.weekdays : [1, 2, 3, 4, 5]);
      setCronExpr(existing.cronExpr || "0 9 * * *");
      setAllowConcurrent(existing.allowConcurrent);
    } else {
      setEnabled(true);
      setMode("simple");
      setSimpleKind("daily");
      setMinutes(30);
      setHour(9);
      setMinute(0);
      setWeekdays([1, 2, 3, 4, 5]);
      setCronExpr("0 9 * * *");
      setAllowConcurrent(false);
    }
  }, [open, script, existing]);

  // Live Cron generation & next-5-runs preview
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const refreshPreview = async () => {
      try {
        let expr = cronExpr;
        if (mode === "simple") {
          const cfg: SimpleScheduleConfig = {
            kind: simpleKind,
            minutes: Number(minutes) || 1,
            hour: Number(hour) || 0,
            minute: Number(minute) || 0,
            weekdays,
          };
          expr = await ScheduleService.BuildCronFromSimple(cfg);
          if (!cancelled) setCronExpr(expr);
        }
        const times = await ScheduleService.PreviewCron(expr, 5);
        if (!cancelled) {
          setPreviewTimes(times || []);
          setPreviewError("");
        }
      } catch (err) {
        if (!cancelled) {
          setPreviewTimes([]);
          setPreviewError(String(err));
        }
      }
    };

    const timer = window.setTimeout(() => void refreshPreview(), 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, simpleKind, minutes, hour, minute, weekdays, cronExpr]);

  if (!open || !script) return null;

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (previewError) {
      onToast("error", previewError);
      return;
    }
    setSaving(true);
    try {
      const input: ScheduleInput = {
        id: existing?.id || 0,
        scriptId: script.id,
        name: `${script.name} 定时`,
        enabled,
        mode,
        simpleConfig: {
          kind: simpleKind,
          minutes: Number(minutes) || 30,
          hour: Number(hour) || 0,
          minute: Number(minute) || 0,
          weekdays,
        },
        cronExpr,
        allowConcurrent,
      };
      await ScheduleService.SaveSchedule(input);
      onToast("success", enabled ? "定时规则已保存并生效喵~" : "定时规则已保存（当前未启用）");
      await onSaved();
      onClose();
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existing) return;
    setSaving(true);
    try {
      await ScheduleService.DeleteSchedule(existing.id);
      onToast("info", "已移除该脚本的定时规则");
      await onSaved();
      onClose();
    } catch (err) {
      onToast("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
      <form
        onSubmit={handleSave}
        className="neko-card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
        style={{ background: "var(--bg-surface)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-3.5"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
            >
              <CalendarClock className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                定时调度配置 · {script.name}
              </h3>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                基于 robfig/cron/v3 后台驻留托盘持续触发
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
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Master Enable Toggle */}
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border p-3 text-left transition"
            style={{
              background: enabled ? "var(--accent-soft)" : "var(--bg-elevated)",
              borderColor: enabled ? "var(--accent)" : "var(--border-soft)",
            }}
          >
            <div>
              <div className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                启用此定时任务
              </div>
              <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                关闭主窗口收纳到托盘后仍会按计划自动静默执行
              </div>
            </div>
            <div
              className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
              style={{ background: enabled ? "var(--accent)" : "#cbd5e1" }}
            >
              <span
                className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
              />
            </div>
          </button>

          {/* Mode Tabs */}
          <div className="inline-flex rounded-xl p-0.5" style={{ background: "var(--bg-pill)" }}>
            <button
              type="button"
              onClick={() => setMode("simple")}
              className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition"
              style={{
                background: mode === "simple" ? "var(--bg-surface)" : "transparent",
                color: mode === "simple" ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              可视化简易模式
            </button>
            <button
              type="button"
              onClick={() => setMode("cron")}
              className="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition"
              style={{
                background: mode === "cron" ? "var(--bg-surface)" : "transparent",
                color: mode === "cron" ? "var(--accent-text)" : "var(--text-secondary)",
              }}
            >
              Cron 表达式模式
            </button>
          </div>

          {mode === "simple" ? (
            <div className="space-y-3">
              {/* Simple Kind Selector */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "interval", label: "每隔 N 分钟" },
                  { id: "daily", label: "每天定时" },
                  { id: "weekly", label: "每周定时" },
                ].map((k) => {
                  const active = simpleKind === k.id;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setSimpleKind(k.id as "interval" | "daily" | "weekly")}
                      className="rounded-xl border py-2 text-xs font-semibold transition"
                      style={{
                        background: active ? "var(--accent)" : "var(--bg-elevated)",
                        borderColor: active ? "var(--accent)" : "var(--border-soft)",
                        color: active ? "#ffffff" : "var(--text-secondary)",
                      }}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>

              {simpleKind === "interval" && (
                <div className="space-y-2 rounded-2xl border p-3.5" style={{ background: "var(--bg-elevated)", borderColor: "var(--border-soft)" }}>
                  <div className="flex items-center gap-2 text-xs">
                    <span style={{ color: "var(--text-secondary)" }}>每隔</span>
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={minutes}
                      onChange={(e) => setMinutes(Number(e.target.value))}
                      className="h-8 w-24 rounded-xl border px-2.5 text-center font-bold outline-none"
                      style={{
                        background: "var(--bg-surface)",
                        borderColor: "var(--border-soft)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <span style={{ color: "var(--text-secondary)" }}>分钟执行一次</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {[5, 15, 30, 60, 120, 360].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMinutes(m)}
                        className="rounded-lg border px-2 py-1 text-[10px] font-semibold transition"
                        style={{
                          background: minutes === m ? "var(--accent-soft)" : "var(--bg-surface)",
                          borderColor: minutes === m ? "var(--accent)" : "var(--border-soft)",
                          color: minutes === m ? "var(--accent-text)" : "var(--text-secondary)",
                        }}
                      >
                        {m >= 60 ? `每 ${m / 60} 小时` : `每 ${m} 分钟`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(simpleKind === "daily" || simpleKind === "weekly") && (
                <div className="space-y-3 rounded-2xl border p-3.5" style={{ background: "var(--bg-elevated)", borderColor: "var(--border-soft)" }}>
                  {simpleKind === "weekly" && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                        选择星期
                      </div>
                      <div className="flex items-center gap-1.5">
                        {WEEKDAY_LABELS.map((d) => {
                          const active = weekdays.includes(d.val);
                          return (
                            <button
                              key={d.val}
                              type="button"
                              onClick={() => toggleWeekday(d.val)}
                              className="flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition"
                              style={{
                                background: active ? "var(--accent)" : "var(--bg-surface)",
                                borderColor: active ? "var(--accent)" : "var(--border-soft)",
                                color: active ? "#ffffff" : "var(--text-secondary)",
                              }}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs">
                    <span style={{ color: "var(--text-secondary)" }}>触发时间：</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={hour}
                      onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
                      className="h-8 w-16 rounded-xl border px-2 text-center font-mono font-bold outline-none"
                      style={{
                        background: "var(--bg-surface)",
                        borderColor: "var(--border-soft)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <span className="font-bold">:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={minute}
                      onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
                      className="h-8 w-16 rounded-xl border px-2 text-center font-mono font-bold outline-none"
                      style={{
                        background: "var(--bg-surface)",
                        borderColor: "var(--border-soft)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <span className="ml-2 font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                      Cron: {cronExpr}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-2xl border p-3.5" style={{ background: "var(--bg-elevated)", borderColor: "var(--border-soft)" }}>
              <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                标准 5 段 Cron 表达式（分 时 日 月 周，也支持 @every 10m / @daily）
              </label>
              <input
                type="text"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="例如：*/15 * * * * 或 30 9 * * 1-5"
                className="h-9 w-full rounded-xl border px-3 font-mono text-xs font-bold outline-none"
                style={{
                  background: "var(--bg-surface)",
                  borderColor: previewError ? "#f43f5e" : "var(--border-soft)",
                  color: "var(--text-primary)",
                }}
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.expr}
                    type="button"
                    onClick={() => setCronExpr(p.expr)}
                    className="rounded-lg border px-2 py-1 text-[10px] font-semibold transition hover:opacity-85"
                    style={{
                      background: "var(--bg-surface)",
                      borderColor: "var(--border-soft)",
                      color: "var(--accent-text)",
                    }}
                  >
                    {p.label} ({p.expr})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Anti-reentry toggle */}
          <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={!allowConcurrent}
              onChange={(e) => setAllowConcurrent(!e.target.checked)}
              className="h-4 w-4 rounded accent-pink-400"
            />
            <ShieldAlert className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
            <span>防重入保护：若上次执行尚未结束则跳过本次定时触发</span>
          </label>

          {/* Live Next 5 Runs Preview */}
          <div
            className="rounded-2xl border p-3.5"
            style={{
              background: "var(--bg-elevated)",
              borderColor: previewError ? "#fda4af" : "var(--border-soft)",
            }}
          >
            {previewError ? (
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{previewError}</span>
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  校验通过 · 未来 5 次预计运行时间
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {previewTimes.map((t, idx) => (
                    <div
                      key={t}
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[10px]"
                      style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
                    >
                      <Clock className="h-3 w-3 shrink-0" style={{ color: "var(--accent)" }} />
                      <span>#{idx + 1}</span>
                      <span>{t}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-5 py-3"
          style={{ borderColor: "var(--border-soft)" }}
        >
          {existing ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              移除定时
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border px-4 py-1.5 text-xs font-semibold"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || Boolean(previewError)}
              className="rounded-xl px-5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {saving ? "保存中..." : "保存定时规则"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
