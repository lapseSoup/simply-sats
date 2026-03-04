/**
 * Platform-agnostic file dialog helpers.
 *
 * Wraps `@tauri-apps/plugin-dialog` with `isTauri()` guards so that
 * components never import Tauri plugins directly. In non-Tauri
 * environments, returns null (no-op) since native file dialogs are
 * unavailable.
 *
 * @module utils/dialog
 */

import { isTauri } from './tauri'

interface FileFilter {
  name: string
  extensions: string[]
}

interface OpenFileOptions {
  /** Show a file-picker (false, default) or directory-picker (true). */
  directory?: boolean
  /** Allow selecting multiple files. */
  multiple?: boolean
  /** Restrict visible files by extension. */
  filters?: FileFilter[]
}

interface SaveFileOptions {
  /** Suggested file name. */
  defaultPath?: string
  /** Restrict visible files by extension. */
  filters?: FileFilter[]
}

/**
 * Show a native file/folder open dialog.
 *
 * @returns The selected path, or `null` if the user cancelled.
 */
export async function openFileDialog(opts: OpenFileOptions = {}): Promise<string | null> {
  if (!isTauri()) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    directory: opts.directory,
    multiple: opts.multiple ?? false,
    filters: opts.filters,
  })

  if (!result || Array.isArray(result)) return null
  return result
}

/**
 * Show a native file save dialog.
 *
 * @returns The chosen file path, or `null` if the user cancelled.
 */
export async function saveFileDialog(opts: SaveFileOptions = {}): Promise<string | null> {
  if (!isTauri()) return null

  const { save } = await import('@tauri-apps/plugin-dialog')
  return await save({
    defaultPath: opts.defaultPath,
    filters: opts.filters,
  }) ?? null
}
