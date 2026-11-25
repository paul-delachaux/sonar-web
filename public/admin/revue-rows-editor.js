(function (global) {
  function toPlain(value) {
    return value && typeof value.toJS === 'function' ? value.toJS() : value;
  }

  function rowsFrom(value) {
    var plain = toPlain(value);
    return Array.isArray(plain) ? plain : [];
  }

  function cellFrom(row, side) {
    var cell = row && row[side];
    return cell && typeof cell === 'object' ? cell : {};
  }

  function mediaPathToken(value) {
    var plain = toPlain(value);
    try { return JSON.stringify(plain); } catch (e) { return String(plain); }
  }

  function mediaPathSources(value) {
    var plain = toPlain(value);
    var items = Array.isArray(plain) ? plain : [plain];
    return items.map(function (item) {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      return String(item.path || item.src || item.url || item.id || '').trim();
    }).filter(Boolean);
  }

  function mediaUrl(src) {
    if (!src) return '';
    if (global.SonarCmsMedia && typeof global.SonarCmsMedia.url === 'function') {
      return global.SonarCmsMedia.url(src) || src;
    }
    return src;
  }

  function fileName(src) {
    var name = String(src || '').split('?')[0].split('/').pop();
    if (!name) return 'Aucun fichier choisi';
    try { return decodeURIComponent(name); } catch (e) { return name; }
  }

  function summaryText(value, limit) {
    var text = String(value || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^\s*[-+*]\s+/gm, '')
      .replace(/[*_`~>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length <= limit) return text;
    return text.slice(0, limit - 1).replace(/\s+$/, '') + '…';
  }

  function cellSummary(cell, side) {
    cell = cell && typeof cell === 'object' ? cell : {};
    var type = cell.type === 'image' || cell.type === 'audio' || cell.type === 'intertitre'
      ? cell.type
      : 'texte';
    var label = type === 'intertitre' ? 'Intertitre'
      : type === 'image' ? 'Image'
      : type === 'audio' ? 'Audio'
      : 'Texte';
    var content = '';
    if (type === 'image') {
      content = cell.image_caption || cell.image_caption_en || fileName(cell.image);
    } else if (type === 'audio') {
      var tracks = Array.isArray(cell.tracks) ? cell.tracks : [];
      content = tracks.map(function (track) {
        return track && (track.title || track.title_en || track.file || track.url);
      }).filter(Boolean).join(', ') || 'Aucune piste';
    } else {
      content = cell.text || cell.text_en || '';
    }
    return (side === 'left' ? 'Gauche' : 'Droite') + ' · ' + label + ': ' + (summaryText(content, 52) || 'Vide');
  }

  function rowSummary(row) {
    var parts = [cellSummary(cellFrom(row, 'left'), 'left')];
    if (!row.full_width) parts.push(cellSummary(cellFrom(row, 'right'), 'right'));
    return parts.join(' | ');
  }

  function collapsedRowsFrom(value) {
    var collapsedRows = {};
    rowsFrom(value).forEach(function (_row, index) {
      collapsedRows[index] = true;
    });
    return collapsedRows;
  }

  function remapCollapsedRows(flags, operation, index, target) {
    var remapped = {};
    Object.keys(flags || {}).forEach(function (key) {
      if (!flags[key]) return;
      var previousIndex = Number(key);
      var nextIndex = previousIndex;
      if (operation === 'insert' && previousIndex >= index) nextIndex++;
      else if (operation === 'remove') {
        if (previousIndex === index) return;
        if (previousIndex > index) nextIndex--;
      } else if (operation === 'move') {
        if (previousIndex === index) nextIndex = target;
        else if (index < target && previousIndex > index && previousIndex <= target) nextIndex--;
        else if (index > target && previousIndex >= target && previousIndex < index) nextIndex++;
      }
      remapped[nextIndex] = true;
    });
    return remapped;
  }

  function ensureStyle() {
    if (document.getElementById('sonar-revue-rows-editor-style')) return;
    var style = document.createElement('style');
    style.id = 'sonar-revue-rows-editor-style';
    style.textContent = [
      '.sonar-revue-rows-editor{font-family:Helvetica,Arial,sans-serif;color:#253044;}',
      '.sonar-revue-rows-list{display:flex;flex-direction:column;gap:12px;}',
      '.sonar-revue-row{overflow:hidden;border:1px solid #d5d9e0;border-radius:8px;background:#fff;}',
      '.sonar-revue-row-header{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:8px 10px;background:#f1f3f6;border-bottom:1px solid #d5d9e0;}',
      '.sonar-revue-row-header strong{flex:1;min-width:90px;color:#38445a;font-size:13px;}',
      '.sonar-revue-row-header button.sonar-revue-row-title{flex:1;min-width:90px;border:0;background:transparent;padding:0;color:#38445a;font-size:13px;font-weight:700;text-align:left;}',
      '.sonar-revue-row-header button.sonar-revue-row-title:hover{border:0;background:transparent;color:#d65f00;text-decoration:underline;}',
      '.sonar-revue-row-header input.sonar-revue-row-title-editor{flex:1;min-width:90px;width:auto;margin:0;padding:4px 6px;font-size:13px;font-weight:700;}',
      '.sonar-revue-row-summary{flex:0 0 100%;min-width:0;margin:0;color:#667085;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sonar-revue-row-body.is-collapsed{display:none;}',
      '.sonar-revue-rows-editor button,.sonar-revue-rows-editor select,.sonar-revue-rows-editor input,.sonar-revue-rows-editor textarea{font-family:Helvetica,Arial,sans-serif;}',
      '.sonar-revue-rows-editor button{border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#283448;padding:6px 9px;font-weight:700;cursor:pointer;}',
      '.sonar-revue-rows-editor button:hover{border-color:#ff7900;color:#d65f00;}',
      '.sonar-revue-rows-editor button:focus-visible,.sonar-revue-rows-editor select:focus-visible,.sonar-revue-rows-editor input:focus-visible,.sonar-revue-rows-editor textarea:focus-visible{outline:2px solid #ff7900;outline-offset:1px;}',
      '.sonar-revue-row-mode{display:flex;gap:4px;}',
      '.sonar-revue-row-mode button{padding:5px 8px;font-size:11px;}',
      '.sonar-revue-row-mode button[aria-pressed="true"]{border-color:#ff7900;background:#fff3e8;color:#b64e00;}',
      '.sonar-revue-row-controls{display:flex;gap:4px;}',
      '.sonar-revue-row-controls button{padding:5px 8px;font-size:11px;}',
      '.sonar-revue-insert-menu{display:flex;flex:0 0 100%;gap:5px;padding-top:4px;}',
      '.sonar-revue-insert-menu button{font-size:11px;}',
      '.sonar-revue-row-workspace{display:grid;grid-template-columns:minmax(0,1fr) 34px;align-items:stretch;padding:10px;}',
      '.sonar-revue-row-workspace.is-single{grid-template-columns:minmax(0,1fr);}',
      '.sonar-revue-row-workspace.is-right{grid-template-columns:34px minmax(0,1fr);}',
      '.sonar-revue-cell-panel{min-width:0;padding:12px;border:1px solid #d5d9e0;border-radius:8px 0 0 8px;background:#fff;}',
      '.sonar-revue-row-workspace.is-single .sonar-revue-cell-panel{border-radius:8px;}',
      '.sonar-revue-row-workspace.is-right .sonar-revue-cell-panel{border-radius:0 8px 8px 0;}',
      '.sonar-revue-cell-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px;color:#38445a;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}',
      '.sonar-revue-cell-type{display:flex;align-items:center;gap:8px;}',
      '.sonar-revue-cell-type select{min-width:130px;padding:7px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font-size:13px;}',
      '.sonar-revue-cell-fields{display:flex;flex-direction:column;gap:10px;}',
      '.sonar-revue-cell-fields label{display:flex;flex-direction:column;gap:5px;color:#38445a;font-size:12px;font-weight:700;}',
      '.sonar-revue-cell-fields input,.sonar-revue-cell-fields textarea{box-sizing:border-box;width:100%;padding:9px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font-size:14px;font-weight:400;line-height:1.5;}',
      '.sonar-revue-cell-fields textarea{min-height:110px;resize:vertical;}',
      '.sonar-revue-rich-toolbar{display:flex;gap:5px;padding:0 0 6px;}',
      '.sonar-revue-rich-toolbar button{min-width:32px;padding:5px 8px;font-size:13px;}',
      '.sonar-revue-rich-toolbar button strong{font-weight:900;}',
      '.sonar-revue-rich-toolbar button em{font-style:italic;}',
      '.sonar-revue-rich-toolbar button u{text-decoration:underline;}',
      '.sonar-revue-rich-editor{min-height:110px;padding:9px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font-size:14px;font-weight:400;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;}',
      '.sonar-revue-rich-editor ul{margin:.5em 0;padding-inline-start:1.6em;list-style-type:disc;}',
      '.sonar-revue-rich-editor li{padding-inline-start:.2em;}',
      '.sonar-revue-rich-editor:focus{border-color:#ff7900;box-shadow:0 0 0 2px rgba(255,121,0,.16);}',
      '.sonar-revue-image-picker{display:grid;width:100%;box-sizing:border-box;grid-template-columns:minmax(90px,58%) minmax(0,1fr);gap:10px;align-items:start;}',
      '.sonar-revue-image-preview,.sonar-revue-image-empty{display:flex;width:100%;height:130px;align-items:center;justify-content:center;object-fit:cover;border-radius:5px;background:#eef0f4;color:#667085;font-size:12px;}',
      '.sonar-revue-image-actions{display:flex;min-width:0;flex-direction:column;align-items:flex-start;gap:8px;}',
      '.sonar-revue-image-actions button{max-width:100%;padding:6px;white-space:normal;}',
      '.sonar-revue-image-path,.sonar-revue-track-file{max-width:100%;margin:0;color:#667085;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sonar-revue-track{display:flex;flex-direction:column;gap:9px;padding:10px;border:1px solid #e4e7ec;border-radius:6px;background:#fafbfc;}',
      '.sonar-revue-track-header{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#38445a;font-size:12px;font-weight:700;}',
      '.sonar-revue-track-file-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.sonar-revue-track-file-row button{flex:0 0 auto;}',
      '.sonar-revue-switch{display:flex;align-items:center;justify-content:center;border-left:0!important;border-radius:0 8px 8px 0!important;background:#f1f3f6!important;color:#38445a!important;font-size:20px!important;}',
      '.sonar-revue-row-workspace.is-right .sonar-revue-switch{border-right:0!important;border-left:1px solid #cbd2dc!important;border-radius:8px 0 0 8px!important;}',
      '.sonar-revue-switch:hover{background:#fff3e8!important;}',
      '.sonar-revue-add-row{margin-top:10px;}',
      '.sonar-revue-empty{margin:0;padding:18px;border:1px dashed #cbd2dc;border-radius:7px;color:#667085;text-align:center;font-size:13px;}',
      '.sonar-revue-rows-summary{margin:0;padding:4px 0;color:#667085;font-size:12px;}',
      '@media(max-width:600px){.sonar-revue-row-header{align-items:flex-start}.sonar-revue-row-workspace{grid-template-columns:minmax(0,1fr) 30px;padding:7px}.sonar-revue-row-workspace.is-right{grid-template-columns:30px minmax(0,1fr)}.sonar-revue-cell-panel{padding:9px}.sonar-revue-image-picker{grid-template-columns:1fr}.sonar-revue-image-preview,.sonar-revue-image-empty{height:150px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function register() {
    if (!global.CMS || !global.createClass || !global.h || global.__SONAR_REVUE_ROWS_EDITOR) return;
    global.__SONAR_REVUE_ROWS_EDITOR = true;
    ensureStyle();
    var h = global.h;

    var Control = global.createClass({
      getInitialState: function () {
        return {
          activeSides: {},
          collapsedRows: collapsedRowsFrom(this.props.value),
          editingRowTitle: null,
          insertMenuRow: null
        };
      },

      rows: function () {
        return rowsFrom(this.props.value);
      },

      activeSide: function (index, row) {
        if (row.full_width) return 'left';
        return this.state.activeSides[index] || 'left';
      },

      emitRows: function (rows) {
        this.props.onChange(rows);
      },

      updateCell: function (rowIndex, side, patch) {
        var rows = this.rows().slice();
        var row = Object.assign({}, rows[rowIndex] || {});
        row[side] = Object.assign({}, cellFrom(row, side), patch);
        rows[rowIndex] = row;
        this.emitRows(rows);
      },

      updateRowTitle: function (rowIndex, title) {
        var rows = this.rows().slice();
        rows[rowIndex] = Object.assign({}, rows[rowIndex] || {}, { editor_title: title });
        this.emitRows(rows);
      },

      updateTrack: function (rowIndex, side, trackIndex, patch) {
        var rows = this.rows().slice();
        var row = Object.assign({}, rows[rowIndex] || {});
        var cell = Object.assign({}, cellFrom(row, side));
        var tracks = Array.isArray(cell.tracks) ? cell.tracks.slice() : [];
        tracks[trackIndex] = Object.assign({}, tracks[trackIndex] || {}, patch);
        cell.tracks = tracks;
        row[side] = cell;
        rows[rowIndex] = row;
        this.emitRows(rows);
      },

      addTrack: function (rowIndex, side) {
        var rows = this.rows().slice();
        var row = Object.assign({}, rows[rowIndex] || {});
        var cell = Object.assign({}, cellFrom(row, side));
        var tracks = Array.isArray(cell.tracks) ? cell.tracks.slice() : [];
        tracks.push({ file: '', url: '', title: '', title_en: '' });
        cell.tracks = tracks;
        row[side] = cell;
        rows[rowIndex] = row;
        this.emitRows(rows);
      },

      removeTrack: function (rowIndex, side, trackIndex) {
        var rows = this.rows().slice();
        var row = Object.assign({}, rows[rowIndex] || {});
        var cell = Object.assign({}, cellFrom(row, side));
        var tracks = Array.isArray(cell.tracks) ? cell.tracks.slice() : [];
        tracks.splice(trackIndex, 1);
        cell.tracks = tracks;
        row[side] = cell;
        rows[rowIndex] = row;
        this.emitRows(rows);
      },

      setRowMode: function (rowIndex, fullWidth) {
        var rows = this.rows().slice();
        rows[rowIndex] = Object.assign({}, rows[rowIndex] || {}, { full_width: fullWidth });
        this.emitRows(rows);
      },

      toggleSide: function (rowIndex, row) {
        var sides = Object.assign({}, this.state.activeSides || {});
        sides[rowIndex] = this.activeSide(rowIndex, row) === 'left' ? 'right' : 'left';
        this.setState({ activeSides: sides });
      },

      addRow: function () {
        var rows = this.rows().slice();
        rows.push({
          full_width: false,
          left: { type: 'texte', text: '', text_en: '' },
          right: { type: 'texte', text: '', text_en: '' }
        });
        this.emitRows(rows);
        this.setState({ insertMenuRow: null });
      },

      insertRow: function (rowIndex) {
        var rows = this.rows().slice();
        rows.splice(rowIndex, 0, {
          full_width: false,
          left: { type: 'texte', text: '', text_en: '' },
          right: { type: 'texte', text: '', text_en: '' }
        });
        this.emitRows(rows);
        this.setState({
          activeSides: {},
          collapsedRows: remapCollapsedRows(this.state.collapsedRows, 'insert', rowIndex),
          editingRowTitle: null,
          insertMenuRow: null
        });
      },

      toggleInsertMenu: function (rowIndex) {
        this.setState({ insertMenuRow: this.state.insertMenuRow === rowIndex ? null : rowIndex });
      },

      openInsertMenu: function (rowIndex, event) {
        event.preventDefault();
        this.setState({ insertMenuRow: rowIndex });
      },

      removeRow: function (rowIndex) {
        var rows = this.rows().slice();
        rows.splice(rowIndex, 1);
        this.emitRows(rows);
        this.setState({
          activeSides: {},
          collapsedRows: remapCollapsedRows(this.state.collapsedRows, 'remove', rowIndex),
          editingRowTitle: null,
          insertMenuRow: null
        });
      },

      moveRow: function (rowIndex, offset) {
        var rows = this.rows().slice();
        var target = rowIndex + offset;
        if (target < 0 || target >= rows.length) return;
        var moving = rows.splice(rowIndex, 1)[0];
        rows.splice(target, 0, moving);
        this.emitRows(rows);
        this.setState({
          activeSides: {},
          collapsedRows: remapCollapsedRows(this.state.collapsedRows, 'move', rowIndex, target),
          editingRowTitle: null,
          insertMenuRow: null
        });
      },

      toggleRowCollapsed: function (rowIndex) {
        var collapsedRows = Object.assign({}, this.state.collapsedRows || {});
        if (collapsedRows[rowIndex]) delete collapsedRows[rowIndex];
        else collapsedRows[rowIndex] = true;
        this.setState({ collapsedRows: collapsedRows });
      },

      startMediaPick: function (rowIndex, side, fieldName, trackIndex) {
        var controlID = String(this.props.forID || '');
        var paths = this.props.mediaPaths;
        var existing = paths && paths.get ? paths.get(this.props.forID) : paths && paths[this.props.forID];
        var selected = global.SonarCmsMedia && typeof global.SonarCmsMedia.controlMedia === 'function'
          ? global.SonarCmsMedia.controlMedia(controlID)
          : null;
        this._pendingMediaPick = {
          rowIndex: rowIndex,
          side: side,
          fieldName: fieldName,
          trackIndex: trackIndex,
          lastToken: mediaPathToken(selected == null ? existing : selected)
        };
        this.startMediaPickPolling();
        if (typeof this.props.onOpenMediaLibrary === 'function') {
          this.props.onOpenMediaLibrary({
            controlID: this.props.forID,
            forImage: fieldName === 'image',
            value: '',
            allowMultiple: false,
            field: this.props.field
          });
          this.checkMediaPick();
          return;
        }
        var pending = this._pendingMediaPick;
        this.stopMediaPickPolling();
        this._pendingMediaPick = null;
        var source = global.prompt(fieldName === 'image' ? 'Chemin de l’image' : 'Chemin du fichier audio', '/assets/uploads/');
        if (source) this.applyMediaPick(source, pending);
      },

      startMediaPickPolling: function () {
        if (this._mediaPickTimer) return;
        this._mediaPickTimer = global.setInterval(this.checkMediaPick.bind(this), 150);
        this._mediaPickTimeout = global.setTimeout(function () {
          this.stopMediaPickPolling();
          this._pendingMediaPick = null;
        }.bind(this), 300000);
      },

      stopMediaPickPolling: function () {
        if (this._mediaPickTimer) {
          global.clearInterval(this._mediaPickTimer);
          this._mediaPickTimer = null;
        }
        if (this._mediaPickTimeout) {
          global.clearTimeout(this._mediaPickTimeout);
          this._mediaPickTimeout = null;
        }
      },

      checkMediaPick: function () {
        var pending = this._pendingMediaPick;
        if (!pending) return;
        var paths = this.props.mediaPaths;
        var raw = paths && paths.get ? paths.get(this.props.forID) : paths && paths[this.props.forID];
        var controlID = String(this.props.forID || '');
        var selected = global.SonarCmsMedia && typeof global.SonarCmsMedia.controlMedia === 'function'
          ? global.SonarCmsMedia.controlMedia(controlID)
          : null;
        if (selected != null && selected !== '') raw = selected;
        if (raw == null || raw === '') return;
        var token = mediaPathToken(raw);
        if (token === pending.lastToken) return;
        var sources = mediaPathSources(raw);
        if (!sources.length) return;
        this._pendingMediaPick = null;
        this.stopMediaPickPolling();
        this.applyMediaPick(sources[0], pending);
      },

      applyMediaPick: function (source, pending) {
        var target = pending || this._pendingMediaPick;
        if (!target) return;
        if (target.fieldName === 'image') {
          this.updateCell(target.rowIndex, target.side, { image: source });
        } else {
          this.updateTrack(target.rowIndex, target.side, target.trackIndex, { file: source });
        }
      },

      componentDidUpdate: function () {
        this.checkMediaPick();
      },

      componentWillUnmount: function () {
        this.stopMediaPickPolling();
      },

      renderRichTextField: function (rowIndex, side, fieldName, label, value) {
        var self = this;
        var editorId = rowIndex + '-' + side + '-' + fieldName;
        var buttons = [
          { command: 'bold', label: h('strong', {}, 'G'), title: 'Gras' },
          { command: 'italic', label: h('em', {}, 'I'), title: 'Italique' },
          { command: 'underline', label: h('u', {}, 'S'), title: 'Souligné' },
          { command: 'insertUnorderedList', label: '•', title: 'Liste à puces' }
        ];
        function htmlFromMarkdown(markdown) {
          var body = global.SonarArticleBody;
          if (body && typeof body.markdownToHtml === 'function') return body.markdownToHtml(markdown);
          return String(markdown || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br/>');
        }
        function markdownFromEditor(editor) {
          var body = global.SonarArticleBody;
          if (body && typeof body.htmlToMarkdown === 'function') return body.htmlToMarkdown(editor);
          return editor.innerText || editor.textContent || '';
        }
        return h('div', { key: editorId, className: 'sonar-revue-rich-field' },
          h('label', {}, label),
          h('div', { className: 'sonar-revue-rich-toolbar', role: 'toolbar', 'aria-label': 'Mise en forme — ' + label },
            buttons.map(function (button) {
              return h('button', {
                key: button.command,
                type: 'button',
                title: button.title,
                'aria-label': button.title,
                onMouseDown: function (event) { event.preventDefault(); },
                onClick: function (event) {
                  var editor = event.currentTarget.closest('.sonar-revue-rich-field').querySelector('[contenteditable="true"]');
                  editor.focus();
                  document.execCommand(button.command, false);
                  editor.dispatchEvent(new global.Event('input', { bubbles: true }));
                }
              }, button.label);
            })
          ),
          h('div', {
            className: 'sonar-revue-rich-editor',
            contentEditable: true,
            suppressContentEditableWarning: true,
            role: 'textbox',
            'aria-label': label,
            'aria-multiline': 'true',
            ref: function (editor) {
              if (!editor || self._activeRichEditorId === editorId) return;
              editor.innerHTML = htmlFromMarkdown(value);
              editor.setAttribute('data-markdown', String(value || ''));
            },
            onFocus: function () { self._activeRichEditorId = editorId; },
            onInput: function (event) {
              var patch = {};
              patch[fieldName] = markdownFromEditor(event.currentTarget);
              self.updateCell(rowIndex, side, patch);
            },
            onBlur: function (event) {
              self._activeRichEditorId = null;
              var patch = {};
              patch[fieldName] = markdownFromEditor(event.currentTarget);
              self.updateCell(rowIndex, side, patch);
            }
          })
        );
      },

      renderCell: function (rowIndex, side, cell) {
        var self = this;
        var type = cell.type === 'image' || cell.type === 'audio' || cell.type === 'intertitre' ? cell.type : 'texte';
        var content;
        if (type === 'image') {
          content = h('div', { className: 'sonar-revue-cell-fields' },
            h('div', { className: 'sonar-revue-image-picker' },
              cell.image
                ? h('img', { className: 'sonar-revue-image-preview', src: mediaUrl(cell.image), alt: cell.image_caption || cell.image_caption_en || '' })
                : h('div', { className: 'sonar-revue-image-empty' }, 'Aucune image sélectionnée'),
              h('div', { className: 'sonar-revue-image-actions' },
                h('button', { type: 'button', onClick: function () { self.startMediaPick(rowIndex, side, 'image'); } }, cell.image ? 'Changer l’image' : 'Choisir une image'),
                cell.image && h('p', { className: 'sonar-revue-image-path', title: cell.image }, fileName(cell.image))
              )
            ),
            h('label', {}, 'Légende de l’image (FR)',
              h('input', { type: 'text', value: cell.image_caption || '', onChange: function (event) { self.updateCell(rowIndex, side, { image_caption: event.target.value }); } })
            ),
            h('label', {}, 'Légende de l’image (EN)',
              h('input', { type: 'text', value: cell.image_caption_en || '', onChange: function (event) { self.updateCell(rowIndex, side, { image_caption_en: event.target.value }); } })
            )
          );
        } else if (type === 'audio') {
          var tracks = Array.isArray(cell.tracks) ? cell.tracks : [];
          content = h('div', { className: 'sonar-revue-cell-fields' },
            tracks.length
              ? tracks.map(function (track, trackIndex) {
                  track = track || {};
                  return h('div', { key: trackIndex, className: 'sonar-revue-track' },
                    h('div', { className: 'sonar-revue-track-header' },
                      h('span', {}, 'Piste ' + (trackIndex + 1)),
                      h('button', { type: 'button', onClick: function () { self.removeTrack(rowIndex, side, trackIndex); } }, 'Supprimer')
                    ),
                    h('div', { className: 'sonar-revue-track-file-row' },
                      h('button', { type: 'button', onClick: function () { self.startMediaPick(rowIndex, side, 'file', trackIndex); } }, track.file ? 'Changer le fichier' : 'Choisir un fichier'),
                      h('span', { className: 'sonar-revue-track-file', title: track.file || '' }, fileName(track.file))
                    ),
                    h('label', {}, 'URL YouTube ou fichier audio en ligne',
                      h('input', { type: 'url', value: track.url || '', onChange: function (event) { self.updateTrack(rowIndex, side, trackIndex, { url: event.target.value }); } })
                    ),
                    h('label', {}, 'Titre (FR)',
                      h('input', { type: 'text', value: track.title || '', onChange: function (event) { self.updateTrack(rowIndex, side, trackIndex, { title: event.target.value }); } })
                    ),
                    h('label', {}, 'Titre (EN)',
                      h('input', { type: 'text', value: track.title_en || '', onChange: function (event) { self.updateTrack(rowIndex, side, trackIndex, { title_en: event.target.value }); } })
                    )
                  );
                })
              : h('p', { className: 'sonar-revue-empty' }, 'Aucune piste ajoutée.'),
            h('button', { type: 'button', onClick: function () { self.addTrack(rowIndex, side); } }, '+ Ajouter une piste')
          );
        } else if (type === 'intertitre') {
          content = h('div', { className: 'sonar-revue-cell-fields' },
            h('label', {}, 'Intertitre (FR)',
              h('input', { type: 'text', value: cell.text || '', onChange: function (event) { self.updateCell(rowIndex, side, { text: event.target.value }); } })
            ),
            h('label', {}, 'Intertitre (EN)',
              h('input', { type: 'text', value: cell.text_en || '', onChange: function (event) { self.updateCell(rowIndex, side, { text_en: event.target.value }); } })
            )
          );
        } else {
          content = h('div', { className: 'sonar-revue-cell-fields' },
            this.renderRichTextField(rowIndex, side, 'text', 'Texte (FR)', cell.text || ''),
            this.renderRichTextField(rowIndex, side, 'text_en', 'Texte (EN)', cell.text_en || '')
          );
        }

        return h('div', { className: 'sonar-revue-cell-panel' },
          h('div', { className: 'sonar-revue-cell-heading' },
            h('span', {}, side === 'left' ? 'Bloc gauche' : 'Bloc droit'),
            h('label', { className: 'sonar-revue-cell-type' }, 'Type',
              h('select', {
                value: type,
                onChange: function (event) { self.updateCell(rowIndex, side, { type: event.target.value }); }
              },
                h('option', { value: 'texte' }, 'Texte'),
                h('option', { value: 'intertitre' }, 'Intertitre'),
                h('option', { value: 'image' }, 'Image'),
                h('option', { value: 'audio' }, 'Audio')
              )
            )
          ),
          content
        );
      },

      renderRow: function (row, rowIndex, total) {
        var self = this;
        row = row || {};
        var fullWidth = Boolean(row.full_width);
        var side = this.activeSide(rowIndex, row);
        var cell = cellFrom(row, side);
        var collapsed = Boolean(this.state.collapsedRows && this.state.collapsedRows[rowIndex]);
        var summary = rowSummary(row);
        var rowTitle = String(row.editor_title || '').trim() || 'Ligne ' + (rowIndex + 1);
        var editingRowTitle = this.state.editingRowTitle === rowIndex;
        var switchButton = !fullWidth && h('button', {
          type: 'button',
          className: 'sonar-revue-switch',
          title: side === 'left' ? 'Afficher le bloc droit' : 'Afficher le bloc gauche',
          'aria-label': side === 'left' ? 'Afficher le bloc droit' : 'Afficher le bloc gauche',
          onClick: function () { self.toggleSide(rowIndex, row); }
        }, side === 'left' ? '›' : '‹');
        var insertMenuOpen = this.state.insertMenuRow === rowIndex;
        return h('section', {
          key: rowIndex,
          className: 'sonar-revue-row',
          onContextMenu: function (event) { self.openInsertMenu(rowIndex, event); },
          onKeyDown: function (event) {
            if (event.key === 'Escape' && self.state.insertMenuRow === rowIndex) {
              event.stopPropagation();
              self.setState({ insertMenuRow: null });
            }
          }
        },
          h('div', { className: 'sonar-revue-row-header' },
            h('button', {
              type: 'button',
              className: 'sonar-revue-collapse-row',
              title: collapsed ? 'Déplier la ligne' : 'Réduire la ligne',
              'aria-label': (collapsed ? 'Déplier la ligne ' : 'Réduire la ligne ') + (rowIndex + 1),
              'aria-expanded': !collapsed,
              onClick: function () { self.toggleRowCollapsed(rowIndex); }
            }, collapsed ? '▸' : '▾'),
            editingRowTitle
              ? h('input', {
                  type: 'text',
                  className: 'sonar-revue-row-title-editor',
                  autoFocus: true,
                  maxLength: 100,
                  'aria-label': 'Titre de repérage de la ligne ' + (rowIndex + 1),
                  value: row.editor_title || rowTitle,
                  onChange: function (event) { self.updateRowTitle(rowIndex, event.target.value); },
                  onFocus: function (event) { event.currentTarget.select(); },
                  onBlur: function (event) {
                    self.updateRowTitle(rowIndex, event.currentTarget.value.trim());
                    self.setState({ editingRowTitle: null });
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }
                })
              : h('button', {
                  type: 'button',
                  className: 'sonar-revue-row-title',
                  title: 'Cliquer pour modifier le titre',
                  'aria-label': 'Modifier le titre de la ligne ' + (rowIndex + 1),
                  onClick: function () { self.setState({ editingRowTitle: rowIndex }); }
                }, rowTitle),
            h('div', { className: 'sonar-revue-row-mode', role: 'group', 'aria-label': 'Nombre de blocs' },
              h('button', {
                type: 'button',
                'aria-pressed': fullWidth,
                onClick: function () { self.setRowMode(rowIndex, true); }
              }, '1 bloc'),
              h('button', {
                type: 'button',
                'aria-pressed': !fullWidth,
                onClick: function () { self.setRowMode(rowIndex, false); }
              }, '2 blocs')
            ),
            h('div', { className: 'sonar-revue-row-controls' },
              h('button', { type: 'button', disabled: rowIndex === 0, 'aria-label': 'Monter la ligne', onClick: function () { self.moveRow(rowIndex, -1); } }, '↑'),
              h('button', { type: 'button', disabled: rowIndex === total - 1, 'aria-label': 'Descendre la ligne', onClick: function () { self.moveRow(rowIndex, 1); } }, '↓'),
              h('button', {
                type: 'button',
                'aria-label': 'Insérer une ligne près de la ligne ' + (rowIndex + 1),
                'aria-expanded': insertMenuOpen,
                title: 'Ou clic droit sur la ligne',
                onClick: function () { self.toggleInsertMenu(rowIndex); }
              }, 'Insérer'),
              h('button', { type: 'button', onClick: function () { self.removeRow(rowIndex); } }, 'Supprimer')
            ),
            insertMenuOpen && h('div', {
              className: 'sonar-revue-insert-menu',
              role: 'group',
              'aria-label': 'Position de la nouvelle ligne'
            },
              h('button', { type: 'button', onClick: function () { self.insertRow(rowIndex); } }, 'Ajouter avant'),
              h('button', { type: 'button', onClick: function () { self.insertRow(rowIndex + 1); } }, 'Ajouter après')
            )
          ),
          collapsed && h('p', { className: 'sonar-revue-row-summary', title: summary }, summary),
          h('div', { className: 'sonar-revue-row-body' + (collapsed ? ' is-collapsed' : '') },
            h('div', {
              className: 'sonar-revue-row-workspace'
                + (fullWidth ? ' is-single' : '')
                + (!fullWidth && side === 'right' ? ' is-right' : '')
            },
              !fullWidth && side === 'right' ? switchButton : null,
              this.renderCell(rowIndex, side, cell),
              !fullWidth && side === 'left' ? switchButton : null
            )
          )
        );
      },

      render: function () {
        var self = this;
        var rows = this.rows();
        return h('div', { className: 'sonar-revue-rows-editor' },
          h('p', { className: 'sonar-revue-rows-summary' }, rows.length + (rows.length === 1 ? ' ligne' : ' lignes')),
          rows.length
            ? h('div', { className: 'sonar-revue-rows-list' }, rows.map(function (row, index) {
                return self.renderRow(row, index, rows.length);
              }))
            : h('p', { className: 'sonar-revue-empty' }, 'Aucune ligne. Ajoute une ligne pour commencer.'),
          h('button', { type: 'button', className: 'sonar-revue-add-row', onClick: function () { self.addRow(); } }, '+ Ajouter une ligne')
        );
      }
    });

    function Preview(props) {
      var rows = rowsFrom(props.value);
      return h('p', { className: 'sonar-revue-rows-summary' }, rows.length + (rows.length === 1 ? ' ligne' : ' lignes'));
    }

    global.CMS.registerWidget('revue-rows-editor', Control, Preview);
  }

  register();
  if (!global.__SONAR_REVUE_ROWS_EDITOR && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  }
})(window);
