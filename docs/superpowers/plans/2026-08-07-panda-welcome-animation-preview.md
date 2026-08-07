# Panda Welcome Animation Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the isolated panda welcome preview so the book lands first, the panda follows with layered spring inertia, and the reference typography/background are reproduced without changing production code or the original SVG.

**Architecture:** Keep one self-contained HTML fragment in the Codex visualization directory. Inline the source SVG paths once, organize them into semantic transform groups, drive character motion with one persistent `requestAnimationFrame` loop, and use GSAP only for text. Render a standalone HTML copy into the Windows temp directory for direct browser viewing.

**Tech Stack:** Inline SVG, JavaScript `requestAnimationFrame`, CSS, GSAP 3.13 core, Node.js static verification, Codex visualization renderer.

## Global Constraints

- Do not modify `apps/web` or `C:\AI4EDU\主页svg\panda.svg`.
- Use the local font family `爱点排排刷` / `Aidian Paipaishua`, sourced from `AiDianPaiPaiShua-2.ttf`, with a Chinese bold fallback.
- The background must be one flat warm ivory color; no CSS or SVG gradient declarations.
- Halftone decoration must use SVG circles/patterns, and paper texture must use low-opacity `feTurbulence`.
- Character animation must not target SVG character nodes through GSAP.
- GSAP may target only title characters and description lines.
- Pointer tracking starts only after landing completes and returns to neutral with damping.
- Support `prefers-reduced-motion`, 1024px, 736px, and 360px layouts.

---

### Task 1: Reference-Matched Layout, Font, and Texture

**Files:**
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`
- Test: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.verify.mjs`

**Interfaces:**
- Consumes: the 19 paths and two filters from `C:\AI4EDU\主页svg\panda.svg`.
- Produces: `#panda-welcome-preview`, `.welcome-copy`, `#panda-stage`, `.title-char`, `.description-line`, and `#replay-animation` for later tasks.

- [ ] **Step 1: Write the failing static assertions**

```js
assert(html.includes('font-family: "Aidian Paipaishua"'));
assert(html.includes('今天你想要解决什么问题？'));
assert(!/gradient/i.test(stripComments(html)));
assert(html.includes('feTurbulence'));
assert(html.includes('class="halftone-layer"'));
```

- [ ] **Step 2: Run the verifier and confirm the old preview fails**

Run: `node panda-welcome-animation.verify.mjs`

Expected: non-zero exit with missing font/reference copy or forbidden gradient usage.

- [ ] **Step 3: Replace the preview composition**

Implement a two-column welcome surface with the exact approved copy, local `@font-face`, flat `#F7F4EA` background, explicit SVG halftone circles, and a low-opacity `feTurbulence` overlay. Remove example chips, composer mock, cards, and glow shapes. Keep the small `panda` wordmark centered near the top.

```html
<section id="panda-welcome-preview">
  <span class="panda-wordmark">panda</span>
  <div class="welcome-copy">
    <h1 aria-label="今天你想要解决什么问题？"><span class="title-char">今</span>…</h1>
    <p><span class="description-line">上传题目图片，熊猫会帮你理清当时错误思路，陪你梳理</span><span class="description-line">真实思考逻辑顺序！</span></p>
  </div>
  <div id="panda-stage"><svg><!-- semantic groups + original paths --></svg></div>
  <svg class="halftone-layer" aria-hidden="true"><!-- explicit circle fields --></svg>
</section>
```

```css
@font-face { font-family: "Aidian Paipaishua"; src: local("爱点排排刷"), local("Aidian Paipaishua"); }
#panda-welcome-preview { background: #f7f4ea; display: grid; grid-template-columns: minmax(0, 1.16fr) minmax(320px, .84fr); }
.welcome-copy h1 { font-family: "Aidian Paipaishua", "Microsoft YaHei", sans-serif; }
```

- [ ] **Step 4: Add responsive layout rules**

At widths below `720px`, stack `.welcome-copy` above `#panda-stage`, keep the title at a readable size using `clamp()`, and prevent horizontal overflow at `360px`.

```css
@media (max-width: 720px) {
  #panda-welcome-preview { grid-template-columns: 1fr; overflow-x: clip; }
  .welcome-copy h1 { font-size: clamp(2rem, 10vw, 3.25rem); }
  #panda-stage { width: min(92vw, 520px); }
}
```

- [ ] **Step 5: Run the static assertions**

Run: `node panda-welcome-animation.verify.mjs`

Expected: layout, font, copy, texture, and no-gradient assertions pass.

### Task 2: Layered Book and Panda Spring Landing

