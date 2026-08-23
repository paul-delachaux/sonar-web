(function (global) {
  function githubToken() {
    var keys = ['decap-cms-user', 'netlify-cms-user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = window.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var data = JSON.parse(raw);
        if (data && (data.token || data.access_token)) return data.token || data.access_token;
      } catch (e) {}
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
