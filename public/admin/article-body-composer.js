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
    function isLineBreak(child) {
      return child && child.nodeType === 1 && child.tagName.toLowerCase() === 'br';
    }
    var content = childNodes.map(function (child, index) {
      var previous = childNodes[index - 1];
      var blockTags = ['div', 'p', 'ul', 'ol'];
      var childIsBlock = child.nodeType === 1 && blockTags.indexOf(child.tagName.toLowerCase()) !== -1;
      var previousIsBlock = previous && previous.nodeType === 1 && blockTags.indexOf(previous.tagName.toLowerCase()) !== -1;
      var previousIsLineBreak = isLineBreak(previous);
      var childIsLineBreak = isLineBreak(child);
      if (childIsLineBreak && previousIsLineBreak) return '';
      var lineBreaks = htmlToMarkdown(child);
      if (childIsLineBreak) {
        var breakCount = 1;
        while (isLineBreak(childNodes[index + breakCount])) breakCount += 1;
        lineBreaks = '\n\\\\\n'.repeat(Math.floor(breakCount / 2)) + (breakCount % 2 ? '\n' : '');
      }
      return (index > 0 && (childIsBlock || previousIsBlock) && !previousIsLineBreak && !childIsLineBreak
        ? '\n' : '') + lineBreaks;
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

  function mediaPathToken(value) {
    var plain = value && typeof value.toJS === 'function' ? value.toJS() : value;
    try { return JSON.stringify(plain); } catch (e) { return String(plain); }
  }

  function mediaPathSource(value) {
    var plain = value && typeof value.toJS === 'function' ? value.toJS() : value;
    var item = Array.isArray(plain) ? plain[0] : plain;
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';
    return String(item.path || item.src || item.url || item.id || '').trim();
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
        var controlID = String(this.props.forID || '');
        var paths = this.props.mediaPaths;
        var existing = paths && paths.get ? paths.get(this.props.forID) : paths && paths[this.props.forID];
        var selected = global.SonarCmsMedia && typeof global.SonarCmsMedia.controlMedia === 'function'
          ? global.SonarCmsMedia.controlMedia(controlID)
          : null;
        this._pickingImage = true;
        this._lastPick = mediaPathToken(selected == null ? existing : selected);
        this.startMediaPickPolling();
        if (typeof this.props.onOpenMediaLibrary === 'function') {
          this.props.onOpenMediaLibrary({
            controlID: this.props.forID,
            forImage: true,
            value: '',
            allowMultiple: false,
            field: this.props.field
          });
          this.checkPickedImage();
        } else {
          this.stopMediaPickPolling();
          this._pickingImage = false;
          var src = global.prompt('Chemin ou URL de l’image', '/assets/uploads/');
          if (src) this.emit({ image: src });
        }
      },
      startMediaPickPolling: function () {
        if (this._mediaPickTimer) return;
        this._mediaPickTimer = global.setInterval(this.checkPickedImage.bind(this), 150);
        this._mediaPickTimeout = global.setTimeout(function () {
          this.stopMediaPickPolling();
          this._pickingImage = false;
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
      checkPickedImage: function () {
        if (!this._pickingImage) return;
        var paths = this.props.mediaPaths;
        var raw = paths && paths.get ? paths.get(this.props.forID) : paths && paths[this.props.forID];
        var controlID = String(this.props.forID || '');
        var selected = global.SonarCmsMedia && typeof global.SonarCmsMedia.controlMedia === 'function'
          ? global.SonarCmsMedia.controlMedia(controlID)
          : null;
        if (selected != null && selected !== '') raw = selected;
        if (raw == null || raw === '') return;
        var token = mediaPathToken(raw);
        if (token === this._lastPick) return;
        this._lastPick = token;
        var src = mediaPathSource(raw);
        if (!src) return;
        this._pickingImage = false;
        this.stopMediaPickPolling();
        this.emit({ image: src });
      },
      componentDidUpdate: function () {
        this.checkPickedImage();
      },
      componentWillUnmount: function () {
        this.stopMediaPickPolling();
      },
      render: function () {
        var self = this;
        var intro = this.intro();
        var imageUrl = intro.image && global.SonarCmsMedia && global.SonarCmsMedia.url
          ? global.SonarCmsMedia.url(intro.image)
          : intro.image;
        return h('div', {
          className: 'sonar-intro-editor',
          'data-sonar-editor-field': widgetFieldName(this.props.field, this.props.forID)
        },
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
      var fieldName = widgetFieldName(props.field, props.forID);
      if (intro.mode === 'image' && intro.image) {
        var src = global.SonarCmsMedia && global.SonarCmsMedia.url
          ? global.SonarCmsMedia.url(intro.image)
          : intro.image;
        return h('figure', {
          className: 'sonar-intro-preview',
          'data-sonar-editor-field': fieldName
        },
          h('img', { src: src, alt: '' }),
          intro.caption && h('figcaption', {}, intro.caption)
        );
      }
      return intro.text ? h('p', {
        className: 'sonar-intro-text-preview',
        'data-sonar-editor-field': fieldName
      }, intro.text) : null;
    }
    CMS.registerWidget('article-intro', Control, Preview);
  }

  function encodeEditorTitle(title) {
    return String(title || '').trim().split('').map(function (character) {
      return ('0000' + character.charCodeAt(0).toString(16)).slice(-4);
    }).join('-');
  }

  function decodeEditorTitle(encoded) {
    if (!/^[0-9a-f]{4}(?:-[0-9a-f]{4})*$/i.test(encoded)) return '';
    return encoded.split('-').map(function (code) {
      return String.fromCharCode(parseInt(code, 16));
    }).join('');
  }

  function parseBlocks(markdown) {
    return String(markdown || '')
      .split(/\n\s*\n/)
      .map(function (raw) {
        raw = raw.trim();
        if (!raw) return null;
        var editorTitle = '';
        var titleMarker = raw.match(/^<!--sonar-editor-title:([0-9a-f]{4}(?:-[0-9a-f]{4})*)-->(?:\r?\n)?/i);
        if (titleMarker) {
          editorTitle = decodeEditorTitle(titleMarker[1]);
          raw = raw.slice(titleMarker[0].length).trim();
        }
        if (!raw) {
          return editorTitle ? { id: uid(), type: 'text', text: '', editorTitle: editorTitle } : null;
        }

        var block;
        var heading = raw.match(/^(#{2,3})\s+([\s\S]*)$/);
        if (heading) block = { id: uid(), type: 'heading', level: heading[1].length, text: heading[2] };
        else {
          var figure = raw.match(/^<figure class="article-body-image">\s*<img src="([^"]*)" alt="([^"]*)"\s*\/?>(?:\s*<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>$/i);
          if (figure) {
            block = {
              id: uid(),
              type: 'image',
              src: figure[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
              alt: figure[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
              caption: (figure[3] || '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            };
          } else {
            var image = raw.match(/^!\[([^\]]*)\]\((<?)([^)\s>]+)>?\)$/);
            block = image
              ? { id: uid(), type: 'image', src: image[3], alt: image[1], caption: '' }
              : { id: uid(), type: 'text', text: raw };
          }
        }
        if (editorTitle) block.editorTitle = editorTitle;
        return block;
      })
      .filter(Boolean);
  }

  function collapsedTextBlocks(blocks) {
    var collapsed = {};
    (blocks || []).forEach(function (block) {
      if (block.type === 'text') collapsed[block.id] = true;
    });
    return collapsed;
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
      var editorTitle = block.type === 'text' ? encodeEditorTitle(block.editorTitle) : '';
      return editorTitle
        ? '<!--sonar-editor-title:' + editorTitle + '-->' + (text ? '\n' + text : '')
        : text;
    }).filter(Boolean).join('\n\n');
  }

  function renderMarkdownText(text) {
    return markdownToHtml(text);
  }

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

  function markdownToPreviewHtml(markdown) {
    return parseBlocks(markdown).map(function (block) {
      if (block.type === 'heading') {
        var level = Number(block.level) === 3 ? 3 : 2;
        return '<h' + level + '>' + renderMarkdownText(block.text) + '</h' + level + '>';
      }
      if (block.type === 'image' && block.src) {
        var src = String(block.src);
        if (!/^(https?:\/\/|\/|[^:]+$)/i.test(src)) return '';
        return '<figure class="revue-figure"><img class="revue-image" src="' + htmlEscape(src) +
          '" alt="' + htmlEscape(block.alt || '') + '">' +
          (block.caption ? '<figcaption class="revue-caption">' + htmlEscape(block.caption) + '</figcaption>' : '') +
          '</figure>';
      }
      return previewTextNodes(block.text).map(function (node) { return node.html; }).join('');
    }).join('');
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
      '.sonar-body-block-header strong{flex:1;min-width:0;color:#38445a;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.sonar-body-block-header .sonar-body-block-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent;padding:0;color:#38445a;font-size:12px;font-weight:700;text-align:left;}',
      '.sonar-body-block-header .sonar-body-block-title:hover{border:0;background:transparent;color:#d65f00;text-decoration:underline;}',
      '.sonar-body-block-header input.sonar-body-block-title-editor{flex:1;min-width:0;width:auto;margin:0;padding:4px 6px;font-size:12px;font-weight:700;}',
      '.sonar-body-block-content.is-collapsed{display:none;}',
      '.sonar-body-block button{padding:4px 8px;font-size:11px;}',
      '.sonar-body-insert-menu{display:flex;flex:0 0 100%;gap:5px;padding:0 9px 7px;background:#f6f7f9;}',
      '.sonar-body-insert-menu button{padding:4px 8px;font-size:11px;}',
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
        var blocks = parseBlocks(this._lastValue);
        return {
          blocks: blocks,
          collapsedBlocks: collapsedTextBlocks(blocks),
          insertMenuBlockId: null,
          editingBlockTitleId: null
        };
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
        this.insertBlockAt(type, this.blocks().length);
      },

      insertBlockAt: function (type, index) {
        if (type === 'image' && !allowImages) return;
        var blocks = this.blocks().slice();
        var block;
        if (type === 'heading') block = { id: uid(), type: 'heading', level: 2, text: '' };
        else if (type === 'image') block = { id: uid(), type: 'image', src: '', alt: '', caption: '' };
        else block = { id: uid(), type: 'text', text: '' };
        blocks.splice(index, 0, block);
        this.setState({ insertMenuBlockId: null });
        this.emit(blocks);
      },

      toggleInsertMenu: function (blockId) {
        this.setState({ insertMenuBlockId: this.state.insertMenuBlockId === blockId ? null : blockId });
      },

      openInsertMenu: function (blockId, event) {
        event.preventDefault();
        this.setState({ insertMenuBlockId: blockId });
      },

      updateBlock: function (id, patch) {
        this.emit(this.blocks().map(function (block) {
          return block.id === id ? Object.assign({}, block, patch) : block;
        }));
      },

      finishBlockTitleEdit: function () {
        this.setState({ editingBlockTitleId: null });
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
        var collapsedBlocks = Object.assign({}, this.state.collapsedBlocks || {});
        delete collapsedBlocks[id];
        this.setState({ collapsedBlocks: collapsedBlocks, insertMenuBlockId: null });
        this.emit(this.blocks().filter(function (block) { return block.id !== id; }));
      },

      toggleBlock: function (id) {
        var collapsedBlocks = Object.assign({}, this.state.collapsedBlocks || {});
        if (collapsedBlocks[id]) delete collapsedBlocks[id];
        else collapsedBlocks[id] = true;
        this.setState({ collapsedBlocks: collapsedBlocks });
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
          var previousIds = {};
          previousBlocks.forEach(function (block) { previousIds[block.id] = true; });
          var parsedBlocks = parseBlocks(incoming).map(function (block, index) {
            var previous = previousBlocks[index];
            return previous && previous.type === block.type
              ? Object.assign({}, block, { id: previous.id })
              : block;
          });
          var collapsedBlocks = Object.assign({}, this.state.collapsedBlocks || {});
          parsedBlocks.forEach(function (block) {
            if (block.type === 'text' && !previousIds[block.id]) collapsedBlocks[block.id] = true;
          });
          this._lastValue = incoming;
          this.setState({ blocks: parsedBlocks, collapsedBlocks: collapsedBlocks });
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
        var summarySource = block.type === 'image'
          ? (block.caption || block.alt || '')
          : (block.text || '');
        var summary = String(summarySource)
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/^\s*[-+*]\s+/gm, '')
          .replace(/[*_`~]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (summary.length > 72) summary = summary.slice(0, 69).replace(/\s+$/, '') + '…';
        var collapsed = !!(this.state.collapsedBlocks && this.state.collapsedBlocks[block.id]);
        var insertMenuOpen = this.state.insertMenuBlockId === block.id;
        var paragraphNumber = block.type === 'text'
          ? this.blocks().slice(0, index + 1).filter(function (item) { return item.type === 'text'; }).length
          : 0;
        var paragraphTitle = block.type === 'text'
          ? String(block.editorTitle || '').trim() || 'Paragraphe ' + paragraphNumber
          : '';
        var title = block.type === 'text'
          ? paragraphTitle + (summary ? ' — ' + summary : '')
          : (index + 1) + '. ' + labels[block.type] + (summary ? ' — ' + summary : '');
        var editingTitle = block.type === 'text' && this.state.editingBlockTitleId === block.id;
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

        return h('section', {
          key: block.id,
          className: 'sonar-body-block',
          'data-sonar-editor-field': widgetFieldName(this.props.field, this.props.forID),
          'data-sonar-editor-index': index,
          onContextMenu: block.type === 'text'
            ? function (event) { self.openInsertMenu(block.id, event); }
            : undefined,
          onKeyDown: function (event) {
            if (event.key === 'Escape' && self.state.insertMenuBlockId === block.id) {
              event.stopPropagation();
              self.setState({ insertMenuBlockId: null });
            }
          }
        },
          h('div', { className: 'sonar-body-block-header' },
            h('button', {
              type: 'button',
              title: collapsed ? 'Déplier le bloc' : 'Replier le bloc',
              'aria-label': (collapsed ? 'Déplier ' : 'Replier ') + labels[block.type] + ' ' + (index + 1),
              'aria-expanded': !collapsed,
              onClick: function () { self.toggleBlock(block.id); }
            }, collapsed ? '▸' : '▾'),
            editingTitle
              ? h('input', {
                  type: 'text',
                  className: 'sonar-body-block-title-editor',
                  autoFocus: true,
                  maxLength: 100,
                  'aria-label': 'Titre de repérage du paragraphe ' + paragraphNumber,
                  value: block.editorTitle || paragraphTitle,
                  onChange: function (event) { self.updateBlock(block.id, { editorTitle: event.target.value }); },
                  onFocus: function (event) { event.currentTarget.select(); },
                  onBlur: function (event) {
                    self.updateBlock(block.id, { editorTitle: event.currentTarget.value.trim() });
                    self.finishBlockTitleEdit();
                  },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }
                })
              : block.type === 'text'
                ? h('button', {
                    type: 'button',
                    className: 'sonar-body-block-title',
                    title: 'Cliquer pour modifier le titre',
                    'aria-label': 'Modifier le titre du paragraphe ' + paragraphNumber,
                    onClick: function () { self.setState({ editingBlockTitleId: block.id }); }
                  }, title)
                : h('strong', { title: title }, title),
            block.type === 'text' && h('button', {
              type: 'button',
              title: 'Ou clic droit sur le paragraphe',
              'aria-label': 'Insérer un paragraphe près du paragraphe ' + (index + 1),
              'aria-expanded': insertMenuOpen,
              onClick: function () { self.toggleInsertMenu(block.id); }
            }, 'Insérer'),
            h('button', { type: 'button', disabled: index === 0, onClick: function () { self.moveBlock(index, -1); }, 'aria-label': 'Monter le bloc' }, '↑'),
            h('button', { type: 'button', disabled: index === total - 1, onClick: function () { self.moveBlock(index, 1); }, 'aria-label': 'Descendre le bloc' }, '↓'),
            h('button', { type: 'button', onClick: function () { self.removeBlock(block.id); } }, 'Supprimer')
          ),
          insertMenuOpen && h('div', {
            className: 'sonar-body-insert-menu',
            role: 'group',
            'aria-label': 'Position du nouveau paragraphe'
          },
            h('button', { type: 'button', onClick: function () { self.insertBlockAt('text', index); } }, 'Ajouter avant'),
            h('button', { type: 'button', onClick: function () { self.insertBlockAt('text', index + 1); } }, 'Ajouter après')
          ),
          h('div', {
            className: 'sonar-body-block-content' + (collapsed ? ' is-collapsed' : '')
          }, fields)
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
          h('p', { className: 'sonar-body-hint' }, 'La mise en forme apparaît directement pendant la saisie. Markdown : **gras**, *italique*, __souligné__. Sélectionne un texte puis utilise les boutons, dont « Liste à puces ». Clique sur le titre d’un paragraphe pour modifier son nom de repérage. Le contenu existant est conservé.' + (allowImages ? '' : ' Entrée ajoute une nouvelle ligne ou une puce ; Maj+Entrée fait un retour à la ligne dans une puce. « + Paragraphe » crée un bloc distinct.')),
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

    function Preview(props) {
      var blocks = parseBlocks(valueAsString(props.value));
      var fieldName = widgetFieldName(props.field, props.forID);
      var nodes = [];
      blocks.forEach(function (block, index) {
        if (block.type === 'heading') {
          var level = Number(block.level) === 3 ? 3 : 2;
          nodes.push(h(level === 3 ? 'h3' : 'h2', {
            key: block.id,
            'data-sonar-editor-field': fieldName,
            'data-sonar-editor-index': index
          }, block.text));
        } else if (block.type === 'image') {
          if (block.src) {
            var imageUrl = global.SonarCmsMedia && global.SonarCmsMedia.url
              ? global.SonarCmsMedia.url(block.src) || block.src
              : block.src;
            nodes.push(h('figure', {
              key: block.id,
              'data-sonar-editor-field': fieldName,
              'data-sonar-editor-index': index
            },
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
            nodes.push(h('div', {
              key: block.id,
              className: 'article-body-text-block',
              'data-sonar-editor-field': fieldName,
              'data-sonar-editor-index': index
            }, textNodes));
          }
        }
      });
      return h('div', { className: 'sonar-body-preview' }, nodes);
    }

    CMS.registerWidget('article-body', Control, Preview);
    CMS.registerWidget('article-short-body', ShortControl, Preview);
  }

  global.SonarArticleBody = {
    register: register,
    markdownToHtml: markdownToHtml,
    htmlToMarkdown: htmlToMarkdown,
    markdownToPreviewHtml: markdownToPreviewHtml
  };

  function boot() {
    if (global.CMS && global.createClass && global.h) register(global.CMS, global.createClass, global.h);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
