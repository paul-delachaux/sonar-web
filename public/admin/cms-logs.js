/**
 * Capture les erreurs CMS « réelles » (pas les champs obligatoires)
 * et panneau superadmin « Logs CMS ».
 */
(function (global) {
  var QUEUE_KEY = 'sonar-cms-error-queue';
  var sending = false;
  var recent = {};

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
      } catch (e) {}
    }
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Sonar-GitHub'] = token;
      headers['X-Github-Token'] = token;
    }
    return headers;
  }

  function isSuperadmin() {
    return global.__SONAR_CMS_ROLE === 'superadmin';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function editorContext() {
    var hash = String(global.location && global.location.hash || '');
    var match = hash.match(/collections\/([^/?#]+)\/(?:entries\/([^/?#]+)|new)/i);
    return {
      collection: match ? decodeURIComponent(match[1]) : '',
      entry_slug: match && match[2] ? decodeURIComponent(match[2]) : (hash.indexOf('/new') !== -1 ? '(nouveau)' : '')
    };
  }

  function isNoise(text) {
    var t = String(text || '').toLowerCase();
    if (!t.trim()) return true;
    if (t.indexOf('/api/admin/logs') !== -1) return true;
    return (
      /is required|est requis|required field|champ obligatoire|can't be blank|ne peut pas être vide|fields have errors|this field is|ce champ est|please fill|veuillez remplir|veuillez renseigner|must be a number|n'est pas un nombre|widget is|réservée aux superadmins|reservee aux superadmins/.test(t)
    );
  }

  function looksSerious(text) {
    return /failed to persist|failed to load|failed to save|failed to publish|github|api_error|networkerror|typeerror|unexpected|forbidden|conflict|status 4|status 5|\b409\b|\b422\b|\b500\b|\b502\b|\b503\b|yaml|syntaxerror|cannot read|undefined is not|rate limit|ruleset|not allowed|unauthorized|\b401\b|\b403\b|erreur serveur|impossible de/.test(String(text || '').toLowerCase());
  }

  function readQueue() {
    try {
      var raw = global.localStorage.getItem(QUEUE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(list) {
    try {
      global.localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-30)));
    } catch (e) {}
  }

  function fingerprint(entry) {
    return [entry.source, entry.message, entry.collection, entry.entry_slug].join('|').slice(0, 400);
  }

  function report(entry) {
    if (!entry || isNoise(entry.message)) return;
    var now = Date.now();
    var key = fingerprint(entry);
    if (recent[key] && now - recent[key] < 15000) return;
    recent[key] = now;

    var ctx = editorContext();
    var payload = {
      level: entry.level || 'error',
      source: entry.source || 'cms',
      message: String(entry.message || '').slice(0, 4000),
      stack: entry.stack ? String(entry.stack).slice(0, 8000) : '',
      href: String((global.location && (global.location.pathname + global.location.hash)) || '').slice(0, 500),
      collection: entry.collection || ctx.collection,
      entry_slug: entry.entry_slug || ctx.entry_slug,
      status: entry.status || null,
      extra: entry.extra || null,
      user_agent: String(global.navigator && global.navigator.userAgent || '').slice(0, 400)
    };

    var queue = readQueue();
    queue.push(payload);
    writeQueue(queue);
    flushQueue();
  }

  function flushQueue() {
    if (sending) return;
    var queue = readQueue();
    if (!queue.length) return;
    sending = true;
    var next = queue[0];
    fetch('/api/admin/logs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(next),
      cache: 'no-store'
    }).then(function (res) {
      sending = false;
      if (res.status === 401 || res.status === 403) return;
      if (res.status >= 500) return;
      if (res.ok) {
        writeQueue(readQueue().slice(1));
        setTimeout(flushQueue, 80);
      }
    }).catch(function () {
      sending = false;
    });
  }

  function installCapture() {
    if (global.__SONAR_CMS_LOGS_CAPTURE) return;
    global.__SONAR_CMS_LOGS_CAPTURE = true;

    global.addEventListener('error', function (event) {
      var msg = (event && event.message) || (event && event.error && event.error.message) || 'Erreur JS';
      if (isNoise(msg)) return;
      report({
        source: 'js',
        message: msg,
        stack: event && event.error && event.error.stack
      });
    });

    global.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var msg = '';
      var stack = '';
      if (reason && typeof reason === 'object') {
        msg = reason.message || String(reason);
        stack = reason.stack || '';
      } else {
        msg = String(reason || 'Promesse rejetée');
      }
      if (isNoise(msg)) return;
      report({ source: 'js', message: msg, stack: stack });
    });

    var origFetch = global.fetch;
    global.fetch = function (input, init) {
      var url = '';
      try {
        if (typeof input === 'string') url = input;
        else if (input && typeof input.url === 'string') url = input.url;
      } catch (e) {}
      return origFetch.apply(this, arguments).then(function (res) {
        try {
          inspectFetch(url, res);
        } catch (e) {}
        return res;
      }, function (err) {
        var msg = err && err.message ? err.message : String(err || 'fetch failed');
        if (!isNoise(msg)) {
          report({
            source: 'network',
            message: msg + (url ? ' — ' + url : ''),
            extra: { url: url }
          });
        }
        throw err;
      });
    };

    var origError = console.error;
    console.error = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var arg = arguments[i];
          if (arg && typeof arg === 'object' && arg.message) parts.push(arg.message);
          else parts.push(String(arg));
        }
        var joined = parts.join(' ');
        if (!isNoise(joined) && looksSerious(joined)) {
          report({ source: 'console', message: joined.slice(0, 4000) });
        }
      } catch (e) {}
      return origError.apply(console, arguments);
    };

    var toastObs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes || [];
        for (var n = 0; n < nodes.length; n++) {
          inspectToast(nodes[n]);
        }
      }
    });
    if (document.body) {
      toastObs.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        toastObs.observe(document.body, { childList: true, subtree: true });
      });
    }

    setInterval(flushQueue, 15000);
    flushQueue();
  }

  function inspectFetch(url, res) {
    if (!res || res.ok) return;
    if (!url) return;
    if (/\/api\/admin\/logs/.test(url)) return;
    var github = /api\.github\.com/i.test(url);
    var adminApi = /\/api\/admin\//.test(url);
    if (!github && !adminApi) return;
    if (res.status === 404) return;
    var methodNote = 'HTTP ' + res.status + ' ' + url.replace(/^https?:\/\/[^/]+/, '');
    var copy = res.clone();
    copy.text().then(function (body) {
      var snippet = String(body || '').replace(/\s+/g, ' ').slice(0, 400);
      report({
        source: 'network',
        message: methodNote + (snippet ? ' — ' + snippet : ''),
        status: res.status,
        extra: { url: url }
      });
    }).catch(function () {
      report({ source: 'network', message: methodNote, status: res.status, extra: { url: url } });
    });
  }

  function inspectToast(node) {
    if (!node || node.nodeType !== 1) return;
    var text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 800) return;
    if (isNoise(text)) return;
    if (!looksSerious(text)) return;
    var cls = String(node.className || '');
    var interesting = /notif|toast|error|alert|danger/i.test(cls) || (node.getAttribute && /error|alert|danger/i.test(node.getAttribute('class') || ''));
    if (!interesting && node.querySelector) {
      interesting = Boolean(node.querySelector('[class*="Error"], [class*="error"], [class*="Toast"], [class*="Notification"]'));
    }
    if (!interesting) return;
    report({ source: 'toast', message: text.slice(0, 1000) });
  }

  function ensurePanel() {
    var existing = document.getElementById('sonar-logs');
    if (existing) return existing;
    var root = document.createElement('div');
    root.id = 'sonar-logs';
    root.hidden = true;
    root.innerHTML =
      '<div class="sonar-acc-backdrop" data-log-close="1"></div>' +
      '<section class="sonar-acc-panel sonar-log-panel" role="dialog" aria-labelledby="sonar-log-title">' +
        '<div class="sonar-acc-header">' +
          '<div>' +
            '<p class="sonar-acc-kicker">Administration</p>' +
            '<h2 id="sonar-log-title">Logs CMS</h2>' +
          '</div>' +
          '<button type="button" class="sonar-acc-close" data-log-close="1" aria-label="Fermer">Fermer</button>' +
        '</div>' +
        '<div class="sonar-acc-body">' +
          '<p class="sonar-acc-status" id="sonar-log-status">Chargement…</p>' +
          '<p class="sonar-acc-hint">Erreurs techniques captées dans l’admin (sauvegarde GitHub, JS, API). Les messages « champ obligatoire » ne sont pas enregistrés. Les erreurs passées, avant cette page, n’existent plus.</p>' +
          '<div class="sonar-log-toolbar">' +
            '<button type="button" class="sonar-acc-save" data-log-refresh="1">Actualiser</button>' +
            '<button type="button" class="sonar-acc-remove" data-log-clear="1">Tout vider</button>' +
          '</div>' +
          '<div id="sonar-log-list"></div>' +
        '</div>' +
      '</section>';
    document.body.appendChild(root);
    root.addEventListener('click', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.getAttribute && target.getAttribute('data-log-close')) close();
      if (target.getAttribute && target.getAttribute('data-log-refresh')) load();
      if (target.getAttribute && target.getAttribute('data-log-clear')) clearAll();
      var del = target.closest && target.closest('[data-log-del]');
      if (del) removeOne(del.getAttribute('data-log-del'));
      var toggle = target.closest && target.closest('[data-log-toggle]');
      if (toggle) {
        var pre = toggle.parentNode && toggle.parentNode.querySelector('pre');
        if (pre) pre.hidden = !pre.hidden;
      }
    });
    return root;
  }

  function setStatus(text, kind) {
    var el = document.getElementById('sonar-log-status');
    if (!el) return;
    el.textContent = text || '';
    if (kind) el.setAttribute('data-kind', kind);
    else el.removeAttribute('data-kind');
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'medium'
      });
    } catch (e) {
      return iso || '';
    }
  }

  function render(items) {
    var wrap = document.getElementById('sonar-log-list');
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML = '<p class="sonar-acc-empty">Aucune erreur enregistrée pour l’instant.</p>';
      return;
    }
    wrap.innerHTML = items.map(function (item) {
      var meta = [
        item.login ? '@' + item.login : '',
        item.source,
        item.collection,
        item.entry_slug,
        item.status ? 'HTTP ' + item.status : ''
      ].filter(Boolean).join(' · ');
      var extra = item.stack || (item.extra ? JSON.stringify(item.extra, null, 2) : '');
      return (
        '<article class="sonar-acc-card sonar-log-card">' +
          '<div class="sonar-acc-card-top">' +
            '<strong>' + escapeHtml(formatDate(item.created_at)) + '</strong>' +
            '<button type="button" class="sonar-acc-remove" data-log-del="' + escapeHtml(item.id) + '">Supprimer</button>' +
          '</div>' +
          '<p class="sonar-acc-meta">' + escapeHtml(meta) + '</p>' +
          '<p class="sonar-log-message">' + escapeHtml(item.message) + '</p>' +
          (item.href ? '<p class="sonar-acc-meta">' + escapeHtml(item.href) + '</p>' : '') +
          (extra
            ? '<button type="button" class="sonar-log-more" data-log-toggle="1">Détails</button><pre class="sonar-log-stack" hidden>' + escapeHtml(extra) + '</pre>'
            : '') +
        '</article>'
      );
    }).join('');
  }

  function load() {
    if (!isSuperadmin()) return;
    setStatus('Chargement…');
    fetch('/api/admin/logs', { headers: authHeaders(), cache: 'no-store' })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (parts) {
        if (!parts.res.ok) {
          setStatus(parts.data && parts.data.message ? parts.data.message : 'Impossible de charger les logs.', 'err');
          render([]);
          return;
        }
        var items = (parts.data && parts.data.items) || [];
        setStatus(parts.data && parts.data.setup ? parts.data.message : (items.length + ' entrée' + (items.length > 1 ? 's' : '')), parts.data && parts.data.setup ? 'err' : '');
        render(items);
      })
      .catch(function (err) {
        setStatus(err && err.message ? err.message : 'Impossible de charger les logs.', 'err');
      });
  }

  function removeOne(id) {
    if (!id) return;
    fetch('/api/admin/logs?id=' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: authHeaders()
    }).then(function () { load(); });
  }

  function clearAll() {
    if (!global.confirm('Vider tout le journal CMS ?')) return;
    fetch('/api/admin/logs?all=1', { method: 'DELETE', headers: authHeaders() })
      .then(function () { load(); });
  }

  function open() {
    if (!isSuperadmin()) return;
    ensurePanel().hidden = false;
    load();
  }

  function close() {
    var root = document.getElementById('sonar-logs');
    if (root) root.hidden = true;
  }

  function addLogsNav(sidebarContainer) {
    if (!isSuperadmin()) return;
    var accounts = document.getElementById('cms-accounts-nav');
    if (!accounts || !accounts.parentNode) {
      if (sidebarContainer) accounts = sidebarContainer.querySelector('#cms-accounts-nav');
    }
    if (!accounts || !accounts.parentNode) return;
    var logsItem = document.getElementById('cms-logs-nav');
    if (!logsItem) {
      logsItem = document.createElement('button');
      logsItem.type = 'button';
      logsItem.id = 'cms-logs-nav';
      logsItem.className = 'cms-moderation-item';
      logsItem.style.paddingLeft = '10px';
      logsItem.style.display = 'flex';
      logsItem.innerHTML = '<span>Logs CMS</span>';
      logsItem.addEventListener('click', function (event) {
        event.preventDefault();
        open();
      });
    }
    if (logsItem.parentNode !== accounts.parentNode || logsItem.previousSibling !== accounts) {
      accounts.parentNode.insertBefore(logsItem, accounts.nextSibling);
    }
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.getElementById('sonar-logs') && !document.getElementById('sonar-logs').hidden) {
      close();
    }
  });

  global.SonarCmsLogs = {
    open: open,
    close: close,
    report: report,
    addNav: addLogsNav
  };

  installCapture();
  var navTries = 0;
  var navIv = setInterval(function () {
    navTries += 1;
    addLogsNav();
    if (document.getElementById('cms-logs-nav') || navTries > 60) clearInterval(navIv);
  }, 500);
})(window);
