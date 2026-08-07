# Panda Home and Chat Avatar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved animated panda welcome scene, first-response panda handoff, panda assistant avatars, and warm ivory application canvas in the existing Next.js tutor workspace.

**Architecture:** Reusable SVG primitives live in a focused artwork component, while a client welcome component controls entrance/idle/exit motion. `MessageTimeline` coordinates the source-to-avatar FLIP handoff because both endpoints are present there; `page.tsx` only controls the welcome lifecycle around real session operations.

**Tech Stack:** Next.js 15, React 19, TypeScript, CSS animations, Web Animations API/requestAnimationFrame, Node test runner.

## Global Constraints

- Keep the left navigation/sidebar visually unchanged.
- Keep composer controls and submission behavior unchanged; remove only the visible footer hint.
- Do not add GSAP or another animation dependency.
- Do not change backend APIs, teaching actions, session persistence, or stream semantics.
- Use the locally installed `爱点拍拍刷` font with explicit fallbacks.
- Honor `prefers-reduced-motion` and keep decorative art out of the accessibility tree.
- Do not use gradients in the new welcome background.

---

### Task 1: Reusable Panda SVG Artwork

**Files:**
- Create: `apps/web/components/workspace/PandaArtwork.tsx`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Produces: `PandaAvatar({ className?, title? }: PandaAvatarProps): JSX.Element` and `PandaHeroArtwork({ className?, characterRef? }: PandaHeroArtworkProps): JSX.Element`.
- Produces stable `data-panda-part` hooks for `book`, `book-shadow`, `panda-shadow`, `body`, `ear-left`, `ear-right`, `arm-left`, `arm-right`, and `tail`.

- [ ] **Step 1: Add failing component assertions**

Add render assertions that `PandaAvatar` contains `data-panda-avatar` but no book/shadow hooks, while `PandaHeroArtwork` contains the book, shadow, and panda body hooks.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- --test-name-pattern="panda artwork"`

Expected: FAIL because `PandaArtwork.tsx` and its exports do not exist.

- [ ] **Step 3: Implement the shared SVG primitives**

Create typed React components using inline SVG geometry copied from the approved local panda artwork. Avoid reusable SVG IDs in avatar instances; keep gradients/filters limited to uniquely prefixed hero-only definitions.

- [ ] **Step 4: Run the focused component test**

Run: `npm test -- --test-name-pattern="panda artwork"`

Expected: PASS.

- [ ] **Step 5: Commit the artwork unit**

```powershell
git add -- apps/web/components/workspace/PandaArtwork.tsx apps/web/tests/workspace-components.test.tsx
git commit -m "feat(web): add reusable panda artwork"
```

### Task 2: Animated Welcome Scene

**Files:**
- Create: `apps/web/components/workspace/PandaWelcome.tsx`
- Modify: `apps/web/styles/conversation.css`
- Modify: `apps/web/styles/responsive.css`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: `PandaHeroArtwork` from Task 1.
- Produces: `PandaWelcome({ phase, characterRef }: { phase: "entering" | "ready" | "leaving"; characterRef: RefObject<SVGGElement | null> }): JSX.Element`.

- [ ] **Step 1: Add failing welcome contract assertions**

Assert the rendered welcome has three bamboo plants, individually wrapped title glyphs, the exact supporting copy with a controlled break after the comma, and an exposed hero-character hook.

- [ ] **Step 2: Confirm the new contract fails**

Run: `npm test -- --test-name-pattern="panda welcome"`

Expected: FAIL because the welcome component does not exist.

- [ ] **Step 3: Implement composition and motion**

Build the bamboo SVG instances and text layer around `PandaHeroArtwork`. Use phase classes for book-first/panda-second entrance and exit; use a bounded pointer target plus a single `requestAnimationFrame` loop for breathing, buoyancy, lateral sway, and pointer follow. Stop the loop when leaving or unmounted.

- [ ] **Step 4: Add responsive and reduced-motion CSS**

Keep the desktop title on one line, align bamboo and book baselines, collapse the layout for tablet/mobile, and disable continuous/entrance motion under `prefers-reduced-motion: reduce`.

- [ ] **Step 5: Run focused tests and TypeScript**

Run: `npm test -- --test-name-pattern="panda welcome"`

Run: `npm exec tsc -- --noEmit`

Expected: both PASS.

- [ ] **Step 6: Commit the welcome scene**

```powershell
git add -- apps/web/components/workspace/PandaWelcome.tsx apps/web/styles/conversation.css apps/web/styles/responsive.css apps/web/tests/workspace-components.test.tsx
git commit -m "feat(web): add animated panda welcome scene"
```

### Task 3: Timeline Handoff and Assistant Identity

**Files:**
- Modify: `apps/web/components/workspace/MessageTimeline.tsx`
- Modify: `apps/web/styles/conversation.css`
- Test: `apps/web/tests/workspace-components.test.tsx`

**Interfaces:**
- Consumes: `PandaAvatar`, `PandaWelcome`.
- Extends `MessageTimeline` props with `welcomePhase: "visible" | "leaving" | "hidden"` and `onWelcomeTransitionComplete(): void`.
- Produces a one-shot first-assistant FLIP overlay and `isLatestAssistant` avatar class keyed by message ID.

- [ ] **Step 1: Write failing timeline assertions**

Assert that assistant messages render `PandaAvatar`, the latest assistant receives the one-shot hop class, older assistants do not, and the legacy lucide `Bot` is absent.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- --test-name-pattern="assistant panda avatar"`

Expected: FAIL against the current robot icon.

- [ ] **Step 3: Replace avatars and key latest-message animation**

