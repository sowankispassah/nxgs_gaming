import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rendererRoot = fileURLToPath(new URL('../../src/renderer/', import.meta.url));

async function listFiles(relativeDirectory, extensions) {
  const directory = join(rendererRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort();
}

async function readAll(paths) {
  const sources = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
  return sources.join('\n');
}

/**
 * The renderer App shell plus the dialog, system and admin modules that were
 * split out of App.tsx. Assertions about App behavior read this combined text
 * so they keep working regardless of which module owns a component.
 */
export async function readAppShellSource() {
  const extracted = [
    ...(await listFiles('components/dialogs', ['.tsx', '.ts'])),
    ...(await listFiles('components/system', ['.tsx', '.ts'])),
    ...(await listFiles('components/admin', ['.tsx', '.ts']))
  ];
  return readAll([join(rendererRoot, 'App.tsx'), ...extracted]);
}

/**
 * The renderer stylesheet entry plus every style module it imports.
 */
export async function readRendererStyles() {
  const modules = await listFiles('styles', ['.css']);
  return readAll([join(rendererRoot, 'styles.css'), ...modules]);
}
