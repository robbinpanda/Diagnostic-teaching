"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type RoundedSelectOption = {
  value: string;
  label: string;
  depth?: number;
};

type Props = {
  value: string;
  options: RoundedSelectOption[];
  label: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
};

type MenuStyle = CSSProperties & {
  "--flashcard-panel-strong"?: string;
  "--flashcard-ink"?: string;
  "--flashcard-accent"?: string;
};

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 320;
const VIEWPORT_PADDING = 12;

export function RoundedSelect({
  value,
  options,
  label,
  disabled = false,
  className = "",
  menuClassName = "",
  onChange
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<MenuStyle | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">("bottom");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const root = rootRef.current;
    if (!trigger || !root) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      Math.max(rect.width, 190),
      Math.max(190, viewportWidth - VIEWPORT_PADDING * 2)
    );
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_PADDING),
      Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING)
    );
    const availableBelow = viewportHeight - rect.bottom - VIEWPORT_PADDING - MENU_GAP;
    const availableAbove = rect.top - VIEWPORT_PADDING - MENU_GAP;
    const placement = availableBelow < 180 && availableAbove > availableBelow ? "top" : "bottom";
    const availableHeight = placement === "top" ? availableAbove : availableBelow;
    const maxHeight = Math.max(96, Math.min(MENU_MAX_HEIGHT, availableHeight));
    const computed = window.getComputedStyle(root);

    setMenuPlacement(placement);
    setMenuStyle({
      left,
      width,
      maxHeight,
      ...(placement === "top"
        ? { bottom: viewportHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
      "--flashcard-panel-strong": computed.getPropertyValue("--flashcard-panel-strong"),
      "--flashcard-ink": computed.getPropertyValue("--flashcard-ink"),
      "--flashcard-accent": computed.getPropertyValue("--flashcard-accent")
    });
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !open) return;
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const menu = open && menuStyle && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      className={`roundedSelectMenu${menuClassName ? ` ${menuClassName}` : ""}`}
      id={listboxId}
      role="listbox"
      aria-label={label}
      data-placement={menuPlacement}
      style={menuStyle}
      onWheel={(event) => event.stopPropagation()}
    >
      {options.map((option) => {
        const optionSelected = option.value === value;
        return (
          <button
            key={option.value}
            className={`roundedSelectOption${optionSelected ? " selected" : ""}`}
            type="button"
            role="option"
            aria-selected={optionSelected}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
              triggerRef.current?.focus({ preventScroll: true });
            }}
          >
            <span>{option.depth ? `${"　".repeat(option.depth)}└ ` : ""}{option.label}</span>
            {optionSelected ? <Check size={15} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>,
    document.body
  ) : null;

  return (
    <div className={`roundedSelect${className ? ` ${className}` : ""}${open ? " open" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        className="roundedSelectTrigger"
        type="button"
        disabled={disabled || !selected}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className="roundedSelectValue">
          {selected?.depth ? `${"　".repeat(selected.depth)}└ ` : ""}{selected?.label ?? "暂无选项"}
        </span>
        <ChevronDown className="roundedSelectChevron" size={16} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}
