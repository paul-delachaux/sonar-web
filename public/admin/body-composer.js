/**
 * Composeur d’images / tweets entre les paragraphes (articles et brèves).
 * Le markdown reste le champ body ; ce widget ne stocke que media_blocks.
 */
(function (global) {
  function toJS(value) {
    if (value == null) return [];
    if (typeof value.toJS === 'function') value = value.toJS();
    return Array.isArray(value) ? value : [];
  }

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }

  function asAfter(value) {
    var n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function asPercent(value) {
    if (value == null || value === '') return 100;
    var n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!isFinite(n) || n <= 0) return 100;
    return Math.min(100, Math.max(1, Math.round(n)));
  }

  function asAlign(value) {
    return value === 'left' ? 'left' : 'center';
  }

  function splitParagraphs(md) {
    return String(md || '')
      .split(/\n\s*\n/)
      .map(function (block) { return block.trim(); })
      .filter(Boolean);
  }

  function snippet(md, max) {
    var plain = String(md || '')
      .replace(/[#>*_`\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain.length <= (max || 90)) return plain || '(paragraphe vide)';
    return plain.slice(0, max || 90).trim() + '…';
  }

  function fileName(src) {
    var raw = String(src || '').split('?')[0];
    if (!raw || raw.indexOf('data:') === 0) return 'Image';
    var name = raw.split('/').pop() || 'Image';
    try { return decodeURIComponent(name); } catch (e) { return name; }
  }

  function mediaUrl(src) {
    if (!src) return '';
    if (global.SonarCmsMedia && typeof global.SonarCmsMedia.url === 'function') {
      return global.SonarCmsMedia.url(src) || src;
    }
    return src;
  }

  function normalizeBlock(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'tweet') {
      var tweet = {
        id: String(item.id || uid('tw')),
        type: 'tweet',
        url: String(item.url || item.tweet_url || '').trim(),
        after: asAfter(item.after),
        width: asPercent(item.width),
        height: asPercent(item.height),
        align: asAlign(item.align)
      };
      return tweet;
    }
    if (item.type === 'image' || item.src || item.image) {
      var image = {
        id: String(item.id || uid('img')),
        type: 'image',
        src: String(item.src || item.image || '').trim(),
        caption: String(item.caption || item.image_caption || ''),
        caption_en: String(item.caption_en || item.image_caption_en || ''),
        after: asAfter(item.after),
        width: asPercent(item.width),
        height: asPercent(item.height),
        align: asAlign(item.align)
      };
      return image;
    }
    return null;
  }

  function fromValue(value) {
    return toJS(value).map(normalizeBlock).filter(Boolean);
  }

  function legacyFromEntry(entry) {
    if (!entry || !entry.getIn) return [];
    var layout = String(entry.getIn(['data', 'layout_type']) || '');
    var articleImage = entry.getIn(['data', 'article_image']);
    var image = entry.getIn(['data', 'image']);
    var src = layout === 'breve' ? (image || articleImage) : (articleImage || image);
    var info = entry.getIn(['data', 'image_info', 0]);
    var caption = (info && info.get && info.get('image_caption')) || entry.getIn(['data', 'image_caption']) || '';
    var captionEn = (info && info.get && info.get('image_caption_en')) || entry.getIn(['data', 'image_caption_en']) || '';
    var blocks = [];
    if (src) {
      blocks.push({
        id: 'legacy-image',
        type: 'image',
        src: String(src),
        caption: String(caption || ''),
        caption_en: String(captionEn || ''),
        after: asAfter(entry.getIn(['data', 'image_position']))
      });
    }
    var tweet = entry.getIn(['data', 'tweet_url']);
    if (tweet) {
      blocks.push({
        id: 'legacy-tweet',
        type: 'tweet',
        url: String(tweet),
        after: asAfter(entry.getIn(['data', 'tweet_position']))
      });
    }
    return blocks;
  }

  function bodyFromEntry(entry) {
    if (!entry || !entry.getIn) return '';
    return String(entry.getIn(['data', 'body']) || '');
  }

  function ensureStyle() {
    if (document.getElementById('sonar-body-composer-css')) return;
    var style = document.createElement('style');
    style.id = 'sonar-body-composer-css';
    style.textContent = [
      '.sonar-composer{border:1px solid #1f2937;border-radius:8px;background:#07072a;padding:12px;color:#e5e7eb;font-family:Helvetica,Arial,sans-serif;}',
      '.sonar-composer-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;}',
      '.sonar-composer-toolbar button{background:#ff7900;border:0;color:#fff;border-radius:5px;height:34px;padding:0 12px;font-weight:700;cursor:pointer;}',
      '.sonar-composer-toolbar button.secondary{background:#1f2937;}',
      '.sonar-composer-hint{margin:0 0 10px;font-size:12px;color:#9ca3af;line-height:1.4;}',
      '.sonar-composer-slot{min-height:10px;border-radius:6px;transition:background .15s, outline-color .15s;}',
      '.sonar-composer-slot.is-over{background:rgba(255,121,0,.18);outline:2px dashed #ff7900;}',
      '.sonar-composer-para{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;margin:4px 0;border-radius:6px;background:#0c0c38;border:1px solid #1f2937;}',
      '.sonar-composer-para b{flex:0 0 42px;color:#ff7900;font-size:11px;letter-spacing:.04em;}',
      '.sonar-composer-para span{font-size:13px;line-height:1.4;color:#d1d5db;}',
      '.sonar-composer-card{display:grid;grid-template-columns:72px 1fr auto;gap:10px;align-items:start;padding:10px;margin:6px 0;border-radius:8px;background:#11113f;border:1px solid #ff7900;cursor:grab;}',
      '.sonar-composer-card.is-tweet{border-color:#1d9e75;}',
      '.sonar-composer-card img,.sonar-composer-thumb{width:72px;height:72px;object-fit:cover;border-radius:4px;background:#0b092b;}',
      '.sonar-composer-card .meta{min-width:0;}',
      '.sonar-composer-card .meta strong{display:block;font-size:12px;margin:0 0 6px;color:#fff;}',
      '.sonar-composer-card input,.sonar-composer-card textarea{width:100%;box-sizing:border-box;margin:0 0 6px;border:1px solid #374151;border-radius:4px;background:#07072a;color:#fff;padding:6px 8px;font:12px/1.3 Helvetica,Arial,sans-serif;}',
      '.sonar-composer-card .file{display:block;margin:0 0 6px;font-size:11px;color:#9ca3af;word-break:break-all;}',
      '.sonar-composer-sizes{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 6px;}',
      '.sonar-composer-sizes label{display:block;font-size:10px;color:#9ca3af;margin:0 0 2px;letter-spacing:.02em;}',
      '.sonar-composer-align{margin:0 0 6px;}',
      '.sonar-composer-align label{display:block;font-size:10px;color:#9ca3af;margin:0 0 2px;letter-spacing:.02em;}',
      '.sonar-composer-align-btns{display:flex;gap:6px;}',
      '.sonar-composer-align-btns button{flex:1;background:#1f2937;border:1px solid #374151;color:#d1d5db;border-radius:4px;height:28px;padding:0 8px;cursor:pointer;font-size:11px;font-weight:700;}',
      '.sonar-composer-align-btns button.is-on{background:#ff7900;border-color:#ff7900;color:#fff;}',
      '.sonar-composer-card .remove{background:#e5484d;border:0;color:#fff;border-radius:4px;height:28px;padding:0 8px;cursor:pointer;font-weight:700;}',
      '.sonar-composer-card .pick{background:#1f2937;border:0;color:#fff;border-radius:4px;height:28px;padding:0 8px;cursor:pointer;font-weight:700;margin-bottom:6px;}',
      '.sonar-composer-empty{padding:16px;text-align:center;color:#9ca3af;font-size:13px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function register(CMS, createClass, h) {
    if (!CMS || !createClass || !h || global.__SONAR_BODY_COMPOSER) return;
    global.__SONAR_BODY_COMPOSER = true;
    ensureStyle();

    var Control = createClass({
      getInitialState: function () {
        return { over: null, blocks: null, drafts: {} };
      },

      layoutType: function () {
        var entry = this.props.entry;
        return entry && entry.getIn ? String(entry.getIn(['data', 'layout_type']) || '') : '';
      },

      hasStoredValue: function () {
        var value = this.props.value;
        if (value == null) return false;
        if (typeof value === 'string') return false;
        if (typeof value.size === 'number') return true;
        return Array.isArray(value);
      },

      blocks: function () {
        if (this.state.blocks) return this.state.blocks;
        if (this.hasStoredValue()) return fromValue(this.props.value);
        return legacyFromEntry(this.props.entry);
      },

      emit: function (list) {
        var clean = list.map(normalizeBlock).filter(Boolean);
        this._draft = clean;
        this.setState({ blocks: clean });
        this.props.onChange(global.Immutable ? global.Immutable.fromJS(clean) : clean);
      },

      applyPickedSources: function (sources) {
        var srcs = (sources || []).map(function (src) { return String(src || '').trim(); }).filter(Boolean);
        if (!srcs.length) return;
        var pending = this._pendingImageId;
        var list = this.blocks().slice();
        srcs.forEach(function (src, i) {
          if (i === 0 && pending) {
            var found = false;
            list = list.map(function (block) {
              if (block.id !== pending) return block;
              found = true;
              return Object.assign({}, block, { src: src });
            });
            if (!found) {
              list.push({ id: pending, type: 'image', src: src, caption: '', caption_en: '', after: 0 });
            }
          } else {
            list.push({
              id: uid('img'),
              type: 'image',
              src: src,
              caption: '',
              caption_en: '',
              after: 0
            });
          }
        });
        this._pendingImageId = null;
        this._picking = false;
        this.emit(list);
      },

      update: function (id, patch) {
        var list = this.blocks().map(function (block) {
          return block.id === id ? Object.assign({}, block, patch) : block;
        });
        this.emit(list);
      },

      draftValue: function (id, field, fallback) {
        var drafts = this.state.drafts || {};
        if (drafts[id] && drafts[id][field] !== undefined) return drafts[id][field];
        return fallback == null || fallback === '' ? '100' : String(fallback);
      },

      updateDraft: function (id, field, raw) {
        var next = Object.assign({}, this.state.drafts || {});
        var card = Object.assign({}, next[id] || {});
        card[field] = String(raw || '').replace(/[^\d]/g, '');
        next[id] = card;
        this.setState({ drafts: next });
      },

      commitSize: function (id, field) {
        var drafts = this.state.drafts || {};
        if (!drafts[id] || drafts[id][field] === undefined) return;
        var patch = {};
        patch[field] = asPercent(drafts[id][field]);
        var next = Object.assign({}, drafts);
        var card = Object.assign({}, next[id]);
        delete card[field];
        if (Object.keys(card).length) next[id] = card;
        else delete next[id];
        this.setState({ drafts: next });
        this.update(id, patch);
      },

      remove: function (id) {
        var next = Object.assign({}, this.state.drafts || {});
        delete next[id];
        this.setState({ drafts: next });
        this.emit(this.blocks().filter(function (block) { return block.id !== id; }));
      },

      addImage: function (src, after) {
        var list = this.blocks().slice();
        list.push({
          id: uid('img'),
          type: 'image',
          src: src || '',
          caption: '',
          caption_en: '',
          after: asAfter(after)
        });
        this.emit(list);
      },

      addTweet: function (after) {
        var list = this.blocks().slice();
        list.push({ id: uid('tw'), type: 'tweet', url: '', after: asAfter(after) });
        this.emit(list);
      },

      moveTo: function (id, after, beforeId) {
        var target = asAfter(after);
        var moving = null;
        var rest = [];
        this.blocks().forEach(function (block) {
          if (block.id === id) moving = Object.assign({}, block, { after: target });
          else rest.push(block);
        });
        if (!moving) return;
        var next = [];
        var placed = false;
        rest.forEach(function (block) {
          if (!placed && beforeId && block.id === beforeId && block.after === target) {
            next.push(moving);
            placed = true;
          }
          next.push(block);
        });
        if (!placed) next.push(moving);
        this.emit(next);
      },

      openMediaLibrary: function (id) {
        this._pendingImageId = id;
        this._picking = true;
        var paths = this.props.mediaPaths;
        if (paths && paths.get) {
          var existing = paths.get(this.props.forID);
          if (existing != null && existing !== '') this._lastPick = String(existing);
        }
        if (typeof this.props.onOpenMediaLibrary === 'function') {
          this.props.onOpenMediaLibrary({
            controlID: this.props.forID,
            forImage: true,
            value: '',
            allowMultiple: true,
            field: this.props.field
          });
          return true;
        }
        var src = global.prompt('Chemin ou URL de l’image', '/assets/uploads/');
        if (src) this.applyPickedSources([src]);
        return false;
      },

      pickImage: function () {
        var id = uid('img');
        var list = this.blocks().slice();
        list.push({ id: id, type: 'image', src: '', caption: '', caption_en: '', after: 0, width: 100 });
        this.emit(list);
        this.openMediaLibrary(id);
      },

      componentDidUpdate: function () {
        var incoming = this.props.value;
        var plain = incoming && typeof incoming.toJS === 'function' ? incoming.toJS() : incoming;
        if (typeof plain === 'string' && plain && this._lastConsumed !== plain) {
          this._lastConsumed = plain;
          this.applyPickedSources([plain]);
          return;
        }
        var paths = this.props.mediaPaths;
        if (!this._picking || !paths || !paths.get) return;
        var raw = paths.get(this.props.forID);
        if (raw == null || raw === '') return;
        var token = String(raw);
        if (this._lastPick === token) return;
        this._lastPick = token;
        var val = typeof raw.toJS === 'function' ? raw.toJS() : raw;
        this.applyPickedSources(Array.isArray(val) ? val : [val]);
      },

      onDrop: function (after, beforeId, event) {
        event.preventDefault();
        var id = event.dataTransfer.getData('text/plain');
        this.setState({ over: null });
        if (id) this.moveTo(id, after, beforeId);
      },

      renderCard: function (block) {
        var self = this;
        var isTweet = block.type === 'tweet';
        return h('div', {
          key: block.id,
          className: 'sonar-composer-card' + (isTweet ? ' is-tweet' : ''),
          draggable: true,
          onDragStart: function (event) {
            event.dataTransfer.setData('text/plain', block.id);
            event.dataTransfer.effectAllowed = 'move';
          },
          onDragOver: function (event) { event.preventDefault(); },
          onDrop: function (event) {
            event.stopPropagation();
            self.onDrop(block.after, block.id, event);
          }
        },
          isTweet
            ? h('div', { className: 'sonar-composer-thumb', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1d9e75', fontWeight: 800 } }, '𝕏')
            : (block.src
              ? h('img', { src: mediaUrl(block.src), alt: '' })
              : h('div', { className: 'sonar-composer-thumb', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 11, textAlign: 'center' } }, 'Média')),
          h('div', { className: 'meta' },
            h('strong', {}, isTweet ? 'Tweet' : 'Image'),
            isTweet
              ? h('input', {
                type: 'url',
                placeholder: 'https://x.com/compte/status/…',
                value: block.url || '',
                onChange: function (event) { self.update(block.id, { url: event.target.value }); }
              })
              : [
                h('span', { key: 'file', className: 'file' }, block.src ? fileName(block.src) : 'Aucune image choisie'),
                block.src ? null : h('button', {
                  key: 'pick',
                  type: 'button',
                  className: 'pick',
                  onClick: function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    self.openMediaLibrary(block.id);
                  }
                }, 'Choisir'),
                h('input', {
                  key: 'cap',
                  type: 'text',
                  placeholder: 'Légende (FR)',
                  value: block.caption || '',
                  onChange: function (event) { self.update(block.id, { caption: event.target.value }); }
                }),
                h('input', {
                  key: 'capen',
                  type: 'text',
                  placeholder: 'Caption (EN)',
                  value: block.caption_en || '',
                  onChange: function (event) { self.update(block.id, { caption_en: event.target.value }); }
                })
              ],
            h('div', { className: 'sonar-composer-sizes' },
              h('div', {},
                h('label', {}, 'Largeur (%)'),
                h('input', {
                  type: 'text',
                  inputMode: 'numeric',
                  pattern: '[0-9]*',
                  placeholder: '100',
                  value: self.draftValue(block.id, 'width', block.width),
                  onChange: function (event) { self.updateDraft(block.id, 'width', event.target.value); },
                  onBlur: function () { self.commitSize(block.id, 'width'); },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.target.blur();
                    }
                  }
                })
              ),
              h('div', {},
                h('label', {}, isTweet ? 'Échelle (%)' : 'Hauteur (% de l’image)'),
                h('input', {
                  type: 'text',
                  inputMode: 'numeric',
                  pattern: '[0-9]*',
                  placeholder: '100',
                  value: self.draftValue(block.id, 'height', block.height),
                  onChange: function (event) { self.updateDraft(block.id, 'height', event.target.value); },
                  onBlur: function () { self.commitSize(block.id, 'height'); },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.target.blur();
                    }
                  }
                })
              )
            ),
            h('div', { className: 'sonar-composer-align' },
              h('label', {}, 'Alignement'),
              h('div', { className: 'sonar-composer-align-btns' },
                h('button', {
                  type: 'button',
                  className: block.align === 'left' ? 'is-on' : '',
                  onClick: function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    self.update(block.id, { align: 'left' });
                  }
                }, 'Gauche'),
                h('button', {
                  type: 'button',
                  className: block.align !== 'left' ? 'is-on' : '',
                  onClick: function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    self.update(block.id, { align: 'center' });
                  }
                }, 'Centre')
              )
            )
          ),
          h('button', {
            type: 'button',
            className: 'remove',
            onClick: function () { self.remove(block.id); }
          }, 'Retirer')
        );
      },

      renderSlot: function (after, items, beforeId) {
        var self = this;
        var key = 'slot-' + after + '-' + (beforeId || 'end');
        return h('div', {
          key: key,
          className: 'sonar-composer-slot' + (this.state.over === key ? ' is-over' : ''),
          onDragOver: function (event) {
            event.preventDefault();
            self.setState({ over: key });
          },
          onDragLeave: function () {
            if (self.state.over === key) self.setState({ over: null });
          },
          onDrop: function (event) { self.onDrop(after, beforeId, event); }
        }, items && items.map(function (block) { return self.renderCard(block); }));
      },

      render: function () {
        if (this.layoutType() === 'revue_musicale') {
          return h('p', { className: 'sonar-composer-hint' }, 'Pas d’images ni de tweets dans le corps des revues musicales.');
        }
        var paras = splitParagraphs(bodyFromEntry(this.props.entry));
        var blocks = this.blocks();
        var self = this;
        var rows = [];
        var count = paras.length;

        function group(after) {
          return blocks.filter(function (block) { return asAfter(block.after) === after; });
        }

        rows.push(this.renderSlot(0, group(0)));
        paras.forEach(function (para, index) {
          var n = index + 1;
          rows.push(h('div', { key: 'p-' + n, className: 'sonar-composer-para' },
            h('b', {}, '¶ ' + n),
            h('span', {}, snippet(para))
          ));
          rows.push(self.renderSlot(n, group(n)));
        });
        if (!count) {
          rows.push(h('p', { key: 'empty', className: 'sonar-composer-empty' }, 'Écris d’abord le texte : les paragraphes apparaîtront ici, puis glisse images et tweets entre eux.'));
        }

        return h('div', { className: 'sonar-composer' },
          h('p', { className: 'sonar-composer-hint' }, 'Ajoute autant d’images et de tweets que tu veux, puis glisse les cartes entre les paragraphes. Une fois l’image choisie, le fichier ne se change plus : retire la carte pour en mettre une autre. Largeur en % de la colonne, hauteur en % de l’image (la légende suit l’image). Pour un tweet, l’échelle réduit le texte et le visuel. Alignement : gauche avec le texte, ou centré.'),
          h('div', { className: 'sonar-composer-toolbar' },
            h('button', {
              type: 'button',
              onClick: function (event) {
                event.preventDefault();
                event.stopPropagation();
                self.pickImage();
              }
            }, '+ Image'),
            h('button', {
              type: 'button',
              className: 'secondary',
              onClick: function (event) {
                event.preventDefault();
                event.stopPropagation();
                self.addTweet(count);
              }
            }, '+ Tweet')
          ),
          rows
        );
      }
    });

    CMS.registerWidget('body-composer', Control, function () { return null; });
  }

  global.SonarBodyComposer = { register: register };

  function boot() {
    if (global.CMS && global.createClass && global.h) register(global.CMS, global.createClass, global.h);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
