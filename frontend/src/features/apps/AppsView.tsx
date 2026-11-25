import React, { useCallback, useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import {
  Plus,
  FolderPlus,
  Star,
  Shield,
  BookOpen,
  Pencil,
  Trash2,
  FolderOpen,
  Flame,
  UploadCloud,
  Grid3X3,
  LayoutGrid,
  List,
} from "lucide-react";
import nekoGaming from "../../assets/neko/neko-gaming.png";
import nekoCurious from "../../assets/neko/neko-curious.png";
import { AppIcon } from "./AppIcon";
import { AppFormModal } from "./AppFormModal";
import { CategoryModal } from "./CategoryModal";
import { NotesDrawer } from "./NotesDrawer";
import { AppContextMenu } from "./AppContextMenu";
import * as AppService from "../../../bindings/nekomanage/internal/service/appservice";
import type {
  AppInput,
  AppItem,
  Category,
  CategoryInput,
  IconReadyPayload,
} from "../../../bindings/nekomanage/internal/model/models";

interface AppsViewProps {
  searchQuery: string;
  pendingDrop: { id: number; paths: string[] } | null;
  onDropHandled: () => void;
  onToast: (level: "info" | "success" | "warn" | "error", msg: string) => void;
}

type CategoryFilter = "all" | "pinned" | number;
type ViewMode = "compact" | "card" | "list";

const VIEW_STORAGE_KEY = "neko.apps.viewMode";

function loadInitialViewMode(): ViewMode {
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "compact" || saved === "card" || saved === "list") {
      return saved;
    }
  } catch {
    // ignore storage errors
  }
  return "compact";
}

