import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DraggableCardWindow } from "../components/workspace/DraggableCardWindow";
import { ConversationHeader } from "../components/workspace/ConversationHeader";
import { StudyCardSidebar } from "../components/workspace/StudyCardSidebar";
import { cardFixture, knowledgeFolderFixture } from "./fixtures";

const source = (path: string) => readFileSync(resolve(__dirname, `../../../${path}`), "utf8");

test("draggable card window renders one dedicated accessible drag handle", () => {
  const markup = renderToStaticMarkup(
    <DraggableCardWindow
      cardId={cardFixture.id}
      mode="pending"
      boundsRef={{ current: null }}
      boundsKey="conversation"
      dragEnabled
    >
      <article>卡片内容</article>
    </DraggableCardWindow>
  );

  assert.equal((markup.match(/cardWindowDragHandle/g) ?? []).length, 1);
  assert.match(markup, /data-card-window-mode="pending"/);
  assert.match(markup, /aria-label="移动卡片窗口"/);
  assert.match(markup, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift\+ArrowUp Shift\+ArrowDown Shift\+ArrowLeft Shift\+ArrowRight Home"/);
  assert.match(markup, /使用方向键移动卡片窗口/);
  assert.match(markup, /卡片内容/);
});

test("draggable card window isolates pointer motion and escape semantics", () => {
  const component = source("components/workspace/DraggableCardWindow.tsx");

  assert.match(component, /matchMedia\("\(min-width: 901px\)"\)/);
  assert.match(component, /setPointerCapture\(event\.pointerId\)/);
  assert.match(component, /releasePointerCapture\(pointerId\)/);
  assert.match(component, /onLostPointerCapture=\{finishPointerDrag\}/);
  assert.match(component, /requestAnimationFrame/);
  assert.match(component, /new ResizeObserver/);
  assert.match(component, /\[boundsKey, boundsRef,/);
  assert.match(component, /removeProperty\("--card-window-max-height"\)/);
  assert.match(component, /mode === "archived"/);
  assert.match(component, /onArchivedEscape\?\.\(\)/);
  assert.match(component, /focusHandle: true/);
  assert.match(component, /button:not\(:disabled\)/);
});

test("drag styles preserve outer FLIP and collapse safely at 900px", () => {
  const conversation = source("styles/conversation.css");
  const dialogs = source("styles/dialogs.css");
  const responsive = source("styles/responsive.css");

  assert.match(
    conversation,
    /\.cardWindowDragHandle\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?touch-action:\s*none;/
  );
  assert.match(
    conversation,
    /@keyframes shelfCardClose[\s\S]*?var\(--shelf-close-start-x, 0px\)[\s\S]*?var\(--shelf-motion-x\)/
  );
  assert.match(conversation, /@keyframes shelfCardFadeClose[\s\S]*?opacity:\s*0;/);
  assert.match(conversation, /@keyframes reducedCardDockEnter[\s\S]*?transform:\s*none;/);
  assert.match(conversation, /\.activeKnowledgeCardDock > \.draggableCardWindow\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(dialogs, /\.draggableCardWindow \.flashcardPin\s*\{[\s\S]*?display:\s*none;/);
  assert.match(dialogs, /--card-window-max-height/);
  assert.match(
    responsive,
    /@media \(max-width: 900px\)[\s\S]*?\.draggableCardWindow\s*\{[\s\S]*?transform:\s*none !important;[\s\S]*?\.cardWindowDragHandle\s*\{[\s\S]*?display:\s*none;/
  );
});

test("card launchers expose their exact trigger and origin rectangle", () => {
  const shelf = source("components/workspace/CardShelfTabs.tsx");
  const sidebar = source("components/workspace/StudyCardSidebar.tsx");
  const header = source("components/workspace/ConversationHeader.tsx");

  assert.match(
    shelf,
    /onOpenCard\(card, event\.currentTarget\.getBoundingClientRect\(\), event\.currentTarget\)/
  );
  assert.match(
    sidebar,
    /onOpenCard\(card, event\.currentTarget\.getBoundingClientRect\(\), event\.currentTarget\)/
  );
  assert.match(sidebar, /data-library-card-id=\{card\.id\}/);
  assert.match(header, /cardPanelToggleRef/);
  assert.match(header, /ref=\{cardPanelToggleRef\}/);
});

test("library cards keep their source ids in rendered markup", () => {
  const markup = renderToStaticMarkup(
    <StudyCardSidebar
      cards={[cardFixture]}
      folders={[knowledgeFolderFixture]}
      currentFolderId={knowledgeFolderFixture.id}
      visibleFolders={[]}
      visibleCards={[cardFixture]}
      clipboard={null}
      cardBusyId=""
      folderBusyId=""
      pasteBusy={false}
      deleteAllCardsBusy={false}
      composerBlocked={false}
      onCollapse={() => {}}
      onOpenFolder={() => {}}
      onCreateFolder={async () => true}
      onRenameFolder={async () => true}
      onDeleteFolder={() => {}}
      onOpenCard={() => {}}
      onCopyCard={() => {}}
      onCutCard={() => {}}
      onClearClipboard={() => {}}
      onPasteCard={() => {}}
      onMoveCard={() => {}}
      onDeleteCard={() => {}}
      onExport={() => {}}
      onDeleteAllCards={() => {}}
    />
  );

  assert.match(markup, new RegExp(`data-library-card-id="${cardFixture.id}"`));
});

test("conversation header accepts a stable fallback focus ref", () => {
  const markup = renderToStaticMarkup(
    <ConversationHeader
      leftOpen
      title="一次函数"
      sessionId="session-a"
      gradeBand="junior"
      streamBusy={false}
      cardPanelToggleRef={{ current: null }}
      onExpandLeft={() => {}}
      onToggleCards={() => {}}
      onViewProblemImage={() => {}}
    />
  );

  assert.match(markup, /aria-label="切换卡片栏"/);
});
