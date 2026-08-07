# Bamboo Proportion and Copy Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore uniform bamboo proportions and shift the desktop welcome copy toward the panda.

**Architecture:** Correct the bamboo canvas coordinate mapping instead of modifying path geometry. Apply one responsive translation to the existing copy wrapper and remove it at the narrow breakpoint.

**Tech Stack:** Inline SVG, CSS, Node static verifier.

## Global Constraints

- Modify only the visualization fragment, its verifier, and the standalone preview.
- Preserve all three bamboo transforms and animation parameters.
- Preserve the original SVG files and keep `apps/web` unchanged.

---

### Task 1: Correct Bamboo Proportions and Copy Alignment

**Files:**
- Modify: `C:/Users/robbin/.codex/visualizations/2026/08/07/019fda36-16bf-7662-9992-db7f4cc23fa5/panda-welcome-animation.verify.mjs`
- Modify: `C:/Users/robbin/.codex/visualizations/2026/08/07/019fda36-16bf-7662-9992-db7f4cc23fa5/panda-welcome-animation.html`
- Modify: `C:/Users/robbin/AppData/Local/Temp/panda-welcome-animation-preview.html`

**Interfaces:**
- Consumes: `.bamboo-decor`, `.panda-copy`, and the existing `@media (max-width: 720px)` block.
- Produces: uniform bamboo viewport mapping and a responsive copy offset.

- [ ] **Step 1: Add failing verifier assertions**

Assert that `.bamboo-decor` uses `preserveAspectRatio="xMinYMin meet"`, `.panda-copy` uses `translateX(clamp(28px, 3.8vw, 46px))`, and the narrow breakpoint resets that translation to zero.

- [ ] **Step 2: Confirm the assertions fail**

Run the visualization verifier and expect failure at the new bamboo proportion assertion.

- [ ] **Step 3: Implement the fragment changes**

Replace only the bamboo canvas aspect-ratio mode. Add the desktop copy translation and its `max-width: 720px` reset without changing text, grid columns, or bamboo instance transforms.

- [ ] **Step 4: Synchronize the standalone preview**

Patch the matching escaped SVG markup and CSS inside the existing sandbox wrapper.

- [ ] **Step 5: Verify the complete preview**

Run all static checks, standalone syntax checks, the interface detector, original SVG hashes, and the `apps/web` diff check.