export const AppsView: React.FC<AppsViewProps> = ({
  searchQuery,
  pendingDrop,
  onDropHandled,
  onToast,
}) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<CategoryFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>(loadInitialViewMode);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Modals & Drawer
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AppItem | null>(null);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [notesApp, setNotesApp] = useState<AppItem | null>(null);

  // Right-click Maye-style context menu
  const [ctxMenu, setCtxMenu] = useState<{ app: AppItem; x: number; y: number } | null>(null);

  // Compact view hover detail card
  const [hoverInfo, setHoverInfo] = useState<{ app: AppItem; rect: DOMRect } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const lastHandledDropId = useRef<number>(0);

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    setHoverInfo(null);
    setCtxMenu(null);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const clearHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const handleTileMouseEnter = (item: AppItem, idx: number, el: HTMLDivElement) => {
    setSelectedIndex(idx);
    if (viewMode !== "compact" || ctxMenu) return;
    clearHoverTimer();
    const rect = el.getBoundingClientRect();
    hoverTimerRef.current = window.setTimeout(() => {
      setHoverInfo({ app: item, rect });
    }, 180);
  };

  const handleTileMouseLeave = () => {
    clearHoverTimer();
    setHoverInfo(null);
  };

  const handleOpenContextMenu = (e: React.MouseEvent, item: AppItem, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    clearHoverTimer();
    setHoverInfo(null);
    setSelectedIndex(idx);
    setCtxMenu({ app: item, x: e.clientX, y: e.clientY });
  };

  const loadCategories = useCallback(async () => {
    try {
      const list = await AppService.ListCategories();
      setCategories(list || []);
    } catch (err) {
      onToast("error", `加载分类失败: ${String(err)}`);
    }
  }, [onToast]);

  const loadApps = useCallback(async () => {
    try {
      const filter = {
        categoryId: typeof selectedCat === "number" ? selectedCat : null,
        onlyPinned: selectedCat === "pinned",
        keyword: searchQuery,
      };
      const list = await AppService.ListApps(filter);
      setApps(list || []);
      setSelectedIndex(0);
    } catch (err) {
      onToast("error", `加载应用失败: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [selectedCat, searchQuery, onToast]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  useEffect(() => {
    return () => clearHoverTimer();
  }, []);

  // Listen to async icon extraction completion from Go backend
  useEffect(() => {
    const off = Events.On("app:icon-ready", (ev: { data?: IconReadyPayload }) => {
      const payload = ev?.data;
      if (!payload) return;
      setApps((prev) =>
        prev.map((a) =>
          a.id === payload.appId
            ? { ...a, iconType: payload.iconType, iconValue: payload.iconValue }
            : a
        )
      );
      setNotesApp((prev) =>
        prev && prev.id === payload.appId
          ? { ...prev, iconType: payload.iconType, iconValue: payload.iconValue }
          : prev
      );
    });
    return () => off();
  }, []);

  // Process dropped files from Wails v3 native drag-and-drop
  useEffect(() => {
    if (!pendingDrop || pendingDrop.id === lastHandledDropId.current) return;
    lastHandledDropId.current = pendingDrop.id;

    const runImport = async () => {
      const catId = typeof selectedCat === "number" ? selectedCat : null;
      try {
        const added = await AppService.ImportDroppedPaths(pendingDrop.paths, catId);
        if (added && added.length > 0) {
          onToast("success", `成功导入 ${added.length} 个快捷方式喵~`);
          await Promise.all([loadApps(), loadCategories()]);
        } else {
          onToast("warn", "未能识别拖入的文件路径");
        }
      } catch (err) {
        onToast("error", `导入失败: ${String(err)}`);
      } finally {
        onDropHandled();
      }
    };
    void runImport();
  }, [pendingDrop, selectedCat, loadApps, loadCategories, onDropHandled, onToast]);

  const handleLaunch = useCallback(
    async (item: AppItem, forceAdmin = false) => {
      try {
        await AppService.LaunchApp(item.id, forceAdmin);
        onToast(
          "success",
          forceAdmin || item.runAsAdmin
            ? `已以管理员身份启动 ${item.name}`
            : `已启动 ${item.name} 🐾`
        );
        setApps((prev) =>
          prev.map((a) =>
            a.id === item.id ? { ...a, clickCount: a.clickCount + 1 } : a
          )
        );
      } catch (err) {
        onToast("error", `启动 ${item.name} 失败: ${String(err)}`);
      }
    },
    [onToast]
  );

  // Keyboard navigation (Arrow keys + Enter launch + Ctrl+Enter admin launch)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (appModalOpen || catModalOpen || notesApp || ctxMenu) return;
      if (apps.length === 0) return;

      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      if (activeTag === "textarea") return;

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        if (activeTag === "input" && e.key === "ArrowRight") return;
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % apps.length);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        if (activeTag === "input" && e.key === "ArrowLeft") return;
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + apps.length) % apps.length);
      } else if (e.key === "Enter") {
        const target = apps[selectedIndex];
        if (target) {
          e.preventDefault();
          void handleLaunch(target, e.ctrlKey || e.shiftKey);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [apps, selectedIndex, appModalOpen, catModalOpen, notesApp, ctxMenu, handleLaunch]);

  const handleSaveApp = async (input: AppInput) => {
    try {
      await AppService.SaveApp(input);
      onToast("success", input.id ? "应用信息已更新" : "已添加新应用到启动器 🐾");
      await Promise.all([loadApps(), loadCategories()]);
    } catch (err) {
      onToast("error", String(err));
      throw err;
    }
  };

  const handleMoveCategory = async (item: AppItem, nextCategoryId: number | null) => {
    try {
      await AppService.SaveApp({
        id: item.id,
        categoryId: nextCategoryId,
        name: item.name,
        targetPath: item.targetPath,
        arguments: item.arguments,
        workingDir: item.workingDir,
        iconType: item.iconType,
        iconValue: item.iconValue,
        runAsAdmin: item.runAsAdmin,
        tags: item.tags,
        notesMd: item.notesMd,
        isPinned: item.isPinned,
        sortOrder: item.sortOrder,
      });
      const catName =
        nextCategoryId === null
          ? "未分类"
          : categories.find((c) => c.id === nextCategoryId)?.name || "目标分类";
      onToast("success", `已将「${item.name}」移动至 ${catName}`);
      await Promise.all([loadApps(), loadCategories()]);
    } catch (err) {
      onToast("error", `移动分类失败: ${String(err)}`);
    }
  };

  const handleCopyPath = async (item: AppItem) => {
    try {
      await navigator.clipboard.writeText(item.targetPath);
      onToast("success", "已复制目标路径到剪贴板");
    } catch {
      onToast("error", "复制路径失败");
    }
  };

  const handleDeleteApp = async (item: AppItem) => {
    try {
      await AppService.DeleteApp(item.id);
      if (notesApp?.id === item.id) setNotesApp(null);
      onToast("info", `已移除 ${item.name}`);
      await Promise.all([loadApps(), loadCategories()]);
    } catch (err) {
      onToast("error", `删除失败: ${String(err)}`);
    }
  };

  const handleTogglePin = async (item: AppItem) => {
    try {
      const pinned = await AppService.TogglePinApp(item.id);
      onToast("info", pinned ? `已置顶 ${item.name}` : `已取消置顶 ${item.name}`);
      await loadApps();
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const handleOpenFolder = async (item: AppItem) => {
    try {
      await AppService.OpenAppFolder(item.id);
    } catch (err) {
      onToast("error", `无法打开目录: ${String(err)}`);
    }
  };

  const handleSaveNotes = async (appId: number, notesMd: string) => {
    try {
      await AppService.UpdateAppNotes(appId, notesMd);
      setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, notesMd } : a)));
      setNotesApp((prev) => (prev && prev.id === appId ? { ...prev, notesMd } : prev));
      onToast("success", "Markdown 备忘已保存喵~");
    } catch (err) {
      onToast("error", `保存备忘失败: ${String(err)}`);
    }
  };

  const handleSaveCategory = async (input: CategoryInput) => {
    try {
      await AppService.SaveCategory(input);
      onToast("success", input.id ? "分类已更新" : "已新建分类");
      await loadCategories();
    } catch (err) {
      onToast("error", String(err));
      throw err;
    }
  };

  const handleDeleteCategory = async (id: number) => {
    try {
      await AppService.DeleteCategory(id);
      if (selectedCat === id) setSelectedCat("all");
      onToast("info", "已删除分类，原有应用保留在「全部」中");
      await Promise.all([loadCategories(), loadApps()]);
    } catch (err) {
      onToast("error", String(err));
    }
  };

  const totalAppCount = categories.reduce((sum, c) => sum + c.appCount, 0);

  return (
    <div
      id="apps-drop-zone"
      data-file-drop-target=""
      className="flex h-full flex-col gap-3 rounded-2xl transition-all"
    >
      {/* Top Category Pills + View Switcher + Add CTA */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryPill
            active={selectedCat === "all"}
            label="全部"
            icon="🐾"
            count={selectedCat === "all" && !searchQuery ? apps.length : totalAppCount || undefined}
            onClick={() => setSelectedCat("all")}
          />
          <CategoryPill
            active={selectedCat === "pinned"}
            label="置顶常用"
            icon="⭐"
            onClick={() => setSelectedCat("pinned")}
          />

          {categories.map((cat) => (
            <div key={cat.id} className="group relative flex items-center">
              <CategoryPill
                active={selectedCat === cat.id}
                label={cat.name}
                icon={cat.icon}
                color={cat.color}
                count={cat.appCount}
                onClick={() => setSelectedCat(cat.id)}
                onDoubleClick={() => {
                  setEditingCat(cat);
                  setCatModalOpen(true);
                }}
              />
              {selectedCat === cat.id && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCat(cat);
                    setCatModalOpen(true);
                  }}
                  title="编辑当前分类"
                  className="ml-0.5 rounded-lg p-1 transition hover:opacity-80"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              setEditingCat(null);
              setCatModalOpen(true);
            }}
            title="新建应用分类"
            className="inline-flex h-7 items-center gap-1 rounded-xl border border-dashed px-2.5 text-[11px] font-semibold transition hover:opacity-90"
            style={{
              borderColor: "var(--border-strong)",
              color: "var(--text-secondary)",
            }}
          >
            <FolderPlus className="h-3 w-3" />
            分类
          </button>
        </div>

        {/* Right Controls: View Switcher + Add App */}
        <div className="flex items-center gap-2">
          <div
            className="inline-flex h-8 items-center rounded-xl border p-0.5"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-soft)",
            }}
            title="切换视图模式（简约 / 卡片 / 列表）"
          >
            <ViewToggleButton
              active={viewMode === "compact"}
              icon={<Grid3X3 className="h-3.5 w-3.5" />}
              label="简约"
              onClick={() => changeViewMode("compact")}
            />
            <ViewToggleButton
              active={viewMode === "card"}
              icon={<LayoutGrid className="h-3.5 w-3.5" />}
              label="卡片"
              onClick={() => changeViewMode("card")}
            />
            <ViewToggleButton
              active={viewMode === "list"}
              icon={<List className="h-3.5 w-3.5" />}
              label="列表"
              onClick={() => changeViewMode("list")}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingApp(null);
              setAppModalOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95"
            style={{ background: "var(--accent)" }}
          >
            <Plus className="h-3.5 w-3.5" />
            添加应用
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className="min-h-0 flex-1 overflow-y-auto pr-1"
        onScroll={() => {
          clearHoverTimer();
          setHoverInfo(null);
        }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
            加载应用列表中...
          </div>
        ) : apps.length === 0 ? (
          <div
            className="flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center"
            style={{
              borderColor: "var(--border-strong)",
              background: "var(--bg-elevated)",
            }}
          >
            <img
              src={searchQuery ? nekoCurious : nekoGaming}
              alt="Neko Empty"
              draggable={false}
              className="animate-neko-float mb-3 h-36 w-auto drop-shadow-md"
            />
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {searchQuery
                ? `没有找到与「${searchQuery}」匹配的应用喵~`
                : "把常用软件 .exe、快捷方式 .lnk 或文件夹直接拖进来吧~"}
            </h3>
            <p className="mt-1 max-w-md text-xs" style={{ color: "var(--text-secondary)" }}>
              {searchQuery
                ? "试试换个关键词、标签名，或按应用使用说明里的内容搜索"
                : "拖入后会自动解析 .lnk 真实路径并提取高清 PNG 图标，也支持点击右上角手动添加"}
            </p>
            {!searchQuery && (
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingApp(null);
                    setAppModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
                  style={{ background: "var(--accent)" }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  手动添加第一个应用
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 1. COMPACT VIEW (Default - Maye Lite style: only Icon + Name, Hover card, Left-click run, Right-click menu) */}
            {viewMode === "compact" && (
              <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-5 lg:grid-cols-6">
                {apps.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onMouseEnter={(e) => handleTileMouseEnter(item, idx, e.currentTarget)}
                      onMouseLeave={handleTileMouseLeave}
                      onClick={() => void handleLaunch(item, false)}
                      onContextMenu={(e) => handleOpenContextMenu(e, item, idx)}
                      className="neko-card neko-card-hover group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-2 py-3.5 text-center"
                      style={{
                        borderColor: isSelected ? "var(--accent)" : undefined,
                        boxShadow: isSelected
                          ? "0 0 0 2px var(--accent-ring), var(--shadow-card)"
                          : undefined,
                      }}
                    >
                      {/* Subtle pin dot in corner without cluttering minimal layout */}
                      {item.isPinned && (
                        <span
                          className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-amber-400"
                          title="已置顶"
                        />
                      )}
                      <AppIcon
                        iconType={item.iconType}
                        iconValue={item.iconValue}
                        name={item.name}
                        size="lg"
                      />
                      <span
                        className="w-full truncate px-1 text-[11px] font-semibold leading-tight"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {item.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 2. CARD VIEW (Rich macaron detail cards + right-click menu) */}
            {viewMode === "card" && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {apps.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  const hasNotes = Boolean(item.notesMd && item.notesMd.trim());
                  const tagList = (item.tags || "")
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 2);

                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => void handleLaunch(item, false)}
                      onContextMenu={(e) => handleOpenContextMenu(e, item, idx)}
                      className="neko-card neko-card-hover group relative flex cursor-pointer flex-col justify-between rounded-2xl p-3.5"
                      style={{
                        borderColor: isSelected ? "var(--accent)" : undefined,
                        boxShadow: isSelected
                          ? "0 0 0 2px var(--accent-ring), var(--shadow-card)"
                          : undefined,
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <AppIcon
                          iconType={item.iconType}
                          iconValue={item.iconValue}
                          name={item.name}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <h4
                              className="truncate text-xs font-bold"
                              style={{ color: "var(--text-primary)" }}
                              title={item.name}
                            >
                              {item.name}
                            </h4>
                            {item.isPinned && (
                              <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                            )}
                            {item.runAsAdmin && (
                              <span title="默认以管理员身份运行">
                                <Shield className="h-3 w-3 shrink-0 text-amber-500" />
                              </span>
                            )}
                          </div>
                          <div
                            className="mt-0.5 truncate font-mono text-[10px]"
                            style={{ color: "var(--text-muted)" }}
                            title={item.targetPath}
                          >
                            {item.targetPath}
                          </div>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {tagList.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                                style={{
                                  background: "var(--bg-pill)",
                                  color: "var(--accent-text)",
                                }}
                              >
                                #{tag}
                              </span>
                            ))}
                            {item.clickCount > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-medium"
                                style={{
                                  background: "var(--bg-elevated)",
                                  color: "var(--text-muted)",
                                }}
                                title={`累计启动 ${item.clickCount} 次`}
                              >
                                <Flame className="h-2.5 w-2.5" style={{ color: "var(--accent)" }} />
                                {item.clickCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div
                        className="mt-2.5 flex items-center justify-between border-t pt-2"
                        style={{ borderColor: "var(--border-soft)" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setNotesApp(item)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition hover:opacity-85"
                          style={{
                            background: hasNotes ? "var(--accent-soft)" : "var(--bg-elevated)",
                            color: hasNotes ? "var(--accent-text)" : "var(--text-muted)",
                          }}
                          title="查看/编辑 Markdown 使用说明与快捷键备忘"
                        >
                          <BookOpen className="h-3 w-3" />
                          {hasNotes ? "使用说明" : "添加备忘"}
                        </button>

                        <div className="flex items-center gap-0.5 opacity-75 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => void handleLaunch(item, true)}
                            title="以管理员身份运行 (Ctrl+Enter)"
                            className="rounded-lg p-1.5 transition hover:bg-amber-50 hover:text-amber-600"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <Shield className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleTogglePin(item)}
                            title={item.isPinned ? "取消置顶" : "置顶应用"}
                            className="rounded-lg p-1.5 transition hover:opacity-80"
                            style={{ color: item.isPinned ? "#f59e0b" : "var(--text-muted)" }}
                          >
                            <Star className={`h-3.5 w-3.5 ${item.isPinned ? "fill-current" : ""}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleOpenFolder(item)}
                            title="在资源管理器中定位"
                            className="rounded-lg p-1.5 transition hover:opacity-80"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingApp(item);
                              setAppModalOpen(true);
                            }}
                            title="编辑快捷方式"
                            className="rounded-lg p-1.5 transition hover:opacity-80"
                            style={{ color: "var(--text-muted)" }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteApp(item)}
                            title="移除该应用"
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

            {/* 3. LIST VIEW (High-efficiency single-row list + right-click menu) */}
            {viewMode === "list" && (
              <div className="flex flex-col gap-1.5">
                {apps.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  const hasNotes = Boolean(item.notesMd && item.notesMd.trim());
                  const tagList = (item.tags || "")
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 2);

                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => void handleLaunch(item, false)}
                      onContextMenu={(e) => handleOpenContextMenu(e, item, idx)}
                      className="neko-card group flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 transition"
                      style={{
                        borderColor: isSelected ? "var(--accent)" : undefined,
                        boxShadow: isSelected
                          ? "0 0 0 2px var(--accent-ring), var(--shadow-card)"
                          : undefined,
                      }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <AppIcon
                          iconType={item.iconType}
                          iconValue={item.iconValue}
                          name={item.name}
                          size="sm"
                        />
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className="shrink-0 text-xs font-bold"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {item.name}
                          </span>
                          {item.isPinned && (
                            <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                          )}
                          {item.runAsAdmin && (
                            <Shield className="h-3 w-3 shrink-0 text-amber-500" />
                          )}
                          {tagList.map((tag) => (
                            <span
                              key={tag}
                              className="hidden shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold sm:inline-block"
                              style={{
                                background: "var(--bg-pill)",
                                color: "var(--accent-text)",
                              }}
                            >
                              #{tag}
                            </span>
                          ))}
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-[10px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {item.targetPath}
                          </span>
                        </div>
                      </div>

                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.clickCount > 0 && (
                          <span
                            className="mr-1 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px]"
                            style={{
                              background: "var(--bg-elevated)",
                              color: "var(--text-muted)",
                            }}
                          >
                            <Flame className="h-2.5 w-2.5" style={{ color: "var(--accent)" }} />
                            {item.clickCount}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setNotesApp(item)}
                          title="使用说明与备忘"
                          className="rounded-lg p-1.5 transition hover:opacity-80"
                          style={{
                            color: hasNotes ? "var(--accent)" : "var(--text-muted)",
                          }}
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingApp(item);
                            setAppModalOpen(true);
                          }}
                          title="编辑快捷方式"
                          className="rounded-lg p-1.5 transition hover:opacity-80"
                          style={{ color: "var(--text-muted)" }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Subtle Drag & Interaction Hint Footer */}
            <div
              className="mt-3 flex items-center justify-between rounded-xl px-3 py-1.5 text-[10px]"
              style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
            >
              <span className="inline-flex items-center gap-1.5">
                <UploadCloud className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                支持拖入 .exe / .lnk / 文件夹快速导入
              </span>
              <span>左键运行 · 右键菜单 · ↑↓切换 · Ctrl+Enter 管理员</span>
            </div>
          </>
        )}
      </div>

      {/* Compact View Floating Hover Detail Card */}
      {hoverInfo && !ctxMenu && <CompactHoverCard app={hoverInfo.app} anchor={hoverInfo.rect} />}

      {/* Maye-style Right-Click Context Menu */}
      <AppContextMenu
        app={ctxMenu?.app || null}
        position={ctxMenu ? { x: ctxMenu.x, y: ctxMenu.y } : null}
        categories={categories}
        onClose={() => setCtxMenu(null)}
        onLaunch={(item, admin) => void handleLaunch(item, admin)}
        onOpenNotes={(item) => setNotesApp(item)}
        onTogglePin={(item) => void handleTogglePin(item)}
        onOpenFolder={(item) => void handleOpenFolder(item)}
        onCopyPath={(item) => void handleCopyPath(item)}
        onMoveCategory={(item, catId) => void handleMoveCategory(item, catId)}
        onEdit={(item) => {
          setEditingApp(item);
          setAppModalOpen(true);
        }}
        onDelete={(item) => void handleDeleteApp(item)}
      />

      {/* Modals & Markdown Notes Drawer */}
      <AppFormModal
        open={appModalOpen}
        editing={editingApp}
        defaultCategoryId={typeof selectedCat === "number" ? selectedCat : null}
        categories={categories}
        onClose={() => setAppModalOpen(false)}
        onSave={handleSaveApp}
        onToast={onToast}
      />

      <CategoryModal
        open={catModalOpen}
        editing={editingCat}
        onClose={() => setCatModalOpen(false)}
        onSave={handleSaveCategory}
        onDelete={handleDeleteCategory}
      />

      <NotesDrawer
        app={notesApp}
        onClose={() => setNotesApp(null)}
        onSaveNotes={handleSaveNotes}
        onLaunch={(item) => void handleLaunch(item, false)}
      />
    </div>
  );
};