**Files:**
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.verify.mjs`

**Interfaces:**
- Consumes: `#book-root`, `#book-shadow`, `#panda-root`, `#panda-head`, `#ear-left`, `#ear-right`, `#arm-left`, `#arm-right`, and `#panda-cast-shadow`.
- Produces: `createSpring(config)`, `resetEntrance(now)`, `sampleEntrance(now)`, and `entranceComplete`.

- [ ] **Step 1: Add failing motion-structure assertions**

```js
assert(html.includes('function createSpring'));
assert(html.includes('const BOOK_START_MS = 0'));
assert(html.includes('const PANDA_START_MS = 550'));
assert(html.includes('earLag'));
assert(!/gsap[^\n]*(panda-root|book-root|ear-left|ear-right)/i.test(html));
```

- [ ] **Step 2: Verify the assertions fail before implementation**

Run: `node panda-welcome-animation.verify.mjs`

Expected: non-zero exit for missing spring functions and timing constants.

- [ ] **Step 3: Implement the spring sampler**

Create a deterministic damped oscillator sampler returning displacement and velocity. Use separate stiffness/damping profiles for the book, panda body, head, arms, and ears. Clamp the animation delta to `32ms` so tab restoration cannot cause a physics jump.

```js
function createSpring({ value, target = 0, velocity = 0, stiffness, damping, mass = 1 }) {
  return { value, target, velocity, stiffness, damping, mass };
}
function stepSpring(spring, dtSeconds) {
  const force = -spring.stiffness * (spring.value - spring.target) - spring.damping * spring.velocity;
  spring.velocity += (force / spring.mass) * dtSeconds;
  spring.value += spring.velocity * dtSeconds;
}
const dt = Math.min((now - previousNow) / 1000, 0.032);
```

- [ ] **Step 4: Implement the book landing**

Start the book 140px above its resting position. On first contact, combine vertical displacement with squash/stretch and shadow compression; allow two decaying rebounds before rest.

```js
const BOOK_START_MS = 0;
const bookSpring = createSpring({ value: -140, velocity: 0, stiffness: 205, damping: 17 });
const bookImpact = Math.min(Math.abs(bookSpring.velocity) / 900, 1);
bookRoot.style.transform = `translateY(${bookSpring.value}px) scale(${1 + bookImpact * .045}, ${1 - bookImpact * .07})`;
bookShadow.style.transform = `scale(${1 - bookImpact * .14})`;
```

- [ ] **Step 5: Implement the panda and appendage landing**

Start the panda at `550ms`, 155px above rest. Derive body squash from downward velocity, then feed a delayed body impulse into head, arm, rear-leg, and ear springs. Set ear delay/amplitude above arm and head values so the ears visibly lag and overshoot without separating from the head.

```js
const PANDA_START_MS = 550;
const earLag = { delayMs: 105, stiffness: 165, damping: 10, amplitude: 1.34 };
const armLag = { delayMs: 72, stiffness: 185, damping: 13, amplitude: .82 };
const headLag = { delayMs: 48, stiffness: 195, damping: 15, amplitude: .48 };
const pandaSquash = Math.min(Math.max(pandaSpring.velocity, 0) / 1100, 1);
pandaRoot.style.transform = `translateY(${pandaSpring.value}px) scale(${1 + pandaSquash * .055}, ${1 - pandaSquash * .09})`;
```

- [ ] **Step 6: Add replay and reduced-motion behavior**

`resetEntrance(performance.now())` must reset positions, velocities, text state, and pointer enablement without replacing SVG nodes. Reduced-motion mode must jump to the final state and mark `entranceComplete = true`.

```js
function resetEntrance(now) {
  entranceStartedAt = now;
  pointerEnabled = false;
  entranceComplete = reducedMotion.matches;
  resetSpring(bookSpring, reducedMotion.matches ? 0 : -140);
  resetSpring(pandaSpring, reducedMotion.matches ? 0 : -155);
  runTextIntro();
}
```

- [ ] **Step 7: Run motion-structure assertions**

Run: `node panda-welcome-animation.verify.mjs`

Expected: spring/timing assertions pass and no GSAP character target is found.

### Task 3: Slow Text Reveal, Idle Motion, and Pointer Tracking

**Files:**
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`
- Modify: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.verify.mjs`

**Interfaces:**
- Consumes: `.title-char`, `.description-line`, `entranceComplete`, and the persistent animation frame state.
- Produces: `runTextIntro()`, `updatePointerTarget(event)`, `pointerEnabled`, and a single `tick(now)` loop.

- [ ] **Step 1: Add failing text/interaction assertions**

