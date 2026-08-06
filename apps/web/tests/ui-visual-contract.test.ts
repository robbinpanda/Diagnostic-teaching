import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(resolve(__dirname, `../../../${path}`));
const text = (path: string) => source(path).toString("utf8");
const sha256 = (path: string) => createHash("sha256")
  .update(text(path).replace(/\r\n/g, "\n"), "utf8")
  .digest("hex")
  .toUpperCase();

const frozenFiles = new Map([
  ["components/StudyCardModal.tsx", "402310A5E188AF80806CD6627BC8E79F76607177F2B6567B2217C2DCF2090718"],
  ["components/workspace/CardShelfTabs.tsx", "C08002FDF3A7D714CDDC115BB0DF60C66F3BAD758E4AEF53717C9BAFA4872B9B"],
  ["components/workspace/StudyCardSidebar.tsx", "2785AAFA07648E5E11EFD2F7B4E42A8C7440BD31E8C38FDB9EB0A678F7FF59A0"],
  ["hooks/useStudyCards.ts", "757676B985C123E0B48FF3A058A8A0810192720BBEEABD9621E53C83647A59DD"],
  ["hooks/useSessionRuntime.ts", "341432A79637CC7DD2C0CD1E17D52B146DC4CBAEEC86A9D2D70D477378863775"]
]);

test("card behavior sources stay byte-identical", () => {
  for (const [path, expected] of frozenFiles) {
    assert.equal(sha256(path), expected, path);
  }
});

