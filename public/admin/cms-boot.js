/**
 * Initialise Decap avec les collections Catégories et les champs
 * Configuration Catégories générés depuis src/data/domains.json.
 */
(function (global) {
  var HARDCODED_FILTERS = {
    articles_politique: true,
    articles_culture: true,
    articles_societe: true,
    articles_technologie: true
  };

  function domainCollectionName(slug) {
    return 'articles_' + String(slug || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  }

  function fieldSafe(slug) {
    return String(slug || '').replace(/[^a-z0-9]+/gi, '_');
  }

  function styleFields() {
    return [
      { label: 'Taille du titre (ex: 1.2rem)', name: 'titleSize', widget: 'string', default: '1.2rem', required: false },
      {
        label: 'Épaisseur du titre',
        name: 'titleWeight',
        widget: 'select',
        default: '700',
        required: false,
        options: [
          { label: 'Fin (300)', value: '300' },
          { label: 'Normal (400)', value: '400' },
          { label: 'Gras (700)', value: '700' },
          { label: 'Ultra-Gras (900)', value: '900' }
        ]
      },
      { label: 'Taille de la description (ex: 0.8rem)', name: 'descSize', widget: 'string', default: '0.8rem', required: false },
      {
        label: 'Intensité du filtre sombre',
        name: 'overlay_opacity',
        widget: 'number',
        default: 75,
        value_type: 'int',
        min: 0,
        max: 100,
        required: false,
        hint: 'Voile sombre sur la carte hero. 0 = image brute, 75 = défaut du site, 100 = très sombre.'
      }
    ];
  }

  function makeArticlesCollection(domain) {
    var slug = domain.slug;
    var values = [slug];
    if (!domain.parent) {
      (global.__SONAR_SUBDOMAINS || []).forEach(function (sub) {
        if (sub && sub.parent === slug && sub.slug && values.indexOf(sub.slug) === -1) {
          values.push(sub.slug);
        }
      });
    }
    return {
      name: domainCollectionName(slug),
      label: domain.label || slug,
      folder: 'src/content/articles',
      filter: values.length === 1
        ? { field: 'category', value: values[0] }
        : { field: 'category', value: values },
      create: false,
      fields: [
        { label: 'Titre', name: 'title', widget: 'string' },
        { label: 'Visible sur le site ?', name: 'isVisible', widget: 'boolean', default: true, required: false }
      ]
    };
  }

  function makeCategoryBlock(domain) {
    var slug = domain.slug;
    var nested = Boolean(domain.parent);
    var labelSource = nested
      ? (domain.shortLabel || String(domain.label || '').split(' — ').slice(1).join(' — ') || domain.label)
      : (domain.label || slug);
    var label = String(labelSource || slug).toLocaleUpperCase('fr-FR');
    return [
      { label: label, name: 'sep_' + fieldSafe(slug), widget: 'separator', required: false, collapsed: true, nested: nested },
      {
        label: '3 articles mis en avant',
        name: slug + '_topArticles',
        widget: 'list',
        label_singular: 'Article',
        summary: 'Article : {{article}}',
        min: 0,
        max: 3,
        allow_duplicate: false,
        required: false,
        field: {
          label: 'Article',
          name: 'article',
          widget: 'relation-filtered',
          target_category: slug,
          collection: domainCollectionName(slug),
          required: false,
          search_fields: ['title'],
          value_field: '{{slug}}',
          display_fields: ['title']
        }
      },
      {
        label: 'Styles des 3 articles',
        name: slug + '_topStyles',
        widget: 'list',
        label_singular: 'Style',
        summary: '__STYLE_SUMMARY__',
        min: 0,
        max: 3,
        required: false,
        fields: styleFields()
      }
    ];
  }

  function patchConfig(config, domains) {
    var list = Array.isArray(domains) ? domains.filter(function (d) { return d && d.slug; }) : [];
    config.collections = (config.collections || []).filter(function (col) {
      return !HARDCODED_FILTERS[col && col.name];
    });

    var generated = list.map(makeArticlesCollection);
    var insertAt = 0;
    config.collections.forEach(function (col, index) {
      if (col && (col.name === 'articles' || col.name === 'breves')) insertAt = index + 1;
    });
    generated.forEach(function (col, i) {
      config.collections.splice(insertAt + i, 0, col);
    });

    config.collections.forEach(function (col) {
      if (!col || col.name !== 'settings' || !Array.isArray(col.files)) return;
      col.files.forEach(function (file) {
        if (file && file.name === 'categories') {
          file.fields = list.reduce(function (fields, domain) {
            return fields.concat(makeCategoryBlock(domain));
          }, []);
        }
      });
    });

    return config;
  }

  function githubToken() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.githubToken === 'function') return search.githubToken();
    return '';
  }

  function parseDomainsFile(data) {
    if (!data) return { domains: [], subdomains: [] };
    if (Array.isArray(data.domains) || Array.isArray(data.subdomains)) {
      return {
        domains: Array.isArray(data.domains) ? data.domains : [],
        subdomains: Array.isArray(data.subdomains) ? data.subdomains : []
      };
    }
    if (Array.isArray(data)) return { domains: data, subdomains: [] };
    return { domains: [], subdomains: [] };
  }

  function flattenDomains(file) {
    var mains = (file && file.domains) || [];
    var subs = (file && file.subdomains) || [];
    var out = [];
    var used = Object.create(null);
    mains.forEach(function (d) {
      if (!d || !d.slug) return;
      out.push(d);
      used[d.slug] = true;
      subs.forEach(function (s) {
        if (!s || !s.slug || s.parent !== d.slug) return;
        out.push({
          slug: s.slug,
          label: (d.label || d.slug) + ' — ' + (s.label || s.slug),
          shortLabel: s.label || s.slug,
          labelEn: s.labelEn,
          visible: s.visible !== false,
          parent: d.slug
        });
        used[s.slug] = true;
      });
    });
    subs.forEach(function (s) {
      if (!s || !s.slug || used[s.slug]) return;
      out.push(s);
    });
    return out;
  }

  function patchCategorySelect(config, flat) {
    var options = (flat || []).filter(function (d) { return d && d.slug; }).map(function (d) {
      return { label: d.label || d.slug, value: d.slug };
    });
    if (!options.length) return;
    (config.collections || []).forEach(function (col) {
      if (!col || (col.name !== 'articles' && col.name !== 'breves') || !Array.isArray(col.fields)) return;
      col.fields.forEach(function (field, i) {
        if (!field || field.name !== 'category') return;
        col.fields[i] = {
          label: field.label || 'Catégorie',
          name: 'category',
          widget: 'select',
          options: options,
          hint: 'Domaines et sous-domaines (Paramètres → Domaines). Un article de sous-domaine apparaît aussi sur la page du domaine principal.'
        };
      });
    });
  }

  function loadDomainsFromGithub() {
    var token = githubToken();
    if (!token) return Promise.resolve(null);
    return fetch(
      'https://api.github.com/repos/paul-delachaux/sonar-web/contents/src/data/domains.json?ref=main',
      {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github.raw+json',
          'User-Agent': 'le-sonar-admin'
        }
      }
    ).then(function (res) {
      if (!res.ok) return null;
      return res.text().then(function (text) {
        try {
          return parseDomainsFile(JSON.parse(text));
        } catch (e) {
          return null;
        }
      });
    }).catch(function () { return null; });
  }

  function loadDomainsFromApi() {
    return fetch('/api/domains', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) return [];
        return res.json().then(parseDomainsFile);
      })
      .catch(function () { return []; });
  }

  function loadDomains() {
    return loadDomainsFromGithub().then(function (fromGh) {
      if (fromGh && fromGh.domains && fromGh.domains.length) return fromGh;
      return loadDomainsFromApi();
    });
  }

  function sonarMatchFilter(entry, filterRule) {
    if (!filterRule) return true;
    var field = filterRule.get ? filterRule.get('field') : filterRule.field;
    var value = filterRule.get ? filterRule.get('value') : filterRule.value;
    var pattern = filterRule.get ? filterRule.get('pattern') : filterRule.pattern;
    var data = entry && entry.data ? entry.data : {};
    if (data && typeof data.toJS === 'function') data = data.toJS();
    var fieldValue = data ? data[field] : undefined;
    if (pattern) {
      try {
        return new RegExp(String(pattern)).test(String(fieldValue == null ? '' : fieldValue));
      } catch (e) {
        return false;
      }
    }
    if (value && typeof value.toJS === 'function') value = value.toJS();
    if (value && typeof value.toArray === 'function') value = value.toArray();
    if (Array.isArray(value)) return value.indexOf(fieldValue) !== -1;
    if (Array.isArray(fieldValue)) return fieldValue.indexOf(value) !== -1;
    return fieldValue === value;
  }

  function wrapFilterEntries(owner) {
    if (!owner || typeof owner.filterEntries !== 'function' || owner.filterEntries.__sonar) return false;
    owner.filterEntries = function (collection, filterRule) {
      var entries = (collection && collection.entries) || [];
      return entries.filter(function (entry) {
        return sonarMatchFilter(entry, filterRule);
      });
    };
    owner.filterEntries.__sonar = true;
    return true;
  }

  function huntFilterEntries(root) {
    if (!root) return false;
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
    var queue = [root];
    var steps = 0;
    while (queue.length && steps < 2500) {
      var obj = queue.shift();
      steps += 1;
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) continue;
      if (seen) {
        try {
          if (seen.has(obj)) continue;
          seen.add(obj);
        } catch (e) {
          continue;
        }
      }
      if (wrapFilterEntries(obj)) return true;
      if (obj.prototype && wrapFilterEntries(obj.prototype)) return true;
      try {
        var proto = Object.getPrototypeOf(obj);
        if (proto && wrapFilterEntries(proto)) return true;
      } catch (e) {}
      var names = [];
      try {
        names = Object.getOwnPropertyNames(obj);
      } catch (e) {
        continue;
      }
      for (var i = 0; i < names.length && i < 60; i++) {
        try {
          queue.push(obj[names[i]]);
        } catch (e) {}
      }
    }
    return false;
  }

  function findBackendFromDom() {
    var el = document.getElementById('nc-root');
    if (!el) return null;
    var key = Object.keys(el).find(function (name) {
      return name.indexOf('__reactFiber') === 0 || name.indexOf('__reactInternalInstance') === 0 || name.indexOf('__reactContainer') === 0;
    });
    if (!key) return null;
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
    var queue = [el[key]];
    var steps = 0;
    while (queue.length && steps < 4000) {
      var node = queue.shift();
      steps += 1;
      if (!node || typeof node !== 'object') continue;
      if (seen) {
        try {
          if (seen.has(node)) continue;
          seen.add(node);
        } catch (e) {
          continue;
        }
      }
      var bags = [node.memoizedProps, node.memoizedState, node.stateNode, node.pendingProps];
      for (var i = 0; i < bags.length; i++) {
        var bag = bags[i];
        if (bag && typeof bag.filterEntries === 'function') return bag;
        if (bag && bag.backend && typeof bag.backend.filterEntries === 'function') return bag.backend;
        if (bag && typeof bag.getState === 'function') {
          try { queue.push(bag.getState()); } catch (e) {}
        }
      }
      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
      if (node.return) queue.push(node.return);
    }
    return null;
  }

  var filterRefreshDone = false;
  function installFilterPatch() {
    var patched = huntFilterEntries(global.CMS);
    if (!patched) {
      var backend = findBackendFromDom();
      if (backend) {
        wrapFilterEntries(backend);
        try { wrapFilterEntries(Object.getPrototypeOf(backend)); } catch (e) {}
        patched = true;
      }
    }
    if (patched && !filterRefreshDone) {
      filterRefreshDone = true;
      var hash = String(global.location.hash || '');
      if (/#\/collections\/articles_/.test(hash) && hash.indexOf('/entries/') === -1) {
        var keep = hash;
        global.location.hash = '#/collections/articles';
        setTimeout(function () { global.location.hash = keep; }, 160);
      }
    }
    return patched;
  }

  function boot() {
    if (global.__SONAR_CMS_READY) return global.__SONAR_CMS_READY;
    if (!global.CMS || typeof global.CMS.init !== 'function') {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(boot()); }, 80);
      });
    }
    if (typeof jsyaml === 'undefined' || typeof jsyaml.load !== 'function') {
      console.error('[sonar cms] js-yaml manquant');
      global.CMS.init();
      global.__SONAR_CMS_BOOTED = true;
      global.__SONAR_DOMAINS = global.__SONAR_DOMAINS || [];
      global.__SONAR_MAIN_DOMAINS = global.__SONAR_MAIN_DOMAINS || [];
      global.__SONAR_SUBDOMAINS = global.__SONAR_SUBDOMAINS || [];
      global.__SONAR_CMS_READY = Promise.resolve();
      return global.__SONAR_CMS_READY;
    }

    global.__SONAR_CMS_READY = Promise.all([
      fetch('/admin/config.yml', { cache: 'no-store' }).then(function (res) { return res.text(); }),
      loadDomains()
    ]).then(function (parts) {
      var config = jsyaml.load(parts[0]);
      var file = parts[1] || { domains: [], subdomains: [] };
      global.__SONAR_MAIN_DOMAINS = file.domains || [];
      global.__SONAR_SUBDOMAINS = file.subdomains || [];
      global.__SONAR_DOMAINS = flattenDomains(file);
      config.load_config_file = false;
      patchConfig(config, global.__SONAR_DOMAINS);
      patchCategorySelect(config, global.__SONAR_DOMAINS);
      installFilterPatch();
      global.CMS.init({ config: config });
      global.__SONAR_CMS_BOOTED = true;
      var tries = 0;
      var timer = setInterval(function () {
        tries += 1;
        if (installFilterPatch() || tries > 40) clearInterval(timer);
      }, 200);
    }).catch(function (err) {
      console.error('[sonar cms] init dynamique impossible, repli config.yml', err);
      global.CMS.init();
      global.__SONAR_CMS_BOOTED = true;
    });

    return global.__SONAR_CMS_READY;
  }

  global.SonarCmsBoot = boot;
  global.SonarDomainCollectionName = domainCollectionName;
})(window);
