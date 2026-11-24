(function (global) {
  function uid() {
    return 'body-' + Math.random().toString(36).slice(2, 10);
  }

  function valueAsString(value) {
    return value == null ? '' : String(value);
  }

  function htmlEscape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function markdownToHtml(value) {
    var lines = htmlEscape(value).split('\n');
    var output = [];
    var listItems = [];
    function renderInline(line) {
      return line
        .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<u>$1</u>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/gi, '<u>$1</u>')
        .replace(/\+\+(.+?)\+\+/g, '<u>$1</u>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br/>');
    }
    function flushList() {
      if (!listItems.length) return;
      output.push('<ul>' + listItems.map(function (item) { return '<li>' + renderInline(item) + '</li>'; }).join('') + '</ul>');
      listItems = [];
    }
    lines.forEach(function (line) {
      var item = line.match(/^\s*[*+-]\s+([\s\S]*)$/);
      if (item) listItems.push(item[1]);
      else if (listItems.length && /^\s{2,}/.test(line)) {
        var continuation = line.replace(/^\s{2}/, '');
        listItems[listItems.length - 1] += continuation.trim() === '\\' ? '\n' : '\n' + continuation;
      } else if (line.trim() === '\\\\') {
        flushList();
        output.push('');
      }
      else {
        flushList();
        output.push(renderInline(line));
      }
    });
    flushList();
    return output.join('<br/>');
  }

  function htmlToMarkdown(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    var tag = node.tagName.toLowerCase();
    if ((tag === 'div' || tag === 'p') && node.childNodes.length === 1
      && node.firstChild.nodeType === 1 && node.firstChild.tagName.toLowerCase() === 'br') return '';
    var childNodes = Array.from(node.childNodes);
    var content = childNodes.map(function (child, index) {
      var previous = childNodes[index - 1];
      var blockTags = ['div', 'p', 'ul', 'ol'];
      var childIsBlock = child.nodeType === 1 && blockTags.indexOf(child.tagName.toLowerCase()) !== -1;
      var previousIsBlock = previous && previous.nodeType === 1 && blockTags.indexOf(previous.tagName.toLowerCase()) !== -1;
      return (index > 0 && (childIsBlock || previousIsBlock) ? '\n' : '') + htmlToMarkdown(child);
    }).join('');
    if (tag === 'strong' || tag === 'b') return '**' + content + '**';
    if (tag === 'em' || tag === 'i') return '*' + content + '*';
    if (tag === 'u') return '<u>' + content + '</u>';
    if (tag === 'br') return '\n';
    if (tag === 'a') return '[' + content + '](' + node.getAttribute('href') + ')';
    if (tag === 'li') return '* ' + content.replace(/\n/g, '\n  ');
    if (tag === 'ul' || tag === 'ol') return childNodes.map(htmlToMarkdown).join('\n');
    return content;
  }

  function valueAsIntro(value, legacy) {
    var data = value && typeof value.toJS === 'function' ? value.toJS() : value;
    if (typeof data === 'string') {
      return legacy && legacy.mode === 'image' && legacy.image
        ? { mode: 'image', text: data, image: legacy.image || '', caption: legacy.caption || '' }
        : { mode: 'text', text: data, image: '', caption: '' };
    }
    data = data && typeof data === 'object' ? data : {};
    return {
      mode: data.mode === 'image' ? 'image' : 'text',
      text: String(data.text || ''),
      image: String(data.image || ''),
      caption: String(data.caption || '')
    };
  }

  function widgetFieldName(field, fallback) {
    if (field && typeof field.get === 'function') return field.get('name') || fallback;
    if (field && typeof field === 'object') return field.name || fallback;
    return field || fallback;
  }

  function registerIntro(CMS, createClass, h) {
    if (!CMS || !createClass || !h) return;
    var Control = createClass({
      getInitialState: function () { return {}; },
      intro: function () {
        var entry = this.props.entry;
        var fieldName = widgetFieldName(this.props.field, this.props.forID);
        var suffix = fieldName === 'description_en' ? '_en' : '';
        return valueAsIntro(this.props.value, {
          mode: entry && entry.getIn(['data', 'description_mode' + suffix]),
          image: entry && entry.getIn(['data', 'description_image' + suffix]),
          caption: entry && entry.getIn(['data', 'description_image_caption' + suffix])
        });
      },
      emit: function (patch) {
        var value = Object.assign({}, this.intro(), patch);
        this.props.onChange(value);
      },
      chooseImage: function () {
        this._pickingImage = true;
        this._lastPick = null;
        if (typeof this.props.onOpenMediaLibrary === 'function') {
          this.props.onOpenMediaLibrary({
            controlID: this.props.forID,
            forImage: true,
            value: '',
            allowMultiple: false,
            field: this.props.field
          });
        } else {
          var src = global.prompt('Chemin ou URL de l’image', '/assets/uploads/');
          if (src) this.emit({ image: src });
        }
      },
      componentDidUpdate: function () {
        var paths = this.props.mediaPaths;
        if (!this._pickingImage || !paths || !paths.get) return;
        var raw = paths.get(this.props.forID);
        if (raw == null || raw === '') return;
        var token = String(raw);
        if (token === this._lastPick) return;
        this._lastPick = token;
        this._pickingImage = false;
        var selected = typeof raw.toJS === 'function' ? raw.toJS() : raw;
        var src = Array.isArray(selected) ? selected[0] : selected;
        if (src) this.emit({ image: String(src) });
      },
      render: function () {
        var self = this;
        var intro = this.intro();
        var imageUrl = intro.image && global.SonarCmsMedia && global.SonarCmsMedia.url
          ? global.SonarCmsMedia.url(intro.image)
          : intro.image;
        return h('div', { className: 'sonar-intro-editor' },
          h('label', { className: 'sonar-intro-label' },
            'Afficher',
            h('select', {
              value: intro.mode,
              onChange: function (event) { self.emit({ mode: event.target.value }); }
            },
              h('option', { value: 'text' }, 'Un texte'),
              h('option', { value: 'image' }, 'Une image')
            )
          ),
          intro.mode === 'text'
            ? h('textarea', {
                className: 'sonar-intro-text',
                value: intro.text,
                placeholder: 'Écris la description…',
                onChange: function (event) { self.emit({ text: event.target.value }); }
              })
            : h('div', { className: 'sonar-intro-image' },
                intro.image ? h('img', { src: imageUrl, alt: '' }) : h('div', { className: 'sonar-intro-placeholder' }, 'Aucune image sélectionnée'),
                h('div', { className: 'sonar-intro-image-fields' },
                  h('button', { type: 'button', onClick: function () { self.chooseImage(); } }, intro.image ? 'Changer l’image' : 'Choisir une image'),
                  intro.image && h('p', { className: 'sonar-intro-path' }, intro.image),
                  h('label', { className: 'sonar-intro-caption-label' },
                    'Légende (facultative)',
                    h('input', {
                      type: 'text',
                      value: intro.caption,
                      placeholder: 'Ajouter une légende…',
                      onChange: function (event) { self.emit({ caption: event.target.value }); }
                    })
                  )
                )
              )
        );
      }
    });

    function Preview(props) {
      var intro = valueAsIntro(props.value);
      if (intro.mode === 'image' && intro.image) {
        var src = global.SonarCmsMedia && global.SonarCmsMedia.url
          ? global.SonarCmsMedia.url(intro.image)
          : intro.image;
        return h('figure', { className: 'sonar-intro-preview' },
          h('img', { src: src, alt: '' }),
          intro.caption && h('figcaption', {}, intro.caption)
        );
      }
      return intro.text ? h('p', { className: 'sonar-intro-text-preview' }, intro.text) : null;
    }
    CMS.registerWidget('article-intro', Control, Preview);
  }

  function parseBlocks(markdown) {
    return String(markdown || '')
      .split(/\n\s*\n/)
      .map(function (raw) { return raw.trim(); })
      .filter(Boolean)
      .map(function (raw) {
        var heading = raw.match(/^(#{2,3})\s+([\s\S]*)$/);
        if (heading) return { id: uid(), type: 'heading', level: heading[1].length, text: heading[2] };

        var figure = raw.match(/^<figure class="article-body-image">\s*<img src="([^"]*)" alt="([^"]*)"\s*\/?>(?:\s*<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>$/i);
        if (figure) {
          return {
            id: uid(),
            type: 'image',
            src: figure[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
            alt: figure[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
            caption: (figure[3] || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
          };
        }

        var image = raw.match(/^!\[([^\]]*)\]\((<?)([^)\s>]+)>?\)$/);
        if (image) return { id: uid(), type: 'image', src: image[3], alt: image[1], caption: '' };
        return { id: uid(), type: 'text', text: raw };
      });
  }

  function serializeBlocks(blocks, preserveTextBreaks) {
    return (blocks || []).map(function (block) {
      if (block.type === 'heading') {
        var level = Number(block.level) === 3 ? 3 : 2;
        return '#'.repeat(level) + ' ' + String(block.text || '').trim();
      }
      if (block.type === 'image') {
        if (!block.src) return '';
        var caption = String(block.caption || '').trim();
        var alt = htmlEscape(block.alt || caption);
        var figure = '<figure class="article-body-image"><img src="' + htmlEscape(block.src) + '" alt="' + alt + '">';
        if (caption) figure += '<figcaption>' + htmlEscape(caption) + '</figcaption>';
        return figure + '</figure>';
      }
      var text = preserveTextBreaks
        ? String(block.text || '').replace(/^[ \t]+|[ \t]+$/g, '')
        : String(block.text || '').trim();
      if (preserveTextBreaks) {
        text = text.replace(/\n([ \t]{2,})\n/g, function (_match, indent) {
          return '\n' + indent + '\\\\\n';
        });
        text = text.replace(/\n{2,}/g, function (breaks) {
          return '\n' + '\\\\\n'.repeat(breaks.length - 1);
        });
      }
      return text;
    }).filter(Boolean).join('\n\n');
  }

  function renderMarkdownText(text) {
    return markdownToHtml(text);
  }

  function ensureStyle() {
    if (document.getElementById('sonar-article-body-css')) return;
    var style = document.createElement('style');
    style.id = 'sonar-article-body-css';
    style.textContent = [
      '.sonar-body-editor{border:1px solid #d5d9e0;border-radius:8px;background:#fff;color:#253044;overflow:hidden;font-family:Helvetica,Arial,sans-serif;}',
      '.sonar-body-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:10px;background:#f1f3f6;border-bottom:1px solid #d5d9e0;}',
      '.sonar-body-toolbar button,.sonar-body-block button{border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#283448;padding:7px 10px;font-weight:700;cursor:pointer;}',
      '.sonar-body-toolbar button:hover,.sonar-body-block button:hover{border-color:#ff7900;color:#d65f00;}',
      '.sonar-body-hint{margin:0;padding:9px 12px;color:#667085;background:#fafbfc;font-size:12px;line-height:1.45;}',
      '.sonar-body-blocks{display:flex;flex-direction:column;gap:8px;padding:12px;}',
      '.sonar-body-block{border:1px solid #d9dee7;border-radius:7px;background:#fff;overflow:hidden;}',
      '.sonar-body-block-header{display:flex;align-items:center;gap:8px;padding:7px 9px;background:#f6f7f9;border-bottom:1px solid #e4e7ec;}',
      '.sonar-body-block-header strong{flex:1;color:#38445a;font-size:12px;}',
      '.sonar-body-block button{padding:4px 8px;font-size:11px;}',
      '.sonar-body-block textarea,.sonar-body-block input{display:block;width:calc(100% - 20px);box-sizing:border-box;margin:10px;padding:9px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font:14px/1.5 Helvetica,Arial,sans-serif;}',
      '.sonar-body-block textarea{min-height:100px;resize:vertical;}',
      '.sonar-body-block textarea.heading{min-height:58px;font-size:16px;font-weight:700;}',
      '.sonar-body-text-editor{min-height:100px;margin:10px;padding:10px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font:14px/1.6 Helvetica,Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;}',
      '.sonar-body-text-editor ul{margin:.5em 0;padding-inline-start:1.6em;list-style-type:disc;}',
      '.sonar-body-text-editor li{padding-inline-start:.2em;}',
      '.sonar-body-text-editor:focus{border-color:#ff7900;box-shadow:0 0 0 2px rgba(255,121,0,.16);}',
      '.sonar-body-format-toolbar{display:flex;gap:5px;padding:8px 10px 0;}',
      '.sonar-body-format-toolbar button{min-width:32px;padding:5px 8px;font-size:13px;}',
      '.sonar-body-format-toolbar button strong{font-weight:900;}',
      '.sonar-body-format-toolbar button em{font-style:italic;}',
      '.sonar-body-format-toolbar button u{text-decoration:underline;}',
      '.sonar-intro-editor{padding:10px;border:1px solid #d5d9e0;border-radius:8px;background:#fff;color:#253044;}',
      '.sonar-intro-label,.sonar-intro-caption-label{display:flex;flex-direction:column;gap:6px;color:#38445a;font-size:12px;font-weight:700;}',
      '.sonar-intro-label select,.sonar-intro-caption-label input,.sonar-intro-text{box-sizing:border-box;width:100%;padding:9px;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#182230;font:14px/1.5 Helvetica,Arial,sans-serif;}',
      '.sonar-intro-text{min-height:90px;margin-top:10px;resize:vertical;}',
      '.sonar-intro-image{display:grid;grid-template-columns:minmax(120px,220px) minmax(0,1fr);gap:12px;margin-top:10px;align-items:start;}',
      '.sonar-intro-image img,.sonar-intro-placeholder{display:flex;width:100%;height:130px;object-fit:cover;border-radius:5px;background:#eef0f4;align-items:center;justify-content:center;color:#667085;font-size:12px;}',
      '.sonar-intro-image-fields{display:flex;flex-direction:column;gap:8px;min-width:0;}',
      '.sonar-intro-image-fields button{align-self:flex-start;border:1px solid #cbd2dc;border-radius:5px;background:#fff;color:#283448;padding:7px 10px;font-weight:700;cursor:pointer;}',
      '.sonar-intro-path{margin:0;color:#667085;font-size:11px;overflow-wrap:anywhere;}',
      '.sonar-intro-preview{max-width:760px;margin:0 0 20px;}',
      '.sonar-intro-preview img{display:block;max-width:100%;max-height:300px;object-fit:cover;}',
      '.sonar-intro-preview figcaption{margin-top:5px;color:#667085;font-size:12px;font-style:italic;}',
      '.sonar-body-image-fields{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;padding:10px;align-items:start;}',
      '.sonar-body-image-fields img,.sonar-body-image-placeholder{width:120px;height:90px;object-fit:cover;border-radius:5px;background:#eef0f4;}',
      '.sonar-body-image-fields .image-meta{min-width:0;color:#667085;font-size:12px;overflow-wrap:anywhere;}',
      '.sonar-body-image-fields input{width:100%;margin:0 0 7px;}',
      '.sonar-body-empty{padding:24px;text-align:center;color:#667085;font-size:13px;}',
      '.sonar-body-preview h2{margin:1.6em 0 .7em;font-size:1.5em;}',
      '.sonar-body-preview h3{margin:1.4em 0 .6em;font-size:1.2em;}',
      '.sonar-body-preview ul{margin:.65em 0;padding-inline-start:1.6em;list-style-type:disc;}',
      '.sonar-body-preview li{padding-inline-start:.2em;line-height:1.6;}',
      '.sonar-body-preview figure{margin:1.5em 0;}',
      '.sonar-body-preview img{display:block;max-width:100%;max-height:420px;object-fit:contain;}',
      '.sonar-body-preview figcaption{margin-top:6px;color:#667085;font-size:12px;font-style:italic;}',
      '.sonar-body-preview p{white-space:pre-wrap;line-height:1.6;}',
      '@media(max-width:600px){.sonar-body-image-fields,.sonar-intro-image{grid-template-columns:1fr}.sonar-body-image-fields img,.sonar-body-image-placeholder{width:100%;height:150px}}'
    ].join('');
    style.textContent += '.sonar-intro-editor select:focus,.sonar-intro-editor input:focus,.sonar-intro-editor textarea:focus,.sonar-intro-image-fields button:focus{outline:2px solid #ff7900;outline-offset:1px;}';
    document.head.appendChild(style);
  }

  function register(CMS, createClass, h) {
    if (!CMS || !createClass || !h || global.__SONAR_ARTICLE_BODY) return;
    global.__SONAR_ARTICLE_BODY = true;
    ensureStyle();
    registerIntro(CMS, createClass, h);

    function createControl(allowImages) {
      return createClass({
      getInitialState: function () {
        this._lastValue = valueAsString(this.props.value);
        return { blocks: parseBlocks(this._lastValue) };
      },

      blocks: function () {
        return this.state.blocks || parseBlocks(valueAsString(this.props.value));
      },

      emit: function (blocks) {
        var clean = blocks.map(function (block) { return Object.assign({}, block); });
        var markdown = serializeBlocks(clean, !allowImages);
        this._lastEmitted = markdown;
        this.setState({ blocks: clean });
        this.props.onChange(markdown);
      },

      addBlock: function (type) {
        if (type === 'image' && !allowImages) return;
        var blocks = this.blocks().slice();
        if (type === 'heading') blocks.push({ id: uid(), type: 'heading', level: 2, text: '' });
        else if (type === 'image') blocks.push({ id: uid(), type: 'image', src: '', alt: '', caption: '' });
        else blocks.push({ id: uid(), type: 'text', text: '' });
        this.emit(blocks);
      },

      updateBlock: function (id, patch) {
        this.emit(this.blocks().map(function (block) {
          return block.id === id ? Object.assign({}, block, patch) : block;
        }));
      },

      moveBlock: function (index, offset) {
        var blocks = this.blocks().slice();
        var target = index + offset;
        if (target < 0 || target >= blocks.length) return;
        var moving = blocks.splice(index, 1)[0];
        blocks.splice(target, 0, moving);
        this.emit(blocks);
      },

      removeBlock: function (id) {
        this.emit(this.blocks().filter(function (block) { return block.id !== id; }));
      },

      chooseImage: function (id) {
        this._pendingImageId = id;
        this._pickingImage = true;
        this._lastPick = null;
        if (typeof this.props.onOpenMediaLibrary === 'function') {
          this.props.onOpenMediaLibrary({
            controlID: this.props.forID,
            forImage: true,
            value: '',
            allowMultiple: false,
            field: this.props.field
          });
        } else {
          var src = global.prompt('Chemin ou URL de l’image', '/assets/uploads/');
          if (src) this.updateBlock(id, { src: src });
        }
      },

      componentDidUpdate: function () {
        var incoming = valueAsString(this.props.value);
        if (incoming !== this._lastEmitted && incoming !== this._lastValue) {
          var previousBlocks = this.state.blocks || parseBlocks(this._lastValue);
          var parsedBlocks = parseBlocks(incoming).map(function (block, index) {
            var previous = previousBlocks[index];
            return previous && previous.type === block.type
              ? Object.assign({}, block, { id: previous.id })
              : block;
          });
          this._lastValue = incoming;
          this.setState({ blocks: parsedBlocks });
          return;
        }
        var paths = this.props.mediaPaths;
        if (!this._pickingImage || !paths || !paths.get) return;
        var raw = paths.get(this.props.forID);
        if (raw == null || raw === '') return;
        var token = String(raw);
        if (token === this._lastPick) return;
        this._lastPick = token;
        this._pickingImage = false;
        var blockId = this._pendingImageId;
        var selected = typeof raw.toJS === 'function' ? raw.toJS() : raw;
        var src = Array.isArray(selected) ? selected[0] : selected;
        if (blockId && src) this.updateBlock(blockId, { src: String(src) });
      },

      renderBlock: function (block, index, total) {
        var self = this;
        var labels = { text: 'Paragraphe', heading: 'Intertitre', image: 'Image' };
        var fields = [];
        if (block.type === 'heading') {
          fields.push(h('select', {
            key: 'level',
            value: Number(block.level) === 3 ? '3' : '2',
            'aria-label': 'Niveau de l’intertitre',
            onChange: function (event) { self.updateBlock(block.id, { level: Number(event.target.value) }); }
          },
            h('option', { value: '2' }, 'Intertitre principal'),
            h('option', { value: '3' }, 'Intertitre secondaire')
          ));
          fields.push(h('textarea', {
            key: 'text',
            className: 'heading',
            placeholder: 'Écris ton intertitre…',
            value: block.text || '',
            onChange: function (event) { self.updateBlock(block.id, { text: event.target.value }); }
          }));
        } else if (block.type === 'image') {
          fields.push(h('div', { key: 'image', className: 'sonar-body-image-fields' },
            block.src
              ? h('img', { src: global.SonarCmsMedia && global.SonarCmsMedia.url ? global.SonarCmsMedia.url(block.src) : block.src, alt: '' })
              : h('div', { className: 'sonar-body-image-placeholder' }),
            h('div', { className: 'image-meta' },
              h('button', { type: 'button', onClick: function () { self.chooseImage(block.id); } }, block.src ? 'Changer l’image' : 'Choisir une image'),
              block.src && h('p', {}, block.src),
              h('input', {
                type: 'text',
                placeholder: 'Description pour lecteurs d’écran (facultative)',
                title: 'Décrit brièvement l’image aux personnes qui utilisent un lecteur d’écran.',
                value: block.alt || '',
                onChange: function (event) { self.updateBlock(block.id, { alt: event.target.value }); }
              }),
              h('input', {
                type: 'text',
                placeholder: 'Légende (facultative)',
                value: block.caption || '',
                onChange: function (event) { self.updateBlock(block.id, { caption: event.target.value }); }
              })
            )
          ));
        } else {
          var formatButton = function (label, command, ariaLabel) {
            return h('button', {
              type: 'button',
              title: ariaLabel,
              'aria-label': ariaLabel,
              onMouseDown: function (event) { event.preventDefault(); },
              onClick: function (event) {
                var editor = event.currentTarget.closest('.sonar-body-block').querySelector('[contenteditable="true"]');
                editor.focus();
                document.execCommand(command, false);
                editor.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, label);
          };
          fields.push(h('div', { key: 'formatting', className: 'sonar-body-format-toolbar', role: 'toolbar', 'aria-label': 'Mise en forme du paragraphe' },
            formatButton(h('strong', {}, 'G'), 'bold', 'Gras'),
            formatButton(h('em', {}, 'I'), 'italic', 'Italique'),
            formatButton(h('u', {}, 'S'), 'underline', 'Souligné'),
            formatButton('•', 'insertUnorderedList', 'Liste à puces')
          ));
          fields.push(h('div', {
            key: 'text',
            className: 'sonar-body-text-editor',
            contentEditable: true,
            suppressContentEditableWarning: true,
            role: 'textbox',
            'aria-label': 'Texte du paragraphe',
            'aria-multiline': 'true',
            'data-block-id': block.id,
            ref: function (editor) {
              if (!editor) return;
              var formatFocusedEditor = self._renderFocusedEditorId === block.id;
              if (self._focusedEditorId === block.id && !formatFocusedEditor) return;
              var text = String(block.text || '');
              if (editor.getAttribute('data-rendered-text') !== text) {
                editor.innerHTML = markdownToHtml(text);
                editor.setAttribute('data-rendered-text', text);
              }
              if (formatFocusedEditor) {
                self._renderFocusedEditorId = null;
                var lastItem = editor.querySelector('li:last-child');
                var range = document.createRange();
                range.selectNodeContents(lastItem || editor);
                range.collapse(false);
                var selection = global.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
              }
            },
            onFocus: function (event) {
              self._focusedEditorId = block.id;
            },
            onInput: function (event) {
              var editor = event.currentTarget;
              var markdown = htmlToMarkdown(editor);
              if (allowImages) markdown = markdown.replace(/\n+$/, '');
              var selection = global.getSelection();
              var anchor = selection && selection.anchorNode;
              var anchorElement = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
              var editingListItem = anchorElement && anchorElement.closest && anchorElement.closest('li');
              var currentLine = anchor && anchor.nodeType === 3
                ? anchor.nodeValue.slice(0, selection.anchorOffset).split('\n').pop()
                : '';
              if (!allowImages && !editingListItem && /^\s*[*+-]\s$/.test(currentLine)) {
                self._renderFocusedEditorId = block.id;
              }
              self.updateBlock(block.id, { text: markdown });
            },
            onKeyDown: function (event) {
              if (!allowImages && event.key === 'Enter' && event.shiftKey) {
                event.preventDefault();
                document.execCommand('insertLineBreak', false);
                event.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
              }
            },
            onBlur: function (event) {
              var markdown = htmlToMarkdown(event.currentTarget);
              if (allowImages) markdown = markdown.replace(/\n+$/, '');
              self._focusedEditorId = null;
              self._renderFocusedEditorId = null;
              self.updateBlock(block.id, { text: markdown });
            }
          }));
        }

        return h('section', { key: block.id, className: 'sonar-body-block' },
          h('div', { className: 'sonar-body-block-header' },
            h('strong', {}, (index + 1) + '. ' + labels[block.type]),
            h('button', { type: 'button', disabled: index === 0, onClick: function () { self.moveBlock(index, -1); }, 'aria-label': 'Monter le bloc' }, '↑'),
            h('button', { type: 'button', disabled: index === total - 1, onClick: function () { self.moveBlock(index, 1); }, 'aria-label': 'Descendre le bloc' }, '↓'),
            h('button', { type: 'button', onClick: function () { self.removeBlock(block.id); } }, 'Supprimer')
          ),
          fields
        );
      },

      render: function () {
        var self = this;
        var blocks = this.blocks();
        return h('div', {
          className: 'sonar-body-editor',
          ref: function (node) { self._editorNode = node; }
        },
          h('div', { className: 'sonar-body-toolbar' },
            h('button', { type: 'button', onClick: function () { self.addBlock('text'); } }, '+ Paragraphe'),
            h('button', { type: 'button', onClick: function () { self.addBlock('heading'); } }, '+ Intertitre'),
            allowImages && h('button', { type: 'button', onClick: function () { self.addBlock('image'); } }, '+ Image')
          ),
          h('p', { className: 'sonar-body-hint' }, 'La mise en forme apparaît directement pendant la saisie. Markdown : **gras**, *italique*, __souligné__. Sélectionne un texte puis utilise les boutons, dont « Liste à puces ». Le contenu existant est conservé.' + (allowImages ? '' : ' Entrée ajoute une nouvelle ligne ou une puce ; Maj+Entrée fait un retour à la ligne dans une puce. « + Paragraphe » crée un bloc distinct.')),
          h('div', { className: 'sonar-body-blocks' },
            blocks.length
              ? blocks.map(function (block, index) { return self.renderBlock(block, index, blocks.length); })
              : h('p', { className: 'sonar-body-empty' }, allowImages
                ? 'Commence par ajouter un paragraphe, un intertitre ou une image.'
                : 'Commence par ajouter un paragraphe ou un intertitre.')
          )
        );
      }
      });
    }

    var Control = createControl(true);
    var ShortControl = createControl(false);

    function previewTextNodes(text) {
      var output = [];
      var paragraphLines = [];
      var listItems = [];
      function flushParagraph() {
        if (!paragraphLines.length) return;
        output.push({
          paragraph: true,
          html: '<p>' + paragraphLines.map(function (line) {
            return line === '\u0000' ? '<br/>' : renderMarkdownText(line);
          }).join('<br/>') + '</p>'
        });
        paragraphLines = [];
      }
      function flushList() {
        if (!listItems.length) return;
        output.push({
          paragraph: false,
          html: '<ul>' + listItems.map(function (item) {
            return '<li>' + renderMarkdownText(item) + '</li>';
          }).join('') + '</ul>'
        });
        listItems = [];
      }
      String(text || '').split('\n').forEach(function (line) {
        var item = line.match(/^\s*[*+-]\s+([\s\S]*)$/);
        if (item) {
          flushParagraph();
          listItems.push(item[1]);
        } else if (listItems.length && /^\s{2,}/.test(line)) {
          var continuation = line.replace(/^\s{2}/, '');
          listItems[listItems.length - 1] += continuation.trim() === '\\\\' ? '\n' : '\n' + continuation;
        } else if (line.trim() === '\\\\') {
          flushList();
          paragraphLines.push('\u0000');
        } else {
          flushList();
          paragraphLines.push(line);
        }
      });
      flushParagraph();
      flushList();
      return output;
    }

    function Preview(props) {
      var blocks = parseBlocks(valueAsString(props.value));
      var nodes = [];
      blocks.forEach(function (block) {
        if (block.type === 'heading') {
          var level = Number(block.level) === 3 ? 3 : 2;
          nodes.push(h(level === 3 ? 'h3' : 'h2', { key: block.id }, block.text));
        } else if (block.type === 'image') {
          if (block.src) {
            var imageUrl = global.SonarCmsMedia && global.SonarCmsMedia.url
              ? global.SonarCmsMedia.url(block.src) || block.src
              : block.src;
            nodes.push(h('figure', { key: block.id },
              h('img', { src: imageUrl, alt: block.alt || '' }),
              block.caption && h('figcaption', {}, block.caption)
            ));
          }
        } else {
          var textNodes = previewTextNodes(block.text).map(function (node, index) {
            return h(node.paragraph ? 'p' : 'div', {
              key: block.id + '-' + index,
              dangerouslySetInnerHTML: { __html: node.html.replace(/^<p>|<\/p>$/g, '') }
            });
          });
          if (textNodes.length) {
            nodes.push(h('div', { key: block.id, className: 'article-body-text-block' }, textNodes));
          }
        }
      });
      return h('div', { className: 'sonar-body-preview' }, nodes);
    }

    CMS.registerWidget('article-body', Control, Preview);
    CMS.registerWidget('article-short-body', ShortControl, Preview);
  }

  global.SonarArticleBody = { register: register };

  function boot() {
    if (global.CMS && global.createClass && global.h) register(global.CMS, global.createClass, global.h);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
