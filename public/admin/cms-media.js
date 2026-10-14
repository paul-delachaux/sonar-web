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
  var waitingForDraft = [];

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

  function commitFilesBatch(files, branch) {
    var token = githubToken();
    if (!token) return Promise.reject(new Error('Session GitHub absente : reconnecte-toi à l’admin.'));
    if (!files.length) return Promise.resolve([]);

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
            });
          }).then(function () {
            return unique.map(function (file) { return publicPathFor(mediaFileName(file)); });
          });
        });
      });
    });
  }

  function uploadBatch(files) {
    var list = (files || []).filter(Boolean);
    if (!list.length) return Promise.resolve();
    list.forEach(rememberFile);
    rewritePreview();
    return detectTarget().then(function (target) {
      if (!target.branch) {
        if (target.kind === 'wait-draft') {
          waitingForDraft = waitingForDraft.concat(list);
          toast('Aperçu OK. Enregistre le brouillon : les ' + list.length + ' image(s) partiront ensuite en un seul commit.');
          return;
        }
        toast('Ouvre un article (et enregistre le brouillon) pour envoyer des images. Un admin ne peut pas écrire sur main.', 'err');
        return;
      }
      toast(list.length > 1
        ? ('Envoi de ' + list.length + ' images en un seul commit…')
        : 'Envoi de l’image vers GitHub…');
      return commitFilesBatch(list, target.branch).then(function () {
        toast(list.length > 1
          ? (list.length + ' images envoyées en un commit (' + (target.kind === 'main' ? 'main' : 'brouillon') + '). Un seul build Vercel.')
          : 'Image envoyée sur GitHub.');
        rewritePreview();
      });
    }).catch(function (err) {
      toast((err && err.message) || 'Échec de l’envoi GitHub.', 'err');
    });
  }

  function flushWaitingForDraft() {
    if (!waitingForDraft.length) return;
    detectTarget().then(function (target) {
      if (!target.branch) return;
      var pending = waitingForDraft.splice(0, waitingForDraft.length);
      toast('Envoi de ' + pending.length + ' image(s) du brouillon en un commit…');
      return commitFilesBatch(pending, target.branch).then(function () {
        toast(pending.length + ' image(s) envoyées sur le brouillon (un commit).');
      });
    }).catch(function (err) {
      toast((err && err.message) || 'Impossible d’envoyer les images du brouillon.', 'err');
    });
  }

  function cachedUrl(path) {
    var s = String(path || '');
    if (!s) return '';
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

  function patchLibraryFileInputs(root) {
    var inputs = root.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      input.multiple = true;
      if (input.getAttribute('data-sonar-multi') === '1') continue;
      input.setAttribute('data-sonar-multi', '1');
      input.addEventListener('change', function (event) {
        var files = Array.prototype.slice.call(event.target.files || []);
        if (!files.length) return;
        event.stopImmediatePropagation();
        event.stopPropagation();
        event.preventDefault();
        uploadBatch(files);
        event.target.value = '';
      }, true);
    }
  }

  function ensureMediaLibraryButton() {
    removeGlobalChrome();
    var root = findMediaLibraryRoot();
    var existing = document.getElementById('sonar-media-multi');
    if (!root) {
      if (existing) existing.remove();
      return;
    }
    patchLibraryFileInputs(root);
    if (existing && root.contains(existing)) return;
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
      if (!src || /^(blob:|data:)/i.test(src)) return;
      if (!isUploadPath(src) && src.indexOf(PUBLIC_PREFIX) !== 0) return;
      var hit = cachedUrl(src);
      if (hit) {
        if (el.getAttribute('src') !== hit) el.setAttribute('src', hit);
        return;
      }
      resolve(src).then(function (next) {
        if (next && next !== src && el.getAttribute('src') !== next) el.setAttribute('src', next);
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
      ensureMediaLibraryButton();
    }, 80);
  }

  global.SonarCmsMedia = {
    url: syncUrl,
    resolve: resolve,
    uploadBatch: uploadBatch
  };

  function hookCmsEvents() {
    if (!global.CMS || typeof global.CMS.registerEventListener !== 'function') {
      setTimeout(hookCmsEvents, 400);
      return;
    }
    global.CMS.registerEventListener({ name: 'postSave', handler: flushWaitingForDraft });
  }

  function start() {
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
