import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BoardFile, CharacterFile, DocumentFile } from '../../../src/shared/content'
import { formatReport, importV1Project } from '../../../src/main/import/v1project'
import { ProjectStore } from '../../../src/main/storage/project'
import { SnapshotStore } from '../../../src/main/storage/snapshots'
import { tempDir } from '../storage/helpers'

/** Every file in a folder with its content, to prove the source was not touched. */
async function fingerprint(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[path.slice(dir.length)] = (await readFile(path)).toString('base64')
  }
  return out
}

async function v1Fixture(): Promise<string> {
  const root = join(await tempDir(), 'mein-roman')
  // v1 stored absolute paths from wherever the project used to live.
  const old = '/Users/someone/Old Location/mein-roman'
  const w = async (rel: string, content: string | Buffer): Promise<void> => {
    await mkdir(join(root, rel, '..'), { recursive: true })
    await writeFile(join(root, rel), content)
  }

  await w('scriptum.json', JSON.stringify({ id: 'v1-id', name: 'Mein Roman', created: 1700000000000 }))
  await w('.gitignore', '.DS_Store\n')
  await w('documents/Kapitel 10.md', '# Zehn\n\nText.\n')
  await w('documents/Kapitel 2.md', '# Zwei\n\nHaustür und Weltkarte.\n---PAGE---\n> > Zitat\n')
  await w('documents/Teil 1/Szene.md', '# Szene\n\n<ul><li><p>eins</p></li></ul>\n')
  await w('documents/backups/Kapitel 2_timed_20260601T101500.md', '# Zwei\n\nÄltere Fassung.\n')
  await w('documents/backups/Kapitel 2_switch_20260602T090000.md', '# Zwei\n\nNeuere Fassung.\n')
  await w('documents/.Wolke.md.icloud', 'placeholder')
  await w('references/abc-map.png', Buffer.from([1, 2, 3]))
  await w('references/cover-xyz.jpg', Buffer.from([4, 5]))
  await w('boards/master.json', JSON.stringify({
    name: 'Master board', isMaster: true, viewState: { pan: { x: 10, y: 20 }, zoom: 0.5 },
    nodes: [
      { id: 'n1', type: 'note', color: 'blue', x: 0, y: 0, width: 220, height: 160, text: 'Idee', html: 'Idee<div><b>wichtig</b></div>' },
      { id: 'n2', type: 'text', x: 300, y: 0, width: 200, height: 60, text: 'Titel', fontSize: 16, color: 'var(--tx)' },
      { id: 'n3', type: 'image', x: 0, y: 300, width: 240, src: `${old}/references/abc-map.png` },
      { id: 'n4', type: 'image', x: 0, y: 600, width: 240, src: `${old}/references/gone.png` },
      { id: 'n5', type: 'subboard', x: 500, y: 0, width: 160, file: 'welt-123.json', name: 'Welt', cover: `${old}/references/cover-xyz.jpg` },
      { id: 'n6', type: 'subboard', x: 500, y: 200, width: 160, file: 'deleted-9.json', name: 'Weg', cover: null },
      { id: 'n7', type: 'doclink', x: 700, y: 0, width: 180, path: `${old}/documents/Teil 1/Szene.md`, name: 'Szene' },
      { id: 'g1', type: 'group', name: 'Gruppe', x: -20, y: -50, width: 600, height: 300, members: ['n1', 'n2', 'deleted-node'] }
    ],
    arrows: [{ id: 'a1', from: 'n1', to: 'n2', color: 'red', dashed: true }, { id: 'a2', from: 'n1', to: 'deleted-node' }]
  }))
  await w('boards/welt-123.json', JSON.stringify({ name: 'Welt', isMaster: false, nodes: [] }))
  await w('characters/c1.json', JSON.stringify({ id: 'c1', name: 'Kath', role: 'protagonist', description: 'Pilotin', imageFile: 'c1.png', refImages: ['c1-ref-1.jpg', 'lost.jpg'], created: 5 }))
  await w('characters/c1.md', '# Kath\n')
  await w('characters/images/c1.png', Buffer.from([9]))
  await w('characters/images/c1-ref-1.jpg', Buffer.from([8]))
  await w('trash/manifest.json', JSON.stringify([
    { id: 't1', type: 'document', name: 'Verworfen', originalPath: `${old}/documents/Verworfen.md`, trashPath: `${old}/trash/documents/t1_Verworfen.md`, trashedAt: 42 }
  ]))
  await w('trash/documents/t1_Verworfen.md', '# Verworfen\n\nAlt.\n')
  return root
}

