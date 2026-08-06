"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

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
  onChange: (value: string) => void;
};

export function RoundedSelect({
  value,
  options,
  label,
  disabled = false,
  className = "",
  onChange
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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
      <div
        className="roundedSelectMenu"
        id={listboxId}
        role="listbox"
        aria-label={label}
        hidden={!open}
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
      </div>
    </div>
  );
}
