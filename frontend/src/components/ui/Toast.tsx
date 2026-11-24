import React from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle } from "lucide-react";

export interface ToastItem {
  id: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
}

interface ToastStackProps {
  items: ToastItem[];
}

export const ToastStack: React.FC<ToastStackProps> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((item) => {
        const icon =
          item.level === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : item.level === "warn" ? (
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          ) : item.level === "error" ? (
            <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
          ) : (
            <Info className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
          );

        return (
          <div
            key={item.id}
            className="neko-card pointer-events-auto flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {icon}
            <span>{item.message}</span>
          </div>
        );
      })}
    </div>
  );
};
