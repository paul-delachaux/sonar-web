(function (global) {
  function captureAuth(name, value) {
    if (!name || !value) return;
    if (!/^authorization$/i.test(String(name))) return;
    var match = String(value).match(/^(?:Bearer|token)\s+(.+)/i);
    if (match && match[1]) global.__SONAR_GH_TOKEN = match[1].trim();
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

  if (global.XMLHttpRequest && !global.XMLHttpRequest.prototype.__sonarWrap) {
    var origSet = global.XMLHttpRequest.prototype.setRequestHeader;
    global.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      captureAuth(name, value);
      return origSet.apply(this, arguments);
    };
    global.XMLHttpRequest.prototype.__sonarWrap = true;
  }

  function pickToken(value, depth) {
    if (value == null || depth > 5) return '';
    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (/^(gho_|ghp_|ghu_|github_pat_)/.test(trimmed)) return trimmed;
      if (trimmed.length > 24 && /^[A-Za-z0-9_\-.]+$/.test(trimmed)) return trimmed;
      return '';
    }
    if (typeof value !== 'object') return '';
    var keys = ['token', 'access_token', 'accessToken', 'oauth_token', 'oauthToken'];
    for (var i = 0; i < keys.length; i++) {
      var found = pickToken(value[keys[i]], depth + 1);
      if (found) return found;
    }
    return '';
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

  function githubToken() {
    if (global.__SONAR_GH_TOKEN) return global.__SONAR_GH_TOKEN;
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
    var headers = { Accept: 'application/json' };
    var token = githubToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    global.__sonarArticlesPromise = fetch('/api/admin/articles', { headers: headers })
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
    githubToken: githubToken
  };
})(window);
