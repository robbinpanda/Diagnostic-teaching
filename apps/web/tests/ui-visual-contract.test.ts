import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const text = (path: string) => readFileSync(resolve(__dirname, `../../../${path}`), "utf8");

test("card hooks preserve race guards and delegate run state to tested primitives", () => {
  const cardsHook = text("hooks/useStudyCards.ts");
  const runtimeHook = text("hooks/useSessionRuntime.ts");

  assert.match(cardsHook, /requestId !== cardsRequestRef\.current/);
  assert.match(cardsHook, /cardsMutationId === cardsMutationRef\.current/);
  assert.match(cardsHook, /foldersMutationId === foldersMutationRef\.current/);
  assert.match(cardsHook, /setViewingCard\(\(current\) => current && deletedIds\.has\(current\.id\) \? null : current\)/);
  assert.match(runtimeHook, /new StreamController\(\)/);
  assert.match(runtimeHook, /cancelAll\("unmount"\)/);
  assert.match(runtimeHook, /sessionWorkflowReducer/);
  assert.match(runtimeHook, /timelineReducer/);
  assert.match(runtimeHook, /createStreamEventAdapter/);
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

test("panda ivory canvas, folders, and ambient grain are wired", () => {
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
  assert.match(base, /--panda-canvas:\s*#f7f4ea/i);
  assert.match(base, /--stage-canvas:\s*var\(--panda-canvas\)/i);
  assert.match(base, /body\s*\{[\s\S]*?background:\s*var\(--panda-canvas\)/i);
  assert.doesNotMatch(base, /linear-gradient\(122deg, #c6edc3/i);
  assert.match(base, /url\(["']?\/ambient-grain\.webp/);
  assert.match(cards, /\.cardSidebar\s*\{[\s\S]*?background:\s*var\(--panda-canvas\)/);
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

test("desktop shell keeps the atrium proportions with a bounded resizable sidebar", () => {
  const shell = text("styles/shell.css");
  const responsive = text("styles/responsive.css");
  const page = text("app/page.tsx");
  const sidebarHook = text("hooks/useResizableSidebar.ts");

  assert.match(
    shell,
    /\.appShell\s*\{[\s\S]*?width:\s*calc\(100vw - \(var\(--shell-inset\) \* 2\)\)/
  );
  assert.match(
    shell,
    /grid-template-columns:\s*var\(--sidebar-width\) minmax\(0, 1fr\)/
  );
  assert.match(shell, /border-radius:\s*var\(--shell-radius\)/);
  assert.match(
    shell,
    /\.sidebarResizeHandle\s*\{[\s\S]*?left:\s*var\(--sidebar-width\);[\s\S]*?cursor:\s*col-resize;[\s\S]*?touch-action:\s*none;/
  );
  assert.match(page, /role="separator"[\s\S]*?aria-valuemin=\{minSidebarWidth\}[\s\S]*?aria-valuemax=\{sidebarMaxWidth\}/);
  assert.match(page, /onPointerDown=\{handleSidebarResizePointerDown\}/);
  assert.match(page, /onKeyDown=\{handleSidebarResizeKeyDown\}/);
  assert.match(page, /useResizableSidebar\(\)/);
  assert.match(sidebarHook, /new ResizeObserver\(syncSidebarBounds\)/);
  assert.match(sidebarHook, /clampSidebarWidth\(sidebarPreferredWidthRef\.current, shell\.clientWidth\)/);
  assert.match(
    responsive,
    /@media \(max-width: 1319px\)\s*\{[\s\S]*?\.sidebarResizeHandle\s*\{[\s\S]*?display:\s*none;/
  );
});

test("sidebar hover motion cannot create a horizontal scrollbar", () => {
  const shell = text("styles/shell.css");

  assert.match(
    shell,
    /\.primaryNavigation\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/
  );
  assert.match(
    shell,
    /\.primaryNavigation \.primaryNavButton:hover\s*\{[\s\S]*?transform:\s*translateX\(2px\);/
  );
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

test("medium widths keep the session drawer and remove the card-library drawer", () => {
  const css = text("styles/responsive.css");
  const page = text("app/page.tsx");
  const timeline = text("components/workspace/MessageTimeline.tsx");
  const draggableCard = text("components/workspace/DraggableCardWindow.tsx");

  assert.match(css, /@media \(max-width: 1319px\) and \(min-width: 761px\)/);
  assert.match(
    css,
    /\.sessionSidebar\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?height:\s*auto;[\s\S]*?width:\s*min\(292px, 88vw\)/
  );
  assert.doesNotMatch(css, /\.cardSidebar|rightClosed|rightOpen/);
  assert.doesNotMatch(page, /StudyCardSidebar|cardPanelToggle|rightOpen|setRightOpen/);
  assert.match(page, /matchMedia\("\(max-width: 1319px\)"\)/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /env\(safe-area-inset-top, 0px\)/);
  assert.match(css, /env\(safe-area-inset-bottom, 0px\)/);
  assert.doesNotMatch(css, /\.leftClosed \.sessionSidebar\s*\{[^}]*visibility:\s*visible/);
  assert.match(
    css,
    /@media \(min-width: 761px\) and \(max-width: 900px\)[\s\S]*?\.activeKnowledgeCardDock\s*\{[\s\S]*?position:\s*relative/
  );
  assert.match(draggableCard, /matchMedia\("\(min-width: 901px\)"\)/);
  assert.doesNotMatch(timeline, /floatingObstacle|avoidsKnowledgeCard/);
});

test("knowledge export replaces the removed global card drawer", () => {
  const page = text("app/page.tsx");
  const knowledgeWorkspace = text("components/workspace/KnowledgeWorkspace.tsx");
  const exportDialog = text("components/LearningCardExportDialog.tsx");
  const learningPrint = text("components/LearningCardPrintView.tsx");
  const mistakePrint = text("components/MistakeSetPrintView.tsx");

  assert.match(
    page,
    /knowledgeLibraryCards[\s\S]*?card\.card_type === "knowledge_card" && Boolean\(card\.saved_at\)/
  );
  assert.match(page, /<LearningCardExportDialog[\s\S]*?cards=\{selectedKnowledgeCards\}/);
  assert.match(knowledgeWorkspace, /onToggleSelectionMode[\s\S]*?退出多选[\s\S]*?onExportSelection/);
  assert.doesNotMatch(knowledgeWorkspace, /导出知识卡片/);
  assert.match(exportDialog, /固定 A4 纵向双列/);
  assert.doesNotMatch(exportDialog, /single|triple|type="radio"/);
  assert.match(learningPrint, /printLayout-double[\s\S]*?columnCount:\s*2/);
  assert.match(mistakePrint, /printLayout-double[\s\S]*?columnCount:\s*2/);
  assert.match(mistakePrint, /只看题目摘要[\s\S]*?practiceMode/);
  assert.doesNotMatch(page, /StudyCardSidebar|cardPanelToggle|rightOpen|setRightOpen/);
});

test("shelf card state machine transfers focus and restores the source trigger", () => {
  const page = text("app/page.tsx");
  const transitionHook = text("hooks/useShelfCardTransition.ts");

  assert.match(
    transitionHook,
    /type ShelfCardTransitionPhase =[\s\S]*?\| "closing"[\s\S]*?\| "closingFallback";/
  );
  assert.match(
    transitionHook,
    /flushSync\(\(\) => \{[\s\S]*?setPhase\("preparing"\)/
  );
  assert.match(transitionHook, /originRef\.current = origin/);
  assert.match(transitionHook, /dockRef\.current\?\.getBoundingClientRect\(\)/);
  assert.match(transitionHook, /setPhase\("opening"\)/);
  assert.match(transitionHook, /setPhase\("open"\)/);
  assert.match(transitionHook, /setPhase\("closing"\)/);
  assert.match(transitionHook, /setPhase\("closingFallback"\)/);
  assert.match(transitionHook, /setPhase\("idle"\)/);
  assert.match(page, /event\.target !== event\.currentTarget/);
  assert.match(transitionHook, /animationName === "shelfCardOpen"/);
  assert.match(transitionHook, /animationName === "shelfCardClose"/);
  assert.match(transitionHook, /animationName === "shelfCardFadeClose"/);
  assert.match(transitionHook, /triggerRef/);
  assert.match(transitionHook, /cardWindowRef\.current\?\.focusHandle\(\)/);
  assert.match(transitionHook, /consumeOffsetAndReset\(\)/);
  assert.match(transitionHook, /historyWorkspaceNav\[aria-label="展开会话栏"\]/);
  assert.doesNotMatch(page, /cardPanelToggleRef/);
  assert.match(transitionHook, /restoreFocus\(\)/);
  assert.match(page, /inert=\{displayedDockCardIsArchived && \(/);
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
  assert.match(history, /\.historyPaperPreview\s*\{[\s\S]*?min-height:\s*210px;[\s\S]*?aspect-ratio:\s*2\s*\/\s*1/);
  assert.match(history, /\.problemCardLibraryWorkspace \.historyPaperQuestionPreview\s*\{[\s\S]*?max-height:\s*1\.5em;[\s\S]*?overflow:\s*hidden/);
  assert.match(history, /\.mistakeSetLibraryWorkspace \.historyPaperQuestionPreview\s*\{[\s\S]*?max-height:\s*1\.5em;[\s\S]*?overflow:\s*hidden/);
  assert.match(history, /\.historyDeleteSelectionAction:hover:not\(:disabled\)[\s\S]*?background:\s*var\(--danger-soft\)/);
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

});
