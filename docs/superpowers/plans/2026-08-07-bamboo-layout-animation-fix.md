# Bamboo Layout and Animation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct all three bamboo positions and make their independent stalk and leaf idle motion visibly verifiable.

**Architecture:** Preserve the single bamboo geometry template, but clone it beneath a fixed `bamboo-layout` group and a runtime `bamboo-sway` group. Use SVG transform attributes with explicit pivots so animation does not depend on browser-specific CSS transform-origin calculations.

**Tech Stack:** Inline SVG, vanilla JavaScript, GSAP 3.13 only for entrance reveal, Node static verifier.

## Global Constraints

- Modify only the visualization fragment, its verifier, and the standalone preview copy.
- Do not modify either original SVG or `apps/web`.
- Keep exactly three bamboo instances and one shared geometry template.
- Keep GSAP away from continuous bamboo sway and leaf motion.
- Disable idle bamboo motion under `prefers-reduced-motion: reduce`.

---

### Task 1: Separate Bamboo Layout and Motion

**Files:**
- Modify: `C:/Users/robbin/.codex/visualizations/2026/08/07/019fda36-16bf-7662-9992-db7f4cc23fa5/panda-welcome-animation.verify.mjs`
- Modify: `C:/Users/robbin/.codex/visualizations/2026/08/07/019fda36-16bf-7662-9992-db7f4cc23fa5/panda-welcome-animation.html`
- Modify: `C:/Users/robbin/AppData/Local/Temp/panda-welcome-animation-preview.html`

**Interfaces:**
- Consumes: `.bamboo-instance`, `.bamboo-layout`, `.bamboo-leaf-a`, `.bamboo-leaf-b`, and `updateBambooIdle(now, reduce)`.
- Produces: `.bamboo-sway` per instance and changing SVG `transform` attributes around explicit pivots.

- [ ] **Step 1: Add failing structure and motion assertions**

Assert that each layout contains one `.bamboo-sway`, the layout transforms use the approved coordinates, and `updateBambooIdle` calls `setAttribute("transform", ...)` with explicit stalk and leaf pivots.

- [ ] **Step 2: Run the verifier and confirm failure**

Run: `node C:/Users/robbin/.codex/visualizations/2026/08/07/019fda36-16bf-7662-9992-db7f4cc23fa5/panda-welcome-animation.verify.mjs`

Expected: failure for the missing `bamboo-sway` layer or explicit SVG transform attributes.

- [ ] **Step 3: Implement fixed layouts and explicit SVG rotations**

Use these fixed transforms:

```html
translate(18 128) scale(0.64) rotate(-7 120 455)
translate(238 310) scale(0.24) rotate(7 120 455)
translate(302 338) scale(0.18) rotate(-5 120 455)
```

Clone the shared template into `.bamboo-sway`. Animate the whole layer with `rotate(angle 120 455)`, leaf A with `rotate(angle 142 377)`, and leaf B with `rotate(angle 69 190)`. Use a ±3.8° stalk amplitude, ±10.5° leaf amplitude, per-instance phase offsets, and a 0.0012 radians-per-millisecond base rate.

- [ ] **Step 4: Synchronize the standalone preview**

Patch the matching escaped markup, CSS, constants, and JavaScript in `C:/Users/robbin/AppData/Local/Temp/panda-welcome-animation-preview.html` without changing its sandbox wrapper.

- [ ] **Step 5: Run final verification**

Run the verifier, the interface detector, original SVG SHA-256 checks, and `git diff --name-only -- apps/web`. Expected: all checks pass, original hashes match, and the app diff is empty.
