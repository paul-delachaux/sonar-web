/**
 * Sélection multiple sur les listes Decap (articles, brèves, catégories) :
 * visibilité et suppression via /api/admin/bulk-articles.
 * Les cases sont en overlay hors du DOM React, pour éviter le clignotement.
 */
(function (global) {
  var selected = Object.create(null);
  var lastCollection = '';
  var extrasKey = '';
  var extrasLoading = false;
  var extrasSource = null;
  var extrasLoadedFor = '';
  var busy = false;
  var scheduled = false;
  var posFrame = 0;

  function githubToken() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.githubToken === 'function') return search.githubToken();
    return '';
  }

  function authHeaders() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.authHeaders === 'function') {
      return search.authHeaders({ Accept: 'application/json', 'Content-Type': 'application/json' });
    }
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    var token = githubToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Sonar-GitHub'] = token;
    }
    return headers;
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

  function syncHits() {
    Array.prototype.forEach.call(document.querySelectorAll('#sonar-bulk-overlay .sonar-bulk-hit'), function (hit) {
      var slug = hit.getAttribute('data-slug') || '';
      hit.classList.toggle('is-on', !!selected[slug]);
      hit.setAttribute('aria-pressed', selected[slug] ? 'true' : 'false');
    });
  }

  function positionHits() {
    var host = document.getElementById('sonar-bulk-overlay');
    if (!host) return;
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
    if (!isListView()) {
      document.body.classList.remove('sonar-bulk-on');
      host.style.display = 'none';
      host.innerHTML = '';
      return;
    }
    document.body.classList.add('sonar-bulk-on');
    host.style.display = '';
    var links = entryLinks();
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

  function renderExtras(items) {
    if (!items.length) {
      extrasKey = '';
      var empty = document.getElementById('sonar-extra-cards');
      if (empty) empty.remove();
      injectChecks();
      return;
    }
    var host = extrasHost();
    if (!host) return;
    var key = items.map(function (article) { return article.slug; }).join('|');
    if (key === extrasKey && host.childNodes.length === items.length) {
      injectChecks();
      return;
    }
    extrasKey = key;
    host.innerHTML = '';
    items.forEach(function (article) {
      var dest = collectionNameFor(article.category) || (article.layout_type === 'breve' ? 'breves' : 'articles');
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
  }

  function loadExtras() {
    var host = document.getElementById('sonar-extra-cards');
    if (!isListView()) {
      if (host) host.remove();
      extrasKey = '';
      extrasLoading = false;
      extrasSource = null;
      extrasLoadedFor = '';
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
      return;
    }
    var labels = Object.create(null);
    children.forEach(function (sub) { labels[sub.slug] = sub.label || sub.slug; });

    function apply(articles) {
      if (currentCollection() !== col) return;
      var already = Object.create(null);
      entryLinks().forEach(function (link) {
        if (link.closest('.sonar-extra-card')) return;
        var slug = slugFromLink(link);
        if (slug) already[slug] = true;
      });
      var extras = (articles || []).filter(function (article) {
        return article && labels[article.category] && !already[article.slug];
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
    var search = global.SonarArticleSearch;
    if (!search || typeof search.fetchArticles !== 'function') return;
    extrasLoading = true;
    search.fetchArticles().then(function (articles) {
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
    document.body.classList.add('sonar-bulk-on');
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
    fetch('/api/admin/bulk-articles', {
      method: 'POST',
      headers: authHeaders(),
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
    }
    placeBar();
    injectChecks();
    loadExtras();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(tick, 200);
  }

  function onScroll() {
    if (posFrame) return;
    posFrame = global.requestAnimationFrame(function () {
      posFrame = 0;
      positionHits();
    });
  }

  window.addEventListener('hashchange', schedule);
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
