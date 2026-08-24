import fs from 'node:fs/promises';
import path from 'node:path';

export type BulkAction = 'show' | 'hide' | 'delete';

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');
const REPO = 'paul-delachaux/sonar-web';
const BRANCH = 'main';
const REMOTE_DIR = 'src/content/articles';

function setVisible(raw: string, visible: boolean): string {
  const line = `isVisible: ${visible ? 'true' : 'false'}`;
  if (/^isVisible:\s*/m.test(raw)) return raw.replace(/^isVisible:\s*.*$/m, line);
  if (/^---\r?\n/.test(raw)) return raw.replace(/^---\r?\n/, (open) => `${open}${line}\n`);
  return `${line}\n${raw}`;
}

async function resolveLocalFile(slug: string): Promise<string | null> {
  const names = await fs.readdir(ARTICLES_DIR);
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    decoded = slug;
  }
  for (const name of names) {
    if (!/\.mdx?$/.test(name)) continue;
    const stem = name.replace(/\.mdx?$/, '');
    if (stem === slug || stem === decoded) return path.join(ARTICLES_DIR, name);
  }
  return null;
}

export async function applyBulkLocal(
  action: BulkAction,
  slugs: string[],
): Promise<{ done: string[]; missing: string[] }> {
  const done: string[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const file = await resolveLocalFile(slug);
    if (!file) {
      missing.push(slug);
      continue;
    }
    if (action === 'delete') {
      await fs.unlink(file);
      done.push(slug);
      continue;
    }
    const raw = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, setVisible(raw, action === 'show'), 'utf8');
    done.push(slug);
  }
  return { done, missing };
}

async function gh<T>(token: string, apiPath: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || `GitHub HTTP ${res.status}`);
  return data;
}

export async function applyBulkGithub(
  token: string,
  action: BulkAction,
  slugs: string[],
): Promise<{ done: string[]; missing: string[] }> {
  const files = await gh<Array<{ name: string; url: string; type: string }>>(
    token,
    `/repos/${REPO}/contents/${REMOTE_DIR}?ref=${BRANCH}`,
  );
  const md = (Array.isArray(files) ? files : []).filter(
    (file) => file && file.type === 'file' && /\.mdx?$/.test(file.name || ''),
  );

  const matched: Array<{ name: string; url: string }> = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    let decoded = slug;
    try {
      decoded = decodeURIComponent(slug);
    } catch {
      decoded = slug;
    }
    const file = md.find((item) => {
      const stem = String(item.name || '').replace(/\.mdx?$/, '');
      return stem === slug || stem === decoded;
    });
    if (file) matched.push(file);
    else missing.push(slug);
  }
  if (!matched.length) return { done: [], missing };

  const ref = await gh<{ object: { sha: string } }>(token, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const commitSha = ref.object.sha;
  const commit = await gh<{ tree: { sha: string } }>(token, `/repos/${REPO}/git/commits/${commitSha}`);

  const tree: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
  if (action === 'delete') {
    for (const file of matched) {
      tree.push({ path: `${REMOTE_DIR}/${file.name}`, mode: '100644', type: 'blob', sha: null });
    }
  } else {
    const visible = action === 'show';
    for (const file of matched) {
      const rawRes = await fetch(file.url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.raw',
          'User-Agent': 'le-sonar-admin',
        },
      });
      if (!rawRes.ok) throw new Error(`Lecture impossible : ${file.name}`);
      const raw = await rawRes.text();
      const blob = await gh<{ sha: string }>(token, `/repos/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: setVisible(raw, visible), encoding: 'utf-8' }),
      });
      tree.push({ path: `${REMOTE_DIR}/${file.name}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }

  const verb =
    action === 'delete' ? 'supprimer' : action === 'show' ? 'rendre visibles' : 'masquer';
  const message = `cms: ${verb} ${matched.length} contenu${matched.length > 1 ? 's' : ''}`;
  const newTree = await gh<{ sha: string }>(token, `/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: commit.tree.sha, tree }),
  });
  const newCommit = await gh<{ sha: string }>(token, `/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [commitSha] }),
  });
  await gh(token, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return { done: matched.map((file) => file.name.replace(/\.mdx?$/, '')), missing };
}
