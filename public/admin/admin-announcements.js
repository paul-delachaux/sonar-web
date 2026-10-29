/**
 * Interface Decap CMS pour rédiger, cibler, envoyer ou planifier des annonces,
 * puis consulter les messages récents et gérer leur historique.
 */
(function (global) {
  var selectedUsers = new Map();
  var searchTimer = null;
  var loaded = false;
  var root;

  function authHeaders() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.authHeaders === 'function') {
      return search.authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' });
    }
    var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    var token = global.__SONAR_GH_TOKEN || '';
    if (!token) {
      try {
        var raw = global.localStorage.getItem('decap-cms-user') || global.localStorage.getItem('netlify-cms-user');
        var data = raw ? JSON.parse(raw) : null;
        token = (data && (data.token || data.access_token)) || '';
      } catch (error) {
        console.warn('[Sonar] Session Decap illisible.', error);
      }
    }
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Sonar-GitHub'] = token;
      headers['X-Github-Token'] = token;
    }
    return headers;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function localDateTime(date) {
    var offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date invalide';
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function message(text, isError) {
    var el = document.getElementById('sonar-announcement-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'sonar-announcement-status' + (isError ? ' is-error' : '');
  }

  function request(url, options) {
    return fetch(url, Object.assign({
      cache: 'no-store',
      headers: authHeaders()
    }, options || {})).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (data) {
        if (!response.ok) throw new Error(data.message || 'La requête a échoué (' + response.status + ').');
        return data;
      });
    });
  }

  function ensurePanel() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'sonar-admin-announcements';
    root.hidden = true;
    root.innerHTML =
      '<div class="sonar-announcement-backdrop" data-announcement-close="1"></div>' +
      '<section class="sonar-announcement-panel" role="dialog" aria-modal="true" aria-labelledby="sonar-announcement-title">' +
        '<header class="sonar-announcement-header">' +
          '<div><p>Administration</p><h2 id="sonar-announcement-title">Messages &amp; notifications</h2></div>' +
          '<button type="button" class="sonar-announcement-close" data-announcement-close="1">Fermer</button>' +
        '</header>' +
        '<main class="sonar-announcement-content">' +
          '<p class="sonar-announcement-hint">Les messages publiés apparaissent dans le menu Notifications à la première visite après l’heure prévue. Les messages « Tout le monde » incluent aussi les futurs comptes.</p>' +
          '<form id="sonar-announcement-form">' +
            '<label>Titre<input id="sonar-announcement-subject" type="text" maxlength="160" required></label>' +
            '<label>Message<textarea id="sonar-announcement-body" rows="5" maxlength="5000" required></textarea></label>' +
            '<label>Destinataires<select id="sonar-announcement-audience"><option value="all">Tout le monde (y compris les futurs comptes)</option><option value="selected">Comptes sélectionnés</option><option value="admins">Admins définis dans Comptes &amp; droits</option></select></label>' +
            '<div id="sonar-announcement-recipients" hidden>' +
              '<label>Rechercher un pseudo ou un e-mail<input id="sonar-announcement-search" type="search" autocomplete="off" placeholder="Saisir au moins 2 caractères"></label>' +
              '<div id="sonar-announcement-search-results" class="sonar-announcement-search-results"></div>' +
              '<div id="sonar-announcement-selected" class="sonar-announcement-selected"></div>' +
            '</div>' +
            '<p id="sonar-announcement-admins-hint" class="sonar-announcement-hint" hidden>Les admins sont résolus depuis les pseudos et e-mails enregistrés dans Comptes &amp; droits. Les destinataires sont figés au moment de la création.</p>' +
            '<label>Date et heure prévues<input id="sonar-announcement-date" type="datetime-local" required></label>' +
            '<div class="sonar-announcement-actions"><button type="button" id="sonar-announcement-send-now">Envoyer maintenant</button><button type="submit">Planifier</button></div>' +
            '<p id="sonar-announcement-status" class="sonar-announcement-status" role="status"></p>' +
          '</form>' +
          '<section class="sonar-announcement-history"><div class="sonar-announcement-history-heading"><h3>Messages récents et planifiés</h3><button type="button" id="sonar-announcement-clear-history">Effacer l’historique envoyé</button></div><p class="sonar-announcement-hint">Cette action supprime uniquement les messages déjà publiés de cet historique. Les messages planifiés et les notifications déjà reçues restent inchangés.</p><div id="sonar-announcement-list">Chargement…</div></section>' +
        '</main>' +
      '</section>';
    document.body.appendChild(root);
    installStyles();
    root.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.getAttribute && target.getAttribute('data-announcement-close')) close();
      var user = target && target.closest ? target.closest('[data-announcement-user]') : null;
      if (user) addUser(JSON.parse(user.getAttribute('data-announcement-user')));
      var remove = target && target.closest ? target.closest('[data-announcement-remove]') : null;
      if (remove) {
        selectedUsers.delete(remove.getAttribute('data-announcement-remove'));
        renderSelected();
      }
      var cancel = target && target.closest ? target.closest('[data-announcement-cancel]') : null;
      if (cancel) cancelAnnouncement(cancel.getAttribute('data-announcement-cancel'));
    });
    document.getElementById('sonar-announcement-audience').addEventListener('change', updateAudience);
    document.getElementById('sonar-announcement-search').addEventListener('input', searchUsers);
    document.getElementById('sonar-announcement-form').addEventListener('submit', function (event) {
      event.preventDefault();
      saveAnnouncement(false);
    });
    document.getElementById('sonar-announcement-send-now').addEventListener('click', function () {
      saveAnnouncement(true);
    });
    document.getElementById('sonar-announcement-clear-history').addEventListener('click', clearPublishedHistory);
    root.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
    document.getElementById('sonar-announcement-date').value = localDateTime(new Date(Date.now() + 60000));
    updateAudience();
    return root;
  }

  function installStyles() {
    var style = document.createElement('style');
    style.textContent =
      '#sonar-admin-announcements[hidden]{display:none!important}' +
      '#sonar-admin-announcements{position:fixed;inset:0;z-index:100000;overflow:auto;font-family:Helvetica,Arial,sans-serif}' +
      '.sonar-announcement-backdrop{position:fixed;inset:0;background:rgba(1,0,43,.62)}' +
      '.sonar-announcement-panel{position:relative;margin:24px auto;width:min(760px,calc(100% - 24px));max-height:calc(100vh - 48px);overflow:auto;border-radius:12px;background:#fff;box-shadow:0 20px 70px rgba(0,0,0,.3)}' +
      '.sonar-announcement-header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:18px 22px;background:#01002b;color:#fff}' +
      '.sonar-announcement-header p{margin:0 0 4px;color:#ff7900;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}' +
      '.sonar-announcement-header h2{margin:0;color:#fff;font-size:20px}' +
      '.sonar-announcement-close,.sonar-announcement-actions button,.sonar-announcement-cancel{border:0;border-radius:6px;padding:9px 14px;cursor:pointer;font-weight:700}' +
      '.sonar-announcement-close{border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff}' +
      '.sonar-announcement-content{padding:20px 22px 26px}' +
      '.sonar-announcement-content label{display:grid;gap:6px;margin:12px 0;font-weight:700;color:#27243b}' +
      '.sonar-announcement-content input,.sonar-announcement-content textarea,.sonar-announcement-content select{box-sizing:border-box;width:100%;padding:10px;border:1px solid #c9c7d1;border-radius:6px;font:inherit}' +
      '.sonar-announcement-hint{color:#626071;font-size:13px;line-height:1.5}' +
      '.sonar-announcement-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}' +
      '.sonar-announcement-actions button{background:#ff7900;color:white}' +
      '.sonar-announcement-actions button[type=submit]{background:#01002b}' +
      '.sonar-announcement-status{min-height:20px;color:#23633d;font-size:13px}' +
      '.sonar-announcement-status.is-error{color:#a32222}' +
      '.sonar-announcement-search-results,.sonar-announcement-selected{display:grid;gap:6px;margin:8px 0}' +
      '.sonar-announcement-user,.sonar-announcement-selected-item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 10px;border-radius:6px;background:#f1f0f5}' +
      '.sonar-announcement-user{width:100%;border:0;text-align:left;cursor:pointer}' +
      '.sonar-announcement-user small{color:#626071}' +
      '.sonar-announcement-history{margin-top:24px;border-top:1px solid #dedde3;padding-top:14px}' +
      '.sonar-announcement-history-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}' +
      '.sonar-announcement-history h3{margin:0 0 12px;color:#01002b}' +
      '#sonar-announcement-clear-history{margin-bottom:12px;border:1px solid #a32222;border-radius:6px;padding:8px 12px;background:#fff;color:#a32222;cursor:pointer;font-weight:700}' +
      '.sonar-announcement-entry{margin:8px 0;padding:12px;border:1px solid #e1e0e6;border-radius:8px}' +
      '.sonar-announcement-entry h4{margin:0 0 6px}' +
      '.sonar-announcement-entry p{margin:5px 0;color:#555366;white-space:pre-wrap}' +
      '.sonar-announcement-cancel{margin-top:8px;background:#fce7e7;color:#9c1c1c}' +
      '@media(max-width:600px){.sonar-announcement-panel{margin:0;width:100%;min-height:100vh;max-height:none;border-radius:0}.sonar-announcement-content{padding:16px}.sonar-announcement-header{padding:14px 16px}}';
    document.head.appendChild(style);
  }

  function updateAudience() {
    var audience = document.getElementById('sonar-announcement-audience').value;
    document.getElementById('sonar-announcement-recipients').hidden = audience !== 'selected';
    document.getElementById('sonar-announcement-admins-hint').hidden = audience !== 'admins';
  }

  function searchUsers() {
    clearTimeout(searchTimer);
    var query = document.getElementById('sonar-announcement-search').value.trim();
    var results = document.getElementById('sonar-announcement-search-results');
    if (query.length < 2) {
      results.textContent = '';
      return;
    }
    searchTimer = setTimeout(function () {
      request('/api/admin/announcements?users=' + encodeURIComponent(query))
        .then(function (data) {
          results.innerHTML = (data.users || []).map(function (user) {
            return '<button type="button" class="sonar-announcement-user" data-announcement-user="' +
              escapeHtml(JSON.stringify(user)) + '"><span>' + escapeHtml(user.username || 'Compte sans pseudo') +
              '</span><small>' + escapeHtml(user.email || '') + '</small></button>';
          }).join('') || '<span>Aucun compte trouvé.</span>';
        })
        .catch(function (error) {
          results.textContent = error.message || 'Recherche impossible.';
        });
    }, 250);
  }

  function addUser(user) {
    if (!user || !user.id) return;
    selectedUsers.set(user.id, user);
    renderSelected();
    document.getElementById('sonar-announcement-search-results').textContent = '';
    document.getElementById('sonar-announcement-search').value = '';
  }

  function renderSelected() {
    var container = document.getElementById('sonar-announcement-selected');
    if (!container) return;
    container.innerHTML = Array.from(selectedUsers.values()).map(function (user) {
      return '<div class="sonar-announcement-selected-item"><span>' + escapeHtml(user.username || user.email || user.id) +
        '</span><button type="button" data-announcement-remove="' + escapeHtml(user.id) + '" aria-label="Retirer">Retirer</button></div>';
    }).join('');
  }

  function saveAnnouncement(sendNow) {
    var audience = document.getElementById('sonar-announcement-audience').value;
    if (audience === 'selected' && selectedUsers.size === 0) {
      message('Sélectionnez au moins un compte.', true);
      return;
    }
    var title = document.getElementById('sonar-announcement-subject').value.trim();
    var body = document.getElementById('sonar-announcement-body').value.trim();
    var date = sendNow ? new Date() : new Date(document.getElementById('sonar-announcement-date').value);
    if (!title || !body || Number.isNaN(date.getTime())) {
      message('Complétez le titre, le message et la date.', true);
      return;
    }
    if (sendNow && !global.confirm('Envoyer ce message immédiatement ?')) return;
    if (!sendNow && date.getTime() <= Date.now() && !global.confirm('Cette heure est passée. Le message sera publié dès la prochaine consultation des notifications. Continuer ?')) return;

    message('Enregistrement…', false);
    request('/api/admin/announcements', {
      method: 'POST',
      body: JSON.stringify({
        title: title,
        body: body,
        audience: audience,
        account_ids: Array.from(selectedUsers.keys()),
        published_at: date.toISOString()
      })
    }).then(function () {
      document.getElementById('sonar-announcement-form').reset();
      document.getElementById('sonar-announcement-date').value = localDateTime(new Date(Date.now() + 60000));
      selectedUsers.clear();
      renderSelected();
      updateAudience();
      message(sendNow ? 'Message envoyé. Il sera visible à la prochaine consultation des notifications.' : 'Message planifié.', false);
      return loadAnnouncements();
    }).catch(function (error) {
      message(error.message || 'Impossible d’enregistrer le message.', true);
    });
  }

  function loadAnnouncements() {
    var list = document.getElementById('sonar-announcement-list');
    if (!list) return Promise.resolve();
    list.textContent = 'Chargement…';
    return request('/api/admin/announcements').then(function (data) {
      var entries = data.announcements || [];
      list.innerHTML = entries.map(function (item) {
        var audience = item.audience === 'all'
          ? 'Tout le monde'
          : item.audience === 'admins' ? 'Admins' : (item.recipient_count || 0) + ' compte(s) sélectionné(s)';
        return '<article class="sonar-announcement-entry"><h4>' + escapeHtml(item.title) + '</h4>' +
          '<p>' + escapeHtml(item.body) + '</p><p><strong>' + (item.scheduled ? 'Planifié' : 'Publié') +
          '</strong> — ' + escapeHtml(formatDate(item.published_at)) + ' — ' + escapeHtml(audience) + '</p>' +
          (item.scheduled ? '<button type="button" class="sonar-announcement-cancel" data-announcement-cancel="' + escapeHtml(item.id) + '">Annuler</button>' : '') +
          '</article>';
      }).join('') || '<p>Aucun message enregistré.</p>';
    }).catch(function (error) {
      list.textContent = error.message || 'Impossible de charger les messages.';
    });
  }

  function cancelAnnouncement(id) {
    if (!id || !global.confirm('Annuler ce message planifié ?')) return;
    request('/api/admin/announcements?id=' + encodeURIComponent(id), { method: 'DELETE' })
      .then(loadAnnouncements)
      .catch(function (error) {
        message(error.message || 'Impossible d’annuler le message.', true);
      });
  }

  function clearPublishedHistory() {
    if (!global.confirm('Effacer tous les messages déjà publiés de l’historique ? Les messages planifiés et les notifications déjà reçues ne seront pas supprimés.')) return;
    message('Effacement de l’historique…', false);
    request('/api/admin/announcements?history=published', { method: 'DELETE' })
      .then(function (data) {
        message((data.deleted || 0) + ' message(s) publié(s) supprimé(s) de l’historique.', false);
        return loadAnnouncements();
      })
      .catch(function (error) {
        message(error.message || 'Impossible d’effacer l’historique.', true);
      });
  }

  function open() {
    if (global.__SONAR_CMS_ROLE !== 'admin' && global.__SONAR_CMS_ROLE !== 'superadmin') return;
    ensurePanel().hidden = false;
    if (!loaded) {
      loaded = true;
      loadAnnouncements();
    }
  }

  function close() {
    if (root) root.hidden = true;
  }

  function addNav(sidebar) {
    var role = global.__SONAR_CMS_ROLE;
    if (role !== 'admin' && role !== 'superadmin') return;
    var item = document.getElementById('cms-announcements-nav');
    if (item) return;
    var accountsItem = document.getElementById('cms-accounts-nav');
    if (role === 'superadmin' && accountsItem && accountsItem.parentNode) {
      item = document.createElement('button');
      item.type = 'button';
      item.id = 'cms-announcements-nav';
      item.className = 'cms-moderation-item';
      item.style.paddingLeft = '10px';
      item.innerHTML = '<span>Messages &amp; notifications</span>';
      item.addEventListener('click', open);
      var after = document.getElementById('cms-logs-nav') || accountsItem;
      after.parentNode.insertBefore(item, after.nextSibling);
      return;
    }
    if (!sidebar || role !== 'admin') return;
    var header = document.createElement('div');
    header.id = 'cms-announcements-group';
    header.className = 'cms-sidebar-header';
    header.style.cssText = 'cursor:pointer;font-weight:bold;font-size:.85rem;text-transform:uppercase;letter-spacing:.5px;background:#01002b;color:#fff;padding:10px 14px;margin-top:8px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;user-select:none';
    header.innerHTML = '<span>Administration</span><span class="arrow" style="font-size:.7rem">▼</span>';
    item = document.createElement('button');
    item.type = 'button';
    item.id = 'cms-announcements-nav';
    item.className = 'cms-moderation-item';
    item.style.paddingLeft = '10px';
    item.innerHTML = '<span>Messages &amp; notifications</span>';
    item.addEventListener('click', open);
    var collapsed = false;
    header.addEventListener('click', function () {
      collapsed = !collapsed;
      header.querySelector('.arrow').textContent = collapsed ? '►' : '▼';
      item.style.display = collapsed ? 'none' : 'flex';
    });
    sidebar.appendChild(header);
    sidebar.appendChild(item);
  }

  global.SonarAdminAnnouncements = { open: open, close: close, addNav: addNav };
})(window);
