/* BeatGrid workspace controller. Plain browser JavaScript, no dependencies. */
(function () {
  'use strict';

  var R = window.BeatGrid;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MAX_TRACKS = 8;
  var MAX_HUE_SLOTS = 8;
  var SEQ_STEPS = ['--seq-100', '--seq-200', '--seq-300', '--seq-400', '--seq-500', '--seq-600', '--seq-700'];

  var state = {
    bpm: 120,
    ppq: 480,
    gate: 0.5,
    title: 'BeatGrid Study',
    tracks: [],
    nextId: 1,
    analysis: null,
    midi: null,
    lily: '',
    texture: false
  };

  var play = { on: false, step: 0, carry: 0, last: 0, raf: 0 };

  /* ---------- small DOM helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        if (key === 'className') node.className = attrs[key];
        else if (key === 'style') node.setAttribute('style', attrs[key]);
        else if (key === 'dataset') {
          for (var d in attrs[key]) node.dataset[d] = attrs[key][d];
        } else if (attrs[key] !== null && attrs[key] !== undefined) {
          node.setAttribute(key, String(attrs[key]));
        }
      }
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function svgEl(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
      if (key === 'className') node.setAttribute('class', attrs[key]);
      else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, String(attrs[key]));
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function seriesColor(slot) {
    return cssVar('--series-' + ((slot % MAX_HUE_SLOTS) + 1)) || '#2a78d6';
  }

  function seqColor(fraction) {
    var index = Math.min(SEQ_STEPS.length - 1, Math.max(0, Math.round(fraction * (SEQ_STEPS.length - 1))));
    return cssVar(SEQ_STEPS[index]) || '#2a78d6';
  }

  function fmt(value, digits) {
    return Number(value).toFixed(digits === undefined ? 2 : digits);
  }

  /* ---------- track model ---------- */

  function makeTrack(config) {
    var c = config || {};
    var pulses = c.pulses === undefined ? (c.pattern ? c.pattern.filter(Boolean).length : 3) : c.pulses;
    var steps = c.steps === undefined ? (c.pattern ? c.pattern.length : 8) : c.steps;
    var rotation = c.rotation === undefined ? 0 : c.rotation;
    var id = state.nextId++;
    return {
      id: id,
      name: c.name || 'Track ' + id,
      pulses: pulses,
      steps: steps,
      rotation: rotation,
      note: c.note === undefined ? 36 : c.note,
      channel: c.channel === undefined ? 9 : c.channel,
      velocity: c.velocity === undefined ? 96 : c.velocity,
      manual: c.pattern ? c.pattern.slice() : null,
      colorSlot: 0
    };
  }

  function addTrack(config) {
    if (state.tracks.length >= MAX_TRACKS) return false;
    var t = makeTrack(config);
    t.colorSlot = state.tracks.length % MAX_HUE_SLOTS;
    state.tracks.push(t);
    return true;
  }

  function toEngineTracks() {
    return state.tracks.map(function (t) {
      var base = { name: t.name, note: t.note, channel: t.channel, velocity: t.velocity };
      if (t.manual) {
        base.pattern = t.manual.slice();
        base.formula = 'Manual ' + t.manual.length + ' steps';
      } else {
        base.pulses = t.pulses;
        base.steps = t.steps;
        base.rotation = t.rotation;
        base.formula = 'E(' + t.pulses + ',' + t.steps + ',' + t.rotation + ')';
      }
      return base;
    });
  }

  function formulaFor(t) {
    return t.manual ? 'Manual ' + t.manual.length + ' steps' : 'E(' + t.pulses + ',' + t.steps + ',' + t.rotation + ')';
  }

  function patternFor(t) {
    return t.manual ? t.manual.slice() : R.euclideanRhythm(t.pulses, t.steps, t.rotation);
  }

  /* ---------- downloads ---------- */

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = el('a', { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function safeFilename(title, extension) {
    var base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'beatgrid';
    return base + '.' + extension;
  }

  /* ---------- tooltip ---------- */

  var tooltip = null;

  function showTooltip(target, lines) {
    if (!tooltip) tooltip = $('wheelTooltip');
    clear(tooltip);
    tooltip.appendChild(el('strong', {}, lines.title));
    lines.rows.forEach(function (row) {
      var line = el('div', { className: 'tt-row' });
      if (row.color) line.appendChild(el('span', { className: 'tt-key', style: 'background:' + row.color }));
      line.appendChild(el('span', {}, row.text));
      tooltip.appendChild(line);
    });
    tooltip.hidden = false;
    var box = target.getBoundingClientRect();
    var left = box.left + box.width / 2 + 12;
    var top = box.top - 8;
    var maxLeft = window.innerWidth - tooltip.offsetWidth - 12;
    if (left > maxLeft) left = Math.max(12, box.left - tooltip.offsetWidth - 12);
    tooltip.style.left = left + 'px';
    tooltip.style.top = Math.max(8, Math.min(top, window.innerHeight - tooltip.offsetHeight - 12)) + 'px';
  }

  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  /* ---------- controls ---------- */

  function renderPresets() {
    var row = $('presetRow');
    R.PRESETS.forEach(function (preset) {
      var chip = el('button', { type: 'button', className: 'preset-chip', title: preset.description });
      chip.appendChild(el('b', {}, preset.name));
      chip.appendChild(document.createTextNode(' '));
      chip.appendChild(el('em', {}, preset.formula));
      chip.addEventListener('click', function () {
        if (!addTrack(preset)) {
          flashNote('Maximum of ' + MAX_TRACKS + ' tracks');
          return;
        }
        recompute();
      });
      row.appendChild(chip);
    });
  }

  function flashNote(message) {
    $('sessionStatus').textContent = message;
  }

  function readControls() {
    var bpm = Number($('bpm').value);
    var ppq = Number($('ppq').value);
    if (!Number.isInteger(bpm) || bpm < 20 || bpm > 300) throw new RangeError('Tempo must be an integer from 20 to 300 BPM');
    if (!$('ppq').value.trim() || !Number.isInteger(ppq) || ppq < 24 || ppq > 960) throw new RangeError('Division must be an integer from 24 to 960');
    var gate = Number($('gate').value);
    if ([0.25, 0.5, 0.75, 1].indexOf(gate) === -1) throw new RangeError('Choose a note gate');
    state.bpm = bpm;
    state.ppq = ppq;
    state.gate = gate;
    state.title = $('title').value.trim() || 'BeatGrid Study';
  }

  /* ---------- step grid editor ---------- */

  function renderEditor() {
    var host = $('trackEditor');
    clear(host);
    state.tracks.forEach(function (t, index) {
      t.colorSlot = index % MAX_HUE_SLOTS;
      var row = el('div', { className: 'track-row' });

      var ident = el('div', { className: 'track-ident' });
      var nameLine = el('div', { className: 'track-name-line' });
      nameLine.appendChild(el('span', {
        className: 'series-swatch',
        style: 'background:' + seriesColor(t.colorSlot),
        'aria-hidden': 'true'
      }));
      var nameInput = el('input', {
        type: 'text',
        className: 'track-name-input',
        value: t.name,
        maxlength: 40,
        'aria-label': 'Track ' + (index + 1) + ' name'
      });
      nameInput.addEventListener('input', function () {
        t.name = nameInput.value || 'Track ' + (index + 1);
        recompute({ skipEditor: true });
      });
      nameLine.appendChild(nameInput);
      ident.appendChild(nameLine);
      ident.appendChild(el('span', { className: 'track-formula' }, formulaFor(t) + '  note ' + t.note));

      if (!t.manual) {
        var nums = el('div', { className: 'track-num-row' });
        nums.appendChild(numberField('k', t.pulses, 0, 64, function (v) {
          t.pulses = Math.min(v, t.steps);
          recompute();
        }));
        nums.appendChild(numberField('n', t.steps, 1, 64, function (v) {
          t.steps = Math.max(1, v);
          t.pulses = Math.min(t.pulses, t.steps);
          recompute();
        }));
        nums.appendChild(numberField('rot', t.rotation, -999, 999, function (v) {
          t.rotation = v;
          recompute();
        }));
        nums.appendChild(numberField('note', t.note, 0, 127, function (v) {
          t.note = v;
          recompute();
        }));
        ident.appendChild(nums);
      } else {
        ident.appendChild(el('span', { className: 'track-formula' }, 'Manual vector, click cells to edit'));
        var reset = el('button', { type: 'button', className: 'btn btn-ghost' }, 'Reset to Euclidean');
        reset.addEventListener('click', function () { t.manual = null; recompute(); });
        ident.appendChild(reset);
      }
      row.appendChild(ident);

      var pattern = patternFor(t);
      var scroll = el('div', { className: 'track-grid-scroll' });
      var cells = el('div', { className: 'track-cells', role: 'group', 'aria-label': t.name + ' steps' });
      pattern.forEach(function (value, step) {
        var cell = el('button', {
          type: 'button',
          className: 'step-cell' + (value ? ' is-on' : '') + (step % 4 === 0 ? ' is-downbeat' : '') + (step % 4 !== 0 && step % 2 === 0 ? ' is-beat' : ''),
          style: '--cell-color:' + seriesColor(t.colorSlot),
          'aria-label': t.name + ' step ' + (step + 1) + (value ? ' onset' : ' rest'),
          'aria-pressed': value ? 'true' : 'false'
        });
        cell.addEventListener('click', function () {
          var current = patternFor(t).slice();
          current[step] = current[step] ? 0 : 1;
          t.manual = current;
          recompute();
        });
        cells.appendChild(cell);
      });
      scroll.appendChild(cells);
      row.appendChild(scroll);

      var remove = el('button', { type: 'button', className: 'btn btn-ghost remove-btn', 'aria-label': 'Remove ' + t.name }, 'Remove');
      remove.addEventListener('click', function () {
        if (state.tracks.length <= 1) {
          flashNote('Keep at least one track');
          return;
        }
        state.tracks.splice(index, 1);
        recompute();
      });
      row.appendChild(remove);
      host.appendChild(row);
    });
    $('addTrackBtn').disabled = state.tracks.length >= MAX_TRACKS;
  }

  function numberField(label, value, min, max, onChange) {
    var wrap = el('label', { className: 'mini-field' }, label);
    var input = el('input', { type: 'number', min: min, max: max, step: 1, value: value, 'aria-label': label });
    wrap.appendChild(input);
    input.addEventListener('change', function () {
      var v = Number(input.value);
      if (!input.value.trim() || !Number.isSafeInteger(v)) { input.value = value; flashNote(label + ' must be an integer'); return; }
      v = Math.min(max, Math.max(min, v));
      input.value = v;
      onChange(v);
    });
    return wrap;
  }

  /* ---------- stat tiles ---------- */

  function renderStats(a) {
    $('statCycle').textContent = a.cycleSteps;
    $('statSeconds').textContent = fmt(a.cycleSeconds, 2);
    $('statCoincidence').textContent = a.coincidenceCount;
    $('statSync').textContent = a.syncopation.total;
  }

  /* ---------- wheel (concentric phase polygons) ---------- */

  function renderWheel(a) {
    var svg = $('wheelSvg');
    clear(svg);
    svg.appendChild(svgEl('title', { id: 'wheelTitle' }, 'Euclidean phase wheel'));
    svg.appendChild(svgEl('desc', { id: 'wheelDesc' }, 'One ring per voice over the shared cycle. Focus a marker to inspect its step.'));

    var defs = svgEl('defs');
    var pattern = svgEl('pattern', {
      id: 'bgTexture', width: 6, height: 6,
      patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)'
    });
    pattern.appendChild(svgEl('rect', { width: 6, height: 6, fill: 'transparent' }));
    pattern.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'rgba(0,0,0,0.45)', 'stroke-width': 2 }));
    defs.appendChild(pattern);
    svg.appendChild(defs);

    var size = 420;
    var cx = size / 2;
    var cy = size / 2;
    var maxRadius = 182;
    var minRadius = 46;
    var count = a.tracks.length;
    var ringCount = Math.min(count, MAX_HUE_SLOTS);
    var radiusStep = ringCount > 1 ? (maxRadius - minRadius) / (ringCount - 1) : 0;

    // Guide circles: recessive, solid hairlines.
    for (var r = 0; r < ringCount; r++) {
      var radius = ringCount > 1 ? minRadius + r * radiusStep : (minRadius + maxRadius) / 2;
      svg.appendChild(svgEl('circle', {
        cx: cx, cy: cy, r: radius,
        className: 'wheel-guide' + (r === ringCount - 1 ? ' is-baseline' : '')
      }));
    }

    // Twelve reference spokes for reading phase positions.
    for (var s = 0; s < 12; s++) {
      var ang = (s / 12) * Math.PI * 2 - Math.PI / 2;
      svg.appendChild(svgEl('line', {
        x1: cx + Math.cos(ang) * 26, y1: cy + Math.sin(ang) * 26,
        x2: cx + Math.cos(ang) * (maxRadius + 12), y2: cy + Math.sin(ang) * (maxRadius + 12),
        className: 'wheel-spoke'
      }));
      if (s % 3 === 0) {
        var lx = cx + Math.cos(ang) * (maxRadius + 26);
        var ly = cy + Math.sin(ang) * (maxRadius + 26);
        svg.appendChild(svgEl('text', {
          x: lx, y: ly + 3, className: 'wheel-tick', 'text-anchor': 'middle'
        }, (s / 12 * 100).toFixed(0) + '%'));
      }
    }

    // One ring per track. Shared angular axis: one full turn per LCM cycle.
    var dotStride = Math.max(1, Math.ceil(a.cycleSteps / 128));
    a.tracks.slice(0, MAX_HUE_SLOTS).forEach(function (track, i) {
      var radius = ringCount > 1 ? minRadius + i * radiusStep : (minRadius + maxRadius) / 2;
      var color = seriesColor(i);
      var onsetPoints = [];
      var markers = [];

      for (var step = 0; step < a.cycleSteps; step++) {
        var isOn = track.expanded[step] === 1;
        if (step % dotStride !== 0) continue;
        var theta = (step / a.cycleSteps) * Math.PI * 2 - Math.PI / 2;
        var px = cx + Math.cos(theta) * radius;
        var py = cy + Math.sin(theta) * radius;
        if (isOn) onsetPoints.push([px, py]);
        markers.push({ px: px, py: py, step: step, isOn: isOn });
      }

      if (onsetPoints.length >= 2) {
        var d = onsetPoints.map(function (p, k) {
          return (k ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
        }).join(' ') + (onsetPoints.length > 2 ? ' Z' : '');
        svg.appendChild(svgEl('path', { d: d, className: 'wheel-arc', stroke: color }));
      }

      markers.forEach(function (m) {
        var dot = svgEl('circle', {
          cx: m.px, cy: m.py, r: m.isOn ? 4.2 : 1.9,
          fill: m.isOn ? color : 'var(--surface-1)',
          className: 'wheel-dot' + (m.isOn ? '' : ' is-rest')
        });
        svg.appendChild(dot);

        var hit = svgEl('circle', { cx: m.px, cy: m.py, r: 10, className: 'wheel-hit', tabindex: 0, role: 'button' });
        var label = track.name + ', step ' + (m.step + 1) + ': ' + (m.isOn ? 'onset' : 'rest');
        hit.setAttribute('aria-label', label);
        var detail = {
          title: m.isOn ? 'Onset' : 'Rest',
          rows: [
            { color: color, text: track.name + ' (' + track.formula + ')' },
            { text: 'Step ' + (m.step + 1) + ' of ' + a.cycleSteps },
            { text: 'Phase ' + fmt(100 * m.step / a.cycleSteps, 1) + '%' }
          ]
        };
        hit.addEventListener('pointermove', function () { showTooltip(hit, detail); });
        hit.addEventListener('pointerleave', hideTooltip);
        hit.addEventListener('focus', function () { showTooltip(hit, detail); });
        hit.addEventListener('blur', hideTooltip);
        svg.appendChild(hit);
      });

      svg.appendChild(svgEl('text', {
        x: cx, y: cy - radius - 5, className: 'wheel-label', 'text-anchor': 'middle'
      }, 'T' + (i + 1)));
    });

    svg.appendChild(svgEl('text', { x: cx, y: cy - 4, className: 'wheel-center', 'text-anchor': 'middle' }, 'LCM ' + a.cycleSteps));
    svg.appendChild(svgEl('text', { x: cx, y: cy + 10, className: 'wheel-center', 'text-anchor': 'middle' }, 'steps'));

    $('wheelCaption').textContent = a.tracks.length + ' ring' + (a.tracks.length === 1 ? '' : 's') +
      ' over one ' + a.cycleSteps + '-step phase cycle (' + fmt(a.cycleSeconds, 2) + ' s). ' +
      'Inner ring is track 1. ' + (dotStride > 1 ? 'Markers sample every ' + dotStride + ' steps. ' : '') +
      'Export the session to preserve every step.';

    renderWheelLegend(a);
    renderWheelTable(a);
    if (play.on) updatePlayheadDom(a);
  }

  /* ---------- silent cycle playhead ---------- */

  function ensurePlayheadGroup() {
    var svg = $('wheelSvg');
    var g = document.getElementById('playheadG');
    if (g) return g;
    g = svgEl('g', { id: 'playheadG', className: 'wheel-playhead' });
    g.appendChild(svgEl('g', { id: 'playHits' }));
    g.appendChild(svgEl('line', { id: 'playLine', x1: 210, y1: 210, x2: 210, y2: 28 }));
    g.appendChild(svgEl('circle', { id: 'playDot', cx: 210, cy: 28, r: 5.5 }));
    svg.appendChild(g);
    return g;
  }

  function updatePlayheadDom(a) {
    ensurePlayheadGroup();
    play.step = play.step % a.cycleSteps;
    var theta = (play.step / a.cycleSteps) * Math.PI * 2 - Math.PI / 2;
    var x2 = 210 + Math.cos(theta) * 182;
    var y2 = 210 + Math.sin(theta) * 182;
    var line = document.getElementById('playLine');
    line.setAttribute('x2', x2.toFixed(2));
    line.setAttribute('y2', y2.toFixed(2));
    var dot = document.getElementById('playDot');
    dot.setAttribute('cx', x2.toFixed(2));
    dot.setAttribute('cy', y2.toFixed(2));
    var ringCount = Math.min(a.tracks.length, MAX_HUE_SLOTS);
    var ringStep = ringCount > 1 ? (182 - 46) / (ringCount - 1) : 0;
    var hits = document.getElementById('playHits');
    clear(hits);
    var voices = 0;
    var names = [];
    a.tracks.forEach(function (t, i) {
      if (t.expanded[play.step] !== 1 || i >= MAX_HUE_SLOTS) return;
      voices++; names.push(t.name);
      var radius = ringCount > 1 ? 46 + i * ringStep : 114;
      hits.appendChild(svgEl('circle', {
        cx: (210 + Math.cos(theta) * radius).toFixed(2),
        cy: (210 + Math.sin(theta) * radius).toFixed(2),
        r: 7.5, className: 'wheel-pulse', stroke: seriesColor(i)
      }));
    });
    var coincident = a.coincidenceSteps && a.coincidenceSteps.indexOf(play.step) !== -1;
    if (coincident) {
      hits.appendChild(svgEl('circle', { cx: x2.toFixed(2), cy: y2.toFixed(2), r: 10, className: 'wheel-coincidence' }));
    }
    $('playStatus').textContent = 'Step ' + (play.step + 1) + ' of ' + a.cycleSteps + ' - ' +
      voices + ' voice' + (voices === 1 ? '' : 's') + ' sounding' +
      (names.length ? ' (' + names.join(', ') + ')' : '') +
      (coincident ? ' - coincidence step' : '');
  }

  function playTick(now) {
    if (!play.on) return;
    var a = state.analysis;
    if (!a) { stopPlay(); return; }
    var dt = Math.max(0, (now - play.last) / 1000);
    play.last = now;
    play.carry += dt / a.secondsPerStep;
    var adv = Math.floor(play.carry);
    if (adv > 0) {
      play.carry -= adv;
      play.step = (play.step + adv) % a.cycleSteps;
      updatePlayheadDom(a);
    }
    play.raf = requestAnimationFrame(playTick);
  }

  function startPlay() {
    if (!state.analysis) return;
    if (play.raf) cancelAnimationFrame(play.raf);
    play.on = true;
    play.step = 0;
    play.carry = 0;
    play.last = performance.now();
    $('cyclePlayBtn').textContent = 'Stop cycle';
    $('cyclePlayBtn').setAttribute('aria-pressed', 'true');
    updatePlayheadDom(state.analysis);
    play.raf = requestAnimationFrame(playTick);
  }

  function stopPlay() {
    play.on = false;
    if (play.raf) { cancelAnimationFrame(play.raf); play.raf = 0; }
    var g = document.getElementById('playheadG');
    if (g) g.parentNode.removeChild(g);
    $('playStatus').textContent = '';
    $('cyclePlayBtn').textContent = 'Run cycle';
    $('cyclePlayBtn').setAttribute('aria-pressed', 'false');
  }

  function renderWheelLegend(a) {
    var host = $('wheelLegend');
    clear(host);
    a.tracks.slice(0, MAX_HUE_SLOTS).forEach(function (track, i) {
      var item = el('span', { className: 'legend-item' });
      item.appendChild(el('span', { className: 'legend-key', style: 'background:' + seriesColor(i), 'aria-hidden': 'true' }));
      item.appendChild(el('span', {}, 'T' + (i + 1) + ' ' + track.name));
      host.appendChild(item);
    });
  }

  function renderWheelTable(a) {
    var table = $('wheelTable');
    clear(table);
    table.appendChild(el('caption', { className: 'sr-only' }, 'Onset states by track and phase step'));
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', { scope: 'col' }, 'Step'));
    a.tracks.forEach(function (track, i) {
      hr.appendChild(el('th', { scope: 'col' }, 'T' + (i + 1) + ' ' + track.name));
    });
    hr.appendChild(el('th', { scope: 'col', className: 'num' }, 'Hits'));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    var show = Math.min(a.cycleSteps, 96);
    for (var s = 0; s < show; s++) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, String(s + 1)));
      var hits = 0;
      a.tracks.forEach(function (track) {
        var on = track.expanded[s] === 1;
        if (on) hits++;
        tr.appendChild(el('td', {}, on ? '1' : '0'));
      });
      tr.appendChild(el('td', { className: 'num' }, String(hits)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    if (show < a.cycleSteps) {
      var foot = el('tfoot');
      var fr = el('tr');
      var cell = el('td', { colspan: String(a.tracks.length + 2) },
        'Showing first ' + show + ' of ' + a.cycleSteps + ' steps. Matrices use the full cycle.');
      fr.appendChild(cell);
      foot.appendChild(fr);
      table.appendChild(foot);
    }
  }

  /* ---------- matrix tables ---------- */

  function renderMatrixTables(a) {
    var n = a.tracks.length;
    var maxCo = 0;
    a.coincidenceMatrix.forEach(function (row) {
      row.forEach(function (v) { if (v > maxCo) maxCo = v; });
    });

    var coTable = $('coincidenceTable');
    clear(coTable);
    coTable.appendChild(el('caption', { className: 'sr-only' }, 'Pairwise onset coincidence counts and rates'));
    var coHead = el('thead');
    var coHeadRow = el('tr');
    coHeadRow.appendChild(el('th', { scope: 'col' }, 'Track'));
    a.tracks.forEach(function (track, i) {
      coHeadRow.appendChild(el('th', { scope: 'col' }, 'T' + (i + 1)));
    });
    coHead.appendChild(coHeadRow);
    coTable.appendChild(coHead);
    var coBody = el('tbody');
    a.tracks.forEach(function (track, i) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, 'T' + (i + 1) + ' ' + track.name));
      for (var j = 0; j < n; j++) {
        var value = a.coincidenceMatrix[i][j];
        var td = el('td');
        var swatch = el('span', {
          className: 'matrix-swatch',
          style: 'background:' + seqColor(maxCo ? value / maxCo : 0),
          'aria-hidden': 'true'
        });
        td.appendChild(swatch);
        td.appendChild(el('span', { className: 'matrix-cell' }, value + '  (' + fmt(a.coincidenceRates[i][j] * 100, 1) + '%)'));
        tr.appendChild(td);
      }
      coBody.appendChild(tr);
    });
    coTable.appendChild(coBody);

    var hamTable = $('hammingTable');
    clear(hamTable);
    hamTable.appendChild(el('caption', { className: 'sr-only' }, 'Pairwise Hamming distances and rates'));
    var hamHead = el('thead');
    var hamHeadRow = el('tr');
    hamHeadRow.appendChild(el('th', { scope: 'col' }, 'Track'));
    a.tracks.forEach(function (track, i) {
      hamHeadRow.appendChild(el('th', { scope: 'col' }, 'T' + (i + 1)));
    });
    hamHead.appendChild(hamHeadRow);
    hamTable.appendChild(hamHead);
    var hamBody = el('tbody');
    a.tracks.forEach(function (track, i) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, 'T' + (i + 1) + ' ' + track.name));
      for (var j = 0; j < n; j++) {
        tr.appendChild(el('td', {},
          a.hammingDistances[i][j] + '  (' + fmt(a.hammingRates[i][j] * 100, 1) + '%)'));
      }
      hamBody.appendChild(tr);
    });
    hamTable.appendChild(hamBody);

    var scale = $('scaleSwatches');
    clear(scale);
    SEQ_STEPS.forEach(function (v) {
      scale.appendChild(el('span', { style: 'background:' + cssVar(v), 'aria-hidden': 'true' }));
    });
  }

  /* ---------- syncopation chart ---------- */

  function renderSync(a) {
    var svg = $('syncSvg');
    clear(svg);
    svg.appendChild(svgEl('title', { id: 'syncTitle' }, 'Illustrative syncopation score per voice'));
    var width = 720;
    var left = 190;
    var right = 640;
    var top = 18;
    var rowHeight = 30;
    var max = Math.max.apply(null, a.syncopation.perTrack.map(function (x) { return x.score; }).concat([1]));

    // Clean ticks on one axis, no second scale.
    for (var tick = 0; tick <= 4; tick++) {
      var x = left + (right - left) * tick / 4;
      svg.appendChild(svgEl('line', { x1: x, y1: top - 4, x2: x, y2: top + a.tracks.length * rowHeight, className: 'sync-axis' }));
      svg.appendChild(svgEl('text', { x: x, y: top + a.tracks.length * rowHeight + 16, className: 'sync-tick', 'text-anchor': 'middle' },
        String(Math.round(max * tick / 4))));
    }

    a.syncopation.perTrack.forEach(function (item, i) {
      var y = top + i * rowHeight + 6;
      var barWidth = (right - left) * item.score / max;
      svg.appendChild(svgEl('text', { x: left - 12, y: y + 13, className: 'sync-label', 'text-anchor': 'end' },
        'T' + (i + 1) + ' ' + item.name));
      var bar = svgEl('rect', {
        x: left, y: y, width: barWidth, height: 18,
        className: 'sync-bar', fill: seriesColor(i),
        rx: 1, ry: 1, tabindex: 0, role: 'img'
      });
      bar.setAttribute('aria-label', item.name + ' syncopation score ' + item.score);
      var detail = {
        title: 'Score ' + item.score,
        rows: [
          { color: seriesColor(i), text: item.name },
          { text: 'Normalized ' + fmt(item.normalized, 2) + ' per onset' },
          { text: item.evaluatedOnsets + ' onsets across ' + item.evaluatedSteps + ' meter-aligned steps' }
        ]
      };
      bar.addEventListener('pointermove', function () { showTooltip(bar, detail); });
      bar.addEventListener('pointerleave', hideTooltip);
      bar.addEventListener('focus', function () { showTooltip(bar, detail); });
      bar.addEventListener('blur', hideTooltip);
      svg.appendChild(bar);
      svg.appendChild(svgEl('text', { x: left + Math.max(2, barWidth) + 8, y: y + 13, className: 'sync-value' }, String(item.score)));
    });
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + (top + a.tracks.length * rowHeight + 26));

    var table = $('syncTable');
    clear(table);
    table.appendChild(el('caption', { className: 'sr-only' }, 'Syncopation scores per track'));
    var head = el('thead');
    var hr = el('tr');
    ['Track', 'Formula', 'Meter steps', 'Score', 'Per onset'].forEach(function (label, i) {
      hr.appendChild(el('th', { scope: 'col', className: i > 1 ? 'num' : '' }, label));
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    a.syncopation.perTrack.forEach(function (item, i) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, 'T' + (i + 1) + ' ' + item.name));
      tr.appendChild(el('td', {}, a.tracks[i].formula));
      tr.appendChild(el('td', { className: 'num' }, String(item.evaluatedSteps)));
      tr.appendChild(el('td', { className: 'num' }, String(item.score)));
      tr.appendChild(el('td', { className: 'num' }, fmt(item.normalized, 2)));
      body.appendChild(tr);
    });
    table.appendChild(body);
  }

  /* ---------- LilyPond and MIDI ---------- */

  function renderLily() {
    $('lilyPreview').textContent = state.lily;
  }

  function renderHex() {
    var bytes = state.midi;
    if (!bytes) return;
    var width = parseInt($('hexWidth').value, 10) || 16;
    var range = $('hexRange').value;
    var slice;
    if (range === 'head') slice = bytes.slice(0, 14);
    else if (range === 'track') slice = bytes.slice(14);
    else slice = bytes;
    $('hexDump').textContent = R.hexDump(slice, width);

    var chunks = R.describeMidiChunks(bytes);
    var table = $('chunkTable');
    clear(table);
    table.appendChild(el('caption', { className: 'sr-only' }, 'MIDI chunk layout'));
    var head = el('thead');
    var hr = el('tr');
    ['Chunk', 'Offset', 'Length', 'Bytes', 'Notes'].forEach(function (label, i) {
      hr.appendChild(el('th', { scope: 'col', className: i > 0 && i < 4 ? 'num' : '' }, label));
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    chunks.forEach(function (chunk) {
      var tr = el('tr');
      tr.appendChild(el('th', { scope: 'row' }, chunk.type));
      tr.appendChild(el('td', { className: 'num' }, String(chunk.offset)));
      tr.appendChild(el('td', { className: 'num' }, String(chunk.length)));
      tr.appendChild(el('td', { className: 'num' }, String(chunk.length + 8)));
      tr.appendChild(el('td', {}, chunk.type === 'MThd' ? 'Format 0, 1 track, division ' + state.ppq : 'Events, VLQ deltas, FF 2F 00'));
      body.appendChild(tr);
    });
    var total = el('tr');
    total.appendChild(el('th', { scope: 'row' }, 'Total file'));
    total.appendChild(el('td', { className: 'num' }, '0'));
    total.appendChild(el('td', { className: 'num' }, ''));
    total.appendChild(el('td', { className: 'num' }, String(bytes.length)));
    total.appendChild(el('td', {}, 'bytes, ' + state.bpm + ' BPM'));
    body.appendChild(total);
    table.appendChild(body);

    $('midiMeta').textContent = 'Binary .mid, ' + bytes.length + ' bytes. MThd and MTrk chunks, VLQ deltas, FF 51 03 tempo at ' +
      state.bpm + ' BPM, ' + state.ppq + ' ticks per quarter note, division is positive.';
  }

  /* ---------- master recompute ---------- */

  function recompute(options) {
    var opts = options || {};
    try {
      readControls();
      var engineTracks = toEngineTracks();
      state.analysis = R.analyzePolyrhythm(engineTracks, state.bpm);
      state.midi = R.encodeMidiFile(engineTracks, state.bpm, state.ppq, { gate: state.gate });
      state.lily = R.exportLilyPond(engineTracks, state.bpm, state.title);
      R.exportSession(currentSession());
    } catch (error) {
      state.analysis = null;
      state.midi = null;
      state.lily = '';
      ['downloadMidiBtn', 'downloadLyBtn', 'copyLyBtn', 'exportSessionBtn'].forEach(function (id) { $(id).disabled = true; });
      ['wheelSvg', 'syncSvg', 'coincidenceTable', 'hammingTable', 'syncTable', 'wheelTable', 'chunkTable', 'diagnosticsTable'].forEach(function (id) { clear($(id)); });
      $('wheelSvg').appendChild(svgEl('title', { id: 'wheelTitle' }, 'Phase wheel unavailable'));
      $('wheelSvg').appendChild(svgEl('desc', { id: 'wheelDesc' }, 'Correct the session input to restore the diagram.'));
      $('syncSvg').appendChild(svgEl('title', { id: 'syncTitle' }, 'Syncopation chart unavailable'));
      ['statCycle', 'statSeconds', 'statCoincidence', 'statSync'].forEach(function (id) { $(id).textContent = '-'; });
      $('lilyPreview').textContent = '';
      $('hexDump').textContent = '';
      flashNote('Invalid input: ' + error.message);
      if (!opts.skipEditor) renderEditor();
      return false;
    }
    ['downloadMidiBtn', 'downloadLyBtn', 'copyLyBtn', 'exportSessionBtn'].forEach(function (id) { $(id).disabled = false; });
    flashNote('Ready. Shared cycle: ' + state.analysis.cycleSteps + ' of ' + R.MAX_CYCLE_STEPS + ' allowed steps.');
    if (!opts.skipEditor) renderEditor();
    renderStats(state.analysis);
    renderWheel(state.analysis);
    renderMatrixTables(state.analysis);
    renderSync(state.analysis);
    renderLily();
    renderHex();
    renderDiagnostics(state.analysis);
    return true;
  }

  function renderDiagnostics(a) {
    var table = $('diagnosticsTable');
    clear(table);
    var head = el('tr');
    ['Voice', 'Onsets / steps', 'Cyclic gaps', 'Shortest repeat', 'Gap spread'].forEach(function (label) { head.appendChild(el('th', { scope: 'col' }, label)); });
    var thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
    var body = el('tbody');
    a.tracks.forEach(function (track) {
      var d = R.inspectPattern(track.pattern);
      var row = el('tr');
      [track.name, d.onsets + ' / ' + d.steps, d.gaps.length ? d.gaps.join(' + ') : 'No onsets', d.fundamentalPeriod + ' steps', d.gapSpread].forEach(function (value) { row.appendChild(el('td', {}, value)); });
      body.appendChild(row);
    });
    table.appendChild(body);
  }

  function currentSession() {
    return { schema: 'beatgrid/session', version: 1, title: state.title, bpm: state.bpm, ppq: state.ppq, gate: state.gate, tracks: toEngineTracks() };
  }

  function importSession() {
    try {
      var session = R.importSession($('sessionJson').value);
      state.tracks = [];
      session.tracks.forEach(addTrack);
      ['bpm', 'ppq', 'gate', 'title'].forEach(function (id) { $(id).value = session[id]; });
      recompute();
      flashNote('Imported ' + session.tracks.length + ' voices.');
    } catch (error) { flashNote('Import rejected: ' + error.message); }
  }

  /* ---------- theme and toggles ---------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var dark = theme === 'dark';
    $('themeBtn').setAttribute('aria-pressed', dark ? 'true' : 'false');
    $('themeLabel').textContent = dark ? 'Light' : 'Dark';
    $('themeIcon').textContent = dark ? '◑' : '◐';
    if (state.analysis) {
      renderWheel(state.analysis);
      renderMatrixTables(state.analysis);
      renderSync(state.analysis);
    }
  }

  function currentThemeIsDark() {
    var stamp = document.documentElement.getAttribute('data-theme');
    if (stamp) return stamp === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* ---------- wiring ---------- */

  function wire() {
    $('importSessionBtn').addEventListener('click', importSession);
    $('exportSessionBtn').addEventListener('click', function () {
      if (!state.analysis) return;
      try {
        var text = R.exportSession(currentSession());
        $('sessionJson').value = text;
        downloadBlob(new Blob([text], { type: 'application/json' }), safeFilename(state.title, 'json'));
        flashNote('Session JSON exported. Manual and Euclidean voices are preserved.');
      } catch (error) {
        flashNote('Export rejected: ' + error.message);
      }
    });
    ['bpm', 'ppq', 'gate', 'title'].forEach(function (id) {
      $(id).addEventListener('input', function () { recompute({ skipEditor: true }); });
      $(id).addEventListener('change', function () { recompute({ skipEditor: true }); });
    });

    $('addTrackBtn').addEventListener('click', function () {
      if (!addTrack({ pulses: 4, steps: 16, name: 'Track ' + (state.tracks.length + 1), note: R.DEFAULT_NOTES[state.tracks.length % 8] })) {
        flashNote('Maximum of ' + MAX_TRACKS + ' tracks');
        return;
      }
      recompute();
    });

    $('themeBtn').addEventListener('click', function () {
      var next = currentThemeIsDark() ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('beatgrid-theme', next); } catch (e) { /* storage is optional */ }
    });

    $('printBtn').addEventListener('click', function () { window.print(); });

    $('cyclePlayBtn').addEventListener('click', function () {
      if (play.on) stopPlay();
      else startPlay();
    });

    $('wheelTableBtn').addEventListener('click', function () {
      $('wheelTableWrap').hidden = false;
      $('wheelTableBtn').classList.add('is-active');
      $('wheelTableBtn').setAttribute('aria-pressed', 'true');
      $('wheelChartBtn').classList.remove('is-active');
      $('wheelChartBtn').setAttribute('aria-pressed', 'false');
    });
    $('wheelChartBtn').addEventListener('click', function () {
      $('wheelTableWrap').hidden = true;
      $('wheelChartBtn').classList.add('is-active');
      $('wheelChartBtn').setAttribute('aria-pressed', 'true');
      $('wheelTableBtn').classList.remove('is-active');
      $('wheelTableBtn').setAttribute('aria-pressed', 'false');
    });

    $('textureToggle').addEventListener('change', function () {
      state.texture = $('textureToggle').checked;
      if (state.texture) document.documentElement.setAttribute('data-texture', 'on');
      else document.documentElement.removeAttribute('data-texture');
    });

    $('hexWidth').addEventListener('change', renderHex);
    $('hexRange').addEventListener('change', renderHex);

    $('downloadMidiBtn').addEventListener('click', function () {
      if (!state.midi) return;
      downloadBlob(new Blob([state.midi], { type: 'audio/midi' }), safeFilename(state.title, 'mid'));
    });

    $('downloadLyBtn').addEventListener('click', function () {
      if (!state.analysis) return;
      downloadBlob(new Blob([state.lily], { type: 'text/plain;charset=utf-8' }), safeFilename(state.title, 'ly'));
    });

    $('copyLyBtn').addEventListener('click', function () {
      if (!state.analysis) return;
      var button = $('copyLyBtn');
      var done = function () {
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = 'Copy text'; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(state.lily).then(done, function () { button.textContent = 'Select and copy'; });
      } else {
        button.textContent = 'Select and copy';
      }
    });

    window.addEventListener('scroll', hideTooltip, { passive: true });
  }

  function init() {
    var saved = null;
    try { saved = localStorage.getItem('beatgrid-theme'); } catch (e) { /* storage is optional */ }
    if (saved === 'light' || saved === 'dark') applyTheme(saved);

    renderPresets();
    addTrack({ name: 'Tresillo', pulses: 3, steps: 8, note: 36 });
    addTrack({ name: 'Seven in twelve', pulses: 7, steps: 12, note: 56 });
    addTrack({ name: 'Four in nine', pulses: 4, steps: 9, note: 45 });
    wire();
    recompute();
    $('versionLabel').textContent = R.VERSION;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
