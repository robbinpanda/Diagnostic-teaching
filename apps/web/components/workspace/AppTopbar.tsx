"use client";

import Image from "next/image";
import { ChevronDown, Sparkles, UserRound } from "lucide-react";

export function PandaMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      aria-hidden="true"
      alt=""
      className="pandaMark"
      src="/branding/panda-app-logo.svg"
      width={size}
      height={size}
      priority
    />
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
