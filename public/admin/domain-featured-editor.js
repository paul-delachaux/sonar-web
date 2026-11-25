(function (global) {
  var DEFAULT_ROW = {
    article: '',
    titleSize: '1.2rem',
    titleWeight: '700',
    descSize: '0.8rem',
    overlay_opacity: 75
  };
  var MAX_ROWS = 3;

  function toPlain(value) {
    return value && typeof value.toJS === 'function' ? value.toJS() : value;
  }

  function getPath(entry, path) {
    if (entry && typeof entry.getIn === 'function') return toPlain(entry.getIn(path));
    var value = toPlain(entry);
    for (var i = 0; value && i < path.length; i++) value = value[path[i]];
    return value;
  }

  function fieldValue(field, name) {
    if (!field) return '';
    return toPlain(typeof field.get === 'function' ? field.get(name) : field[name]);
  }

  function slugFrom(value) {
    var plain = toPlain(value);
    if (typeof plain === 'string') return plain;
    if (!plain || typeof plain !== 'object') return '';
    return String(plain.value || plain.slug || plain.article || '');
  }

  function normalizeRow(row) {
    row = toPlain(row);
    row = row && typeof row === 'object' ? row : {};
    return {
      article: slugFrom(row.article),
      titleSize: row.titleSize == null || row.titleSize === '' ? DEFAULT_ROW.titleSize : String(row.titleSize),
      titleWeight: row.titleWeight == null || row.titleWeight === '' ? DEFAULT_ROW.titleWeight : String(row.titleWeight),
      descSize: row.descSize == null || row.descSize === '' ? DEFAULT_ROW.descSize : String(row.descSize),
      overlay_opacity: row.overlay_opacity == null || row.overlay_opacity === ''
        ? DEFAULT_ROW.overlay_opacity
        : row.overlay_opacity
    };
  }

  function rowsFrom(value) {
    var plain = toPlain(value);
    return Array.isArray(plain) ? plain.slice(0, MAX_ROWS).map(normalizeRow) : [];
  }

  function legacyRows(entry, domain) {
    var articles = toPlain(getPath(entry, ['data', domain + '_topArticles']));
    var styles = toPlain(getPath(entry, ['data', domain + '_topStyles']));
    articles = Array.isArray(articles) ? articles : [];
    styles = Array.isArray(styles) ? styles : [];
    var count = Math.min(MAX_ROWS, Math.max(articles.length, styles.length));
    var rows = [];
    for (var i = 0; i < count; i++) {
      rows.push(normalizeRow(Object.assign({}, styles[i] || {}, { article: slugFrom(articles[i]) })));
    }
    return rows;
  }

  function hasStoredValue(entry, fieldName) {
    return getPath(entry, ['data', fieldName]) !== undefined;
  }

  function articleSlug(article) {
    return String((article && (article.slug || article.id)) || '');
  }

  function articleTitle(article) {
    var data = article && article.data;
    return String((article && article.title) || (data && data.title) || articleSlug(article) || 'Article sans titre');
  }

  function belongsToDomain(article, domain) {
    var data = article && article.data ? article.data : article || {};
    if (String(data.category || '') === domain) return true;
    var subs = global.__SONAR_SUBDOMAINS || [];
    return subs.some(function (sub) {
      return sub && sub.slug === data.category && sub.parent === domain;
    });
  }

  function ensureStyle() {
    if (document.getElementById('sonar-domain-featured-editor-style')) return;
    var style = document.createElement('style');
    style.id = 'sonar-domain-featured-editor-style';
    style.textContent = [
      '.sonar-domain-featured-editor{font-family:Helvetica,Arial,sans-serif;color:#253044;}',
      '.sonar-domain-featured-list{display:flex;flex-direction:column;gap:10px;}',
      '.sonar-domain-featured-card{overflow:hidden;border:1px solid #d5d9e0;border-radius:8px;background:#fff;}',
      '.sonar-domain-featured-header{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#f1f3f6;}',
      '.sonar-domain-featured-header button{border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#283448;padding:5px 8px;font-weight:700;cursor:pointer;}',
      '.sonar-domain-featured-header button:hover{border-color:#ff7900;color:#d65f00;}',
      '.sonar-domain-featured-toggle{flex:1;min-width:0;border:0!important;background:transparent!important;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sonar-domain-featured-status{flex:0 0 auto;color:#b42318;font-size:11px;font-weight:700;white-space:nowrap;}',
      '.sonar-domain-featured-controls{display:flex;gap:4px;}',
      '.sonar-domain-featured-body{padding:12px;}',
      '.sonar-domain-featured-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}',
      '.sonar-domain-featured-fields label{display:flex;flex-direction:column;gap:5px;color:#38445a;font-size:12px;font-weight:700;}',
      '.sonar-domain-featured-fields label:first-child{grid-column:1/-1;}',
      '.sonar-domain-featured-fields input,.sonar-domain-featured-fields select{box-sizing:border-box;width:100%;min-width:0;padding:8px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font-size:13px;font-weight:400;}',
      '.sonar-domain-featured-fields input:focus-visible,.sonar-domain-featured-fields select:focus-visible,.sonar-domain-featured-editor button:focus-visible{outline:2px solid #ff7900;outline-offset:1px;}',
      '.sonar-domain-featured-search{margin-bottom:6px;}',
      '.sonar-domain-featured-error{margin:8px 0 0;color:#b42318;font-size:12px;}',
      '.sonar-domain-featured-note{margin:8px 0 0;color:#667085;font-size:12px;}',
      '.sonar-domain-featured-empty{margin:0;padding:16px;border:1px dashed #cbd2dc;border-radius:7px;color:#667085;text-align:center;font-size:13px;}',
      '.sonar-domain-featured-add{margin-top:10px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#283448;padding:7px 10px;font-weight:700;cursor:pointer;}',
      '.sonar-domain-featured-add:hover{border-color:#ff7900;color:#d65f00;}',
      '@media(max-width:600px){.sonar-domain-featured-fields{grid-template-columns:1fr}.sonar-domain-featured-fields label:first-child{grid-column:auto}.sonar-domain-featured-header{flex-wrap:wrap}.sonar-domain-featured-controls{margin-left:auto}}'
    ].join('');
    document.head.appendChild(style);
  }

  function register() {
    if (!global.CMS || !global.createClass || !global.h || global.__SONAR_DOMAIN_FEATURED_EDITOR) return;
    global.__SONAR_DOMAIN_FEATURED_EDITOR = true;
    ensureStyle();
    var h = global.h;

    var Control = global.createClass({
      getInitialState: function () {
        return {
          expandedIndex: null,
          articles: [],
          loading: true,
          error: '',
          search: {},
          edited: false
        };
      },

      componentDidMount: function () {
        var helper = global.SonarArticleSearch;
        if (!helper || typeof helper.fetchArticles !== 'function') {
          this.setState({ loading: false, error: 'Le service de recherche d’articles est indisponible.' });
          return;
        }
        function applyArticles(articles) {
          this.setState({ articles: Array.isArray(articles) ? articles : [], loading: false });
        }
        function showError(error) {
          this.setState({
            loading: false,
            error: 'Impossible de charger les articles : ' + (error && error.message ? error.message : 'erreur inconnue')
          });
        }
        helper.fetchArticles().then(function (articles) {
          applyArticles.call(this, articles);
        }.bind(this)).catch(function (primaryError) {
          var fallback = global.SonarDomainAdminArticles;
          if (!fallback || typeof fallback.fetchArticles !== 'function') {
            showError.call(this, primaryError);
            return;
          }
          fallback.fetchArticles().then(function (articles) {
            applyArticles.call(this, articles);
          }.bind(this)).catch(function (fallbackError) {
            showError.call(this, new Error(
              (primaryError && primaryError.message ? primaryError.message : 'source principale indisponible') +
              ' ; ' +
              (fallbackError && fallbackError.message ? fallbackError.message : 'source de secours indisponible')
            ));
          }.bind(this));
        }.bind(this));
      },

      domain: function () {
        return String(fieldValue(this.props.field, 'domain_slug') || '');
      },

      fieldName: function () {
        return String(fieldValue(this.props.field, 'name') || this.props.forID || '');
      },

      rows: function () {
        var value = toPlain(this.props.value);
        if (this.state.edited || hasStoredValue(this.props.entry, this.fieldName()) || (Array.isArray(value) && value.length)) {
          return rowsFrom(value);
        }
        return legacyRows(this.props.entry, this.domain());
      },

      emitRows: function (rows) {
        this.setState({ edited: true });
        this.props.onChange(rows.slice(0, MAX_ROWS).map(normalizeRow));
      },

      updateRow: function (index, patch) {
        var rows = this.rows().slice();
        rows[index] = Object.assign({}, rows[index] || normalizeRow({}), patch);
        this.emitRows(rows);
      },

      addRow: function () {
        var rows = this.rows().slice();
        if (rows.length >= MAX_ROWS) return;
        rows.push(normalizeRow({}));
        this.setState({ expandedIndex: rows.length - 1 });
        this.emitRows(rows);
      },

      removeRow: function (index) {
        var rows = this.rows().slice();
        rows.splice(index, 1);
        this.setState({
          expandedIndex: this.state.expandedIndex === index
            ? null
            : (this.state.expandedIndex > index ? this.state.expandedIndex - 1 : this.state.expandedIndex)
        });
        this.emitRows(rows);
      },

      moveRow: function (index, delta) {
        var rows = this.rows().slice();
        var target = index + delta;
        if (target < 0 || target >= rows.length) return;
        var moved = rows.splice(index, 1)[0];
        rows.splice(target, 0, moved);
        this.setState({ expandedIndex: target });
        this.emitRows(rows);
      },

      articleOptions: function (rowIndex, term) {
        var domain = this.domain();
        var used = this.rows().map(function (row, index) {
          return index === rowIndex ? '' : row.article;
        });
        var helper = global.SonarArticleSearch;
        var query = helper && typeof helper.compileQuery === 'function' ? helper.compileQuery(term || '') : null;
        return this.state.articles.filter(function (article) {
          var data = article && article.data ? article.data : article || {};
          var slug = articleSlug(article);
          if (!slug || (data.isVisible === false || data.isVisible === 'false')) return false;
          if (!belongsToDomain(article, domain) || used.indexOf(slug) !== -1) return false;
          if (!term) return true;
          if (query && query.ok) {
            if (query.empty) return true;
            if (query.test) return query.test(articleTitle(article)) || query.test(slug);
            return false;
          }
          if (query && !query.ok) return false;
          var haystack = (articleTitle(article) + ' ' + slug).toLocaleLowerCase('fr-FR');
          return haystack.indexOf(String(term).toLocaleLowerCase('fr-FR')) !== -1;
        }).sort(function (a, b) {
          return articleTitle(a).localeCompare(articleTitle(b), 'fr');
        });
      },

      selectedArticle: function (slug) {
        return this.state.articles.find(function (article) { return articleSlug(article) === slug; }) || null;
      },

      renderRow: function (row, index, total) {
        var self = this;
        var expanded = this.state.expandedIndex === index;
        var selected = this.selectedArticle(row.article);
        var title = selected ? articleTitle(selected) : (row.article ? 'Article introuvable : ' + row.article : 'Emplacement vide');
        var query = this.state.search[index] || '';
        var options = this.articleOptions(index, query);
        var hasSelected = Boolean(row.article && !options.some(function (article) { return articleSlug(article) === row.article; }));
        var selectedData = selected && selected.data ? selected.data : selected;
        var selectedHidden = Boolean(selectedData && (selectedData.isVisible === false || selectedData.isVisible === 'false'));
        var selectedUnavailable = Boolean(row.article && (!selected
          || selectedHidden
          || !belongsToDomain(selectedData, this.domain())));
        return h('section', { key: index, className: 'sonar-domain-featured-card' },
          h('div', { className: 'sonar-domain-featured-header' },
            h('button', {
              type: 'button',
              className: 'sonar-domain-featured-toggle',
              'aria-expanded': expanded,
              onClick: function () { self.setState({ expandedIndex: expanded ? null : index }); }
            }, (expanded ? '▾ ' : '▸ ') + 'Article ' + (index + 1) + ' — ' + title),
            selectedUnavailable && h('span', { className: 'sonar-domain-featured-status' }, selectedHidden ? 'Masqué' : 'Indisponible'),
            h('div', { className: 'sonar-domain-featured-controls' },
              h('button', { type: 'button', disabled: index === 0, 'aria-label': 'Monter l’article ' + (index + 1), onClick: function () { self.moveRow(index, -1); } }, '↑'),
              h('button', { type: 'button', disabled: index === total - 1, 'aria-label': 'Descendre l’article ' + (index + 1), onClick: function () { self.moveRow(index, 1); } }, '↓'),
              h('button', { type: 'button', 'aria-label': 'Supprimer l’article ' + (index + 1), onClick: function () { self.removeRow(index); } }, 'Supprimer')
            )
          ),
          expanded && h('div', { className: 'sonar-domain-featured-body' },
            h('div', { className: 'sonar-domain-featured-fields' },
              h('label', {}, 'Article',
                h('input', {
                  className: 'sonar-domain-featured-search',
                  type: 'search',
                  value: query,
                  placeholder: 'Rechercher par titre…',
                  'aria-label': 'Rechercher un article pour l’emplacement ' + (index + 1),
                  onChange: function (event) {
                    var search = Object.assign({}, self.state.search);
                    search[index] = event.target.value;
                    self.setState({ search: search });
                  }
                }),
                h('select', {
                  value: row.article || '',
                  onChange: function (event) { self.updateRow(index, { article: event.target.value }); }
                },
                  h('option', { value: '' }, 'Choisir un article'),
                  hasSelected && h('option', { value: row.article }, title),
                  options.map(function (article) {
                    return h('option', { key: articleSlug(article), value: articleSlug(article) }, articleTitle(article));
                  })
                )
              ),
              h('label', {}, 'Taille du titre',
                h('input', {
                  type: 'text',
                  value: row.titleSize,
                  placeholder: '1.2rem',
                  onChange: function (event) { self.updateRow(index, { titleSize: event.target.value }); }
                })
              ),
              h('label', {}, 'Épaisseur du titre',
                h('select', {
                  value: row.titleWeight,
                  onChange: function (event) { self.updateRow(index, { titleWeight: event.target.value }); }
                },
                  h('option', { value: '300' }, 'Fin (300)'),
                  h('option', { value: '400' }, 'Normal (400)'),
                  h('option', { value: '700' }, 'Gras (700)'),
                  h('option', { value: '900' }, 'Ultra-gras (900)')
                )
              ),
              h('label', {}, 'Taille de la description',
                h('input', {
                  type: 'text',
                  value: row.descSize,
                  placeholder: '0.8rem',
                  onChange: function (event) { self.updateRow(index, { descSize: event.target.value }); }
                })
              ),
              h('label', {}, 'Voile sombre (0–100)',
                h('input', {
                  type: 'number',
                  min: 0,
                  max: 100,
                  value: row.overlay_opacity,
                  onChange: function (event) {
                    var value = event.target.value;
                    self.updateRow(index, { overlay_opacity: value === '' ? '' : Number(value) });
                  }
                })
              )
            ),
            selectedUnavailable && h('p', { className: 'sonar-domain-featured-note' }, 'L’article enregistré est masqué ou n’est pas disponible pour ce domaine ; sur le site, cet emplacement sera remplacé automatiquement.')
          )
        );
      },

      render: function () {
        var self = this;
        var rows = this.rows();
        return h('div', { className: 'sonar-domain-featured-editor' },
          rows.length
            ? h('div', { className: 'sonar-domain-featured-list' }, rows.map(function (row, index) {
                return self.renderRow(row, index, rows.length);
              }))
            : h('p', { className: 'sonar-domain-featured-empty' }, 'Aucun article mis en avant. Les articles récents rempliront ces emplacements sur le site.'),
          this.state.loading && h('p', { className: 'sonar-domain-featured-note' }, 'Chargement des articles…'),
          this.state.error && h('p', { className: 'sonar-domain-featured-error', role: 'alert' }, this.state.error),
          rows.length < MAX_ROWS && h('button', {
            type: 'button',
            className: 'sonar-domain-featured-add',
            onClick: function () { self.addRow(); }
          }, '+ Ajouter un article')
        );
      }
    });

    function Preview(props) {
      var rows = rowsFrom(props.value);
      var fieldName = String(fieldValue(props.field, 'name') || props.forID || '');
      var domain = String(fieldValue(props.field, 'domain_slug') || '');
      if (!rows.length && !hasStoredValue(props.entry, fieldName)) rows = legacyRows(props.entry, domain);
      return h('p', { className: 'sonar-domain-featured-note' },
        rows.length + (rows.length === 1 ? ' article mis en avant' : ' articles mis en avant')
      );
    }

    global.CMS.registerWidget('domain-featured-editor', Control, Preview);
  }

  register();
  if (!global.__SONAR_DOMAIN_FEATURED_EDITOR && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  }
})(window);
