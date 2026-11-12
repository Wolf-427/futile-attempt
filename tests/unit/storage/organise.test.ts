import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../src/shared/project'
import { ProjectStore } from '../../../src/main/storage/project'
import { FAST, tempDir } from './helpers'

const options = { file: FAST }

/** "A B Folder[C D]" style rendering of the tree, for readable assertions. */
function shape(tree: readonly TreeNode[]): string {
  return tree.map((n) => (n.type === 'folder' ? `${n.title}[${shape(n.children)}]` : n.title)).join(' ')
}

async function sample(): Promise<{ project: ProjectStore; ids: Record<string, string> }> {
  const project = await ProjectStore.create(await tempDir(), 'Novel', options)
  const ids: Record<string, string> = {}
  ids['A'] = await project.createItem('documents', 'A', {})
  ids['B'] = await project.createItem('documents', 'B', {})
  ids['F'] = await project.createFolder('F')
  ids['C'] = await project.createItem('documents', 'C', {}, ids['F'])
  ids['G'] = await project.createFolder('G', ids['F'])
  ids['D'] = await project.createItem('documents', 'D', {}, ids['G'])
  return { project, ids }
}
const id = (ids: Record<string, string>, key: string): string => ids[key] ?? ''

describe('document tree', () => {
  it('creates folders and nests documents', async () => {
    const { project } = await sample()
    expect(shape(project.manifest.tree)).toBe('A B F[C G[D]]')
  })

  it('reorders within a list and moves between folders', async () => {
    const { project, ids } = await sample()
    await project.moveNode(id(ids, 'A'), null, 2) // drop A between B and F
    expect(shape(project.manifest.tree)).toBe('B A F[C G[D]]')
    await project.moveNode(id(ids, 'A'), null, 0)
    expect(shape(project.manifest.tree)).toBe('A B F[C G[D]]')
    await project.moveNode(id(ids, 'B'), id(ids, 'G'), 0)
    expect(shape(project.manifest.tree)).toBe('A F[C G[B D]]')
    await project.moveNode(id(ids, 'G'), null, 99)
    expect(shape(project.manifest.tree)).toBe('A F[C] G[B D]')
  })

  it('refuses to move a folder into itself or its own subfolder', async () => {
    const { project, ids } = await sample()
    await expect(project.moveNode(id(ids, 'F'), id(ids, 'F'), 0)).rejects.toThrow(/into itself/)
    await expect(project.moveNode(id(ids, 'F'), id(ids, 'G'), 0)).rejects.toThrow(/own subfolders/)
    await expect(project.moveNode(id(ids, 'A'), id(ids, 'B'), 0)).rejects.toThrow(/No such folder/)
    expect(shape(project.manifest.tree)).toBe('A B F[C G[D]]')
  })

  it('renames folders and the project without touching files', async () => {
    const { project, ids } = await sample()
    await project.renameFolder(id(ids, 'F'), 'Part One')
    await project.renameProject('  Roman  ')
    expect(shape(project.manifest.tree)).toBe('A B Part One[C G[D]]')
    expect(project.manifest.name).toBe('Roman')
  })

  it('reorders boards and characters', async () => {
    const project = await ProjectStore.create(await tempDir(), 'Novel', options)
    const a = await project.createItem('boards', 'One', {})
    await project.createItem('boards', 'Two', {})
    await project.createItem('boards', 'Three', {})
    await project.reorderIndexEntry('boards', a, 3)
    expect(project.manifest.boards.map((b) => b.title)).toEqual(['Two', 'Three', 'One'])
  })
})

describe('trash', () => {
  it('moves a document to the trash with unsaved edits intact, and restores it', async () => {
    const { project, ids } = await sample()
    await project.loadItem('documents', id(ids, 'C'))
    project.updateItem('documents', id(ids, 'C'), { text: 'typed just before trashing' })

    await project.trashItem('documents', id(ids, 'C'))
    expect(shape(project.manifest.tree)).toBe('A B F[G[D]]')
    expect(project.manifest.trash).toMatchObject([{ kind: 'documents', id: id(ids, 'C'), title: 'C' }])
    expect(await readdir(join(project.dir, 'trash', 'documents'))).toEqual([`${id(ids, 'C')}.json`])
    expect(await project.loadItem('documents', id(ids, 'C'))).toMatchObject({ ok: false, state: 'missing' })

    await project.restoreItem(id(ids, 'C'))
    expect(shape(project.manifest.tree)).toBe('A B F[G[D]] C')
    expect(project.manifest.trash).toEqual([])
    expect(await project.loadItem('documents', id(ids, 'C'))).toEqual({ ok: true, value: { text: 'typed just before trashing' } })
  })

  it('trashing a folder trashes every document inside it', async () => {
    const { project, ids } = await sample()
    await project.trashFolder(id(ids, 'F'))
    expect(shape(project.manifest.tree)).toBe('A B')
    expect(project.manifest.trash.map((t) => t.title).sort()).toEqual(['C', 'D'])
  })

  it('deletes permanently only from the trash', async () => {
    const { project, ids } = await sample()
    await project.trashItem('documents', id(ids, 'A'))
    await project.trashItem('documents', id(ids, 'B'))
    await expect(project.deleteFromTrash(id(ids, 'D'))).rejects.toThrow(/Not in trash/)

    await project.deleteFromTrash(id(ids, 'A'))
    expect(project.manifest.trash.map((t) => t.title)).toEqual(['B'])
    await project.deleteFromTrash()
    expect(project.manifest.trash).toEqual([])
    expect(await readdir(join(project.dir, 'trash', 'documents'))).toEqual([])
    expect((await readdir(join(project.dir, 'documents'))).length).toBe(2)
  })

  it('survives a reopen', async () => {
    const { project, ids } = await sample()
    await project.trashItem('documents', id(ids, 'A'))
    await project.close()
    const again = await ProjectStore.open(project.dir, options)
    if (!again.ok) throw new Error(again.reason)
    expect(again.project.manifest.trash).toMatchObject([{ title: 'A' }])
    expect(shape(again.project.manifest.tree)).toBe('B F[C G[D]]')
  })
})
