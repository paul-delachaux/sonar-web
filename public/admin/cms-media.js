/**
 * Images CMS : aperçu immédiat (blob) + envoi GitHub sur la branche
 * que l'éditeur a le droit d'écrire (brouillon cms/…, ou main si superadmin).
 */
(function (global) {
  var REPO = 'paul-delachaux/sonar-web';
  var DEFAULT_BRANCH = 'main';
  var MEDIA_DIR = 'public/assets/uploads';
  var PUBLIC_PREFIX = '/assets/uploads/';
  var cache = {};
  var inflight = {};
  var queue = [];
  var waitingForDraft = [];
  var active = 0;
  var MAX_PARALLEL = 2;

  function githubToken() {
    var search = global.SonarArticleSearch;
    if (search && typeof search.githubToken === 'function') {
      var fromSearch = search.githubToken();
      if (fromSearch) return fromSearch;
    }
    if (global.__SONAR_GH_TOKEN) return global.__SONAR_GH_TOKEN;
    var keys = ['decap-cms-user', 'netlify-cms-user', 'decap-cms.user', 'netlify-cms.user'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = global.localStorage.getItem(keys[i]);
        if (!raw) continue;
        var data = JSON.parse(raw);
        var token = data && (data.token || data.access_token || data.accessToken);
        if (token) return token;
      } catch (e) {}
    }
    return '';
  }

  function authHeaders(extra) {
    var headers = extra ? Object.assign({}, extra) : {};
    var token = githubToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers.Accept = 'application/vnd.github+json';
      headers['User-Agent'] = 'le-sonar-admin';
    }
    return headers;
  }

  function mediaFileName(file) {
    return String((file && file.name) || 'image')
      .replace(/[/\\]/g, '-')
      .replace(/\s+/g, '-');
  }

  function publicPathFor(name) {
    return PUBLIC_PREFIX + String(name || '').replace(/^\/+/, '');
  }

  function repoPathFor(name) {
    return MEDIA_DIR + '/' + String(name || '').replace(/^\/+/, '');
  }

  function isUploadPath(value) {
    var s = String(value || '');
    return s.indexOf(PUBLIC_PREFIX) !== -1 || s.indexOf(MEDIA_DIR + '/') !== -1;
  }

  function fileNameFromPath(value) {
    var s = String(value || '').split('?')[0].split('#')[0];
    var idx = s.lastIndexOf('/');
    return idx === -1 ? s : s.slice(idx + 1);
  }

  function remember(path, url) {
    if (!path || !url) return;
    cache[path] = url;
    var name = fileNameFromPath(path);
    if (name) cache[publicPathFor(name)] = url;
  }

  function toast(message, kind) {
    var el = document.getElementById('sonar-media-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sonar-media-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.setAttribute('data-kind', kind || 'ok');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.hidden = true;
    }, 4200);
  }

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  function encodeRepoPath(path) {
    return String(path || '')
      .split('/')
      .map(function (part) { return encodeURIComponent(part); })
      .join('/');
  }

  function isSuperadmin() {
    return global.__SONAR_CMS_ROLE === 'superadmin';
  }

  function entryContext() {
    var hash = decodeURIComponent(String(global.location && global.location.hash || ''));
    var match = hash.match(/#\/collections\/([^/]+)\/(?:entries\/([^/?#]+)|new)(?:\/|$|\?)/);
    if (!match) return null;
    return { collection: match[1], slug: match[2] || '', isNew: !match[2] };
  }

  function cmsBranchName(collection, slug) {
    return 'cms/' + collection + '/' + slug;
  }

  function encodeRef(branch) {
    return String(branch || '')
      .split('/')
      .map(function (part) { return encodeURIComponent(part); })
      .join('/');
  }

  function branchExists(branch) {
    var token = githubToken();
    if (!token || !branch) return Promise.resolve(false);
    return fetch('https://api.github.com/repos/' + REPO + '/git/matching-refs/heads/' + encodeRef(branch), {
      headers: authHeaders()
    }).then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (list) {
        if (!Array.isArray(list)) return false;
        var needle = 'refs/heads/' + branch;
        return list.some(function (item) { return item && item.ref === needle; });
      });
    }).catch(function () { return false; });
  }

  function detectTarget() {
    var ctx = entryContext();
    if (ctx && ctx.slug) {
      var draft = cmsBranchName(ctx.collection, ctx.slug);
      return branchExists(draft).then(function (ok) {
        if (ok) return { branch: draft, kind: 'draft' };
        if (isSuperadmin()) return { branch: DEFAULT_BRANCH, kind: 'main' };
        return { branch: '', kind: 'wait-draft' };
      });
    }
    if (isSuperadmin()) return Promise.resolve({ branch: DEFAULT_BRANCH, kind: 'main' });
    return Promise.resolve({ branch: '', kind: 'need-entry' });
  }

  function getExistingSha(path, branch) {
    var token = githubToken();
    if (!token) return Promise.resolve('');
    var ref = branch || DEFAULT_BRANCH;
    return fetch('https://api.github.com/repos/' + REPO + '/contents/' + encodeRepoPath(path) + '?ref=' + encodeURIComponent(ref), {
      headers: authHeaders()
    }).then(function (res) {
      if (!res.ok) return '';
      return res.json().then(function (data) { return data && data.sha ? data.sha : ''; });
    }).catch(function () { return ''; });
  }

  function putOnBranch(file, branch) {
    var token = githubToken();
    if (!token) {
      return Promise.reject(new Error('Session GitHub absente : reconnecte-toi à l’admin.'));
    }
    var name = mediaFileName(file);
    var path = repoPathFor(name);
    return file.arrayBuffer().then(function (buf) {
      return getExistingSha(path, branch).then(function (sha) {
        var body = {
          message: 'media: ' + name,
          content: toBase64(buf),
          branch: branch
        };
        if (sha) body.sha = sha;
        return fetch('https://api.github.com/repos/' + REPO + '/contents/' + encodeRepoPath(path), {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body)
        });
      });
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          var message = (data && data.message) || ('GitHub HTTP ' + res.status);
          throw new Error(message);
        });
      }
      return publicPathFor(name);
    });
  }

  function rememberFile(file) {
    var name = mediaFileName(file);
    var publicPath = publicPathFor(name);
    if (!cache[publicPath]) remember(publicPath, URL.createObjectURL(file));
    return publicPath;
  }

  function enqueue(file, forcedBranch) {
    rememberFile(file);
    var publicPath = publicPathFor(mediaFileName(file));
    var job = detectTarget().then(function (target) {
      var branch = forcedBranch || target.branch;
      if (!branch) {
        if (target.kind === 'wait-draft') waitingForDraft.push(file);
        var err = new Error(target.kind === 'need-entry'
          ? 'Importe l’image depuis l’article (après « Enregistrer » le brouillon). Un admin ne peut pas écrire sur main.'
          : 'Enregistre d’abord le brouillon : l’image partira sur la branche de relecture, pas sur main.');
        err.queued = true;
        throw err;
      }
      if (inflight[publicPath + '@' + branch]) return inflight[publicPath + '@' + branch];
      var sent = new Promise(function (resolve, reject) {
        queue.push({ file: file, branch: branch, resolve: resolve, reject: reject });
        pump();
      });
      inflight[publicPath + '@' + branch] = sent;
      sent.then(function () {
        delete inflight[publicPath + '@' + branch];
      }, function () {
        delete inflight[publicPath + '@' + branch];
      });
      sent.kind = target.kind;
      sent.branch = branch;
      return sent;
    });
    return job;
  }

  function pump() {
    while (active < MAX_PARALLEL && queue.length) {
      var item = queue.shift();
      active += 1;
      putOnBranch(item.file, item.branch).then(function (path) {
        active -= 1;
        item.resolve(path);
        pump();
      }, function (err) {
        active -= 1;
        item.reject(err);
        pump();
      });
    }
  }

  function flushWaitingForDraft() {
    if (!waitingForDraft.length) return;
    detectTarget().then(function (target) {
      if (!target.branch) return;
      var pending = waitingForDraft.splice(0, waitingForDraft.length);
      Promise.all(pending.map(function (file) { return enqueue(file, target.branch); }))
        .then(function () {
          toast(pending.length > 1
            ? (pending.length + ' images envoyées sur le brouillon GitHub.')
            : 'Image envoyée sur le brouillon GitHub.');
        })
        .catch(function (err) {
          toast((err && err.message) || 'Impossible d’envoyer les images du brouillon.', 'err');
        });
    });
  }

  function syncUrl(path) {
    if (!path) return path;
    var s = String(path);
    if (/^(blob:|data:|https?:)/i.test(s)) return s;
    if (cache[s]) return cache[s];
    var named = publicPathFor(fileNameFromPath(s));
    if (cache[named]) return cache[named];
    return s;
  }

  function resolve(path) {
    var s = String(path || '');
    if (!s) return Promise.resolve(s);
    if (/^(blob:|data:)/i.test(s)) return Promise.resolve(s);
    if (cache[s]) return Promise.resolve(cache[s]);
    var named = publicPathFor(fileNameFromPath(s));
    if (cache[named]) return Promise.resolve(cache[named]);
    if (!isUploadPath(s) && s.indexOf('http') === 0) return Promise.resolve(s);
    if (!isUploadPath(s)) return Promise.resolve(s);

    var token = githubToken();
    var repoPath = repoPathFor(fileNameFromPath(s));
    if (!token) return Promise.resolve(s);

    var refs = [];
    var ctx = entryContext();
    if (ctx && ctx.slug) refs.push(cmsBranchName(ctx.collection, ctx.slug));
    refs.push(DEFAULT_BRANCH);

    function tryRef(i) {
      if (i >= refs.length) return Promise.resolve(s);
      return fetch('https://api.github.com/repos/' + REPO + '/contents/' + encodeRepoPath(repoPath) + '?ref=' + encodeURIComponent(refs[i]), {
        headers: authHeaders({ Accept: 'application/vnd.github.raw' })
      }).then(function (res) {
        if (!res.ok) return tryRef(i + 1);
        return res.blob().then(function (blob) {
          var url = URL.createObjectURL(blob);
          remember(named, url);
          return url;
        });
      }).catch(function () { return tryRef(i + 1); });
    }
    return tryRef(0);
  }

  function isMediaPage() {
    var hash = String(global.location && global.location.hash || '');
    if (/(^|#)\/?media(\/|\?|$)/i.test(hash)) return true;
    var root = document.getElementById('nc-root');
    if (!root) return false;
    if (root.querySelector('[class*="MediaLibrary"], [class*="media-library"]')) return true;
    var headings = root.querySelectorAll('h1, h2, h3');
    for (var i = 0; i < headings.length; i++) {
      var t = String(headings[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t === 'media' || t === 'médias' || t === 'media library' || t.indexOf('médiath') !== -1) return true;
    }
    return false;
  }

  function onFilesChosen(event) {
    var input = event.target;
    if (!input || input.type !== 'file' || !input.files || !input.files.length) return;
    var files = Array.prototype.slice.call(input.files);
    var allowMany = isMediaPage() || input.multiple;
    var batch = allowMany ? files : files.slice(0, 1);
    var jobs = batch.map(function (file) { return enqueue(file); });
    if (!jobs.length) return;
    toast(jobs.length > 1
      ? ('Préparation de ' + jobs.length + ' fichiers…')
      : 'Préparation de l’image…');
    Promise.all(jobs.map(function (job) {
      return job.then(function (v) { return { ok: true, v: v }; }, function (err) { return { ok: false, err: err }; });
    })).then(function (results) {
      var ok = 0;
      var queued = 0;
      var fail = [];
      results.forEach(function (r) {
        if (r.ok) ok += 1;
        else if (r.err && r.err.queued) queued += 1;
        else fail.push(r.err && r.err.message ? r.err.message : 'échec');
      });
      if (fail.length && !ok && !queued) toast('Échec GitHub : ' + fail[0], 'err');
      else if (queued && !ok) toast(results[0] && results[0].err && results[0].err.message
        ? results[0].err.message
        : 'Aperçu OK. Enregistre le brouillon pour envoyer l’image sur GitHub.');
      else if (fail.length) toast(ok + ' envoyé(s), ' + fail.length + ' échec(s).', 'err');
      else toast(ok > 1
        ? (ok + ' fichiers envoyés sur GitHub (brouillon ou main selon tes droits).')
        : 'Image envoyée sur GitHub. L’aperçu l’affiche tout de suite.');
      rewritePreview();
    });
  }

  function patchInputs(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var inputs = scope.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (isMediaPage()) input.multiple = true;
      if (input.dataset.sonarMediaBound === '1') continue;
      input.dataset.sonarMediaBound = '1';
      input.addEventListener('change', onFilesChosen, true);
    }
  }

  function ensureMediaBar() {
    if (!isMediaPage()) {
      var old = document.getElementById('sonar-media-bar');
      if (old) old.remove();
      return;
    }
    if (document.getElementById('sonar-media-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'sonar-media-bar';
    bar.innerHTML =
      '<span>Import multiple : superadmin → main. Admin → depuis l’article, sur la branche brouillon (pas sur main).</span>' +
      '<button type="button" id="sonar-media-multi">Importer plusieurs images</button>';
    document.body.appendChild(bar);
    document.getElementById('sonar-media-multi').addEventListener('click', function () {
      var ghost = document.createElement('input');
      ghost.type = 'file';
      ghost.accept = 'image/*,audio/*,video/*,.pdf';
      ghost.multiple = true;
      ghost.style.display = 'none';
      document.body.appendChild(ghost);
      ghost.addEventListener('change', function () {
        onFilesChosen({ target: ghost });
        ghost.remove();
      });
      ghost.click();
    });
  }

  function rewritePreview() {
    var root = document.getElementById('nc-root') || document.body;
    if (!root) return;
    var imgs = root.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        var src = img.getAttribute('src') || '';
        if (!isUploadPath(src) && src.indexOf(PUBLIC_PREFIX) !== 0) return;
        if (/^(blob:|data:)/i.test(src)) return;
        resolve(src).then(function (next) {
          if (next && img.getAttribute('src') !== next) img.src = next;
        });
      })(imgs[i]);
    }
    var nodes = root.querySelectorAll('[style*="assets/uploads"]');
    for (var n = 0; n < nodes.length; n++) {
      (function (el) {
        var bg = el.style.backgroundImage || '';
        var match = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (!match || !isUploadPath(match[1])) return;
        resolve(match[1]).then(function (next) {
          if (next) el.style.backgroundImage = 'url("' + next + '")';
        });
      })(nodes[n]);
    }
  }

  var rewriteTimer = null;
  function scheduleRewrite() {
    if (rewriteTimer) return;
    rewriteTimer = setTimeout(function () {
      rewriteTimer = null;
      rewritePreview();
      patchInputs(document);
      ensureMediaBar();
    }, 80);
  }

  global.SonarCmsMedia = {
    url: syncUrl,
    resolve: resolve,
    upload: enqueue
  };

  function hookCmsEvents() {
    if (!global.CMS || typeof global.CMS.registerEventListener !== 'function') {
      setTimeout(hookCmsEvents, 400);
      return;
    }
    global.CMS.registerEventListener({ name: 'postSave', handler: flushWaitingForDraft });
  }

  function start() {
    patchInputs(document);
    ensureMediaBar();
    hookCmsEvents();
    if (document.body) {
      new MutationObserver(scheduleRewrite).observe(document.body, { childList: true, subtree: true });
    }
    global.addEventListener('hashchange', function () {
      patchInputs(document);
      ensureMediaBar();
      flushWaitingForDraft();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
