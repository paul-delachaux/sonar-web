(function (global) {
  var FIELD_NAME = 'homepage_featuredArticles';
  var SINGLE_SLOTS = [
    { id: 'hero', label: 'Article à la une', articleField: 'heroArticle' },
    { id: 'sidebar-long', label: 'Article long', articleField: 'sidebarLongArticle' },
    { id: 'asym-right', label: 'Article géant', articleField: 'asymRightArticle', styleField: 'asymRightStyle', style: true, sizeOptions: ['1.5rem', '1.8rem', '2.2rem'] }
  ];
  var ARRAY_SLOTS = [
    {
      id: 'sidebar-small',
      title: 'Petite sidebar',
      field: 'sidebarSmallArticles',
      countField: 'sidebarSmallArticleCount',
      countOptions: ['1', '2'],
      countLabels: ['1 article', '2 articles'],
      max: 2,
      style: false
    },
    {
      id: 'bottom',
      title: 'Rangée du bas',
      field: 'bottomArticles',
      countField: 'bottomArticleCount',
      countOptions: ['1', '2', '3'],
      countLabels: ['1 article', '2 articles', '3 articles'],
      max: 3,
      style: true,
      sizeOptions: ['1rem', '1.2rem', '1.6rem']
    },
    {
      id: 'asym-left',
      title: 'Articles superposés à gauche',
      field: 'asymLeftArticles',
      max: 3,
      style: true,
      sizeOptions: ['1rem', '1.1rem', '1.4rem']
    }
  ];
  var DEFAULT_STYLES = {
    bottomArticles: { titleSize: '1.2rem', titleWeight: '700', titleFont: 'sans-serif', overlay_opacity: 75 },
    asymLeftArticles: { titleSize: '1.1rem', titleWeight: '700', titleFont: 'sans-serif', overlay_opacity: 75 },
    asymRightStyle: { titleSize: '1.8rem', titleWeight: '700', titleFont: 'sans-serif', overlay_opacity: 75 }
  };

  function toPlain(value) {
    return value && typeof value.toJS === 'function' ? value.toJS() : value;
  }

  function getEntryValue(entry, name) {
    if (entry && typeof entry.getIn === 'function') return toPlain(entry.getIn(['data', name]));
    var data = toPlain(entry && entry.data);
    return data && data[name];
  }

  function slugKey(value) {
    return String(value || '')
      .replace(/\.mdx?$/, '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function slugFrom(value) {
    value = toPlain(value);
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    return String(value.article || value.value || value.slug || '');
  }

  function styleValue(style, fallback) {
    style = style && typeof style === 'object' ? style : {};
    fallback = fallback || {};
    return {
      titleSize: style.titleSize || fallback.titleSize,
      titleWeight: String(style.titleWeight || fallback.titleWeight),
      titleFont: style.titleFont || fallback.titleFont,
      overlay_opacity: style.overlay_opacity == null || style.overlay_opacity === ''
        ? fallback.overlay_opacity
        : style.overlay_opacity
    };
  }

  function rowsValue(value, max, defaults, legacyStyles) {
    value = toPlain(value);
    value = Array.isArray(value) ? value : [];
    legacyStyles = Array.isArray(toPlain(legacyStyles)) ? toPlain(legacyStyles) : [];
    var rows = [];
    for (var i = 0; i < max; i++) {
      var source = toPlain(value[i]);
      var row = source && typeof source === 'object' ? source : { article: source };
      var legacyStyle = toPlain(legacyStyles[i]);
      rows.push(Object.assign(
        { article: slugFrom(row.article) },
        styleValue(row, Object.assign({}, defaults, legacyStyle || {}))
      ));
    }
    return rows;
  }

  function normalizeState(value) {
    value = toPlain(value);
    value = value && typeof value === 'object' ? value : {};
    return {
      heroArticle: slugFrom(value.heroArticle),
      sidebarLongArticle: slugFrom(value.sidebarLongArticle),
      sidebarSmallArticleCount: ['1', '2'].indexOf(String(value.sidebarSmallArticleCount)) !== -1
        ? String(value.sidebarSmallArticleCount)
        : '2',
      sidebarSmallArticles: rowsValue(value.sidebarSmallArticles, 2, {}),
      bottomArticleCount: ['1', '2', '3'].indexOf(String(value.bottomArticleCount)) !== -1
        ? String(value.bottomArticleCount)
        : '3',
      bottomArticles: rowsValue(value.bottomArticles, 3, DEFAULT_STYLES.bottomArticles, value.bottomArticlesStyles),
      asymLeftArticles: rowsValue(value.asymLeftArticles, 3, DEFAULT_STYLES.asymLeftArticles, value.asymLeftStyles),
      asymRightArticle: slugFrom(value.asymRightArticle),
      asymRightStyle: styleValue(value.asymRightStyle, DEFAULT_STYLES.asymRightStyle)
    };
  }

  function legacyState(entry) {
    return normalizeState({
      heroArticle: getEntryValue(entry, 'heroArticle'),
      sidebarLongArticle: getEntryValue(entry, 'sidebarLongArticle'),
      sidebarSmallArticleCount: getEntryValue(entry, 'sidebarSmallArticleCount'),
      sidebarSmallArticles: getEntryValue(entry, 'sidebarSmallArticles'),
      bottomArticleCount: getEntryValue(entry, 'bottomArticleCount'),
      bottomArticles: getEntryValue(entry, 'bottomArticles'),
      bottomArticlesStyles: getEntryValue(entry, 'bottomArticlesStyles'),
      asymLeftArticles: getEntryValue(entry, 'asymLeftArticles'),
      asymLeftStyles: getEntryValue(entry, 'asymLeftStyles'),
      asymRightArticle: getEntryValue(entry, 'asymRightArticle'),
      asymRightStyle: getEntryValue(entry, 'asymRightStyle')
    });
  }

  function articleSlug(article) {
    return String((article && (article.slug || article.id)) || '');
  }

  function articleData(article) {
    return article && article.data ? article.data : article || {};
  }

  function articleTitle(article) {
    var data = articleData(article);
    return String(data.title || articleSlug(article) || 'Article sans titre');
  }

  function ensureStyle() {
    if (document.getElementById('sonar-homepage-featured-editor-style')) return;
    var style = document.createElement('style');
    style.id = 'sonar-homepage-featured-editor-style';
    style.textContent = [
      '.sonar-homepage-editor{font-family:Helvetica,Arial,sans-serif;color:#253044;}',
      '.sonar-homepage-section{margin:0 0 16px;padding:12px;border:1px solid #d5d9e0;border-radius:8px;background:#f8f9fb;}',
      '.sonar-homepage-section h3{margin:0 0 9px;color:#293548;font-size:14px;}',
      '.sonar-homepage-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px;}',
      '.sonar-homepage-section-head h3{margin:0;}',
      '.sonar-homepage-count{display:flex;align-items:center;gap:7px;color:#38445a;font-size:12px;font-weight:700;}',
      '.sonar-homepage-count select{padding:6px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;}',
      '.sonar-homepage-list{display:flex;flex-direction:column;gap:8px;}',
      '.sonar-homepage-card{overflow:hidden;border:1px solid #d5d9e0;border-radius:7px;background:#fff;}',
      '.sonar-homepage-card-head{display:flex;align-items:center;gap:7px;padding:8px 10px;background:#f1f3f6;}',
      '.sonar-homepage-card button{border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#283448;padding:5px 8px;font-weight:700;cursor:pointer;}',
      '.sonar-homepage-card button:hover{border-color:#ff7900;color:#d65f00;}',
      '.sonar-homepage-toggle{flex:1;min-width:0;border:0!important;background:transparent!important;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sonar-homepage-status{flex:0 0 auto;color:#b42318;font-size:11px;font-weight:700;white-space:nowrap;}',
      '.sonar-homepage-card-controls{display:flex;gap:4px;}',
      '.sonar-homepage-card-body{padding:11px;}',
      '.sonar-homepage-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;}',
      '.sonar-homepage-fields label{display:flex;flex-direction:column;gap:5px;color:#38445a;font-size:12px;font-weight:700;}',
      '.sonar-homepage-fields label:first-child{grid-column:1/-1;}',
      '.sonar-homepage-fields input,.sonar-homepage-fields select{box-sizing:border-box;width:100%;min-width:0;padding:7px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font-size:13px;font-weight:400;}',
      '.sonar-homepage-editor button:focus-visible,.sonar-homepage-editor input:focus-visible,.sonar-homepage-editor select:focus-visible{outline:2px solid #ff7900;outline-offset:1px;}',
      '.sonar-homepage-search{margin-bottom:5px;}',
      '.sonar-homepage-note{margin:8px 0 0;color:#667085;font-size:12px;}',
      '.sonar-homepage-error{margin:8px 0 0;color:#b42318;font-size:12px;}',
      '.sonar-homepage-inactive{opacity:.7;}',
      '@media(max-width:600px){.sonar-homepage-fields{grid-template-columns:1fr}.sonar-homepage-fields label:first-child{grid-column:auto}.sonar-homepage-section-head{align-items:flex-start;flex-direction:column}.sonar-homepage-card-head{flex-wrap:wrap}.sonar-homepage-card-controls{margin-left:auto}}'
    ].join('');
    document.head.appendChild(style);
  }

  function register() {
    if (!global.CMS || !global.createClass || !global.h || global.__SONAR_HOMEPAGE_FEATURED_EDITOR) return;
    global.__SONAR_HOMEPAGE_FEATURED_EDITOR = true;
    ensureStyle();
    var h = global.h;

    var Control = global.createClass({
      getInitialState: function () {
        return { expanded: '', articles: [], loading: true, error: '', search: {}, draft: null };
      },

      componentDidMount: function () {
        var helper = global.SonarArticleSearch;
        if (!helper || typeof helper.fetchArticles !== 'function') {
          this.setState({ loading: false, error: 'Le service de recherche d’articles est indisponible.' });
          return;
        }
        helper.fetchArticles().then(function (articles) {
          this.setState({ articles: Array.isArray(articles) ? articles : [], loading: false });
        }.bind(this)).catch(function (error) {
          this.setState({
            loading: false,
            error: 'Impossible de charger les articles : ' + (error && error.message ? error.message : 'erreur inconnue')
          });
        }.bind(this));
      },

      currentValue: function () {
        if (this.state.draft) return this.state.draft;
        var stored = toPlain(this.props.value);
        if (stored && typeof stored === 'object' && Object.keys(stored).length) return normalizeState(stored);
        stored = toPlain(getEntryValue(this.props.entry, FIELD_NAME));
        if (stored && typeof stored === 'object' && Object.keys(stored).length) return normalizeState(stored);
        return legacyState(this.props.entry);
      },

      emit: function (value) {
        var next = normalizeState(value);
        this.setState({ draft: next });
        this.props.onChange(next);
      },

      updateSingle: function (field, patch) {
        var value = this.currentValue();
        if (patch.article !== undefined) value[field] = patch.article;
        if (patch.styleField) value[patch.styleField] = styleValue(
          Object.assign({}, value[patch.styleField] || {}, patch.style || {}),
          DEFAULT_STYLES[patch.styleField]
        );
        this.emit(value);
      },

      updateRow: function (field, index, patch) {
        var value = this.currentValue();
        var rows = value[field].slice();
        rows[index] = Object.assign({}, rows[index], patch);
        value[field] = rows;
        this.emit(value);
      },

      moveRow: function (field, index, delta, id) {
        var value = this.currentValue();
        var rows = value[field].slice();
        var target = index + delta;
        if (target < 0 || target >= rows.length) return;
        var moved = rows.splice(index, 1)[0];
        rows.splice(target, 0, moved);
        value[field] = rows;
        this.setState({ expanded: id.replace(/-\d+$/, '-' + target) });
        this.emit(value);
      },

      countSelected: function (value) {
        var current = this.currentValue();
        var used = [];
        function add(slot) {
          var slug = slugFrom(slot);
          if (slug) used.push(slugKey(slug));
        }
        add(current.heroArticle);
        add(current.sidebarLongArticle);
        current.sidebarSmallArticles.forEach(add);
        current.bottomArticles.forEach(add);
        current.asymLeftArticles.forEach(add);
        add(current.asymRightArticle);
        return used.filter(function (key) { return key === slugKey(value); }).length;
      },

      selectedArticle: function (slug) {
        var key = slugKey(slug);
        return this.state.articles.find(function (article) {
          return slugKey(articleSlug(article)) === key;
        }) || null;
      },

      articleOptions: function (row, query) {
        var helper = global.SonarArticleSearch;
        var compiled = helper && typeof helper.compileQuery === 'function'
          ? helper.compileQuery(query || '')
          : null;
        var currentSlug = row.value.article;
        var self = this;
        return this.state.articles.filter(function (article) {
          var data = articleData(article);
          var slug = articleSlug(article);
          if (!slug || data.isVisible === false || data.isVisible === 'false') return false;
          if (self.countSelected(slug) > (slugKey(currentSlug) === slugKey(slug) ? 1 : 0)) return false;
          if (!query) return true;
          if (compiled && !compiled.ok) return false;
          if (compiled && compiled.test) return compiled.test(articleTitle(article)) || compiled.test(slug);
          return (articleTitle(article) + ' ' + slug).toLocaleLowerCase('fr-FR')
            .indexOf(String(query).toLocaleLowerCase('fr-FR')) !== -1;
        }).sort(function (a, b) {
          return articleTitle(a).localeCompare(articleTitle(b), 'fr');
        });
      },

      setArticle: function (row, slug) {
        if (row.arrayField) this.updateRow(row.arrayField, row.index, { article: slug });
        else this.updateSingle(row.articleField, {
          article: slug,
          styleField: row.styleField,
          style: row.styleField ? row.value : null
        });
      },

      updateStyle: function (row, name, value) {
        if (row.arrayField) this.updateRow(row.arrayField, row.index, (function () {
          var patch = {};
          patch[name] = value;
          return patch;
        })());
        else this.updateSingle(row.articleField, {
          styleField: row.styleField,
          style: (function () {
            var patch = {};
            patch[name] = value;
            return patch;
          })()
        });
      },

      makeRow: function (definition, index, value) {
        var row = Object.assign({}, definition, { index: index, value: value });
        row.id = definition.id + (definition.arrayField ? '-' + index : '');
        return row;
      },

      currentRows: function () {
        var value = this.currentValue();
        var rows = [
          this.makeRow({ id: 'hero', label: 'À la une', articleField: 'heroArticle' }, 0, { article: value.heroArticle }),
          this.makeRow({ id: 'sidebar-long', label: 'Article long', articleField: 'sidebarLongArticle' }, 0, { article: value.sidebarLongArticle })
        ];
        ARRAY_SLOTS.forEach(function (group) {
          value[group.field].forEach(function (item, index) {
            rows.push(this.makeRow({
              id: group.id,
              label: group.title + ' — ' + (index + 1),
              articleField: group.field,
              arrayField: group.field,
              countField: group.countField,
              style: group.style,
              sizeOptions: group.sizeOptions
            }, index, item));
          }, this);
        }, this);
        rows.push(this.makeRow({
          id: 'asym-right',
          label: 'Article géant',
          articleField: 'asymRightArticle',
          styleField: 'asymRightStyle',
          style: true,
          sizeOptions: SINGLE_SLOTS[2].sizeOptions
        }, 0, Object.assign({ article: value.asymRightArticle }, value.asymRightStyle)));
        return rows;
      },

      renderStyleFields: function (row) {
        var self = this;
        if (!row.style) return null;
        return h('div', { className: 'sonar-homepage-fields sonar-homepage-style-fields' },
          h('label', {}, 'Taille du titre',
            h('select', {
              value: row.value.titleSize,
              onChange: function (event) { self.updateStyle(row, 'titleSize', event.target.value); }
            },
              row.sizeOptions.map(function (size) {
                return h('option', { key: size, value: size }, size);
              })
            )
          ),
          h('label', {}, 'Épaisseur du titre',
            h('select', {
              value: row.value.titleWeight,
              onChange: function (event) { self.updateStyle(row, 'titleWeight', event.target.value); }
            },
              h('option', { value: '300' }, 'Fin (300)'),
              h('option', { value: '400' }, 'Normal (400)'),
              h('option', { value: '700' }, 'Gras (700)'),
              h('option', { value: '900' }, 'Ultra-gras (900)')
            )
          ),
          h('label', {}, 'Style de police',
            h('select', {
              value: row.value.titleFont,
              onChange: function (event) { self.updateStyle(row, 'titleFont', event.target.value); }
            },
              h('option', { value: 'sans-serif' }, 'Moderne (Sans-Serif)'),
              h('option', { value: 'serif' }, 'Journal (Serif)'),
              h('option', { value: 'monospace' }, 'Code (Monospace)')
            )
          ),
          h('label', {}, 'Voile sombre (0–100)',
            h('input', {
              type: 'number',
              min: 0,
              max: 100,
              value: row.value.overlay_opacity,
              onChange: function (event) {
                var raw = event.target.value;
                self.updateStyle(row, 'overlay_opacity', raw === '' ? '' : Number(raw));
              }
            })
          )
        );
      },

      renderRow: function (row, totalInGroup) {
        var self = this;
        var expanded = this.state.expanded === row.id;
        var selected = this.selectedArticle(row.value.article);
        var title = selected ? articleTitle(selected) : (row.value.article ? 'Article introuvable : ' + row.value.article : 'Emplacement vide');
        var selectedData = selected && articleData(selected);
        var hidden = Boolean(selectedData && (selectedData.isVisible === false || selectedData.isVisible === 'false'));
        var unavailable = Boolean(row.value.article && (!selected || hidden));
        var duplicates = row.value.article && this.countSelected(row.value.article) > 1;
        var inactive = row.countField && Number(row.index + 1) > Number(this.currentValue()[row.countField]);
        var query = this.state.search[row.id] || '';
        var options = this.articleOptions(row, query);
        var hasSelected = Boolean(row.value.article && !options.some(function (article) {
          return slugKey(articleSlug(article)) === slugKey(row.value.article);
        }));
        return h('section', { key: row.id, className: 'sonar-homepage-card' + (inactive ? ' sonar-homepage-inactive' : '') },
          h('div', { className: 'sonar-homepage-card-head' },
            h('button', {
              type: 'button',
              className: 'sonar-homepage-toggle',
              'aria-expanded': expanded,
              onClick: function () { self.setState({ expanded: expanded ? '' : row.id }); }
            }, (expanded ? '▾ ' : '▸ ') + row.label + ' — ' + title),
            inactive && h('span', { className: 'sonar-homepage-status' }, 'Non affiché'),
            hidden && h('span', { className: 'sonar-homepage-status' }, 'Masqué'),
            duplicates && h('span', { className: 'sonar-homepage-status' }, 'Doublon'),
            h('div', { className: 'sonar-homepage-card-controls' },
              row.arrayField && h('button', {
                type: 'button',
                disabled: row.index === 0,
                'aria-label': 'Monter ' + row.label,
                onClick: function () { self.moveRow(row.arrayField, row.index, -1, row.id); }
              }, '↑'),
              row.arrayField && h('button', {
                type: 'button',
                disabled: row.index >= totalInGroup - 1,
                'aria-label': 'Descendre ' + row.label,
                onClick: function () { self.moveRow(row.arrayField, row.index, 1, row.id); }
              }, '↓'),
              h('button', {
                type: 'button',
                'aria-label': 'Vider ' + row.label,
                onClick: function () { self.setArticle(row, ''); }
              }, 'Vider')
            )
          ),
          expanded && h('div', { className: 'sonar-homepage-card-body' },
            h('div', { className: 'sonar-homepage-fields' },
              h('label', {}, 'Article',
                h('input', {
                  className: 'sonar-homepage-search',
                  type: 'search',
                  value: query,
                  placeholder: 'Rechercher par titre…',
                  'aria-label': 'Rechercher un article pour ' + row.label,
                  onChange: function (event) {
                    var search = Object.assign({}, self.state.search);
                    search[row.id] = event.target.value;
                    self.setState({ search: search });
                  }
                }),
                h('select', {
                  value: row.value.article || '',
                  onChange: function (event) { self.setArticle(row, event.target.value); }
                },
                  h('option', { value: '' }, 'Article récent automatique'),
                  hasSelected && h('option', { value: row.value.article }, title),
                  options.map(function (article) {
                    return h('option', { key: articleSlug(article), value: articleSlug(article) }, articleTitle(article));
                  })
                )
              )
            ),
            this.renderStyleFields(row),
            unavailable && h('p', { className: 'sonar-homepage-note' },
              hidden
                ? 'Cet article est masqué et sera remplacé automatiquement par un article récent sur le site.'
                : 'Cet article est introuvable dans la liste chargée; vérifie sa sélection avant publication.'
            ),
            duplicates && h('p', { className: 'sonar-homepage-note' },
              'Cet article est sélectionné plusieurs fois; un emplacement en doublon sera remplacé automatiquement sur le site.'
            )
          )
        );
      },

      renderSection: function (title, rows, countField, countOptions, countLabels) {
        var self = this;
        var value = this.currentValue();
        var countControl = countField && h('label', { className: 'sonar-homepage-count' }, 'Afficher',
          h('select', {
            value: value[countField],
            onChange: function (event) {
              var next = self.currentValue();
              next[countField] = event.target.value;
              self.emit(next);
            }
          }, countOptions.map(function (option, index) {
            return h('option', { key: option, value: option }, countLabels[index]);
          }))
        );
        return h('section', { className: 'sonar-homepage-section', key: title },
          h('div', { className: 'sonar-homepage-section-head' },
            h('h3', {}, title),
            countControl
          ),
          h('div', { className: 'sonar-homepage-list' },
            rows.map(function (row) {
              var total = row.arrayField ? value[row.arrayField].length : 1;
              return self.renderRow(row, total);
            })
          )
        );
      },

      render: function () {
        var rows = this.currentRows();
        var byId = function (id) { return rows.filter(function (row) { return row.id === id || row.id.indexOf(id + '-') === 0; }); };
        var value = this.currentValue();
        return h('div', { className: 'sonar-homepage-editor' },
          this.renderSection('Article principal', byId('hero')),
          this.renderSection('Première sidebar', byId('sidebar-long').concat(byId('sidebar-small')), 'sidebarSmallArticleCount', ['1', '2'], ['1 petit article', '2 petits articles']),
          this.renderSection('Rangée du bas', byId('bottom'), 'bottomArticleCount', ['1', '2', '3'], ['1 article', '2 articles', '3 articles']),
          this.renderSection('Mise en page asymétrique', byId('asym-left').concat(byId('asym-right'))),
          this.state.loading && h('p', { className: 'sonar-homepage-note' }, 'Chargement des articles…'),
          this.state.error && h('p', { className: 'sonar-homepage-error', role: 'alert' }, this.state.error),
          h('p', { className: 'sonar-homepage-note' },
            'Les emplacements vides utilisent les articles récents. Les descriptions courtes des cartes sont limitées à 3 lignes dans l’aperçu, comme sur le site; les articles ne sont pas modifiés.'
          )
        );
      }
    });

    function Preview(props) {
      var value = toPlain(props.value);
      var data = value && typeof value === 'object' ? normalizeState(value) : legacyState(props.entry);
      var selected = [
        data.heroArticle,
        data.sidebarLongArticle,
        data.asymRightArticle
      ].concat(data.sidebarSmallArticles, data.bottomArticles, data.asymLeftArticles)
        .filter(function (slot) { return Boolean(slugFrom(slot)); }).length;
      return h('p', { className: 'sonar-homepage-note' }, selected + ' article' + (selected === 1 ? '' : 's') + ' sélectionné' + (selected === 1 ? '' : 's'));
    }

    global.CMS.registerWidget('homepage-featured-editor', Control, Preview);
  }

  register();
  if (!global.__SONAR_HOMEPAGE_FEATURED_EDITOR && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  }
})(window);
