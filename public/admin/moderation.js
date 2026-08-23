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
            '<h2 id="sonar-mod-title">Commentaires</h2>' +
          '</div>' +
          '<button type="button" class="sonar-mod-close" data-mod-close="1" aria-label="Fermer">Fermer</button>' +
        '</div>' +
        '<div class="sonar-mod-body">' +
          '<p class="sonar-mod-status" id="sonar-mod-status">Chargement…</p>' +
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
      var btn = event.target.closest ? event.target.closest('[data-mod-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-mod-action');
      var commentId = btn.getAttribute('data-comment-id');
      if (!action || !commentId) return;
      handleAction(commentId, action, btn);
    });

    return root;
  }

  function setStatus(text, kind) {
    var el = document.getElementById('sonar-mod-status');
    if (!el) return;
    el.textContent = text || '';
    el.setAttribute('data-kind', kind || '');
  }

  function setBadge(count) {
    var badge = document.getElementById('cms-moderation-badge');
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = String(count || 0);
  }

  function renderItems(items) {
    var list = document.getElementById('sonar-mod-list');
    if (!list) return;
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

  async function loadReports() {
    setStatus('Chargement…', '');
    try {
      var res = await fetch('/api/admin/reports', { headers: authHeaders() });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setStatus(data.message || 'Impossible de charger les signalements.', 'err');
        renderItems([]);
        return;
      }
      var items = data.items || [];
      setBadge(items.length);
      if (!items.length) {
        setStatus(data.hint || 'File d’attente vide.', data.hint ? 'err' : '');
      } else {
        setStatus(items.length + ' commentaire' + (items.length > 1 ? 's' : '') + ' à examiner.', '');
      }
      renderItems(items);
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
      var res = await fetch('/api/admin/reports', {
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
      await loadReports();
    } catch (e) {
      window.alert('Erreur de connexion au serveur.');
      btn.disabled = false;
    }
  }

  function openPanel() {
    var root = ensurePanel();
    root.hidden = false;
    document.body.classList.add('sonar-mod-open');
    loadReports();
  }

  function closePanel() {
    var root = document.getElementById('sonar-moderation');
    if (root) root.hidden = true;
    document.body.classList.remove('sonar-mod-open');
  }

  window.SonarModeration = {
    open: openPanel,
    close: closePanel,
    refresh: loadReports
  };

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body.classList.contains('sonar-mod-open')) {
      closePanel();
    }
  });
})();
