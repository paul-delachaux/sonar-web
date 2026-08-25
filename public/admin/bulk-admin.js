/**
 * Actions groupées + cartes des sous-domaines.
 *
 * Local (localhost) : écriture disque via /api/admin/bulk-articles (mode DEV).
 * En ligne : commit GitHub depuis le navigateur, avec le jeton déjà stocké
 * par Decap (localStorage decap-cms-user) — sans passer par l’API Vercel.
 */
(function (global) {
  var REPO = 'paul-delachaux/sonar-web';
  var BRANCH = 'main';
  var ARTICLES_DIR = 'src/content/articles';
  var selected = Object.create(null);
  var lastCollection = '';
  var extrasKey = '';
  var extrasLoading = false;
  var extrasSource = null;
  var extrasLoadedFor = '';
  var busy = false;
  var scheduled = false;
  var posFrame = 0;
  var layoutObs = null;

  function isLocalHost() {
    return /localhost|127\.0\.0\.1/.test(String(global.location.hostname || ''));
  }

  function githubToken() {
    var keys = ['decap-cms-user', 'netlify-cms-user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = global.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var data = JSON.parse(raw);
        var token = data && (data.token || data.access_token);
        if (typeof token === 'string' && token.trim()) return token.trim();
      } catch (e) {}
    }
    try {
      var cms = global.CMS;
      var store = cms && (cms.store || (cms.getStore && cms.getStore()));
      if (store && typeof store.getState === 'function') {
        var auth = store.getState().auth;
        if (auth && typeof auth.get === 'function') {
          var fromMap = auth.get('token') || auth.get('access_token');
          if (fromMap) return String(fromMap);
        } else if (auth && (auth.token || auth.access_token)) {
          return String(auth.token || auth.access_token);
        }
      }
    } catch (e) {}
    var search = global.SonarArticleSearch;
    if (search && typeof search.githubToken === 'function') return search.githubToken() || '';
    return '';
  }

  function currentCollection() {
    var hash = String(global.location.hash || '');
    var match = hash.match(/#\/collections\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function isListView() {
    var hash = String(global.location.hash || '');
    if (/\/entries\//.test(hash) || /\/new(?:\?|$)/.test(hash)) return false;
    var col = currentCollection();
    if (!col || col === 'settings' || col === 'domains') return false;
    return col === 'articles' || col === 'breves' || col === 'revues_musicales' || col === 'contenus_visibles' || col === 'contenus_masques' || col.indexOf('articles_') === 0;
  }

  function slugFromHref(href) {
    var match = String(href || '').match(/\/entries\/([^/?#]+)/);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return match[1];
    }
  }

  function slugFromLink(link) {
    if (!link) return '';
    return link.getAttribute('data-slug') || slugFromHref(link.getAttribute('href'));
  }

  function collectionNameFor(slug) {
    return global.SonarDomainCollectionName
      ? global.SonarDomainCollectionName(slug)
      : ('articles_' + String(slug || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, ''));
  }

  function domainForCollection(col) {
    var list = global.__SONAR_DOMAINS || [];
    for (var i = 0; i < list.length; i++) {
      if (collectionNameFor(list[i].slug) === col) return list[i];
    }
    return null;
  }

  function entryLinks() {
    var col = currentCollection();
    if (!col) return [];
    var needle = '/collections/' + col + '/entries/';
    var native = Array.prototype.filter.call(document.querySelectorAll('#nc-root a[href*="' + needle + '"]'), function (link) {
      return !link.closest('aside') && !link.closest('.sonar-bulk-bar') && !link.closest('.sonar-extra-card') && !link.closest('.sonar-native-hidden');
    });
    var extra = Array.prototype.slice.call(document.querySelectorAll('.sonar-extra-card a[data-slug]'));
    return native.concat(extra);
  }

  function selectedSlugs() {
    return Object.keys(selected).filter(function (slug) { return selected[slug]; });
  }

  function setStatus(text) {
    var node = document.getElementById('sonar-bulk-status');
    if (node) node.textContent = text || '';
    onScroll();
  }

  function refreshBar() {
    var bar = document.getElementById('sonar-bulk-bar');
    if (!bar) return;
    var slugs = selectedSlugs();
    var count = document.getElementById('sonar-bulk-count');
    var all = document.getElementById('sonar-bulk-all');
    var buttons = bar.querySelectorAll('button[data-bulk]');
    if (count) count.textContent = slugs.length ? slugs.length + ' sélectionné' + (slugs.length > 1 ? 's' : '') : '';
    if (all) {
      var total = entryLinks().length;
      all.checked = total > 0 && slugs.length === total;
      all.indeterminate = slugs.length > 0 && slugs.length < total;
    }
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.disabled = busy || slugs.length === 0;
    });
  }

  function toggleSlug(slug) {
    if (!slug) return;
    if (selected[slug]) delete selected[slug];
    else selected[slug] = true;
    syncHits();
    refreshBar();
  }

  function overlay() {
    var el = document.getElementById('sonar-bulk-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sonar-bulk-overlay';
      document.body.appendChild(el);
    }
    return el;
  }

  function hideOverlay() {
    var host = document.getElementById('sonar-bulk-overlay');
    if (!host) return;
    host.style.display = 'none';
    host.innerHTML = '';
  }

  function nativeCardHost(link) {
    var parent = link.parentElement;
    if (!parent) return link;
    var nested = parent.querySelectorAll('a[href*="/entries/"]');
    if (nested.length === 1 && parent !== document.body && parent.tagName !== 'MAIN') return parent;
    return link;
  }

  function revealHiddenNatives() {
    Array.prototype.forEach.call(document.querySelectorAll('.sonar-native-hidden'), function (el) {
      el.classList.remove('sonar-native-hidden');
    });
  }

  function hideNativeDuplicates(slugs) {
    revealHiddenNatives();
    var col = currentCollection();
    if (!col || !slugs) return;
    var needle = '/collections/' + col + '/entries/';
    Array.prototype.forEach.call(document.querySelectorAll('#nc-root a[href*="' + needle + '"]'), function (link) {
      if (link.closest('aside') || link.closest('.sonar-extra-card') || link.closest('.sonar-bulk-bar')) return;
      var slug = slugFromLink(link);
      if (!slug || !slugs[slug]) return;
      nativeCardHost(link).classList.add('sonar-native-hidden');
    });
  }

  function observeLayout() {
    if (!global.ResizeObserver) return;
    if (!layoutObs) {
      layoutObs = new ResizeObserver(function () { onScroll(); });
    }
    var bar = document.getElementById('sonar-bulk-bar');
    var column = bar && bar.parentNode;
    if (column && column !== document.body) layoutObs.observe(column);
  }

  function syncHits() {
    Array.prototype.forEach.call(document.querySelectorAll('#sonar-bulk-overlay .sonar-bulk-hit'), function (hit) {
      var slug = hit.getAttribute('data-slug') || '';
      hit.classList.toggle('is-on', !!selected[slug]);
      hit.setAttribute('aria-pressed', selected[slug] ? 'true' : 'false');
    });
  }

  function positionHits() {
    var host = document.getElementById('sonar-bulk-overlay');
    if (!host || host.style.display === 'none') return;
    var bySlug = Object.create(null);
    Array.prototype.forEach.call(host.children, function (hit) {
      bySlug[hit.getAttribute('data-slug') || ''] = hit;
    });
    entryLinks().forEach(function (link) {
      var slug = slugFromLink(link);
      var hit = bySlug[slug];
      if (!hit) return;
      var rect = link.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) {
        hit.style.display = 'none';
        return;
      }
      hit.style.display = 'flex';
      hit.style.top = Math.round(rect.top) + 'px';
      hit.style.left = Math.round(rect.left + 8) + 'px';
      hit.style.height = Math.max(Math.round(rect.height), 44) + 'px';
    });
  }

  function injectChecks() {
    var host = overlay();
    var links = isListView() ? entryLinks() : [];
    if (!links.length) {
      document.body.classList.remove('sonar-bulk-on');
      hideOverlay();
      return;
    }
    document.body.classList.add('sonar-bulk-on');
    host.style.display = '';
    var wanted = Object.create(null);
    links.forEach(function (link) {
      var slug = slugFromLink(link);
      if (slug) wanted[slug] = true;
    });
    Array.prototype.slice.call(host.children).forEach(function (hit) {
      var slug = hit.getAttribute('data-slug') || '';
      if (!wanted[slug]) hit.remove();
    });
    var existing = Object.create(null);
    Array.prototype.forEach.call(host.children, function (hit) {
      existing[hit.getAttribute('data-slug') || ''] = hit;
    });
    Object.keys(wanted).forEach(function (slug) {
      if (existing[slug]) return;
      var hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'sonar-bulk-hit';
      hit.setAttribute('data-slug', slug);
      hit.setAttribute('aria-label', 'Sélectionner');
      hit.innerHTML = '<span class="sonar-bulk-box"></span>';
      hit.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleSlug(slug);
      });
      host.appendChild(hit);
    });
    syncHits();
    positionHits();
    refreshBar();
  }

  function extrasHost() {
    var bar = document.getElementById('sonar-bulk-bar');
    if (!bar || !bar.parentNode) return null;
    var el = document.getElementById('sonar-extra-cards');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sonar-extra-cards';
      el.className = 'sonar-extra-wrap';
      bar.parentNode.insertBefore(el, bar.nextSibling);
    }
    return el;
  }

  function parseArticleMarkdown(name, raw) {
    var slug = String(name || '').replace(/\.mdx?$/, '');
    var titleMatch = String(raw || '').match(/^title:\s*(.+)$/m);
    var catMatch = String(raw || '').match(/^category:\s*["']?([a-z0-9-]+)/m);
    var layoutMatch = String(raw || '').match(/^layout_type:\s*["']?(\w+)/m);
    return {
      slug: slug,
      title: titleMatch ? titleMatch[1].replace(/^["']|["']$/g, '').trim() : slug,
      category: catMatch ? catMatch[1] : '',
      layout_type: layoutMatch ? layoutMatch[1] : ''
    };
  }

  function ghHeaders() {
    return {
      Authorization: 'token ' + githubToken(),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'le-sonar-admin'
    };
  }

  function articlesFromGithub() {
    var token = githubToken();
    if (!token) return Promise.resolve([]);
    var query = '{ repository(owner:"paul-delachaux", name:"sonar-web") { object(expression:"' + BRANCH + ':' + ARTICLES_DIR + '") { ... on Tree { entries { name object { ... on Blob { text } } } } } } }';
    return fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: 'bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'le-sonar-admin'
      },
      body: JSON.stringify({ query: query })
    }).then(function (res) {
      return res.json().catch(function () { return {}; });
    }).then(function (body) {
      var entries = body && body.data && body.data.repository && body.data.repository.object && body.data.repository.object.entries;
      if (!Array.isArray(entries) || !entries.length) return articlesFromGithubRest();
      return entries.filter(function (file) {
        return file && /\.mdx?$/.test(file.name || '');
      }).map(function (file) {
        var text = file.object && file.object.text;
        return parseArticleMarkdown(file.name, text || '');
      });
    }).catch(function () {
      return articlesFromGithubRest();
    });
  }

  function articlesFromGithubRest() {
    var token = githubToken();
    if (!token) return Promise.resolve([]);
    return fetch('https://api.github.com/repos/' + REPO + '/contents/' + ARTICLES_DIR + '?ref=' + BRANCH, {
      headers: ghHeaders()
    }).then(function (res) { return res.ok ? res.json() : []; }).then(function (files) {
      if (!Array.isArray(files)) return [];
      var md = files.filter(function (file) {
        return file && file.type === 'file' && /\.mdx?$/.test(file.name || '');
      });
      return Promise.all(md.map(function (file) {
        return fetch(file.url, {
          headers: {
            Authorization: 'token ' + token,
            Accept: 'application/vnd.github.raw',
            'User-Agent': 'le-sonar-admin'
          }
        }).then(function (res) { return res.ok ? res.text() : ''; })
          .then(function (raw) { return parseArticleMarkdown(file.name, raw); });
      }));
    }).catch(function () { return []; });
  }

  function articlesFromLocalApi() {
    var search = global.SonarArticleSearch;
    if (!search || typeof search.fetchArticles !== 'function') return Promise.resolve([]);
    return search.fetchArticles().catch(function () { return []; });
  }

  function renderExtras(items) {
    if (!items.length) {
      extrasKey = '';
      revealHiddenNatives();
      var empty = document.getElementById('sonar-extra-cards');
      if (empty) empty.remove();
      injectChecks();
      return;
    }
    var hidden = Object.create(null);
    items.forEach(function (article) { if (article && article.slug) hidden[article.slug] = true; });
    hideNativeDuplicates(hidden);
    var host = extrasHost();
    if (!host) return;
    var key = items.map(function (article) { return article.slug; }).join('|');
    if (key === extrasKey && host.querySelectorAll('.sonar-extra-card').length === items.length) {
      injectChecks();
      return;
    }
    extrasKey = key;
    host.innerHTML = '';
    var title = document.createElement('p');
    title.className = 'sonar-extra-label';
    title.textContent = 'Aussi dans les sous-domaines';
    host.appendChild(title);
    items.forEach(function (article) {
      var dest = collectionNameFor(article.category) || (article.layout_type === 'breve' ? 'breves' : article.layout_type === 'revue_musicale' ? 'revues_musicales' : 'articles');
      var card = document.createElement('div');
      card.className = 'sonar-extra-card';
      var link = document.createElement('a');
      link.setAttribute('data-slug', article.slug);
      link.href = '#/collections/' + dest + '/entries/' + encodeURIComponent(article.slug);
      link.appendChild(document.createTextNode(article.title || article.slug));
      var tag = document.createElement('span');
      tag.className = 'sonar-extra-tag';
      tag.textContent = article._label || article.category;
      link.appendChild(tag);
      card.appendChild(link);
      host.appendChild(card);
    });
    injectChecks();
    onScroll();
  }

  function loadExtras() {
    var host = document.getElementById('sonar-extra-cards');
    if (!isListView()) {
      if (host) host.remove();
      extrasKey = '';
      extrasLoading = false;
      extrasSource = null;
      extrasLoadedFor = '';
      revealHiddenNatives();
      return;
    }
    var col = currentCollection();
    var domain = domainForCollection(col);
    var children = (domain && !domain.parent)
      ? (global.__SONAR_SUBDOMAINS || []).filter(function (sub) {
        return sub && sub.parent === domain.slug && sub.slug;
      })
      : [];
    if (!children.length) {
      if (host) host.remove();
      extrasKey = '';
      extrasLoading = false;
      revealHiddenNatives();
      injectChecks();
      return;
    }
    var labels = Object.create(null);
    children.forEach(function (sub) { labels[sub.slug] = sub.label || sub.slug; });

    function apply(articles) {
      if (currentCollection() !== col) return;
      var extras = (articles || []).filter(function (article) {
        return article && labels[article.category];
      }).map(function (article) {
        var copy = {};
        Object.keys(article).forEach(function (key) { copy[key] = article[key]; });
        copy._label = labels[article.category];
        return copy;
      });
      renderExtras(extras);
    }

    if (extrasLoadedFor === col && extrasSource) {
      apply(extrasSource);
      return;
    }
    if (extrasLoading) return;
    extrasLoading = true;
    var loader = githubToken()
      ? articlesFromGithub()
      : (isLocalHost() ? articlesFromLocalApi() : Promise.resolve([]));
    loader.then(function (articles) {
      extrasLoading = false;
      extrasSource = articles || [];
      extrasLoadedFor = col;
      apply(extrasSource);
    }).catch(function () {
      extrasLoading = false;
    });
  }

  function placeBar() {
    var existing = document.getElementById('sonar-bulk-bar');
    if (!isListView()) {
      document.body.classList.remove('sonar-bulk-on');
      if (existing) existing.style.display = 'none';
      return;
    }
    if (existing) {
      existing.style.display = '';
      return;
    }
    var bar = document.createElement('div');
    bar.id = 'sonar-bulk-bar';
    bar.className = 'sonar-bulk-bar';
    bar.innerHTML =
      '<label><input id="sonar-bulk-all" type="checkbox"> Tout sélectionner</label>' +
      '<span id="sonar-bulk-count" class="sonar-bulk-count"></span>' +
      '<button type="button" class="sonar-bulk-visible" data-bulk="show">Rendre visibles</button>' +
      '<button type="button" class="sonar-bulk-hide" data-bulk="hide">Masquer</button>' +
      '<button type="button" class="sonar-bulk-remove" data-bulk="delete">Supprimer</button>' +
      '<p id="sonar-bulk-status" class="sonar-bulk-status"></p>';
    var top = document.querySelector('#nc-root [class*="CollectionTop"]');
    var first = entryLinks()[0];
    var aside = document.querySelector('#nc-root aside');
    var main = aside && aside.nextElementSibling;
    if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling);
    else if (first && first.parentNode && first.parentNode.parentNode) first.parentNode.parentNode.insertBefore(bar, first.parentNode);
    else if (main) main.insertBefore(bar, main.firstChild);
    else return;
    document.getElementById('sonar-bulk-all').addEventListener('change', function (event) {
      var on = event.currentTarget.checked;
      selected = Object.create(null);
      if (on) {
        entryLinks().forEach(function (link) {
          var slug = slugFromLink(link);
          if (slug) selected[slug] = true;
        });
      }
      syncHits();
      refreshBar();
    });
    bar.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-bulk]');
      if (!btn || busy) return;
      runBulk(btn.getAttribute('data-bulk'));
    });
  }

  function setVisible(raw, visible) {
    var line = 'isVisible: ' + (visible ? 'true' : 'false');
    if (/^isVisible:\s*/m.test(raw)) return raw.replace(/^isVisible:\s*.*$/m, line);
    if (/^---\r?\n/.test(raw)) return raw.replace(/^---\r?\n/, function (open) { return open + line + '\n'; });
    return line + '\n' + raw;
  }

  function gh(path, options) {
    var opts = options || {};
    return fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'token ' + githubToken(),
        Accept: 'application/vnd.github+json',
        'User-Agent': 'le-sonar-admin',
        'Content-Type': 'application/json'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.message || 'GitHub HTTP ' + res.status);
        return data;
      });
    });
  }

  function runBulkGithub(action, slugs) {
    return gh('/repos/' + REPO + '/contents/' + ARTICLES_DIR + '?ref=' + BRANCH).then(function (files) {
      var md = (Array.isArray(files) ? files : []).filter(function (file) {
        return file && file.type === 'file' && /\.mdx?$/.test(file.name || '');
      });
      var matched = [];
      var missing = [];
      slugs.forEach(function (slug) {
        var decoded = slug;
        try { decoded = decodeURIComponent(slug); } catch (e) {}
        var file = md.filter(function (item) {
          var stem = String(item.name || '').replace(/\.mdx?$/, '');
          return stem === slug || stem === decoded;
        })[0];
        if (file) matched.push(file);
        else missing.push(slug);
      });
      if (!matched.length) return { done: [], missing: missing };
      var token = githubToken();
      return gh('/repos/' + REPO + '/git/ref/heads/' + BRANCH).then(function (ref) {
        var commitSha = ref.object.sha;
        return gh('/repos/' + REPO + '/git/commits/' + commitSha).then(function (commit) {
          var tree = [];
          var chain = Promise.resolve();
          if (action === 'delete') {
            matched.forEach(function (file) {
              tree.push({ path: ARTICLES_DIR + '/' + file.name, mode: '100644', type: 'blob', sha: null });
            });
          } else {
            matched.forEach(function (file) {
              chain = chain.then(function () {
                return fetch(file.url, {
                  headers: {
                    Authorization: 'token ' + token,
                    Accept: 'application/vnd.github.raw',
                    'User-Agent': 'le-sonar-admin'
                  }
                }).then(function (res) {
                  if (!res.ok) throw new Error('Lecture impossible : ' + file.name);
                  return res.text();
                }).then(function (raw) {
                  return gh('/repos/' + REPO + '/git/blobs', {
                    method: 'POST',
                    body: { content: setVisible(raw, action === 'show'), encoding: 'utf-8' }
                  }).then(function (blob) {
                    tree.push({ path: ARTICLES_DIR + '/' + file.name, mode: '100644', type: 'blob', sha: blob.sha });
                  });
                });
              });
            });
          }
          return chain.then(function () {
            var verb = action === 'delete' ? 'supprimer' : action === 'show' ? 'rendre visibles' : 'masquer';
            return gh('/repos/' + REPO + '/git/trees', {
              method: 'POST',
              body: { base_tree: commit.tree.sha, tree: tree }
            }).then(function (newTree) {
              return gh('/repos/' + REPO + '/git/commits', {
                method: 'POST',
                body: { message: 'cms: ' + verb + ' ' + matched.length + ' contenu' + (matched.length > 1 ? 's' : ''), tree: newTree.sha, parents: [commitSha] }
              });
            }).then(function (newCommit) {
              return gh('/repos/' + REPO + '/git/refs/heads/' + BRANCH, {
                method: 'PATCH',
                body: { sha: newCommit.sha }
              });
            }).then(function () {
              return { done: matched.map(function (file) { return String(file.name).replace(/\.mdx?$/, ''); }), missing: missing };
            });
          });
        });
      });
    });
  }

  function runBulkLocal(action, slugs) {
    return fetch('/api/admin/bulk-articles', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, slugs: slugs })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status);
        return data;
      });
    });
  }

  function runBulk(action) {
    var slugs = selectedSlugs();
    if (!slugs.length || busy) return;
    if (action === 'delete') {
      var ok = global.confirm('Supprimer ' + slugs.length + ' contenu' + (slugs.length > 1 ? 's' : '') + ' du projet ? Cette action est irréversible.');
      if (!ok) return;
    }
    if (!isLocalHost() && !githubToken()) {
      setStatus('Session GitHub introuvable. Rechargez /admin après vous être connecté.');
      return;
    }
    busy = true;
    refreshBar();
    setStatus('Enregistrement…');
    var job = isLocalHost() ? runBulkLocal(action, slugs) : runBulkGithub(action, slugs);
    job.then(function (data) {
      if (global.__sonarArticlesPromise) global.__sonarArticlesPromise = null;
      var extra = data && data.missing && data.missing.length
        ? ' (' + data.missing.length + ' introuvable' + (data.missing.length > 1 ? 's' : '') + ')'
        : '';
      setStatus('Enregistré.' + extra + ' Rechargement…');
      setTimeout(function () { global.location.reload(); }, 700);
    }).catch(function (err) {
      busy = false;
      refreshBar();
      setStatus(err && err.message ? err.message : 'Action impossible.');
    });
  }

  function ourNode(node) {
    return !!(node && node.closest && (
      node.closest('#sonar-bulk-bar') ||
      node.closest('#sonar-bulk-overlay') ||
      node.closest('#sonar-extra-cards') ||
      node.id === 'sonar-bulk-bar' ||
      node.id === 'sonar-bulk-overlay' ||
      node.id === 'sonar-extra-cards'
    ));
  }

  function tick() {
    scheduled = false;
    var col = currentCollection();
    if (col !== lastCollection) {
      lastCollection = col;
      selected = Object.create(null);
      extrasKey = '';
      extrasLoading = false;
      extrasSource = null;
      extrasLoadedFor = '';
      setStatus('');
      hideOverlay();
      revealHiddenNatives();
    }
    placeBar();
    observeLayout();
    injectChecks();
    loadExtras();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(tick, 250);
  }

  function onScroll() {
    if (posFrame) return;
    posFrame = global.requestAnimationFrame(function () {
      posFrame = 0;
      positionHits();
    });
  }

  window.addEventListener('hashchange', function () {
    hideOverlay();
    document.body.classList.remove('sonar-bulk-on');
    schedule();
  });
  window.addEventListener('load', schedule);
  window.addEventListener('resize', onScroll);
  document.addEventListener('scroll', onScroll, true);
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mut = mutations[i];
      if (ourNode(mut.target)) continue;
      var nodes = [];
      if (mut.addedNodes) Array.prototype.push.apply(nodes, mut.addedNodes);
      if (mut.removedNodes) Array.prototype.push.apply(nodes, mut.removedNodes);
      var relevant = false;
      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        if (!node || node.nodeType !== 1) continue;
        if (ourNode(node)) continue;
        if (node.matches && (node.matches('a[href*="/entries/"]') || node.querySelector && node.querySelector('a[href*="/entries/"]'))) {
          relevant = true;
          break;
        }
      }
      if (relevant) {
        schedule();
        return;
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})(window);
