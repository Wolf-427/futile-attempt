import { v4 as uuid } from 'uuid';

const DIRS = ['documents','references','boards','exports'];

export async function createProject({ name, folderPath }) {
  const projectPath = `${folderPath}/${name.replace(/[^a-zA-Z0-9-_ ]/g,'').replace(/\s+/g,'-').toLowerCase()}`;
  await window.api.fs.mkdir(projectPath);
  for (const d of DIRS) await window.api.fs.mkdir(`${projectPath}/${d}`);
  const manifest = { id: uuid(), name, createdAt: Date.now(), version: '0.1.0' };
  await window.api.fs.writeFile(`${projectPath}/scriptum.json`, JSON.stringify(manifest, null, 2));
  await window.api.fs.writeFile(`${projectPath}/boards/master.json`, JSON.stringify({ version:1, name:'Master board', isMaster:true, nodes:[], updatedAt:Date.now() }, null, 2));
  await window.api.fs.writeFile(`${projectPath}/documents/Untitled.md`, `# ${name}\n\n`);
  await window.api.fs.writeFile(`${projectPath}/.gitignore`, '.DS_Store\n*.log\n');
  return { projectPath, manifest };
}

export async function openProject(folderPath) {
  const exists = await window.api.fs.exists(`${folderPath}/scriptum.json`);
  if (!exists) throw new Error('Not a Scriptum project — scriptum.json not found.');
  return JSON.parse(await window.api.fs.readFile(`${folderPath}/scriptum.json`));
}

export async function readDocTree(projectPath) {
  const dirPath = `${projectPath}/documents`;
  if (!await window.api.fs.exists(dirPath)) return [];
  return readDirRecursive(dirPath);
}

async function readDirRecursive(dirPath) {
  const entries = await window.api.fs.readDir(dirPath);
  const result = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory) { result.push({ type:'folder', name:e.name, path:e.path, children: await readDirRecursive(e.path) }); }
    else if (e.name.endsWith('.md')) { result.push({ type:'file', name:e.name.replace(/\.md$/,''), path:e.path }); }
  }
  return result;
}

export async function readBoards(projectPath) {
  const boardsPath = `${projectPath}/boards`;
  if (!await window.api.fs.exists(boardsPath)) return [];
  const entries = await window.api.fs.readDir(boardsPath);
  const boards = [];
  for (const e of entries) {
    if (!e.name.endsWith('.json')) continue;
    try { const data = JSON.parse(await window.api.fs.readFile(e.path)); boards.push({ fileName:e.name, path:e.path, ...data }); } catch {}
  }
  return boards;
}

export async function saveBoard(projectPath, fileName, data) {
  await window.api.fs.writeFile(`${projectPath}/boards/${fileName}`, JSON.stringify({ ...data, updatedAt:Date.now() }, null, 2));
}

export async function createBoard(projectPath, name) {
  const fileName = `${name.replace(/\s+/g,'-').toLowerCase()}-${Date.now()}.json`;
  const data = { version:1, name, isMaster:false, nodes:[], coverImage:null, updatedAt:Date.now() };
  await saveBoard(projectPath, fileName, data);
  return { fileName, ...data };
}
