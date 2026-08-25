/**
 * Rôles CMS + panneau superadmin « Comptes & droits ».
 */
(function (global) {
  var accounts = [];
  var busy = false;

  function githubToken() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.githubToken === 'function') return search.githubToken() || '';
    return '';
  }

  function findSidebar() {
    var root = document.getElementById('nc-root') || document.body;
    var nodes = root.querySelectorAll('aside, [class*="Sidebar"], [class*="sidebar"]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].querySelector && nodes[i].querySelector('a[href*="collections"]')) return nodes[i];
    }
    return document.querySelector('aside');
  }

  function applyDetectedRole(login, role) {
    if (!role) return;
    global.__SONAR_CMS_LOGIN = login || '';
    global.__SONAR_CMS_ROLE = role;
    global.__SONAR_CMS_SUPERADMIN = role === 'superadmin';
    document.body.classList.toggle('sonar-role-superadmin', role === 'superadmin');
    document.body.classList.toggle('sonar-role-admin', role === 'admin');
    if (role === 'superadmin') addAccountsNav(findSidebar());
  }

  function detectRole() {
    if (global.__SONAR_CMS_ROLE === 'superadmin') {
      addAccountsNav(findSidebar());
      return;
    }
    if (global.__SONAR_CMS_ROLE === 'admin') return;
    var token = githubToken();
    var headers = authHeaders();
    var loginPromise = token
      ? fetch('https://api.github.com/user', {
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }
        }).then(function (res) {
          return res.ok ? res.json().then(function (u) { return String(u.login || '').toLowerCase(); }) : '';
        }).catch(function () { return ''; })
      : Promise.resolve('');
    var mePromise = token
      ? fetch('/api/admin/me', { headers: headers, cache: 'no-store' })
          .then(function (res) { return res.ok ? res.json() : null; })
          .catch(function () { return null; })
      : Promise.resolve(null);
    var listPromise = fetch('/api/cms-accounts', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : { accounts: [] }; })
      .then(function (data) { return data.accounts || []; })
      .catch(function () { return []; });

    Promise.all([mePromise, listPromise, loginPromise]).then(function (parts) {
      var me = parts[0];
      var list = parts[1] || [];
      var login = (me && me.login) || parts[2] || '';
      if (me && me.role) {
        applyDetectedRole(me.login, me.role);
        return;
      }
      login = String(login || '').toLowerCase();
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].login || '').toLowerCase() === login) {
          applyDetectedRole(login, list[i].role || 'admin');
          return;
        }
      }
      if (login === 'paul-delachaux') applyDetectedRole(login, 'superadmin');
    });
  }

  function isSuperadmin() {
    return global.__SONAR_CMS_ROLE === 'superadmin';
  }

  function isSimpleAdmin() {
    return global.__SONAR_CMS_ROLE === 'admin';
  }

  function authHeaders() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.authHeaders === 'function') {
      return search.authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' });
    }
    return { 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function installNetworkGuard() {
    if (!isSimpleAdmin() || global.fetch.__sonarRoleGuard) return;
    var orig = global.fetch;
    global.fetch = function (input, init) {
      var url = '';
      try {
        if (typeof input === 'string') url = input;
        else if (input && typeof input.url === 'string') url = input.url;
      } catch (e) {}
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (/api\.github\.com/i.test(url)) {
        if (/\/merge(\?|$)/.test(url) && (method === 'PUT' || method === 'POST')) {
          return Promise.reject(new Error('Publication réservée aux superadmins.'));
        }
        if (method === 'DELETE' && /\/contents\//.test(url)) {
          return Promise.reject(new Error('Suppression réservée aux superadmins.'));
        }
        if (/\/git\/refs\/heads\/main(\?|$)/.test(url) && (method === 'PATCH' || method === 'POST' || method === 'PUT')) {
          return Promise.reject(new Error('Action réservée aux superadmins.'));
        }
        if ((method === 'PUT' || method === 'PATCH') && /\/contents\/src\/data\//.test(url)) {
          return Promise.reject(new Error('Paramètres réservés aux superadmins.'));
        }
      }
      if (/\/api\/admin\/(bulk-articles|comments|reports|accounts)(\?|$)/.test(url) && method !== 'GET') {
        return Promise.reject(new Error('Action réservée aux superadmins.'));
      }
      return orig.apply(this, arguments);
    };
    global.fetch.__sonarRoleGuard = true;
  }

  function hideForbiddenControls(root) {
    if (!isSimpleAdmin()) return;
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll ? scope.querySelectorAll('button, a') : [];
    Array.prototype.forEach.call(nodes, function (el) {
      var text = String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!text) return;
      if (
        text === 'publier' ||
        text === 'publish' ||
        text === 'publish now' ||
        text === 'publier maintenant' ||
        text.indexOf('publish and create') === 0 ||
        text === 'delete' ||
        text === 'delete entry' ||
        text === 'delete this entry' ||
        text === 'supprimer' ||
        text === 'supprimer l’entrée' ||
        text === 'supprimer l\'entrée' ||
        text === "supprimer l'entrée"
      ) {
        el.style.display = 'none';
      }
    });
  }

  function ensurePanel() {
    var existing = document.getElementById('sonar-accounts');
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = 'sonar-accounts';
    root.hidden = true;
    root.innerHTML =
      '<div class="sonar-acc-backdrop" data-acc-close="1"></div>' +
      '<section class="sonar-acc-panel" role="dialog" aria-labelledby="sonar-acc-title">' +
        '<div class="sonar-acc-header">' +
          '<div>' +
            '<p class="sonar-acc-kicker">Administration</p>' +
            '<h2 id="sonar-acc-title">Comptes &amp; droits</h2>' +
          '</div>' +
          '<button type="button" class="sonar-acc-close" data-acc-close="1" aria-label="Fermer">Fermer</button>' +
        '</div>' +
        '<div class="sonar-acc-body">' +
          '<p class="sonar-acc-status" id="sonar-acc-status">Chargement…</p>' +
          '<p class="sonar-acc-hint">Les identifiants sont les <strong>logins GitHub</strong>. Un admin simple peut créer et éditer des articles, et les passer en relecture / prêts. Seul un superadmin peut publier, supprimer, changer la config du site ou gérer les comptes.</p>' +
          '<p class="sonar-acc-hint">Pour qu’un nouveau compte puisse enregistrer des articles, il doit aussi être <strong>collaborateur Write</strong> du dépôt GitHub.</p>' +
          '<div id="sonar-acc-list"></div>' +
          '<form id="sonar-acc-form" class="sonar-acc-form">' +
            '<h3>Ajouter un compte</h3>' +
            '<label>Login GitHub<input id="sonar-acc-login" type="text" autocomplete="off" spellcheck="false" placeholder="ex. jane-doe" required></label>' +
            '<label>Nom affiché (optionnel)<input id="sonar-acc-label" type="text" autocomplete="off" placeholder="Jane Doe"></label>' +
            '<label>Rôle<select id="sonar-acc-role"><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></label>' +
            '<label class="sonar-acc-check"><input id="sonar-acc-invite" type="checkbox" checked> Inviter comme collaborateur GitHub (Write)</label>' +
            '<button type="submit" class="sonar-acc-save">Ajouter</button>' +
          '</form>' +
        '</div>' +
      '</section>';
    document.body.appendChild(root);

    root.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.getAttribute && target.getAttribute('data-acc-close')) close();
    });
    document.getElementById('sonar-acc-form').addEventListener('submit', onAdd);
    return root;
  }

  function setStatus(message, kind) {
    var el = document.getElementById('sonar-acc-status');
    if (!el) return;
    el.textContent = message || '';
    el.setAttribute('data-kind', kind || '');
  }

  function renderList() {
    var wrap = document.getElementById('sonar-acc-list');
    if (!wrap) return;
    if (!accounts.length) {
      wrap.innerHTML = '<p class="sonar-acc-empty">Aucun compte.</p>';
      return;
    }
    wrap.innerHTML = accounts.map(function (account) {
      var you = account.login === String(global.__SONAR_CMS_LOGIN || '').toLowerCase();
      return (
        '<article class="sonar-acc-card">' +
          '<div class="sonar-acc-card-top">' +
            '<div>' +
              '<strong>@' + escapeHtml(account.login) + '</strong>' +
              (account.label ? '<span class="sonar-acc-label"> ' + escapeHtml(account.label) + '</span>' : '') +
              (you ? '<span class="sonar-acc-you">vous</span>' : '') +
            '</div>' +
            '<select data-acc-role="' + escapeHtml(account.login) + '"' + (you ? ' disabled' : '') + '>' +
              '<option value="admin"' + (account.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
              '<option value="superadmin"' + (account.role === 'superadmin' ? ' selected' : '') + '>Superadmin</option>' +
            '</select>' +
          '</div>' +
          (you
            ? '<p class="sonar-acc-meta">Votre compte ne peut pas être modifié ici.</p>'
            : '<button type="button" class="sonar-acc-remove" data-acc-remove="' + escapeHtml(account.login) + '">Retirer</button>') +
        '</article>'
      );
    }).join('');

    wrap.querySelectorAll('[data-acc-role]').forEach(function (select) {
      select.addEventListener('change', function () {
        changeRole(select.getAttribute('data-acc-role'), select.value);
      });
    });
    wrap.querySelectorAll('[data-acc-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeAccount(btn.getAttribute('data-acc-remove'));
      });
    });
  }

  function saveAccounts(next, inviteLogin) {
    if (busy) return Promise.resolve();
    busy = true;
    setStatus('Enregistrement…');
    return fetch('/api/admin/accounts', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ accounts: next, invite: inviteLogin || '' })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status);
        accounts = data.accounts || next;
        renderList();
        var extra = data.invite && data.invite.message ? ' ' + data.invite.message : '';
        setStatus('Enregistré.' + extra, data.invite && data.invite.ok === false ? 'err' : '');
        return data;
      });
    }).catch(function (err) {
      setStatus(err && err.message ? err.message : 'Enregistrement impossible.', 'err');
    }).then(function (data) {
      busy = false;
      return data;
    });
  }

  function changeRole(login, role) {
    var next = accounts.map(function (account) {
      if (account.login !== login) return account;
      return { login: account.login, role: role, label: account.label };
    });
    saveAccounts(next);
  }

  function removeAccount(login) {
    if (!global.confirm('Retirer @' + login + ' de l’admin ?')) return;
    saveAccounts(accounts.filter(function (account) { return account.login !== login; }));
  }

  function onAdd(event) {
    event.preventDefault();
    var loginEl = document.getElementById('sonar-acc-login');
    var labelEl = document.getElementById('sonar-acc-label');
    var roleEl = document.getElementById('sonar-acc-role');
    var inviteEl = document.getElementById('sonar-acc-invite');
    var login = String(loginEl && loginEl.value || '').trim().replace(/^@/, '').toLowerCase();
    if (!login) return;
    if (accounts.some(function (account) { return account.login === login; })) {
      setStatus('Ce compte est déjà dans la liste.', 'err');
      return;
    }
    var next = accounts.concat([{
      login: login,
      role: roleEl.value === 'superadmin' ? 'superadmin' : 'admin',
      label: String(labelEl && labelEl.value || '').trim()
    }]);
    saveAccounts(next, inviteEl && inviteEl.checked ? login : '').then(function (data) {
      if (!data) return;
      loginEl.value = '';
      labelEl.value = '';
      roleEl.value = 'admin';
    });
  }

  function load() {
    setStatus('Chargement…');
    return fetch('/api/admin/accounts', { headers: authHeaders(), cache: 'no-store' })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.message || 'HTTP ' + res.status);
          accounts = data.accounts || [];
          renderList();
          setStatus('');
        });
      })
      .catch(function (err) {
        setStatus(err && err.message ? err.message : 'Impossible de charger les comptes.', 'err');
      });
  }

  function open() {
    if (!isSuperadmin()) return;
    ensurePanel().hidden = false;
    load();
  }

  function close() {
    var root = document.getElementById('sonar-accounts');
    if (root) root.hidden = true;
  }

  function addAccountsNav(sidebarContainer) {
    if (!isSuperadmin() || !sidebarContainer || sidebarContainer.querySelector('#cms-accounts-group')) return;

    var header = document.createElement('div');
    header.id = 'cms-accounts-group';
    header.className = 'cms-sidebar-header';
    header.style.cssText = [
      'cursor:pointer',
      'font-weight:bold',
      'font-size:0.85rem',
      'text-transform:uppercase',
      'letter-spacing:0.5px',
      'background:#01002b',
      'color:#ffffff',
      'padding:10px 14px',
      'margin-top:8px',
      'border-radius:6px',
      'display:flex',
      'justify-content:space-between',
      'align-items:center',
      'user-select:none'
    ].join(';');
    header.innerHTML = '<span>Administration</span><span class="arrow" style="font-size: 0.7rem;">▼</span>';

    var item = document.createElement('button');
    item.type = 'button';
    item.id = 'cms-accounts-nav';
    item.className = 'cms-moderation-item';
    item.style.paddingLeft = '10px';
    item.innerHTML = '<span>Comptes &amp; droits</span>';
    item.addEventListener('click', function (event) {
      event.preventDefault();
      open();
    });

    var collapsed = false;
    header.addEventListener('click', function () {
      collapsed = !collapsed;
      var arrow = header.querySelector('.arrow');
      if (arrow) arrow.textContent = collapsed ? '►' : '▼';
      item.style.display = collapsed ? 'none' : 'flex';
    });

    sidebarContainer.appendChild(header);
    sidebarContainer.appendChild(item);
  }

  var hideObs = new MutationObserver(function (mutations) {
    if (!isSimpleAdmin()) return;
    for (var i = 0; i < mutations.length; i++) {
      var nodes = mutations[i].addedNodes || [];
      for (var n = 0; n < nodes.length; n++) {
        if (nodes[n] && nodes[n].nodeType === 1) hideForbiddenControls(nodes[n]);
      }
    }
  });

  function bootGuards() {
    installNetworkGuard();
    hideForbiddenControls(document);
    hideObs.observe(document.body, { childList: true, subtree: true });
  }

  global.SonarAccountsAdmin = {
    open: open,
    close: close,
    addNav: addAccountsNav,
    isSuperadmin: isSuperadmin,
    isSimpleAdmin: isSimpleAdmin,
    bootGuards: bootGuards
  };

  function start() {
    if (!global.__SONAR_CMS_BOOTED) {
      setTimeout(start, 120);
      return;
    }
    bootGuards();
    detectRole();
    var n = 0;
    var iv = setInterval(function () {
      n += 1;
      detectRole();
      if (document.getElementById('cms-accounts-group') || n > 90) {
        clearInterval(iv);
      }
    }, 1000);
  }
  start();
})(window);
