import { getCollection } from 'astro:content';

export type AdminArticle = {
  slug: string;
  title: string;
  title_en: string;
  category: string;
  isVisible: boolean;
};

export async function listAdminArticles(): Promise<AdminArticle[]> {
  try {
    const posts = await getCollection('articles');
    return posts
      .map((post) => ({
        slug: post.id,
        title: String(post.data.title || post.id),
        title_en: String(post.data.title_en || ''),
        category: String(post.data.category || ''),
        isVisible: post.data.isVisible !== false,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  } catch {
    return [];
  }
}
