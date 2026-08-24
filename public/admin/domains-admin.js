/**
 * Garde-fous du fichier Paramètres → Domaines (src/data/domains.json).
 * À garder aligné avec RESERVED_PAGE_SLUGS dans src/data/domains.ts.
 */
(function (global) {
  var RESERVED = {
    articles: true,
    auth: true,
    api: true,
    admin: true,
    compte: true,
    connexion: true,
    inscription: true,
    journaliste: true,
    favoris: true,
    'lire-plus-tard': true,
    charte: true,
    'charte-commentaires': true,
    deontologie: true,
    'mot-de-passe-oublie': true,
    'nouveau-mot-de-passe': true
  };

  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function entryJs(entry) {
    if (!entry) return {};
    if (typeof entry.toJS === 'function') return entry.toJS();
    return entry;
  }

  function collectionName(payload, entry) {
    var col = payload && payload.collection;
    if (typeof col === 'string' && col) return col;
    if (col && typeof col.get === 'function') return String(col.get('name') || '');
    var js = entryJs(entry);
    return String((entry && entry.get && entry.get('collection')) || js.collection || '');
  }

  function isDomainsEntry(entry, payload) {
    if (!entry) return false;
    var name = collectionName(payload, entry);
    if (name === 'domains') return true;
    if (name) return false;
    var js = entryJs(entry);
    var slug = String((entry.get && entry.get('slug')) || js.slug || '');
    var path = String((entry.get && entry.get('path')) || js.path || '');
    return slug === 'domains' || /domains\.json$/.test(path);
  }

  function githubToken() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.githubToken === 'function') return search.githubToken();
    var keys = ['decap-cms-user', 'netlify-cms-user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = global.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var data = JSON.parse(raw);
        if (data && (data.token || data.access_token)) return data.token || data.access_token;
      } catch (e) {}
    }
    return '';
  }

  function fetchArticlesDirect() {
    var headers = { Accept: 'application/json' };
    var token = githubToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch('/api/admin/articles', { headers: headers }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status);
        return data.articles || [];
      });
    });
  }

  function parseCategoryFromMarkdown(raw) {
    var match = String(raw || '').match(/^category:\s*["']?([a-z0-9-]+)/m);
    return match ? match[1] : '';
  }

  function loadArticlesFromGithub() {
    var token = githubToken();
    if (!token) return Promise.resolve(null);
    var headers = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin'
    };
    return fetch(
      'https://api.github.com/repos/paul-delachaux/sonar-web/contents/src/content/articles?ref=main',
      { headers: headers }
    ).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (files) {
      if (!Array.isArray(files)) return null;
      var md = files.filter(function (file) {
        return file && file.type === 'file' && /\.mdx?$/.test(file.name || '');
      });
      return Promise.all(md.map(function (file) {
        return fetch(file.url, {
          headers: {
            Authorization: 'Bearer ' + token,
            Accept: 'application/vnd.github.raw',
            'User-Agent': 'le-sonar-admin'
          }
        }).then(function (res) {
          return res.ok ? res.text() : '';
        }).then(function (raw) {
          return {
            slug: String(file.name || '').replace(/\.mdx?$/, ''),
            category: parseCategoryFromMarkdown(raw)
          };
        });
      }));
    }).catch(function () { return null; });
  }

  function loadArticles() {
    return loadArticlesFromGithub().then(function (fromGh) {
      if (fromGh && fromGh.length) return fromGh;
      var search = global.SonarArticleSearch;
      if (search && typeof search.fetchArticles === 'function') return search.fetchArticles();
      return fetchArticlesDirect();
    });
  }

  function entryData(entry) {
    if (entry && typeof entry.get === 'function') {
      var data = entry.get('data');
      if (data !== undefined && data !== null) return data;
    }
    return entry;
  }

  function stampList(list) {
    if (!list || typeof list.map !== 'function') return list;
    return list.map(function (item, index) {
      if (item && typeof item.set === 'function') return item.set('order', index + 1);
      if (item && typeof item === 'object') item.order = index + 1;
      return item;
    });
  }

  function withStampedOrder(entry) {
    if (!entry || typeof entry.getIn !== 'function' || typeof entry.setIn !== 'function') {
      var js = entryJs(entry);
      stampList((js.data && js.data.domains) || []);
      stampList((js.data && js.data.subdomains) || []);
      return entry;
    }
    var next = entry;
    var raw = entry.getIn(['data', 'domains']);
    if (raw && typeof raw.map === 'function') {
      next = next.setIn(['data', 'domains'], stampList(raw));
    }
    var rawSubs = next.getIn(['data', 'subdomains']);
    if (rawSubs && typeof rawSubs.map === 'function') {
      next = next.setIn(['data', 'subdomains'], stampList(rawSubs));
    }
    return next;
  }

  function listFromEntry(entry, key) {
    var js = entryJs(entry);
    var data = js.data || {};
    return Array.isArray(data[key]) ? data[key] : [];
  }

  function fail(message) {
    var err = new Error(message);
    err.sonarDomains = true;
    throw err;
  }

  function validateSlugs(domains) {
    if (!domains.length) {
      fail('Ajoute au moins un domaine.');
    }

    var seen = Object.create(null);
    for (var i = 0; i < domains.length; i++) {
      var item = domains[i] || {};
      var slug = String(item.slug || '').trim();
      var label = String(item.label || '').trim();
      var labelEn = String(item.labelEn || '').trim();

      if (!label) fail('Le domaine #' + (i + 1) + ' n’a pas de nom français.');
      if (!labelEn) fail('Le domaine « ' + label + ' » n’a pas de nom anglais.');
      if (!slug) fail('Le domaine « ' + label + ' » n’a pas de slug (URL).');
      if (!SLUG_RE.test(slug)) {
        fail(
          'Slug invalide pour « ' + label + ' » (' + slug + '). ' +
          'Utilise uniquement des minuscules, des chiffres et des tirets (ex. election-2027).'
        );
      }
      if (RESERVED[slug]) {
        fail(
          'Le slug « ' + slug + ' » est déjà une page du site (compte, articles, etc.). Choisis-en un autre.'
        );
      }
      if (seen[slug]) {
        fail('Le slug « ' + slug + ' » est utilisé deux fois.');
      }
      seen[slug] = true;
    }
  }

  function validateSubdomains(subs, domains) {
    var parents = Object.create(null);
    var seen = Object.create(null);
    domains.forEach(function (item) {
      var slug = String((item && item.slug) || '').trim();
      if (slug) {
        parents[slug] = true;
        seen[slug] = true;
      }
    });

    for (var i = 0; i < subs.length; i++) {
      var item = subs[i] || {};
      var slug = String(item.slug || '').trim();
      var label = String(item.label || '').trim();
      var labelEn = String(item.labelEn || '').trim();
      var parent = String(item.parent || '').trim();

      if (!label) fail('Le sous-domaine #' + (i + 1) + ' n’a pas de nom français.');
      if (!labelEn) fail('Le sous-domaine « ' + label + ' » n’a pas de nom anglais.');
      if (!slug) fail('Le sous-domaine « ' + label + ' » n’a pas de slug (URL).');
      if (!SLUG_RE.test(slug)) {
        fail(
          'Slug invalide pour le sous-domaine « ' + label + ' » (' + slug + '). ' +
          'Utilise uniquement des minuscules, des chiffres et des tirets (ex. election-2027).'
        );
      }
      if (RESERVED[slug]) {
        fail(
          'Le slug « ' + slug + ' » est déjà une page du site (compte, articles, etc.). Choisis-en un autre.'
        );
      }
      if (!parent) {
        fail('Le sous-domaine « ' + label + ' » n’a pas de domaine principal.');
      }
      if (!parents[parent]) {
        fail(
          'Le sous-domaine « ' + label + ' » pointe vers un domaine principal inconnu (« ' + parent +
          ' »). Ajoute d’abord ce domaine, ou choisis-en un dans la liste.'
        );
      }
      if (seen[slug]) {
        fail('Le slug « ' + slug + ' » est utilisé deux fois (domaine ou sous-domaine).');
      }
      seen[slug] = true;
    }
  }

  function countByCategory(articles) {
    var counts = Object.create(null);
    (articles || []).forEach(function (article) {
      var cat = String(article.category || '').trim();
      if (!cat) return;
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }

  function assertNoOrphans(domains, articles) {
    var kept = Object.create(null);
    domains.forEach(function (item) {
      var slug = String(item.slug || '').trim();
      if (slug) kept[slug] = true;
    });

    var stuck = [];
    var counts = countByCategory(articles);
    Object.keys(counts).forEach(function (slug) {
      if (!kept[slug]) stuck.push({ slug: slug, count: counts[slug] });
    });

    if (!stuck.length) return;
    var detail = stuck
      .map(function (item) {
        return '« ' + item.slug + ' » (' + item.count + ' article' + (item.count > 1 ? 's' : '') + ')';
      })
      .join(', ');
    fail(
      'Impossible d’enregistrer : des articles sont encore rattachés à un domaine ou sous-domaine retiré ou renommé : ' +
      detail +
      '. Réassigne ces articles, ou masque le domaine / sous-domaine plutôt que de le supprimer.'
    );
  }

  function isCategoriesEntry(entry, payload) {
    if (!entry) return false;
    var js = entryJs(entry);
    var slug = String((entry.get && entry.get('slug')) || js.slug || '');
    var path = String((entry.get && entry.get('path')) || js.path || '');
    return slug === 'categories' || /categories\.json$/.test(path);
  }

  function truncateCategoryLists(entry) {
    var data = entryData(entry);
    if (!data || typeof data.entrySeq !== 'function') return data;
    var next = data;
    data.entrySeq().forEach(function (pair) {
      var key = String(pair[0] || '');
      var val = pair[1];
      if (!/_top(Articles|Styles)$/.test(key)) return;
      if (val && typeof val.size === 'number' && val.size > 3 && typeof val.slice === 'function') {
        next = next.set(key, val.slice(0, 3));
      }
    });
    return next;
  }
  function onPreSave(payload) {
    var entry = payload && payload.entry;
    if (isCategoriesEntry(entry, payload)) return truncateCategoryLists(entry);
    // Ne surtout pas renvoyer l’entrée complète : Decap écrit ce retour
    // comme contenu du fichier. `undefined` = ne rien modifier (Accueil / Catégories).
    if (!isDomainsEntry(entry, payload)) return;

    var next = withStampedOrder(entry);
    var domains = listFromEntry(next, 'domains');
    var subs = listFromEntry(next, 'subdomains');
    validateSlugs(domains);
    validateSubdomains(subs, domains);

    return loadArticles().then(function (articles) {
      assertNoOrphans(domains.concat(subs), articles);
      return entryData(next);
    }).catch(function (err) {
      if (err && err.sonarDomains) throw err;
      console.warn('[sonar domains] vérification des articles ignorée', err);
      return entryData(next);
    });
  }

  function boot() {
    if (!global.CMS || typeof global.CMS.registerEventListener !== 'function') {
      setTimeout(boot, 300);
      return;
    }
    global.CMS.registerEventListener({
      name: 'preSave',
      handler: onPreSave
    });
  }

  boot();
})(window);
