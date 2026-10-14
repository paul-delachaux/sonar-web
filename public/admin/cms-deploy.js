/**
 * Bandeau admin : brouillon vs build Vercel.
 * Save → pas de bouton Rafraîchir.
 * Plusieurs commits main → un seul suivi jusqu’à ce que plus rien ne builde.
 */
(function (global) {
  var WATCH_KEY = 'sonar-deploy-watch';
  var POLL_MS = 4000;
  var QUIET_MS = 8000;
  var TIMEOUT_MS = 4 * 60 * 1000;
  var timer = null;
  var watching = null;
  var saveId = 0;
  var saveDismissed = -1;
  var lastSaveAt = 0;

  function isLocal() {
    return /localhost|127\.0\.0\.1/.test(String(location.hostname || ''));
  }

  function bannerEl() {
    var el = document.getElementById('sonar-deploy-banner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'sonar-deploy-banner';
    el.style.zIndex = '2147483646';
    el.hidden = true;
    el.innerHTML =
      '<strong id="sonar-deploy-title"></strong>' +
      '<span id="sonar-deploy-msg"></span>' +
      '<button type="button" id="sonar-deploy-refresh">Rafraîchir</button>' +
      '<button type="button" id="sonar-deploy-close" aria-label="Fermer">×</button>';
    document.body.appendChild(el);
    document.getElementById('sonar-deploy-refresh').addEventListener('click', function () {
      location.reload();
    });
    document.getElementById('sonar-deploy-close').addEventListener('click', function () {
      hideBanner(true);
    });
    return el;
  }

  function showBanner(kind, title, message) {
    if (kind === 'save' && saveDismissed === saveId) return;
    if (kind === 'wait' && watching && watching.closedWait) return;
    if (kind === 'ok' && watching && watching.closedDone) return;
    var el = bannerEl();
    el.setAttribute('data-kind', kind || 'wait');
    document.getElementById('sonar-deploy-title').textContent = title;
    document.getElementById('sonar-deploy-msg').textContent = message;
    el.hidden = false;
    document.body.appendChild(el);
  }

  function hideBanner(fromUser) {
    var el = document.getElementById('sonar-deploy-banner');
    var kind = el ? el.getAttribute('data-kind') : '';
    if (fromUser) {
      if (kind === 'save') saveDismissed = saveId;
      if (watching && (kind === 'wait' || kind === 'err')) watching.closedWait = true;
      if (watching && kind === 'ok') watching.closedDone = true;
      persist(watching);
    }
    if (el) el.hidden = true;
  }

  function persist(state) {
    watching = state;
    try {
      if (state) sessionStorage.setItem(WATCH_KEY, JSON.stringify(state));
      else sessionStorage.removeItem(WATCH_KEY);
    } catch (e) {}
  }

  function loadWatch() {
    try {
      var raw = sessionStorage.getItem(WATCH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function siteVersion() {
    return fetch('/api/site-version', { cache: 'no-store' }).then(function (res) {
      return res.json().catch(function () { return {}; });
    }).catch(function () { return {}; });
  }

  function unique(list) {
    var out = [];
    var seen = {};
    (list || []).forEach(function (item) {
      if (!item || seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    return out;
  }

  function waitLabel(state) {
    var n = state.pendingCount || 1;
    var waited = Math.round((Date.now() - state.startedAt) / 1000);
    var prefix = n > 1
      ? (n + ' mises à jour GitHub, on attend la fin des builds')
      : (state.reason === 'media'
        ? 'Build Vercel en cours'
        : 'Publication envoyée. Build Vercel en cours');
    return prefix + ' (' + waited + ' s).';
  }

  function stopPoll() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function finishLive(state) {
    stopPoll();
    if (state && state.files && global.SonarCmsMedia && typeof global.SonarCmsMedia.markLive === 'function') {
      global.SonarCmsMedia.markLive(state.files);
    }
    var closedDone = state && state.closedDone;
    persist(null);
    if (closedDone) return;
    var extra = state && state.reason === 'media'
      ? 'Les fichiers sont sur le site public.'
      : 'La publication est sur le site public.';
    showBanner('ok', 'C’est en ligne', extra);
  }

  function poll() {
    if (!watching || watching.phase === 'done') return;
    var state = watching;
    if (Date.now() - state.startedAt > TIMEOUT_MS) {
      stopPoll();
      showBanner('err', 'Toujours en cours', 'Le build Vercel dépasse 4 min. Vérifie le dashboard Vercel, ou réessaie plus tard.');
      return;
    }
    siteVersion().then(function (version) {
      if (!watching || watching.phase === 'done') return;
      version = version || {};
      if (!state.shaAtStart && version.sha) {
        state.shaAtStart = version.sha;
        state.deploymentIdAtStart = version.deploymentId || state.deploymentIdAtStart || '';
        persist(state);
      }
      var shaChanged = Boolean(version.sha && state.shaAtStart && version.sha !== state.shaAtStart);
      var deployChanged = Boolean(version.deploymentId && state.deploymentIdAtStart && version.deploymentId !== state.deploymentIdAtStart);
      var shaMatch = Boolean(state.expectedSha && version.sha && version.sha.indexOf(String(state.expectedSha).slice(0, 7)) === 0);
      var newDeploy = shaMatch || shaChanged || deployChanged;
      var quiet = Date.now() - (state.lastCommitAt || state.startedAt) >= QUIET_MS;
      var latestDeployed = !state.expectedSha || shaMatch || (newDeploy && quiet);
      if (newDeploy && quiet && latestDeployed) {
        state.phase = 'done';
        persist(state);
        finishLive(state);
        return;
      }
      showBanner('wait', 'Mise en ligne…', waitLabel(state));
      timer = setTimeout(poll, POLL_MS);
    }).catch(function () {
      timer = setTimeout(poll, POLL_MS);
    });
  }

  function watch(opts) {
    opts = opts || {};
    if (isLocal()) {
      showBanner('save', 'Envoi local', 'Pas de build Vercel en local. La preview de l’éditeur suffit.');
      return;
    }

    if (watching && watching.phase === 'wait') {
      if (opts.reason === 'publish' || watching.reason === 'publish') watching.reason = 'publish';
      else watching.reason = watching.reason || opts.reason || 'media';
      watching.files = unique((watching.files || []).concat(opts.files || []));
      if (opts.sha && opts.sha === watching.expectedSha) {
        persist(watching);
        return;
      }
      if (opts.sha && !watching.expectedSha) {
        watching.expectedSha = opts.sha;
        persist(watching);
        return;
      }
      if (opts.sha) watching.expectedSha = opts.sha;
      watching.lastCommitAt = Date.now();
      watching.pendingCount = (watching.pendingCount || 1) + 1;
      persist(watching);
      showBanner('wait', 'Mise en ligne…', waitLabel(watching));
      if (!timer) timer = setTimeout(poll, POLL_MS);
      return;
    }

    stopPoll();
    var state = {
      phase: 'wait',
      reason: opts.reason || 'publish',
      expectedSha: opts.sha || '',
      shaAtStart: '',
      deploymentIdAtStart: '',
      files: unique(opts.files || []),
      startedAt: Date.now(),
      lastCommitAt: Date.now(),
      pendingCount: 1,
      closedWait: false,
      closedDone: false
    };
    persist(state);
    showBanner('wait', 'Mise en ligne…', waitLabel(state));
    siteVersion().then(function (version) {
      if (!watching || watching.phase !== 'wait') return;
      watching.shaAtStart = version && version.sha || '';
      watching.deploymentIdAtStart = version && version.deploymentId || '';
      persist(watching);
      timer = setTimeout(poll, 2500);
    });
  }

  function noteSave() {
    if (watching && watching.phase === 'wait') return;
    var now = Date.now();
    if (now - lastSaveAt > 2500) saveId += 1;
    lastSaveAt = now;
    if (saveDismissed === saveId) return;
    showBanner(
      'save',
      'Brouillon enregistré',
      'La preview de l’éditeur est à jour. Le site public ne changera qu’à la publication.'
    );
    clearTimeout(noteSave._t);
    noteSave._t = setTimeout(function () {
      var el = document.getElementById('sonar-deploy-banner');
      if (el && el.getAttribute('data-kind') === 'save' && saveDismissed !== saveId) hideBanner(false);
    }, 8000);
  }

  function shaFromGithub(data) {
    if (!data || typeof data !== 'object') return '';
    if (data.object && data.object.sha) return data.object.sha;
    if (data.commit && data.commit.sha) return data.commit.sha;
    if (data.sha && typeof data.sha === 'string') return data.sha;
    return '';
  }

  function hookFetch() {
    if (global.fetch && global.fetch.__sonarDeployHook) return;
    var orig = global.fetch;
    global.fetch = function (input, init) {
      var req = orig.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        req.then(function (res) {
          if (!res || !res.ok || !/api\.github\.com/i.test(url)) return;
          var u = decodeURIComponent(url);
          res.clone().json().then(function (data) {
            var sha = shaFromGithub(data);
            if ((method === 'PUT' || method === 'POST') && /\/(merge|merges)(\?|$)/.test(u)) {
              watch({ reason: 'publish', sha: sha });
              return;
            }
            if ((method === 'PATCH' || method === 'POST' || method === 'PUT') && /\/git\/refs\/heads\//.test(u)) {
              if (/heads\/main(\?|$)/.test(u) || /\/heads\/main$/.test(u)) {
                watch({ reason: watching && watching.reason === 'media' ? 'media' : 'publish', sha: sha });
              } else if (/heads\/cms\//.test(u)) {
                noteSave();
              }
              return;
            }
            if ((method === 'PUT' || method === 'DELETE') && /\/contents\/public\/assets\/uploads\//.test(u)) {
              watch({ reason: 'media', sha: sha });
            }
          }).catch(function () {});
        }).catch(function () {});
      } catch (e) {}
      return req;
    };
    global.fetch.__sonarDeployHook = true;
  }

  function resume() {
    var state = loadWatch();
    if (!state || !state.startedAt || state.phase === 'done') return;
    if (Date.now() - state.startedAt > TIMEOUT_MS) {
      persist(null);
      return;
    }
    watching = state;
    showBanner('wait', 'Mise en ligne…', waitLabel(state));
    poll();
  }

  function hookCms() {
    if (!global.CMS || typeof global.CMS.registerEventListener !== 'function') {
      setTimeout(hookCms, 400);
      return;
    }
    global.CMS.registerEventListener({ name: 'preSave', handler: noteSave });
    global.CMS.registerEventListener({ name: 'postSave', handler: noteSave });
    global.CMS.registerEventListener({
      name: 'postPublish',
      handler: function () {
        watch({ reason: 'publish' });
        setTimeout(function () {
          location.reload();
        }, 600);
      }
    });
  }

  global.SonarCmsDeploy = {
    watch: watch,
    noteSave: noteSave
  };

  function start() {
    bannerEl();
    hookFetch();
    var tries = 0;
    function keepHook() {
      hookFetch();
      tries += 1;
      if (tries < 20) setTimeout(keepHook, 500);
    }
    keepHook();
    resume();
    hookCms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
