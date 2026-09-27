/*
 * Play page
 * Opens a story file (chosen, dropped anywhere on the page, or the sample)
 * and runs it in the player. The open story is kept for this tab, so
 * reloading the page doesn't lose it.
 */
(function () {
  'use strict';

  const SESSION_KEY = 'island-player:story';
  const PAGE_TITLE = document.title;
  const { createPlayer, normalizeStory } = window.IslandPlayer;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    picker: $('#picker'),
    chooseBtn: $('#chooseBtn'),
    sampleBtn: $('#sampleBtn'),
    fileInput: $('#fileInput'),
    pickerError: $('#pickerError'),
    game: $('#game'),
    gameTitle: $('#gameTitle'),
    gameControls: $('#gameControls'),
    restartBtn: $('#restartBtn'),
    otherStoryBtn: $('#otherStoryBtn'),
    playerRoot: $('#playerRoot'),
    dropOverlay: $('#dropOverlay'),
  };

  let player = null;
  let dragDepth = 0;

  function play(story, { focus = true } = {}) {
    if (player) player.destroy();
    showError('');
    els.picker.hidden = true;
    els.game.hidden = false;
    els.gameControls.hidden = false;
    els.gameTitle.textContent = story.title;
    document.title = `${story.title} · Path.er`;
    player = createPlayer(els.playerRoot, story);
    remember(story);
    window.scrollTo(0, 0);
    if (focus) els.gameTitle.focus({ preventScroll: true });
  }

  function showPicker(error) {
    if (player) player.destroy();
    player = null;
    els.playerRoot.innerHTML = '';
    els.game.hidden = true;
    els.gameControls.hidden = true;
    els.picker.hidden = false;
    document.title = PAGE_TITLE;
    forget();
    showError(error);
    els.chooseBtn.focus();
  }

  function showError(message) {
    els.pickerError.textContent = message || '';
    els.pickerError.hidden = !message;
  }

  function openFile(file) {
    if (!file) return;
    file.text()
      .then((text) => play(normalizeStory(JSON.parse(text))))
      .catch((err) => {
        showPicker(err instanceof SyntaxError
          ? `“${file.name}” isn’t a story file. Choose a .story.json file exported from the Storymaker.`
          : `“${file.name}”: ${err.message}`);
      });
  }

  // ---------------------------------------------------------------------------
  // Keeping the open story for this tab. If it's too big or storage is
  // blocked, it simply won't survive a reload.

  function remember(story) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(story));
    } catch (err) { /* see above */ }
  }

  function forget() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (err) { /* see above */ }
  }

  function remembered() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? normalizeStory(JSON.parse(raw)) : null;
    } catch (err) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Events

  els.chooseBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', () => {
    openFile(els.fileInput.files[0]);
    els.fileInput.value = '';
  });
  els.sampleBtn.addEventListener('click', () => play(normalizeStory(window.SAMPLE_STORY)));
  els.restartBtn.addEventListener('click', () => player && player.restart());
  els.otherStoryBtn.addEventListener('click', () => showPicker());

  // Dropping a file anywhere on the page opens it, even mid-game.
  const hasFiles = (event) => Array.from(event.dataTransfer ? event.dataTransfer.types : []).includes('Files');

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    els.dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dropOverlay.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    els.dropOverlay.hidden = true;
    openFile(event.dataTransfer.files[0]);
  });

  const saved = remembered();
  if (saved) play(saved, { focus: false });
})();
