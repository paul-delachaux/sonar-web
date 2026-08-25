/**
 * Affiche uniquement les champs du type de bloc choisi (texte / image / audio)
 * dans l'éditeur Revues musicales.
 */
(function () {
  var TYPE_LABEL = 'type de bloc';

  function normalize(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function closestControl(node) {
    var el = node;
    while (el && el !== document.body) {
      if (el.className && String(el.className).indexOf('ControlContainer') !== -1) return el;
      el = el.parentElement;
    }
    return null;
  }

  function controlLabel(control) {
    var label = control && control.querySelector && control.querySelector('label');
    return normalize(label ? label.textContent : '');
  }

  function typeFromControl(control) {
    var label = control.querySelector('label');
    var raw = control.innerText || '';
    if (label) raw = raw.replace(label.textContent || '', '');
    raw = normalize(raw);
    if (raw.indexOf('audio') !== -1) return 'audio';
    if (raw.indexOf('image') !== -1) return 'image';
    if (raw.indexOf('texte') !== -1 || raw.indexOf('text') !== -1) return 'texte';
    return 'texte';
  }

  function shouldShow(label, type) {
    if (!label) return true;
    if (label === TYPE_LABEL) return true;
    if (type === 'texte') return label.indexOf('texte') !== -1;
    if (type === 'image') return label === 'image' || label.indexOf('image') === 0;
    if (type === 'audio') return label.indexOf('piste') !== -1;
    return true;
  }

  function applyVisibility() {
    var root = document.getElementById('nc-root');
    if (!root) return;
    var labels = root.querySelectorAll('label');
    for (var i = 0; i < labels.length; i += 1) {
      if (normalize(labels[i].textContent) !== TYPE_LABEL) continue;
      var typeControl = closestControl(labels[i]);
      if (!typeControl) continue;
      var type = typeFromControl(typeControl);
      var group = typeControl.parentElement;
      while (group && group !== document.body) {
        var childControls = [];
        var children = group.children;
        for (var j = 0; j < children.length; j += 1) {
          if (children[j].className && String(children[j].className).indexOf('ControlContainer') !== -1) {
            childControls.push(children[j]);
          }
        }
        if (childControls.length >= 3) {
          for (var k = 0; k < childControls.length; k += 1) {
            var child = childControls[k];
            if (child === typeControl) {
              child.style.display = '';
              continue;
            }
            child.style.display = shouldShow(controlLabel(child), type) ? '' : 'none';
          }
          break;
        }
        group = group.parentElement;
      }
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      applyVisibility();
    }, 80);
  }

  function start() {
    applyVisibility();
    document.addEventListener('click', schedule, true);
    document.addEventListener('change', schedule, true);
    document.addEventListener('keyup', schedule, true);
    if (document.body) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
