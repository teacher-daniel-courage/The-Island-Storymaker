/*
 * Island Player
 * Renders one scene of a story as the scene box and runs the game:
 * choices, lives, death screens and endings. Also cleans up story files.
 * The Storymaker uses it for previews; the play page uses it for the game.
 */
(function () {
  'use strict';

  const LETTERS = ['A', 'B', 'C', 'D'];
  const TYPES = ['choice', 'death', 'ending'];
  const MAX_OPTIONS = 4;
  const MAX_LIVES = 5;
  const HEX = /^#[0-9a-f]{6}$/i;
  const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  /** 0 means lives are off: no hearts, and players can retry as often as they like. */
  function clampLives(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(MAX_LIVES, Math.max(0, n)) : 2;
  }

  /** Cleans up a story from storage or a story file. Throws if it isn't one. */
  function normalizeStory(raw) {
    if (!raw || !Array.isArray(raw.scenes)) throw new Error('This file doesn’t look like a story.');
    const scenes = raw.scenes.filter((s) => s && s.id).map((s) => ({
      id: String(s.id),
      title: String(s.title || ''),
      type: TYPES.includes(s.type) ? s.type : 'choice',
      gif: String(s.gif || ''),
      bg: HEX.test(s.bg || '') ? s.bg.toLowerCase() : '',
      text: String(s.text || ''),
      options: (Array.isArray(s.options) ? s.options : []).slice(0, MAX_OPTIONS).map((o) => ({
        text: String((o && o.text) || ''),
        goto: String((o && o.goto) || ''),
      })),
    }));
    if (!scenes.length) throw new Error('This story has no scenes.');
    const ids = new Set(scenes.map((s) => s.id));
    scenes.forEach((s) => s.options.forEach((o) => { if (!ids.has(o.goto)) o.goto = ''; }));
    return {
      title: String(raw.title || 'Untitled story'),
      lives: clampLives(raw.lives),
      start: ids.has(raw.start) ? raw.start : scenes[0].id,
      scenes,
    };
  }

  /** The creator's pick, or the default: white, and black for death scenes. */
  function sceneBackground(scene) {
    if (HEX.test(scene.bg || '')) return scene.bg.toLowerCase();
    return scene.type === 'death' ? '#000000' : '#ffffff';
  }

  /** True when white text reads better than black on this color. */
  function isDark(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
  }

  function livesHTML(lives, maxLives, justLost) {
    if (!maxLives) return '<div class="ip-lives"></div>';
    let hearts = '';
    for (let i = 0; i < maxLives; i++) {
      const state = i < lives ? 'is-full' : i === lives && justLost ? 'is-empty is-breaking' : 'is-empty';
      hearts += `<svg class="ip-heart ${state}" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}"/></svg>`;
    }
    const label = `${lives} of ${maxLives} ${maxLives === 1 ? 'life' : 'lives'} left`;
    return `<div class="ip-lives" role="img" aria-label="${label}">${hearts}</div>`;
  }

  function optionsHTML(scene) {
    const options = scene.options || [];
    if (!options.length) return '<p class="ip-note">This scene has no options yet.</p>';
    const cards = options.map((o, i) => `
      <button type="button" class="ip-option${o.goto ? '' : ' is-unlinked'}" data-option="${i}" data-letter="${LETTERS[i]}">
        <span class="ip-letter">${LETTERS[i]}</span>
        <span class="ip-desc">${o.text ? esc(o.text) : '<span class="ip-placeholder">No text yet</span>'}</span>
      </button>`).join('');
    return `<div class="ip-options" data-count="${options.length}">${cards}</div>`;
  }

  function outcomeHTML(scene, { lives, maxLives }) {
    if (scene.type === 'ending') {
      return `<div class="ip-outcome is-ending">
        <p class="ip-outcome-text">You made it. The end!</p>
        <button type="button" class="ip-action" data-action="restart">Play again</button>
      </div>`;
    }
    if (!maxLives) {
      return `<div class="ip-outcome is-death">
        <p class="ip-outcome-text">Go back and try another choice.</p>
        <button type="button" class="ip-action" data-action="retry">Try again</button>
      </div>`;
    }
    if (lives > 0) {
      return `<div class="ip-outcome is-death">
        <p class="ip-outcome-text">You lost a life. ${lives} ${lives === 1 ? 'life' : 'lives'} left.</p>
        <button type="button" class="ip-action" data-action="retry">Try again</button>
      </div>`;
    }
    return `<div class="ip-outcome is-death">
      <p class="ip-outcome-text">No lives left. Game over.</p>
      <button type="button" class="ip-action" data-action="restart">Start over</button>
    </div>`;
  }

  /** HTML for one scene. `view` is { lives, maxLives, justLost }; maxLives 0 means no life count. */
  function sceneHTML(scene, view) {
    const type = scene.type || 'choice';
    const media = scene.gif
      ? `<img src="${esc(scene.gif)}" alt="" onload="this.parentNode &amp;&amp; this.parentNode.classList.remove('is-loading')" onerror="this.parentNode &amp;&amp; this.parentNode.classList.add('is-broken')">`
      : '<span class="ip-media-empty">No GIF yet</span>';
    const bg = sceneBackground(scene);
    return `<article class="ip-panel ip-type-${type}${isDark(bg) ? ' is-dark' : ''}" style="--ip-bg:${bg}">
      ${livesHTML(view.lives, view.maxLives, view.justLost)}
      <h2 class="ip-title" tabindex="-1">${scene.title ? esc(scene.title) : '<span class="ip-placeholder">Untitled scene</span>'}</h2>
      <div class="ip-media${scene.gif ? ' has-image is-loading' : ''}">${media}</div>
      ${scene.text ? `<p class="ip-text">${esc(scene.text)}</p>` : ''}
      ${type === 'choice' ? optionsHTML(scene) : outcomeHTML(scene, view)}
    </article>`;
  }

  /**
   * Runs a playable game inside `root`.
   * Dying costs a life. With lives left, "Try again" returns to the scene
   * where the fatal choice was made; with none left, the game restarts.
   * With lives off (story.lives is 0), players can try again as often as they like.
   */
  function createPlayer(root, story, options = {}) {
    const byId = new Map(story.scenes.map((s) => [s.id, s]));
    const maxLives = Math.max(0, parseInt(story.lives, 10) || 0);
    const firstId = byId.has(options.startAt) ? options.startAt : story.start;
    let lives = maxLives;
    let currentId = null;
    let retryId = firstId;
    let toastTimer = null;

    function show(id, fromId, { focus = true } = {}) {
      const scene = byId.get(id);
      if (!scene) return;
      let justLost = false;
      if (scene.type === 'death') {
        if (maxLives) {
          lives = Math.max(0, lives - 1);
          justLost = true;
        }
        retryId = fromId || firstId;
      }
      currentId = id;
      root.innerHTML = sceneHTML(scene, { lives, maxLives, justLost });
      if (focus) root.querySelector('.ip-title').focus({ preventScroll: true });
      if (options.onSceneChange) options.onSceneChange(id);
    }

    function restart({ focus = true } = {}) {
      lives = maxLives;
      retryId = firstId;
      show(firstId, null, { focus });
    }

    function toast(message) {
      const panel = root.querySelector('.ip-panel');
      if (!panel) return;
      let el = panel.querySelector('.ip-toast');
      if (!el) {
        el = document.createElement('div');
        el.className = 'ip-toast';
        el.setAttribute('role', 'status');
        panel.appendChild(el);
      }
      el.textContent = message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.remove(), 2400);
    }

    function onClick(event) {
      const optionBtn = event.target.closest('[data-option]');
      if (optionBtn) {
        const index = Number(optionBtn.dataset.option);
        const option = byId.get(currentId).options[index];
        if (option && byId.has(option.goto)) show(option.goto, currentId);
        else toast(`Option ${LETTERS[index]} doesn’t lead anywhere yet.`);
        return;
      }
      const actionBtn = event.target.closest('[data-action]');
      if (!actionBtn) return;
      if (actionBtn.dataset.action === 'retry') show(retryId, null);
      else restart();
    }

    root.classList.add('ip-animate');
    root.addEventListener('click', onClick);
    restart({ focus: false });

    return {
      restart,
      get currentId() { return currentId; },
      destroy() {
        root.removeEventListener('click', onClick);
        clearTimeout(toastTimer);
      },
    };
  }

  window.IslandPlayer = {
    createPlayer, normalizeStory, clampLives, sceneHTML, sceneBackground, esc,
    LETTERS, MAX_OPTIONS, MAX_LIVES,
  };
})();
