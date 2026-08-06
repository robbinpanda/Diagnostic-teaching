# Panda Logo Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top-left inline panda mark with the supplied official SVG while preserving the “熊猫析题” wordmark and current layout.

**Architecture:** Store the supplied SVG unchanged under the Next.js public directory and render it from the existing `PandaMark` component through `next/image`. Keep the component's numeric `size` contract and the existing responsive CSS, so no caller or layout changes are required.

**Tech Stack:** Next.js 15, React 19, TypeScript, CSS, SVG static assets.

## Global Constraints

- Preserve the visible “熊猫析题” text.
- Keep the logo at `36 × 36px` on desktop and `31 × 31px` at the existing mobile breakpoint.
- Copy the supplied SVG without changing its vector paths, colors, base, or view box.
- Add no dependencies and do not change unrelated UI or business behavior.
- Preserve unrelated uncommitted workspace changes.

---

### Task 1: Replace the top-left panda mark

**Files:**
- Create: `apps/web/public/branding/panda-app-logo.svg`
- Modify: `apps/web/components/workspace/AppTopbar.tsx`

**Interfaces:**
- Consumes: `PandaMark({ size?: number })`, defaulting to `36`.
- Produces: the same `PandaMark` component API, rendering `/branding/panda-app-logo.svg` as a decorative image with class `pandaMark`.

- [ ] **Step 1: Copy the official vector asset**

Copy `C:\AI4EDU\ui lowpoly\panda-app-logo-editable-smooth.svg` byte-for-byte to `apps/web/public/branding/panda-app-logo.svg`.

- [ ] **Step 2: Replace the inline paths with the static image**

Import `Image` from `next/image` and make `PandaMark` return:

```tsx
<Image
  aria-hidden="true"
  alt=""
  className="pandaMark"
  src="/branding/panda-app-logo.svg"
  width={size}
  height={size}
  priority
/>
```

Keep the `size` default, `AppTopbar` markup, visible wordmark, and CSS unchanged.

- [ ] **Step 3: Verify source fidelity and frontend contracts**

Run from the repository root:

```powershell
Get-FileHash 'C:\AI4EDU\ui lowpoly\panda-app-logo-editable-smooth.svg'
Get-FileHash 'apps\web\public\branding\panda-app-logo.svg'
```

Expected: both SHA-256 hashes are identical.

Run from `apps/web`:

```powershell
npm.cmd exec tsc -- --noEmit
npm.cmd test
```

Expected: both commands exit `0`.

- [ ] **Step 4: Review the scoped diff**

Run:

```powershell
git diff -- apps/web/components/workspace/AppTopbar.tsx apps/web/public/branding/panda-app-logo.svg
```

Expected: the old inline SVG paths are removed, the supplied asset is added, and the wordmark remains unchanged.
