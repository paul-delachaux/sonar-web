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
    return {
      name: domainCollectionName(slug),
      label: domain.label || slug,
      folder: 'src/content/articles',
      filter: { field: 'category', value: slug },
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
      if (col && (col.name === 'articles' || col.name === 'breves' || col.name === 'revues_musicales')) insertAt = index + 1;
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

  function readGithubSession() {
    var token = global.__SONAR_GH_TOKEN || '';
    var login = global.__SONAR_GH_LOGIN || '';
    var search = global.SonarArticleSearch;
    if (search) {
      if (!token && typeof search.githubToken === 'function') token = search.githubToken() || '';
      if (!login && typeof search.githubLogin === 'function') login = search.githubLogin() || '';
    }
    var keys = ['decap-cms-user', 'netlify-cms-user', 'decap-cms.user', 'netlify-cms.user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = global.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var data = JSON.parse(raw);
        if (!data) continue;
        if (!token) token = data.token || data.access_token || data.accessToken || '';
        if (!login) login = String(data.login || (data.user && data.user.login) || '').toLowerCase();
      } catch (e) {}
    }
    if (token) global.__SONAR_GH_TOKEN = token;
    if (login) global.__SONAR_GH_LOGIN = login;
    return { token: token, login: login };
  }

  function githubToken() {
    return readGithubSession().token || '';
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

  function authHeaders() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.authHeaders === 'function') {
      return search.authHeaders({ Accept: 'application/json' });
    }
    var headers = { Accept: 'application/json' };
    var token = githubToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Sonar-GitHub'] = token;
      headers['X-Github-Token'] = token;
    }
    return headers;
  }

  function isLocalHost() {
    return /localhost|127\.0\.0\.1/.test(String(global.location.hostname || ''));
  }

  function waitForGithubToken(maxMs) {
    var token = githubToken();
    if (token || maxMs <= 0) return Promise.resolve(token || '');
    return new Promise(function (resolve) {
      var start = Date.now();
      var iv = setInterval(function () {
        var found = githubToken();
        if (found || Date.now() - start >= maxMs) {
          clearInterval(iv);
          resolve(found || '');
        }
      }, 100);
    });
  }

  function storedGithubLogin() {
    return readGithubSession().login || '';
  }

  function fetchGithubLogin(token) {
    var stored = storedGithubLogin();
    if (stored) return Promise.resolve(stored);
    if (!token) return Promise.resolve('');
    return fetch('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'le-sonar-admin'
      }
    }).then(function (res) {
      if (!res.ok) return '';
      return res.json().then(function (user) {
        var login = String(user && user.login || '').toLowerCase();
        if (login) global.__SONAR_GH_LOGIN = login;
        return login;
      });
    }).catch(function () { return ''; });
  }

  function fetchAccountList() {
    return fetch('/api/cms-accounts', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : { accounts: [] }; })
      .then(function (data) { return Array.isArray(data.accounts) ? data.accounts : []; })
      .catch(function () { return []; });
  }

  function matchAccount(login, accounts) {
    var needle = String(login || '').toLowerCase();
    if (!needle) return null;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i] && String(accounts[i].login || '').toLowerCase() === needle) return accounts[i];
    }
    if (needle === 'paul-delachaux') return { login: needle, role: 'superadmin', label: 'Paul Delachaux' };
    return null;
  }

  function applyMe(me) {
    global.__SONAR_CMS_LOGIN = me.login || '';
    global.__SONAR_CMS_ROLE = me.role || '';
    global.__SONAR_CMS_SUPERADMIN = me.role === 'superadmin';
    document.body.classList.toggle('sonar-role-superadmin', me.role === 'superadmin');
    document.body.classList.toggle('sonar-role-admin', me.role === 'admin');
  }

  function loadMe() {
    var token = githubToken();
    return Promise.all([
      token
        ? fetch('/api/admin/me', { headers: authHeaders(), cache: 'no-store' })
            .then(function (res) {
              return res.json().catch(function () { return {}; }).then(function (data) {
                if (res.ok && data.role) {
                  return { login: data.login || '', role: data.role, forbidden: false };
                }
                return {
                  login: data.login || '',
                  role: '',
                  forbidden: res.status === 403,
                  message: data.message || ''
                };
              });
            })
            .catch(function () { return null; })
        : Promise.resolve(null),
      fetchAccountList(),
      fetchGithubLogin(token)
    ]).then(function (parts) {
      var apiMe = parts[0];
      var accounts = parts[1] || [];
      var ghLogin = parts[2] || storedGithubLogin();
      if (apiMe && apiMe.role) return apiMe;
      var match = matchAccount(ghLogin, accounts);
      if (match) return { login: match.login, role: match.role || 'admin', forbidden: false };
      if (apiMe && apiMe.forbidden) return apiMe;
      if (!token && !ghLogin) {
        return {
          login: isLocalHost() ? 'local-dev' : '',
          role: isLocalHost() ? 'superadmin' : '',
          anonymous: !isLocalHost()
        };
      }
      if (ghLogin) {
        return { login: ghLogin, role: '', forbidden: true, message: 'Compte GitHub non autorisé.' };
      }
      return { login: '', role: '', anonymous: true };
    });
  }

  function applyRoleToConfig(config, role) {
    if (role === 'superadmin') return config;
    config.collections = (config.collections || []).filter(function (col) {
      return col && col.name !== 'settings' && col.name !== 'domains';
    });
    (config.collections || []).forEach(function (col) {
      if (!col) return;
      col.delete = false;
      col.publish = false;
    });
    return config;
  }

  function showForbidden(message) {
    document.body.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#01002b;color:#fff;font-family:Helvetica,Arial,sans-serif;padding:24px;text-align:center">' +
      '<div><h1 style="color:#ff7900;margin:0 0 12px">Accès refusé</h1>' +
      '<p style="max-width:440px;line-height:1.5">' + (message || 'Ce compte GitHub n’est pas autorisé à ouvrir l’admin.') + '</p>' +
      '<p style="opacity:.7;font-size:13px;margin-top:16px">Demandez à un superadmin de vous ajouter, puis reconnectez-vous.</p></div></div>';
  }

  function watchLoginThenReload() {
    if (global.__SONAR_CMS_ROLE === 'superadmin' || global.__SONAR_CMS_ROLE === 'admin') return;
    var n = 0;
    var iv = setInterval(function () {
      n += 1;
      var token = githubToken();
      if (!token && n < 240) return;
      if (!token) {
        clearInterval(iv);
        return;
      }
      clearInterval(iv);
      loadMe().then(function (me) {
        if (!me || me.forbidden || !me.role) {
          if (me && me.forbidden) showForbidden(me.message);
          return;
        }
        applyMe(me);
      });
    }, 400);
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

    global.__SONAR_CMS_READY = waitForGithubToken(isLocalHost() ? 0 : 8000).then(function () {
      return Promise.all([
        fetch('/admin/config.yml', { cache: 'no-store' }).then(function (res) { return res.text(); }),
        loadDomains(),
        loadMe()
      ]);
    }).then(function (parts) {
      var config = jsyaml.load(parts[0]);
      var file = parts[1] || { domains: [], subdomains: [] };
      var me = parts[2] || {};
      if (me.forbidden) {
        showForbidden(me.message);
        global.__SONAR_CMS_BOOTED = true;
        return;
      }
      applyMe(me);
      global.__SONAR_MAIN_DOMAINS = file.domains || [];
      global.__SONAR_SUBDOMAINS = file.subdomains || [];
      global.__SONAR_DOMAINS = flattenDomains(file);
      config.load_config_file = false;
      patchConfig(config, global.__SONAR_DOMAINS);
      patchCategorySelect(config, global.__SONAR_DOMAINS);
      applyRoleToConfig(config, me.role === 'admin' ? 'admin' : 'superadmin');
      global.CMS.init({ config: config });
      global.__SONAR_CMS_BOOTED = true;
      if (me.anonymous || !me.role) watchLoginThenReload();
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
