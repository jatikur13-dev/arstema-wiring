import {
  createCircuitProject,
  parseCircuitProject,
  type Board,
  type CircuitProject,
} from '../engine/index'
import { defaultStorage, type WiringStorage } from '../runtime/storage'
import { WIRING_PROJECT_STORAGE_KEY } from '../runtime/storage'

/** Explicit key: Wiring startup never enumerates unrelated application storage. */
export { WIRING_PROJECT_STORAGE_KEY } from '../runtime/storage'

export function loadWiringProject(fallbackBoard: Board,storage:WiringStorage=defaultStorage): CircuitProject {
  const stored = storage.getItem(WIRING_PROJECT_STORAGE_KEY)
  const parsed=parseCircuitProject(stored);
  if(stored!==null&&!parsed)throw Error('Proyek tersimpan tidak valid. Data asli dipertahankan; impor proyek valid untuk memulihkan.');
  return parsed ?? createCircuitProject(fallbackBoard)
}

export function saveWiringProject(project: CircuitProject,storage:WiringStorage=defaultStorage): void {
  storage.setItem(WIRING_PROJECT_STORAGE_KEY, JSON.stringify(project))
}

export function parseImportedWiringProject(text: string): CircuitProject | null {
  return parseCircuitProject(text)
}

export function wiringProjectExportJson(project: CircuitProject): string {
  return JSON.stringify(project, null, 2)
}
