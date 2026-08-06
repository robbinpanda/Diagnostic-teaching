"use client";

import { ChevronDown, Sparkles, UserRound } from "lucide-react";

export function PandaMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="pandaMark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="11" r="6" fill="currentColor" />
      <circle cx="36" cy="11" r="6" fill="currentColor" />
      <path d="M8 25.2C8 14.8 14.8 8 24 8s16 6.8 16 17.2C40 35.7 33.7 42 24 42S8 35.7 8 25.2Z" fill="#fff" stroke="currentColor" strokeWidth="2.2" />
      <path d="M13.2 24.4c1.1-4 4-6.2 7-5.4 2.7.7 3.5 3.7 2.4 6.8-1 3.2-3.7 5.1-6.5 4.3-2.8-.8-3.9-2.7-2.9-5.7Zm21.6 0c-1.1-4-4-6.2-7-5.4-2.7.7-3.5 3.7-2.4 6.8 1 3.2 3.7 5.1 6.5 4.3 2.8-.8 3.9-2.7 2.9-5.7Z" fill="currentColor" />
      <circle cx="18.2" cy="24.2" r="1.5" fill="#fff" />
      <circle cx="29.8" cy="24.2" r="1.5" fill="#fff" />
      <path d="M21 32c1.8 1.7 4.2 1.7 6 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="m24 28-1.9 1.4L24 31l1.9-1.6L24 28Z" fill="currentColor" />
    </svg>
  );
}

export function AppTopbar() {
  return (
    <header className="appTopbar">
      <div className="appBrand" aria-label="熊猫析题">
        <PandaMark />
        <strong>熊猫析题</strong>
      </div>
      <div className="topbarAccount">
        <button className="topbarUtility" type="button" aria-label="AI 工具" title="AI 工具">
          <Sparkles size={18} />
        </button>
        <span className="topbarDivider" aria-hidden="true" />
        <span className="accountName">用户名</span>
        <button className="accountButton" type="button" aria-label="打开账户菜单" title="账户菜单">
          <span className="accountAvatar"><UserRound size={21} /></span>
          <ChevronDown size={16} />
        </button>
      </div>
    </header>
  );
}
