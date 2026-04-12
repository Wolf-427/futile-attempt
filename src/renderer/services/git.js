import git from 'isomorphic-git';

// Minimal http plugin using browser fetch
const http = {
  async request({ url, method, headers, body }) {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? (await streamToArrayBuffer(body)) : undefined,
    });
    return {
      url: res.url,
      method,
      headers: Object.fromEntries(res.headers.entries()),
      statusCode: res.status,
      statusMessage: res.statusText,
      body: [new Uint8Array(await res.arrayBuffer())],
    };
  },
};

async function streamToArrayBuffer(stream) {
  if (stream instanceof ArrayBuffer) return stream;
  if (Array.isArray(stream)) {
    const chunks = [];
    for (const chunk of stream) chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out.buffer;
  }
  return stream;
}

const ipcFs = {
  promises: {
    readFile: (p, opts) => window.api.fs.readFile(p).then((d) => opts?.encoding ? d : Buffer.from(d)),
    writeFile: (p, d) => window.api.fs.writeFile(p, typeof d === 'string' ? d : d.toString()),
    unlink: (p) => window.api.fs.delete(p),
    readdir: (p) => window.api.fs.readDir(p).then((e) => e.map((x) => x.name)),
    mkdir: (p) => window.api.fs.mkdir(p),
    rmdir: (p) => window.api.fs.delete(p),
    stat: async (p) => {
      const ok = await window.api.fs.exists(p);
      if (!ok) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 0, mode: 0o100644, mtimeMs: Date.now(), ctimeMs: Date.now() };
    },
    lstat: async (p) => {
      const ok = await window.api.fs.exists(p);
      if (!ok) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: 0, mode: 0o100644, mtimeMs: Date.now(), ctimeMs: Date.now() };
    },
    rename: (o, n) => window.api.fs.rename(o, n),
    symlink: () => Promise.resolve(),
    readlink: () => Promise.resolve(''),
  },
};

const AUTHOR = { name: 'Scriptum', email: 'app@scriptum.local' };

export async function initRepo(dir) {
  await git.init({ fs: ipcFs, dir, defaultBranch: 'main' });
}

export async function getStatus(dir) {
  try {
    const matrix = await git.statusMatrix({ fs: ipcFs, dir });
    const dirty = matrix.some(([, h, w, st]) => h !== 1 || w !== 1 || st !== 1);
    const branch = await git.currentBranch({ fs: ipcFs, dir }) || 'main';
    let lastCommit = null;
    try {
      const log = await git.log({ fs: ipcFs, dir, depth: 1 });
      if (log[0]) lastCommit = { oid: log[0].oid.slice(0, 7), message: log[0].commit.message, timestamp: log[0].commit.author.timestamp * 1000 };
    } catch {}
    return { initialized: true, dirty, branch, lastCommit, error: null };
  } catch (e) {
    return { initialized: false, dirty: false, branch: 'main', lastCommit: null, error: e.message };
  }
}

export async function stageAndCommit(dir, message) {
  const matrix = await git.statusMatrix({ fs: ipcFs, dir });
  for (const [fp, , w] of matrix) {
    if (w === 0) { await git.remove({ fs: ipcFs, dir, filepath: fp }); }
    else { await git.add({ fs: ipcFs, dir, filepath: fp }); }
  }
  return git.commit({ fs: ipcFs, dir, author: AUTHOR, message });
}

export async function pushToGitHub(dir, remote, token) {
  await git.push({ fs: ipcFs, http, dir, remote: 'origin', ref: 'main', onAuth: () => ({ username: token, password: '' }) });
  return true;
}

export async function addRemote(dir, url) {
  try { await git.deleteRemote({ fs: ipcFs, dir, remote: 'origin' }); } catch {}
  await git.addRemote({ fs: ipcFs, dir, remote: 'origin', url });
}

export async function getLog(dir, depth = 50) {
  try {
    const entries = await git.log({ fs: ipcFs, dir, depth });
    return entries.map((x) => ({ oid: x.oid, short: x.oid.slice(0, 7), message: x.commit.message, timestamp: x.commit.author.timestamp * 1000 }));
  } catch { return []; }
}
