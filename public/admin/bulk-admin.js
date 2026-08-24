/**
 * Sélection multiple sur les listes Decap (articles, brèves, catégories) :
 * visibilité et suppression, en un commit GitHub.
 */
(function (global) {
  var REPO = 'paul-delachaux/sonar-web';
  var BRANCH = 'main';
  var ARTICLES_DIR = 'src/content/articles';
  var API = 'https://api.github.com';
  var selected = Object.create(null);
  var lastCollection = '';
  var extraKey = '';
  var busy = false;
  var scheduled = false;

  function githubToken() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.githubToken === 'function') return search.githubToken();
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
    return col === 'articles' || col === 'breves' || col === 'contenus_visibles' || col === 'contenus_masques' || col.indexOf('articles_') === 0;
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
      return !link.closest('aside') && !link.closest('.sonar-bulk-bar') && !link.closest('.sonar-extra-card');
    });
    var extra = Array.prototype.slice.call(document.querySelectorAll('.sonar-extra-card a[data-slug]'));
    return native.concat(extra);
  }

  function cardHost(link) {
    var parent = link.parentElement;
    if (!parent) return link;
    var nested = parent.querySelectorAll('a[href*="/entries/"]');
    if (nested.length === 1 && parent !== document.body && parent.tagName !== 'MAIN') return parent;
    return link;
  }

  function selectedSlugs() {
    return Object.keys(selected).filter(function (slug) { return selected[slug]; });
  }

  function setStatus(text) {
    var node = document.getElementById('sonar-bulk-status');
    if (node) node.textContent = text || '';
  }

  function refreshBar() {
    var bar = document.getElementById('sonar-bulk-bar');
    if (!bar) return;
    var slugs = selectedSlugs();
    var count = document.getElementById('sonar-bulk-count');
    var all = document.getElementById('sonar-bulk-all');
    var buttons = bar.querySelectorAll('button');
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

  function findHit(parent, slug) {
    var kids = parent ? parent.children : [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains('sonar-bulk-hit') && kids[i].getAttribute('data-slug') === slug) {
        return kids[i];
      }
    }
    return null;
  }

  function placeHit(hit, link) {
    var parent = link.parentElement;
    if (!parent) return;
    if (!parent.style.position || parent.style.position === 'static') parent.style.position = 'relative';
    hit.style.top = link.offsetTop + 'px';
    hit.style.left = link.offsetLeft + 'px';
    hit.style.height = Math.max(link.offsetHeight, 44) + 'px';
  }

  function syncHits() {
    Array.prototype.forEach.call(document.querySelectorAll('.sonar-bulk-hit'), function (hit) {
      var slug = hit.getAttribute('data-slug') || '';
      hit.classList.toggle('is-on', !!selected[slug]);
      hit.setAttribute('aria-pressed', selected[slug] ? 'true' : 'false');
    });
  }

  function injectChecks() {
    Array.prototype.forEach.call(document.querySelectorAll('.sonar-bulk-check'), function (el) {
      el.remove();
    });
    entryLinks().forEach(function (link) {
      var slug = slugFromLink(link);
      if (!slug) return;
      var parent = link.parentElement;
      if (!parent) return;
      var hit = findHit(parent, slug);
      if (!hit) {
        hit = document.createElement('button');
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
        hit.addEventListener('mousedown', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });
        parent.insertBefore(hit, link);
      }
      var shared = parent.querySelectorAll('a[href*="/entries/"]').length > 1;
      parent.classList.add('sonar-bulk-host');
      if (shared) {
        if (!link.getAttribute('data-sonar-pad')) {
          link.setAttribute('data-sonar-pad', '1');
          var current = parseFloat(window.getComputedStyle(link).paddingLeft) || 0;
          link.style.paddingLeft = (current + 28) + 'px';
        }
      } else {
        parent.classList.add('sonar-bulk-pad');
      }
      placeHit(hit, link);
    });
    syncHits();
    refreshBar();
  }

  function placeBar() {
    var existing = document.getElementById('sonar-bulk-bar');
    if (!isListView()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      injectChecks();
      injectChildEntries();
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
      injectChecks();
    });
    bar.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-bulk]');
      if (!btn || busy) return;
      runBulk(btn.getAttribute('data-bulk'));
    });
    injectChecks();
    injectChildEntries();
  }

  function injectChildEntries() {
    var box = document.getElementById('sonar-extra-cards');
    if (!isListView()) {
      if (box) box.remove();
      extraKey = '';
      return;
    }
    var domain = domainForCollection(currentCollection());
    var children = (domain && !domain.parent)
      ? (global.__SONAR_SUBDOMAINS || []).filter(function (sub) {
        return sub && sub.parent === domain.slug && sub.slug;
      })
      : [];
    if (!children.length) {
      if (box) box.remove();
      extraKey = '';
      return;
    }
    var labels = Object.create(null);
    children.forEach(function (sub) { labels[sub.slug] = sub.label || sub.slug; });

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

    function fromApi() {
      var search = global.SonarArticleSearch;
      if (!search || typeof search.fetchArticles !== 'function') return Promise.resolve([]);
      global.__sonarArticlesPromise = null;
      return search.fetchArticles().catch(function () { return []; });
    }

    function fromGithub() {
      var token = githubToken();
      if (!token) return Promise.resolve([]);
      return fetch(API + '/repos/' + REPO + '/contents/' + ARTICLES_DIR + '?ref=' + BRANCH, {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'le-sonar-admin'
        }
      }).then(function (res) { return res.ok ? res.json() : []; }).then(function (files) {
        if (!Array.isArray(files)) return [];
        return Promise.all(files.filter(function (file) {
          return file && file.type === 'file' && /\.mdx?$/.test(file.name || '');
        }).map(function (file) {
          return fetch(file.url, {
            headers: {
              Authorization: 'Bearer ' + token,
              Accept: 'application/vnd.github.raw',
              'User-Agent': 'le-sonar-admin'
            }
          }).then(function (res) { return res.ok ? res.text() : ''; })
            .then(function (raw) { return parseArticleMarkdown(file.name, raw); });
        }));
      }).catch(function () { return []; });
    }

    Promise.all([fromApi(), fromGithub()]).then(function (parts) {
      if (currentCollection() !== collectionNameFor(domain.slug)) return;
      var bySlug = Object.create(null);
      function add(item) {
        if (!item || !item.slug) return;
        var prev = bySlug[item.slug];
        if (!prev || labels[item.category]) bySlug[item.slug] = item;
      }
      (parts[0] || []).forEach(add);
      (parts[1] || []).forEach(add);
      var already = Object.create(null);
      entryLinks().forEach(function (link) {
        if (link.closest('.sonar-extra-card')) return;
        var slug = slugFromLink(link);
        if (slug) already[slug] = true;
      });
      var extras = Object.keys(bySlug).map(function (slug) { return bySlug[slug]; }).filter(function (article) {
        return article && labels[article.category] && !already[article.slug];
      });
      var key = extras.map(function (article) { return article.slug; }).sort().join('|');
      if (key === extraKey && document.getElementById('sonar-extra-cards')) {
        injectChecks();
        return;
      }
      extraKey = key;
      var host = document.getElementById('sonar-extra-cards');
      if (!host) {
        host = document.createElement('div');
        host.id = 'sonar-extra-cards';
        var natives = Array.prototype.filter.call(document.querySelectorAll('#nc-root a[href*="/collections/' + currentCollection() + '/entries/"]'), function (link) {
          return !link.closest('aside') && !link.closest('.sonar-extra-card');
        });
        var last = natives[natives.length - 1];
        var bar = document.getElementById('sonar-bulk-bar');
        if (last) {
          var lastHost = cardHost(last);
          var after = lastHost && lastHost.parentElement ? lastHost : last;
          after.parentElement.insertBefore(host, after.nextSibling);
        } else if (bar && bar.parentNode) {
          bar.parentNode.insertBefore(host, bar.nextSibling);
        } else {
          return;
        }
      }
      host.innerHTML = '';
      extras.forEach(function (article) {
        var dest = collectionNameFor(article.category) || (article.layout_type === 'breve' ? 'breves' : 'articles');
        var card = document.createElement('div');
        card.className = 'sonar-extra-card sonar-bulk-host sonar-bulk-pad';
        var link = document.createElement('a');
        link.setAttribute('data-slug', article.slug);
        link.href = '#/collections/' + dest + '/entries/' + encodeURIComponent(article.slug);
        link.appendChild(document.createTextNode(article.title || article.slug));
        var tag = document.createElement('span');
        tag.className = 'sonar-extra-tag';
        tag.textContent = labels[article.category];
        link.appendChild(tag);
        card.appendChild(link);
        host.appendChild(card);
      });
      injectChecks();
    }).catch(function () {});
  }

  function gh(path, options) {
    var token = githubToken();
    if (!token) return Promise.reject(new Error('Connectez-vous à GitHub dans l’admin.'));
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
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

  function listArticleFiles() {
    return gh('/repos/' + REPO + '/contents/' + ARTICLES_DIR + '?ref=' + BRANCH).then(function (files) {
      if (!Array.isArray(files)) throw new Error('Impossible de lister les articles sur GitHub.');
      return files.filter(function (file) {
        return file && file.type === 'file' && /\.mdx?$/.test(file.name || '');
      });
    });
  }

  function fileForSlug(files, slug) {
    var wanted = String(slug || '');
    var decoded = wanted;
    try { decoded = decodeURIComponent(wanted); } catch (e) {}
    for (var i = 0; i < files.length; i++) {
      var stem = String(files[i].name || '').replace(/\.mdx?$/, '');
      if (stem === wanted || stem === decoded) return files[i];
    }
    return null;
  }

  function setVisible(raw, visible) {
    var line = 'isVisible: ' + (visible ? 'true' : 'false');
    if (/^isVisible:\s*/m.test(raw)) return raw.replace(/^isVisible:\s*.*$/m, line);
    if (/^---\r?\n/.test(raw)) return raw.replace(/^---\r?\n/, function (open) { return open + line + '\n'; });
    return line + '\n' + raw;
  }

  function fetchRaw(file) {
    var token = githubToken();
    return fetch(file.url, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github.raw',
        'User-Agent': 'le-sonar-admin'
      }
    }).then(function (res) {
      if (!res.ok) throw new Error('Lecture impossible : ' + file.name);
      return res.text();
    });
  }

  function createBlob(content) {
    return gh('/repos/' + REPO + '/git/blobs', {
      method: 'POST',
      body: { content: content, encoding: 'utf-8' }
    }).then(function (data) { return data.sha; });
  }

  function commitTree(changes, message) {
    return gh('/repos/' + REPO + '/git/ref/heads/' + BRANCH).then(function (ref) {
      var commitSha = ref && ref.object && ref.object.sha;
      if (!commitSha) throw new Error('Branche GitHub introuvable.');
      return gh('/repos/' + REPO + '/git/commits/' + commitSha).then(function (commit) {
        var baseTree = commit.tree && commit.tree.sha;
        return gh('/repos/' + REPO + '/git/trees', {
          method: 'POST',
          body: { base_tree: baseTree, tree: changes }
        }).then(function (tree) {
          return gh('/repos/' + REPO + '/git/commits', {
            method: 'POST',
            body: { message: message, tree: tree.sha, parents: [commitSha] }
          });
        }).then(function (newCommit) {
          return gh('/repos/' + REPO + '/git/refs/heads/' + BRANCH, {
            method: 'PATCH',
            body: { sha: newCommit.sha }
          });
        });
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
    busy = true;
    refreshBar();
    setStatus('Enregistrement…');
    var token = githubToken();
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    fetch('/api/admin/bulk-articles', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ action: action, slugs: slugs })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status);
        return data;
      });
    }).then(function (data) {
      if (global.__sonarArticlesPromise) global.__sonarArticlesPromise = null;
      var extra = data && data.missing && data.missing.length
        ? ' (' + data.missing.length + ' introuvable' + (data.missing.length > 1 ? 's' : '') + ')'
        : '';
      setStatus('Enregistré.' + extra + ' Rechargement…');
      setTimeout(function () { global.location.reload(); }, 500);
    }).catch(function (err) {
      busy = false;
      refreshBar();
      setStatus(err && err.message ? err.message : 'Action impossible.');
    });
  }

  function tick() {
    scheduled = false;
    var col = currentCollection();
    if (col !== lastCollection) {
      lastCollection = col;
      selected = Object.create(null);
      extraKey = '';
    }
    placeBar();
    if (isListView()) injectChildEntries();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(tick, 80);
  }

  window.addEventListener('hashchange', schedule);
  window.addEventListener('load', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})(window);
