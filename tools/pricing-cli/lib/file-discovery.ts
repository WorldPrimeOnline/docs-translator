/**
 * Finds every real document in --input (flat folder — matches the README's "I drop documents
 * into a folder" flow). Only .docx/.pdf/.jpg/.jpeg/.png become file results — everything else
 * (manifest.json, manifest.example.json, any other JSON, dotfiles like .gitkeep, stray notes)
 * is silently skipped here rather than surfacing as a FAILED report. manifest.json is read
 * separately as configuration (lib/manifest.ts) — it is never treated as a document, by
 * construction, since discovery never returns .json files at all.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUPPORTED_EXTENSIONS } from './analyze-file';

export interface DiscoveredFile {
  filename: string;
  relativePath: string;
  absolutePath: string;
  extension: string;
}

export function discoverFiles(inputDir: string): DiscoveredFile[] {
  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  const files: DiscoveredFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) continue;

    files.push({
      filename: entry.name,
      relativePath: entry.name,
      absolutePath: path.join(inputDir, entry.name),
      extension,
    });
  }

  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}
