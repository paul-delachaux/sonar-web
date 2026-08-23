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
              '<label class="sonar-mod-article-label">Article' +
                '<select id="sonar-mod-article-filter"><option value="">Tous les articles</option></select>' +
              '</label>' +
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
        renderPublished(sortPublished(loadedPublished));
        return;
      }
      var btn = event.target.closest ? event.target.closest('[data-mod-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-mod-action');
      var commentId = btn.getAttribute('data-comment-id');
      if (!action || !commentId) return;
      handleAction(commentId, action, btn);
    });
    root.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'sonar-mod-article-filter') {
        loadPublished(event.target.value);
      }
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

  function fillArticleSelect(articles) {
    var sel = document.getElementById('sonar-mod-article-filter');
    if (!sel) return;
    var opts = '<option value="">Tous les articles</option>';
    (articles || []).forEach(function (art) {
      opts += '<option value="' + escapeHtml(art.slug) + '">' + escapeHtml(art.title) + '</option>';
    });
    sel.innerHTML = opts;
    sel.value = selectedArticle;
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
      fillArticleSelect(data.articles || []);
      loadedPublished = data.items || [];
      showTools();
      if (!loadedPublished.length) {
        var emptyMsg = selectedArticle ? 'Aucun commentaire pour cet article' : 'Aucun commentaire publié';
        if (selectedPeriod !== 'all' && PERIOD_LABELS[selectedPeriod]) {
          emptyMsg += ' ' + PERIOD_LABELS[selectedPeriod];
        }
        setStatus(emptyMsg + '.', '');
        renderPublished([]);
      } else {
        var count = loadedPublished.length;
        var suffix = count >= 500 ? ' (500 plus récents)' : '';
        var periodBit = selectedPeriod !== 'all' && PERIOD_LABELS[selectedPeriod] ? ' ' + PERIOD_LABELS[selectedPeriod] : '';
        setStatus(count + ' commentaire' + (count > 1 ? 's' : '') + ' publié' + (count > 1 ? 's' : '') + periodBit + suffix + '.', '');
        renderPublished(sortPublished(loadedPublished));
      }
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
