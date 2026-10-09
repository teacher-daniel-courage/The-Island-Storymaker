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
    imageNote: $('#imageNote'),
    typeBoxes: document.querySelectorAll('#setupView input[name="type"]'),
    shuffleOpt: $('#shuffleOpt'),
    sayOpt: $('#sayOpt'),
    setupError: $('#setupError'),
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
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>',
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
    const defaults = { types: ['image', 'word', 'sound'], shuffle: true, say: true };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (saved && Array.isArray(saved.types)) return { ...defaults, ...saved };
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
    return { id: newId(), word: '', image: null, audio: null };
  }

  function usableWords(list) {
    return list.words.filter((w) => w.word.trim());
  }

  function pruneEmptyWords(list) {
    const kept = list.words.filter((w) => w.word.trim() || w.image || w.audio);
    if (kept.length !== list.words.length) {
      list.words = kept;
      scheduleSave(list);
    }
  }

  // ---------- Editing a list

  function showEdit(list) {
    current = list;
    activeRowId = null;
    document.title = `${list.name || 'Untitled list'} · ${PAGE_TITLE}`;
    setBack(true);
    els.editView.hidden = false;
    els.listName.value = list.name;
    if (!list.words.length) list.words.push(newWord());
    renderRows();
  }

  function updateCount() {
    const n = usableWords(current).length;
    const withPictures = current.words.filter((w) => w.word.trim() && w.image).length;
    els.wordCount.textContent = n
      ? `${plural(n, 'word')}, ${withPictures} with a picture`
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
    const hadFocus = row.contains(document.activeElement) && document.activeElement.classList.contains('vw-word');
    const fresh = buildRow(word, current.words.indexOf(word));
    row.replaceWith(fresh);
    if (hadFocus) fresh.querySelector('.vw-word').focus();
    updateCount();
  }

  function buildRow(word, index) {
    const row = el('li', 'vw-row');
    row.dataset.id = word.id;
    if (word.id === activeRowId) row.classList.add('is-active');

    row.append(el('span', 'vw-num', String(index + 1)));

    // Picture
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

    // Word and sound
    const main = el('div', 'vw-main');
    const input = el('input', 'vw-word');
    input.type = 'text';
    input.value = word.word;
    input.placeholder = 'Type the word';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', `Word ${index + 1}`);

    const sound = el('div', 'vw-sound');
    sound.append(iconButton('speak', ICONS.speaker, 'Computer voice'));
    if (recording && recording.wordId === word.id) {
      const stop = iconButton('stop-recording', ICONS.stop, 'Stop recording');
      stop.classList.add('is-recording');
      sound.append(stop);
    } else if (word.audio) {
      sound.append(iconButton('play-recording', ICONS.play, 'My recording'));
      const del = iconButton('delete-recording', ICONS.close, '');
      del.classList.add('vw-icon-only');
      del.setAttribute('aria-label', 'Delete my recording');
      del.title = 'Delete my recording';
      sound.append(del);
    } else {
      sound.append(iconButton('record', ICONS.mic, 'Record my voice'));
    }
    main.append(input, sound);

    const del = el('button', 'vw-delete');
    del.type = 'button';
    del.dataset.act = 'delete-word';
    del.setAttribute('aria-label', `Delete word ${index + 1}`);
    del.title = 'Delete this word';
    del.innerHTML = ICONS.trash;

    row.append(pic, main, del);
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
        scheduleSave(list);
      }
      if (target && current === list) {
        refreshRow(target);
        const play = els.wordRows.querySelector(`[data-id="${wordId}"] [data-act="play-recording"]`);
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
      if (typeof w.image === 'string' && w.image) {
        word.image = w.image.startsWith('data:') ? await dataURLToBlob(w.image) : w.image;
      }
      if (typeof w.audio === 'string' && w.audio.startsWith('data:')) word.audio = await dataURLToBlob(w.audio);
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

  function showSetup(list) {
    current = list;
    document.title = `Review: ${list.name || 'Untitled list'} · ${PAGE_TITLE}`;
    setBack(true);
    els.setupView.hidden = false;
    els.setupTitle.textContent = list.name || 'Untitled list';
    const words = usableWords(list);
    const withPictures = words.filter((w) => w.image).length;
    els.setupCount.textContent = plural(words.length, 'word');
    els.imageNote.textContent = withPictures === words.length
      ? 'Students say the word.'
      : `Students say the word. Only ${withPictures} of the ${plural(words.length, 'word')} have a picture; the others come up another way.`;
    for (const box of els.typeBoxes) box.checked = settings.types.includes(box.value);
    els.shuffleOpt.checked = settings.shuffle;
    els.sayOpt.checked = settings.say;
    els.setupError.hidden = true;
    els.startBtn.disabled = words.length === 0;
  }

  function readSetup() {
    settings = {
      types: [...els.typeBoxes].filter((b) => b.checked).map((b) => b.value),
      shuffle: els.shuffleOpt.checked,
      say: els.sayOpt.checked,
    };
    saveSettings();
  }

  // ---------- The review itself

  let deck = [];
  let pos = 0;
  let revealed = false;

  function buildDeck() {
    const cards = [];
    let skipped = 0;
    for (const word of usableWords(current)) {
      const ways = settings.types.filter((t) => t !== 'image' || word.image);
      if (!ways.length) { skipped += 1; continue; }
      cards.push({ word, type: ways[Math.floor(Math.random() * ways.length)] });
    }
    if (settings.shuffle) {
      for (let i = cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }
    return { cards, skipped };
  }

  function startReview() {
    readSetup();
    if (!settings.types.length) {
      els.setupError.textContent = 'Tick at least one way to show the words.';
      els.setupError.hidden = false;
      return;
    }
    const { cards, skipped } = buildDeck();
    if (!cards.length) {
      els.setupError.textContent = 'None of these words has a picture yet. Add pictures, or tick another way to show the words.';
      els.setupError.hidden = false;
      return;
    }
    els.setupError.hidden = true;
    if (skipped) showToast(`${plural(skipped, 'word')} without a picture left out.`);
    deck = cards;
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
    word: 'What does this word mean?',
    sound: 'What word do you hear?',
  };

  function renderCard() {
    stopSounds();
    const card = els.stageCard;
    card.innerHTML = '';
    const done = pos >= deck.length;
    els.stageProgress.textContent = done ? `${deck.length} / ${deck.length}` : `${pos + 1} / ${deck.length}`;
    els.stageBarFill.style.width = `${((done ? deck.length : pos + (revealed ? 1 : 0)) / deck.length) * 100}%`;
    els.prevBtn.disabled = pos === 0;

    if (done) {
      card.className = 'stage-card is-done';
      card.append(el('p', 'stage-done-title', 'All done!'));
      card.append(el('p', 'stage-done-text', `You reviewed ${plural(deck.length, 'word')}.`));
      const again = el('button', 'btn btn-primary btn-large', 'Review again');
      again.type = 'button';
      again.addEventListener('click', () => {
        deck = buildDeck().cards;
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
    const { word, type } = deck[pos];
    card.className = `stage-card is-${type}${revealed ? ' is-revealed' : ''}`;
    card.append(el('p', 'stage-question', revealed ? 'Answer' : PROMPTS[type]));

    const body = el('div', 'stage-body');
    if (!revealed) {
      if (type === 'image') body.append(stageImage(word));
      else if (type === 'word') body.append(el('p', 'stage-word', word.word));
      else {
        const listen = el('button', 'stage-listen');
        listen.type = 'button';
        listen.innerHTML = `${ICONS.speaker}<span>Play again</span>`;
        listen.addEventListener('click', () => playWord(word));
        body.append(listen);
        playWord(word);
      }
    } else {
      if (word.image) body.append(stageImage(word));
      const answer = el('div', 'stage-answer');
      answer.append(el('p', 'stage-word', word.word));
      const hear = el('button', 'btn stage-hear');
      hear.type = 'button';
      hear.innerHTML = `${ICONS.speaker}<span>Hear it</span>`;
      hear.addEventListener('click', () => playWord(word));
      answer.append(hear);
      body.append(answer);
      if (settings.say) playWord(word);
    }
    card.append(body);
    els.nextBtn.innerHTML = revealed
      ? (pos === deck.length - 1 ? 'Finish' : 'Next <span aria-hidden="true">→</span>')
      : 'Show answer';
  }

  function stageImage(word) {
    const img = el('img', 'stage-img');
    img.src = srcOf(word.image);
    img.alt = revealed ? word.word : 'Picture of the word';
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
    if (!e.target.classList.contains('vw-word')) return;
    const word = wordOfRow(e.target.closest('.vw-row'));
    word.word = e.target.value;
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
      case 'speak':
        if (word.word.trim()) speak(word.word);
        else showToast('Type the word first.');
        break;
      case 'record': startRecording(word); break;
      case 'stop-recording': stopRecording(); break;
      case 'play-recording': playRecording(word); break;
      case 'delete-recording':
        if (!confirm('Delete your recording of this word? The computer voice will be used instead.')) return;
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
    const word = current.words.find((w) => w.id === activeRowId)
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

  els.typeBoxes.forEach((box) => box.addEventListener('change', () => { els.setupError.hidden = true; }));
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
      if (pos < deck.length) playWord(deck[pos].word);
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
