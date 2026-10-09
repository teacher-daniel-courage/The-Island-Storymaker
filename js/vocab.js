/*
 * Vocabulary review
 * Teachers make word lists (each word with a picture and, if they like,
 * their own recording of it), then show the words to the class one at a
 * time as a picture, the written word or its sound.
 *
 * Lists are kept in this browser with IndexedDB, because pictures and
 * recordings are too big for localStorage. Export saves a list as one
 * .vocab.json file (pictures and recordings included) to move it to
 * another computer; "Open a list file" brings it back.
 */
(function () {
  'use strict';

  const DB_NAME = 'vocab-review';
  const STORE = 'lists';
  const SETTINGS_KEY = 'vocab-review:settings';
  const FILE_FORMAT = 'vocab-list';
  const MAX_IMAGE_SIDE = 1600;
  const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
  const MAX_RECORDING_MS = 10000;
  const PAGE_TITLE = document.title;
  const SHOW_MODES = ['image', 'word', 'sound'];

  const $ = (selector) => document.querySelector(selector);
  const els = {
    backBtn: $('#backBtn'),
    backLabel: $('#backLabel'),
    storageWarning: $('#storageWarning'),
    listsView: $('#listsView'),
    newListBtn: $('#newListBtn'),
    importBtn: $('#importBtn'),
    importInput: $('#importInput'),
    listsGrid: $('#listsGrid'),
    listsEmpty: $('#listsEmpty'),
    editView: $('#editView'),
    listName: $('#listName'),
    wordCount: $('#wordCount'),
    reviewBtn: $('#reviewBtn'),
    exportBtn: $('#exportBtn'),
    deleteListBtn: $('#deleteListBtn'),
    wordRows: $('#wordRows'),
    addWordBtn: $('#addWordBtn'),
    imageInput: $('#imageInput'),
    setupView: $('#setupView'),
    setupTitle: $('#setupTitle'),
    setupCount: $('#setupCount'),
    shuffleOpt: $('#shuffleOpt'),
    setupNotes: $('#setupNotes'),
    startBtn: $('#startBtn'),
    editListBtn: $('#editListBtn'),
    stage: $('#stage'),
    stageProgress: $('#stageProgress'),
    stageBarFill: $('#stageBarFill'),
    stageCard: $('#stageCard'),
    stageNav: $('#stageNav'),
    prevBtn: $('#prevBtn'),
    nextBtn: $('#nextBtn'),
    fullscreenBtn: $('#fullscreenBtn'),
    closeStageBtn: $('#closeStageBtn'),
    toast: $('#toast'),
  };

  const ICONS = {
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M10 4h4M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>',
  };

  let db = null;          // null when this browser won't let the page save
  let lists = [];
  let current = null;     // the list being edited or reviewed
  let activeRowId = null; // the word a pasted picture goes to
  let pictureTarget = null;
  let recording = null;   // { wordId, recorder, stream, timer, started }
  let playingAudio = null;
  let settings = loadSettings();

  // ---------- Small helpers

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function formatDate(ms) {
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const urlCache = new WeakMap();
  function srcOf(image) {
    if (!image) return '';
    if (typeof image === 'string') return image;
    let url = urlCache.get(image);
    if (!url) {
      url = URL.createObjectURL(image);
      urlCache.set(image, url);
    }
    return url;
  }

  let toastTimer = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4500);
  }

  function loadSettings() {
    const defaults = { shuffle: true };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (saved && typeof saved.shuffle === 'boolean') return { shuffle: saved.shuffle };
    } catch { /* use the defaults */ }
    return defaults;
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not saved */ }
  }

  // ---------- Storage

  function openDB() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  function run(mode, action) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = action(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const saveTimers = new Map();

  function scheduleSave(list) {
    list.updated = Date.now();
    clearTimeout(saveTimers.get(list.id));
    saveTimers.set(list.id, setTimeout(() => saveNow(list), 400));
  }

  async function saveNow(list) {
    clearTimeout(saveTimers.get(list.id));
    saveTimers.delete(list.id);
    if (!db) return;
    try {
      await run('readwrite', (store) => store.put(list));
    } catch (err) {
      showToast(`Couldn't save “${list.name}”. The browser may be out of space.`);
      console.error(err);
    }
  }

  function flushSaves() {
    for (const id of [...saveTimers.keys()]) {
      const list = lists.find((l) => l.id === id);
      if (list) saveNow(list);
    }
  }

  async function removeList(list) {
    clearTimeout(saveTimers.get(list.id));
    saveTimers.delete(list.id);
    lists = lists.filter((l) => l !== list);
    if (db) {
      try { await run('readwrite', (store) => store.delete(list.id)); } catch (err) { console.error(err); }
    }
  }

  // ---------- Routing: #list=ID edits a list, #review=ID sets up its review

  function go(hash) {
    if (location.hash === hash || (hash === '' && !location.hash)) route();
    else location.hash = hash;
  }

  function route() {
    stopSounds();
    stopRecording();
    closeStage();
    if (current && els.editView.hidden === false) pruneEmptyWords(current);

    const [kind, rawId] = location.hash.slice(1).split('=');
    const list = rawId && lists.find((l) => l.id === decodeURIComponent(rawId));
    els.listsView.hidden = els.editView.hidden = els.setupView.hidden = true;

    if (list && kind === 'list') showEdit(list);
    else if (list && kind === 'review') showSetup(list);
    else showLists();
    window.scrollTo(0, 0);
  }

  function setBack(toLists) {
    els.backBtn.href = toLists ? '#' : 'index.html';
    els.backLabel.textContent = toLists ? 'All word lists' : 'Back to start';
  }

  // ---------- All lists

  function showLists() {
    current = null;
    document.title = PAGE_TITLE;
    setBack(false);
    els.listsView.hidden = false;
    renderLists();
  }

  function renderLists() {
    els.listsGrid.innerHTML = '';
    els.listsEmpty.hidden = lists.length > 0;
    const sorted = [...lists].sort((a, b) => b.updated - a.updated);

    for (const list of sorted) {
      const words = usableWords(list);
      const card = el('article', 'vl-card');

      const thumbs = el('div', 'vl-thumbs');
      const pictures = list.words.filter((w) => w.image).slice(0, 4);
      for (const w of pictures) {
        const img = el('img');
        img.src = srcOf(w.image);
        img.alt = '';
        img.loading = 'lazy';
        thumbs.append(img);
      }
      if (!pictures.length) {
        thumbs.classList.add('is-empty');
        thumbs.innerHTML = ICONS.image;
      }

      const body = el('div', 'vl-body');
      const title = el('h2');
      const open = el('a', 'vl-open', list.name || 'Untitled list');
      open.href = `#list=${encodeURIComponent(list.id)}`;
      title.append(open);
      body.append(title, el('p', 'vl-meta', `${plural(words.length, 'word')} · Edited ${formatDate(list.updated)}`));

      const actions = el('div', 'vl-actions');
      const edit = el('a', 'btn', 'Edit');
      edit.href = open.href;
      const review = el('a', 'btn btn-primary', 'Review');
      review.href = `#review=${encodeURIComponent(list.id)}`;
      if (!words.length) {
        review.classList.add('is-disabled');
        review.removeAttribute('href');
        review.setAttribute('aria-disabled', 'true');
      }
      actions.append(edit, review);
      body.append(actions);

      card.append(thumbs, body);
      els.listsGrid.append(card);
    }
  }

  function createList() {
    const now = Date.now();
    const list = {
      id: newId(),
      name: `Class of ${formatDate(now)}`,
      created: now,
      updated: now,
      words: [newWord()],
    };
    lists.push(list);
    saveNow(list);
    go(`#list=${encodeURIComponent(list.id)}`);
    setTimeout(() => {
      const input = els.wordRows.querySelector('.vw-word');
      if (input) input.focus();
    });
  }

  function newWord() {
    // show: what the students see in the review ('image', 'word' or 'sound').
    return { id: newId(), word: '', meaning: '', pos: '', show: 'word', image: null, audio: null };
  }

  function usableWords(list) {
    return list.words.filter((w) => w.word.trim());
  }

  function pruneEmptyWords(list) {
    const kept = list.words.filter((w) => w.word.trim() || w.meaning || w.image || w.audio);
    if (kept.length !== list.words.length) {
      list.words = kept;
      scheduleSave(list);
    }
  }

  // ---------- Editing a list

  function showEdit(list) {
    current = list;
    activeRowId = null;
    lookups.clear();
    document.title = `${list.name || 'Untitled list'} · ${PAGE_TITLE}`;
    setBack(true);
    els.editView.hidden = false;
    els.listName.value = list.name;
    if (!list.words.length) list.words.push(newWord());
    renderRows();
  }

  function updateCount() {
    const words = usableWords(current);
    const n = words.length;
    const withPictures = words.filter((w) => w.image).length;
    const withMeanings = words.filter((w) => w.meaning.trim()).length;
    els.wordCount.textContent = n
      ? `${plural(n, 'word')}: ${withMeanings} with a meaning, ${withPictures} with a picture`
      : 'No words yet';
    els.reviewBtn.disabled = n === 0;
  }

  function renderRows() {
    els.wordRows.innerHTML = '';
    current.words.forEach((word, i) => els.wordRows.append(buildRow(word, i)));
    updateCount();
  }

  function refreshRow(word) {
    const row = els.wordRows.querySelector(`[data-id="${word.id}"]`);
    if (!row) return;
    const focused = row.contains(document.activeElement) && ['vw-word', 'vw-meaning']
      .find((c) => document.activeElement.classList.contains(c));
    const fresh = buildRow(word, current.words.indexOf(word));
    row.replaceWith(fresh);
    if (focused) fresh.querySelector(`.${focused}`).focus();
    updateCount();
  }

  function buildPicture(word) {
    const pic = el('div', 'vw-pic');
    if (word.image) {
      pic.classList.add('has-pic');
      const img = el('img');
      img.src = srcOf(word.image);
      img.alt = word.word ? `Picture for “${word.word}”` : 'Picture';
      img.addEventListener('error', () => {
        pic.classList.add('is-broken');
        img.replaceWith(el('span', 'vw-broken', 'Picture didn\'t load'));
      }, { once: true });
      const change = el('button', 'vw-pic-change');
      change.type = 'button';
      change.dataset.act = 'pick-image';
      change.setAttribute('aria-label', 'Change picture');
      change.append(img);
      const remove = el('button', 'vw-pic-remove');
      remove.type = 'button';
      remove.dataset.act = 'remove-image';
      remove.setAttribute('aria-label', 'Remove picture');
      remove.innerHTML = ICONS.close;
      pic.append(change, remove);
    } else {
      const add = el('button', 'vw-pic-add');
      add.type = 'button';
      add.dataset.act = 'pick-image';
      add.innerHTML = `${ICONS.image}<span>Add picture</span>`;
      pic.append(add);
    }
    return pic;
  }

  function buildWordPreview(word) {
    const box = el('div', 'vw-preview');
    const text = el('span', 'vw-preview-word', word.word.trim() || 'Type the word');
    if (!word.word.trim()) text.classList.add('is-empty');
    box.append(text);
    return box;
  }

  function buildSound(word) {
    const box = el('div', 'vw-sound');
    const play = el('button', 'vw-sound-play');
    play.type = 'button';
    play.dataset.act = 'play-sound';
    play.innerHTML = ICONS.speaker;
    play.append(el('span', null, word.audio ? 'Play my recording' : 'Play computer voice'));
    box.append(play);
    if (recording && recording.wordId === word.id) {
      const stop = iconButton('stop-recording', ICONS.stop, 'Stop recording');
      stop.classList.add('is-recording');
      box.append(stop);
    } else if (word.audio) {
      box.append(iconButton('delete-recording', ICONS.close, 'Use computer voice'));
    } else {
      box.append(iconButton('record', ICONS.mic, 'Record my voice'));
    }
    return box;
  }

  function buildRow(word, index) {
    const row = el('li', 'vw-row');
    row.dataset.id = word.id;
    if (word.id === activeRowId) row.classList.add('is-active');

    row.append(el('span', 'vw-num', String(index + 1)));

    // What the students are shown: a picture, the word or its sound.
    const show = el('div', 'vw-show');
    show.append(el('span', 'vw-show-label', 'Students see'));
    const modes = el('div', 'vw-modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', `Show word ${index + 1} to the students as`);
    for (const [mode, icon, label] of [['image', ICONS.image, 'Picture'], ['word', ICONS.text, 'Word'], ['sound', ICONS.speaker, 'Sound']]) {
      const btn = el('button', 'vw-mode');
      btn.type = 'button';
      btn.dataset.act = 'show';
      btn.dataset.show = mode;
      btn.setAttribute('aria-pressed', String(word.show === mode));
      btn.innerHTML = icon;
      btn.append(el('span', null, label));
      modes.append(btn);
    }
    show.append(modes);
    if (word.show === 'image') show.append(buildPicture(word));
    else if (word.show === 'sound') show.append(buildSound(word));
    else show.append(buildWordPreview(word));

    // The answer: the word and its meaning.
    const main = el('div', 'vw-main');
    main.append(el('span', 'vw-show-label', 'Answer'));

    const line = el('div', 'vw-line');
    const input = el('input', 'vw-word');
    input.type = 'text';
    input.value = word.word;
    input.placeholder = 'Type the word';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', `Word ${index + 1}`);
    const lookupBtn = el('button', 'btn vw-lookup', 'Look up meaning');
    lookupBtn.type = 'button';
    lookupBtn.dataset.act = 'lookup';
    line.append(input, lookupBtn);

    const meaningWrap = el('div', 'vw-meaning-wrap');
    if (word.pos) {
      const tag = el('span', 'vw-pos', word.pos);
      const clear = el('button', 'vw-pos-clear');
      clear.type = 'button';
      clear.dataset.act = 'clear-pos';
      clear.setAttribute('aria-label', `Remove “${word.pos}”`);
      clear.innerHTML = ICONS.close;
      tag.append(clear);
      meaningWrap.append(tag);
    }
    const meaning = el('textarea', 'vw-meaning');
    meaning.rows = 2;
    meaning.value = word.meaning;
    meaning.placeholder = 'Meaning, shown with the answer. Type it, or click Look up meaning.';
    meaning.setAttribute('aria-label', `Meaning of word ${index + 1}`);
    meaningWrap.append(meaning);

    const lookup = lookups.get(word.id);
    let choices = null;
    if (lookup) {
      choices = el('div', 'vw-choices');
      choices.setAttribute('role', 'region');
      choices.setAttribute('aria-label', `Meanings of “${lookup.word}”`);
      if (lookup.status === 'loading') {
        choices.append(el('p', 'vw-choices-note', `Looking up “${lookup.word}”…`));
      } else if (lookup.status === 'error') {
        choices.append(el('p', 'vw-choices-note is-error', lookup.message));
      } else {
        choices.append(el('p', 'vw-choices-note', `Click the meaning you taught (you can edit it after):`));
        const ul = el('ul');
        lookup.choices.forEach((c, i) => {
          const li = el('li');
          const pick = el('button', 'vw-choice');
          pick.type = 'button';
          pick.dataset.act = 'pick-meaning';
          pick.dataset.choice = String(i);
          pick.append(el('span', 'vw-choice-pos', c.pos), document.createTextNode(c.meaning));
          li.append(pick);
          ul.append(li);
        });
        choices.append(ul);
        const source = el('p', 'vw-choices-source');
        source.append('Meanings from ');
        const a = el('a', null, lookup.sourceName);
        a.href = lookup.sourceUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        source.append(a, '.');
        choices.append(source);
      }
      const close = el('button', 'vw-choices-close');
      close.type = 'button';
      close.dataset.act = 'close-lookup';
      close.setAttribute('aria-label', 'Close the meanings');
      close.innerHTML = ICONS.close;
      choices.append(close);
    }

    main.append(line, meaningWrap);
    if (choices) main.append(choices);

    const del = el('button', 'vw-delete');
    del.type = 'button';
    del.dataset.act = 'delete-word';
    del.setAttribute('aria-label', `Delete word ${index + 1}`);
    del.title = 'Delete this word';
    del.innerHTML = ICONS.trash;

    row.append(show, main, del);
    return row;
  }

  function iconButton(act, icon, label) {
    const btn = el('button', 'btn btn-sm');
    btn.type = 'button';
    btn.dataset.act = act;
    btn.innerHTML = icon;
    if (label) btn.append(el('span', null, label));
    return btn;
  }

  function wordOfRow(row) {
    return row && current && current.words.find((w) => w.id === row.dataset.id);
  }

  function setActiveRow(id) {
    if (activeRowId === id) return;
    activeRowId = id;
    for (const row of els.wordRows.children) row.classList.toggle('is-active', row.dataset.id === id);
  }

  function addWord(afterWord) {
    const word = newWord();
    const at = afterWord ? current.words.indexOf(afterWord) + 1 : current.words.length;
    current.words.splice(at, 0, word);
    scheduleSave(current);
    renderRows();
    els.wordRows.querySelector(`[data-id="${word.id}"] .vw-word`).focus();
  }

  function deleteWord(word) {
    const hasContent = word.word.trim() || word.image || word.audio;
    if (hasContent && !confirm(`Delete “${word.word.trim() || 'this word'}”?`)) return;
    if (recording && recording.wordId === word.id) stopRecording(true);
    const at = current.words.indexOf(word);
    current.words.splice(at, 1);
    if (!current.words.length) current.words.push(newWord());
    scheduleSave(current);
    renderRows();
    const next = els.wordRows.children[Math.min(at, current.words.length - 1)];
    if (next) next.querySelector('.vw-word').focus();
  }

  // ---------- Pictures

  async function setPicture(word, source) {
    try {
      word.image = typeof source === 'string' ? source : await shrinkImage(source);
      word.show = 'image';
    } catch (err) {
      console.error(err);
      showToast('That picture couldn\'t be used. Try a different one.');
      return;
    }
    scheduleSave(current);
    refreshRow(word);
  }

  // Big photos are scaled down so a list of 30 words stays small enough to
  // save and export. GIFs and SVGs are kept as they are.
  function shrinkImage(file) {
    if (!file.type.startsWith('image/')) return Promise.reject(new Error('Not an image'));
    if (/gif|svg/.test(file.type)) return Promise.resolve(file);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && file.size <= MAX_IMAGE_BYTES) { resolve(file); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not resize'))), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  function imageFromTransfer(data) {
    const file = [...(data.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) return file;
    const item = [...(data.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (item) return item.getAsFile();
    const html = data.getData('text/html');
    const match = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && /^(https?:|data:image\/)/.test(match[1])) return match[1].replace(/&amp;/g, '&');
    const text = (data.getData('text/uri-list') || data.getData('text/plain') || '').trim().split('\n')[0];
    if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i.test(text)) return text;
    return null;
  }

  // ---------- Sound

  let voice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
    const rank = (v) => (/en[-_]US/i.test(v.lang) ? 2 : 0) + (/natural|google|online/i.test(v.name) ? 1 : 0);
    voice = voices.sort((a, b) => rank(b) - rank(a))[0] || null;
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) {
      showToast('This browser can\'t read words aloud. Record your own voice instead.');
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : 'en-US';
    if (voice) u.voice = voice;
    u.rate = 0.85;
    speechSynthesis.speak(u);
  }

  function playRecording(word) {
    stopSounds();
    playingAudio = new Audio(srcOf(word.audio));
    playingAudio.play().catch(() => showToast('That recording couldn\'t be played.'));
  }

  // The teacher's own recording if there is one, otherwise the computer voice.
  function playWord(word) {
    if (word.audio) playRecording(word);
    else {
      stopSounds();
      speak(word.word);
    }
  }

  function stopSounds() {
    if (playingAudio) { playingAudio.pause(); playingAudio = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  async function startRecording(word) {
    if (recording) stopRecording();
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      showToast('This browser can\'t record. The computer voice will be used instead.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showToast('The microphone isn\'t available. Check that the browser is allowed to use it.');
      return;
    }
    stopSounds();
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    const wordId = word.id;
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const discard = recording && recording.discard;
      clearTimeout(recording && recording.timer);
      recording = null;
      const list = lists.find((l) => l.words.some((w) => w.id === wordId));
      const target = list && list.words.find((w) => w.id === wordId);
      if (target && !discard && chunks.length) {
        target.audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        target.show = 'sound';
        scheduleSave(list);
      }
      if (target && current === list) {
        refreshRow(target);
        const play = els.wordRows.querySelector(`[data-id="${wordId}"] [data-act="play-sound"]`);
        if (play) play.focus();
      }
    };
    recording = { wordId, recorder, timer: setTimeout(() => stopRecording(), MAX_RECORDING_MS), discard: false };
    recorder.start();
    refreshRow(word);
    const stop = els.wordRows.querySelector(`[data-id="${wordId}"] [data-act="stop-recording"]`);
    if (stop) stop.focus();
  }

  function stopRecording(discard = false) {
    if (!recording) return;
    recording.discard = discard;
    clearTimeout(recording.timer);
    if (recording.recorder.state !== 'inactive') recording.recorder.stop();
  }

  // ---------- Dictionary meanings
  // Wiktionary first; the Free Dictionary API if Wiktionary can't be reached.

  const lookups = new Map(); // word id -> { status, word, choices, message, sourceName, sourceUrl }
  const MAX_CHOICES = 8;

  function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('ul, ol, dl').forEach((n) => n.remove()); // nested examples
    return div.textContent.replace(/\s+/g, ' ').trim();
  }

  // Dictionaries group meanings by sense ("bank" of money, "bank" of a river).
  // Take the first meaning of each group, then the second, and so on, so the
  // short list of choices covers every sense, not just the first.
  function mixGroups(groups) {
    const mixed = [];
    for (let i = 0; mixed.length < MAX_CHOICES && groups.some((g) => i < g.length); i += 1) {
      for (const g of groups) if (i < g.length && mixed.length < MAX_CHOICES) mixed.push(g[i]);
    }
    return mixed;
  }

  async function fromWiktionary(term) {
    // Lowercase first, so "Apple" finds the fruit, not the company.
    for (const t of new Set([term.toLowerCase(), term])) {
      const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(t.replace(/ /g, '_'))}`);
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`Wiktionary answered ${res.status}`);
      const data = await res.json();
      const entries = (data.en || []).filter((e) => !/proper noun/i.test(e.partOfSpeech));
      const groups = entries.map((entry) => (entry.definitions || [])
        .map((d) => ({ pos: entry.partOfSpeech.toLowerCase(), meaning: htmlToText(d.definition || '') }))
        .filter((c) => c.meaning));
      const choices = mixGroups(groups);
      if (choices.length) {
        return { choices, sourceName: 'Wiktionary', sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}#English` };
      }
    }
    return null;
  }

  async function fromFreeDictionary(term) {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term.toLowerCase())}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Free Dictionary answered ${res.status}`);
    const groups = [];
    for (const entry of await res.json()) {
      for (const m of entry.meanings || []) {
        groups.push((m.definitions || [])
          .filter((d) => d.definition)
          .map((d) => ({ pos: m.partOfSpeech, meaning: d.definition.trim() })));
      }
    }
    const choices = mixGroups(groups);
    return choices.length ? { choices, sourceName: 'the Free Dictionary', sourceUrl: 'https://dictionaryapi.dev/' } : null;
  }

  async function lookUp(word) {
    const term = word.word.trim();
    if (!term) {
      showToast('Type the word first.');
      return;
    }
    lookups.set(word.id, { status: 'loading', word: term });
    refreshRow(word);

    let found = null;
    let answered = false; // a dictionary was reached, even if it had no meaning
    for (const source of [fromWiktionary, fromFreeDictionary]) {
      try {
        found = await source(term);
        answered = true;
        if (found) break;
      } catch (err) {
        console.error(err);
      }
    }

    // The teacher may have moved on (changed the word, closed the box, left the list).
    const state = lookups.get(word.id);
    if (!state || state.word !== term) return;
    if (found) {
      lookups.set(word.id, { status: 'done', word: term, ...found, choices: found.choices.slice(0, MAX_CHOICES) });
    } else {
      lookups.set(word.id, {
        status: 'error',
        word: term,
        message: answered
          ? `No meaning found for “${term}”. Check the spelling, or type the meaning yourself.`
          : 'The dictionary couldn\'t be reached. Check the internet connection, or type the meaning yourself.',
      });
    }
    refreshRow(word);
    const first = els.wordRows.querySelector(`[data-id="${word.id}"] .vw-choice`);
    if (first) first.focus();
  }

  function pickMeaning(word, index) {
    const choice = lookups.get(word.id).choices[index];
    word.meaning = choice.meaning;
    word.pos = choice.pos;
    lookups.delete(word.id);
    scheduleSave(current);
    refreshRow(word);
    const box = els.wordRows.querySelector(`[data-id="${word.id}"] .vw-meaning`);
    if (box) box.focus();
  }

  // ---------- Export and import

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function exportList(list) {
    const words = [];
    for (const w of list.words.filter((x) => x.word.trim())) {
      words.push({
        word: w.word.trim(),
        meaning: w.meaning.trim(),
        pos: w.pos,
        show: w.show,
        image: w.image ? (typeof w.image === 'string' ? w.image : await blobToDataURL(w.image)) : null,
        audio: w.audio ? await blobToDataURL(w.audio) : null,
      });
    }
    const data = { format: FILE_FORMAT, version: 1, name: list.name, words };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const slug = (list.name || 'word-list').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'word-list';
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.vocab.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function dataURLToBlob(url) {
    return (await fetch(url)).blob();
  }

  async function importFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { data = null; }
    if (!data || data.format !== FILE_FORMAT || !Array.isArray(data.words)) {
      throw new Error(`“${file.name}” isn't a word list file.`);
    }
    const now = Date.now();
    const list = { id: newId(), name: String(data.name || 'Imported list'), created: now, updated: now, words: [] };
    for (const w of data.words) {
      if (!w || typeof w.word !== 'string') continue;
      const word = newWord();
      word.word = w.word;
      if (typeof w.meaning === 'string') word.meaning = w.meaning;
      if (typeof w.pos === 'string') word.pos = w.pos;
      if (typeof w.image === 'string' && w.image) {
        word.image = w.image.startsWith('data:') ? await dataURLToBlob(w.image) : w.image;
      }
      if (typeof w.audio === 'string' && w.audio.startsWith('data:')) word.audio = await dataURLToBlob(w.audio);
      word.show = SHOW_MODES.includes(w.show) ? w.show : (word.image ? 'image' : 'word');
      list.words.push(word);
    }
    lists.push(list);
    await saveNow(list);
    return list;
  }

  async function importFiles(files) {
    let opened = 0;
    for (const file of files) {
      try {
        await importFile(file);
        opened += 1;
      } catch (err) {
        showToast(err.message);
      }
    }
    if (opened) {
      renderLists();
      showToast(`Opened ${plural(opened, 'list')}.`);
    }
  }

  // ---------- Review setup

  // Words set to Picture that have no picture yet are left out of the review.
  function missingPictures(list) {
    return usableWords(list).filter((w) => w.show === 'image' && !w.image);
  }

  function showSetup(list) {
    current = list;
    document.title = `Review: ${list.name || 'Untitled list'} · ${PAGE_TITLE}`;
    setBack(true);
    els.setupView.hidden = false;
    els.setupTitle.textContent = list.name || 'Untitled list';
    const words = usableWords(list);
    const missing = missingPictures(list);
    const ready = words.filter((w) => !missing.includes(w));
    const count = (mode) => ready.filter((w) => w.show === mode).length;
    const parts = [
      count('image') && `${count('image')} as a picture`,
      count('word') && `${count('word')} as the written word`,
      count('sound') && `${count('sound')} as a sound`,
    ].filter(Boolean);
    els.setupCount.textContent = ready.length
      ? `${plural(ready.length, 'word')}: ${parts.join(', ')}.`
      : 'No words ready to review yet.';

    const notes = [];
    if (missing.length) {
      notes.push(`Left out because they're set to Picture but have no picture yet: ${missing.map((w) => `“${w.word.trim()}”`).join(', ')}.`);
    }
    const noMeaning = ready.filter((w) => !w.meaning.trim()).length;
    if (noMeaning) notes.push(`${plural(noMeaning, 'word')} ${noMeaning === 1 ? 'has' : 'have'} no meaning yet, so the answer will show just the word.`);
    els.setupNotes.innerHTML = '';
    for (const n of notes) els.setupNotes.append(el('li', null, n));
    els.setupNotes.hidden = !notes.length;

    els.shuffleOpt.checked = settings.shuffle;
    els.startBtn.disabled = ready.length === 0;
  }

  // ---------- The review itself

  let deck = [];
  let pos = 0;
  let revealed = false;

  function buildDeck() {
    const missing = missingPictures(current);
    const cards = usableWords(current).filter((w) => !missing.includes(w));
    if (settings.shuffle) {
      for (let i = cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }
    return cards;
  }

  function startReview() {
    settings = { shuffle: els.shuffleOpt.checked };
    saveSettings();
    deck = buildDeck();
    if (!deck.length) return;
    pos = 0;
    revealed = false;
    els.stage.hidden = false;
    document.body.classList.add('is-reviewing');
    renderCard();
    els.nextBtn.focus();
  }

  function closeStage() {
    if (els.stage.hidden) return;
    stopSounds();
    els.stage.hidden = true;
    document.body.classList.remove('is-reviewing');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (!els.setupView.hidden) els.startBtn.focus();
  }

  const PROMPTS = {
    image: 'What is this?',
    word: 'What does it mean?',
    sound: 'Listen. What word is it?',
  };

  // Before the answer: only what the teacher chose for this word (its picture,
  // the written word, or its sound). The answer: the word and its meaning.
  function renderCard() {
    stopSounds();
    const card = els.stageCard;
    card.innerHTML = '';
    const done = pos >= deck.length;
    els.stageProgress.textContent = done ? `${deck.length} / ${deck.length}` : `${pos + 1} / ${deck.length}`;
    els.stageBarFill.style.width = `${((done ? deck.length : pos + (revealed ? 1 : 0)) / deck.length) * 100}%`;
    els.prevBtn.disabled = pos === 0 && !revealed;

    if (done) {
      card.className = 'stage-card is-done';
      card.append(el('p', 'stage-done-title', 'All done!'));
      card.append(el('p', 'stage-done-text', `You reviewed ${plural(deck.length, 'word')}.`));
      const again = el('button', 'btn btn-primary btn-large', 'Review again');
      again.type = 'button';
      again.addEventListener('click', () => {
        deck = buildDeck();
        pos = 0;
        revealed = false;
        renderCard();
        els.nextBtn.focus();
      });
      const close = el('button', 'btn btn-large', 'Close');
      close.type = 'button';
      close.addEventListener('click', closeStage);
      const actions = el('div', 'stage-done-actions');
      actions.append(again, close);
      card.append(actions);
      els.stageNav.classList.add('is-done');
      again.focus();
      return;
    }

    els.stageNav.classList.remove('is-done');
    const word = deck[pos];
    const type = word.show;
    card.className = `stage-card is-${type}${revealed ? ' is-revealed' : ''}`;
    card.append(el('p', 'stage-question', revealed ? 'Answer' : PROMPTS[type]));

    const body = el('div', 'stage-body');
    if (!revealed) {
      if (type === 'image') body.append(stageImage(word));
      else if (type === 'sound') {
        const listen = el('button', 'stage-listen');
        listen.type = 'button';
        listen.innerHTML = `${ICONS.speaker}<span>Play again</span>`;
        listen.addEventListener('click', () => playWord(word));
        body.append(listen);
        playWord(word);
      } else body.append(el('p', 'stage-word', word.word));
    } else {
      const answer = el('div', 'stage-answer');
      answer.append(el('p', 'stage-word', word.word));
      if (word.pos) answer.append(el('p', 'stage-pos', word.pos));
      if (word.meaning.trim()) answer.append(el('p', 'stage-meaning', word.meaning.trim()));
      body.append(answer);
    }
    card.append(body);
    els.nextBtn.innerHTML = revealed
      ? (pos === deck.length - 1 ? 'Finish' : 'Next <span aria-hidden="true">→</span>')
      : 'Show answer';
  }

  function stageImage(word) {
    const img = el('img', 'stage-img');
    img.src = srcOf(word.image);
    img.alt = 'Picture of the word';
    img.addEventListener('error', () => img.replaceWith(el('p', 'stage-broken', 'The picture didn\'t load.')), { once: true });
    return img;
  }

  function next() {
    if (pos >= deck.length) return;
    if (!revealed) revealed = true;
    else { pos += 1; revealed = false; }
    renderCard();
  }

  function prev() {
    if (pos === 0 && !revealed) return;
    if (revealed) revealed = false;
    else pos -= 1;
    if (pos >= deck.length) pos = deck.length - 1;
    renderCard();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (els.stage.requestFullscreen) els.stage.requestFullscreen().catch(() => {});
  }

  // ---------- Events

  els.newListBtn.addEventListener('click', createList);
  els.importBtn.addEventListener('click', () => els.importInput.click());
  els.importInput.addEventListener('change', async () => {
    const files = [...els.importInput.files];
    els.importInput.value = '';
    await importFiles(files);
  });

  els.listName.addEventListener('input', () => {
    current.name = els.listName.value;
    document.title = `${current.name || 'Untitled list'} · ${PAGE_TITLE}`;
    scheduleSave(current);
  });

  els.reviewBtn.addEventListener('click', () => go(`#review=${encodeURIComponent(current.id)}`));
  els.editListBtn.addEventListener('click', () => go(`#list=${encodeURIComponent(current.id)}`));
  els.exportBtn.addEventListener('click', () => {
    if (!usableWords(current).length) { showToast('Add some words before exporting.'); return; }
    exportList(current).catch((err) => { console.error(err); showToast('Export didn\'t work.'); });
  });
  els.deleteListBtn.addEventListener('click', async () => {
    if (!confirm(`Delete the list “${current.name || 'Untitled list'}” and all its words? This can't be undone.`)) return;
    stopRecording(true);
    const list = current;
    current = null;
    await removeList(list);
    go('');
  });
  els.addWordBtn.addEventListener('click', () => addWord());

  els.wordRows.addEventListener('focusin', (e) => {
    const row = e.target.closest('.vw-row');
    if (row) setActiveRow(row.dataset.id);
  });
  els.wordRows.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.vw-row');
    if (row) setActiveRow(row.dataset.id);
  });

  els.wordRows.addEventListener('input', (e) => {
    const row = e.target.closest('.vw-row');
    const word = wordOfRow(row);
    if (!word) return;
    if (e.target.classList.contains('vw-word')) {
      word.word = e.target.value;
      const preview = row.querySelector('.vw-preview-word');
      if (preview) {
        preview.textContent = word.word.trim() || 'Type the word';
        preview.classList.toggle('is-empty', !word.word.trim());
      }
      // Meanings looked up for the old spelling no longer apply.
      const lookup = lookups.get(word.id);
      if (lookup && lookup.word !== word.word.trim()) {
        lookups.delete(word.id);
        const box = row.querySelector('.vw-choices');
        if (box) box.remove();
      }
    } else if (e.target.classList.contains('vw-meaning')) {
      word.meaning = e.target.value;
    } else return;
    scheduleSave(current);
    updateCount();
  });

  // Enter moves to the next word, adding one at the end of the list.
  els.wordRows.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('vw-word')) return;
    e.preventDefault();
    const row = e.target.closest('.vw-row');
    const nextRow = row.nextElementSibling;
    if (nextRow) nextRow.querySelector('.vw-word').focus();
    else if (e.target.value.trim()) addWord(wordOfRow(row));
  });

  els.wordRows.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const word = wordOfRow(btn.closest('.vw-row'));
    if (!word) return;
    switch (btn.dataset.act) {
      case 'pick-image':
        pictureTarget = word;
        els.imageInput.click();
        break;
      case 'remove-image':
        word.image = null;
        scheduleSave(current);
        refreshRow(word);
        break;
      case 'lookup': lookUp(word); break;
      case 'pick-meaning': pickMeaning(word, Number(btn.dataset.choice)); break;
      case 'close-lookup':
        lookups.delete(word.id);
        refreshRow(word);
        break;
      case 'clear-pos':
        word.pos = '';
        scheduleSave(current);
        refreshRow(word);
        break;
      case 'show':
        if (word.show === btn.dataset.show) return;
        word.show = btn.dataset.show;
        scheduleSave(current);
        refreshRow(word);
        els.wordRows.querySelector(`[data-id="${word.id}"] [data-show="${word.show}"]`).focus();
        break;
      case 'play-sound':
        if (word.audio) playRecording(word);
        else if (word.word.trim()) speak(word.word);
        else showToast('Type the word first, or record your voice.');
        break;
      case 'record': startRecording(word); break;
      case 'stop-recording': stopRecording(); break;
      case 'delete-recording':
        if (!confirm('Delete your recording of this word? The computer voice will read it instead.')) return;
        word.audio = null;
        scheduleSave(current);
        refreshRow(word);
        break;
      case 'delete-word': deleteWord(word); break;
    }
  });

  els.imageInput.addEventListener('change', () => {
    const file = els.imageInput.files[0];
    els.imageInput.value = '';
    if (file && pictureTarget) setPicture(pictureTarget, file);
    pictureTarget = null;
  });

  // Dragging a picture onto a word.
  els.wordRows.addEventListener('dragover', (e) => {
    const row = e.target.closest('.vw-row');
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    for (const r of els.wordRows.children) r.classList.toggle('is-drop', r === row);
  });
  els.wordRows.addEventListener('dragleave', (e) => {
    if (!els.wordRows.contains(e.relatedTarget)) {
      for (const r of els.wordRows.children) r.classList.remove('is-drop');
    }
  });
  els.wordRows.addEventListener('drop', (e) => {
    const row = e.target.closest('.vw-row');
    for (const r of els.wordRows.children) r.classList.remove('is-drop');
    if (!row) return;
    e.preventDefault();
    const image = imageFromTransfer(e.dataTransfer);
    if (image) setPicture(wordOfRow(row), image);
    else showToast('That isn\'t a picture. Try dragging the image itself.');
  });

  // Ctrl+V pastes a copied picture into the selected word.
  document.addEventListener('paste', (e) => {
    if (els.editView.hidden || !current) return;
    const image = imageFromTransfer(e.clipboardData);
    if (!image) return;
    const inName = document.activeElement === els.listName;
    if (inName) return;
    // A plain link pasted into the word box is just text.
    if (typeof image === 'string' && document.activeElement.classList.contains('vw-word') && !e.clipboardData.getData('text/html')) return;
    e.preventDefault();
    const word = wordOfRow(document.activeElement.closest('.vw-row'))
      || current.words.find((w) => w.id === activeRowId)
      || current.words.find((w) => !w.image)
      || current.words[current.words.length - 1];
    setPicture(word, image);
  });

  // Keep the browser from opening files dropped outside a word.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (e.target.closest && e.target.closest('.vw-row')) return;
    e.preventDefault();
    if (!els.listsView.hidden) {
      const files = [...e.dataTransfer.files].filter((f) => /\.json$/i.test(f.name));
      if (files.length) importFiles(files);
    }
  });

  els.startBtn.addEventListener('click', startReview);
  els.nextBtn.addEventListener('click', next);
  els.prevBtn.addEventListener('click', prev);
  els.closeStageBtn.addEventListener('click', closeStage);
  els.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    els.fullscreenBtn.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  });

  document.addEventListener('keydown', (e) => {
    if (els.stage.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    // Space and Enter on a focused button press that button instead.
    const onButton = Boolean(e.target.closest && e.target.closest('button'));
    if (e.key === 'Escape') {
      if (!document.fullscreenElement) closeStage();
    } else if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      prev();
    } else if (e.key === 's' || e.key === 'S') {
      if (pos < deck.length && !revealed && deck[pos].show === 'sound') playWord(deck[pos]);
    } else if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    }
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', flushSaves);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });

  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }

  // ---------- Start

  (async function start() {
    db = await openDB();
    if (db) {
      try {
        lists = await run('readonly', (store) => store.getAll());
        // Lists saved before words had meanings.
        for (const list of lists) {
          for (const w of list.words) {
            if (typeof w.meaning !== 'string') w.meaning = '';
            if (typeof w.pos !== 'string') w.pos = '';
            if (!SHOW_MODES.includes(w.show)) w.show = w.image ? 'image' : 'word';
          }
        }
      } catch (err) {
        console.error(err);
        lists = [];
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } else {
      els.storageWarning.hidden = false;
    }
    route();
  })();
})();
