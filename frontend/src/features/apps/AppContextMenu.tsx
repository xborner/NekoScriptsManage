import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Play,
  Shield,
  BookOpen,
  Star,
  FolderOpen,
  Copy,
  FolderInput,
  Pencil,
  Trash2,
  ChevronRight,
  Check,
} from "lucide-react";
import type { AppItem, Category } from "../../../bindings/nekomanage/internal/model/models";

interface AppContextMenuProps {
  app: AppItem | null;
  position: { x: number; y: number } | null;
  categories: Category[];
  onClose: () => void;
  onLaunch: (app: AppItem, forceAdmin: boolean) => void;
  onOpenNotes: (app: AppItem) => void;
  onTogglePin: (app: AppItem) => void;
  onOpenFolder: (app: AppItem) => void;
  onCopyPath: (app: AppItem) => void;
  onMoveCategory: (app: AppItem, categoryId: number | null) => void;
  onEdit: (app: AppItem) => void;
  onDelete: (app: AppItem) => void;
}

export const AppContextMenu: React.FC<AppContextMenuProps> = ({
  app,
  position,
  categories,
  onClose,
  onLaunch,
  onOpenNotes,
  onTogglePin,
  onOpenFolder,
  onCopyPath,
  onMoveCategory,
  onEdit,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [showCatSub, setShowCatSub] = useState(false);
  const [subOnLeft, setSubOnLeft] = useState(false);

  useEffect(() => {
    setShowCatSub(false);
  }, [app, position]);

  // Keep menu strictly inside viewport bounds
  useLayoutEffect(() => {
    if (!app || !position || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 10;
    let left = position.x;
    let top = position.y;

    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    setCoords({ left, top });
    setSubOnLeft(left + rect.width + 170 > window.innerWidth - pad);
  }, [app, position]);

  useEffect(() => {
    if (!app || !position) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("wheel", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("wheel", handleScroll);
    };
  }, [app, position, onClose]);

  if (!app || !position) return null;

  const hasNotes = Boolean(app.notesMd && app.notesMd.trim());

  const runAndClose = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{
        left: coords.left,
        top: coords.top,
        background: "var(--bg-surface)",
        borderColor: "var(--border-strong)",
        boxShadow: "0 14px 36px -8px rgba(63, 53, 57, 0.22), 0 4px 12px -2px rgba(63, 53, 57, 0.08)",
      }}
      className="fixed z-50 w-48 rounded-2xl border p-1.5 text-xs select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header label */}
      <div
        className="mb-1 truncate border-b px-2.5 py-1.5 text-[11px] font-bold"
        style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}
        title={app.name}
      >
        {app.name}
      </div>

      <MenuItem
        icon={<Play className="h-3.5 w-3.5 fill-current" style={{ color: "var(--accent)" }} />}
        label="运行应用"
        hint="Enter"
        onClick={() => runAndClose(() => onLaunch(app, false))}
      />
      <MenuItem
        icon={<Shield className="h-3.5 w-3.5 text-amber-500" />}
        label="以管理员运行"
        hint="Ctrl+↵"
        onClick={() => runAndClose(() => onLaunch(app, true))}
      />

      <MenuDivider />

      <MenuItem
        icon={<BookOpen className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />}
        label={hasNotes ? "查看使用说明" : "添加使用说明"}
        badge={hasNotes ? "有" : undefined}
        onClick={() => runAndClose(() => onOpenNotes(app))}
      />
      <MenuItem
        icon={
          <Star
            className={`h-3.5 w-3.5 ${app.isPinned ? "fill-amber-400 text-amber-400" : ""}`}
            style={{ color: app.isPinned ? "#f59e0b" : "var(--text-secondary)" }}
          />
        }
        label={app.isPinned ? "取消置顶" : "置顶应用"}
        onClick={() => runAndClose(() => onTogglePin(app))}
      />
      <MenuItem
        icon={<FolderOpen className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />}
        label="打开所在目录"
        onClick={() => runAndClose(() => onOpenFolder(app))}
      />
      <MenuItem
        icon={<Copy className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />}
        label="复制目标路径"
        onClick={() => runAndClose(() => onCopyPath(app))}
      />

      {/* Move to Category Submenu */}
      <div
        className="relative"
        onMouseEnter={() => setShowCatSub(true)}
        onMouseLeave={() => setShowCatSub(false)}
      >
        <button
          type="button"
          onClick={() => setShowCatSub((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] font-medium transition hover:bg-[var(--bg-hover)]"
          style={{ color: "var(--text-primary)" }}
        >
          <span className="flex items-center gap-2">
            <FolderInput className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
            <span>移动到分类</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
        </button>

        {showCatSub && (
          <div
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-strong)",
              boxShadow: "0 12px 30px -8px rgba(63, 53, 57, 0.2)",
            }}
            className={`absolute top-0 z-50 w-40 rounded-2xl border p-1.5 ${
              subOnLeft ? "right-full mr-1" : "left-full ml-1"
            }`}
          >
            <button
              type="button"
              onClick={() => runAndClose(() => onMoveCategory(app, null))}
              className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] font-medium transition hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>未分类</span>
              {!app.categoryId && <Check className="h-3 w-3" style={{ color: "var(--accent)" }} />}
            </button>
            {categories.map((cat) => {
              const isCurrent = app.categoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => runAndClose(() => onMoveCategory(app, cat.id))}
                  className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] font-medium transition hover:bg-[var(--bg-hover)]"
                  style={{ color: "var(--text-primary)" }}
                >
                  <span className="truncate">
                    {cat.icon} {cat.name}
                  </span>
                  {isCurrent && <Check className="h-3 w-3 shrink-0" style={{ color: "var(--accent)" }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <MenuDivider />

      <MenuItem
        icon={<Pencil className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />}
        label="编辑快捷方式"
        onClick={() => runAndClose(() => onEdit(app))}
      />
      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5 text-rose-500" />}
        label="移除应用"
        danger
        onClick={() => runAndClose(() => onDelete(app))}
      />
    </div>
  );
};

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  badge?: string;
  danger?: boolean;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, hint, badge, danger, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] font-medium transition ${
      danger ? "text-rose-600 hover:bg-rose-50" : "hover:bg-[var(--bg-hover)]"
    }`}
    style={danger ? undefined : { color: "var(--text-primary)" }}
  >
    <span className="flex items-center gap-2">
      {icon}
      <span>{label}</span>
    </span>
    {hint && (
      <span className="font-mono text-[9px]" style={{ color: "var(--text-muted)" }}>
        {hint}
      </span>
    )}
    {badge && (
      <span
        className="rounded-md px-1.5 py-0.5 text-[9px] font-bold"
        style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
      >
        {badge}
      </span>
    )}
  </button>
);

const MenuDivider: React.FC = () => (
  <div className="my-1 border-t" style={{ borderColor: "var(--border-soft)" }} />
);