interface CompactHoverCardProps {
  app: AppItem;
  anchor: DOMRect;
}

const CompactHoverCard: React.FC<CompactHoverCardProps> = ({ app, anchor }) => {
  const cardWidth = 264;
  const estHeight = 148;
  const pad = 10;

  let left = anchor.left + anchor.width / 2 - cardWidth / 2;
  if (left < pad) left = pad;
  if (left + cardWidth > window.innerWidth - pad) {
    left = window.innerWidth - cardWidth - pad;
  }

  let top = anchor.bottom + 8;
  if (top + estHeight > window.innerHeight - pad) {
    top = Math.max(pad, anchor.top - estHeight - 8);
  }

  const tags = (app.tags || "")
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4);

  const noteSnippet = (app.notesMd || "")
    .replace(/[#`>*_|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div
      style={{
        left,
        top,
        width: cardWidth,
        background: "var(--bg-surface)",
        borderColor: "var(--border-strong)",
        boxShadow: "0 12px 32px -8px rgba(63, 53, 57, 0.2), 0 4px 10px -2px rgba(63, 53, 57, 0.08)",
      }}
      className="pointer-events-none fixed z-40 rounded-2xl border p-3 text-left"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-bold" style={{ color: "var(--text-primary)" }}>
            {app.name}
          </span>
          {app.isPinned && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
          {app.runAsAdmin && <Shield className="h-3 w-3 shrink-0 text-amber-500" />}
        </div>
        {app.clickCount > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: "var(--bg-pill)", color: "var(--accent-text)" }}
          >
            <Flame className="h-2.5 w-2.5" />
            {app.clickCount} 次
          </span>
        )}
      </div>

      <div
        className="mt-1 break-all font-mono text-[10px] leading-snug"
        style={{ color: "var(--text-muted)" }}
      >
        {app.targetPath}
        {app.arguments ? ` ${app.arguments}` : ""}
      </div>

      {tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
              style={{ background: "var(--bg-pill)", color: "var(--accent-text)" }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {noteSnippet && (
        <div
          className="mt-1.5 line-clamp-2 rounded-lg px-2 py-1 text-[10px] leading-relaxed"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
        >
          📖 {noteSnippet}
        </div>
      )}

      <div
        className="mt-2 flex items-center justify-between border-t pt-1.5 text-[9px]"
        style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
      >
        <span>左键单击启动</span>
        <span>右键打开更多操作</span>
      </div>
    </div>
  );
};

