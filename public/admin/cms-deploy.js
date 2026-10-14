/**
 * Bandeau admin : brouillon vs build Vercel.
 * Save → preview à jour, pas de prod.
 * Publish / images sur main → poll SHA jusqu’au déploiement.
 */
(function (global) {
  var WATCH_KEY = 'sonar-deploy-watch';
  var POLL_MS = 4000;
  var TIMEOUT_MS = 4 * 60 * 1000;
  var timer = null;
  var watching = null;

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
      hideBanner();
    });
    return el;
  }

  function showBanner(kind, title, message) {
    var el = bannerEl();
    el.setAttribute('data-kind', kind || 'wait');
    document.getElementById('sonar-deploy-title').textContent = title;
    document.getElementById('sonar-deploy-msg').textContent = message;
    el.hidden = false;
    document.body.appendChild(el);
  }

  function hideBanner() {
    var el = document.getElementById('sonar-deploy-banner');
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

  function pingFiles(paths) {
    var list = (paths || []).filter(Boolean);
    if (!list.length) return Promise.resolve(false);
    return Promise.all(list.map(function (path) {
      var url = String(path).indexOf('http') === 0 ? path : (location.origin + path);
      return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'sonar=' + Date.now(), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit'
      }).then(function (res) { return res.ok; }).catch(function () { return false; });
    })).then(function (flags) {
      return flags.every(Boolean);
    });
  }

  function stopPoll() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function finishLive(state) {
    stopPoll();
    persist(null);
    if (state && state.files && global.SonarCmsMedia && typeof global.SonarCmsMedia.markLive === 'function') {
      global.SonarCmsMedia.markLive(state.files);
    }
    var extra = state && state.reason === 'media'
      ? 'Les images sont sur le site. Tu peux rafraîchir.'
      : 'La publication est en ligne. Rafraîchis pour voir le site à jour.';
    showBanner('ok', 'C’est en ligne', extra);
  }

  function poll() {
    if (!watching) return;
    var state = watching;
    if (Date.now() - state.startedAt > TIMEOUT_MS) {
      stopPoll();
      showBanner('err', 'Toujours en cours', 'Le build Vercel dépasse 4 min. Vérifie le dashboard Vercel, ou réessaie plus tard.');
      return;
    }
    Promise.all([siteVersion(), pingFiles(state.files)]).then(function (pair) {
      if (!watching) return;
      var version = pair[0] || {};
      var filesReady = pair[1];
      if (!state.shaAtStart && version.sha) {
        state.shaAtStart = version.sha;
        state.deploymentIdAtStart = version.deploymentId || state.deploymentIdAtStart || '';
        persist(state);
      }
      var shaChanged = Boolean(version.sha && state.shaAtStart && version.sha !== state.shaAtStart);
      var deployChanged = Boolean(version.deploymentId && state.deploymentIdAtStart && version.deploymentId !== state.deploymentIdAtStart);
      var shaMatch = Boolean(state.expectedSha && version.sha && version.sha.indexOf(String(state.expectedSha).slice(0, 7)) === 0);
      var newDeploy = shaMatch || shaChanged || deployChanged;
      var waitedLong = Date.now() - state.startedAt > 20000;
      var done = newDeploy || (state.reason === 'media' && filesReady && waitedLong && !state.shaAtStart);
      if (done) {
        finishLive(state);
        return;
      }
      var waited = Math.round((Date.now() - state.startedAt) / 1000);
      showBanner(
        'wait',
        'Mise en ligne…',
        (state.reason === 'media'
          ? 'Images envoyées. Build Vercel en cours'
          : 'Publication envoyée. Build Vercel en cours') + ' (' + waited + ' s).'
      );
      timer = setTimeout(poll, POLL_MS);
    }).catch(function () {
      timer = setTimeout(poll, POLL_MS);
    });
  }

  function watch(opts) {
    opts = opts || {};
    stopPoll();
    if (isLocal()) {
      showBanner('ok', 'Envoi local', 'Pas de build Vercel en local. La preview admin suffit.');
      setTimeout(hideBanner, 6000);
      return;
    }
    var state = {
      reason: opts.reason || 'publish',
      expectedSha: opts.sha || '',
      shaAtStart: '',
      deploymentIdAtStart: '',
      files: opts.files || [],
      startedAt: Date.now()
    };
    persist(state);
    showBanner(
      'wait',
      'Mise en ligne…',
      state.reason === 'media'
        ? 'Les images s’affichent déjà ici. Le site public attend la fin du build Vercel.'
        : 'Publication enregistrée. Le site public se met à jour après le build Vercel.'
    );
    siteVersion().then(function (version) {
      if (!watching) return;
      watching.shaAtStart = version && version.sha || '';
      watching.deploymentIdAtStart = version && version.deploymentId || '';
      persist(watching);
      timer = setTimeout(poll, 2500);
    });
  }

  function noteSave() {
    if (watching && (watching.reason === 'publish' || watching.reason === 'media')) return;
    showBanner('ok', 'Brouillon enregistré', 'La preview est à jour. Le site public ne changera qu’à la publication.');
    clearTimeout(noteSave._t);
    noteSave._t = setTimeout(hideBanner, 8000);
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
          if ((method === 'PUT' || method === 'POST') && /\/(merge|merges)(\?|$)/.test(u)) {
            watch({ reason: 'publish' });
            return;
          }
          if ((method === 'PATCH' || method === 'POST' || method === 'PUT') && /\/git\/refs\/heads\//.test(u)) {
            if (/heads\/main(\?|$)/.test(u) || /\/heads\/main$/.test(u)) {
              if (!watching) watch({ reason: 'publish' });
            } else if (/heads\/cms\//.test(u)) {
              noteSave();
            }
          }
        }).catch(function () {});
      } catch (e) {}
      return req;
    };
    global.fetch.__sonarDeployHook = true;
  }

  function resume() {
    var state = loadWatch();
    if (!state || !state.startedAt) return;
    if (Date.now() - state.startedAt > TIMEOUT_MS) {
      persist(null);
      return;
    }
    watching = state;
    showBanner('wait', 'Mise en ligne…', 'Reprise du suivi du build Vercel…');
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
