import { dictionary } from '../data/dictionary';

/** Traduire une clé du dictionnaire (lang: 'FR' | 'EN') */
export function t(key, lang = 'FR') {
  const langKey = String(lang || 'FR').toUpperCase();
  return dictionary[langKey]?.[key] || dictionary.FR?.[key] || key;
}

/** Slug catégorie CMS → clé dictionnaire (ex: technologie → category_title_tech) */
const CATEGORY_DICT_KEYS = {
  politique: 'category_title_politique',
  culture: 'category_title_culture',
  societe: 'category_title_societe',
  technologie: 'category_title_tech',
  tech: 'category_title_tech',
};

export function categoryDictKey(slug) {
  const s = String(slug || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return CATEGORY_DICT_KEYS[s] || null;
}

/** Libellé traduit d'une catégorie */
export function categoryLabel(slug, lang = 'FR') {
  const key = categoryDictKey(slug);
  return key ? t(key, lang) : String(slug || '');
}

// Filtrer les articles selon la langue
export function getVisibleArticles(articlesList, currentLang) {
  return articlesList.filter(article => {
    if (article.data.isVisible === false) return false;

    if (currentLang === 'EN') {
      return article.data.title_en && article.data.title_en.trim() !== "";
    }

    return true;
  });
}

// Récupérer le bon contenu d'un article selon la langue
export function getArticleData(article, currentLang) {
  if (currentLang === 'EN' && article.data.title_en) {
    return {
      title: article.data.title_en,
      description: article.data.description_en || article.data.description,
      body: article.data.body_en || article.data.body
    };
  }

  return {
    title: article.data.title,
    description: article.data.description,
    body: article.data.body
  };
}
