(function (global) {
  var current = null;
  var profiles = [];
  var accounts = [];
  var selectedName = '';
  var busy = false;
  var navTimer = null;
  var navLoading = false;
  var navRetryAfter = 0;

  function authHeaders() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.authHeaders === 'function') {
      return search.authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' });
    }
    var token = global.__SONAR_GH_TOKEN || '';
    var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function addStyle() {
    if (document.getElementById('sonar-author-profile-style')) return;
    var style = document.createElement('style');
    style.id = 'sonar-author-profile-style';
    style.textContent =
      '#sonar-author-profiles[hidden]{display:none!important}#sonar-author-profiles{position:fixed;inset:0;z-index:100000;font-family:Helvetica,Arial,sans-serif;color:#fff}' +
      '.sonar-ap-backdrop{position:absolute;inset:0;background:rgba(0,0,20,.76)}.sonar-ap-panel{position:absolute;inset:20px 20px 20px auto;width:min(680px,calc(100% - 40px));overflow:auto;background:#080725;border:1px solid #34324f;border-radius:12px;box-shadow:0 20px 70px #000;padding:24px}' +
      '.sonar-ap-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid #34324f;padding-bottom:16px}.sonar-ap-header h2{margin:2px 0;font-size:22px}.sonar-ap-kicker{margin:0;color:#ff7900;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}' +
      '.sonar-ap-header h2{color:#fff!important}.sonar-ap-close,.sonar-ap-button{border:1px solid #54516e;border-radius:6px;background:#171538;color:#fff;padding:9px 13px;font-weight:700;cursor:pointer}.sonar-ap-button.primary{background:#ff7900;border-color:#ff7900;color:#090820}.sonar-ap-button.danger{border-color:#9c3d3d;color:#ffb1b1}.sonar-ap-body{padding-top:16px}.sonar-ap-status{min-height:20px;color:#d4d2e3}.sonar-ap-status[data-error=true]{color:#ff9292}.sonar-ap-hint{color:#b9b7cb;font-size:13px;line-height:1.5}.sonar-ap-field{display:block;margin:14px 0}.sonar-ap-field span{display:block;margin:0 0 6px;font-size:13px;font-weight:700}.sonar-ap-field input,.sonar-ap-field textarea,.sonar-ap-field select,.sonar-ap-select{box-sizing:border-box;width:100%;border:1px solid #494765;border-radius:6px;background:#01001d;color:#fff;padding:10px;font:inherit}.sonar-ap-field textarea{min-height:90px;resize:vertical}.sonar-ap-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.sonar-ap-new{display:grid;grid-template-columns:1fr 1fr auto;align-items:end;gap:10px;margin:18px 0;padding:14px;border:1px solid #34324f;border-radius:8px}.sonar-ap-new .sonar-ap-field{margin:0}.sonar-ap-profile-picker{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;margin:14px 0}.sonar-ap-avatar-control{display:flex;align-items:center;gap:14px;margin:16px 0;padding:14px;border:1px solid #34324f;border-radius:8px}.sonar-ap-avatar-preview{width:72px;height:72px;border-radius:50%;object-fit:cover;background:#20203b}.sonar-ap-avatar-input{min-width:0;color:#ddd}.sonar-ap-avatar-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;flex:1}@media(max-width:600px){.sonar-ap-panel{inset:0;width:auto;border-radius:0;padding:18px}.sonar-ap-new{grid-template-columns:1fr}.sonar-ap-profile-picker{grid-template-columns:1fr}.sonar-ap-avatar-control{align-items:flex-start;flex-direction:column}.sonar-ap-avatar-actions{width:100%}}';
    document.head.appendChild(style);
  }

  function ensurePanel() {
    var root = document.getElementById('sonar-author-profiles');
    if (root) return root;
    addStyle();
    root = document.createElement('div');
    root.id = 'sonar-author-profiles';
    root.hidden = true;
    root.innerHTML =
      '<div class="sonar-ap-backdrop" data-ap-close="1"></div>' +
      '<section class="sonar-ap-panel" role="dialog" aria-modal="true" aria-labelledby="sonar-ap-title">' +
        '<header class="sonar-ap-header"><div><p class="sonar-ap-kicker">Administration</p><h2 id="sonar-ap-title">Mon profil d’auteur</h2></div><button type="button" class="sonar-ap-close" data-ap-close="1">Fermer</button></header>' +
        '<div class="sonar-ap-body"><p class="sonar-ap-status" id="sonar-ap-status">Chargement…</p><div id="sonar-ap-content"></div></div>' +
      '</section>';
    document.body.appendChild(root);
    root.addEventListener('click', function (event) {
      if (event.target && event.target.getAttribute && event.target.getAttribute('data-ap-close')) close();
    });
    return root;
  }

  function setStatus(message, error) {
    var el = document.getElementById('sonar-ap-status');
    if (!el) return;
    el.textContent = message || '';
    el.setAttribute('data-error', error ? 'true' : 'false');
  }

  function selectedProfile() {
    return profiles.find(function (profile) { return profile.name === selectedName; }) || null;
  }

  function accountOptions(account, profileName) {
    return '<option value="">Non associé</option>' + accounts.map(function (item) {
      var alreadyAssigned = profiles.some(function (profile) {
        return profile.name !== profileName &&
          String(profile.account || '').toLowerCase() === String(item.login || '').toLowerCase();
      });
      var label = '@' + item.login + (item.label ? ' · ' + item.label : '');
      return '<option value="' + escapeHtml(item.login) + '"' +
        (String(item.login).toLowerCase() === String(account || '').toLowerCase() ? ' selected' : '') +
        (alreadyAssigned ? ' disabled' : '') +
        '>' + escapeHtml(label) + '</option>';
    }).join('');
  }

  function render() {
    var content = document.getElementById('sonar-ap-content');
    if (!content) return;
    var superadmin = global.__SONAR_CMS_ROLE === 'superadmin';
    var profile = superadmin ? selectedProfile() : current;
    if (!profile) {
      if (!superadmin) {
        content.innerHTML = '<p class="sonar-ap-hint">Aucun profil auteur n’est associé à ce compte. Demandez à un superadmin de l’associer dans les profils auteurs.</p>';
        return;
      }
      content.innerHTML =
        '<form id="sonar-ap-new" class="sonar-ap-new"><label class="sonar-ap-field"><span>Nom du nouvel auteur</span><input id="sonar-ap-new-name" maxlength="100" required></label><label class="sonar-ap-field"><span>Compte admin associé</span><select id="sonar-ap-new-account" required>' + accountOptions('', '') + '</select></label><button class="sonar-ap-button primary" type="submit">Créer</button></form>' +
        '<p class="sonar-ap-hint">Aucun profil auteur n’est créé pour le moment.</p>';
      document.getElementById('sonar-ap-new').addEventListener('submit', createProfile);
      return;
    }

    var picker = superadmin
      ? '<div class="sonar-ap-profile-picker"><select class="sonar-ap-select" id="sonar-ap-picker"></select>' +
        '<button type="button" class="sonar-ap-button danger" id="sonar-ap-delete">Supprimer le profil</button></div>' +
        '<label class="sonar-ap-field"><span>Compte admin associé</span><select id="sonar-ap-account">' + accountOptions(profile.account, profile.name) + '</select></label>'
      : '<p class="sonar-ap-hint">Profil associé à <strong>@' + escapeHtml(global.__SONAR_CMS_LOGIN) + '</strong>. Vous pouvez modifier vos informations, mais pas votre nom ni l’association au compte.</p>';
    content.innerHTML =
      (superadmin
        ? '<form id="sonar-ap-new" class="sonar-ap-new"><label class="sonar-ap-field"><span>Nom du nouvel auteur</span><input id="sonar-ap-new-name" maxlength="100" required></label><label class="sonar-ap-field"><span>Compte admin associé</span><select id="sonar-ap-new-account" required>' + accountOptions('', '') + '</select></label><button class="sonar-ap-button primary" type="submit">Créer</button></form>'
        : '') +
      picker +
      '<p class="sonar-ap-hint">Ces valeurs sont utilisées par défaut sur la page auteur et les articles. Une valeur saisie directement dans un article reste prioritaire.</p>' +
      '<div class="sonar-ap-avatar-control"><img class="sonar-ap-avatar-preview" id="sonar-ap-avatar-preview" src="' + escapeHtml(profile.avatar || '') + '" alt="Portrait de ' + escapeHtml(profile.name) + '" ' + (profile.avatar ? '' : 'hidden') + '><div class="sonar-ap-avatar-actions"><label class="sonar-ap-field"><span>Image de profil (PNG, JPEG ou WebP, max. 4 Mo)</span><input class="sonar-ap-avatar-input" id="sonar-ap-avatar-file" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="sonar-ap-button" id="sonar-ap-avatar-upload">Envoyer l’image</button></div></div>' +
      '<label class="sonar-ap-field"><span>À propos de l’auteur (FR)</span><textarea id="sonar-ap-about">' + escapeHtml(profile.about) + '</textarea></label>' +
      '<label class="sonar-ap-field"><span>À propos de l’auteur (EN)</span><textarea id="sonar-ap-about-en">' + escapeHtml(profile.about_en) + '</textarea></label>' +
      '<label class="sonar-ap-field"><span>Déclaration d’intérêt général (FR)</span><textarea id="sonar-ap-interests">' + escapeHtml(profile.interests) + '</textarea></label>' +
      '<label class="sonar-ap-field"><span>Déclaration d’intérêt général (EN)</span><textarea id="sonar-ap-interests-en">' + escapeHtml(profile.interests_en) + '</textarea></label>' +
      '<label class="sonar-ap-field"><span>Partenaires (FR)</span><textarea id="sonar-ap-partners">' + escapeHtml(profile.partners) + '</textarea></label>' +
      '<label class="sonar-ap-field"><span>Partenaires (EN)</span><textarea id="sonar-ap-partners-en">' + escapeHtml(profile.partners_en) + '</textarea></label>' +
      '<div class="sonar-ap-actions"><button type="button" class="sonar-ap-button primary" id="sonar-ap-save">Enregistrer</button></div>';

    if (superadmin) {
      var picker = document.getElementById('sonar-ap-picker');
      picker.innerHTML = profiles.map(function (item) {
        return '<option value="' + escapeHtml(item.name) + '"' + (item.name === selectedName ? ' selected' : '') + '>' + escapeHtml(item.name) + '</option>';
      }).join('');
      picker.addEventListener('change', function () {
        selectedName = picker.value;
        render();
      });
      document.getElementById('sonar-ap-new').addEventListener('submit', createProfile);
      document.getElementById('sonar-ap-delete').addEventListener('click', deleteProfile);
    }
    document.getElementById('sonar-ap-save').addEventListener('click', saveProfile);
    document.getElementById('sonar-ap-avatar-upload').addEventListener('click', uploadAvatar);
  }

  function uploadAvatar() {
    var fileInput = document.getElementById('sonar-ap-avatar-file');
    var profile = global.__SONAR_CMS_ROLE === 'superadmin' ? selectedProfile() : current;
    var file = fileInput && fileInput.files && fileInput.files[0];
    if (!profile || !file) {
      setStatus('Choisissez une image à envoyer.', true);
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setStatus('Image trop lourde (maximum 4 Mo).', true);
      return;
    }
    var form = new FormData();
    form.append('file', file);
    form.append('name', profile.name);
    setStatus('Envoi de l’image…');
    var headers = authHeaders();
    delete headers['Content-Type'];
    delete headers['content-type'];
    fetch('/api/admin/author-avatar', {
      method: 'POST',
      headers: headers,
      body: form
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || 'HTTP ' + response.status);
        profiles = data.profiles || profiles;
        if (!global.__SONAR_CMS_SUPERADMIN) current = data.profile || current;
        var preview = document.getElementById('sonar-ap-avatar-preview');
        if (preview && data.profile && data.profile.avatar) {
          preview.src = data.profile.avatar;
          preview.hidden = false;
        }
        setStatus('Image de profil enregistrée.');
      });
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : 'Envoi de l’image impossible.', true);
    });
  }

  function readForm(profile) {
    return {
      name: profile.name,
      avatar: profile.avatar,
      account: global.__SONAR_CMS_ROLE === 'superadmin'
        ? document.getElementById('sonar-ap-account').value
        : profile.account,
      about: document.getElementById('sonar-ap-about').value,
      about_en: document.getElementById('sonar-ap-about-en').value,
      interests: document.getElementById('sonar-ap-interests').value,
      interests_en: document.getElementById('sonar-ap-interests-en').value,
      partners: document.getElementById('sonar-ap-partners').value,
      partners_en: document.getElementById('sonar-ap-partners-en').value
    };
  }

  function requestSave(body) {
    if (busy) return Promise.resolve(null);
    busy = true;
    setStatus('Enregistrement…');
    return fetch('/api/admin/author-profiles', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || 'HTTP ' + response.status);
        profiles = data.profiles || profiles;
        if (!global.__SONAR_CMS_SUPERADMIN) current = data.profile || current;
        setStatus('Profil enregistré.');
        return data;
      });
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : 'Enregistrement impossible.', true);
      return null;
    }).then(function (data) {
      busy = false;
      return data;
    });
  }

  function saveProfile() {
    var profile = global.__SONAR_CMS_ROLE === 'superadmin' ? selectedProfile() : current;
    if (!profile) return;
    var next = readForm(profile);
    var body;
    if (global.__SONAR_CMS_ROLE === 'superadmin') {
      body = { profiles: profiles.map(function (item) { return item.name === selectedName ? next : item; }) };
    } else {
      body = { profile: next };
    }
    requestSave(body).then(function (data) {
      if (!data) return;
      render();
    });
  }

  function createProfile(event) {
    event.preventDefault();
    var name = String(document.getElementById('sonar-ap-new-name').value || '').trim();
    var account = document.getElementById('sonar-ap-new-account').value;
    if (!name || !account) {
      setStatus('Un nom et un compte admin doivent être renseignés.', true);
      return;
    }
    if (profiles.some(function (profile) { return profile.name.toLowerCase() === name.toLowerCase(); })) {
      setStatus('Un profil portant ce nom existe déjà.', true);
      return;
    }
    requestSave({ profiles: profiles.concat([{ name: name, account: account }]) }).then(function (data) {
      if (!data) return;
      selectedName = name;
      render();
    });
  }

  function deleteProfile() {
    if (!selectedProfile()) return;
    if (!global.confirm('Supprimer le profil « ' + selectedName + ' » ? Les articles déjà publiés garderont le nom de cet auteur.')) return;
    var removed = selectedName;
    requestSave({ profiles: profiles.filter(function (profile) { return profile.name !== removed; }) }).then(function (data) {
      if (!data) return;
      selectedName = profiles.length ? profiles[0].name : '';
      render();
    });
  }

  function load() {
    setStatus('Chargement…');
    return fetch('/api/admin/author-profiles', { headers: authHeaders(), cache: 'no-store' })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.message || 'HTTP ' + response.status);
          current = data.profile || null;
          profiles = data.profiles || (current ? [current] : []);
          accounts = data.accounts || [];
          if (!selectedName && profiles.length) selectedName = profiles[0].name;
          document.getElementById('sonar-ap-title').textContent =
            global.__SONAR_CMS_ROLE === 'superadmin' ? 'Profils d’auteur' : 'Mon profil d’auteur';
          render();
          setStatus('');
        });
      })
      .catch(function (error) {
        setStatus(error && error.message ? error.message : 'Impossible de charger les profils auteurs.', true);
      });
  }

  function open() {
    ensurePanel().hidden = false;
    load();
  }

  function close() {
    var root = document.getElementById('sonar-author-profiles');
    if (root) root.hidden = true;
  }

  function addFallbackButton() {
    if (document.getElementById('cms-author-profile-fallback')) return;
    var button = document.createElement('button');
    button.id = 'cms-author-profile-fallback';
    button.type = 'button';
    button.textContent = global.__SONAR_CMS_ROLE === 'superadmin' ? 'Profils d’auteur' : 'Mon profil d’auteur';
    button.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99999;padding:12px 16px;border:0;border-radius:8px;background:#ff7900;color:#090820;font-weight:800;box-shadow:0 4px 16px #0008;cursor:pointer';
    button.addEventListener('click', open);
    document.body.appendChild(button);
  }

  function addNav(providedSidebar) {
    var role = global.__SONAR_CMS_ROLE;
    if (role !== 'admin' && role !== 'superadmin') return Promise.resolve();
    var group = document.querySelector('[data-cms-group]');
    var sidebar = providedSidebar || (group ? group.parentNode : null);
    if (!sidebar) {
      var root = document.getElementById('nc-root') || document.body;
      var nodes = root.querySelectorAll('aside, [class*="Sidebar"], [class*="sidebar"]');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].querySelector && nodes[i].querySelector('a[href*="collections"]')) {
          sidebar = nodes[i];
          break;
        }
      }
    }
    if (!sidebar) {
      addFallbackButton();
      return Promise.resolve(false);
    }
    var existing = document.getElementById('cms-author-profile-nav');
    if (existing) return Promise.resolve();
    if (role === 'superadmin' &&
        !document.getElementById('cms-accounts-group') &&
        !document.getElementById('cms-accounts-nav')) return Promise.resolve(false);
    if (navLoading || Date.now() < navRetryAfter) return Promise.resolve(false);
    navLoading = true;

    return fetch('/api/admin/author-profiles', { headers: authHeaders(), cache: 'no-store' })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.message || 'HTTP ' + response.status);
          if (role !== 'superadmin' && !data.profile) {
            navRetryAfter = Date.now() + 5000;
            return false;
          }
          var item = document.createElement('button');
          item.type = 'button';
          item.id = 'cms-author-profile-nav';
          item.className = 'cms-moderation-item';
          item.style.paddingLeft = '10px';
          item.innerHTML = '<span>' + (role === 'superadmin' ? 'Profils d’auteur' : 'Mon profil d’auteur') + '</span>';
          item.addEventListener('click', function (event) {
            event.preventDefault();
            open();
          });
          var accountsItem = document.getElementById('cms-accounts-nav');
          var logsItem = document.getElementById('cms-logs-nav');
          var anchor = role === 'superadmin' ? (logsItem || accountsItem) : null;
          if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(item, anchor.nextSibling);
          else if (role === 'admin') {
            var header = document.createElement('div');
            header.id = 'cms-author-profile-group';
            header.className = 'cms-sidebar-header';
            header.style.cssText = 'font-weight:bold;font-size:.85rem;text-transform:uppercase;letter-spacing:.5px;background:#01002b;color:#fff;padding:10px 14px;margin-top:8px;border-radius:6px;display:flex;justify-content:space-between;align-items:center;user-select:none;cursor:pointer';
            header.innerHTML = '<span>Administration</span><span class="arrow" style="font-size:.7rem">▼</span>';
            var collapsed = false;
            header.addEventListener('click', function () {
              collapsed = !collapsed;
              header.querySelector('.arrow').textContent = collapsed ? '►' : '▼';
              item.style.display = collapsed ? 'none' : 'flex';
            });
            sidebar.appendChild(header);
            sidebar.appendChild(item);
          } else sidebar.appendChild(item);
          var fallback = document.getElementById('cms-author-profile-fallback');
          if (fallback) fallback.remove();
          navRetryAfter = 0;
          return true;
        });
      })
      .catch(function (error) {
        navRetryAfter = Date.now() + 5000;
        console.error('[sonar author profiles] navigation setup failed', error);
        return false;
      })
      .then(function (loaded) {
        navLoading = false;
        if (loaded) global.clearInterval(navTimer);
        return loaded;
      });
  }

  function start() {
    var attempts = 0;
    navTimer = global.setInterval(function () {
      attempts += 1;
      if (!global.__SONAR_CMS_BOOTED) return;
      if (global.__SONAR_CMS_ROLE === 'admin' || global.__SONAR_CMS_ROLE === 'superadmin') {
        addNav();
      }
      if (attempts > 120) global.clearInterval(navTimer);
    }, 1000);
  }

  global.SonarAuthorProfiles = { open: open, close: close, addNav: addNav };
  start();
})(window);
