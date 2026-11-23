import { beforeEach, describe, expect, it } from 'vitest'
import { createCircuitProject, emptyBoard } from '../engine/index'
import { getItem, replaceMemory } from '../runtime/storage'
import {
  WIRING_PROJECT_STORAGE_KEY,
  loadWiringProject,
  parseImportedWiringProject,
  saveWiringProject,
} from './projectRepository'

describe('Wiring project repository', () => {
  beforeEach(() => replaceMemory([]))

  it('uses one explicit Wiring key without enumerating other app data', () => {
    const project = createCircuitProject(emptyBoard(), { id: 'offline-project' })
    saveWiringProject(project)
    expect(getItem(WIRING_PROJECT_STORAGE_KEY)).toContain('offline-project')
    expect(loadWiringProject(emptyBoard()).id).toBe('offline-project')
  })

  it('keeps an invalid import outside the active project', () => {
    expect(parseImportedWiringProject('{"not":"a project"}')).toBeNull()
  })
})