test("card shelf geometry and slide timing stay unchanged", () => {
  const shell = text("styles/shell.css");
  const conversation = text("styles/conversation.css");

  assert.match(
    shell,
    /\.cardShelfTabs button\s*\{[\s\S]*?width:\s*66px;[\s\S]*?height:\s*128px;[\s\S]*?margin-top:\s*-28px;[\s\S]*?\}/
  );
  assert.match(
    shell,
    /\.cardShelfTabs button\.firstKnowledgeTab\s*\{[\s\S]*?margin-top:\s*32px;[\s\S]*?\}/
  );
  assert.match(
    conversation,
    /shelfCardOpen 480ms cubic-bezier\(0\.22, 0\.82, 0\.24, 1\)/
  );
  assert.match(
    conversation,
    /shelfCardClose 440ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/
  );
  assert.match(
    conversation,
    /@keyframes activeCardDockEnter[\s\S]*translate3d\(100vw,/
  );
});

test("problem flashcards preserve the original back-face teaching fields", () => {
  const modal = text("components/StudyCardModal.tsx");

  assert.match(
    modal,
    /<section>\s*<h3>\{flashcard \? <Lightbulb size=\{15\} \/> : null\}如何想到这些步骤<\/h3>\s*<TextList items=\{currentCard\.content\.how_to_think\} \/>\s*<\/section>/
  );
  assert.doesNotMatch(
    modal,
    /\{!flashcard \? <section>[\s\S]*?how_to_think[\s\S]*?<\/section> : null\}/
  );
});

test("C4 bright atrium tokens, folders, and ambient grain are wired", () => {
  const layout = text("app/layout.tsx");
  const base = text("styles/base.css");
  const shell = text("styles/shell.css");
  const cards = text("styles/cards.css");

  assert.match(layout, /31d2d748/);
  assert.match(base, /--stage-ink:\s*#12371f/i);
  assert.match(base, /--stage-sage:\s*#63ad50/i);
  assert.match(base, /--stage-lavender:\s*#b7a8d4/i);
  assert.match(base, /--stage-lavender-deep:\s*#9e8bc4/i);
  assert.match(base, /--stage-lavender-soft:\s*#eae4f5/i);
  assert.match(base, /--stage-yellow:\s*#e9b72d/i);
  assert.match(base, /--stage-yellow-soft:\s*#fff0a8/i);
  assert.match(base, /--stage-yellow-ink:\s*#765400/i);
  assert.match(base, /rgba\(105, 204, 105, 0\.68\)/);
  assert.match(base, /rgba\(183, 168, 212, 0\.58\)/);
  assert.match(base, /linear-gradient\(122deg, #c6edc3 0%, #fffce9 51%, #eae4f5 100%\)/i);
  assert.match(base, /url\(["']?\/ambient-grain\.webp/);
  assert.match(
    cards,
    /\.cardIcon\.problem\s*\{[\s\S]*?color:\s*var\(--stage-yellow-ink\);[\s\S]*?background:\s*var\(--stage-yellow-soft\);/
  );
  assert.match(
    cards,
    /\.cardFolderItem\s*\{[\s\S]*?border:\s*1px solid color-mix\(in srgb, var\(--stage-yellow\) 34%, white\);[\s\S]*?background:\s*color-mix\(in srgb, var\(--stage-yellow-soft\) 72%, white\);/
  );
  assert.doesNotMatch(shell, /\.appShell\s*\{[^}]*\b(?:transform|filter):/);
  assert.doesNotMatch(shell, /\.conversationPanel\s*\{[^}]*\b(?:transform|filter):/);
});

test("desktop shell uses the approved atrium proportions", () => {
  const shell = text("styles/shell.css");

  assert.match(
    shell,
    /\.appShell\s*\{[\s\S]*?width:\s*calc\(100vw - \(var\(--shell-inset\) \* 2\)\)/
  );
  assert.match(
    shell,
    /grid-template-columns:\s*260px minmax\(0, 1fr\) 312px/
  );
  assert.match(shell, /border-radius:\s*var\(--shell-radius\)/);
});

test("conversation keeps measurement hooks while using the bright stage", () => {
  const css = text("styles/conversation.css");

  assert.match(
    css,
    /\.messageViewport\s*\{[\s\S]*?background:\s*var\(--stage-canvas\)/
  );
  assert.match(
    css,
    /\.messageColumn\s*\{[\s\S]*?width:\s*min\(920px, 100%\)/
  );
  assert.match(
    css,
    /\.composerCard\s*\{[\s\S]*?backdrop-filter:\s*blur\(16px\)/
  );
  assert.match(
    css,
    /\.activeKnowledgeCardDock\.shelfTransitionDock\s*\{[\s\S]*?animation:\s*none/
  );
});

test("medium widths use full drawers and preserve responsive card flow", () => {
  const css = text("styles/responsive.css");
  const page = text("app/page.tsx");
  const timeline = text("components/workspace/MessageTimeline.tsx");

  assert.match(css, /@media \(max-width: 1319px\) and \(min-width: 761px\)/);
  assert.match(
    css,
    /\.sessionSidebar\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?height:\s*auto;[\s\S]*?width:\s*min\(292px, 88vw\)/
  );
  assert.match(
    css,
    /\.cardSidebar\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?height:\s*auto;[\s\S]*?width:\s*min\(330px, 88vw\)/
  );
  assert.match(page, /matchMedia\("\(max-width: 1319px\)"\)/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /env\(safe-area-inset-top, 0px\)/);
  assert.match(css, /env\(safe-area-inset-bottom, 0px\)/);
  assert.doesNotMatch(css, /\.leftClosed \.sessionSidebar\s*\{[^}]*visibility:\s*visible/);
  assert.doesNotMatch(css, /\.rightClosed \.cardSidebar\s*\{[^}]*visibility:\s*visible/);
  assert.match(
    css,
    /@media \(min-width: 761px\) and \(max-width: 900px\)[\s\S]*?\.activeKnowledgeCardDock\s*\{[\s\S]*?position:\s*relative/
  );
  assert.match(timeline, /matchMedia\("\(max-width: 900px\)"\)/);
});

test("shelf card state machine transfers focus and restores the source trigger", () => {
  const page = text("app/page.tsx");

  assert.match(
    page,
    /type ShelfCardTransitionPhase = "idle" \| "preparing" \| "opening" \| "open" \| "closing"/
  );
  assert.match(
    page,
    /flushSync\(\(\) => \{[\s\S]*?setShelfCardTransitionPhase\("preparing"\)/
  );
  assert.match(page, /shelfCardOriginRef\.current = origin/);
  assert.match(page, /knowledgeCardDockRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(page, /setShelfCardTransitionPhase\("opening"\)/);
  assert.match(page, /setShelfCardTransitionPhase\("open"\)/);
  assert.match(page, /setShelfCardTransitionPhase\("closing"\)/);
  assert.match(page, /setShelfCardTransitionPhase\("idle"\)/);
  assert.match(page, /event\.target !== event\.currentTarget/);
  assert.match(page, /shelfCardTriggerRef/);
  assert.match(page, /querySelector<HTMLElement>\('\[aria-label="关闭卡片"\]'\)/);
  assert.match(page, /restoreShelfCardFocus\(\)/);
  assert.match(page, /inert=\{displayedDockCardIsArchived && shelfCardTransitionPhase === "closing"/);
});

test("production build keeps the direction contract injector wired", () => {
  const layout = text("app/layout.tsx");
  const packageJson = text("package.json");
  const injector = text("scripts/inject-design-contract.mjs");

  for (const marker of ["THESIS:", "OWN-WORLD:", "STORY:", "FIRST VIEWPORT:", "FORM:", "FINISH:"]) {
    assert.match(layout, new RegExp(marker));
  }
  assert.match(layout, /focus-light-a-luminous-atrium/);
  assert.match(layout, /31d2d748/);
  assert.match(packageJson, /next build && node scripts\/inject-design-contract\.mjs/);
  assert.match(injector, /directionContract/);
});

test("history workspace reuses C4 tokens and responsive paper grids", () => {
  const globals = text("app/globals.css");
  const history = text("styles/history.css");
  const responsive = text("styles/responsive.css");
  const shell = text("styles/shell.css");

  assert.match(
    globals,
    /@import "\.\.\/styles\/conversation\.css";[\s\S]*?@import "\.\.\/styles\/history\.css";[\s\S]*?@import "\.\.\/styles\/cards\.css";/
  );
  assert.match(
    globals,
    /@import "\.\.\/styles\/history\.css";[\s\S]*?@import "\.\.\/styles\/responsive\.css";/
  );
  assert.doesNotMatch(history, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(history, /var\(--warning/);
  assert.doesNotMatch(history, /\.titleMathText\b/);
  assert.doesNotMatch(history, /@font-face|@import|url\(/i);
  assert.match(history, /\.historyPaperCoverTitle\s*\{/);
  assert.match(history, /\.historyPaperPreview\s*\{[\s\S]*?aspect-ratio:\s*8\s*\/\s*5/);
  assert.match(
    history,
    /\.historyWorkspaceHeader\.historyWorkspaceHeaderDetail\s*\{[\s\S]*?width:\s*min\(1184px,\s*100%\)/
  );
  assert.match(
    history,
    /\.historyWorkspaceBack\s*\{[\s\S]*?width:\s*44px;[\s\S]*?min-width:\s*44px;[\s\S]*?flex:\s*0 0 44px;[\s\S]*?padding:\s*0;/
  );
  assert.match(
    history,
    /\.historyWorkspaceSearch input:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--primary-700\);[\s\S]*?outline-offset:\s*-?\d+px;/
  );
  assert.match(
    history,
    /\.historyWorkspaceBodyInner\s*\{[\s\S]*?animation:\s*historyWorkspaceEnter 180ms var\(--ease-standard\) both;/
  );
  assert.match(
    history,
    /@keyframes historyWorkspaceEnter\s*\{[\s\S]*?from\s*\{[\s\S]*?opacity:\s*0\.78;[\s\S]*?transform:\s*translateY\(6px\);[\s\S]*?to\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none;/
  );

  for (const token of [
    "--stage-canvas",
    "--stage-line",
    "--stage-forest",
    "--stage-sage",
    "--stage-sage-soft",
    "--stage-yellow",
    "--stage-yellow-soft",
    "--stage-lavender-deep"
  ]) {
    assert.match(history, new RegExp(`var\\(${token}\\)`));
  }

  assert.match(
    history,
    /\.historyPaperGrid\s*\{[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    responsive,
    /@media \(max-width: 1100px\) and \(min-width: 761px\)[\s\S]*?\.historyPaperGrid\s*\{[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/
  );
  assert.match(
    responsive,
    /@media \(max-width: 760px\)[\s\S]*?\.historyPaperGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/
  );
  assert.match(
    history,
    /\.historyQuestionDelete\s*\{[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px/
  );
  assert.match(
    shell,
    /\.historyTreeToggle\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/
  );
  assert.match(
    shell,
    /\.paperGroupButton\s*\{[\s\S]*?min-height:\s*44px/
  );
  assert.match(
    responsive,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.historyPaperCard\s*\{[\s\S]*?transform:\s*none[\s\S]*?\.historySkeletonGrid\s*\{[\s\S]*?animation:\s*none/
  );
  assert.match(
    responsive,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.historyWorkspaceBodyInner\s*\{[\s\S]*?animation:\s*none[\s\S]*?transform:\s*none/
  );

  for (const [path, expected] of frozenFiles) {
    assert.equal(sha256(path), expected, path);
  }
});
