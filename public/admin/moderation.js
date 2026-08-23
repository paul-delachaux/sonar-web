(function () {
  var REASON_FALLBACK = {
    insult: 'Insultes ou harcèlement',
    spam: 'Spam',
    illegal: 'Contenu illégal ou dangereux',
    offtopic: 'Hors-sujet',
    other: 'Autre'
  };

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

  function authHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    var token = githubToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return iso;
    }
  }

  function ensurePanel() {
    var existing = document.getElementById('sonar-moderation');
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = 'sonar-moderation';
    root.hidden = true;
    root.innerHTML =
      '<div class="sonar-mod-backdrop" data-mod-close="1"></div>' +
      '<section class="sonar-mod-panel" role="dialog" aria-labelledby="sonar-mod-title">' +
        '<div class="sonar-mod-header">' +
          '<div>' +
            '<p class="sonar-mod-kicker">Modération</p>' +
            '<h2 id="sonar-mod-title">Commentaires signalés</h2>' +
          '</div>' +
          '<button type="button" class="sonar-mod-close" data-mod-close="1" aria-label="Fermer">Fermer</button>' +
        '</div>' +
        '<div class="sonar-mod-body">' +
          '<p class="sonar-mod-status" id="sonar-mod-status">Chargement…</p>' +
          '<div class="sonar-mod-sort" id="sonar-mod-sort" hidden>' +
            '<span>Trier par</span>' +
            '<button type="button" class="is-active" data-sort="date">Date</button>' +
            '<button type="button" data-sort="reason">Motif</button>' +
            '<button type="button" data-sort="count">Signalements</button>' +
          '</div>' +
          '<div class="sonar-mod-sort" id="sonar-mod-published-tools" hidden>' +
            '<div class="sonar-mod-published-line">' +
              '<span>Trier par</span>' +
              '<button type="button" class="is-active" data-pub-sort="date">Date</button>' +
              '<div class="sonar-mod-article-label">' +
                '<span>Article</span>' +
                '<div class="sonar-mod-article-search">' +
                  '<input id="sonar-mod-article-query" type="text" autocomplete="off" spellcheck="false" placeholder="Rechercher un article (palantir ou palantir|gecko)">' +
                  '<p class="sonar-mod-article-hint" id="sonar-mod-article-hint" hidden></p>' +
                  '<ul class="sonar-mod-article-results" id="sonar-mod-article-results" hidden></ul>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="sonar-mod-published-line" id="sonar-mod-article-chip-row" hidden>' +
              '<span class="sonar-mod-article-chip" id="sonar-mod-article-chip"></span>' +
              '<button type="button" class="sonar-mod-article-clear" data-article-clear="1">Tous les articles</button>' +
            '</div>' +
            '<div class="sonar-mod-published-line">' +
              '<span>Période</span>' +
              '<button type="button" data-period="today">Aujourd\'hui</button>' +
              '<button type="button" data-period="yesterday">Hier</button>' +
              '<button type="button" data-period="week">Cette semaine</button>' +
              '<button type="button" data-period="month">Ce mois-ci</button>' +
              '<button type="button" class="is-active" data-period="all">Tous</button>' +
            '</div>' +
          '</div>' +
          '<div class="sonar-mod-list" id="sonar-mod-list"></div>' +
        '</div>' +
      '</section>';
    document.body.appendChild(root);

    root.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.getAttribute && target.getAttribute('data-mod-close')) {
        closePanel();
      }
    });

    root.addEventListener('click', function (event) {
      var sortBtn = event.target.closest ? event.target.closest('[data-sort]') : null;
      if (sortBtn && sortBtn.closest && sortBtn.closest('#sonar-mod-sort')) {
        setSort(sortBtn.getAttribute('data-sort'));
        return;
      }
      var clearBtn = event.target.closest ? event.target.closest('[data-article-clear]') : null;
      if (clearBtn) {
        selectPublishedArticle('', '');
        return;
      }
      var pick = event.target.closest ? event.target.closest('[data-article-slug]') : null;
      if (pick) {
        selectPublishedArticle(pick.getAttribute('data-article-slug') || '', pick.getAttribute('data-article-title') || '');
        return;
      }
      var periodBtn = event.target.closest ? event.target.closest('[data-period]') : null;
      if (periodBtn && periodBtn.closest && periodBtn.closest('#sonar-mod-published-tools')) {
        var nextPeriod = periodBtn.getAttribute('data-period') || 'all';
        if (nextPeriod !== selectedPeriod) {
          selectedPeriod = nextPeriod;
          loadPublished(selectedArticle);
        }
        return;
      }
      var pubSort = event.target.closest ? event.target.closest('[data-pub-sort]') : null;
      if (pubSort) {
        pubSortDir = pubSortDir === 'desc' ? 'asc' : 'desc';
        showTools();
        refreshPublishedList();
        return;
      }
      var btn = event.target.closest ? event.target.closest('[data-mod-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-mod-action');
      var commentId = btn.getAttribute('data-comment-id');
      if (!action || !commentId) return;
      handleAction(commentId, action, btn);
    });
    root.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'sonar-mod-article-query') {
        if (selectedArticle) {
          selectedArticle = '';
          selectedArticleTitle = '';
          updateArticleChip();
        }
        renderArticleResults(event.target.value, true);
        refreshPublishedList();
      }
    });
    root.addEventListener('focusin', function (event) {
      if (event.target && event.target.id === 'sonar-mod-article-query') {
        renderArticleResults(event.target.value, true);
      }
    });
    root.addEventListener('keydown', function (event) {
      if (!event.target || event.target.id !== 'sonar-mod-article-query') return;
      if (event.key === 'Escape') {
        hideArticleResults();
        event.target.blur();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        pickHighlightedArticle();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveArticleHighlight(event.key === 'ArrowDown' ? 1 : -1);
      }
    });
    document.addEventListener('mousedown', function (event) {
      var box = document.querySelector('.sonar-mod-article-search');
      if (box && !box.contains(event.target)) hideArticleResults();
    });

    return root;
  }

  function setStatus(text, kind) {
    var el = document.getElementById('sonar-mod-status');
    if (!el) return;
    el.textContent = text || '';
    el.setAttribute('data-kind', kind || '');
  }

  var loadedItems = [];
  var loadedPublished = [];
  var currentView = 'reports';
  var sortKey = 'date';
  var sortDir = 'desc';
  var pubSortDir = 'desc';
  var selectedArticle = '';
  var selectedArticleTitle = '';
  var loadedArticles = [];
  var articleHighlight = 0;
  var selectedPeriod = 'all';
  var PERIOD_LABELS = {
    today: 'aujourd’hui',
    yesterday: 'hier',
    week: 'cette semaine',
    month: 'ce mois-ci',
    all: ''
  };

  function setSort(nextKey) {
    if (!nextKey) return;
    if (sortKey === nextKey) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = nextKey;
      sortDir = nextKey === 'reason' ? 'asc' : 'desc';
    }
    document.querySelectorAll('#sonar-mod-sort [data-sort]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-sort') === sortKey);
    });
    renderItems(sortItems(loadedItems));
  }

  function sortItems(items) {
    var copy = items.slice();
    var dir = sortDir === 'asc' ? 1 : -1;
    copy.sort(function (a, b) {
      if (sortKey === 'count') {
        return (Number(a.report_count || 0) - Number(b.report_count || 0)) * dir;
      }
      if (sortKey === 'reason') {
        return String(a.reason_sort || '').localeCompare(String(b.reason_sort || ''), 'fr') * dir;
      }
      var ta = new Date(a.latest_report_at || a.comment_created_at || 0).getTime();
      var tb = new Date(b.latest_report_at || b.comment_created_at || 0).getTime();
      return (ta - tb) * dir;
    });
    return copy;
  }

  function setBadge(count) {
    var badge = document.getElementById('cms-moderation-badge');
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = String(count || 0);
  }

  function setActiveNav() {
    var reported = document.getElementById('cms-moderation-nav');
    var published = document.getElementById('cms-moderation-published');
    if (reported) reported.classList.toggle('is-active', currentView === 'reports');
    if (published) published.classList.toggle('is-active', currentView === 'published');
  }

  function setPanelTitle() {
    var title = document.getElementById('sonar-mod-title');
    if (!title) return;
    title.textContent = currentView === 'published' ? 'Commentaires publiés' : 'Commentaires signalés';
  }

  function showTools() {
    var reportsSort = document.getElementById('sonar-mod-sort');
    var publishedTools = document.getElementById('sonar-mod-published-tools');
    if (reportsSort) reportsSort.hidden = currentView !== 'reports' || !loadedItems.length;
    if (publishedTools) publishedTools.hidden = currentView !== 'published';
    var pubSortBtn = document.querySelector('#sonar-mod-published-tools [data-pub-sort]');
    if (pubSortBtn) {
      pubSortBtn.classList.add('is-active');
      pubSortBtn.textContent = pubSortDir === 'asc' ? 'Date ↑' : 'Date ↓';
    }
    document.querySelectorAll('#sonar-mod-published-tools [data-period]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-period') === selectedPeriod);
    });
    updateArticleChip();
  }

  function sortPublished(items) {
    var copy = items.slice();
    var dir = pubSortDir === 'asc' ? 1 : -1;
    copy.sort(function (a, b) {
      var ta = new Date(a.comment_created_at || 0).getTime();
      var tb = new Date(b.comment_created_at || 0).getTime();
      return (ta - tb) * dir;
    });
    return copy;
  }

  function foldText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function compileArticleQuery(raw) {
    var text = String(raw || '').trim();
    if (!text) return { ok: true, empty: true, test: function () { return true; } };
    var wrapped = text.match(/^\/([\s\S]+)\/([gimsuy]*)$/);
    var source;
    var flags = 'i';
    if (wrapped) {
      source = wrapped[1];
      flags = (wrapped[2] || 'i').replace(/g/g, '');
      if (flags.indexOf('i') === -1) flags += 'i';
    } else if (/[|.*+?^${}()\[\]\\]/.test(text)) {
      source = text;
    } else {
      source = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    try {
      var re = new RegExp(source, flags);
      return {
        ok: true,
        empty: false,
        test: function (value) {
          re.lastIndex = 0;
          var str = String(value || '');
          return re.test(str) || re.test(foldText(str));
        }
      };
    } catch (e) {
      var needle = foldText(text);
      return {
        ok: true,
        empty: false,
        test: function (value) {
          return foldText(value).indexOf(needle) !== -1;
        }
      };
    }
  }

  function rememberArticlesFromComments(items) {
    var seen = {};
    loadedArticles.forEach(function (art) {
      if (art && art.slug) seen[art.slug] = true;
    });
    (items || []).forEach(function (item) {
      var slug = String(item.article_slug || '');
      if (!slug || seen[slug]) return;
      seen[slug] = true;
      loadedArticles.push({
        slug: slug,
        title: item.article_title || slug,
        title_en: ''
      });
    });
  }

  function articleCatalog() {
    var map = {};
    loadedArticles.forEach(function (art) {
      if (!art || !art.slug) return;
      map[art.slug] = {
        slug: art.slug,
        title: art.title || art.slug,
        title_en: art.title_en || ''
      };
    });
    loadedPublished.forEach(function (item) {
      var slug = String(item.article_slug || '');
      if (!slug) return;
      if (!map[slug]) {
        map[slug] = { slug: slug, title: item.article_title || slug, title_en: '' };
      } else if (!map[slug].title || map[slug].title === slug) {
        map[slug].title = item.article_title || map[slug].title;
      }
    });
    return Object.keys(map)
      .map(function (slug) { return map[slug]; })
      .sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'fr'); });
  }

  function commentsForCurrentQuery() {
    var input = document.getElementById('sonar-mod-article-query');
    var raw = input ? input.value : '';
    var compiled = compileArticleQuery(raw);
    return loadedPublished.filter(function (item) {
      if (selectedArticle && item.article_slug !== selectedArticle) return false;
      if (compiled.empty) return true;
      return compiled.test(item.article_title) || compiled.test(item.article_slug);
    });
  }

  function refreshPublishedList() {
    var items = sortPublished(commentsForCurrentQuery());
    renderPublished(items);
    var input = document.getElementById('sonar-mod-article-query');
    var raw = input ? String(input.value || '').trim() : '';
    var suffix = items.length >= 500 ? ' (500 plus récents)' : '';
    var periodBit = selectedPeriod !== 'all' && PERIOD_LABELS[selectedPeriod] ? ' ' + PERIOD_LABELS[selectedPeriod] : '';
    var queryBit = !selectedArticle && raw ? ' pour « ' + raw + ' »' : '';
    if (!items.length) {
      var emptyMsg = selectedArticle ? 'Aucun commentaire pour cet article' : 'Aucun commentaire publié';
      if (selectedPeriod !== 'all' && PERIOD_LABELS[selectedPeriod]) emptyMsg += ' ' + PERIOD_LABELS[selectedPeriod];
      if (!selectedArticle && raw) emptyMsg += ' pour « ' + raw + ' »';
      setStatus(emptyMsg + '.', '');
      return;
    }
    setStatus(items.length + ' commentaire' + (items.length > 1 ? 's' : '') + ' publié' + (items.length > 1 ? 's' : '') + queryBit + periodBit + suffix + '.', '');
  }

  function hideArticleResults() {
    var list = document.getElementById('sonar-mod-article-results');
    if (list) list.hidden = true;
  }

  function updateArticleChip() {
    var row = document.getElementById('sonar-mod-article-chip-row');
    var chip = document.getElementById('sonar-mod-article-chip');
    if (!row || !chip) return;
    if (!selectedArticle) {
      row.hidden = true;
      chip.textContent = '';
      return;
    }
    row.hidden = false;
    chip.textContent = selectedArticleTitle || selectedArticle;
  }

  function matchArticleRecord(article, compiled) {
    if (!compiled || compiled.empty) return true;
    return compiled.test(article.title) || compiled.test(article.slug) || compiled.test(article.title_en);
  }

  function currentArticleMatches() {
    var input = document.getElementById('sonar-mod-article-query');
    var raw = input ? input.value : '';
    var compiled = compileArticleQuery(raw);
    var items = articleCatalog().filter(function (article) {
      return matchArticleRecord(article, compiled);
    });
    if (compiled.empty) items = items.slice(0, 40);
    return { compiled: compiled, items: items };
  }

  function renderArticleResults(raw, open) {
    var list = document.getElementById('sonar-mod-article-results');
    var hint = document.getElementById('sonar-mod-article-hint');
    if (!list) return;
    var result = currentArticleMatches();
    if (hint) {
      hint.hidden = result.compiled.ok;
      hint.textContent = result.compiled.ok ? '' : (result.compiled.error || 'Expression régulière invalide');
    }
    if (!open) {
      list.hidden = true;
      return;
    }
    if (!result.compiled.ok) {
      list.hidden = true;
      return;
    }
    if (!result.items.length) {
      list.innerHTML = '<li class="is-empty">Aucun article correspondant</li>';
      list.hidden = false;
      return;
    }
    if (articleHighlight >= result.items.length) articleHighlight = 0;
    list.innerHTML = result.items.map(function (art, index) {
      return (
        '<li>' +
          '<button type="button" data-article-slug="' + escapeHtml(art.slug) + '" data-article-title="' + escapeHtml(art.title) + '"' +
            (index === articleHighlight ? ' class="is-active"' : '') + '>' +
            escapeHtml(art.title) +
          '</button>' +
        '</li>'
      );
    }).join('');
    list.hidden = false;
  }

  function moveArticleHighlight(delta) {
    var result = currentArticleMatches();
    if (!result.items.length) return;
    articleHighlight = (articleHighlight + delta + result.items.length) % result.items.length;
    renderArticleResults(document.getElementById('sonar-mod-article-query').value, true);
  }

  function pickHighlightedArticle() {
    var result = currentArticleMatches();
    if (!result.items.length) return;
    var art = result.items[articleHighlight] || result.items[0];
    selectPublishedArticle(art.slug, art.title);
  }

  function selectPublishedArticle(slug, title) {
    selectedArticle = slug || '';
    selectedArticleTitle = title || '';
    var input = document.getElementById('sonar-mod-article-query');
    if (input) input.value = '';
    hideArticleResults();
    updateArticleChip();
    loadPublished(selectedArticle);
  }

  async function ensureArticles() {
    if (loadedArticles.length) return;
    try {
      var headers = authHeaders();
      headers.Accept = 'application/json';
      var res = await fetch('/api/admin/articles', { headers: headers });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && Array.isArray(data.articles)) {
        loadedArticles = data.articles;
      }
    } catch (e) {}
    rememberArticlesFromComments(loadedPublished);
  }

  function renderPublished(items) {
    var list = document.getElementById('sonar-mod-list');
    if (!list) return;
    if (!items.length) {
      var emptyBits = [];
      if (selectedPeriod !== 'all' && PERIOD_LABELS[selectedPeriod]) emptyBits.push(PERIOD_LABELS[selectedPeriod]);
      if (selectedArticle) emptyBits.push('pour cet article');
      list.innerHTML = '<p class="sonar-mod-empty">Aucun commentaire publié' + (emptyBits.length ? ' ' + emptyBits.join(' ') : '') + '.</p>';
      return;
    }
    list.innerHTML = items.map(function (item) {
      var reply = item.is_reply ? '<span class="sonar-mod-reply">Réponse</span>' : '';
      return (
        '<article class="sonar-mod-card" data-comment-id="' + escapeHtml(item.comment_id) + '">' +
          '<div class="sonar-mod-card-top">' +
            '<a class="sonar-mod-article" href="' + escapeHtml(item.article_href) + '" target="_blank" rel="noopener">' +
              escapeHtml(item.article_title || item.article_slug) +
            '</a>' +
            reply +
          '</div>' +
          '<p class="sonar-mod-meta">Par ' + escapeHtml(item.author_name) + ' · ' + escapeHtml(formatDate(item.comment_created_at)) + '</p>' +
          '<p class="sonar-mod-content">' + escapeHtml(item.content) + '</p>' +
          '<div class="sonar-mod-actions">' +
            '<button type="button" class="sonar-mod-delete" data-mod-action="delete" data-comment-id="' + escapeHtml(item.comment_id) + '">Supprimer</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  function renderItems(items) {
    var list = document.getElementById('sonar-mod-list');
    if (!list) return;
    if (currentView === 'published') {
      renderPublished(items);
      return;
    }
    if (!items.length) {
      list.innerHTML = '<p class="sonar-mod-empty">Aucun signalement en attente.</p>';
      return;
    }

    list.innerHTML = items.map(function (item) {
      var reports = (item.reports || []).map(function (report) {
        var reason = report.reason_label || REASON_FALLBACK[report.reason] || report.reason;
        var details = report.details
          ? '<p class="sonar-mod-details">' + escapeHtml(report.details) + '</p>'
          : '';
        return (
          '<li>' +
            '<strong>' + escapeHtml(reason) + '</strong>' +
            ' · ' + escapeHtml(report.reporter) +
            ' · ' + escapeHtml(formatDate(report.created_at)) +
            details +
          '</li>'
        );
      }).join('');

      return (
        '<article class="sonar-mod-card" data-comment-id="' + escapeHtml(item.comment_id) + '">' +
          '<div class="sonar-mod-card-top">' +
            '<a class="sonar-mod-article" href="' + escapeHtml(item.article_href) + '" target="_blank" rel="noopener">' +
              escapeHtml(item.article_slug) +
            '</a>' +
            '<span class="sonar-mod-count">' + escapeHtml(item.report_count) + ' signalement' + (item.report_count > 1 ? 's' : '') + '</span>' +
          '</div>' +
          '<p class="sonar-mod-meta">Par ' + escapeHtml(item.author_name) + ' · ' + escapeHtml(formatDate(item.comment_created_at)) + '</p>' +
          '<p class="sonar-mod-content">' + escapeHtml(item.content) + '</p>' +
          '<ul class="sonar-mod-reports">' + reports + '</ul>' +
          '<div class="sonar-mod-actions">' +
            '<button type="button" class="sonar-mod-keep" data-mod-action="keep" data-comment-id="' + escapeHtml(item.comment_id) + '">Laisser</button>' +
            '<button type="button" class="sonar-mod-delete" data-mod-action="delete" data-comment-id="' + escapeHtml(item.comment_id) + '">Supprimer</button>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  async function refreshBadge() {
    try {
      var res = await fetch('/api/admin/reports', { headers: authHeaders() });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok) setBadge((data.items || []).length);
    } catch (e) {}
  }

  async function loadReports() {
    currentView = 'reports';
    setPanelTitle();
    setActiveNav();
    showTools();
    setStatus('Chargement…', '');
    try {
      var res = await fetch('/api/admin/reports', { headers: authHeaders() });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        loadedItems = [];
        showTools();
        setStatus(data.message || 'Impossible de charger les signalements.', 'err');
        renderItems([]);
        return;
      }
      var items = data.items || [];
      loadedItems = items;
      setBadge(items.length);
      showTools();
      if (!items.length) {
        setStatus(data.hint || 'File d’attente vide.', data.hint ? 'err' : '');
        renderItems([]);
      } else {
        setStatus(items.length + ' commentaire' + (items.length > 1 ? 's' : '') + ' à examiner.', '');
        renderItems(sortItems(items));
      }
    } catch (e) {
      setStatus('Erreur de connexion au serveur.', 'err');
    }
  }

  async function loadPublished(article) {
    currentView = 'published';
    if (typeof article === 'string') selectedArticle = article;
    setPanelTitle();
    setActiveNav();
    showTools();
    setStatus('Chargement…', '');
    await ensureArticles();
    try {
      var params = [];
      if (selectedArticle) params.push('article=' + encodeURIComponent(selectedArticle));
      if (selectedPeriod && selectedPeriod !== 'all') params.push('period=' + encodeURIComponent(selectedPeriod));
      var url = '/api/admin/comments' + (params.length ? '?' + params.join('&') : '');
      var res = await fetch(url, { headers: authHeaders() });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        loadedPublished = [];
        var failMsg = data.message || '';
        if (!failMsg && res.status === 404) {
          failMsg = 'API introuvable : copiez src/pages/api/admin/comments.ts et relancez npm run dev.';
        }
        setStatus(failMsg || ('Impossible de charger les commentaires. (HTTP ' + res.status + ')'), 'err');
        renderPublished([]);
        return;
      }
      loadedPublished = data.items || [];
      rememberArticlesFromComments(loadedPublished);
      showTools();
      refreshPublishedList();
      refreshBadge();
    } catch (e) {
      setStatus('Erreur de connexion au serveur.', 'err');
    }
  }

  async function handleAction(commentId, action, btn) {
    var confirmMsg = action === 'delete'
      ? 'Supprimer définitivement ce commentaire et ses réponses ?'
      : 'Laisser ce commentaire et retirer les signalements ?';
    if (!window.confirm(confirmMsg)) return;
    btn.disabled = true;
    try {
      var endpoint = currentView === 'published' ? '/api/admin/comments' : '/api/admin/reports';
      var res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ comment_id: commentId, action: action })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        window.alert(data.message || 'Action impossible.');
        btn.disabled = false;
        return;
      }
      if (currentView === 'published') await loadPublished(selectedArticle);
      else await loadReports();
    } catch (e) {
      window.alert('Erreur de connexion au serveur.');
      btn.disabled = false;
    }
  }

  function openPanel(view) {
    var root = ensurePanel();
    root.hidden = false;
    document.body.classList.add('sonar-mod-open');
    if (view === 'published') loadPublished(selectedArticle);
    else loadReports();
  }

  function closePanel() {
    var root = document.getElementById('sonar-moderation');
    if (root) root.hidden = true;
    document.body.classList.remove('sonar-mod-open');
  }

  window.SonarModeration = {
    open: openPanel,
    close: closePanel,
    refresh: function () {
      if (currentView === 'published') loadPublished(selectedArticle);
      else loadReports();
    }
  };

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body.classList.contains('sonar-mod-open')) {
      closePanel();
    }
  });
})();
