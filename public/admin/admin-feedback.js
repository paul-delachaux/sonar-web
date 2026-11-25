(function (global) {
  var root = null;
  var loading = false;
  var feedbackItems = [];

  function authHeaders(extra) {
    var search = global.SonarArticleSearch;
    if (search && typeof search.authHeaders === 'function') {
      return search.authHeaders(extra || { Accept: 'application/json' });
    }
    var headers = Object.assign({}, extra || {});
    var token = global.__SONAR_GH_TOKEN || '';
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

  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date inconnue';
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function request(url, options) {
    var config = Object.assign({ cache: 'no-store', headers: authHeaders() }, options || {});
    return fetch(url, config).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || 'La requête a échoué (' + response.status + ').');
        return data;
      });
    });
  }

  function statusLabel(status) {
    return status === 'resolved' ? 'Résolu' : 'En attente';
  }

  function setStatus(message, isError) {
    var node = document.getElementById('sonar-feedback-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'sonar-feedback-status' + (isError ? ' is-error' : '');
  }

  function attachmentMarkup(attachments) {
    if (!Array.isArray(attachments) || !attachments.length) return '';
    return '<div class="sonar-feedback-attachments">' + attachments.map(function (item) {
      return '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer" title="Ouvrir la capture ' + escapeHtml(item.name) + '">' +
        '<img src="' + escapeHtml(item.url) + '" alt="Capture jointe : ' + escapeHtml(item.name) + '">' +
        '<span>' + escapeHtml(item.name) + '</span></a>';
    }).join('') + '</div>';
  }

  function messageMarkup(messages) {
    if (!Array.isArray(messages) || !messages.length) return '';
    return '<div class="sonar-feedback-thread" aria-label="Conversation">' + messages.map(function (message) {
      return '<article class="sonar-feedback-message">' +
        '<header><strong>' + escapeHtml(message.author_name || message.author_login) + '</strong>' +
        '<time datetime="' + escapeHtml(message.created_at) + '">' + escapeHtml(formatDate(message.created_at)) + '</time></header>' +
        '<p>' + escapeHtml(message.body).replace(/\r?\n/g, '<br>') + '</p></article>';
    }).join('') + '</div>';
  }

  function renderFeedback(items) {
    var list = document.getElementById('sonar-feedback-list');
    if (!list) return;
    var statusFilter = document.getElementById('sonar-feedback-filter-status');
    var sortBy = document.getElementById('sonar-feedback-sort');
    var filtered = items.filter(function (item) {
      return !statusFilter || statusFilter.value === 'all' || item.status === statusFilter.value;
    });
    filtered.sort(function (a, b) {
      var dateOrder = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy && sortBy.value === 'date-asc') return -dateOrder;
      if (sortBy && sortBy.value === 'status-pending') {
        return (a.status === b.status ? 0 : a.status === 'pending' ? -1 : 1) || dateOrder;
      }
      if (sortBy && sortBy.value === 'status-resolved') {
        return (a.status === b.status ? 0 : a.status === 'resolved' ? -1 : 1) || dateOrder;
      }
      return dateOrder;
    });
    if (!filtered.length) {
      list.innerHTML = '<p class="sonar-feedback-empty">Aucune demande pour le moment.</p>';
      return;
    }
    var superadmin = global.__SONAR_CMS_ROLE === 'superadmin';
    var login = String(global.__SONAR_CMS_LOGIN || '').toLowerCase();
    list.innerHTML = filtered.map(function (item) {
      var isResolved = item.status === 'resolved';
      var details = isResolved && item.resolved_by
        ? '<p class="sonar-feedback-resolved-meta">Résolu par ' + escapeHtml(item.resolved_by) +
          (item.resolved_at ? ' · ' + escapeHtml(formatDate(item.resolved_at)) : '') + '</p>'
        : '';
      var action = superadmin && isResolved
        ? '<button type="button" class="sonar-feedback-toggle" data-feedback-id="' + escapeHtml(item.id) +
          '" data-feedback-status="pending">Remettre en attente</button>'
        : '';
      var mayReply = !isResolved && (superadmin || String(item.created_by || '').toLowerCase() === login);
      var reply = mayReply
        ? '<div class="sonar-feedback-reply"><label for="sonar-feedback-reply-' + escapeHtml(item.id) + '">Votre réponse</label>' +
          '<textarea id="sonar-feedback-reply-' + escapeHtml(item.id) + '" maxlength="5000" rows="3" placeholder="Écrire un message…"></textarea>' +
          '<div class="sonar-feedback-actions"><button type="button" class="sonar-feedback-reply-button" data-feedback-reply="' + escapeHtml(item.id) + '">Répondre</button>' +
          (superadmin ? '<button type="button" class="sonar-feedback-resolve-button" data-feedback-resolve="' + escapeHtml(item.id) + '">Répondre et marquer comme résolu</button>' : '') +
          '</div></div>'
        : '';
      var canDelete = (superadmin && isResolved)
        || (!superadmin && item.status === 'pending' && String(item.created_by || '').toLowerCase() === login);
      var deleteButton = canDelete
        ? '<button type="button" class="sonar-feedback-delete" data-feedback-delete="' + escapeHtml(item.id) + '">' +
          (superadmin ? 'Supprimer la demande' : 'Annuler ma demande') + '</button>'
        : '';
      return '<article class="sonar-feedback-card' + (isResolved ? ' is-resolved' : '') + '">' +
        '<header><div><span class="sonar-feedback-badge ' + (isResolved ? 'is-resolved' : 'is-pending') + '">' +
        escapeHtml(statusLabel(item.status)) + '</span><h3>' + escapeHtml(item.title) + '</h3></div>' +
        '<time datetime="' + escapeHtml(item.created_at) + '">' + escapeHtml(formatDate(item.created_at)) + '</time></header>' +
        (superadmin ? '<p class="sonar-feedback-author">Par ' + escapeHtml(item.created_by_name || item.created_by) + '</p>' : '') +
        '<p class="sonar-feedback-body">' + escapeHtml(item.body).replace(/\r?\n/g, '<br>') + '</p>' +
        attachmentMarkup(item.attachments) + messageMarkup(item.messages) + details + reply +
        (action || deleteButton ? '<footer class="sonar-feedback-actions">' + action + deleteButton + '</footer>' : '') +
        '</article>';
    }).join('');
  }

  function loadFeedback() {
    if (loading) return;
    loading = true;
    var list = document.getElementById('sonar-feedback-list');
    if (list) list.innerHTML = '<p class="sonar-feedback-empty">Chargement des demandes…</p>';
    request('/api/admin/feedback')
      .then(function (data) {
        feedbackItems = Array.isArray(data.feedback) ? data.feedback : [];
        renderFeedback(feedbackItems);
      })
      .catch(function (error) {
        if (list) list.innerHTML = '<p class="sonar-feedback-error">' + escapeHtml(error.message || 'Impossible de charger les demandes.') + '</p>';
      })
      .then(function () { loading = false; });
  }

  function ensurePanel() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'sonar-admin-feedback';
    root.hidden = true;
    root.innerHTML =
      '<div class="sonar-feedback-backdrop" data-feedback-close="1"></div>' +
      '<section class="sonar-feedback-panel" role="dialog" aria-modal="true" aria-labelledby="sonar-feedback-title">' +
        '<header class="sonar-feedback-header"><div><p>Administration</p><h2 id="sonar-feedback-title">Retours sur le site</h2></div>' +
        '<button type="button" class="sonar-feedback-close" data-feedback-close="1" aria-label="Fermer">Fermer</button></header>' +
        '<main class="sonar-feedback-content">' +
          '<form id="sonar-feedback-form">' +
            '<h3>Proposer une amélioration</h3>' +
            '<label for="sonar-feedback-subject">Sujet</label><input id="sonar-feedback-subject" name="title" type="text" maxlength="160" required placeholder="Ex. Améliorer la recherche">' +
            '<label for="sonar-feedback-body">Détail de la demande</label><textarea id="sonar-feedback-body" name="body" rows="5" maxlength="5000" required placeholder="Décris le problème ou l’amélioration souhaitée…"></textarea>' +
            '<label for="sonar-feedback-files">Captures d’écran <span>(facultatif, PNG/JPEG/WebP, 3 fichiers maximum, 4 Mo chacun)</span></label>' +
            '<input id="sonar-feedback-files" name="screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple>' +
            '<p id="sonar-feedback-files-list" class="sonar-feedback-files-list" aria-live="polite"></p>' +
            '<button type="submit" id="sonar-feedback-submit">Envoyer la demande</button>' +
            '<p id="sonar-feedback-status" class="sonar-feedback-status" role="status"></p>' +
          '</form>' +
          '<section class="sonar-feedback-history"><div class="sonar-feedback-history-heading"><h3 id="sonar-feedback-history-title">Mes demandes</h3><button type="button" id="sonar-feedback-refresh">Actualiser</button></div>' +
            '<div class="sonar-feedback-filters"><label for="sonar-feedback-filter-status">Statut<select id="sonar-feedback-filter-status"><option value="all">Tous</option><option value="pending">En attente</option><option value="resolved">Résolus</option></select></label>' +
            '<label for="sonar-feedback-sort">Trier par<select id="sonar-feedback-sort"><option value="date-desc">Date : plus récente</option><option value="date-asc">Date : plus ancienne</option><option value="status-pending">Statut : en attente d’abord</option><option value="status-resolved">Statut : résolus d’abord</option></select></label></div>' +
            '<div id="sonar-feedback-list"><p class="sonar-feedback-empty">Chargement des demandes…</p></div>' +
          '</section>' +
        '</main>' +
      '</section>';
    document.body.appendChild(root);
    installStyles();

    root.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('[data-feedback-close]')) close();
      var toggle = target.closest('[data-feedback-id]');
      if (toggle) updateStatus(toggle.getAttribute('data-feedback-id'), toggle.getAttribute('data-feedback-status'), toggle);
      var reply = target.closest('[data-feedback-reply]');
      if (reply) submitReply(reply.getAttribute('data-feedback-reply'), false, reply);
      var resolve = target.closest('[data-feedback-resolve]');
      if (resolve) submitReply(resolve.getAttribute('data-feedback-resolve'), true, resolve);
      var remove = target.closest('[data-feedback-delete]');
      if (remove) deleteFeedback(remove.getAttribute('data-feedback-delete'), remove);
      if (target.closest('#sonar-feedback-refresh')) loadFeedback();
    });
    root.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') close();
    });
    document.getElementById('sonar-feedback-files').addEventListener('change', updateFileList);
    document.getElementById('sonar-feedback-form').addEventListener('submit', submitFeedback);
    document.getElementById('sonar-feedback-filter-status').addEventListener('change', function () {
      renderFeedback(feedbackItems);
    });
    document.getElementById('sonar-feedback-sort').addEventListener('change', function () {
      renderFeedback(feedbackItems);
    });
    if (global.__SONAR_CMS_ROLE === 'superadmin') {
      document.getElementById('sonar-feedback-history-title').textContent = 'Toutes les demandes';
    }
    return root;
  }

  function updateFileList() {
    var input = document.getElementById('sonar-feedback-files');
    var output = document.getElementById('sonar-feedback-files-list');
    if (!input || !output) return;
    var files = Array.from(input.files || []);
    if (files.length > 3) {
      input.value = '';
      output.textContent = 'Sélectionne 3 captures maximum.';
      return;
    }
    var invalid = files.find(function (file) {
      return file.size > 4 * 1024 * 1024 || ['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) === -1;
    });
    if (invalid) {
      input.value = '';
      output.textContent = invalid.size > 4 * 1024 * 1024
        ? 'Chaque capture doit faire 4 Mo maximum.'
        : 'Formats acceptés : PNG, JPEG et WebP.';
      return;
    }
    output.textContent = files.length
      ? files.length + ' capture(s) sélectionnée(s) : ' + files.map(function (file) { return file.name; }).join(', ')
      : '';
  }

  function submitFeedback(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var submit = document.getElementById('sonar-feedback-submit');
    var formData = new FormData(form);
    var input = document.getElementById('sonar-feedback-files');
    formData.delete('screenshots');
    Array.from(input.files || []).forEach(function (file) { formData.append('screenshots', file, file.name); });
    submit.disabled = true;
    setStatus('Envoi de la demande…', false);
    request('/api/admin/feedback', {
      method: 'POST',
      headers: authHeaders({ Accept: 'application/json' }),
      body: formData
    }).then(function () {
      form.reset();
      updateFileList();
      setStatus('Demande envoyée. Elle apparaît dans votre historique.', false);
      loadFeedback();
    }).catch(function (error) {
      setStatus(error.message || 'Impossible d’envoyer la demande.', true);
    }).then(function () {
      submit.disabled = false;
    });
  }

  function updateStatus(id, status, button) {
    if (!id || (status !== 'pending' && status !== 'resolved')) return;
    button.disabled = true;
    request('/api/admin/feedback', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ id: id, status: status })
    }).then(function () {
      loadFeedback();
    }).catch(function (error) {
      setStatus(error.message || 'Impossible de modifier le statut.', true);
      button.disabled = false;
    });
  }

  function submitReply(id, resolve, button) {
    var textarea = document.getElementById('sonar-feedback-reply-' + id);
    var message = textarea ? textarea.value.trim() : '';
    if (!message) {
      setStatus('Écris un message avant de l’envoyer.', true);
      if (textarea) textarea.focus();
      return;
    }
    button.disabled = true;
    request('/api/admin/feedback', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ id: id, message: message, resolve: resolve })
    }).then(function () {
      setStatus(resolve ? 'Réponse envoyée et demande résolue.' : 'Réponse envoyée.', false);
      loadFeedback();
    }).catch(function (error) {
      setStatus(error.message || 'Impossible d’envoyer la réponse.', true);
      button.disabled = false;
    });
  }

  function deleteFeedback(id, button) {
    if (!id) return;
    var superadmin = global.__SONAR_CMS_ROLE === 'superadmin';
    var message = superadmin
      ? 'Supprimer définitivement cette demande résolue et ses captures ?'
      : 'Annuler définitivement cette demande en attente et ses captures ?';
    if (!global.confirm(message)) return;
    button.disabled = true;
    request('/api/admin/feedback', {
      method: 'DELETE',
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ id: id })
    }).then(function () {
      setStatus(superadmin ? 'Demande résolue supprimée.' : 'Votre demande a été annulée.', false);
      loadFeedback();
    }).catch(function (error) {
      setStatus(error.message || 'Impossible de supprimer cette demande.', true);
      button.disabled = false;
    });
  }

  function installStyles() {
    if (document.getElementById('sonar-admin-feedback-styles')) return;
    var style = document.createElement('style');
    style.id = 'sonar-admin-feedback-styles';
    style.textContent =
      '#sonar-admin-feedback[hidden]{display:none!important}' +
      '#sonar-admin-feedback{position:fixed;inset:0;z-index:100001;overflow:auto;font-family:Helvetica,Arial,sans-serif;color:#e5e7eb}' +
      '.sonar-feedback-backdrop{position:fixed;inset:0;background:rgba(1,0,43,.76)}' +
      '.sonar-feedback-panel{position:relative;margin:20px auto;width:min(900px,calc(100% - 24px));max-height:calc(100vh - 40px);overflow:auto;border:1px solid #34324f;border-radius:12px;background:#080725;box-shadow:0 20px 70px rgba(0,0,0,.5)}' +
      '.sonar-feedback-header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 22px;background:#01002b;border-bottom:1px solid #34324f}' +
      '.sonar-feedback-header p{margin:0 0 4px;color:#ff7900;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}' +
      '.sonar-feedback-header h2{margin:0;color:#fff;font-size:22px}' +
      '.sonar-feedback-close,.sonar-feedback-history-heading button{border:1px solid #55536c;border-radius:6px;padding:7px 11px;background:#10102d;color:#fff;font-weight:700;cursor:pointer}' +
      '.sonar-feedback-content{padding:20px 22px 26px}' +
      '#sonar-feedback-form{display:grid;grid-template-columns:1fr;gap:8px;padding:16px;border:1px solid #34324f;border-radius:9px;background:#10102d}' +
      '#sonar-feedback-form h3,.sonar-feedback-history h3{margin:0 0 8px;color:#fff;font-size:17px}' +
      '#sonar-feedback-form label{margin-top:5px;color:#ffb36b;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}' +
      '#sonar-feedback-form label span{color:#aaa9b7;font-weight:400;text-transform:none;letter-spacing:0}' +
      '#sonar-feedback-form input[type=text],#sonar-feedback-form textarea{box-sizing:border-box;width:100%;border:1px solid #4a4863;border-radius:6px;padding:10px;background:#080725;color:#fff;font:14px/1.5 Helvetica,Arial,sans-serif}' +
      '#sonar-feedback-form input[type=file]{color:#d7d6e2}' +
      '#sonar-feedback-form textarea{resize:vertical;min-height:110px}' +
      '#sonar-feedback-submit,.sonar-feedback-toggle{justify-self:start;border:0;border-radius:6px;padding:9px 14px;background:#ff7900;color:#fff;font-weight:800;cursor:pointer}' +
      '#sonar-feedback-submit:disabled,.sonar-feedback-toggle:disabled{opacity:.55;cursor:wait}' +
      '.sonar-feedback-files-list,.sonar-feedback-status,.sonar-feedback-empty,.sonar-feedback-error{margin:2px 0;color:#aaa9b7;font-size:13px;line-height:1.5}' +
      '.sonar-feedback-status.is-error,.sonar-feedback-error{color:#ff8585}' +
      '.sonar-feedback-history{margin-top:24px}' +
      '.sonar-feedback-history-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}' +
      '.sonar-feedback-card{margin:0 0 12px;padding:14px 16px;border:1px solid #34324f;border-radius:8px;background:#10102d}' +
      '.sonar-feedback-card>header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}' +
      '.sonar-feedback-card h3{display:inline;margin:0 0 0 9px;color:#fff;font-size:16px}' +
      '.sonar-feedback-card time,.sonar-feedback-resolved-meta{color:#aaa9b7;font-size:12px}' +
      '.sonar-feedback-badge{display:inline-block;border-radius:99px;padding:4px 8px;font-size:11px;font-weight:800;white-space:nowrap}' +
      '.sonar-feedback-badge.is-pending{background:#53380d;color:#ffd78a}' +
      '.sonar-feedback-badge.is-resolved{background:#123e34;color:#9be0ca}' +
      '.sonar-feedback-author{margin:8px 0 0;color:#aaa9b7;font-size:12px}' +
      '.sonar-feedback-body{margin:12px 0 0;color:#e5e7eb;font-size:14px;line-height:1.6;overflow-wrap:anywhere}' +
      '.sonar-feedback-thread{display:grid;gap:8px;margin-top:14px;padding-left:14px;border-left:2px solid #4a4863}' +
      '.sonar-feedback-message{padding:10px 12px;border-radius:6px;background:#080725}' +
      '.sonar-feedback-message>header{display:flex;justify-content:space-between;gap:10px;color:#ffb36b;font-size:12px}' +
      '.sonar-feedback-message time{color:#aaa9b7;font-size:11px}' +
      '.sonar-feedback-message p{margin:7px 0 0;color:#e5e7eb;font-size:14px;line-height:1.6;overflow-wrap:anywhere}' +
      '.sonar-feedback-reply{display:grid;gap:8px;margin-top:14px;padding:12px;border:1px solid #34324f;border-radius:7px}' +
      '.sonar-feedback-reply label{color:#ffb36b;font-size:12px;font-weight:800}' +
      '.sonar-feedback-reply textarea{box-sizing:border-box;width:100%;resize:vertical;border:1px solid #4a4863;border-radius:6px;padding:9px;background:#080725;color:#fff;font:14px/1.5 Helvetica,Arial,sans-serif}' +
      '.sonar-feedback-reply-button,.sonar-feedback-resolve-button{border:0;border-radius:6px;padding:8px 11px;background:#34324f;color:#fff;font-weight:800;cursor:pointer}' +
      '.sonar-feedback-resolve-button{background:#ff7900}' +
      '.sonar-feedback-reply button:disabled{opacity:.55;cursor:wait}' +
      '.sonar-feedback-attachments{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}' +
      '.sonar-feedback-attachments a{display:flex;flex-direction:column;gap:5px;width:min(180px,40%);color:#ffb36b;font-size:11px;text-decoration:none;overflow-wrap:anywhere}' +
      '.sonar-feedback-attachments img{width:100%;height:110px;object-fit:cover;border:1px solid #4a4863;border-radius:5px}' +
      '.sonar-feedback-resolved-meta{margin:10px 0 0}' +
      '.sonar-feedback-card footer{margin-top:12px}' +
      '.sonar-feedback-actions{display:flex;flex-wrap:wrap;gap:8px}' +
      '.sonar-feedback-toggle{background:#34324f}' +
      '.sonar-feedback-delete{justify-self:start;border:1px solid #8a4148;border-radius:6px;padding:8px 12px;background:#401d27;color:#ffd9dc;font-weight:800;cursor:pointer}' +
      '.sonar-feedback-filters{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 14px}' +
      '.sonar-feedback-filters label{display:flex;align-items:center;gap:8px;color:#c9c8d2;font-size:12px;font-weight:700}' +
      '.sonar-feedback-filters select{border:1px solid #55536c;border-radius:6px;padding:7px 9px;background:#10102d;color:#fff}' +
      '@media(max-width:600px){.sonar-feedback-panel{margin:8px auto;max-height:calc(100vh - 16px)}.sonar-feedback-content{padding:14px}.sonar-feedback-card>header{flex-direction:column}.sonar-feedback-attachments a{width:calc(50% - 5px)}.sonar-feedback-filters{align-items:stretch;flex-direction:column}.sonar-feedback-filters label{justify-content:space-between}.sonar-feedback-filters select{flex:1;max-width:65%}}';
    document.head.appendChild(style);
  }

  function open() {
    var role = global.__SONAR_CMS_ROLE;
    if (role !== 'admin' && role !== 'superadmin') return;
    ensurePanel().hidden = false;
    loadFeedback();
    var title = document.getElementById('sonar-feedback-subject');
    if (title) title.focus();
  }

  function close() {
    if (root) root.hidden = true;
  }

  function addNav(sidebar) {
    var role = global.__SONAR_CMS_ROLE;
    var existing = document.getElementById('cms-feedback-nav');
    if (role !== 'admin' && role !== 'superadmin') {
      if (existing) existing.remove();
      return;
    }
    if (role === 'admin') {
      var profileItem = document.getElementById('cms-author-profile-nav');
      if (!profileItem || !profileItem.parentNode) return;
      var feedbackItem = existing || document.createElement('button');
      if (!existing) {
        feedbackItem.type = 'button';
        feedbackItem.id = 'cms-feedback-nav';
        feedbackItem.className = 'cms-moderation-item';
        feedbackItem.style.paddingLeft = '10px';
        feedbackItem.textContent = 'Retours sur le site';
        feedbackItem.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          open();
        });
      }
      if (feedbackItem.parentNode !== profileItem.parentNode || profileItem.nextSibling !== feedbackItem) {
        profileItem.parentNode.insertBefore(feedbackItem, profileItem.nextSibling);
      }
      return;
    }
    if (existing) return;
    var anchor = document.getElementById('cms-announcements-nav')
      || document.getElementById('cms-logs-nav')
      || document.getElementById('cms-accounts-nav');
    var item = document.createElement('button');
    item.type = 'button';
    item.id = 'cms-feedback-nav';
    item.className = 'cms-moderation-item';
    item.style.paddingLeft = '10px';
    item.textContent = 'Retours sur le site';
    item.addEventListener('click', open);
    if (role === 'admin' && sidebar) {
      sidebar.appendChild(item);
    } else if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(item, anchor.nextSibling);
    } else if (sidebar) {
      sidebar.appendChild(item);
    }
  }

  global.SonarAdminFeedback = { open: open, close: close, addNav: addNav };
})(window);
