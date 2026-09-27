/*
 * Storymaker
 * The editor for building a branching story: scenes, the options that link
 * them, and how many lives players get. Saves to this browser automatically
 * and exports/imports the story as a JSON file.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'island-storymaker:story';
  const NEW_SCENE = '__new__';
  const {
    esc, sceneHTML, sceneBackground, createPlayer, clampLives,
    normalizeStory: normalize, LETTERS, MAX_OPTIONS, MAX_LIVES,
  } = window.IslandPlayer;

  const TYPES = {
    choice: { label: 'Choice', hint: 'Players read the scene and pick one of the options.' },
    death: { label: 'Death', hint: 'Players lose a life. If they have lives left, they go back to the scene where they made the fatal choice. With none left, it’s game over and they start again.' },
    ending: { label: 'Happy ending', hint: 'Players escape the island and win. They can play again from the start.' },
  };
  // Scene backgrounds to pick from; the tints go with the option colors. Any other color via "Custom".
  const BACKGROUNDS = [
    { name: 'White', value: '#ffffff' },
    { name: 'Sand', value: '#f5ebdc' },
    { name: 'Blush', value: '#fbe3df' },
    { name: 'Seafoam', value: '#dcf2ea' },
    { name: 'Sky', value: '#ddebfa' },
    { name: 'Lavender', value: '#ebe4fb' },
    { name: 'Night', value: '#16233b' },
    { name: 'Black', value: '#000000' },
  ];
  const DEATH_HINT_NO_LIVES ='Lives are off, so players just go back to the scene where they made the fatal choice and pick again.';

  // Map layout, in SVG units. One row per step from the start.
  const NODE_W = 200;
  const NODE_H = 62;
  const GAP_X = 28;
  const GAP_Y = 64;
  const PAD = 28;
  const GUTTER = 100;

  const $ = (selector, root = document) => root.querySelector(selector);
  const els = {
    storyTitle: $('#storyTitle'),
    livesValue: $('#livesValue'),
    livesDown: $('#livesDown'),
    livesUp: $('#livesUp'),
    saveStatus: $('#saveStatus'),
    issuesBtn: $('#issuesBtn'),
    issuesPanel: $('#issuesPanel'),
    menuBtn: $('#menuBtn'),
    menuPanel: $('#menuPanel'),
    playBtn: $('#playBtn'),
    importInput: $('#importInput'),
    sceneCount: $('#sceneCount'),
    sceneList: $('#sceneList'),
    addSceneBtn: $('#addSceneBtn'),
    sceneView: $('#sceneView'),
    mapView: $('#mapView'),
    mapScroll: $('#mapScroll'),
    zoomValue: $('#zoomValue'),
    playOverlay: $('#playOverlay'),
    toast: $('#toast'),
  };

  let story = loadSaved() || normalize(window.SAMPLE_STORY);
  let selectedId = story.start;
  let view = 'scene';
  let zoom = 1;
  let info = analyze();
  let player = null;
  let focusBeforePlay = null;
  let saveTimer = null;
  let toastTimer = null;

  // ---------------------------------------------------------------------------
  // Story data

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function makeScene() {
    let id;
    do { id = 'scene-' + Math.random().toString(36).slice(2, 7); } while (story.scenes.some((s) => s.id === id));
    return {
      id,
      title: '',
      type: 'choice',
      gif: '',
      bg: '', // '' = the default for the type: white, or black for death scenes
      text: '',
      options: [0, 1, 2].map(() => ({ text: '', goto: '' })),
    };
  }

  function current() {
    return info.byId.get(selectedId);
  }

  function titleOf(scene) {
    return (scene && scene.title.trim()) || 'Untitled scene';
  }

  function excerpt(text, length) {
    const flat = (text || '').replace(/\s+/g, ' ').trim();
    return flat.length > length ? flat.slice(0, length - 1).trimEnd() + '…' : flat;
  }

  function storyOrder() {
    return [...info.columns.flat(), ...info.loose];
  }

  /** Where a new branch goes: the first option not connected yet, else a new option. -1 if full. */
  function openOptionIndex(s) {
    if (s.type !== 'choice') return -1;
    const empty = s.options.findIndex((o) => !o.goto);
    if (empty >= 0) return empty;
    return s.options.length < MAX_OPTIONS ? s.options.length : -1;
  }

  /**
   * Works out the shape of the story: which scenes lead where, how many
   * steps each is from the start, what needs fixing, and the map columns.
   */
  function analyze() {
    const byId = new Map(story.scenes.map((s) => [s.id, s]));
    const links = (s) => (s && s.type === 'choice' ? s.options : []);

    const incoming = new Map(story.scenes.map((s) => [s.id, []]));
    story.scenes.forEach((s) => links(s).forEach((o, index) => {
      if (incoming.has(o.goto)) incoming.get(o.goto).push({ from: s.id, index });
    }));

    const depth = new Map([[story.start, 0]]);
    const queue = [story.start];
    while (queue.length) {
      const id = queue.shift();
      links(byId.get(id)).forEach((o) => {
        if (byId.has(o.goto) && !depth.has(o.goto)) {
          depth.set(o.goto, depth.get(id) + 1);
          queue.push(o.goto);
        }
      });
    }

    const issues = [];
    const add = (sceneId, level, message) => issues.push({ sceneId, level, message });
    story.scenes.forEach((s) => {
      if (!s.title.trim()) add(s.id, 'warn', 'Has no title.');
      if (s.type === 'choice') {
        if (!s.options.length) add(s.id, 'error', 'Has no options, so players get stuck here.');
        s.options.forEach((o, i) => {
          if (!o.goto) add(s.id, 'error', `Option ${LETTERS[i]} doesn’t lead anywhere.`);
          if (!o.text.trim()) add(s.id, 'warn', `Option ${LETTERS[i]} has no text.`);
        });
      }
      if (!depth.has(s.id)) add(s.id, 'warn', 'Can’t be reached from the start scene.');
    });
    if (!story.scenes.some((s) => s.type === 'ending' && depth.has(s.id))) {
      add(null, 'warn', 'No happy ending can be reached from the start yet.');
    }
    const issuesByScene = new Map();
    issues.forEach((issue) => {
      if (!issue.sceneId) return;
      if (!issuesByScene.has(issue.sceneId)) issuesByScene.set(issue.sceneId, []);
      issuesByScene.get(issue.sceneId).push(issue);
    });

    // One column per step from the start. Scenes in a column are ordered by
    // where their parents sit, so lines cross as little as possible.
    const columns = [];
    story.scenes.forEach((s) => {
      if (!depth.has(s.id)) return;
      const d = depth.get(s.id);
      (columns[d] = columns[d] || []).push(s.id);
    });
    for (let d = 1; d < columns.length; d++) {
      const prev = new Map(columns[d - 1].map((id, i) => [id, i]));
      const score = new Map(columns[d].map((id) => {
        const parents = incoming.get(id).filter((l) => prev.has(l.from));
        const sum = parents.reduce((total, l) => total + prev.get(l.from) * 10 + l.index, 0);
        return [id, sum / parents.length];
      }));
      columns[d].sort((a, b) => score.get(a) - score.get(b));
    }
    const loose = story.scenes.filter((s) => !depth.has(s.id)).map((s) => s.id);

    return { byId, incoming, depth, issues, issuesByScene, columns, loose };
  }

  // ---------------------------------------------------------------------------
  // Saving

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (err) {
      return null;
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(story));
      setSaveStatus('Saved in this browser', false);
    } catch (err) {
      setSaveStatus('Not saved: too big for the browser. Export it to a file.', true);
    }
  }

  function setSaveStatus(text, isError) {
    els.saveStatus.textContent = text;
    els.saveStatus.classList.toggle('is-error', isError);
  }

  // ---------------------------------------------------------------------------
  // Rendering

  /** Re-derives everything after a change. `form` also rebuilds the scene form. */
  function update({ form = false } = {}) {
    info = analyze();
    if (!info.byId.has(selectedId)) selectedId = story.start;
    renderSidebar();
    renderIssues();
    if (view === 'scene') {
      if (form) renderSceneView();
      else refreshSceneParts();
    } else {
      renderMap();
    }
    save();
  }

  function renderLives() {
    els.livesValue.textContent = story.lives || 'Off';
    els.livesValue.parentNode.classList.toggle('is-off', !story.lives);
    els.livesDown.disabled = story.lives <= 0;
    els.livesUp.disabled = story.lives >= MAX_LIVES;
  }

  function renderSidebar() {
    const item = (id) => {
      const s = info.byId.get(id);
      const problems = info.issuesByScene.get(id) || [];
      const hasError = problems.some((p) => p.level === 'error');
      const selected = id === selectedId;
      return `<button type="button" class="scene-item${selected ? ' is-selected' : ''}" data-id="${esc(id)}"${selected ? ' aria-current="true"' : ''}>
        <i class="type-dot type-${s.type}" aria-hidden="true"></i>
        <span class="scene-item-text">
          <span class="scene-item-title${s.title.trim() ? '' : ' is-untitled'}"><span class="sr-only">${TYPES[s.type].label}: </span>${esc(titleOf(s))}</span>
          <span class="scene-item-excerpt">${esc(excerpt(s.text, 70)) || '&nbsp;'}</span>
        </span>
        <span class="scene-item-badges">
          ${id === story.start ? '<span class="badge badge-start">Start</span>' : ''}
          ${problems.length ? `<span class="badge ${hasError ? 'badge-error' : 'badge-warn'}" title="${problems.length} to fix">${problems.length}<span class="sr-only"> to fix</span></span>` : ''}
        </span>
      </button>`;
    };
    let html = info.columns.flat().map(item).join('');
    if (info.loose.length) html += '<div class="scene-group-label">Not connected</div>' + info.loose.map(item).join('');
    els.sceneList.innerHTML = html;
    els.sceneCount.textContent = story.scenes.length;
  }

  function renderIssues() {
    const count = info.issues.length;
    const hasError = info.issues.some((i) => i.level === 'error');
    els.issuesBtn.className = 'btn issues-btn ' + (!count ? 'is-clean' : hasError ? 'has-errors' : 'has-warnings');
    els.issuesBtn.innerHTML = count ? `<span class="issues-dot" aria-hidden="true"></span>${count} to fix` : '✓ Ready to play';
    const groups = [...info.issuesByScene].map(([sceneId, list]) => ({ sceneId, list }));
    const storyWide = info.issues.filter((i) => !i.sceneId);
    if (storyWide.length) groups.push({ sceneId: null, list: storyWide });
    els.issuesPanel.innerHTML = count
      ? `<p class="popover-title">To fix</p><ul class="issue-list">${groups.map(({ sceneId, list }) => {
        const level = list.some((i) => i.level === 'error') ? 'error' : 'warn';
        const body = `<strong>${sceneId ? esc(titleOf(info.byId.get(sceneId))) : 'Whole story'}</strong>${list.map((i) => `<span>${esc(i.message)}</span>`).join('')}`;
        return sceneId
          ? `<li><button type="button" class="issue-item is-${level}" data-goto-scene="${esc(sceneId)}">${body}</button></li>`
          : `<li><div class="issue-item is-${level}">${body}</div></li>`;
      }).join('')}</ul>`
      : '<p class="popover-empty">Every option leads somewhere and there’s a way out. Nice.</p>';
  }

  function renderSceneView() {
    const s = current();
    const isStart = s.id === story.start;
    els.sceneView.innerHTML = `
      <div class="scene-layout">
        <div class="scene-form">
          <div class="scene-head">
            <div class="scene-head-tags">
              <span class="type-tag type-${s.type}"><i class="type-dot type-${s.type}" aria-hidden="true"></i>${TYPES[s.type].label}</span>
              ${isStart ? '<span class="badge badge-start">Start scene</span>' : ''}
            </div>
            <div class="scene-head-actions">
              ${isStart ? '' : '<button type="button" class="btn btn-small btn-ghost" data-act="make-start">Make start scene</button>'}
              <button type="button" class="btn btn-small btn-danger" data-act="delete"${story.scenes.length < 2 ? ' disabled title="A story needs at least one scene"' : ''}><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>Delete scene</button>
            </div>
          </div>
          <div id="sceneIssues"></div>

          <label class="field">
            <span class="field-label">Title</span>
            <input type="text" class="title-input" data-field="title" value="${esc(s.title)}" placeholder="e.g. 1: Stranded">
          </label>

          <fieldset class="field">
            <legend class="field-label">Scene type</legend>
            <div class="segmented">${Object.entries(TYPES).map(([key, t]) => `
              <label class="segment"><input type="radio" name="sceneType" value="${key}"${s.type === key ? ' checked' : ''}><span><i class="type-dot type-${key}" aria-hidden="true"></i>${t.label}</span></label>`).join('')}
            </div>
            <p class="field-hint">${s.type === 'death' && !story.lives ? DEATH_HINT_NO_LIVES : TYPES[s.type].hint}</p>
          </fieldset>

          ${backgroundFieldHTML(s)}

          ${gifFieldHTML(s)}

          <label class="field">
            <span class="field-label">Story text</span>
            <textarea data-field="text" rows="5" placeholder="What happens in this scene?">${esc(s.text)}</textarea>
          </label>

          ${s.type === 'choice' ? optionsFieldHTML(s) : ''}

          <div class="field">
            <span class="field-label">Reached from</span>
            <div id="incoming" class="incoming"></div>
          </div>
        </div>

        <aside class="scene-preview" aria-label="Preview">
          <div class="preview-head">
            <span class="field-label">Preview</span>
            <button type="button" class="btn btn-small" data-act="play-here">▶ Play from here</button>
          </div>
          <div id="previewFrame" class="preview-frame"></div>
          ${s.type === 'choice' ? '<p class="field-hint">Click an option card to open the scene it leads to.</p>' : ''}
        </aside>
      </div>`;
    refreshSceneParts();
  }

  function backgroundFieldHTML(s) {
    const bg = sceneBackground(s);
    const isPreset = BACKGROUNDS.some((b) => b.value === bg);
    return `<fieldset class="field">
      <legend class="field-label">Background</legend>
      <div class="swatches">${BACKGROUNDS.map((b) => `
        <label class="swatch" title="${b.name}"><input type="radio" name="sceneBg" value="${b.value}" aria-label="${b.name}"${b.value === bg ? ' checked' : ''}><span style="background:${b.value}"></span></label>`).join('')}
        <label class="swatch swatch-custom${isPreset ? '' : ' is-checked'}" title="Any color"><input type="color" data-bg-custom value="${bg}" aria-label="Any color"><span${isPreset ? '' : ` style="background:${bg}"`}></span></label>
      </div>
      <p class="field-hint">Scenes are white unless you pick a color; death scenes are black.</p>
    </fieldset>`;
  }

  function gifFieldHTML(s) {
    const uploaded = s.gif.startsWith('data:');
    const size = Math.round((s.gif.length * 3) / 4 / 1024);
    return `<div class="field">
      <span class="field-label">GIF or image</span>
      <div class="gif-row">
        ${uploaded
          ? `<div class="gif-uploaded"><span>Uploaded file · ${size} KB</span><button type="button" class="link-btn" data-act="clear-gif">Remove</button></div>`
          : `<input type="url" data-field="gif" value="${esc(s.gif)}" aria-label="GIF link" placeholder="Paste a link, e.g. https://media.giphy.com/…/giphy.gif">`}
        <label class="btn btn-small upload-btn">Upload…<input type="file" accept="image/*" data-file="gif" hidden></label>
      </div>
      <p class="field-hint">On Giphy, right-click a GIF and choose “Copy image address”. Links keep the story file small.</p>
    </div>`;
  }

  function optionsFieldHTML(s) {
    const rows = s.options.map((o, i) => `
      <li class="option-row">
        <span class="option-letter" data-letter="${LETTERS[i]}" aria-hidden="true">${LETTERS[i]}</span>
        <div class="option-body">
          <textarea rows="2" data-opt-text="${i}" aria-label="Option ${LETTERS[i]} text" placeholder="What does the player choose?">${esc(o.text)}</textarea>
          <div class="option-dest">
            <label class="option-dest-label" for="dest-${i}">Leads to</label>
            <select id="dest-${i}" data-opt-goto="${i}"${o.goto ? '' : ' class="is-empty"'}>${destinationOptions(o.goto)}</select>
            <button type="button" class="btn btn-small btn-ghost" data-open="${i}"${o.goto ? '' : ' disabled'}>Open →</button>
          </div>
        </div>
        <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove option ${LETTERS[i]}" title="Remove option">×</button>
      </li>`).join('');
    return `<div class="field">
      <span class="field-label">Options</span>
      ${rows ? `<ol class="option-list">${rows}</ol>` : ''}
      ${s.options.length < MAX_OPTIONS ? '<button type="button" class="btn btn-small" data-act="add-option">+ Add option</button>' : ''}
    </div>`;
  }

  function destinationOptions(selected) {
    const label = (s) => {
      const icon = s.type === 'death' ? '☠ ' : s.type === 'ending' ? '★ ' : '';
      const title = titleOf(s);
      const shared = story.scenes.some((other) => other !== s && titleOf(other) === title);
      return icon + title + (shared && s.text ? ` — ${excerpt(s.text, 45)}` : '');
    };
    return '<option value="">Not connected yet</option>'
      + storyOrder().map((id) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(label(info.byId.get(id)))}</option>`).join('')
      + `<option value="${NEW_SCENE}">＋ New scene…</option>`;
  }

  /** Updates the parts of the scene view that depend on the rest of the story. */
  function refreshSceneParts() {
    const s = current();
    const problems = info.issuesByScene.get(s.id) || [];
    $('#sceneIssues').innerHTML = problems.length
      ? `<ul class="issue-banner">${problems.map((p) => `<li class="is-${p.level}">${esc(p.message)}</li>`).join('')}</ul>`
      : '';

    const links = info.incoming.get(s.id);
    $('#incoming').innerHTML = links.length
      ? links.map((l) => `<button type="button" class="chip" data-goto-scene="${esc(l.from)}"><span class="chip-letter" data-letter="${LETTERS[l.index]}">${LETTERS[l.index]}</span>${esc(titleOf(info.byId.get(l.from)))}</button>`).join('')
      : `<span class="field-hint">${s.id === story.start ? 'This is where the story begins.' : 'No option leads here yet.'}</span>`;

    // Keep the same <img> element if the GIF didn't change, so it doesn't restart on every keystroke.
    const frame = $('#previewFrame');
    const oldImg = frame.querySelector('.ip-media img');
    const lives = s.type === 'death' && story.lives ? story.lives - 1 : story.lives;
    frame.innerHTML = sceneHTML(s, { lives, maxLives: story.lives, justLost: false });
    const newImg = frame.querySelector('.ip-media img');
    if (oldImg && newImg && oldImg.getAttribute('src') === newImg.getAttribute('src')) {
      const media = newImg.parentNode;
      newImg.replaceWith(oldImg);
      if (oldImg.complete) media.classList.remove('is-loading');
      if (oldImg.complete && !oldImg.naturalWidth) media.classList.add('is-broken');
    }
  }

  // ---------------------------------------------------------------------------
  // Map

  let mapWidth = 0;

  function fitMap() {
    const available = els.mapScroll.clientWidth - 8;
    zoom = Math.max(0.3, Math.min(1, Math.floor((available / mapWidth) * 100) / 100));
    renderMap();
  }

  function renderMap() {
    const rows = info.columns.slice();
    const looseRow = info.loose.length ? rows.push(info.loose) - 1 : -1;
    const rowWidth = (row) => row.length * NODE_W + (row.length - 1) * GAP_X;
    const widest = Math.max(...rows.map(rowWidth));
    const rowY = (r) => PAD + r * (NODE_H + GAP_Y) + (r === looseRow ? 40 : 0);

    const pos = new Map();
    rows.forEach((row, r) => {
      const left = GUTTER + (r === looseRow ? 0 : (widest - rowWidth(row)) / 2);
      row.forEach((id, i) => pos.set(id, { x: left + i * (NODE_W + GAP_X), y: rowY(r) }));
    });

    // One line per scene pair; options that share a destination share a line ("A, C").
    const edges = new Map();
    story.scenes.forEach((s) => {
      if (s.type !== 'choice') return;
      s.options.forEach((o, i) => {
        if (!pos.has(o.goto)) return;
        const key = s.id + '\n' + o.goto;
        if (!edges.has(key)) edges.set(key, { from: s.id, to: o.goto, letters: [] });
        edges.get(key).letters.push(LETTERS[i]);
      });
    });

    let rightmost = GUTTER + widest;
    const edgeParts = [];
    const labelParts = [];
    edges.forEach((edge) => {
      const a = pos.get(edge.from);
      const b = pos.get(edge.to);
      const target = info.byId.get(edge.to);
      const active = edge.from === selectedId || edge.to === selectedId;
      const kind = target.type === 'choice' ? 'plain' : target.type;
      const cls = `edge edge-${kind}${active ? ' is-active' : ''}`;
      const marker = active ? 'arrow-active' : `arrow-${kind}`;
      let d;
      let mid;
      if (b.y > a.y) {
        const x1 = a.x + NODE_W / 2; const y1 = a.y + NODE_H;
        const x2 = b.x + NODE_W / 2; const y2 = b.y - 2;
        const dy = Math.max(24, (y2 - y1) / 2);
        d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
        mid = cubicMid([x1, y1], [x1, y1 + dy], [x2, y2 - dy], [x2, y2]);
      } else {
        // Leads back up, sideways or to itself: loop out to the right.
        const self = edge.from === edge.to;
        const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2 + (self ? -12 : 0);
        const x2 = b.x + NODE_W + 2; const y2 = b.y + NODE_H / 2 + (self ? 12 : 0);
        const out = Math.max(x1, x2) + 44 + Math.abs(y1 - y2) * 0.12;
        rightmost = Math.max(rightmost, out);
        d = `M${x1},${y1} C${out},${y1} ${out},${y2} ${x2},${y2}`;
        mid = cubicMid([x1, y1], [out, y1], [out, y2], [x2, y2]);
      }
      edgePart(edgeParts, labelParts, d, mid, cls, marker, edge.letters, active);
    });

    // Each scene is its box plus two corner buttons: delete (bottom left, shown on
    // hover or when selected) and "+" (bottom right, a new option to a new scene).
    const nodes = [];
    const canDelete = story.scenes.length > 1;
    pos.forEach((p, id) => {
      const s = info.byId.get(id);
      const problems = info.issuesByScene.get(id) || [];
      const hasError = problems.some((x) => x.level === 'error');
      const cls = ['map-node', `type-${s.type}`, id === selectedId ? 'is-selected' : '', info.depth.has(id) ? '' : 'is-loose'].join(' ');
      const label = `${TYPES[s.type].label}: ${titleOf(s)}${problems.length ? `, ${problems.length} to fix` : ''}`;
      const slot = openOptionIndex(s);
      nodes.push(`<g class="map-item" transform="translate(${p.x},${p.y})">
        <g class="${cls}" data-id="${esc(id)}" tabindex="0" role="button" aria-label="${esc(label)}">
          <rect class="node-box" width="${NODE_W}" height="${NODE_H}" rx="10"/>
          <circle class="node-dot" cx="16" cy="22" r="5"/>
          <text class="node-title${s.title.trim() ? '' : ' is-untitled'}" x="28" y="26">${esc(truncate(titleOf(s), 24))}</text>
          <text class="node-excerpt" x="16" y="46">${esc(truncate(excerpt(s.text, 80), 32))}</text>
          ${id === story.start ? '<g class="node-start" transform="translate(10,-9)"><rect width="42" height="16" rx="8"/><text x="21" y="11.5" text-anchor="middle">START</text></g>' : ''}
          ${problems.length ? `<g class="node-issue ${hasError ? 'is-error' : 'is-warn'}" transform="translate(${NODE_W - 2},2)"><circle r="9"/><text y="4" text-anchor="middle">${problems.length}</text></g>` : ''}
        </g>
        ${slot >= 0 ? `<g class="map-btn map-add" data-add="${esc(id)}" transform="translate(${NODE_W - 2},${NODE_H - 2})" tabindex="0" role="button" aria-label="${esc(`Add option ${LETTERS[slot]} to ${titleOf(s)}`)}">
          <title>Add option ${LETTERS[slot]}</title>
          <circle class="map-btn-hit" r="13"/><circle class="map-btn-dot" r="9"/><path d="M-4,0H4M0,-4V4"/>
        </g>` : ''}
        ${canDelete ? `<g class="map-btn map-del" data-delete="${esc(id)}" transform="translate(2,${NODE_H - 2})" tabindex="0" role="button" aria-label="${esc(`Delete ${titleOf(s)}`)}">
          <title>Delete scene</title>
          <circle class="map-btn-hit" r="13"/><circle class="map-btn-dot" r="9"/><path d="M-4.5,-3H4.5M-1.5,-3V-4.5H1.5V-3M-3.2,-3L-2.7,4.2H2.7L3.2,-3"/>
        </g>` : ''}
      </g>`);
    });

    const width = rightmost + PAD + 20;
    const height = rowY(rows.length - 1) + NODE_H + PAD + 10;
    const heads = rows.map((row, r) => `<text class="map-row-label" x="${PAD}" y="${rowY(r) + NODE_H / 2 + 4}">${r === looseRow ? 'Loose' : `Step ${r + 1}`}</text>`);
    const divider = looseRow >= 0
      ? `<line class="map-divider" x1="${PAD}" y1="${rowY(looseRow) - 34}" x2="${width - PAD}" y2="${rowY(looseRow) - 34}"/><text class="map-row-label" x="${GUTTER}" y="${rowY(looseRow) - 14}">Not connected to the story yet</text>`
      : '';
    mapWidth = width;
    const markers = ['plain', 'death', 'ending', 'active'].map((k) => `<marker id="arrow-${k}" class="arrow arrow-${k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker>`).join('');

    els.mapScroll.innerHTML = `<svg class="map-svg" width="${width * zoom}" height="${height * zoom}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>${markers}</defs>
      ${heads.join('')}${divider}
      <g class="edges">${edgeParts.join('')}</g>
      <g class="nodes">${nodes.join('')}</g>
      <g class="labels">${labelParts.join('')}</g>
    </svg>`;
    els.zoomValue.textContent = Math.round(zoom * 100) + '%';
  }

  function edgePart(edgeParts, labelParts, d, mid, cls, marker, letters, active) {
    const text = letters.join(', ');
    const w = 10 + text.length * 7;
    edgeParts.push(`<path class="${cls}" d="${d}" marker-end="url(#${marker})"/>`);
    labelParts.push(`<g class="edge-label${active ? ' is-active' : ''}" transform="translate(${mid.x.toFixed(1)},${mid.y.toFixed(1)})"><rect x="${-w / 2}" y="-9" width="${w}" height="18" rx="9"/><text y="4" text-anchor="middle">${text}</text></g>`);
  }

  function cubicMid(p0, p1, p2, p3) {
    return {
      x: 0.125 * p0[0] + 0.375 * p1[0] + 0.375 * p2[0] + 0.125 * p3[0],
      y: 0.125 * p0[1] + 0.375 * p1[1] + 0.375 * p2[1] + 0.125 * p3[1],
    };
  }

  function truncate(text, length) {
    return text.length > length ? text.slice(0, length - 1).trimEnd() + '…' : text;
  }

  // ---------------------------------------------------------------------------
  // Actions

  function openScene(id) {
    if (!info.byId.has(id)) return;
    selectedId = id;
    closePopovers();
    if (view !== 'scene') setView('scene');
    else {
      renderSidebar();
      renderSceneView();
    }
    els.sceneView.scrollTop = 0;
    const item = els.sceneList.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  function showTab(next) {
    view = next;
    document.querySelectorAll('.tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.view === view)));
    els.sceneView.hidden = view !== 'scene';
    els.mapView.hidden = view !== 'map';
  }

  function setView(next) {
    showTab(next);
    renderSidebar();
    if (view === 'scene') renderSceneView();
    else renderMap();
  }

  function addScene() {
    const scene = makeScene();
    story.scenes.push(scene);
    selectedId = scene.id;
    showTab('scene');
    update({ form: true });
    $('.title-input').focus();
  }

  /**
   * Blank options that led to the scene go with it; options with text stay,
   * unconnected, so the writing isn't lost.
   */
  function deleteScene(id, { focus = false } = {}) {
    const s = info.byId.get(id);
    if (!s || story.scenes.length < 2) return;
    const snapshot = clone(story);
    const wasConnected = new Set(info.depth.keys());
    const parent = info.incoming.get(id).find((l) => l.from !== id);
    story.scenes = story.scenes.filter((x) => x !== s);
    story.scenes.forEach((x) => {
      x.options = x.options.filter((o) => o.goto !== id || o.text.trim());
      x.options.forEach((o) => { if (o.goto === id) o.goto = ''; });
    });
    if (story.start === id) story.start = story.scenes[0].id;
    selectedId = parent ? parent.from : story.start;
    update({ form: true });
    const cutOff = [...wasConnected].filter((x) => x !== id && !info.depth.has(x)).length;
    const note = cutOff ? ` ${cutOff === 1 ? '1 scene' : `${cutOff} scenes`} after it ${cutOff === 1 ? 'is' : 'are'} no longer connected.` : '';
    showToast(`Deleted “${titleOf(s)}”.${note}`, { label: 'Undo', run: () => replaceStory(snapshot, id) });
    if (view === 'map') revealMapNode(selectedId, focus);
  }

  /** Scrolls the map to a scene and, after a keyboard action, moves focus there. */
  function revealMapNode(id, focus) {
    const node = els.mapScroll.querySelector(`.map-node[data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    if (focus) node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function setType(type) {
    const s = current();
    s.type = type;
    if (type === 'choice' && !s.options.length) s.options = [0, 1, 2].map(() => ({ text: '', goto: '' }));
    update({ form: true });
    $(`input[name="sceneType"][value="${type}"]`).focus();
  }

  /** Picking the type's own default stores nothing, so the scene keeps following its type. */
  function setBackground(value, focusSelector) {
    const s = current();
    s.bg = value === sceneBackground({ type: s.type }) ? '' : value;
    update({ form: true });
    $(focusSelector).focus();
  }

  function setDestination(index, value) {
    const s = current();
    if (value === NEW_SCENE) {
      const created = makeScene();
      story.scenes.push(created);
      s.options[index].goto = created.id;
      update({ form: true });
      showToast(`Created a new scene for option ${LETTERS[index]}.`, { label: 'Open it', run: () => openScene(created.id) });
    } else {
      s.options[index].goto = value;
      update({ form: true });
    }
    $(`[data-opt-goto="${index}"]`).focus();
  }

  /** From the map's "+": points the scene's next free option at a brand-new scene. */
  function addBranch(id, { focus = false } = {}) {
    const s = info.byId.get(id);
    const index = openOptionIndex(s);
    if (index < 0) return;
    const snapshot = clone(story);
    const created = makeScene();
    story.scenes.push(created);
    if (index === s.options.length) s.options.push({ text: '', goto: '' });
    s.options[index].goto = created.id;
    selectedId = created.id;
    update();
    showToast(`Option ${LETTERS[index]} of “${titleOf(s)}” now leads to a new scene.`, { label: 'Undo', run: () => replaceStory(snapshot, id) });
    revealMapNode(created.id, focus);
  }

  function uploadGif(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose a GIF or image file.');
      return;
    }
    const scene = current();
    const reader = new FileReader();
    reader.onload = () => {
      scene.gif = reader.result;
      update({ form: true });
      if (file.size > 1.5 * 1024 * 1024) showToast('That file is large and may not fit in browser storage. A link works better.');
    };
    reader.readAsDataURL(file);
  }

  function replaceStory(next, openId) {
    story = next;
    selectedId = openId && next.scenes.some((s) => s.id === openId) ? openId : story.start;
    els.storyTitle.value = story.title;
    renderLives();
    update({ form: true });
  }

  function exportStory() {
    const blob = new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const slug = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story';
    link.href = URL.createObjectURL(blob);
    link.download = `${slug}.story.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function importStory(file) {
    if (!file) return;
    file.text().then((text) => {
      const next = normalize(JSON.parse(text));
      const snapshot = clone(story);
      replaceStory(next);
      showToast(`Imported “${next.title}”.`, { label: 'Undo', run: () => replaceStory(snapshot) });
    }).catch((err) => {
      showToast(err instanceof SyntaxError ? 'That file isn’t a valid story file.' : err.message);
    });
  }

  function replaceWithUndo(next, message) {
    const snapshot = clone(story);
    replaceStory(next);
    showToast(message, { label: 'Undo', run: () => replaceStory(snapshot) });
  }

  function newStory() {
    const scene = makeScene();
    scene.title = '1: Stranded';
    replaceWithUndo({ title: 'Untitled story', lives: 2, start: scene.id, scenes: [scene] }, 'Started a new story.');
  }

  // ---------------------------------------------------------------------------
  // Playing

  function openPlayer(startAt) {
    focusBeforePlay = document.activeElement;
    closePopovers();
    const from = startAt !== story.start ? ` from “${esc(titleOf(info.byId.get(startAt)))}”` : '';
    els.playOverlay.innerHTML = `
      <div class="play-bar">
        <span class="play-label">▶ Playing${from}</span>
        <div class="play-actions">
          <button type="button" class="btn btn-small btn-on-dark" data-play="restart">Restart</button>
          <button type="button" class="btn btn-small btn-on-dark" data-play="edit">Edit this scene</button>
          <button type="button" class="btn btn-small" data-play="close">Close <kbd>Esc</kbd></button>
        </div>
      </div>
      <div class="play-scroll">
        <div class="ip-page">
          <h1 class="ip-site-title">${esc(story.title)}</h1>
          <div class="ip-stage" id="playerRoot"></div>
        </div>
      </div>`;
    els.playOverlay.hidden = false;
    document.body.classList.add('is-playing');
    player = createPlayer($('#playerRoot'), clone(story), { startAt });
    $('[data-play="close"]').focus();
  }

  function closePlayer() {
    if (!player) return;
    player.destroy();
    player = null;
    els.playOverlay.hidden = true;
    els.playOverlay.innerHTML = '';
    document.body.classList.remove('is-playing');
    if (focusBeforePlay && document.contains(focusBeforePlay)) focusBeforePlay.focus();
  }

  // ---------------------------------------------------------------------------
  // Popovers and toast

  function togglePopover(panel, button) {
    const willOpen = panel.hidden;
    closePopovers();
    if (willOpen) {
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
    }
  }

  function closePopovers() {
    [[els.issuesPanel, els.issuesBtn], [els.menuPanel, els.menuBtn]].forEach(([panel, button]) => {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function showToast(message, action) {
    els.toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}`;
    els.toast.hidden = false;
    if (action) {
      els.toast.querySelector('button').addEventListener('click', () => {
        hideToast();
        action.run();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }

  function hideToast() {
    els.toast.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Events

  els.storyTitle.addEventListener('input', () => {
    story.title = els.storyTitle.value;
    save();
  });

  [[els.livesDown, -1], [els.livesUp, 1]].forEach(([button, step]) => {
    button.addEventListener('click', () => {
      story.lives = clampLives(story.lives + step);
      renderLives();
      update({ form: true });
    });
  });

  els.playBtn.addEventListener('click', () => openPlayer(story.start));
  els.addSceneBtn.addEventListener('click', addScene);
  els.issuesBtn.addEventListener('click', () => togglePopover(els.issuesPanel, els.issuesBtn));
  els.menuBtn.addEventListener('click', () => togglePopover(els.menuPanel, els.menuBtn));

  els.menuPanel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-menu]');
    if (!button) return;
    closePopovers();
    const action = button.dataset.menu;
    if (action === 'export') exportStory();
    else if (action === 'import') els.importInput.click();
    else if (action === 'new') newStory();
    else if (action === 'sample') replaceWithUndo(normalize(window.SAMPLE_STORY), 'Loaded “The Cast Away”.');
  });

  els.importInput.addEventListener('change', () => {
    importStory(els.importInput.files[0]);
    els.importInput.value = '';
  });

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));

  // Anything with data-goto-scene opens that scene (issue list, "reached from" chips).
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-goto-scene]');
    if (target) openScene(target.dataset.gotoScene);
    if (!event.target.closest('.popover-wrap')) closePopovers();
  });

  els.sceneList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-id]');
    if (item) openScene(item.dataset.id);
  });

  els.sceneView.addEventListener('input', (event) => {
    const t = event.target;
    const s = current();
    if (t.dataset.field) {
      s[t.dataset.field] = t.value;
      update();
    } else if (t.dataset.optText !== undefined) {
      s.options[Number(t.dataset.optText)].text = t.value;
      update();
    } else if (t.dataset.bgCustom !== undefined) {
      // Live while the color picker is open; the form is rebuilt on "change", once it closes.
      s.bg = t.value;
      t.nextElementSibling.style.background = t.value;
      update();
    }
  });

  els.sceneView.addEventListener('change', (event) => {
    const t = event.target;
    if (t.name === 'sceneType') setType(t.value);
    else if (t.name === 'sceneBg') setBackground(t.value, 'input[name="sceneBg"]:checked');
    else if (t.dataset.bgCustom !== undefined) setBackground(t.value, '[data-bg-custom]');
    else if (t.dataset.optGoto !== undefined) setDestination(Number(t.dataset.optGoto), t.value);
    else if (t.dataset.file === 'gif') uploadGif(t.files[0]);
  });

  els.sceneView.addEventListener('click', (event) => {
    const s = current();

    const previewOption = event.target.closest('#previewFrame [data-option]');
    if (previewOption) {
      const index = Number(previewOption.dataset.option);
      const goto = s.options[index] && s.options[index].goto;
      if (goto) openScene(goto);
      else showToast(`Option ${LETTERS[index]} isn’t connected to a scene yet.`);
      return;
    }

    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.open !== undefined) {
      openScene(s.options[Number(button.dataset.open)].goto);
    } else if (button.dataset.remove !== undefined) {
      s.options.splice(Number(button.dataset.remove), 1);
      update({ form: true });
    } else if (button.dataset.act === 'add-option') {
      s.options.push({ text: '', goto: '' });
      update({ form: true });
      $(`[data-opt-text="${s.options.length - 1}"]`).focus();
    } else if (button.dataset.act === 'make-start') {
      story.start = s.id;
      update({ form: true });
      showToast(`“${titleOf(s)}” is now where the story starts.`);
    } else if (button.dataset.act === 'delete') {
      deleteScene(s.id);
    } else if (button.dataset.act === 'play-here') {
      openPlayer(s.id);
    } else if (button.dataset.act === 'clear-gif') {
      s.gif = '';
      update({ form: true });
    }
  });

  function mapAction(event, fromKeyboard) {
    const target = event.target.closest('.map-add, .map-del, .map-node');
    if (!target) return false;
    if (target.dataset.add) addBranch(target.dataset.add, { focus: fromKeyboard });
    else if (target.dataset.delete) deleteScene(target.dataset.delete, { focus: fromKeyboard });
    else openScene(target.dataset.id);
    return true;
  }

  els.mapScroll.addEventListener('click', (event) => mapAction(event, false));

  els.mapScroll.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && mapAction(event, true)) event.preventDefault();
  });

  els.mapView.addEventListener('click', (event) => {
    const button = event.target.closest('[data-zoom]');
    if (!button) return;
    if (button.dataset.zoom === 'fit') return fitMap();
    zoom = Math.min(1.6, Math.max(0.3, Math.round((zoom + Number(button.dataset.zoom) * 0.2) * 10) / 10));
    renderMap();
  });

  els.playOverlay.addEventListener('click', (event) => {
    const button = event.target.closest('[data-play]');
    if (!button) return;
    const action = button.dataset.play;
    if (action === 'restart') player.restart();
    else if (action === 'close') closePlayer();
    else if (action === 'edit') {
      const id = player.currentId;
      closePlayer();
      openScene(id);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (player) closePlayer();
    else closePopovers();
  });

  // Leaving the page (Back to start, closing the tab) right after an edit still saves it.
  window.addEventListener('pagehide', () => {
    if (saveTimer) saveNow();
  });

  // ---------------------------------------------------------------------------
  // Start

  els.storyTitle.value = story.title;
  renderLives();
  update({ form: true });
})();
