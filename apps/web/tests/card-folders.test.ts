import assert from "node:assert/strict";
import test from "node:test";

import {
  childFolders,
  countCardsInFolderTree,
  descendantFolderIds,
  flattenCardFolders,
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
