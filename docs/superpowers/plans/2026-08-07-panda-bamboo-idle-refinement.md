# Panda Bamboo Idle Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the isolated welcome preview with delayed panda visibility, richer idle motion, three animated bamboo instances, and strict line-breaking rules.

**Architecture:** Extend the existing self-contained visualization fragment and its Node verifier. Inline the immutable bamboo geometry once as a hidden symbol-like source, create three semantic SVG instances with separate stalk/leaf transform layers, and compose their idle motion into the existing persistent frame loop. Keep GSAP limited to text and bamboo entrance transforms.

**Tech Stack:** Inline SVG, JavaScript `requestAnimationFrame`, CSS, GSAP 3.13 core, Node.js static verification, Codex visualization renderer.

## Global Constraints

- Do not modify `apps/web`, `C:\AI4EDU\主页svg\panda.svg`, or `C:\AI4EDU\主页svg\bamboo.svg`.
- Preserve `bamboo.svg` SHA-256 `9745976372F13865661249C31C42072515156B9BEE936EC2BD9A3AAECA3A56D1`.
- Panda visibility changes at `PANDA_START_MS = 550`; reduced motion shows the final state immediately.
- Exactly three bamboo instances must derive from the supplied geometry.
- Bamboo stalks and leaves must have separate transform layers; leaf sway amplitude must exceed stalk sway.
- GSAP may animate bamboo entrance but must not own persistent character or bamboo idle loops.
- The title must remain one line; body copy may wrap only after the two commas.

---

### Task 1: Red Tests for the Increment

**Files:**
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.verify.mjs`
- Read: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`

**Interfaces:**
- Consumes: current fragment string `html` and existing `check(name, predicate)` helper.
- Produces: assertions for hidden panda, three bamboo instances, greater leaf amplitude, one-line title, comma-only wrap points, and protected SVG hashes.

- [ ] Add these assertions:

```js
check("hides panda before its landing starts", /panda-entry-shell[^>]*data-entrance-hidden/.test(html) && html.includes("setPandaVisible"));
check("renders exactly three bamboo instances", (html.match(/class="bamboo-instance/g) || []).length === 3);
check("keeps bamboo leaves independently animated", html.includes("bamboo-leaf-a") && html.includes("BAMBOO_LEAF_AMPLITUDE"));
check("keeps the title on one line", /panda-title[^}]*white-space:\s*nowrap/s.test(html));
check("limits body copy wraps to commas", (html.match(/<wbr\s*\/?/g) || []).length === 2 && (html.match(/class="copy-clause"/g) || []).length === 3);
```

- [ ] Run `node panda-welcome-animation.verify.mjs` and confirm the new assertions fail before implementation.

### Task 2: Delayed Panda Visibility and Richer Idle

**Files:**
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`

**Interfaces:**
- Consumes: `PANDA_START_MS`, `entranceStartedAt`, `entranceComplete`, `reducedMotion`, and the existing `tick(now)` loop.
- Produces: `setPandaVisible(visible)` and composed `idleSway`, `idleBreathe`, `idleBob` values.

- [ ] Make the initial SVG state flash-safe:

```html
<g id="panda-entry-shell" data-entrance-hidden="true" style="opacity:0;visibility:hidden">
```

```js
function setPandaVisible(visible) {
  pandaEntryShell.style.opacity = visible ? "1" : "0";
  pandaEntryShell.style.visibility = visible ? "visible" : "hidden";
  pandaEntryShell.dataset.entranceHidden = String(!visible);
}
```

- [ ] Gate visibility in the existing frame loop:

```js
const elapsed = now - entranceStartedAt;
setPandaVisible(reducedMotion.matches || elapsed >= PANDA_START_MS);
```

- [ ] Compose richer idle at the feet anchor:

```js
const idleSway = entranceComplete ? Math.sin(idlePhase * .82) * 1.15 : 0;
const idleBreathe = entranceComplete ? 1 + Math.sin(idlePhase * 1.7) * .006 : 1;
const idleBob = entranceComplete ? Math.sin(idlePhase * 1.28 + .35) * 2.5 : 0;
pandaRoot.style.transformOrigin = "50% 100%";
```

- [ ] Reset visibility to hidden on replay and visible-final for reduced motion; run the verifier until Task 1 assertions for panda visibility pass.

### Task 3: Three Bamboo Instances and Idle Sway

**Files:**
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`

**Interfaces:**
- Consumes: the supplied `241×475` bamboo geometry, `runTextIntro()`, reduced-motion state, and `tick(now)`.
- Produces: three `.bamboo-instance` groups, `.bamboo-stalk-motion`, `.bamboo-leaf-a`, `.bamboo-leaf-b`, and `updateBambooIdle(now)`.

- [ ] Inline one reusable semantic bamboo template while preserving every supplied path/rect coordinate:

```html
<g id="bamboo-template" class="bamboo-geometry" style="display:none">
  <g class="bamboo-stalk-motion">
    <path d="M38.4858 38.7855L85.807 21.8131C98.4834 73.5896 107.402 98.5951 124.552 140.431L77.2307 157.404C66.4327 109.526 58.2398 83.4506 38.4858 38.7855Z" fill="#C1D6AF"/>
    <rect width="59.419" height="20.5556" rx="10.2778" transform="matrix(0.929132 -0.333247 0.311551 0.95382 32.9414 35.2983)" fill="#C1D6AF"/>
    <rect width="59.419" height="20.5556" rx="10.2778" transform="matrix(0.929132 -0.333247 0.311551 0.95382 70.085 149.015)" fill="#C1D6AF"/>
    <path d="M86.3018 182.946L133.623 165.973C146.299 217.75 155.218 242.755 172.368 284.591L125.047 301.564C114.249 253.687 106.056 227.611 86.3018 182.946Z" fill="#C1D6AF"/>
    <rect width="59.419" height="20.5556" rx="10.2778" transform="matrix(0.929132 -0.333246 0.311551 0.95382 80.7573 179.458)" fill="#C1D6AF"/>
    <rect width="59.419" height="20.5556" rx="10.2778" transform="matrix(0.929132 -0.333247 0.311551 0.95382 117.901 293.175)" fill="#C1D6AF"/>
    <path d="M136.437 325.956L181.187 309.906C194.294 362.294 203.288 387.656 220.459 430.138L175.709 446.188C164.469 397.765 156.145 371.342 136.437 325.956Z" fill="#C1D6AF"/>
    <rect width="56.1911" height="20.8351" rx="10.4176" transform="matrix(0.929132 -0.333246 0.311551 0.95382 131.085 322.326)" fill="#C1D6AF"/>
    <rect width="56.1911" height="20.8351" rx="10.4176" transform="matrix(0.929132 -0.333247 0.311551 0.95382 168.734 437.589)" fill="#C1D6AF"/>
  </g>
  <path class="bamboo-leaf-a" d="M27.802 356.901C28.0613 354.446 30.0801 352.709 32.52 352.841L76.9301 355.257C83.9754 355.64 91.0123 356.959 97.8632 359.182L141.968 373.494C143.814 374.093 145.044 375.971 144.843 377.882C144.639 379.805 143.05 381.16 141.138 381.039L91.3019 377.892C87.2806 377.638 83.264 376.956 79.3173 375.858L31.7004 362.6C29.2268 361.912 27.5341 359.437 27.802 356.901Z" fill="#C1D6AF"/>
  <path class="bamboo-leaf-b" d="M15.2477 169.153C15.9689 166.833 18.0956 165.536 20.3933 166.015L37.6215 169.608C43.8591 170.908 49.8863 173.809 55.2043 178.068L70.594 190.395C72.1413 191.634 72.83 193.798 72.2604 195.631C71.6837 197.486 69.9708 198.51 68.1361 198.097L46.3555 193.186C42.6785 192.357 39.1035 190.771 35.8232 188.513L17.693 176.032C15.5172 174.534 14.4811 171.62 15.2477 169.153Z" fill="#C1D6AF"/>
</g>
```

- [ ] Create exactly three transformed instances:

```html
<g class="bamboo-instance bamboo-large" data-phase="0"></g>
<g class="bamboo-instance bamboo-small-a" data-phase="1.7"></g>
<g class="bamboo-instance bamboo-small-b" data-phase="3.2"></g>
```

```js
bambooInstances.forEach((instance) => {
  const geometry = bambooTemplate.cloneNode(true);
  geometry.removeAttribute("id");
  geometry.style.display = "";
  instance.append(geometry);
});
```

- [ ] Define desktop/mobile positions in CSS so the large instance sits at the far left and the two small instances sit below the title without covering text.

- [ ] Add bamboo entrance to the existing GSAP timeline:

```js
timeline.fromTo(".bamboo-instance",
  { opacity: 0, y: 14, scale: .9 },
  { opacity: 1, y: 0, scale: 1, duration: .68, stagger: .12, ease: "power2.out" },
  0);
```

- [ ] Compose persistent bamboo motion into `tick(now)`:

```js
const BAMBOO_STALK_AMPLITUDE = 2.2;
const BAMBOO_LEAF_AMPLITUDE = 6.2;
function updateBambooIdle(now) {
  bambooInstances.forEach((instance, index) => {
    const phase = now * .00072 + Number(instance.dataset.phase);
    instance.querySelector(".bamboo-stalk-motion").style.transform = `rotate(${Math.sin(phase) * BAMBOO_STALK_AMPLITUDE}deg)`;
    instance.querySelector(".bamboo-leaf-a").style.transform = `rotate(${Math.sin(phase + .6) * BAMBOO_LEAF_AMPLITUDE}deg)`;
    instance.querySelector(".bamboo-leaf-b").style.transform = `rotate(${Math.sin(phase + 1.1) * -BAMBOO_LEAF_AMPLITUDE * .82}deg)`;
  });
}
```

- [ ] Disable bamboo transforms under reduced motion and run the verifier until all bamboo assertions pass.

### Task 4: Strict Text Wrapping, Packaging, and Protection Checks

**Files:**
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.verify.mjs`
- Create: `C:\Users\robbin\AppData\Local\Temp\panda-welcome-animation-preview.html`

**Interfaces:**
- Consumes: completed fragment and verifier.
- Produces: directly openable standalone preview.

- [ ] Enforce title and copy rules:

```css
.panda-title { white-space: nowrap; font-size: clamp(1.42rem, 4.35vw, 3.7rem); }
.copy-clause { white-space: nowrap; }
```

```html
<span class="copy-clause">上传题目图片，</span><wbr>
<span class="copy-clause">熊猫会帮你理清当时错误思路，</span><wbr>
<span class="copy-clause">陪你梳理真实思考逻辑顺序！</span>
```

- [ ] Run the complete verifier and require exit code `0` with all legacy and new checks passing.

- [ ] Render the standalone file with `visualize/scripts/render.py` and verify it is non-empty.

- [ ] Verify `panda.svg` SHA-256 is `7C952B906A6330BE3F8AB8DDFEA81405C835FA74439375954ED225CEFC36ADDA`, `bamboo.svg` SHA-256 is `9745976372F13865661249C31C42072515156B9BEE936EC2BD9A3AAECA3A56D1`, and zero `apps/web` diff/status paths are reported.