interface ViewToggleButtonProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

const ViewToggleButton: React.FC<ViewToggleButtonProps> = ({ active, icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition"
    style={{
      background: active ? "var(--accent-soft)" : "transparent",
      color: active ? "var(--accent-text)" : "var(--text-muted)",
    }}
  >
    {icon}
    <span>{label}</span>
  </button>
);

interface CategoryPillProps {
  active: boolean;
  label: string;
  icon: string;
  color?: string;
  count?: number;
  onClick: () => void;
  onDoubleClick?: () => void;
}

const CategoryPill: React.FC<CategoryPillProps> = ({
  active,
  label,
  icon,
  color,
  count,
  onClick,
  onDoubleClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    onDoubleClick={onDoubleClick}
    className="inline-flex h-7 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-semibold transition-all"
    style={{
      background: active ? "var(--accent)" : "var(--bg-surface)",
      borderColor: active ? "var(--accent)" : "var(--border-soft)",
      color: active ? "#ffffff" : "var(--text-secondary)",
      boxShadow: active ? "var(--shadow-card)" : "none",
    }}
  >
    {color && !active && (
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
    )}
    <span>{icon}</span>
    <span>{label}</span>
    {typeof count === "number" && (
      <span
        className="rounded-md px-1 text-[10px]"
        style={{
          background: active ? "rgba(255,255,255,0.25)" : "var(--bg-pill)",
          color: active ? "#ffffff" : "var(--accent-text)",
        }}
      >
        {count}
      </span>
    )}
  </button>
);
