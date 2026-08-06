import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const webRoot = process.cwd();
const layoutPath = join(webRoot, "app", "layout.tsx");
const exportRoot = join(webRoot, "out");
const layoutSource = readFileSync(layoutPath, "utf8");
const contractMatch = layoutSource.match(/const directionContract = `([\s\S]*?)`;/);

if (!contractMatch) {
  throw new Error(`Unable to find directionContract in ${layoutPath}`);
}

const contract = contractMatch[1].trim();
const orderedHeadings = [
  "THESIS:",
  "OWN-WORLD:",
  "STORY:",
  "FIRST VIEWPORT:",
  "FORM:",
  "FINISH:"
];
const requiredTokens = [
  "stagecraft-theater-lighting-cyclorama-dawn",
  "focus-light-a-luminous-atrium",
  "31d2d748",
  "FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md"
];

let previousTokenIndex = -1;
for (const token of orderedHeadings) {
  const tokenIndex = contract.indexOf(token);
  if (tokenIndex < 0) throw new Error(`Direction contract is missing: ${token}`);
  if (tokenIndex < previousTokenIndex) throw new Error(`Direction contract token is out of order: ${token}`);
  previousTokenIndex = tokenIndex;
}

for (const token of requiredTokens) {
  if (!contract.includes(token)) throw new Error(`Direction contract is missing: ${token}`);
}

if (contract.includes("--")) {
  throw new Error("Direction contract cannot contain a double hyphen inside an HTML comment");
}

const contractComment = `<!--\n${contract}\n-->`;

function htmlFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...htmlFiles(entryPath));
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(entryPath);
  }
  return files;
}

const files = htmlFiles(exportRoot);
if (files.length === 0) throw new Error(`No exported HTML files found in ${exportRoot}`);

for (const file of files) {
  const html = readFileSync(file, "utf8");
  const bodyMatch = /<body(?:\s[^>]*)?>/i.exec(html);
  if (!bodyMatch) throw new Error(`Missing <body> in ${file}`);

  const insertionIndex = bodyMatch.index + bodyMatch[0].length;
  const bodyTail = html.slice(insertionIndex);
  if (bodyTail.startsWith(contractComment)) continue;
  if (bodyTail.startsWith("<!--") && bodyTail.slice(0, bodyTail.indexOf("-->") + 3).includes("THESIS:")) {
    throw new Error(`A different direction contract is already the first body node in ${file}`);
  }

  const updated = `${html.slice(0, insertionIndex)}${contractComment}${html.slice(insertionIndex)}`;
  writeFileSync(file, updated, "utf8");

  const verifiedTail = updated.slice(insertionIndex);
  if (!verifiedTail.startsWith(contractComment)) {
    throw new Error(`Direction contract was not injected as the first body node in ${file}`);
  }
}

process.stdout.write(`Injected the design direction contract into ${files.length} exported HTML file(s).\n`);