```js
assert(html.includes('stagger: 0.1'));
assert(html.includes('pointerEnabled'));
assert(html.includes('if (!entranceComplete)'));
assert(html.includes('prefers-reduced-motion'));
assert((html.match(/requestAnimationFrame\(/g) || []).length <= 2);
```

- [ ] **Step 2: Verify the assertions fail before implementation**

Run: `node panda-welcome-animation.verify.mjs`

Expected: non-zero exit for missing approved text timing or pointer gating.

- [ ] **Step 3: Implement the GSAP text intro**

Animate title characters from `y: 18`, `opacity: 0`, `filter: blur(5px)`, and a maximum `2deg` rotation to neutral over about `0.72s`, staggered by `0.1s`. Reveal the two description lines after the title with a slower `y/opacity` transition. Keep title hover movement below 4px.

```js
function runTextIntro() {
  const timeline = gsap.timeline();
  timeline.fromTo(".title-char",
    { y: 18, opacity: 0, filter: "blur(5px)", rotate: () => gsap.utils.random(-2, 2) },
    { y: 0, opacity: 1, filter: "blur(0px)", rotate: 0, duration: .72, stagger: .1, ease: "power2.out" });
  timeline.fromTo(".description-line", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: .72, stagger: .18 }, "-=.15");
}
```

- [ ] **Step 4: Compose idle motion into the persistent loop**

After landing, add low-amplitude body breathing, head bob, ear relaxation, and randomized blink scheduling. Compose these transforms with settled entrance transforms rather than creating a second loop.

```js
const idlePhase = now * 0.001;
const breatheY = entranceComplete ? Math.sin(idlePhase * 1.7) * 1.6 : 0;
const headBob = entranceComplete ? Math.sin(idlePhase * 1.35 + .6) * 1.1 : 0;
// Compose breatheY/headBob into the same transforms written by tick(now).
requestAnimationFrame(tick);
```

- [ ] **Step 5: Gate and damp pointer tracking**

Ignore pointer movement until `entranceComplete`. Map the pointer to normalized welcome-region coordinates; apply a smaller range to the head and a larger range to the eye dots. On pointer leave, set targets to zero and use exponential damping in `tick(now)`.

```js
function updatePointerTarget(event) {
  if (!entranceComplete) return;
  const rect = surface.getBoundingClientRect();
  pointerTarget.x = ((event.clientX - rect.left) / rect.width - .5) * 2;
  pointerTarget.y = ((event.clientY - rect.top) / rect.height - .5) * 2;
}
pointer.x += (pointerTarget.x - pointer.x) * (1 - Math.exp(-dt * 7));
pointer.y += (pointerTarget.y - pointer.y) * (1 - Math.exp(-dt * 7));
```

- [ ] **Step 6: Run all static assertions**

Run: `node panda-welcome-animation.verify.mjs`

Expected: all assertions pass.

### Task 4: Package and Verify the Standalone Preview

**Files:**
- Read: `C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html`
- Create: `C:\Users\robbin\AppData\Local\Temp\panda-welcome-animation-preview.html`
- Read: `C:\AI4EDU\主页svg\panda.svg`

**Interfaces:**
- Consumes: the completed fragment and verifier.
- Produces: a directly openable standalone HTML preview at the stable temp path.

- [ ] **Step 1: Run the complete verifier**

Run: `node panda-welcome-animation.verify.mjs`

Expected: exit code 0 with every assertion reported as passed.

- [ ] **Step 2: Render the standalone HTML**

Run the visualization `render.py` script with the fragment as input and `C:\Users\robbin\AppData\Local\Temp\panda-welcome-animation-preview.html` as output.

```powershell
python C:\Users\robbin\.codex\plugins\cache\openai-bundled\visualize\1.0.19\skills\visualize\scripts\render.py `
  C:\Users\robbin\.codex\visualizations\2026\08\07\019fda36-16bf-7662-9992-db7f4cc23fa5\panda-welcome-animation.html `
  C:\Users\robbin\AppData\Local\Temp\panda-welcome-animation-preview.html
```

- [ ] **Step 3: Verify artifacts and protected files**

Confirm the standalone HTML exists and is non-empty, the original SVG SHA-256 remains `7C952B906A6330BE3F8AB8DDFEA81405C835FA74439375954ED225CEFC36ADDA`, and `git diff --name-only -- apps/web` returns no paths.

- [ ] **Step 4: Inspect responsive and reduced-motion states**

Check the full composition at 1024px, 736px, and 360px; confirm no clipping or horizontal scrolling and confirm reduced-motion mode presents the final readable state immediately.

- [ ] **Step 5: Deliver the stable preview link**

Return the local temp-file link using forward slashes so the in-app browser resolves `C:/Users/robbin/...` correctly.
