import { dictionary } from '../data/dictionary';
import { domainHeading } from '../data/domains';

/** Traduire une clé du dictionnaire (lang: 'FR' | 'EN') */
export function t(key, lang = 'FR') {
  const langKey = String(lang || 'FR').toUpperCase();
  return dictionary[langKey]?.[key] || dictionary.FR?.[key] || key;
}

/** Libellé traduit d'une catégorie (capitales, depuis src/data/domains.json). */
export function categoryLabel(slug, lang = 'FR') {
  return domainHeading(slug, lang);
}

export function articleDescriptionText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (value.mode === 'image' && value.image) return '';
  return String(value.text || '');
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
      description: articleDescriptionText(article.data.description_en)
        || articleDescriptionText(article.data.description),
      body: article.data.body_en || article.data.body
    };
  }

  return {
    title: article.data.title,
    description: articleDescriptionText(article.data.description),
    body: article.data.body
  };
}
