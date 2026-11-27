(function (global) {
  function toPlain(value) {
    return value && typeof value.toJS === 'function' ? value.toJS() : value;
  }

  function entryValue(entry, name) {
    if (entry && typeof entry.getIn === 'function') return toPlain(entry.getIn(['data', name]));
    var data = toPlain(entry && entry.data);
    return data && data[name];
  }

  function fieldValue(field, name) {
    if (field && typeof field.get === 'function') return toPlain(field.get(name));
    return field && field[name];
  }

  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'date inconnue';
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function normalizeOptions(value) {
    value = toPlain(value);
    if (!Array.isArray(value) || !value.length) {
      return [
        { id: 'option-1', label: '', label_en: '' },
        { id: 'option-2', label: '', label_en: '' }
      ];
    }
    return value.map(function (item, index) {
      item = toPlain(item);
      item = item && typeof item === 'object' ? item : {};
      return {
        id: String(item.id || 'option-' + (index + 1)),
        label: String(item.label || ''),
        label_en: String(item.label_en || '')
      };
    });
  }

  function pollFromEntry(slug, value) {
    value = toPlain(value);
    if (!value || typeof value !== 'object') return null;
    var data = value.data && typeof value.data === 'object' ? value.data : value;
    return {
      slug: String(data.slug || value.slug || slug || ''),
      layout: String(data.layout || 'single_choice'),
      title: String(data.title || ''),
      title_en: String(data.title_en || ''),
      question: String(data.question || ''),
      question_en: String(data.question_en || ''),
      isVisible: data.isVisible === true || data.isVisible === 'true',
      isClosed: data.isClosed === true,
      isStopped: data.isStopped === true,
      isExpired: data.isExpired === true,
      startedAt: String(data.startedAt || ''),
      endsAt: String(data.endsAt || ''),
      stoppedAt: String(data.stoppedAt || ''),
      durationHours: Number(data.durationHours) || 0,
      showLiveResults: data.showLiveResults === true,
      lifecycleAvailable: typeof data.lifecycleAvailable === 'boolean' ? data.lifecycleAvailable : undefined,
      options: normalizeOptions(data.options)
    };
  }

  function pollStatusInfo(poll) {
    if (!poll) {
      return {
        label: 'Nouveau sondage',
        detail: 'Enregistre le sondage puis rends-le visible pour démarrer sa durée.',
        tone: 'pending'
      };
    }
    var status;
    if (poll.isClosed) {
      status = poll.isStopped
        ? { label: 'Arrêté manuellement', detail: poll.stoppedAt ? 'Arrêté le ' + formatDate(poll.stoppedAt) : 'Le sondage a été arrêté.', tone: 'closed' }
        : { label: 'Terminé', detail: poll.endsAt ? 'Échéance atteinte le ' + formatDate(poll.endsAt) : 'La durée du sondage est écoulée.', tone: 'closed' };
    } else if (poll.lifecycleAvailable === false) {
      status = {
        label: 'Statut indisponible',
        detail: 'Vérifie la configuration Supabase et la table sondage_lifecycle.',
        tone: 'unavailable'
      };
    } else if (poll.startedAt) {
      status = poll.isVisible
        ? { label: 'En cours', detail: 'Clôture prévue le ' + formatDate(poll.endsAt), tone: 'active' }
        : { label: 'Masqué · durée en cours', detail: 'Clôture prévue le ' + formatDate(poll.endsAt), tone: 'hidden' };
    } else {
      status = poll.isVisible
        ? { label: 'En attente du premier affichage', detail: 'Le compte à rebours commence au premier affichage public.', tone: 'pending' }
        : { label: 'Brouillon masqué', detail: 'Rends le sondage visible pour démarrer sa durée.', tone: 'hidden' };
    }

    if (status.tone !== 'unavailable') {
      var settings = [];
      if (poll.durationHours) settings.push('Durée : ' + poll.durationHours + ' h');
      settings.push(poll.isClosed
        ? 'Résultats disponibles sur la page Résultats'
        : poll.showLiveResults
          ? 'Résultats en direct après réponse'
          : 'Résultats visibles après clôture');
      status.detail += ' · ' + settings.join(' · ');
    }
    return status;
  }

  function pollsFromCmsStore() {
    try {
      var cms = global.CMS;
      var store = cms && (cms.store || (cms.getStore && cms.getStore()));
      var state = store && store.getState && store.getState();
      var entries = state && state.entries && (state.entries.get ? state.entries.get('entities') : state.entries.entities);
      entries = toPlain(entries);
      var collection = entries && entries.sondages;
      if (!collection) return [];
      return Object.keys(collection).map(function (slug) {
        return pollFromEntry(slug, collection[slug]);
      }).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function authHeaders() {
    var helper = global.SonarArticleSearch;
    return helper && typeof helper.authHeaders === 'function'
      ? helper.authHeaders({ Accept: 'application/json' })
      : { Accept: 'application/json' };
  }

  function fetchPolls() {
    if (global.__SONDE_ADMIN_POLLS_PROMISE) return global.__SONDE_ADMIN_POLLS_PROMISE;
    global.__SONDE_ADMIN_POLLS_PROMISE = global.fetch('/api/admin/sondages', {
      headers: authHeaders()
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.message || 'Impossible de charger les sondages.');
        if (!data || !Array.isArray(data.polls)) throw new Error('La réponse des sondages est invalide.');
        return data.polls.map(function (poll) {
          return pollFromEntry(poll.slug, poll);
        }).filter(Boolean);
      });
    }).catch(function (error) {
      global.__SONDE_ADMIN_POLLS_PROMISE = null;
      throw error;
    });
    return global.__SONDE_ADMIN_POLLS_PROMISE;
  }

  function mergePolls(serverPolls) {
    var merged = [];
    var positions = Object.create(null);
    serverPolls.forEach(function (poll) {
      if (!poll.slug) return;
      positions[poll.slug] = merged.length;
      merged.push(poll);
    });
    pollsFromCmsStore().forEach(function (poll) {
      if (!poll.slug) return;
      if (positions[poll.slug] === undefined) {
        positions[poll.slug] = merged.length;
        merged.push(poll);
      } else {
        var serverPoll = merged[positions[poll.slug]];
        merged[positions[poll.slug]] = Object.assign({}, poll, {
          isVisible: serverPoll.isClosed ? false : poll.isVisible,
          isClosed: serverPoll.isClosed,
          isStopped: serverPoll.isStopped,
          isExpired: serverPoll.isExpired,
          startedAt: serverPoll.startedAt,
          endsAt: serverPoll.endsAt,
          stoppedAt: serverPoll.stoppedAt,
          durationHours: serverPoll.durationHours,
          showLiveResults: serverPoll.showLiveResults,
          lifecycleAvailable: serverPoll.lifecycleAvailable
        });
      }
    });
    return merged;
  }

  function optionsForPoll(poll, language) {
    if (poll.layout === 'scale') {
      return Array.from({ length: 10 }, function (_, index) { return String(index + 1); });
    }
    if (poll.layout === 'dichotomous') {
      return language === 'en' ? ['No', 'Yes'] : ['Non', 'Oui'];
    }
    var options = Array.isArray(poll.options) ? poll.options : [];
    return options.map(function (option) {
      return language === 'en' ? (option.label_en || option.label) : option.label;
    }).filter(Boolean);
  }

  var CMS_PREVIEW_STYLES = [
    '.sonde-cms-preview{box-sizing:border-box;padding:16px;background:#f3f4f6;color:#263246;font-family:Helvetica,Arial,sans-serif;}',
    '.sonde-cms-preview h3{margin:0 0 12px;color:#293548;font-size:16px;}',
    '.sonde-cms-preview-grid{display:grid;grid-template-columns:1fr;gap:16px;}',
    '.sonde-cms-preview-grid.is-grid{grid-template-columns:repeat(2,minmax(0,1fr));}',
    '.sonde-cms-lifecycle{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;padding:10px 12px;border:1px solid #d5d9e0;border-radius:7px;background:#fff;}',
    '.sonde-cms-lifecycle-badge{padding:4px 8px;border-radius:999px;font-size:12px;font-weight:800;}',
    '.sonde-cms-lifecycle-badge.is-active{background:#ecfdf3;color:#027a48;}',
    '.sonde-cms-lifecycle-badge.is-closed{background:#fef3f2;color:#b42318;}',
    '.sonde-cms-lifecycle-badge.is-hidden{background:#e5e7eb;color:#667085;}',
    '.sonde-cms-lifecycle-badge.is-pending{background:#fffaeb;color:#b54708;}',
    '.sonde-cms-lifecycle-badge.is-unavailable{background:#fef3f2;color:#b42318;}',
    '.sonde-cms-lifecycle-detail{color:#475467;font-size:12px;line-height:1.4;}',
    '.sonde-cms-poll-card{min-width:0;padding:20px;border:1px solid rgba(255,121,0,.32);border-radius:12px;background:#02001d;color:#e8e7ef;box-shadow:0 14px 35px rgba(0,0,0,.16);}',
    '.sonde-cms-poll-heading{margin:0 0 14px;padding:0;border:0;background:transparent;text-align:left;line-height:1.25;}',
    '.sonde-cms-poll-heading h3{margin:0;color:#fff;font-family:Georgia,\"Times New Roman\",serif;font-size:clamp(20px,2.4vw,28px);text-decoration:underline;text-decoration-color:rgba(255,121,0,.7);text-underline-offset:4px;}',
    '.sonde-cms-poll-question{min-height:3em;margin:0 0 16px;color:#e8e7ef;font-size:14px;line-height:1.5;white-space:pre-line;}',
    '.sonde-cms-poll-options{display:flex;flex-direction:column;gap:10px;}',
    '.sonde-cms-poll-option{padding:12px 16px;border-radius:28px;background:#101052;color:#f5f4fb;font-size:14px;}',
    '.sonde-cms-poll-options.is-scale{flex-direction:row;flex-wrap:wrap;}',
    '.sonde-cms-poll-options.is-scale .sonde-cms-poll-option{min-width:28px;flex:1 0 28px;padding:8px;text-align:center;}',
    '.sonde-cms-poll-options.is-multiple_choice .sonde-cms-poll-option{border-radius:12px;}',
    '.sonde-cms-note{margin:8px 0 0;color:#667085;font-size:12px;}',
    '.sonde-cms-error{margin:8px 0 0;color:#b42318;font-size:12px;}',
    '.sonde-cms-status{display:inline-block;margin:8px 0 0;padding:3px 7px;border-radius:999px;background:#fffaeb;color:#b54708;font-size:11px;font-weight:700;}',
    '.sonde-cms-status.is-active{background:#ecfdf3;color:#027a48;}',
    '.sonde-cms-status.is-hidden{background:#e5e7eb;color:#667085;}',
    '.sonde-cms-status.is-unavailable{background:#fef3f2;color:#b42318;}',
    '.sonde-cms-status-detail{margin:0;color:#667085;font-size:12px;line-height:1.4;}',
    '@media(max-width:700px){.sonde-cms-preview-grid.is-grid{grid-template-columns:1fr}}'
  ].join('');

  function renderPollCard(h, poll, language, key) {
    poll = poll || {};
    var title = language === 'en' ? (poll.title_en || poll.title) : poll.title;
    var question = language === 'en' ? (poll.question_en || poll.question) : poll.question;
    return h('article', { key: key || poll.slug || 'poll', className: 'sonde-cms-poll-card' },
      h('header', { className: 'sonde-cms-poll-heading' },
        h('h3', {}, title || 'Titre du sondage')
      ),
      h('p', { className: 'sonde-cms-poll-question' }, question || 'La question apparaîtra ici.'),
      h('div', { className: 'sonde-cms-poll-options is-' + (poll.layout || 'single_choice') },
        optionsForPoll(poll, language).map(function (label, index) {
          return h('div', { key: poll.slug + '-option-' + index, className: 'sonde-cms-poll-option' }, label);
        })
      )
    );
  }

  function orderedPolls(polls, value) {
    var order = toPlain(value);
    order = Array.isArray(order) ? order : [];
    var bySlug = Object.create(null);
    polls.forEach(function (poll) { bySlug[poll.slug] = poll; });
    var seen = Object.create(null);
    var result = [];
    order.forEach(function (slug) {
      if (typeof slug !== 'string' || !bySlug[slug] || seen[slug]) return;
      seen[slug] = true;
      result.push(bySlug[slug]);
    });
    polls.forEach(function (poll) {
      if (poll.slug && !seen[poll.slug]) {
        seen[poll.slug] = true;
        result.push(poll);
      }
    });
    return result.filter(function (poll) { return !poll.isClosed; })
      .filter(function (poll) { return poll.isVisible; })
      .concat(result.filter(function (poll) { return !poll.isClosed && !poll.isVisible; }));
  }

  function ensureStyles() {
    if (document.getElementById('sonde-cms-editor-styles')) return;
    var style = document.createElement('style');
    style.id = 'sonde-cms-editor-styles';
    style.textContent = [
      '.sonde-cms-editor{display:block;color:#263246;font-family:Helvetica,Arial,sans-serif;}',
      '.sonde-cms-section{margin:0 0 14px;padding:12px;border:1px solid #d5d9e0;border-radius:8px;background:#f8f9fb;}',
      '.sonde-cms-section h3{margin:0;color:#293548;font-size:14px;}',
      '.sonde-cms-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}',
      '.sonde-cms-section button{border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#283448;padding:5px 8px;font-weight:700;cursor:pointer;}',
      '.sonde-cms-section button:hover:not(:disabled){border-color:#ff7900;color:#d65f00;}',
      '.sonde-cms-section button:disabled{opacity:.45;cursor:not-allowed;}',
      '.sonde-cms-option-list,.sonde-cms-order-list{display:flex;flex-direction:column;gap:8px;}',
      '.sonde-cms-item{overflow:hidden;border:1px solid #d5d9e0;border-radius:7px;background:#fff;}',
      '.sonde-cms-item-head{display:flex;align-items:center;gap:7px;padding:8px 10px;background:#f1f3f6;}',
      '.sonde-cms-item-head > button:first-of-type{flex:1;min-width:0;border:0;background:transparent;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sonde-cms-item-controls{display:flex;gap:4px;}',
      '.sonde-cms-item-controls button{flex:0 0 auto;}',
      '.sonde-cms-item.is-hidden{border-color:#cbd2dc;background:#f1f3f5;}',
      '.sonde-cms-item.is-hidden .sonde-cms-item-head{background:#e5e7eb;}',
      '.sonde-cms-item.is-hidden .sonde-cms-order-title,.sonde-cms-item.is-hidden .sonde-cms-order-question{color:#667085;}',
      '.sonde-cms-item.is-active{border-color:#86efac;background:#f0fdf4;}',
      '.sonde-cms-item.is-active .sonde-cms-item-head{background:#dcfce7;}',
      '.sonde-cms-item.is-active .sonde-cms-item-body{background:#f0fdf4;}',
      '.sonde-cms-grip{flex:0 0 auto;padding:2px 5px;color:#667085;cursor:grab;user-select:none;font-size:18px;line-height:1;}',
      '.sonde-cms-item-body{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:11px;}',
      '.sonde-cms-item-body label{display:flex;flex-direction:column;gap:5px;color:#38445a;font-size:12px;font-weight:700;}',
      '.sonde-cms-item-body input{box-sizing:border-box;width:100%;min-width:0;padding:7px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font-size:13px;font-weight:400;}',
      '.sonde-cms-item-body label:first-child{grid-column:1/-1;}',
      '.sonde-cms-editor input:focus-visible,.sonde-cms-editor button:focus-visible{outline:2px solid #ff7900;outline-offset:1px;}',
      '.sonde-cms-note{margin:8px 0 0;color:#667085;font-size:12px;}',
      '.sonde-cms-error{margin:8px 0 0;color:#b42318;font-size:12px;}',
      '.sonde-cms-status{display:inline-block;margin:8px 0 4px;padding:4px 9px;border-radius:999px;background:#fffaeb;color:#b54708;font-size:12px;font-weight:800;}',
      '.sonde-cms-status.is-active{background:#dcfce7;color:#027a48;}',
      '.sonde-cms-status.is-closed,.sonde-cms-status.is-unavailable{background:#fef3f2;color:#b42318;}',
      '.sonde-cms-status.is-hidden{background:#e5e7eb;color:#667085;}',
      '.sonde-cms-status-detail{margin:0;color:#475467;font-size:13px;line-height:1.5;}',
      '.sonde-cms-poll-list-title{display:flex!important;align-items:center;gap:10px;}',
      '.sonde-cms-list-status{flex:0 0 auto;margin-left:auto;padding:4px 9px;border-radius:999px;background:#fffaeb;color:#b54708;font-size:12px;font-weight:800;line-height:1.3;}',
      '.sonde-cms-list-status.is-active{background:#dcfce7;color:#027a48;}',
      '.sonde-cms-list-status.is-closed,.sonde-cms-list-status.is-unavailable{background:#fef3f2;color:#b42318;}',
      '.sonde-cms-list-status.is-hidden{background:#e5e7eb;color:#667085;}',
      '.sonde-cms-preview{padding:12px;border:1px solid #d5d9e0;border-radius:8px;background:#f8f9fb;}',
      '.sonde-cms-preview h3{margin:0 0 10px;color:#293548;font-size:14px;}',
      '.sonde-cms-preview-grid{display:grid;grid-template-columns:1fr;gap:12px;}',
      '.sonde-cms-preview-grid.is-grid{grid-template-columns:repeat(2,minmax(0,1fr));}',
      '.sonde-cms-poll-card{min-width:0;padding:16px;border:1px solid rgba(255,121,0,.32);border-radius:10px;background:#02001d;color:#e8e7ef;box-shadow:0 10px 24px rgba(0,0,0,.15);}',
      '.sonde-cms-poll-heading{margin:0 0 12px;padding:0;border:0;background:transparent;text-align:left;line-height:1.25;}',
      '.sonde-cms-poll-heading h3{margin:0;color:#fff;font-family:Georgia,serif;font-size:20px;text-decoration:underline;text-decoration-color:rgba(255,121,0,.7);text-underline-offset:4px;}',
      '.sonde-cms-poll-question{min-height:2.5em;margin:0 0 14px;color:#e8e7ef;font-size:14px;line-height:1.5;white-space:pre-line;}',
      '.sonde-cms-poll-options{display:flex;flex-direction:column;gap:8px;}',
      '.sonde-cms-poll-option{padding:10px 12px;border-radius:24px;background:#101052;color:#f5f4fb;font-size:13px;}',
      '.sonde-cms-item.is-hidden .sonde-cms-status{background:#e5e7eb;color:#667085;}',
      '.sonde-cms-order-title{flex:1;min-width:0;color:#283448;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sonde-cms-order-question{margin:7px 0 0;color:#667085;font-size:12px;line-height:1.4;}',
      '.sonde-cms-item-body.sonde-cms-order-body{display:block;}',
      '.sonde-cms-options-hidden{display:none!important;}',
      '.sonde-cms-layout-select{box-sizing:border-box;width:100%;min-height:48px;padding:12px 16px;border:1px solid #d5d9e0;border-radius:6px;background:#fff;color:#263246;font:inherit;}',
      '.sonde-cms-layout-select:focus-visible{outline:2px solid #ff7900;outline-offset:1px;}',
      '@media(max-width:1200px){.sonde-cms-editor{grid-template-columns:1fr}.sonde-cms-preview-grid.is-grid{grid-template-columns:1fr}}',
      '@media(max-width:540px){.sonde-cms-item-head{flex-wrap:wrap}.sonde-cms-item-controls{margin-left:auto}.sonde-cms-item-body{grid-template-columns:1fr}.sonde-cms-item-body label:first-child{grid-column:auto}}'
    ].join('');
    document.head.appendChild(style);
  }

  function updatePollOptionsVisibility() {
    if (!/^#\/collections\/sondages\/entries\//.test(global.location.hash)) return;
    var widget = document.querySelector('.sonde-cms-option-list');
    if (!widget) return;
    var label = Array.prototype.slice.call(document.querySelectorAll('label')).find(function (candidate) {
      return /^réponses proposées/i.test(String(candidate.textContent || '').trim());
    });

    var field = label;
    while (field && !field.contains(widget)) field = field.parentElement;
    if (!field) field = widget.closest('.sonde-cms-editor');
    if (!field) return;

    var layoutSelect = document.querySelector('[data-sonde-layout]');
    if (!layoutSelect) return;
    field.classList.toggle('sonde-cms-options-hidden', layoutSelect.value === 'scale' || layoutSelect.value === 'dichotomous');
  }

  function installPollOptionsVisibility() {
    if (global.__SONDE_POLL_OPTIONS_VISIBILITY_INSTALLED) return;
    global.__SONDE_POLL_OPTIONS_VISIBILITY_INSTALLED = true;
    var queued = false;
    function scheduleUpdate() {
      if (queued) return;
      queued = true;
      global.setTimeout(function () {
        queued = false;
        updatePollOptionsVisibility();
      }, 0);
    }
    new MutationObserver(scheduleUpdate).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
    document.addEventListener('change', scheduleUpdate, true);
    global.addEventListener('hashchange', scheduleUpdate);
    scheduleUpdate();
  }

  function updatePollListStatuses() {
    if (!/^#\/collections\/sondages(?:\?|$)/.test(global.location.hash)) return;
    var links = Array.prototype.slice.call(document.querySelectorAll('a[href^="#/collections/sondages/entries/"]'));
    if (!links.length) return;

    function sortPollEntries(bySlug) {
      if (links.length < 2) return;
      var container = links[0].parentElement;
      while (container && !links.every(function (link) { return container.contains(link); })) {
        container = container.parentElement;
      }
      if (!container) return;

      var items = links.map(function (link) {
        var item = link;
        while (item.parentElement && item.parentElement !== container) item = item.parentElement;
        return item;
      });
      if (items.some(function (item, index) { return items.indexOf(item) !== index; })) return;

      var ranked = items.map(function (item, index) {
        var match = links[index].getAttribute('href').match(/^#\/collections\/sondages\/entries\/([^/?]+)/);
        var slug = match ? match[1] : '';
        if (match) {
          try {
            slug = decodeURIComponent(match[1]);
          } catch (error) {
            console.error('[sondage-admin] Could not decode poll slug:', error);
          }
        }
        var status = pollStatusInfo(bySlug[slug]);
        return {
          item: item,
          rank: status.tone === 'active' ? 0 : status.tone === 'closed' ? 2 : 1,
          index: index
        };
      }).sort(function (a, b) {
        return a.rank - b.rank || a.index - b.index;
      });
      if (ranked.every(function (entry, index) { return entry.item === items[index]; })) return;

      var reference = items[items.length - 1].nextSibling;
      var fragment = document.createDocumentFragment();
      ranked.forEach(function (entry) { fragment.appendChild(entry.item); });
      container.insertBefore(fragment, reference);
    }

    function renderStatuses(polls, unavailable) {
      var bySlug = Object.create(null);
      (polls || []).forEach(function (poll) {
        bySlug[poll.slug] = poll;
      });
      links.forEach(function (link) {
        var match = link.getAttribute('href').match(/^#\/collections\/sondages\/entries\/([^/?]+)/);
        if (!match) return;
        var slug;
        try {
          slug = decodeURIComponent(match[1]);
        } catch (error) {
          slug = match[1];
        }
        var poll = bySlug[slug];
        var status = poll ? pollStatusInfo(poll) : {
          label: unavailable ? 'Statut indisponible' : 'Statut en chargement',
          detail: unavailable ? 'Impossible de récupérer le statut du sondage.' : 'Chargement du statut…',
          tone: unavailable ? 'unavailable' : 'pending'
        };
        var title = link.querySelector('h2');
        if (!title) return;
        title.classList.add('sonde-cms-poll-list-title');
        var badge = title.querySelector('.sonde-cms-list-status');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'sonde-cms-list-status';
          badge.setAttribute('role', 'status');
          title.appendChild(badge);
        }
        var className = 'sonde-cms-list-status is-' + status.tone;
        if (badge.className !== className) badge.className = className;
        if (badge.textContent !== status.label) badge.textContent = status.label;
        if (badge.title !== status.detail) badge.title = status.detail;
      });
      if (polls) sortPollEntries(bySlug);
    }

    if (global.__SONDE_POLL_LIST_STATUSES) {
      renderStatuses(global.__SONDE_POLL_LIST_STATUSES, false);
      return;
    }
    if (global.__SONDE_POLL_LIST_STATUSES_ERROR) {
      renderStatuses(null, true);
      return;
    }
    renderStatuses(null, false);
    if (global.__SONDE_POLL_LIST_STATUSES_LOADING) return;
    global.__SONDE_POLL_LIST_STATUSES_LOADING = true;
    fetchPolls().then(function (polls) {
      global.__SONDE_POLL_LIST_STATUSES = polls;
      global.__SONDE_POLL_LIST_STATUSES_LOADING = false;
      updatePollListStatuses();
    }).catch(function () {
      global.__SONDE_POLL_LIST_STATUSES_ERROR = true;
      global.__SONDE_POLL_LIST_STATUSES_LOADING = false;
      updatePollListStatuses();
    });
  }

  function installPollListStatuses() {
    if (global.__SONDE_POLL_LIST_STATUSES_INSTALLED) return;
    global.__SONDE_POLL_LIST_STATUSES_INSTALLED = true;
    var queued = false;
    function scheduleUpdate() {
      if (queued) return;
      queued = true;
      global.setTimeout(function () {
        queued = false;
        updatePollListStatuses();
      }, 0);
    }
    new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true });
    global.addEventListener('hashchange', scheduleUpdate);
    scheduleUpdate();
  }

  function register() {
    if (!global.CMS || !global.createClass || !global.h || global.__SONDE_ADMIN_EDITORS) return;
    global.__SONDE_ADMIN_EDITORS = true;
    ensureStyles();
    installPollListStatuses();
    installPollOptionsVisibility();
    var h = global.h;

    var LayoutControl = global.createClass({
      render: function () {
        var options = toPlain(fieldValue(this.props.field, 'options'));
        var value = String(toPlain(this.props.value) || fieldValue(this.props.field, 'default') || '');
        var self = this;
        return h('select', {
          id: this.props.forID,
          className: 'sonde-cms-layout-select',
          'data-sonde-layout': 'true',
          value: value,
          onChange: function (event) {
            self.props.onChange(event.target.value);
            global.setTimeout(updatePollOptionsVisibility, 0);
          }
        }, (Array.isArray(options) ? options : []).map(function (option, index) {
          option = toPlain(option) || {};
          return h('option', { key: option.value || index, value: option.value }, option.label);
        }));
      }
    });

    var OptionsControl = global.createClass({
      getInitialState: function () {
        return { expanded: 0, dragIndex: -1 };
      },

      currentOptions: function () {
        return normalizeOptions(this.props.value);
      },

      updateOption: function (index, patch) {
        var options = this.currentOptions();
        options[index] = Object.assign({}, options[index], patch);
        this.props.onChange(options);
      },

      moveOption: function (index, target) {
        var options = this.currentOptions();
        if (target < 0 || target >= options.length || target === index) return;
        var moved = options.splice(index, 1)[0];
        options.splice(target, 0, moved);
        this.setState({ expanded: target, dragIndex: -1 });
        this.props.onChange(options);
      },

      addOption: function () {
        var options = this.currentOptions();
        var used = options.map(function (option) { return option.id; });
        var next = 1;
        while (used.indexOf('option-' + next) !== -1) next++;
        options.push({ id: 'option-' + next, label: '', label_en: '' });
        this.setState({ expanded: options.length - 1 });
        this.props.onChange(options);
      },

      removeOption: function (index) {
        var options = this.currentOptions();
        if (options.length <= 2) return;
        options.splice(index, 1);
        this.setState({ expanded: Math.max(0, Math.min(index, options.length - 1)) });
        this.props.onChange(options);
      },

      render: function () {
        var options = this.currentOptions();
        var self = this;
        var ids = Object.create(null);
        var errors = [];
        options.forEach(function (option, index) {
          if (!option.id.trim()) errors.push('La réponse ' + (index + 1) + ' doit avoir un identifiant stable.');
          else if (ids[option.id]) errors.push('L’identifiant « ' + option.id + ' » est utilisé plusieurs fois.');
          ids[option.id] = true;
          if (!option.label.trim()) errors.push('Le texte français de la réponse ' + (index + 1) + ' est requis.');
        });
        if (options.length < 2) errors.push('Ajoute au moins deux réponses.');

        return h('div', { className: 'sonde-cms-editor' },
          h('section', { className: 'sonde-cms-section' },
            h('div', { className: 'sonde-cms-section-head' },
              h('h3', {}, options.length + (options.length === 1 ? ' réponse proposée' : ' réponses proposées')),
              h('button', { type: 'button', onClick: function () { self.addOption(); } }, 'Ajouter une réponse  +')
            ),
            h('div', { className: 'sonde-cms-option-list' },
              options.map(function (option, index) {
                var expanded = self.state.expanded === index;
                var title = option.label.trim() || ('Réponse ' + (index + 1));
                return h('section', {
                  key: option.id + '-' + index,
                  className: 'sonde-cms-item',
                  onDragOver: function (event) { event.preventDefault(); },
                  onDrop: function (event) {
                    event.preventDefault();
                    if (self.state.dragIndex >= 0) self.moveOption(self.state.dragIndex, index);
                  }
                },
                  h('div', { className: 'sonde-cms-item-head' },
                    h('span', {
                      className: 'sonde-cms-grip',
                      draggable: true,
                      title: 'Glisser pour déplacer',
                      'aria-label': 'Poignée de déplacement de la réponse ' + (index + 1),
                      onDragStart: function (event) {
                        self.setState({ dragIndex: index });
                        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                      },
                      onDragEnd: function () { self.setState({ dragIndex: -1 }); }
                    }, '≡'),
                    h('button', {
                      type: 'button',
                      'aria-expanded': expanded,
                      onClick: function () { self.setState({ expanded: expanded ? -1 : index }); }
                    }, (expanded ? '▾ ' : '▸ ') + title),
                    h('div', { className: 'sonde-cms-item-controls' },
                      h('button', { type: 'button', disabled: index === 0, 'aria-label': 'Monter la réponse ' + (index + 1), onClick: function () { self.moveOption(index, index - 1); } }, '↑'),
                      h('button', { type: 'button', disabled: index === options.length - 1, 'aria-label': 'Descendre la réponse ' + (index + 1), onClick: function () { self.moveOption(index, index + 1); } }, '↓'),
                      h('button', { type: 'button', disabled: options.length <= 2, 'aria-label': 'Supprimer la réponse ' + (index + 1), onClick: function () { self.removeOption(index); } }, '×')
                    )
                  ),
                  expanded && h('div', { className: 'sonde-cms-item-body' },
                    h('label', {}, 'Identifiant stable',
                      h('input', {
                        type: 'text',
                        value: option.id,
                        onChange: function (event) { self.updateOption(index, { id: event.target.value.trim() }); }
                      })
                    ),
                    h('label', {}, 'Texte de la réponse (FR)',
                      h('input', {
                        type: 'text',
                        value: option.label,
                        onChange: function (event) { self.updateOption(index, { label: event.target.value }); }
                      })
                    ),
                    h('label', {}, 'Texte de la réponse (EN)',
                      h('input', {
                        type: 'text',
                        value: option.label_en,
                        onChange: function (event) { self.updateOption(index, { label_en: event.target.value }); }
                      })
                    )
                  )
                );
              })
            ),
            errors.length
              ? h('p', { className: 'sonde-cms-error', role: 'alert' }, errors.join(' '))
              : h('p', { className: 'sonde-cms-note' }, 'Les identifiants doivent rester uniques et ne pas changer après la publication du sondage.')
          )
        );
      }
    });

    var OrderControl = global.createClass({
      getInitialState: function () {
        return { polls: [], loading: true, error: '' };
      },

      componentDidMount: function () {
        var localPolls = pollsFromCmsStore();
        fetchPolls().then(function (polls) {
          this.setState({ polls: mergePolls(polls), loading: false, error: '' });
        }.bind(this)).catch(function (error) {
          this.setState({
            polls: mergePolls(localPolls).map(function (poll) {
              return Object.assign({}, poll, { lifecycleAvailable: false });
            }),
            loading: false,
            error: 'Impossible de charger les sondages : ' + (error && error.message ? error.message : 'erreur inconnue')
          });
        }.bind(this));
      },

      currentOrder: function () {
        var value = toPlain(this.props.value);
        var order = Array.isArray(value) ? value.filter(function (slug) { return typeof slug === 'string'; }) : [];
        return orderedPolls(this.state.polls, order);
      },

      emitOrder: function (polls) {
        this.props.onChange(polls.map(function (poll) { return poll.slug; }));
      },

      movePoll: function (index, target) {
        var polls = this.currentOrder();
        if (target < 0 || target >= polls.length || target === index) return;
        if (polls[index].isVisible !== polls[target].isVisible) return;
        var moved = polls.splice(index, 1)[0];
        polls.splice(target, 0, moved);
        this.emitOrder(polls);
      },

      render: function () {
        var polls = this.currentOrder();
        var self = this;
        var list = polls.map(function (poll, index) {
          var hidden = !poll.isVisible;
          var status = pollStatusInfo(poll);
          var canMoveUp = index > 0 && polls[index - 1].isVisible === poll.isVisible;
          var canMoveDown = index < polls.length - 1 && polls[index + 1].isVisible === poll.isVisible;
          return h('section', { key: poll.slug, className: 'sonde-cms-item' + (hidden ? ' is-hidden' : status.tone === 'active' ? ' is-active' : '') },
            h('div', { className: 'sonde-cms-item-head' },
              h('div', { className: 'sonde-cms-order-title' }, (index + 1) + '. ' + (poll.title || 'Sondage sans titre')),
              h('div', { className: 'sonde-cms-item-controls' },
                h('button', { type: 'button', disabled: !canMoveUp, 'aria-label': 'Monter ' + poll.title, onClick: function () { self.movePoll(index, index - 1); } }, '↑'),
                h('button', { type: 'button', disabled: !canMoveDown, 'aria-label': 'Descendre ' + poll.title, onClick: function () { self.movePoll(index, index + 1); } }, '↓')
              )
            ),
            h('div', { className: 'sonde-cms-item-body sonde-cms-order-body' },
              h('p', { className: 'sonde-cms-order-question' }, poll.question || 'Question non renseignée'),
              h('p', { className: 'sonde-cms-status is-' + status.tone }, status.label),
              h('p', { className: 'sonde-cms-status-detail' }, status.detail)
            )
          );
        });
        var listContent = list.length
          ? h('div', { className: 'sonde-cms-order-list' }, list)
          : h('p', { className: 'sonde-cms-note' }, this.state.loading
            ? 'Chargement des sondages…'
            : this.state.polls.length
              ? 'Tous les sondages sont terminés. Crée ou publie un nouveau sondage pour définir son ordre.'
              : 'Aucun sondage trouvé. Crée un sondage avant de définir son ordre.');
        return h('div', { className: 'sonde-cms-editor' },
          h('section', { className: 'sonde-cms-section' },
            h('div', { className: 'sonde-cms-section-head' },
              h('h3', {}, 'Ordre des sondages'),
              h('span', { className: 'sonde-cms-note' }, polls.length + ' sondage' + (polls.length === 1 ? '' : 's'))
            ),
            h('p', { className: 'sonde-cms-note' }, 'Les sondages terminés sont retirés automatiquement de cette liste. Les sondages masqués restent disponibles en bas.'),
            listContent
          )
        );
      },
    });

    var PollPreview = global.createClass({
      getInitialState: function () {
        return { polls: [], loading: true, error: '' };
      },

      componentDidMount: function () {
        fetchPolls().then(function (polls) {
          this.setState({ polls: mergePolls(polls), loading: false });
        }.bind(this)).catch(function (error) {
          this.setState({
            polls: mergePolls(pollsFromCmsStore()),
            loading: false,
            error: error && error.message ? error.message : 'Impossible de charger le statut du sondage.'
          });
        }.bind(this));
      },

      render: function () {
        var entry = this.props.entry;
        var slug = String(entry && entry.get ? entry.get('slug') || '' : '');
        var poll = {
          slug: slug,
          layout: String(entryValue(entry, 'layout') || 'single_choice'),
          title: String(entryValue(entry, 'title') || ''),
          title_en: String(entryValue(entry, 'title_en') || ''),
          question: String(entryValue(entry, 'question') || ''),
          question_en: String(entryValue(entry, 'question_en') || ''),
          isVisible: entryValue(entry, 'isVisible') === true || entryValue(entry, 'isVisible') === 'true',
          options: normalizeOptions(entryValue(entry, 'options'))
        };
        var savedPoll = this.state.polls.find(function (item) { return item.slug === slug; });
        var status = this.state.error
          ? pollStatusInfo(Object.assign({}, savedPoll || poll, { lifecycleAvailable: false }))
          : pollStatusInfo(savedPoll);
        return h('div', { className: 'sonde-cms-preview' },
          h('style', {}, CMS_PREVIEW_STYLES),
          h('h3', {}, 'Aperçu du sondage'),
          h('div', { className: 'sonde-cms-lifecycle' },
            h('span', { className: 'sonde-cms-lifecycle-badge is-' + status.tone }, status.label),
            h('span', { className: 'sonde-cms-lifecycle-detail' }, status.detail)
          ),
          this.state.loading ? h('p', { className: 'sonde-cms-note' }, 'Vérification du statut…') : null,
          h('div', { className: 'sonde-cms-preview-grid' },
            renderPollCard(h, poll, 'fr', 'poll-preview-fr'),
            renderPollCard(h, poll, 'en', 'poll-preview-en')
          )
        );
      }
    });

    var OrderPreview = global.createClass({
      getInitialState: function () {
        return { polls: [], loading: true, error: '' };
      },

      componentDidMount: function () {
        fetchPolls().then(function (polls) {
          this.setState({ polls: mergePolls(polls), loading: false });
        }.bind(this)).catch(function (error) {
          this.setState({
            polls: mergePolls(pollsFromCmsStore()).map(function (poll) {
              return Object.assign({}, poll, { lifecycleAvailable: false });
            }),
            loading: false,
            error: error && error.message ? error.message : 'Impossible de charger les sondages.'
          });
        }.bind(this));
      },

      render: function () {
        var polls = orderedPolls(this.state.polls, entryValue(this.props.entry, 'order'));
        var visible = polls.filter(function (poll) { return poll.isVisible; });
        var children = [
          h('h3', {}, 'Aperçu de la mosaïque publique'),
          h('p', { className: 'sonde-cms-note' }, 'Les sondages terminés sont exclus. Les sondages masqués ne sont pas affichés sur le site.')
        ];
        if (visible.length) {
          children.push(h('div', { className: 'sonde-cms-preview-grid is-grid' },
            visible.map(function (poll) { return renderPollCard(h, poll, 'fr', poll.slug); })
          ));
        } else {
          children.push(h('p', { className: 'sonde-cms-note' }, 'Aucun sondage visible.'));
        }
        if (this.state.loading) children.push(h('p', { className: 'sonde-cms-note' }, 'Chargement des sondages…'));
        if (this.state.error) children.push(h('p', { className: 'sonde-cms-error', role: 'alert' }, this.state.error));
        children.unshift(h('style', {}, CMS_PREVIEW_STYLES));
        return h('div', { className: 'sonde-cms-preview' }, children);
      }
    });

    global.CMS.registerWidget('sondage-layout-select', LayoutControl);
    global.CMS.registerWidget('sondage-options-editor', OptionsControl);
    global.CMS.registerWidget('sondage-order-editor', OrderControl);
    global.CMS.registerPreviewTemplate('sondages', PollPreview);
    global.CMS.registerPreviewTemplate('sondages_order', OrderPreview);
    global.CMS.registerPreviewTemplate('sondages-order', OrderPreview);
  }

  register();
  if (!global.__SONDE_ADMIN_EDITORS && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  }
})(window);
