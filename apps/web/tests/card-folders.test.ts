import assert from "node:assert/strict";
import test from "node:test";

import {
  childFolders,
  countCardsInFolderTree,
  descendantFolderIds,
  flattenCardFolders,
  foldersForCardType,
  folderBreadcrumbs,
  isProtectedFolder
} from "../lib/card-folders";
import type { CardFolder, StudyCard } from "../lib/api";
import { cardFixture, knowledgeFolderFixture } from "./fixtures";

const child: CardFolder = {
  id: "folder_equations",
  name: "方程",
  parent_id: knowledgeFolderFixture.id,
  is_system: false,
  default_card_type: null,
  created_at: "2026-07-18T00:00:01Z",
  updated_at: "2026-07-18T00:00:01Z"
};

test("folder helpers preserve hierarchy, paths, and recursive counts", () => {
  const folders = [child, knowledgeFolderFixture];
  const nestedCard: StudyCard = { ...cardFixture, folder_id: child.id };

  assert.deepEqual(childFolders(folders, null).map((folder) => folder.id), [knowledgeFolderFixture.id]);
  assert.deepEqual(folderBreadcrumbs(folders, child.id).map((folder) => folder.name), ["默认知识卡片", "方程"]);
  assert.deepEqual([...descendantFolderIds(folders, knowledgeFolderFixture.id)], [knowledgeFolderFixture.id, child.id]);
  assert.equal(countCardsInFolderTree([nestedCard], folders, knowledgeFolderFixture.id), 1);
  assert.deepEqual(flattenCardFolders(folders).map(({ id, depth, path }) => ({ id, depth, path })), [
    { id: knowledgeFolderFixture.id, depth: 0, path: "默认知识卡片" },
    { id: child.id, depth: 1, path: "默认知识卡片 / 方程" }
  ]);
});

test("system and paper-archive folders are protected", () => {
  assert.equal(isProtectedFolder(knowledgeFolderFixture), true);
  assert.equal(isProtectedFolder(child), false);
  assert.equal(isProtectedFolder({ ...child, managed_kind: "paper_archive_root" }), true);
  assert.equal(isProtectedFolder({ ...child, managed_kind: "paper_archive" }), true);
});

test("folder choices hide only the opposite card type default", () => {
  const problemDefault: CardFolder = {
    ...knowledgeFolderFixture,
    id: "folder_default_problem",
    name: "默认题目卡片",
    default_card_type: "problem_card"
  };
  const paperArchive: CardFolder = {
    ...knowledgeFolderFixture,
    id: "folder_papers",
    name: "按试卷归档",
    default_card_type: null,
    managed_kind: "paper_archive_root"
  };
  const folders = [knowledgeFolderFixture, problemDefault, paperArchive];

  assert.deepEqual(
    foldersForCardType(folders, "knowledge_card").map((folder) => folder.id),
    [knowledgeFolderFixture.id, paperArchive.id]
  );
  assert.deepEqual(
    foldersForCardType(folders, "problem_card").map((folder) => folder.id),
    [problemDefault.id, paperArchive.id]
  );
});
