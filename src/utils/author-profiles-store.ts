import fs from 'node:fs/promises';
import path from 'node:path';
import bundledProfiles from '../data/author-profiles.json';
import { parseAuthorProfiles, serializeAuthorProfiles } from './author-profiles';
import type { AuthorProfile } from './authors';

const REPO = 'paul-delachaux/sonar-web';
const BRANCH = 'main';
const FILE_PATH = 'src/data/author-profiles.json';
const LOCAL_FILE = path.join(process.cwd(), FILE_PATH);
const LOCAL_UPLOADS = path.join(process.cwd(), 'public', 'assets', 'uploads');

function parseJson(text: string): AuthorProfile[] {
  return parseAuthorProfiles(JSON.parse(text));
}

export async function readLocalAuthorProfiles(): Promise<AuthorProfile[]> {
  try {
    return parseJson(await fs.readFile(LOCAL_FILE, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return parseAuthorProfiles(bundledProfiles);
    }
    throw error;
  }
}

export async function readGithubAuthorProfiles(token: string): Promise<AuthorProfile[] | null> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'le-sonar-admin',
      },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Lecture des profils auteurs impossible (GitHub HTTP ${response.status}).`);
  return parseJson(await response.text());
}

export async function loadAuthorProfiles(token?: string): Promise<AuthorProfile[]> {
  if (token) {
    const remote = await readGithubAuthorProfiles(token);
    if (remote) return remote;
  }
  return readLocalAuthorProfiles();
}

export async function writeLocalAuthorProfiles(profiles: AuthorProfile[]): Promise<void> {
  await fs.writeFile(LOCAL_FILE, serializeAuthorProfiles(profiles), 'utf8');
}

export async function writeLocalAuthorAvatar(fileName: string, bytes: Uint8Array): Promise<void> {
  await fs.mkdir(LOCAL_UPLOADS, { recursive: true });
  await fs.writeFile(path.join(LOCAL_UPLOADS, fileName), bytes);
}

export async function writeGithubAuthorAvatar(
  token: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<void> {
  const filePath = `public/assets/uploads/${fileName}`;
  const url = `https://api.github.com/repos/${REPO}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'le-sonar-admin',
  };
  const currentResponse = await fetch(`${url}?ref=${BRANCH}`, { headers });
  let sha: string | undefined;
  if (currentResponse.status !== 404) {
    if (!currentResponse.ok) {
      throw new Error(`Lecture de l’image auteur impossible (GitHub HTTP ${currentResponse.status}).`);
    }
    const current = await currentResponse.json() as { sha?: string };
    sha = current.sha;
    if (!sha) throw new Error('GitHub n’a pas fourni la version du fichier image.');
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'admin: mise à jour d’une image de profil auteur',
      content: Buffer.from(bytes).toString('base64'),
      ...(sha ? { sha } : {}),
      branch: BRANCH,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(error.message || `Enregistrement de l’image auteur impossible (GitHub HTTP ${response.status}).`);
  }
}

export async function writeGithubAuthorProfiles(token: string, profiles: AuthorProfile[]): Promise<void> {
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const currentResponse = await fetch(`${url}?ref=${BRANCH}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin',
    },
  });
  if (!currentResponse.ok) {
    throw new Error(`Lecture des profils auteurs impossible (GitHub HTTP ${currentResponse.status}).`);
  }
  const current = await currentResponse.json() as { sha?: string };
  if (!current.sha) throw new Error('GitHub n’a pas fourni la version du fichier des profils auteurs.');

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'admin: mise à jour des profils auteurs',
      content: Buffer.from(serializeAuthorProfiles(profiles), 'utf8').toString('base64'),
      sha: current.sha,
      branch: BRANCH,
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(error.message || `Enregistrement des profils auteurs impossible (GitHub HTTP ${response.status}).`);
  }
}
