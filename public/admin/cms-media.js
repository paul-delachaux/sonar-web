/**
 * Images CMS : aperçu immédiat (blob) + envoi GitHub.
 * L'import multiple fait UN SEUL commit (donc un seul build Vercel).
 * Admin simple → branche brouillon cms/… ; superadmin → main.
 */
(function (global) {
  var REPO = 'paul-delachaux/sonar-web';
  var DEFAULT_BRANCH = 'main';
  var MEDIA_DIR = 'public/assets/uploads';
  var PUBLIC_PREFIX = '/assets/uploads/';
  var cache = {};
  var inflight = {};
  var failed = {};
  var live = {};
  var waitingForDraft = [];
  var pickedMedia = {};
  var checkTimer = null;
  var STORE_KEY = 'sonar-cms-media-urls';
  var LIVE_KEY = 'sonar-cms-media-live';

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
    var headers = {};
    var token = githubToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers.Accept = 'application/vnd.github+json';
    }
    if (extra) Object.assign(headers, extra);
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

  function persistMediaCache() {
    var out = {};
    Object.keys(cache).forEach(function (key) {
      var url = cache[key];
      if (/^https?:/i.test(url) && !/^blob:/i.test(url)) out[key] = url;
    });
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (e) {}
  }

  function persistLive() {
    try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch (e) {}
  }

  function loadPersisted() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data) Object.keys(data).forEach(function (key) { cache[key] = data[key]; });
    } catch (e) {}
    try {
      var liveRaw = localStorage.getItem(LIVE_KEY);
      var liveData = liveRaw ? JSON.parse(liveRaw) : null;
      if (liveData) live = liveData;
    } catch (e) {}
  }

  function namedPath(path) {
    return publicPathFor(fileNameFromPath(path));
  }

  function isLive(path) {
    return !!live[namedPath(path)];
  }

  function markLive(paths) {
    (paths || []).forEach(function (path) {
      live[namedPath(path)] = 1;
    });
    persistLive();
    rewritePreview();
  }

  function remember(path, url) {
    if (!path || !url) return;
    cache[path] = url;
    var name = fileNameFromPath(path);
    if (name) {
      cache[name] = url;
      cache[publicPathFor(name)] = url;
      cache[repoPathFor(name)] = url;
      delete failed[name];
      delete failed[publicPathFor(name)];
    }
    if (/^https?:/i.test(url)) persistMediaCache();
  }

  function blobFromBase64(b64, mime) {
    var binary = atob(String(b64 || '').replace(/\n/g, ''));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function guessMime(name) {
    var n = String(name || '').toLowerCase();
    if (/\.png$/.test(n)) return 'image/png';
    if (/\.jpe?g$/.test(n)) return 'image/jpeg';
    if (/\.webp$/.test(n)) return 'image/webp';
    if (/\.gif$/.test(n)) return 'image/gif';
    if (/\.avif$/.test(n)) return 'image/avif';
    if (/\.svg$/.test(n)) return 'image/svg+xml';
    if (/\.mp3$/.test(n)) return 'audio/mpeg';
    if (/\.wav$/.test(n)) return 'audio/wav';
    return 'application/octet-stream';
  }

  function rememberFile(file) {
    var publicPath = publicPathFor(mediaFileName(file));
    if (!cache[publicPath]) remember(publicPath, URL.createObjectURL(file));
    return publicPath;
  }

  function toast(message, kind) {
    var el = document.getElementById('sonar-media-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sonar-media-toast';
      el.style.zIndex = '2147483645';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.setAttribute('data-kind', kind || 'ok');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.hidden = true;
    }, 5000);
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

  function encodeRef(branch) {
    return String(branch || '')
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

  function gitJson(path, opts) {
    opts = opts || {};
    var headers = authHeaders(opts.body ? { 'Content-Type': 'application/json' } : {});
    return fetch('https://api.github.com/repos/' + REPO + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.message) || ('GitHub HTTP ' + res.status));
        return data;
      }, function () {
        if (!res.ok) throw new Error('GitHub HTTP ' + res.status);
        return {};
      });
    });
  }

  function branchExists(branch) {
    var token = githubToken();
    if (!token || !branch) return Promise.resolve(false);
    return gitJson('/git/matching-refs/heads/' + encodeRef(branch)).then(function (list) {
      if (!Array.isArray(list)) return false;
      var needle = 'refs/heads/' + branch;
      return list.some(function (item) { return item && item.ref === needle; });
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

  function getHeadSha(branch) {
    return gitJson('/git/matching-refs/heads/' + encodeRef(branch)).then(function (list) {
      var needle = 'refs/heads/' + branch;
      var hit = (list || []).filter(function (item) { return item && item.ref === needle; })[0];
      if (!hit || !hit.object || !hit.object.sha) throw new Error('Branche introuvable : ' + branch);
      return hit.object.sha;
    });
  }

  function mapLimit(items, limit, worker) {
    var index = 0;
    var running = 0;
    var results = [];
    return new Promise(function (resolve, reject) {
      function next() {
        if (index >= items.length && running === 0) {
          resolve(results);
          return;
        }
        while (running < limit && index < items.length) {
          (function (i) {
            running += 1;
            Promise.resolve(worker(items[i], i)).then(function (value) {
              results[i] = value;
              running -= 1;
              next();
            }, reject);
          })(index);
          index += 1;
        }
      }
      if (!items.length) resolve([]);
      else next();
    });
  }

  function deletePathsBatch(paths, branch) {
    var token = githubToken();
    if (!token) return Promise.reject(new Error('Session GitHub absente : reconnecte-toi à l’admin.'));
    var unique = [];
    var seen = {};
    (paths || []).forEach(function (path) {
      var name = fileNameFromPath(path);
      if (!name || seen[name]) return;
      seen[name] = true;
      unique.push(name);
    });
    if (!unique.length) return Promise.resolve({ paths: [], sha: '' });

    return getHeadSha(branch).then(function (headSha) {
      return gitJson('/git/commits/' + headSha).then(function (commit) {
        var baseTree = commit.tree && commit.tree.sha;
        var treeItems = unique.map(function (name) {
          return { path: repoPathFor(name), mode: '100644', type: 'blob', sha: null };
        });
        return gitJson('/git/trees', {
          method: 'POST',
          body: { base_tree: baseTree, tree: treeItems }
        }).then(function (tree) {
          var message = unique.length === 1
            ? 'media: suppression ' + unique[0]
            : 'media: suppression de ' + unique.length + ' fichiers';
          return gitJson('/git/commits', {
            method: 'POST',
            body: { message: message, tree: tree.sha, parents: [headSha] }
          });
        }).then(function (newCommit) {
          return gitJson('/git/refs/heads/' + encodeRef(branch), {
            method: 'PATCH',
            body: { sha: newCommit.sha }
          }).then(function () {
            return {
              paths: unique.map(function (name) { return publicPathFor(name); }),
              sha: newCommit.sha
            };
          });
        });
      });
    });
  }

  function commitFilesBatch(files, branch) {
    var token = githubToken();
    if (!token) return Promise.reject(new Error('Session GitHub absente : reconnecte-toi à l’admin.'));
    if (!files.length) return Promise.resolve({ paths: [], sha: '' });

    var unique = [];
    var seen = {};
    files.forEach(function (file) {
      var name = mediaFileName(file);
      if (seen[name]) return;
      seen[name] = true;
      unique.push(file);
    });

    return getHeadSha(branch).then(function (headSha) {
      return gitJson('/git/commits/' + headSha).then(function (commit) {
        var baseTree = commit.tree && commit.tree.sha;
        return mapLimit(unique, 4, function (file) {
          return file.arrayBuffer().then(function (buf) {
            return gitJson('/git/blobs', {
              method: 'POST',
              body: { content: toBase64(buf), encoding: 'base64' }
            }).then(function (blob) {
              return {
                path: repoPathFor(mediaFileName(file)),
                mode: '100644',
                type: 'blob',
                sha: blob.sha
              };
            });
          });
        }).then(function (treeItems) {
          return gitJson('/git/trees', {
            method: 'POST',
            body: { base_tree: baseTree, tree: treeItems }
          }).then(function (tree) {
            var names = unique.map(function (file) { return mediaFileName(file); });
            var message = names.length === 1
              ? 'media: ' + names[0]
              : 'media: ' + names.length + ' fichiers (' + names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '') + ')';
            return gitJson('/git/commits', {
              method: 'POST',
              body: { message: message, tree: tree.sha, parents: [headSha] }
            });
          }).then(function (newCommit) {
            return gitJson('/git/refs/heads/' + encodeRef(branch), {
              method: 'PATCH',
              body: { sha: newCommit.sha }
            }).then(function () {
              return {
                paths: unique.map(function (file) { return publicPathFor(mediaFileName(file)); }),
                sha: newCommit.sha
              };
            });
          });
        });
      });
    });
  }

  function adminAuthHeaders() {
    var headers = {};
    var token = githubToken();
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Sonar-GitHub'] = token;
    }
    return headers;
  }

  function uploadToSupabase(files) {
    return mapLimit(files, 3, function (file) {
      var body = new FormData();
      body.append('file', file, mediaFileName(file));
      return fetch('/api/admin/media', {
        method: 'POST',
        headers: adminAuthHeaders(),
        body: body
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.message) || ('Supabase HTTP ' + res.status));
          if (data && data.url) remember(publicPathFor(mediaFileName(file)), data.url);
          return data;
        }, function () {
          throw new Error('Supabase HTTP ' + res.status);
        });
      });
    }).then(function () {
      rewritePreview();
    });
  }

  function watchDeploy(result, kind) {
    if (!result || !global.SonarCmsDeploy || typeof global.SonarCmsDeploy.watch !== 'function') return;
    if (kind === 'main') {
      global.SonarCmsDeploy.watch({
        reason: 'media',
        sha: result.sha || '',
        files: result.paths || []
      });
    }
  }

  function uploadBatch(files) {
    var list = (files || []).filter(Boolean);
    if (!list.length) return Promise.resolve();
    list.forEach(rememberFile);
    insertMediaPaths(list.map(function (file) { return publicPathFor(mediaFileName(file)); }));
    rewritePreview();
    var supabaseP = uploadToSupabase(list).catch(function (err) {
      toast('Aperçu admin limité : ' + ((err && err.message) || 'Supabase indisponible') + '. Les images partent quand même sur GitHub.', 'err');
    });
    return detectTarget().then(function (target) {
      if (!target.branch) {
        if (target.kind === 'wait-draft') {
          waitingForDraft = waitingForDraft.concat(list);
          toast('Aperçu OK. Enregistre le brouillon : les ' + list.length + ' image(s) partiront ensuite en un seul commit.');
          return supabaseP;
        }
        toast('Ouvre un article (et enregistre le brouillon) pour envoyer des images. Un admin ne peut pas écrire sur main.', 'err');
        return supabaseP;
      }
      toast(list.length > 1
        ? ('Envoi de ' + list.length + ' images en un seul commit…')
        : 'Envoi de l’image vers GitHub…');
      return commitFilesBatch(list, target.branch).then(function (result) {
        toast(list.length > 1
          ? (list.length + ' images envoyées en un commit (' + (target.kind === 'main' ? 'main' : 'brouillon') + ').')
          : 'Image envoyée sur GitHub.');
        insertMediaPaths(result.paths);
        rewritePreview();
        watchDeploy(result, target.kind);
        return supabaseP;
      });
    }).catch(function (err) {
      toast((err && err.message) || 'Échec de l’envoi GitHub.', 'err');
      return supabaseP;
    });
  }

  function flushWaitingForDraft() {
    if (!waitingForDraft.length) return;
    detectTarget().then(function (target) {
      if (!target.branch) return;
      var pending = waitingForDraft.splice(0, waitingForDraft.length);
      toast('Envoi de ' + pending.length + ' image(s) du brouillon en un commit…');
      return commitFilesBatch(pending, target.branch).then(function (result) {
        toast(pending.length + ' image(s) envoyées sur le brouillon (un commit).');
        watchDeploy(result, target.kind);
      });
    }).catch(function (err) {
      toast((err && err.message) || 'Impossible d’envoyer les images du brouillon.', 'err');
    });
  }

  function cachedUrl(path) {
    var s = String(path || '');
    if (!s) return '';
    if (isLive(s)) return '';
    if (cache[s]) return cache[s];
    var name = fileNameFromPath(s);
    if (name && cache[name]) return cache[name];
    var named = publicPathFor(name);
    if (cache[named]) return cache[named];
    var repo = repoPathFor(name);
    if (cache[repo]) return cache[repo];
    return '';
  }

  function syncUrl(path) {
    if (!path) return path;
    var s = String(path);
    if (/^(blob:|data:)/i.test(s)) return s;
    var hit = cachedUrl(s);
    if (hit) return hit;
    if (isUploadPath(s)) {
      resolve(s).then(function (url) {
        if (url && url !== s) scheduleRewrite();
      });
    }
    return s;
  }

  function fetchGitHubBlob(repoPath, ref) {
    var url = 'https://api.github.com/repos/' + REPO + '/contents/' + encodeRepoPath(repoPath) + '?ref=' + encodeURIComponent(ref);
    return fetch(url, {
      headers: authHeaders({ Accept: 'application/vnd.github.raw' })
    }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('GitHub HTTP ' + res.status);
      var ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('json') !== -1) {
        return res.json().then(function (data) {
          if (data && data.content && data.encoding === 'base64') {
            return blobFromBase64(data.content, guessMime(repoPath));
          }
          if (data && data.sha) {
            return gitJson('/git/blobs/' + data.sha).then(function (blob) {
              if (blob && blob.content) return blobFromBase64(blob.content, guessMime(repoPath));
              return null;
            });
          }
          return null;
        });
      }
      return res.blob().then(function (blob) {
        if (!blob || !blob.size) return null;
        if ((blob.type || '').indexOf('json') !== -1) return null;
        return blob;
      });
    });
  }

  function resolve(path) {
    var s = String(path || '');
    if (!s) return Promise.resolve(s);
    if (/^(blob:|data:)/i.test(s)) return Promise.resolve(s);
    var hit = cachedUrl(s);
    if (hit) return Promise.resolve(hit);
    if (!isUploadPath(s) && /^https?:/i.test(s)) return Promise.resolve(s);
    if (!isUploadPath(s)) return Promise.resolve(s);

    var named = publicPathFor(fileNameFromPath(s));
    if (failed[named]) return Promise.resolve(s);
    if (inflight[named]) return inflight[named];

    var token = githubToken();
    if (!token) return Promise.resolve(s);

    var repoPath = repoPathFor(fileNameFromPath(s));
    var refs = [];
    var ctx = entryContext();
    if (ctx && ctx.slug) refs.push(cmsBranchName(ctx.collection, ctx.slug));
    refs.push(DEFAULT_BRANCH);

    function tryRef(i) {
      if (i >= refs.length) {
        failed[named] = true;
        return Promise.resolve(s);
      }
      return fetchGitHubBlob(repoPath, refs[i]).then(function (blob) {
        if (!blob) return tryRef(i + 1);
        var url = URL.createObjectURL(blob);
        remember(s, url);
        remember(named, url);
        return url;
      }).catch(function () { return tryRef(i + 1); });
    }

    inflight[named] = tryRef(0).then(function (url) {
      delete inflight[named];
      return url;
    }, function (err) {
      delete inflight[named];
      throw err;
    });
    return inflight[named];
  }

  function openMultiPicker() {
    var ghost = document.createElement('input');
    ghost.type = 'file';
    ghost.accept = 'image/*,audio/*,video/*,.pdf,.webp,.avif';
    ghost.multiple = true;
    ghost.style.position = 'fixed';
    ghost.style.left = '-9999px';
    document.body.appendChild(ghost);
    ghost.addEventListener('change', function () {
      var files = Array.prototype.slice.call(ghost.files || []);
      ghost.remove();
      uploadBatch(files);
    });
    ghost.click();
  }

  function controlLabel(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findUploadControl(root) {
    if (!root || !root.querySelectorAll) return null;
    var nodes = root.querySelectorAll('button, label');
    for (var i = 0; i < nodes.length; i++) {
      var t = controlLabel(nodes[i]);
      if (t === 'Upload' || t === 'Téléverser' || t.indexOf('Uploading') === 0) return nodes[i];
    }
    return null;
  }

  function findInsertAnchor(root) {
    var upload = findUploadControl(root);
    if (upload && upload.parentNode) return { parent: upload.parentNode, before: upload };
    var buttons = root.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var t = controlLabel(buttons[i]);
      if (t === 'Copy' || t === 'Download' || t === 'Delete selected' || t === 'Supprimer la sélection') {
        return { parent: buttons[i].parentNode, before: buttons[i] };
      }
    }
    return null;
  }

  function findMediaLibraryRoot() {
    var headings = document.querySelectorAll('h1, h2, h3');
    for (var i = 0; i < headings.length; i++) {
      var text = controlLabel(headings[i]);
      if (text.indexOf('Media assets') === -1 && text.indexOf('Médiathèque') === -1) continue;
      var node = headings[i].parentElement;
      for (var depth = 0; depth < 14 && node && node !== document.body; depth++) {
        var search = node.querySelector('input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Rechercher"], input[type="search"]');
        if (search) return node;
        node = node.parentElement;
      }
    }
    return null;
  }

  function removeGlobalChrome() {
    var bar = document.getElementById('sonar-media-bar');
    if (bar) bar.remove();
    var nav = document.getElementById('sonar-media-nav');
    if (nav) nav.remove();
  }

  function findCmsStore() {
    var root = document.getElementById('nc-root');
    if (!root) return null;
    var fiberKey = Object.keys(root).filter(function (key) {
      return key.indexOf('__reactFiber') === 0 || key.indexOf('__reactContainer') === 0;
    })[0];
    if (!fiberKey) return null;
    var seen = 0;
    function walk(node) {
      if (!node || seen > 12000) return null;
      seen += 1;
      var props = node.memoizedProps || node.pendingProps;
      if (props && props.store && typeof props.store.dispatch === 'function') return props.store;
      var stateNode = node.stateNode;
      if (stateNode && stateNode.store && typeof stateNode.store.dispatch === 'function') return stateNode.store;
      if (stateNode && stateNode.context && stateNode.context.store && stateNode.context.store.dispatch) {
        return stateNode.context.store;
      }
      return walk(node.child) || walk(node.sibling);
    }
    var fiber = root[fiberKey];
    var start = fiber && fiber.stateNode && fiber.stateNode.current ? fiber.stateNode.current : fiber;
    return walk(start);
  }

  function insertMediaPaths(paths) {
    var list = (paths || []).filter(Boolean);
    if (!list.length) return false;
    var store = findCmsStore();
    if (!store || typeof store.dispatch !== 'function') return false;
    try {
      store.dispatch({ type: 'MEDIA_INSERT', payload: { mediaPath: list.length === 1 ? list[0] : list } });
      list.forEach(function (path) {
        store.dispatch({
          type: 'MEDIA_PERSIST_SUCCESS',
          payload: {
            file: {
              id: path,
              key: path,
              name: fileNameFromPath(path),
              path: repoPathFor(fileNameFromPath(path)),
              url: cachedUrl(path) || path,
              displayURL: cachedUrl(path) || path,
              draft: true,
              size: 0
            }
          }
        });
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function captureNativeFiles(files) {
    var list = (files || []).filter(Boolean);
    if (!list.length) return;
    list.forEach(rememberFile);
    rewritePreview();
    uploadToSupabase(list).then(function () {
      rewritePreview();
    }).catch(function () {
      rewritePreview();
    });
  }

  function patchLibraryFileInputs(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var inputs = scope.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if (input.closest && input.closest('#sonar-author-profiles')) continue;
      if (input.getAttribute('data-sonar-capture') === '1') continue;
      input.setAttribute('data-sonar-capture', '1');
      input.addEventListener('change', function (event) {
        var files = Array.prototype.slice.call(event.target.files || []);
        if (!files.length) return;
        captureNativeFiles(files);
      }, true);
    }
  }

  function selectedMediaNames() {
    return Object.keys(pickedMedia).filter(function (name) { return pickedMedia[name]; });
  }

  function updateDeleteLabel() {
    var del = document.getElementById('sonar-media-delete');
    if (!del) return;
    var n = selectedMediaNames().length;
    del.textContent = n ? ('Supprimer la sélection (' + n + ')') : 'Supprimer la sélection';
  }

  function ensureCheckStyles() {
    if (document.getElementById('sonar-media-check-css')) return;
    var style = document.createElement('style');
    style.id = 'sonar-media-check-css';
    style.textContent = [
      '.sonar-media-check{',
      'position:absolute!important;top:8px!important;left:8px!important;z-index:20!important;',
      'width:22px!important;height:22px!important;margin:0!important;padding:0!important;',
      'cursor:pointer!important;accent-color:#ff7900;background:#fff!important;border:1px solid #111!important;',
      'opacity:1!important;visibility:visible!important;display:block!important;pointer-events:auto!important;',
      'appearance:auto!important;-webkit-appearance:checkbox!important;',
      '}'
    ].join('');
    document.head.appendChild(style);
  }

  function cardFileName(wrap) {
    var node = wrap;
    for (var d = 0; d < 4 && node; d++) {
      var label = node.querySelector && node.querySelector('p');
      var name = fileNameFromPath(String((label && label.textContent) || '').replace(/\s+/g, ''));
      if (name && name.indexOf('.') !== -1) return name;
      node = node.parentElement;
    }
    return '';
  }

  function makeCheckbox(name) {
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'sonar-media-check';
    box.setAttribute('data-name', name);
    box.checked = !!pickedMedia[name];
    box.title = 'Inclure dans la suppression multiple';
    function stop(event) { event.stopPropagation(); }
    box.addEventListener('pointerdown', stop);
    box.addEventListener('mousedown', stop);
    box.addEventListener('mouseup', stop);
    box.addEventListener('click', function (event) {
      event.stopPropagation();
      var fileName = event.currentTarget.getAttribute('data-name');
      pickedMedia[fileName] = !!event.currentTarget.checked;
      var twins = document.getElementsByClassName('sonar-media-check');
      for (var i = 0; i < twins.length; i++) {
        if (twins[i].getAttribute('data-name') === fileName) twins[i].checked = !!pickedMedia[fileName];
      }
      updateDeleteLabel();
    });
    return box;
  }

  function injectCardCheckboxes() {
    ensureCheckStyles();
    var leftover = document.getElementById('sonar-media-checks');
    if (leftover) leftover.remove();
    var wraps = document.querySelectorAll('[class*="CardImageWrapper"]');
    if (!wraps.length) return;
    var seen = {};
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      var name = cardFileName(wrap);
      if (!name || seen[name]) continue;
      seen[name] = true;
      var inner = wrap.querySelector('.sonar-media-check');
      if (!inner) {
        inner = makeCheckbox(name);
        wrap.insertBefore(inner, wrap.firstChild);
      }
      inner.checked = !!pickedMedia[name];
    }
    updateDeleteLabel();
  }

  function startCheckLoop() {
    if (checkTimer) return;
    function tick() {
      if (!document.querySelector('[class*="CardImageWrapper"]')) {
        checkTimer = null;
        var leftover = document.getElementById('sonar-media-checks');
        if (leftover) leftover.remove();
        return;
      }
      injectCardCheckboxes();
      checkTimer = global.requestAnimationFrame(tick);
    }
    checkTimer = global.requestAnimationFrame(tick);
  }

  function ensureDeleteButton(root) {
    if (document.getElementById('sonar-media-delete')) return;
    var importBtn = document.getElementById('sonar-media-multi');
    var parent = (importBtn && importBtn.parentNode) || (root && findInsertAnchor(root) && findInsertAnchor(root).parent);
    if (!parent) return;
    var del = document.createElement('button');
    del.type = 'button';
    del.id = 'sonar-media-delete';
    del.textContent = 'Supprimer la sélection';
    del.title = 'Un seul commit GitHub, un seul build Vercel';
    del.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var names = selectedMediaNames();
      if (!names.length) {
        toast('Coche les images à supprimer (cases en haut à gauche des vignettes).', 'err');
        return;
      }
      if (!global.confirm('Supprimer ' + names.length + ' fichier(s) en un seul commit GitHub ?')) return;
      detectTarget().then(function (target) {
        if (!target.branch) {
          toast('Ouvre un article (et enregistre le brouillon) pour supprimer. Un admin ne peut pas écrire sur main.', 'err');
          return;
        }
        toast('Suppression de ' + names.length + ' fichier(s)…');
        return deletePathsBatch(names, target.branch).then(function (result) {
          names.forEach(function (name) { delete pickedMedia[name]; });
          toast(names.length + ' fichier(s) supprimé(s) (un commit).');
          watchDeploy(result, target.kind);
          injectCardCheckboxes();
        });
      }).catch(function (err) {
        toast((err && err.message) || 'Échec de la suppression.', 'err');
      });
    });
    if (importBtn && importBtn.nextSibling) parent.insertBefore(del, importBtn.nextSibling);
    else parent.appendChild(del);
  }

  function ensureMediaLibraryButton() {
    removeGlobalChrome();
    patchLibraryFileInputs(document);
    if (document.querySelector('[class*="CardImageWrapper"]')) {
      startCheckLoop();
      injectCardCheckboxes();
    }
    var root = findMediaLibraryRoot();
    var existing = document.getElementById('sonar-media-multi');
    if (!root) {
      if (existing) existing.remove();
      var oldDel = document.getElementById('sonar-media-delete');
      if (oldDel) oldDel.remove();
      return;
    }
    if (!existing || !root.contains(existing)) {
      if (existing) existing.remove();
      var anchor = findInsertAnchor(root);
      if (!anchor) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'sonar-media-multi';
      btn.setAttribute('data-sonar-media-lib', '1');
      btn.textContent = 'Importer plusieurs images';
      btn.title = 'Un seul commit GitHub, un seul build Vercel';
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openMultiPicker();
      });
      anchor.parent.insertBefore(btn, anchor.before);
    }
    ensureDeleteButton(root);
  }

  function previewRoots() {
    var roots = [];
    var main = document.getElementById('nc-root') || document.body;
    if (main) roots.push(main);
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      try {
        var doc = frames[i].contentDocument;
        if (doc && doc.body && roots.indexOf(doc.body) === -1) roots.push(doc.body);
        bindRoot(doc);
      } catch (e) {}
    }
    return roots;
  }

  function rewriteEl(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'IMG' || el.tagName === 'SOURCE' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
      var src = el.getAttribute('src') || el.getAttribute('srcset') || '';
      if (!src) return;
      if (/^(blob:|data:)/i.test(src) && !el.getAttribute('data-sonar-path')) return;
      var orig = el.getAttribute('data-sonar-path') || src;
      if (isLive(orig) || isLive(src)) {
        var site = namedPath(orig);
        if (site && el.getAttribute('src') !== site) el.setAttribute('src', site);
        return;
      }
      if (!isUploadPath(src) && src.indexOf(PUBLIC_PREFIX) !== 0 && !isUploadPath(orig)) return;
      var hit = cachedUrl(orig) || cachedUrl(src);
      if (hit) {
        if (!el.getAttribute('data-sonar-path') && isUploadPath(orig)) el.setAttribute('data-sonar-path', namedPath(orig));
        if (el.getAttribute('src') !== hit) el.setAttribute('src', hit);
        return;
      }
      if (!isUploadPath(src) && src.indexOf(PUBLIC_PREFIX) !== 0) return;
      resolve(src).then(function (next) {
        if (next && next !== src && el.getAttribute('src') !== next) {
          el.setAttribute('data-sonar-path', namedPath(src));
          el.setAttribute('src', next);
        }
      });
      return;
    }
    var bg = el.style && el.style.backgroundImage || '';
    var match = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (!match || /^(blob:|data:)/i.test(match[1]) || !isUploadPath(match[1])) return;
    var bgHit = cachedUrl(match[1]);
    if (bgHit) {
      el.style.backgroundImage = 'url("' + bgHit + '")';
      return;
    }
    resolve(match[1]).then(function (next) {
      if (next) el.style.backgroundImage = 'url("' + next + '")';
    });
  }

  function rewritePreview() {
    var roots = previewRoots();
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      var media = root.querySelectorAll('img, source, video, audio, [style*="assets/uploads"]');
      for (var i = 0; i < media.length; i++) rewriteEl(media[i]);
    }
  }

  function onMediaError(event) {
    var el = event.target;
    if (!el || !el.tagName) return;
    if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO' && el.tagName !== 'SOURCE') return;
    var src = el.getAttribute('src') || '';
    if (!src || /^(blob:|data:)/i.test(src)) return;
    if (!isUploadPath(src) && src.indexOf(PUBLIC_PREFIX) !== 0) return;
    if (isLive(src)) {
      delete live[namedPath(src)];
      persistLive();
    }
    var fallback = cachedUrl(src);
    if (fallback && fallback !== src) {
      el.setAttribute('src', fallback);
      return;
    }
    resolve(src).then(function (next) {
      if (next && next !== src) el.setAttribute('src', next);
    });
  }

  function bindRoot(target) {
    var node = target && target.nodeType === 9 ? target : (target && target.ownerDocument) || target;
    if (!node) return;
    if (node.__sonarMediaBound) return;
    node.__sonarMediaBound = true;
    var observeNode = node.body || node;
    try {
      new MutationObserver(scheduleRewrite).observe(observeNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset', 'style']
      });
    } catch (e) {}
    node.addEventListener('error', onMediaError, true);
  }

  var rewriteTimer = null;
  function scheduleRewrite() {
    if (rewriteTimer) return;
    rewriteTimer = setTimeout(function () {
      rewriteTimer = null;
      rewritePreview();
      patchLibraryFileInputs(document);
      ensureMediaLibraryButton();
    }, 80);
  }

  global.SonarCmsMedia = {
    url: syncUrl,
    resolve: resolve,
    uploadBatch: uploadBatch,
    markLive: markLive
  };

  function hookCmsEvents() {
    if (!global.CMS || typeof global.CMS.registerEventListener !== 'function') {
      setTimeout(hookCmsEvents, 400);
      return;
    }
    global.CMS.registerEventListener({ name: 'postSave', handler: flushWaitingForDraft });
  }

  function start() {
    loadPersisted();
    removeGlobalChrome();
    ensureMediaLibraryButton();
    hookCmsEvents();
    bindRoot(document);
    rewritePreview();
    global.addEventListener('hashchange', function () {
      ensureMediaLibraryButton();
      flushWaitingForDraft();
      scheduleRewrite();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
