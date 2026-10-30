import authorProfilesData from '../data/author-profiles.json';

const AUTHOR_AVATARS: Record<string, string> = {
  "Victor Zhâ": "/assets/uploads/avatar-victor.jpg",
  "Paul Delachaux": "/assets/uploads/avatar-paul.jpg",
  "Amaury Renouf": "/assets/uploads/avatar-amaury.png",
};

export interface AuthorProfile {
  name: string;
  account?: string;
  avatar?: string;
  about?: string;
  about_en?: string;
  interests?: string;
  interests_en?: string;
  partners?: string;
  partners_en?: string;
}

const authorProfiles = (authorProfilesData as { authors?: AuthorProfile[] }).authors || [];

export function normalizeAuthorName(name: unknown): string {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function authorSlug(name: unknown): string {
  return normalizeAuthorName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function authorHref(name: unknown): string {
  return `/auteurs/${authorSlug(name)}`;
}

export function authorAvatarUrl(name: string, profiles: AuthorProfile[] = authorProfiles): string {
  const profile = profiles.find((item) =>
    normalizeAuthorName(item.name) === normalizeAuthorName(name)
  );
  return profile?.avatar || AUTHOR_AVATARS[name] || '/assets/uploads/avatar-default.jpg';
}

export function getAuthorProfile(name: unknown, profiles: AuthorProfile[] = authorProfiles): AuthorProfile {
  const authorName = String(name || '').trim();
  return profiles.find((profile) =>
    normalizeAuthorName(profile.name) === normalizeAuthorName(authorName)
  ) || { name: authorName };
}

export function articleAuthorNames(article: { data?: { author?: unknown; author2?: unknown } }): string[] {
  const names = [article.data?.author, article.data?.author2]
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  return names.filter((name, index) => names.findIndex((other) =>
    normalizeAuthorName(other) === normalizeAuthorName(name)
  ) === index);
}
