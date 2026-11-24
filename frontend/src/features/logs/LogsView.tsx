import React, { useCallback, useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import {
  Copy,
  Check,
  Trash2,
  RefreshCw,
  Square,
  AlertTriangle,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Clock,
} from "lucide-react";
import nekoCurious from "../../assets/neko/neko-curious.png";
import { StatusBadge } from "../scripts/ScriptsView";
import * as LogService from "../../../bindings/nekomanage/internal/service/logservice";
import * as ScriptService from "../../../bindings/nekomanage/internal/service/scriptservice";
import type {
  LogSummary,
  ScriptItem,
  ScriptLog,
  ScriptLogChunkPayload,
  ScriptStatusPayload,
} from "../../../bindings/nekomanage/internal/model/models";

interface LogsViewProps {
  searchQuery: string;
  initialScriptId: number | null;
  initialLogId: number | null;
  onConsumeInitial: () => void;
  onToast: (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return `${ms || 0} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(1);
  return `${mins}m ${secs}s`;
}

export const LogsView: React.FC<LogsViewProps> = ({
  searchQuery,
  initialScriptId,
  initialLogId,
  onConsumeInitial,
  onToast,
}) => {
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [scriptFilter, setScriptFilter] = useState<string>(
    initialScriptId ? String(initialScriptId) : ""
  );
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [triggerFilter, setTriggerFilter] = useState<"" | "manual" | "schedule">("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<LogSummary[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(initialLogId);
  const [detail, setDetail] = useState<ScriptLog | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const outputEndRef = useRef<HTMLDivElement>(null);
  const pageSize = 25;

  // Apply external navigation jump (from ScriptsView -> LogsView)
  useEffect(() => {
    if (initialScriptId !== null || initialLogId !== null) {
      if (initialScriptId !== null) setScriptFilter(String(initialScriptId));
      if (initialLogId !== null) setSelectedLogId(initialLogId);
      setPage(1);
      onConsumeInitial();
    }
  }, [initialScriptId, initialLogId, onConsumeInitial]);

  useEffect(() => {
    void ScriptService.ListScripts("", "all")
      .then((list) => setScripts(list || []))
      .catch(() => {});
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const res = await LogService.QueryLogs({
        scriptId: scriptFilter ? Number(scriptFilter) : null,
        onlyFailed,
        triggerType: triggerFilter,
        keyword: searchQuery,
        page,
        pageSize,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
      setSelectedLogId((prev) => {
        if (prev && (res.items || []).some((it) => it.id === prev)) return prev;
        return res.items && res.items.length > 0 ? res.items[0].id : null;
      });
    } catch (err) {
      onToast("error", `加载日志失败: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [scriptFilter, onlyFailed, triggerFilter, searchQuery, page, onToast]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const d = await LogService.GetLogDetail(id);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    if (selectedLogId) {
      void loadDetail(selectedLogId);
    } else {
      setDetail(null);
    }
  }, [selectedLogId, loadDetail]);

  // Listen to real-time log chunks & status changes
  useEffect(() => {
    const offChunk = Events.On("script:log-chunk", (ev: { data?: ScriptLogChunkPayload }) => {
      const p = ev?.data;
      if (!p) return;
      setDetail((prev) => {
        if (!prev || prev.id !== p.logId) return prev;
        if (p.stream === "stderr") {
          return { ...prev, stderrText: prev.stderrText + p.chunk };
        }
        return { ...prev, stdoutText: prev.stdoutText + p.chunk };
      });
      window.requestAnimationFrame(() => {
        outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    });

    const offStatus = Events.On("script:status-changed", (ev: { data?: ScriptStatusPayload }) => {
      const p = ev?.data;
      if (!p) return;
      void loadLogs();
      if (selectedLogId === p.logId) {
        void loadDetail(p.logId);
      }
    });

    return () => {
      offChunk();
      offStatus();
    };
  }, [loadLogs, loadDetail, selectedLogId]);

  const handleCopyOutput = async () => {
    if (!detail) return;
    const parts: string[] = [];
    if (detail.stdoutText) parts.push(detail.stdoutText);
    if (detail.stderrText) parts.push("--- STDERR ---\n" + detail.stderrText);
    if (detail.errorMessage) parts.push("--- ERROR ---\n" + detail.errorMessage);
    const full = parts.join("\n").trim() || "(无输出)";
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      onToast("success", "已复制完整终端输出到剪贴板");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast("error", "复制失败");
    }
  };

  const handleStopRunning = async () => {
    if (!detail || detail.status !== "running") return;
    try {
      await ScriptService.StopScript(detail.id);
      onToast("warn", "已发送进程树强制终止指令");
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleDeleteOne = async (id: number) => {
    try {
      await LogService.DeleteLog(id);
      onToast("info", "已删除该条日志");
      await loadLogs();
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleCleanup = async () => {
    try {
      const n = await LogService.RunLogCleanup();
      onToast("success", n > 0 ? `已按保留策略清理 ${n} 条历史日志` : "当前所有日志均在保留策略内，无需清理");
      await loadLogs();
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleClear = async () => {
    try {
      const sid = scriptFilter ? Number(scriptFilter) : null;
      const n = await LogService.ClearLogs(sid);
      onToast("info", `已清空 ${n} 条已完成日志`);
      setPage(1);
      await loadLogs();
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Top Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={scriptFilter}
            onChange={(e) => {
              setScriptFilter(e.target.value);
              setPage(1);
            }}
            className="h-8 rounded-xl border px-2.5 text-[11px] font-semibold outline-none"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-soft)",
              color: "var(--text-primary)",
            }}
          >
            <option value="">全部脚本</option>
            {scripts.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              setOnlyFailed((v) => !v);
              setPage(1);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition"
            style={{
              background: onlyFailed ? "#ffe4e6" : "var(--bg-surface)",
              borderColor: onlyFailed ? "#f43f5e" : "var(--border-soft)",
              color: onlyFailed ? "#be123c" : "var(--text-secondary)",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            仅看异常/失败
          </button>

          <select
            value={triggerFilter}
            onChange={(e) => {
              setTriggerFilter(e.target.value as "" | "manual" | "schedule");
              setPage(1);
            }}
            className="h-8 rounded-xl border px-2.5 text-[11px] font-semibold outline-none"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-soft)",
              color: "var(--text-secondary)",
            }}
          >
            <option value="">全部触发方式</option>
            <option value="manual">手动运行</option>
            <option value="schedule">定时调度</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void loadLogs()}
            title="刷新日志"
            className="flex h-8 w-8 items-center justify-center rounded-xl border transition hover:opacity-80"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-soft)",
              color: "var(--text-secondary)",
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCleanup()}
            title="按保留天数与最大条数策略清理旧日志"
            className="inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition hover:opacity-85"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-soft)",
              color: "var(--text-secondary)",
            }}
          >
            <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
            策略清理
          </button>
          <button
            type="button"
            onClick={() => void handleClear()}
            className="inline-flex h-8 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold text-rose-500 transition hover:bg-rose-50"
            style={{ borderColor: "var(--border-soft)", background: "var(--bg-surface)" }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空
          </button>
        </div>
      </div>

      {/* Main Split Pane */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
          加载执行日志中...
        </div>
      ) : items.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center rounded-2xl border p-8 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-soft)" }}
        >
          <img
            src={nekoCurious}
            alt="No Logs"
            draggable={false}
            className="animate-neko-float mb-3 h-36 w-auto drop-shadow-md"
          />
          <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            当前筛选条件下没有执行日志喵~
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            去「脚本管家」运行一个脚本，完整的中文输出与耗时记录就会立刻出现在这里！
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-12">
          {/* Left: Log List */}
          <div
            className="neko-card flex min-h-0 flex-col overflow-hidden rounded-2xl md:col-span-5"
            style={{ background: "var(--bg-surface)" }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {items.map((item) => {
                const active = item.id === selectedLogId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedLogId(item.id)}
                    className="flex w-full flex-col gap-1 px-3.5 py-2.5 text-left transition"
                    style={{
                      background: active ? "var(--accent-soft)" : "transparent",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-xs font-bold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {item.scriptNameSnapshot}
                      </span>
                      <StatusBadge status={item.status} />
                    </div>
                    <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
                      <span>
                        {item.triggerType === "schedule" ? "⏰ 定时" : "👆 手动"} · {item.startedAt}
                      </span>
                      <span className="font-mono">
                        {item.status === "running" ? "进行中" : formatDuration(item.durationMs)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Pagination Footer */}
            <div
              className="flex items-center justify-between border-t px-3 py-2 text-[10px]"
              style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
            >
              <span>共 {total} 条记录</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border p-1 disabled:opacity-35"
                  style={{ borderColor: "var(--border-soft)" }}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-1.5 font-semibold">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border p-1 disabled:opacity-35"
                  style={{ borderColor: "var(--border-soft)" }}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Terminal Output Detail */}
          <div
            className="neko-card flex min-h-0 flex-col overflow-hidden rounded-2xl md:col-span-7"
            style={{ background: "var(--bg-surface)" }}
          >
            {detail ? (
              <>
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
                  style={{ borderColor: "var(--border-soft)", background: "var(--bg-elevated)" }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
                      <h4 className="truncate text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                        #{detail.id} · {detail.scriptNameSnapshot}
                      </h4>
                      <StatusBadge status={detail.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        耗时 {formatDuration(detail.durationMs)}
                      </span>
                      {detail.exitCode !== null && detail.exitCode !== undefined && (
                        <span className="font-mono">退出码: {detail.exitCode}</span>
                      )}
                      <span>开始: {detail.startedAt}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {detail.status === "running" && (
                      <button
                        type="button"
                        onClick={() => void handleStopRunning()}
                        className="inline-flex items-center gap-1 rounded-xl bg-rose-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-rose-600"
                      >
                        <Square className="h-3 w-3 fill-current" />
                        终止
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleCopyOutput()}
                      className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-85"
                      style={{
                        background: "var(--bg-surface)",
                        borderColor: "var(--border-soft)",
                        color: "var(--accent-text)",
                      }}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? "已复制" : "复制输出"}
                    </button>
                    {detail.status !== "running" && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteOne(detail.id)}
                        title="删除此条日志"
                        className="rounded-xl border p-1.5 text-rose-500 transition hover:bg-rose-50"
                        style={{ borderColor: "var(--border-soft)", background: "var(--bg-surface)" }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {detail.errorMessage && (
                  <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-[11px] font-medium text-rose-600">
                    {detail.errorMessage}
                  </div>
                )}

                <div
                  className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed select-text"
                  style={{ background: "#1e202b", color: "#e6edf3" }}
                >
                  {detail.stdoutText ? (
                    <pre className="whitespace-pre-wrap break-words">{detail.stdoutText}</pre>
                  ) : !detail.stderrText ? (
                    <div className="text-slate-400">
                      {detail.status === "running"
                        ? "正在实时监听脚本输出..."
                        : "(本次执行没有标准输出)"}
                    </div>
                  ) : null}

                  {detail.stderrText && (
                    <div className="mt-3 border-t border-rose-500/30 pt-3">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-400">
                        STDERR 错误输出
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-rose-300">
                        {detail.stderrText}
                      </pre>
                    </div>
                  )}
                  <div ref={outputEndRef} />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
                点击左侧任意一条日志查看完整终端输出
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
