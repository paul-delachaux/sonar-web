import domainsData from './domains.json';

export type Domain = {
    slug: string;
    label: string;
    labelEn: string;
    visible: boolean;
    order: number;
    parent?: string | null;
};

/** Pages statiques déjà prises : un futur domaine ne doit pas réutiliser ces slugs.
 *  Dupliqué dans public/admin/domains-admin.js (validation CMS). */
export const RESERVED_PAGE_SLUGS = [
    'articles',
    'auth',
    'api',
    'admin',
    'compte',
    'connexion',
    'inscription',
    'journaliste',
    'favoris',
    'lire-plus-tard',
    'charte',
    'charte-commentaires',
    'deontologie',
    'mot-de-passe-oublie',
    'nouveau-mot-de-passe',
] as const;

type DomainJson = Omit<Domain, 'order' | 'parent'> & { order?: number; parent?: string };

function mapList(list: DomainJson[] | undefined, parent?: string): Domain[] {
    return (list || []).map((d, i) => ({
        ...d,
        parent: parent || d.parent || null,
        order: i + 1,
    }));
}

/** L’ordre dans les menus = l’ordre du tableau JSON (drag & drop dans le CMS). */
export const domains: Domain[] = mapList(domainsData.domains as DomainJson[]);

export const subdomains: Domain[] = mapList(
    ((domainsData as { subdomains?: DomainJson[] }).subdomains || []).map((s) => ({
        ...s,
        parent: s.parent,
    }))
);

const ALIASES: Record<string, string> = {
    tech: 'technologie',
};

function normalizeSlug(slug: string | null | undefined): string {
    const raw = String(slug || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return ALIASES[raw] || raw;
}

export function getAllDomains(): Domain[] {
    return domains.concat(subdomains);
}

const slugs = getAllDomains().map((d) => d.slug);
export const DOMAIN_SLUGS = slugs as [string, ...string[]];

export function getDomainBySlug(slug: string | null | undefined): Domain | null {
    const s = normalizeSlug(slug);
    return getAllDomains().find((d) => d.slug === s) || null;
}

export function getVisibleDomains(): Domain[] {
    return domains.filter((d) => d.visible);
}

export function getVisibleDomainSlugs(): string[] {
    const out: string[] = [];
    for (const d of getVisibleDomains()) {
        out.push(d.slug);
        for (const sub of subdomains.filter((s) => normalizeSlug(s.parent) === d.slug)) {
            out.push(sub.slug);
        }
    }
    return out;
}

export function getVisibleSubdomains(parentSlug: string | null | undefined): Domain[] {
    const parent = normalizeSlug(parentSlug);
    return subdomains.filter((s) => normalizeSlug(s.parent) === parent && s.visible);
}

export function getRoutableDomains(): Domain[] {
    const reserved = new Set<string>(RESERVED_PAGE_SLUGS);
    return getAllDomains().filter((d) => d.visible && !reserved.has(d.slug));
}

/** Slugs d’articles à afficher sur la page /slug : le domaine lui-même, et ses sous-domaines s’il est principal. */
export function articleCategorySlugsOnPage(pageSlug: string | null | undefined): string[] {
    const domain = getDomainBySlug(pageSlug);
    if (!domain) return [];
    if (domain.parent) return [domain.slug];
    return [domain.slug, ...subdomains.filter((s) => normalizeSlug(s.parent) === domain.slug).map((s) => s.slug)];
}

export function domainLabel(slug: string | null | undefined, lang: string = 'FR'): string {
    const domain = getDomainBySlug(slug);
    if (!domain) return String(slug || '');
    return String(lang).toUpperCase() === 'EN' ? domain.labelEn : domain.label;
}

/** Libellé en capitales (badges accueil, titre de page catégorie). */
export function domainHeading(slug: string | null | undefined, lang: string = 'FR'): string {
    return domainLabel(slug, lang).toLocaleUpperCase(String(lang).toUpperCase() === 'EN' ? 'en-US' : 'fr-FR');
}

export type CategoryParts = {
    main: string;
    sub: string;
};

export function getCategoryParts(slug: string | null | undefined, lang: string = 'FR'): CategoryParts {
    const domain = getDomainBySlug(slug);
    if (!domain) {
        return { main: domainHeading(slug, lang), sub: '' };
    }
    if (domain.parent) {
        return {
            main: domainHeading(domain.parent, lang),
            sub: domainHeading(domain.slug, lang),
        };
    }
    return { main: domainHeading(domain.slug, lang), sub: '' };
}
