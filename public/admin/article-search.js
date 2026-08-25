(function (global) {
  function captureAuth(name, value) {
    if (!name || !value) return;
    if (!/^authorization$/i.test(String(name)) && !/^x-sonar-github$/i.test(String(name))) return;
    var raw = String(value).trim();
    var match = raw.match(/^(?:Bearer|token)\s+(.+)/i);
    var token = (match ? match[1] : raw).trim();
    if (token) global.__SONAR_GH_TOKEN = token;
  }

  if (typeof global.fetch === 'function' && !global.fetch.__sonarWrap) {
    var origFetch = global.fetch;
    global.fetch = function (input, init) {
      try {
        var headers = (init && init.headers) || (input && input.headers);
        if (headers) {
          if (typeof headers.get === 'function') {
            captureAuth('Authorization', headers.get('Authorization') || headers.get('authorization'));
          } else if (Array.isArray(headers)) {
            headers.forEach(function (pair) {
              if (pair && pair.length >= 2) captureAuth(pair[0], pair[1]);
            });
          } else {
            captureAuth('Authorization', headers.Authorization || headers.authorization);
          }
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    global.fetch.__sonarWrap = true;
  }

  if (global.Headers && global.Headers.prototype && !global.Headers.prototype.__sonarWrap) {
    ['append', 'set'].forEach(function (method) {
      var orig = global.Headers.prototype[method];
      if (typeof orig !== 'function') return;
      global.Headers.prototype[method] = function (name, value) {
        captureAuth(name, value);
        return orig.apply(this, arguments);
      };
    });
    global.Headers.prototype.__sonarWrap = true;
  }

  if (global.XMLHttpRequest && !global.XMLHttpRequest.prototype.__sonarWrap) {
    var origSet = global.XMLHttpRequest.prototype.setRequestHeader;
    global.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      captureAuth(name, value);
      return origSet.apply(this, arguments);
    };
    global.XMLHttpRequest.prototype.__sonarWrap = true;
  }

  function asToken(value) {
    if (value == null) return '';
    if (typeof value !== 'string') return '';
    var trimmed = value.trim();
    if (!trimmed || trimmed.length < 12) return '';
    if (/^(null|undefined|true|false)$/i.test(trimmed)) return '';
    return trimmed;
  }

  function pickToken(value, depth) {
    if (value == null || depth > 6) return '';
    if (typeof value === 'string') return asToken(value);
    if (typeof value !== 'object') return '';
    var keys = ['token', 'access_token', 'accessToken', 'oauth_token', 'oauthToken'];
    for (var i = 0; i < keys.length; i++) {
      var found = pickToken(value[keys[i]], depth + 1);
      if (found) return found;
    }
    return '';
  }

  function tokenFromKnownKeys() {
    var keys = ['decap-cms-user', 'netlify-cms-user', 'decap-cms.user', 'netlify-cms.user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = global.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var data = JSON.parse(raw);
        var token = pickToken(data, 0);
        if (token) return token;
      } catch (e) {}
    }
    return '';
  }

  function tokenFromCmsStore() {
    try {
      var cms = global.CMS;
      if (!cms) return '';
      var store = cms.store || (cms.getStore && cms.getStore());
      if (!store || typeof store.getState !== 'function') return '';
      var state = store.getState();
      var auth = state.auth || (state.get && state.get('auth'));
      if (!auth) return '';
      if (typeof auth.get === 'function') {
        return asToken(auth.get('token') || auth.get('access_token') || '');
      }
      return asToken(auth.token || auth.access_token || '');
    } catch (e) {
      return '';
    }
  }

  function scanStorage(storage) {
    if (!storage) return '';
    try {
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        if (!key) continue;
        var raw = storage.getItem(key);
        if (!raw) continue;
        var fromText = String(raw).match(/\b(gho_|ghp_|ghu_|github_pat_)[A-Za-z0-9_]+/);
        if (fromText) return fromText[0];
        if (!/cms|decap|netlify|github|auth|user/i.test(key)) continue;
        try {
          var parsed = pickToken(JSON.parse(raw), 0);
          if (parsed) return parsed;
        } catch (e) {}
      }
    } catch (e) {}
    return '';
  }

  function githubLoginFromValue(value, depth) {
    if (value == null || depth > 5) return '';
    if (typeof value === 'string') {
      var login = value.trim().toLowerCase();
      if (/^(github|gitlab|bitbucket|netlify|decap)$/.test(login)) return '';
      if (/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(login)) return login;
      return '';
    }
    if (typeof value !== 'object') return '';
    var keys = ['login', 'username', 'user', 'name', 'nickname'];
    for (var i = 0; i < keys.length; i++) {
      var found = githubLoginFromValue(value[keys[i]], depth + 1);
      if (found && found.indexOf(' ') === -1) return found;
    }
    return '';
  }

  function githubLogin() {
    if (global.__SONAR_GH_LOGIN) return global.__SONAR_GH_LOGIN;
    var keys = ['decap-cms-user', 'netlify-cms-user', 'decap-cms.user', 'netlify-cms.user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = global.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var found = githubLoginFromValue(JSON.parse(raw), 0);
        if (found) {
          global.__SONAR_GH_LOGIN = found;
          return found;
        }
      } catch (e) {}
    }
    try {
      var cms = global.CMS;
      var store = cms && (cms.store || (cms.getStore && cms.getStore()));
      if (store && typeof store.getState === 'function') {
        var auth = store.getState().auth;
        var user = auth && (typeof auth.get === 'function' ? auth.get('user') || auth.get('login') : auth.user || auth.login);
        var found = githubLoginFromValue(user, 0);
        if (found) {
          global.__SONAR_GH_LOGIN = found;
          return found;
        }
      }
    } catch (e) {}
    return '';
  }

  function githubToken() {
    if (global.__SONAR_GH_TOKEN) return global.__SONAR_GH_TOKEN;
    var fromStore = tokenFromCmsStore();
    if (fromStore) {
      global.__SONAR_GH_TOKEN = fromStore;
      return fromStore;
    }
    var fromKnown = tokenFromKnownKeys();
    if (fromKnown) {
      global.__SONAR_GH_TOKEN = fromKnown;
      return fromKnown;
    }
    var fromLocal = scanStorage(global.localStorage);
    if (fromLocal) {
      global.__SONAR_GH_TOKEN = fromLocal;
      return fromLocal;
    }
    var fromSession = scanStorage(global.sessionStorage);
    if (fromSession) {
      global.__SONAR_GH_TOKEN = fromSession;
      return fromSession;
    }
    return '';
  }

  function authHeaders(extra) {
    var headers = extra ? Object.assign({}, extra) : {};
    var token = githubToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Sonar-GitHub'] = token;
      headers['X-Github-Token'] = token;
    }
    return headers;
  }

  function compileQuery(raw) {
    var text = String(raw || '').trim();
    if (!text) return { ok: true, empty: true, test: function () { return true; } };
    var wrapped = text.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
    try {
      var source = wrapped ? wrapped[1] : text;
      var flags = (wrapped ? wrapped[2] : 'i').replace(/g/g, '');
      if (flags.indexOf('i') === -1) flags += 'i';
      var re = new RegExp(source, flags);
      return {
        ok: true,
        empty: false,
        test: function (value) {
          re.lastIndex = 0;
          return re.test(String(value || ''));
        }
      };
    } catch (e) {
      return { ok: false, empty: false, error: 'Expression régulière invalide' };
    }
  }

  function matchArticle(article, compiled) {
    if (!compiled || !compiled.ok || compiled.empty) return true;
    return compiled.test(article.title) || compiled.test(article.slug) || compiled.test(article.title_en);
  }

  function filterArticles(articles, rawQuery, options) {
    var compiled = compileQuery(rawQuery);
    if (!compiled.ok) return { compiled: compiled, items: [] };
    var opts = options || {};
    var items = (articles || []).filter(function (article) {
      if (opts.visibleOnly && article.isVisible === false) return false;
      if (opts.category && article.category !== opts.category) return false;
      return matchArticle(article, compiled);
    });
    return { compiled: compiled, items: items };
  }

  function fetchArticles() {
    if (global.__sonarArticlesPromise) return global.__sonarArticlesPromise;
    global.__sonarArticlesPromise = fetch('/api/admin/articles', { headers: authHeaders({ Accept: 'application/json' }) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.message || 'Impossible de charger les articles (HTTP ' + res.status + ')');
          return data.articles || [];
        });
      })
      .catch(function (err) {
        global.__sonarArticlesPromise = null;
        throw err;
      });
    return global.__sonarArticlesPromise;
  }

  global.SonarArticleSearch = {
    compileQuery: compileQuery,
    matchArticle: matchArticle,
    filterArticles: filterArticles,
    fetchArticles: fetchArticles,
    githubToken: githubToken,
    githubLogin: githubLogin,
    authHeaders: authHeaders
  };
})(window);