Compute the latest assistant message ID once per render, attach the hop class only to that avatar, and record animated IDs in a ref so stream text updates do not replay the hop.

- [ ] **Step 4: Implement the hero-to-avatar handoff**

Keep the leaving welcome layer mounted after the first student message. When the first assistant avatar mounts, measure both bounding boxes, render a fixed non-interactive panda overlay, animate translate/scale, hide both endpoint copies during flight, then call `onWelcomeTransitionComplete`. Complete immediately for reduced motion or invalid geometry.

- [ ] **Step 5: Verify timeline behavior**

Run: `npm test -- --test-name-pattern="assistant panda avatar|panda handoff"`

Run: `npm exec tsc -- --noEmit`

Expected: both PASS.

- [ ] **Step 6: Commit the timeline integration**

```powershell
git add -- apps/web/components/workspace/MessageTimeline.tsx apps/web/styles/conversation.css apps/web/tests/workspace-components.test.tsx
git commit -m "feat(web): carry panda into assistant messages"
```

### Task 4: Page Lifecycle, Empty Header, and Composer Footer

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/workspace/TutorComposer.tsx`
- Test: `apps/web/tests/workspace-components.test.tsx`
- Test: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Consumes: extended `MessageTimeline` props from Task 3.
- Adds page-local `welcomePhase` state and transition helpers; no API surface changes.

- [ ] **Step 1: Add failing source and render tests**

Assert the empty session does not render `ConversationHeader`, the timeline receives welcome lifecycle props, and `TutorComposer` has no visible `.composerHint` while retaining an `aria-live` speech status.

- [ ] **Step 2: Confirm the tests fail**

Run: `npm test -- --test-name-pattern="empty workspace header|composer footer|welcome lifecycle"`

Expected: FAIL against current page/composer markup.

- [ ] **Step 3: Wire the welcome lifecycle into session operations**

Initialize empty workspaces as visible, set leaving only after a valid first text/image submission has passed validation, restore visible on an unsuccessful draft start, set hidden when opening/restoring history, and reset visible in `handleStartNewChat`.

- [ ] **Step 4: Remove only the requested visual rows**

Conditionally omit `ConversationHeader` for a truly empty session. Replace the visible composer hint paragraph with a screen-reader-only `role="status" aria-live="polite"` node that reports requesting/recording/transcribing speech states.

- [ ] **Step 5: Run page/component tests and TypeScript**

Run: `npm test -- --test-name-pattern="empty workspace header|composer footer|welcome lifecycle"`

Run: `npm exec tsc -- --noEmit`

Expected: both PASS.

- [ ] **Step 6: Commit the lifecycle integration**

```powershell
git add -- apps/web/app/page.tsx apps/web/components/workspace/TutorComposer.tsx apps/web/tests/workspace-components.test.tsx apps/web/tests/ui-visual-contract.test.ts
git commit -m "feat(web): integrate panda welcome lifecycle"
```

### Task 5: Warm Ivory Canvas Across Main Content

**Files:**
- Modify: `apps/web/styles/base.css`
- Modify: `apps/web/styles/shell.css`
- Modify: `apps/web/styles/conversation.css`
- Modify: `apps/web/styles/history.css`
- Modify: `apps/web/styles/cards.css`
- Modify: `apps/web/styles/dialogs.css`
- Test: `apps/web/tests/ui-visual-contract.test.ts`

**Interfaces:**
- Produces `--panda-canvas: #f7f4ea` and maps main-content canvas surfaces to it.

- [ ] **Step 1: Add failing visual-token assertions**

Assert the warm ivory token exists, main conversation/history/card/dialog workspaces use it, the new welcome background has no gradient, the sidebar retains its existing background rule, and `.composerCard` keeps its existing translucent styling.

- [ ] **Step 2: Confirm the contract fails**

Run: `npm test -- --test-name-pattern="warm ivory"`

Expected: FAIL until the token and surface mappings exist.

- [ ] **Step 3: Apply the shared canvas token**

Set flat main canvases, content shells, history views, and card/detail surfaces to `var(--panda-canvas)`. Keep the left sidebar selector unchanged and retain the composer card declaration. Add subtle dot/grain texture through non-gradient background layers already available in the project.

- [ ] **Step 4: Reconcile existing visual contracts**

Update only assertions whose expected main-canvas treatment intentionally changed. Do not alter byte-freeze checks for card behavior sources.

- [ ] **Step 5: Run the visual contract suite**

Run: `npm test -- --test-name-pattern="warm ivory|conversation keeps|C4 bright"`

Expected: PASS.

- [ ] **Step 6: Commit the canvas update**

```powershell
git add -- apps/web/styles/base.css apps/web/styles/shell.css apps/web/styles/conversation.css apps/web/styles/history.css apps/web/styles/cards.css apps/web/styles/dialogs.css apps/web/tests/ui-visual-contract.test.ts
git commit -m "style(web): unify main canvas background"
```

### Task 6: Full Verification and Browser QA

**Files:**
- Modify only files required to fix issues found by verification.

**Interfaces:**
- Validates all outputs from Tasks 1-5.

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 2: Run static checks**

Run: `npm exec tsc -- --noEmit`

Run: `npm run lint`

Expected: both PASS.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Exercise the browser paths**

Open the local app and verify: empty entrance, pointer follow, first text submission, first image submission, first panda flight, later assistant hop, interruption/retry, history restoration, new-chat reset, desktop/mobile layout, and reduced motion.

- [ ] **Step 5: Review the final diff**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors and only intended tracked files plus the user's pre-existing untracked files.

- [ ] **Step 6: Commit verification fixes if any**

```powershell
git add -u -- apps/web
git commit -m "fix(web): polish panda workspace integration"
```
