(function (global) {
  var root = null;
  var polls = [];
  var selectedPoll = '';
  var responseRequest = 0;

  function authHeaders() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.authHeaders === 'function') {
      return search.authHeaders({ Accept: 'application/json' });
    }
    var headers = { Accept: 'application/json' };
    var token = global.__SONAR_GH_TOKEN || '';
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Sonar-GitHub'] = token;
    }
    return headers;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
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

  function request(url) {
    return fetch(url, { cache: 'no-store', headers: authHeaders() }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || 'La requête a échoué (' + response.status + ').');
        return data;
      });
    });
  }

  function setStatus(message, isError) {
    var status = root && root.querySelector('#sonde-admin-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function renderOptionResults(options, total) {
    if (!options.length) return '<p class="sonde-admin-empty">Aucune option configurée.</p>';
    return '<ul class="sonde-admin-options">' + options.map(function (option) {
      var percentage = Number(option.percentage) || 0;
      var safePercentage = Math.min(100, Math.max(0, percentage));
      return '<li><div class="sonde-admin-option-label"><span>' + escapeHtml(option.label) +
        '</span><strong>' + escapeHtml(option.count) + ' · ' + safePercentage.toFixed(1) +
        '%</strong></div><div class="sonde-admin-bar" aria-hidden="true"><span style="width:' +
        safePercentage + '%"></span></div></li>';
    }).join('') + '</ul><p class="sonde-admin-total">' + total +
      ' réponse' + (total === 1 ? '' : 's') + '</p>';
  }

  function renderPollList() {
    var list = root && root.querySelector('#sonde-admin-poll-list');
    var search = root && root.querySelector('#sonde-admin-search');
    if (!list || !search) return;

    var expression;
    try {
      expression = new RegExp(search.value.trim(), 'i');
    } catch (error) {
      list.innerHTML = '';
      setStatus('Expression régulière invalide : ' + error.message, true);
      return;
    }

    var matchingPolls = polls.filter(function (poll) {
      return expression.test(poll.title + '\n' + poll.question);
    });
    list.innerHTML = matchingPolls.map(function (poll) {
      return '<article class="sonde-admin-poll-card"><button type="button" class="sonde-admin-poll-open" data-poll-slug="' +
        escapeHtml(poll.slug) + '"><span class="sonde-admin-poll-heading"><strong>' +
        escapeHtml(poll.title) + '</strong><span aria-hidden="true">→</span></span><span class="sonde-admin-poll-question">' +
        escapeHtml(poll.question) + '</span><span class="sonde-admin-poll-results">' +
        renderOptionResults(Array.isArray(poll.options) ? poll.options : [], Number(poll.total) || 0) +
        '</span></button></article>';
    }).join('');

    if (!matchingPolls.length) {
      setStatus(polls.length ? 'Aucun sondage ne correspond à cette recherche.' : 'Aucun sondage n’est encore configuré.', false);
    } else {
      setStatus(matchingPolls.length + ' sondage' + (matchingPolls.length === 1 ? '' : 's'), false);
    }
  }

  function renderPollDetails(poll) {
    var detail = root && root.querySelector('#sonde-admin-detail');
    if (!detail) return;
    var options = Array.isArray(poll.options) ? poll.options : [];
    var responses = Array.isArray(poll.responses) ? poll.responses : [];
    var optionLabels = {};
    options.forEach(function (option) { optionLabels[option.id] = option.label; });

    detail.innerHTML =
      '<section class="sonde-admin-summary"><h3>' + escapeHtml(poll.title) + '</h3>' +
      '<p class="sonde-admin-detail-question">' + escapeHtml(poll.question) + '</p>' +
      renderOptionResults(options, Number(poll.total) || 0) + '</section>' +
      (responses.length
        ? '<div class="sonde-admin-response-list">' + responses.map(function (response) {
            return '<article><header><strong>' +
              escapeHtml(optionLabels[response.option_id] || 'Réponse retirée') +
              '</strong><time datetime="' + escapeHtml(response.created_at) + '">' +
              escapeHtml(formatDate(response.created_at)) + '</time></header><p>' +
              (response.explanation
                ? escapeHtml(response.explanation).replace(/\r?\n/g, '<br>')
                : '<span class="sonde-admin-empty-answer">Aucun complément écrit.</span>') +
              '</p></article>';
          }).join('') + '</div>'
        : '<p class="sonde-admin-empty">Aucune réponse détaillée pour ce sondage.</p>');
  }

  function showList() {
    if (!root) return;
    root.querySelector('#sonde-admin-list-view').hidden = false;
    root.querySelector('#sonde-admin-detail-view').hidden = true;
    root.querySelector('#sonde-admin-back').hidden = true;
    root.querySelector('#sonde-admin-title').textContent = 'Réponses aux sondages';
    selectedPoll = '';
    setStatus('');
  }

  function loadPollResponses(slug) {
    selectedPoll = slug;
    var requestId = ++responseRequest;
    root.querySelector('#sonde-admin-list-view').hidden = true;
    root.querySelector('#sonde-admin-detail-view').hidden = false;
    root.querySelector('#sonde-admin-back').hidden = false;
    root.querySelector('#sonde-admin-title').textContent = 'Détail des réponses';
    root.querySelector('#sonde-admin-detail').innerHTML = '';
    setStatus('Chargement des réponses…', false);

    request('/api/admin/sondage-responses?poll=' + encodeURIComponent(slug))
      .then(function (data) {
        if (requestId !== responseRequest) return;
        if (!data.poll) throw new Error('La réponse du serveur est incomplète.');
        root.querySelector('#sonde-admin-title').textContent = data.poll.title;
        renderPollDetails(data.poll);
        setStatus('');
      })
      .catch(function (error) {
        if (requestId !== responseRequest) return;
        setStatus(error.message || 'Impossible de charger les réponses.', true);
      });
  }

  function loadPolls() {
    setStatus('Chargement des sondages…', false);
    request('/api/admin/sondage-responses')
      .then(function (data) {
        polls = Array.isArray(data.polls) ? data.polls : [];
        renderPollList();
        if (data.warning) setStatus(data.warning, false);
      })
      .catch(function (error) {
        polls = [];
        renderPollList();
        setStatus(error.message || 'Impossible de charger les sondages.', true);
      });
  }

  function ensurePanel() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'sonde-admin-responses';
    root.hidden = true;
    root.innerHTML =
      '<div class="sonde-admin-backdrop" data-sonde-close></div>' +
      '<section class="sonde-admin-panel" role="dialog" aria-modal="true" aria-labelledby="sonde-admin-title">' +
        '<header class="sonde-admin-header"><div class="sonde-admin-title-group">' +
          '<p>La Sonde</p><h2 id="sonde-admin-title">Réponses aux sondages</h2></div>' +
          '<div class="sonde-admin-header-actions"><button type="button" id="sonde-admin-back" hidden>← Retour</button>' +
          '<button type="button" data-sonde-close aria-label="Fermer">Fermer</button></div></header>' +
        '<main class="sonde-admin-content">' +
          '<section id="sonde-admin-list-view"><label for="sonde-admin-search">Rechercher un sondage (expression régulière)</label>' +
            '<input id="sonde-admin-search" type="search" placeholder="Ex. influenceur|réseaux" autocomplete="off">' +
            '<div id="sonde-admin-poll-list" class="sonde-admin-poll-list"></div></section>' +
          '<section id="sonde-admin-detail-view" hidden><div id="sonde-admin-detail"></div></section>' +
          '<p id="sonde-admin-status" role="status" aria-live="polite"></p>' +
        '</main>' +
      '</section>';
    document.body.appendChild(root);

    var style = document.createElement('style');
    style.textContent =
      '#sonde-admin-responses[hidden]{display:none!important}' +
      '#sonde-admin-responses [hidden]{display:none!important}' +
      '#sonde-admin-responses{position:fixed;inset:0;z-index:3000;font-family:Helvetica,Arial,sans-serif}' +
      '#sonde-admin-responses .sonde-admin-backdrop{position:absolute;inset:0;background:rgba(0,0,18,.78)}' +
      '#sonde-admin-responses .sonde-admin-panel{position:absolute;inset:3vh 3vw;margin:auto;max-width:1080px;max-height:94vh;overflow:auto;border:1px solid #383752;border-radius:12px;background:#05051d;box-shadow:0 20px 70px rgba(0,0,0,.5);color:#f4f4f7!important}' +
      '#sonde-admin-responses .sonde-admin-panel *{color:#f4f4f7!important;box-sizing:border-box}' +
      '#sonde-admin-responses .sonde-admin-header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 22px;background:#080822;border-bottom:1px solid #292840}' +
      '#sonde-admin-responses .sonde-admin-title-group p{margin:0 0 4px;color:#ff8a24!important;font-size:12px;font-weight:700}' +
      '#sonde-admin-responses .sonde-admin-title-group h2{margin:0;font-size:21px;font-weight:700}' +
      '#sonde-admin-responses .sonde-admin-header-actions{display:flex;gap:8px}' +
      '#sonde-admin-responses .sonde-admin-header button{border:1px solid #4b4967;border-radius:6px;padding:8px 12px;background:#11112f;cursor:pointer}' +
      '#sonde-admin-responses .sonde-admin-content{padding:20px 22px}' +
      '#sonde-admin-responses .sonde-admin-content>section>label{display:block;margin-bottom:7px;font-weight:700}' +
      '#sonde-admin-responses #sonde-admin-search{width:100%;margin-bottom:14px;border:1px solid #4b4967;border-radius:7px;padding:10px 12px;background:#0b0b25;color:#fff!important;font:inherit}' +
      '#sonde-admin-responses #sonde-admin-search::placeholder{color:#a7a8be!important}' +
      '#sonde-admin-responses #sonde-admin-status{min-height:20px;margin:12px 0 0;color:#b9b9c9!important}' +
      '#sonde-admin-responses #sonde-admin-status.is-error{color:#ffaaa3!important}' +
      '#sonde-admin-responses .sonde-admin-poll-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,390px),1fr));gap:12px}' +
      '#sonde-admin-responses .sonde-admin-poll-card{min-width:0;border:1px solid #33314f;border-radius:9px;background:#080822;overflow:hidden}' +
      '#sonde-admin-responses .sonde-admin-poll-open{display:block;width:100%;padding:16px;border:0;background:transparent;text-align:left;cursor:pointer}' +
      '#sonde-admin-responses .sonde-admin-poll-open:hover{background:#10102f}' +
      '#sonde-admin-responses .sonde-admin-poll-heading{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:16px}' +
      '#sonde-admin-responses .sonde-admin-poll-heading>span{color:#ff9a3d!important}' +
      '#sonde-admin-responses .sonde-admin-poll-question{display:block;margin-bottom:13px;color:#c5c6d6!important;font-size:13px;line-height:1.45}' +
      '#sonde-admin-responses .sonde-admin-options{display:grid;gap:8px;margin:0;padding:0;list-style:none}' +
      '#sonde-admin-responses .sonde-admin-option-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;font-size:12px}' +
      '#sonde-admin-responses .sonde-admin-option-label>span{overflow-wrap:anywhere}' +
      '#sonde-admin-responses .sonde-admin-option-label>strong{flex:0 0 auto;color:#d9dbee!important}' +
      '#sonde-admin-responses .sonde-admin-bar{height:6px;overflow:hidden;border-radius:5px;background:#242440}' +
      '#sonde-admin-responses .sonde-admin-bar>span{display:block;height:100%;border-radius:5px;background:#ff7900}' +
      '#sonde-admin-responses .sonde-admin-total{margin:10px 0 0;color:#aaa9ba!important;font-size:12px}' +
      '#sonde-admin-responses .sonde-admin-summary{padding:16px;border:1px solid #33314f;border-radius:8px;background:#080822}' +
      '#sonde-admin-responses .sonde-admin-summary h3{margin:0 0 8px;font-size:20px}' +
      '#sonde-admin-responses .sonde-admin-detail-question{margin:0 0 14px;color:#d0d1df!important;line-height:1.5}' +
      '#sonde-admin-responses .sonde-admin-response-list{display:grid;gap:10px;margin-top:16px}' +
      '#sonde-admin-responses .sonde-admin-response-list article{padding:14px;border:1px solid #302f4b;border-radius:8px;background:#080822}' +
      '#sonde-admin-responses .sonde-admin-response-list article header{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}' +
      '#sonde-admin-responses .sonde-admin-response-list article header strong{color:#fff!important}' +
      '#sonde-admin-responses .sonde-admin-response-list time,#sonde-admin-responses .sonde-admin-empty-answer{color:#aaa9ba!important;font-size:12px}' +
      '#sonde-admin-responses .sonde-admin-response-list article p{margin:0;color:#e5e6f0!important;line-height:1.55;overflow-wrap:anywhere}' +
      '#sonde-admin-responses .sonde-admin-empty{color:#aaa9ba!important}' +
      '#sonde-admin-responses button:focus-visible,#sonde-admin-responses input:focus-visible{outline:2px solid #ff9a3d;outline-offset:2px}' +
      '@media(max-width:600px){#sonde-admin-responses .sonde-admin-panel{inset:8px;max-height:calc(100vh - 16px)}#sonde-admin-responses .sonde-admin-header,#sonde-admin-responses .sonde-admin-content{padding:14px}#sonde-admin-responses .sonde-admin-response-list article header{flex-direction:column}}';
    document.head.appendChild(style);

    root.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('[data-sonde-close]')) close();
      var pollButton = target.closest('[data-poll-slug]');
      if (pollButton) loadPollResponses(pollButton.getAttribute('data-poll-slug'));
      if (target.closest('#sonde-admin-back')) showList();
    });
    root.querySelector('#sonde-admin-search').addEventListener('input', renderPollList);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && root && !root.hidden) close();
    });
    return root;
  }

  function open() {
    var role = global.__SONAR_CMS_ROLE;
    if (role !== 'admin' && role !== 'superadmin') return;
    ensurePanel().hidden = false;
    showList();
    loadPolls();
  }

  function close() {
    if (root) root.hidden = true;
  }

  function addNav(collectionsColumn) {
    var role = global.__SONAR_CMS_ROLE;
    var existing = document.getElementById('cms-sonde-responses-nav');
    if (role !== 'admin' && role !== 'superadmin') {
      if (existing) existing.remove();
      return;
    }
    if (!collectionsColumn) return;

    var link = collectionsColumn.querySelector('a[href*="/collections/sondages"]');
    if (!link) return;
    var row = link.closest('li');
    var parent = row || link.parentNode;
    if (existing && existing.parentNode === parent) return;
    if (existing) existing.remove();

    var button = document.createElement('button');
    button.type = 'button';
    button.id = 'cms-sonde-responses-nav';
    button.className = 'cms-moderation-item';
    button.style.cssText = 'display:flex;width:100%;margin:2px 0 4px;padding:8px 10px 8px 26px;border:0;background:transparent;color:#3e4857;text-align:left;cursor:pointer;font:inherit;font-size:.82rem;';
    button.textContent = 'Réponses des lecteurs';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      open();
    });
    if (row) row.appendChild(button);
    else link.parentNode.insertBefore(button, link.nextSibling);
  }

  global.SonarPollResponses = { open: open, close: close, addNav: addNav };
})(window);
