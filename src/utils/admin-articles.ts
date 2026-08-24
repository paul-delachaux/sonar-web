import { getCollection } from 'astro:content';
import fs from 'node:fs/promises';
import path from 'node:path';

export type AdminArticle = {
  slug: string;
  title: string;
  title_en: string;
  category: string;
  isVisible: boolean;
  layout_type: string;
};

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function pickYaml(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp('^' + key + ':\\s*(.*)$', 'm'));
  if (!match) return '';
  return unquote(match[1] || '');
}

function fromFrontmatter(filename: string, raw: string): AdminArticle | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = match[1];
  const vis = pickYaml(fm, 'isVisible');
  return {
    slug: filename.replace(/\.mdx?$/, ''),
    title: pickYaml(fm, 'title') || filename,
    title_en: pickYaml(fm, 'title_en'),
    category: pickYaml(fm, 'category'),
    isVisible: vis === '' ? true : vis !== 'false',
    layout_type: pickYaml(fm, 'layout_type'),
  };
}

async function listFromFiles(): Promise<AdminArticle[]> {
  const names = await fs.readdir(ARTICLES_DIR);
  const out: AdminArticle[] = [];
  for (const name of names) {
    if (!name.endsWith('.md') && !name.endsWith('.mdx')) continue;
    const raw = await fs.readFile(path.join(ARTICLES_DIR, name), 'utf8');
    const parsed = fromFrontmatter(name, raw);
    if (parsed) out.push(parsed);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

async function listFromCollection(): Promise<AdminArticle[]> {
  const posts = await getCollection('articles');
  return posts
    .map((post) => ({
      slug: post.id,
      title: String(post.data.title || post.id),
      title_en: String(post.data.title_en || ''),
      category: String(post.data.category || ''),
      isVisible: post.data.isVisible !== false,
      layout_type: String((post.data as { layout_type?: string }).layout_type || ''),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

export async function listAdminArticles(): Promise<AdminArticle[]> {
  try {
    return await listFromFiles();
  } catch {
    try {
      return await listFromCollection();
    } catch {
      return [];
    }
  }
}
