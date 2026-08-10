import { dictionary } from '../data/dictionary'; // Ton dictionnaire de l'étape 1

// 1. Traduire un mot-clé du dictionnaire
export function t(key, lang = 'FR') {
  return dictionary[lang]?.[key] || dictionary['FR']?.[key] || key;
}

// 2. Filtrer les articles selon la langue
export function getVisibleArticles(articlesList, currentLang) {
  return articlesList.filter(article => {
    if (article.data.isVisible === false) return false;

    if (currentLang === 'EN') {
      return article.data.title_en && article.data.title_en.trim() !== "";
    }

    return true; // En FR on affiche tout
  });
}

// 3. Récupérer le bon contenu d'un article selon la langue
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