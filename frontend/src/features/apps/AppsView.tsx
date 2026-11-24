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
} from "lucide-react";
import nekoGaming from "../../assets/neko/neko-gaming.png";
import nekoCurious from "../../assets/neko/neko-curious.png";
import { AppIcon } from "./AppIcon";
import { AppFormModal } from "./AppFormModal";
import { CategoryModal } from "./CategoryModal";
import { NotesDrawer } from "./NotesDrawer";
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

export const AppsView: React.FC<AppsViewProps> = ({
  searchQuery,
  pendingDrop,
  onDropHandled,
  onToast,
}) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<CategoryFilter>("all");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Modals & Drawer
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AppItem | null>(null);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [notesApp, setNotesApp] = useState<AppItem | null>(null);

  const lastHandledDropId = useRef<number>(0);

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
        // Optimistically bump click count
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
      // Ignore when modals/drawer are open
      if (appModalOpen || catModalOpen || notesApp) return;
      if (apps.length === 0) return;

      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const inTextarea = activeTag === "textarea";
      if (inTextarea) return;

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
  }, [apps, selectedIndex, appModalOpen, catModalOpen, notesApp, handleLaunch]);

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
      {/* Top Category Pills & Actions */}
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

      {/* Main Grid or Empty State */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
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
                    className="neko-card neko-card-hover group relative flex cursor-pointer flex-col justify-between rounded-2xl p-3.5"
                    style={{
                      borderColor: isSelected ? "var(--accent)" : undefined,
                      boxShadow: isSelected
                        ? "0 0 0 2px var(--accent-ring), var(--shadow-card)"
                        : undefined,
                    }}
                  >
                    {/* Top row: Icon + Title + Badges */}
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

                        {/* Tags & Click count */}
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

                    {/* Bottom Quick Action Bar */}
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

            {/* Subtle Drag Hint Footer */}
            <div
              className="mt-3 flex items-center justify-between rounded-xl px-3 py-1.5 text-[10px]"
              style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
            >
              <span className="inline-flex items-center gap-1.5">
                <UploadCloud className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
                支持直接将 Windows 上的 .exe / .lnk / 文件夹拖入本窗口快速导入
              </span>
              <span>↑↓ 切换 · Enter 启动 · Ctrl+Enter 管理员运行</span>
            </div>
          </>
        )}
      </div>

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