describe('importing a v1 project', () => {
  it('brings over every document, board and character without touching the source', async () => {
    const source = await v1Fixture()
    const destination = `${source}-v2`
    const snapshots = new SnapshotStore(await tempDir())
    const before = await fingerprint(source)

    const report = await importV1Project(source, destination, { snapshots })

    expect(await fingerprint(source)).toEqual(before)
    expect(report).toMatchObject({
      projectName: 'Mein Roman',
      documents: { found: 4, imported: 3 },
      folders: 1,
      boards: { found: 2, imported: 2 },
      characters: { found: 1, imported: 1 },
      trash: { found: 1, imported: 1 },
      assets: 4,
      snapshots: 2
    })
    // The one document still in the cloud is an error, never a silent skip.
    expect(report.errors).toEqual(['documents/Wolke.md: not downloaded from the cloud'])
    expect(formatReport(report)).toContain('RESULT: INCOMPLETE')
    expect(report.warnings.join('\n')).toMatch(/gone\.png/)
    expect(report.warnings.join('\n')).toMatch(/sub-board "Weg"/)
    expect(report.warnings.join('\n')).toMatch(/lost\.jpg/)

    const opened = await ProjectStore.open(destination)
    if (!opened.ok) throw new Error(opened.reason)
    const { project } = opened
    const m = project.manifest

    // Natural order: "Kapitel 2" before "Kapitel 10"; folders keep their documents.
    expect(m.tree.map((n) => n.title)).toEqual(['Kapitel 2', 'Kapitel 10', 'Teil 1'])
    const folder = m.tree[2]
    if (folder?.type !== 'folder') throw new Error('expected a folder')
    const sceneId = folder.children[0]?.id ?? ''
    expect(m.boards.map((b) => b.title)).toEqual(['Master board', 'Welt'])
    expect(m.characters.map((c) => c.title)).toEqual(['Kath'])
    expect(m.trash).toMatchObject([{ kind: 'documents', title: 'Verworfen', trashedAt: 42 }])

    const k2 = await project.loadItem<DocumentFile>('documents', m.tree[0]?.id ?? '')
    if (!k2.ok) throw new Error(k2.state)
    expect(k2.value.doc.content.map((b) => b.type)).toEqual(['heading', 'paragraph', 'pageBreak', 'blockquote'])

    const master = await project.loadItem<BoardFile>('boards', m.boards[0]?.id ?? '')
    if (!master.ok) throw new Error(master.state)
    const byId = Object.fromEntries(master.value.nodes.map((n) => [n.id, n]))
    expect(master.value).toMatchObject({ isMaster: true, viewport: { x: 10, y: 20, zoom: 0.5 } })
    expect(byId['n1']).toMatchObject({ type: 'note', color: 'blue', content: [{ type: 'paragraph' }, { type: 'paragraph' }] })
    expect(byId['n3']).toMatchObject({ type: 'image', asset: 'abc-map.png' })
    expect(byId['n4']).toMatchObject({ type: 'image', asset: null })
    expect(byId['n5']).toMatchObject({ type: 'subboard', boardId: m.boards[1]?.id, cover: 'cover-xyz.jpg' })
    expect(byId['n6']).toMatchObject({ type: 'subboard', boardId: null })
    expect(byId['n7']).toMatchObject({ type: 'doclink', documentId: sceneId, title: 'Szene' })
    expect(byId['g1']).toMatchObject({ type: 'group', members: ['n1', 'n2'] })
    expect(master.value.edges).toEqual([{ id: 'a1', source: 'n1', target: 'n2', color: 'red', dashed: true }])
    // No absolute path from the old machine survives anywhere in the project.
    for (const [path, content] of Object.entries(await fingerprint(destination))) {
      if (path.endsWith('.json')) expect(Buffer.from(content, 'base64').toString()).not.toContain('/Users/someone')
    }

    const kath = await project.loadItem<CharacterFile>('characters', m.characters[0]?.id ?? '')
    expect(kath).toMatchObject({ ok: true, value: { role: 'protagonist', description: 'Pilotin', image: 'characters/c1.png', refImages: ['characters/c1-ref-1.jpg'], created: 5 } })
    expect((await readdir(join(destination, 'assets', 'characters'))).sort()).toEqual(['c1-ref-1.jpg', 'c1.png'])

    const history = await snapshots.list(m.id, 'documents', m.tree[0]?.id ?? '')
    expect(history.map((h) => h.reason)).toEqual(['v1-backup', 'v1-backup'])
    expect(await snapshots.read(m.id, 'documents', m.tree[0]?.id ?? '', history[0]?.name ?? '')).toContain('Neuere Fassung')
    await project.close()
  })

  it('refuses to write into an existing folder or to import a v2 project', async () => {
    const source = await v1Fixture()
    await mkdir(`${source}-v2`)
    await expect(importV1Project(source, `${source}-v2`)).rejects.toThrow(/already exists/)

    const first = await importV1Project(source, `${source}-out`)
    await expect(importV1Project(first.destination, `${source}-again`)).rejects.toThrow(/already a format 2/)
  })
})
