/**
 * Updater service — checks GitHub for new commits on main, pulls if available.
 * Uses the GitHub API (no auth needed for public repos, token for private).
 */

const REPO_KEY = 'update-repo'; // stored as "owner/repo" in app store

export async function getUpdateRepo() {
  return window.api.store.get(REPO_KEY);
}

export async function setUpdateRepo(ownerRepo) {
  await window.api.store.set(REPO_KEY, ownerRepo);
}

/**
 * Check GitHub API for latest commit on main.
 * Returns { hasUpdate, latestSha, latestMessage, latestDate } or throws.
 */
export async function checkForUpdates() {
  const repo = await getUpdateRepo();
  if (!repo) throw new Error('No repository configured');
  const token = await window.api.keychain.getToken();

  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  const data = await res.json();

  // Get current local SHA from git log
  let currentSha = null;
  try {
    const { getLog } = await import('./git');
    const projects = JSON.parse(localStorage.getItem('scriptum-state') || '{}')?.state?.projects || [];
    if (projects.length > 0) {
      const log = await getLog(projects[0].folderPath, 1);
      // Note: this is the project git log, not the app source git log
      // App source SHA is stored separately
    }
    currentSha = await window.api.store.get('app-current-sha');
  } catch {}

  const latestSha = data.sha;
  const hasUpdate = currentSha !== latestSha;

  return {
    hasUpdate,
    latestSha,
    latestMessage: data.commit?.message || '',
    latestDate: data.commit?.author?.date || '',
    currentSha,
  };
}

/**
 * Store the current deployed SHA after a fresh install.
 */
export async function markCurrentSha(sha) {
  await window.api.store.set('app-current-sha', sha);
}
