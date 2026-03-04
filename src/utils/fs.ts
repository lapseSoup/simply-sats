/**
 * Platform-agnostic filesystem helpers.
 *
 * Wraps `@tauri-apps/plugin-fs` with `isTauri()` guards so that
 * components never import Tauri plugins directly. In non-Tauri
 * environments, the functions throw (filesystem access is unavailable
 * without a native runtime).
 *
 * @module utils/fs
 */

import { isTauri } from './tauri'

/**
 * Write a string to a file on disk.
 *
 * @throws In non-Tauri environments (no filesystem access).
 */
export async function writeFile(path: string, contents: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('File system access is not available in this environment')
  }

  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, contents)
}

/**
 * Read a text file from disk.
 *
 * @throws In non-Tauri environments (no filesystem access).
 */
export async function readFile(path: string): Promise<string> {
  if (!isTauri()) {
    throw new Error('File system access is not available in this environment')
  }

  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return await readTextFile(path)
}
