import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetProjectConfigCacheForTesting } from "../config/projectConfig";
import { searchCode } from "../tools/codeSearchTool";
import { readFiles } from "../tools/readFileTool";

test("searchCode respects project searchPaths and supports non-TS repositories", () => {
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), "ai-agent-workflows-repo-search-"));
  const appDir = join(tempDir, "app", "Services");
  const docsDir = join(tempDir, "docs");

  mkdirSync(appDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(
    join(tempDir, "ai-agent.config.json"),
    JSON.stringify({ searchPaths: ["app"] }, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(appDir, "ColorService.php"),
    "<?php\nclass ColorService { public function blockColorCreation() {} }\n",
    "utf-8",
  );
  writeFileSync(
    join(docsDir, "notes.md"),
    "ColorService appears here too but should stay outside searchPaths.\n",
    "utf-8",
  );

  process.chdir(tempDir);
  resetProjectConfigCacheForTesting();

  try {
    const results = searchCode("ColorService");

    assert.equal(results.length, 1);
    assert.match(results[0]?.file ?? "", /app\/Services\/ColorService\.php$/);
  } finally {
    process.chdir(originalCwd);
    resetProjectConfigCacheForTesting();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("readFiles allows PHP files from the targeted repository root", () => {
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), "ai-agent-workflows-repo-read-"));
  const appDir = join(tempDir, "app", "Services");

  mkdirSync(appDir, { recursive: true });
  writeFileSync(
    join(appDir, "ColorService.php"),
    "<?php\nclass ColorService { public function blockColorCreation() {} }\n",
    "utf-8",
  );

  process.chdir(tempDir);
  resetProjectConfigCacheForTesting();

  try {
    const files = readFiles(["app/Services/ColorService.php"]);

    assert.equal(files.length, 1);
    assert.match(files[0]?.file ?? "", /app\/Services\/ColorService\.php$/);
    assert.match(files[0]?.content ?? "", /ColorService/);
  } finally {
    process.chdir(originalCwd);
    resetProjectConfigCacheForTesting();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
