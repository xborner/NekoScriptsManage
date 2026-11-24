import React, { useState } from "react";
import { AppWindow } from "lucide-react";

interface AppIconProps {
  iconType: string;
  iconValue: string;
  name: string;
  size?: "sm" | "md" | "lg";
}

export const AppIcon: React.FC<AppIconProps> = ({
  iconType,
  iconValue,
  name,
  size = "md",
}) => {
  const [imgError, setImgError] = useState(false);

  const boxClass =
    size === "sm"
      ? "h-8 w-8 rounded-xl text-base"
      : size === "lg"
      ? "h-12 w-12 rounded-2xl text-2xl"
      : "h-11 w-11 rounded-2xl text-xl";

  const imgClass =
    size === "sm" ? "h-6 w-6" : size === "lg" ? "h-9 w-9" : "h-8 w-8";

  if (iconType === "emoji" && iconValue) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center border ${boxClass}`}
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border-soft)",
        }}
      >
        <span className="leading-none">{iconValue}</span>
      </div>
    );
  }

  if ((iconType === "extracted" || iconType === "custom") && iconValue && !imgError) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center border ${boxClass}`}
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border-soft)",
        }}
      >
        <img
          src={`/local-icons/${encodeURIComponent(iconValue)}`}
          alt={name}
          draggable={false}
          onError={() => setImgError(true)}
          className={`${imgClass} rounded-lg object-contain`}
        />
      </div>
    );
  }

  // Soft pastel fallback monogram / icon
  const letter = (name || "N").trim().charAt(0).toUpperCase();
  return (
    <div
      className={`flex shrink-0 items-center justify-center border font-bold ${boxClass}`}
      style={{
        background: "var(--accent-soft)",
        borderColor: "var(--border-soft)",
        color: "var(--accent-text)",
      }}
    >
      {letter ? <span className="text-sm">{letter}</span> : <AppWindow className="h-5 w-5" />}
    </div>
  );
};
