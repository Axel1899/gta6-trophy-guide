'use strict';
/*
 * Leonida Trophy Hunter — guide + tracker logic.
 * Plain script, no dependencies. Loads the two local data files,
 * renders a checklist and a roadmap, and keeps progress in
 * localStorage. Demo / screenshot state comes from the URL and is
 * held in memory only, so a shared screenshot link can never
 * overwrite a real save.
 */

var STORAGE_KEY = 'leonida-trophy-hunter-v1';
var GRADES = ['platinum', 'gold', 'silver', 'bronze'];
var KIND_LABELS = {
  story: 'Story',
  collectibles: 'Collectibles',
  activities: 'Activities',
  online: 'Online',
  misc: 'Misc'
};

var params = new URLSearchParams(window.location.search);
var demoMode = params.get('demo') === '1';
var forcedSpoilers = params.get('spoilers') === 'on';
var shotView = params.get('shot') || '';

/* ---------------- state ---------------- */

var state = {
  earned: new Set(),
  counts: {},
  hideSpoilers: false
};

function loadSavedState() {
  if (demoMode) return;
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed.earned)) {
      parsed.earned.forEach(function (id) { state.earned.add(String(id)); });
    }
    if (parsed.counts && typeof parsed.counts === 'object') {
      Object.keys(parsed.counts).forEach(function (key) {
        var value = Number(parsed.counts[key]);
        if (Number.isFinite(value) && value > 0) state.counts[key] = Math.floor(value);
      });
    }
    if (typeof parsed.hideSpoilers === 'boolean') state.hideSpoilers = parsed.hideSpoilers;
  } catch (err) {
    /* a corrupt or unavailable store just means a fresh start */
  }
}

function saveState() {
  if (demoMode) return; /* demo progress must never touch a real save */
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      earned: Array.from(state.earned),
      counts: state.counts,
      hideSpoilers: state.hideSpoilers
    }));
  } catch (err) {
    /* storage full / private mode: the session still works in memory */
  }
}

/* Deterministic demo seeding: a small hash per trophy id, with a
   per-grade acceptance rate, lands near 40% earned and leans on the
   plentiful bronze and silver trophies the way a real mid-run save
   would. The platinum is never seeded. */
function seedDemo(trophies) {
  var rates = { platinum: 0, gold: 0.12, silver: 0.3, bronze: 0.48 };
  trophies.forEach(function (trophy) {
    var hash = (Number(trophy.id) * 2654435761) % 1000;
    var rate = rates[trophy.grade] || 0;
    if (hash / 1000 < rate) state.earned.add(String(trophy.id));
  });
}

/* ---------------- data ---------------- */

var gameData = null;
var roadmapData = null;

function fetchJson(path) {
  return fetch(path).then(function (res) {
    if (!res.ok) throw new Error(path + ' returned ' + res.status);
    return res.json();
  });
}

function trophyKind(trophy) {
  return typeof trophy.kind === 'string' && KIND_LABELS[trophy.kind] ? trophy.kind : 'misc';
}

function trophySources(trophy) {
  if (!Array.isArray(trophy.sources)) return [];
  return trophy.sources.map(function (entry) {
    if (typeof entry === 'string') return { name: entry, url: null };
    if (entry && typeof entry.name === 'string') {
      return { name: entry.name, url: typeof entry.url === 'string' ? entry.url : null };
    }
    return null;
  }).filter(Boolean);
}

function sourceUrlFor(name) {
  var urls = gameData && gameData.sourceUrls;
  if (urls && typeof urls === 'object' && typeof urls[name] === 'string') return urls[name];
  return null;
}

function isSpoilerHidden(trophy) {
  return Boolean(state.hideSpoilers && trophy.hidden && !state.earned.has(String(trophy.id)));
}

function findTrophy(id) {
  if (!gameData) return null;
  var wanted = String(id);
  for (var i = 0; i < gameData.trophies.length; i++) {
    if (String(gameData.trophies[i].id) === wanted) return gameData.trophies[i];
  }
  return null;
}

/* ---------------- dom helpers ---------------- */

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function gradeBadge(grade) {
  return el('span', 'badge badge-' + grade, grade);
}

function kindTag(trophy) {
  return el('span', 'tag', KIND_LABELS[trophyKind(trophy)]);
}

/* ---------------- progress header ---------------- */

function renderProgress() {
  if (!gameData) return;
  var trophies = gameData.trophies;
  var total = trophies.length;
  var earnedTotal = 0;
  var perGrade = {};
  GRADES.forEach(function (grade) { perGrade[grade] = { earned: 0, total: 0 }; });
  trophies.forEach(function (trophy) {
    var bucket = perGrade[trophy.grade] || (perGrade[trophy.grade] = { earned: 0, total: 0 });
    bucket.total += 1;
    if (state.earned.has(String(trophy.id))) {
      earnedTotal += 1;
      bucket.earned += 1;
    }
  });
  var pct = total ? Math.round((earnedTotal / total) * 100) : 0;
  document.getElementById('progressCount').textContent = earnedTotal + ' / ' + total + ' trophies';
  document.getElementById('progressPct').textContent =
    earnedTotal >= total && total > 0 ? 'Platinum earned — Leonida legend!' : pct + '% to the platinum';
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressBarWrap').setAttribute('aria-valuenow', String(pct));
  document.getElementById('tallyPlatinum').textContent = perGrade.platinum.earned + '/' + perGrade.platinum.total;
  document.getElementById('tallyGold').textContent = perGrade.gold.earned + '/' + perGrade.gold.total;
  document.getElementById('tallySilver').textContent = perGrade.silver.earned + '/' + perGrade.silver.total;
  document.getElementById('tallyBronze').textContent = perGrade.bronze.earned + '/' + perGrade.bronze.total;
}

/* ---------------- checklist ---------------- */

var activeKindFilter = 'all';
var openDetailId = null;

function matchesFilters(trophy) {
  if (activeKindFilter === 'missable') {
    if (!trophy.missable) return false;
  } else if (activeKindFilter !== 'all') {
    if (trophyKind(trophy) !== activeKindFilter) return false;
  }
  var grade = document.getElementById('gradeFilter').value;
  if (grade !== 'all' && trophy.grade !== grade) return false;
  if (document.getElementById('hideEarnedToggle').checked && state.earned.has(String(trophy.id))) return false;
  var query = document.getElementById('searchInput').value.trim().toLowerCase();
  if (query) {
    var haystack = (trophy.name + ' ' + (trophy.description || '')).toLowerCase();
    if (haystack.indexOf(query) === -1) return false;
  }
  return true;
}

function buildTrophyCard(trophy) {
  var id = String(trophy.id);
  var earned = state.earned.has(id);
  var hidden = isSpoilerHidden(trophy);

  var card = el('article', 'trophy-card' + (earned ? ' is-earned' : '') + (hidden ? ' is-spoilered' : ''));
  card.setAttribute('data-trophy-id', id);

  var checkWrap = el('div', 'trophy-check');
  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = earned;
  checkbox.setAttribute('aria-label', 'Mark ' + (hidden ? 'hidden trophy' : trophy.name) + ' as earned');
  checkbox.addEventListener('change', function () { toggleEarned(id, checkbox.checked); });
  checkbox.addEventListener('click', function (event) { event.stopPropagation(); });
  checkWrap.appendChild(checkbox);
  card.appendChild(checkWrap);

  var main = el('div', 'trophy-main');
  if (hidden) {
    main.appendChild(el('h3', 'trophy-name', 'Hidden trophy'));
    main.appendChild(el('p', 'trophy-desc', 'A hidden trophy. Earn it in game, or turn off “Hide spoilers”, to reveal what it asks for.'));
    var ghost = el('span', 'spoiler-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    main.appendChild(ghost);
  } else {
    main.appendChild(el('h3', 'trophy-name', trophy.name));
    main.appendChild(el('p', 'trophy-desc', trophy.description || ''));
  }

  var meta = el('div', 'trophy-meta');
  meta.appendChild(gradeBadge(trophy.grade));
  meta.appendChild(kindTag(trophy));
  if (trophy.missable) meta.appendChild(el('span', 'tag tag-missable', 'Missable'));
  if (typeof trophy.count === 'number' && trophy.count > 0) {
    var done = state.counts[id] || 0;
    meta.appendChild(el('span', 'tag tag-count', done + ' / ' + trophy.count + ' tracked'));
  }
  main.appendChild(meta);
  card.appendChild(main);

  card.appendChild(el('span', 'trophy-open', '›'));
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'Open detail for ' + (hidden ? 'hidden trophy' : trophy.name));
  card.addEventListener('click', function () { openDetail(id); });
  card.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetail(id);
    }
  });
  return card;
}

function renderChecklist() {
  if (!gameData) return;
  var list = document.getElementById('trophyList');
  list.textContent = '';
  var visible = 0;
  gameData.trophies.forEach(function (trophy) {
    if (!matchesFilters(trophy)) return;
    visible += 1;
    list.appendChild(buildTrophyCard(trophy));
  });
  document.getElementById('emptyState').hidden = visible !== 0;
  document.getElementById('resultLine').textContent =
    'Showing ' + visible + ' of ' + gameData.trophies.length + ' trophies';
}

/* ---------------- roadmap ---------------- */

function renderRoadmap() {
  var wrap = document.getElementById('roadmapStages');
  wrap.textContent = '';
  var stages = roadmapData && Array.isArray(roadmapData.stages) ? roadmapData.stages : [];
  document.getElementById('roadmapEmpty').hidden = stages.length !== 0;

  stages.forEach(function (stage, index) {
    var ids = Array.isArray(stage.trophyIds) ? stage.trophyIds : [];
    var trophies = ids.map(findTrophy).filter(Boolean);
    var earnedHere = trophies.filter(function (t) { return state.earned.has(String(t.id)); }).length;

    var section = el('section', 'stage');
    var head = el('div', 'stage-head');
    head.appendChild(el('h3', '', 'Stage ' + (index + 1) + ' — ' + (stage.title || 'Untitled stage')));
    head.appendChild(el('span', 'stage-progress', earnedHere + ' / ' + trophies.length + ' earned'));
    section.appendChild(head);
    if (stage.note) section.appendChild(el('p', 'stage-note', stage.note));

    var rows = el('div', 'stage-list');
    trophies.forEach(function (trophy) {
      var id = String(trophy.id);
      var earned = state.earned.has(id);
      var hidden = isSpoilerHidden(trophy);
      var row = el('label', 'stage-row' + (earned ? ' is-earned' : ''));
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = earned;
      checkbox.addEventListener('change', function () { toggleEarned(id, checkbox.checked); });
      row.appendChild(checkbox);
      row.appendChild(el('span', 'stage-name', hidden ? 'Hidden trophy' : trophy.name));
      if (trophy.missable) row.appendChild(el('span', 'tag tag-missable', 'Missable'));
      row.appendChild(gradeBadge(trophy.grade));
      var detailBtn = el('button', 'stage-detail-btn', 'Guide');
      detailBtn.type = 'button';
      detailBtn.setAttribute('aria-label', 'Open guide for ' + (hidden ? 'hidden trophy' : trophy.name));
      detailBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openDetail(id);
      });
      row.appendChild(detailBtn);
      rows.appendChild(row);
    });
    section.appendChild(rows);
    wrap.appendChild(section);
  });
}

/* ---------------- detail panel ---------------- */

function openDetail(id) {
  var trophy = findTrophy(id);
  if (!trophy) return;
  openDetailId = String(id);
  renderDetail(trophy);
  var panel = document.getElementById('detailPanel');
  panel.hidden = false;
  panel.scrollTop = 0;
  document.getElementById('detailClose').focus({ preventScroll: true });
}

function closeDetail() {
  openDetailId = null;
  document.getElementById('detailPanel').hidden = true;
}

function renderDetail(trophy) {
  var body = document.getElementById('detailBody');
  body.textContent = '';
  var id = String(trophy.id);
  var earned = state.earned.has(id);
  var hidden = isSpoilerHidden(trophy);

  body.appendChild(el('p', 'brand-kicker', 'Trophy detail'));
  if (hidden) {
    body.appendChild(el('h2', '', 'Hidden trophy'));
    body.appendChild(el('p', 'detail-spoiler-note',
      'This trophy is hidden and “Hide spoilers” is on. Its name, description and guide stay covered until you earn it or turn the setting off.'));
  } else {
    body.appendChild(el('h2', '', trophy.name));
    body.appendChild(el('p', 'detail-desc', trophy.description || ''));
  }

  var facts = el('div', 'detail-facts');
  facts.appendChild(gradeBadge(trophy.grade));
  facts.appendChild(kindTag(trophy));
  if (trophy.missable) facts.appendChild(el('span', 'tag tag-missable', 'Missable'));
  if (trophy.hidden) facts.appendChild(el('span', 'tag', 'Hidden trophy'));
  body.appendChild(facts);

  body.appendChild(el('h3', '', 'Missable status'));
  body.appendChild(el('p', '', trophy.missable
    ? 'Missable. You can pass the point where this is earnable in a single playthrough — check the guide before pushing the story further, or keep a save from before it.'
    : 'Not missable. You can come back for this after the story, so there is no need to rush it.'));

  if (!hidden) {
    body.appendChild(el('h3', '', 'How to earn it'));
    body.appendChild(el('p', 'detail-guide', trophy.guide || 'No written guide for this one yet — the description above is the whole requirement.'));
  }

  if (typeof trophy.count === 'number' && trophy.count > 0) {
    body.appendChild(el('h3', '', 'Progress counter'));
    var current = state.counts[id] || 0;
    var counter = el('div', 'counter-box');
    var minus = el('button', '', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', 'Decrease tracked count');
    minus.addEventListener('click', function () { setCount(id, current - 1); });
    var value = el('span', 'counter-value');
    var bold = el('b', '', String(Math.min(current, trophy.count)));
    value.appendChild(bold);
    value.appendChild(document.createTextNode(' / ' + trophy.count));
    var plus = el('button', '', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Increase tracked count');
    plus.addEventListener('click', function () { setCount(id, current + 1); });
    counter.appendChild(minus);
    counter.appendChild(value);
    counter.appendChild(plus);
    body.appendChild(counter);
    body.appendChild(el('p', 'detail-spoiler-note', 'Count what you have done in game; the counter is stored with your checklist on this device.'));
  }

  var sources = trophySources(trophy);
  if (sources.length) {
    body.appendChild(el('h3', '', 'Sources'));
    var listEl = el('ul', 'source-list');
    sources.forEach(function (source) {
      var item = el('li');
      var url = source.url || sourceUrlFor(source.name);
      if (url) {
        var link = el('a', '', source.name);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.appendChild(link);
      } else {
        item.textContent = source.name;
      }
      listEl.appendChild(item);
    });
    body.appendChild(listEl);
  }

  var earnLabel = el('label', 'detail-earn');
  var earnBox = document.createElement('input');
  earnBox.type = 'checkbox';
  earnBox.checked = earned;
  earnBox.addEventListener('change', function () { toggleEarned(id, earnBox.checked); });
  earnLabel.appendChild(earnBox);
  earnLabel.appendChild(el('span', '', earned ? 'Earned — nice work' : 'Mark as earned'));
  body.appendChild(earnLabel);
}

/* ---------------- mutations ---------------- */

function refreshAll() {
  renderProgress();
  renderChecklist();
  renderRoadmap();
  if (openDetailId) {
    var trophy = findTrophy(openDetailId);
    if (trophy) renderDetail(trophy);
  }
}

function toggleEarned(id, earned) {
  var key = String(id);
  if (earned) state.earned.add(key); else state.earned.delete(key);
  saveState();
  refreshAll();
}

function setCount(id, value) {
  var trophy = findTrophy(id);
  var max = trophy && typeof trophy.count === 'number' ? trophy.count : value;
  var clamped = Math.max(0, Math.min(value, Math.max(max, 0)));
  if (clamped > 0) state.counts[String(id)] = clamped;
  else delete state.counts[String(id)];
  if (trophy && clamped >= max && max > 0) state.earned.add(String(id));
  saveState();
  refreshAll();
}

/* ---------------- views ---------------- */

function setView(view) {
  var roadmap = view === 'roadmap';
  document.getElementById('checklistView').hidden = roadmap;
  document.getElementById('roadmapView').hidden = !roadmap;
  document.getElementById('viewChecklistBtn').classList.toggle('is-active', !roadmap);
  document.getElementById('viewRoadmapBtn').classList.toggle('is-active', roadmap);
  document.getElementById('viewChecklistBtn').setAttribute('aria-selected', String(!roadmap));
  document.getElementById('viewRoadmapBtn').setAttribute('aria-selected', String(roadmap));
}

/* ---------------- export / import ---------------- */

function showNotice(message, isError) {
  var notice = document.getElementById('notice');
  notice.textContent = message;
  notice.classList.toggle('is-error', Boolean(isError));
}

function exportProgress() {
  var payload = {
    app: 'leonida-trophy-hunter',
    version: 1,
    exportedAt: new Date().toISOString(),
    game: gameData ? gameData.game : null,
    platform: gameData ? gameData.platform : null,
    earned: Array.from(state.earned),
    counts: state.counts,
    settings: { hideSpoilers: state.hideSpoilers }
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'leonida-trophy-progress.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  showNotice('Progress exported — keep the file somewhere safe.');
}

function importProgress(file) {
  var reader = new FileReader();
  reader.addEventListener('load', function () {
    try {
      var parsed = JSON.parse(String(reader.result));
      var earnedList = Array.isArray(parsed.earned) ? parsed.earned
        : (parsed.state && Array.isArray(parsed.state.earned) ? parsed.state.earned : null);
      if (!earnedList) throw new Error('no earned list in file');
      var validIds = new Set(gameData.trophies.map(function (t) { return String(t.id); }));
      state.earned = new Set(earnedList.map(String).filter(function (id) { return validIds.has(id); }));
      var counts = parsed.counts || (parsed.state && parsed.state.counts) || {};
      state.counts = {};
      Object.keys(counts).forEach(function (key) {
        var value = Number(counts[key]);
        if (validIds.has(key) && Number.isFinite(value) && value > 0) state.counts[key] = Math.floor(value);
      });
      var settings = parsed.settings || {};
      if (typeof settings.hideSpoilers === 'boolean') state.hideSpoilers = settings.hideSpoilers;
      document.getElementById('spoilerToggle').checked = state.hideSpoilers;
      saveState();
      refreshAll();
      showNotice('Progress imported: ' + state.earned.size + ' trophies marked as earned.');
    } catch (err) {
      showNotice('That file could not be imported. Pick a progress file exported from this guide.', true);
    }
  });
  reader.addEventListener('error', function () {
    showNotice('That file could not be read.', true);
  });
  reader.readAsText(file);
}

/* ---------------- wiring ---------------- */

function wireControls() {
  document.getElementById('viewChecklistBtn').addEventListener('click', function () { setView('checklist'); });
  document.getElementById('viewRoadmapBtn').addEventListener('click', function () { setView('roadmap'); });
  document.getElementById('searchInput').addEventListener('input', renderChecklist);
  document.getElementById('gradeFilter').addEventListener('change', renderChecklist);
  document.getElementById('hideEarnedToggle').addEventListener('change', renderChecklist);

  var chips = document.querySelectorAll('#kindChips .chip');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (other) { other.classList.remove('is-active'); });
      chip.classList.add('is-active');
      activeKindFilter = chip.getAttribute('data-filter') || 'all';
      renderChecklist();
    });
  });

  var spoilerToggle = document.getElementById('spoilerToggle');
  spoilerToggle.checked = state.hideSpoilers;
  spoilerToggle.addEventListener('change', function () {
    state.hideSpoilers = spoilerToggle.checked;
    saveState();
    refreshAll();
  });

  document.getElementById('exportBtn').addEventListener('click', exportProgress);
  document.getElementById('importFile').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (file) importProgress(file);
    event.target.value = '';
  });
  document.getElementById('resetBtn').addEventListener('click', function () {
    if (!window.confirm('Clear every tick and counter on this device? This cannot be undone.')) return;
    state.earned = new Set();
    state.counts = {};
    saveState();
    refreshAll();
    showNotice('Progress cleared. A fresh run through Leonida awaits.');
  });

  document.getElementById('detailClose').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeDetail();
  });
}

/* ---------------- header / footer from data ---------------- */

function renderChrome() {
  if (!gameData) return;
  var line = document.getElementById('listLine');
  line.textContent = (gameData.list || 'Trophy guide & tracker') +
    (gameData.platform ? ' · ' + gameData.platform : '');
  var names = [];
  var seen = new Set();
  gameData.trophies.forEach(function (trophy) {
    trophySources(trophy).forEach(function (source) {
      if (!seen.has(source.name)) { seen.add(source.name); names.push(source); }
    });
  });
  var foot = document.getElementById('footSources');
  if (names.length) {
    foot.appendChild(document.createTextNode('Trophy list and facts checked against: '));
    names.forEach(function (source, index) {
      if (index) foot.appendChild(document.createTextNode(', '));
      var url = source.url || sourceUrlFor(source.name);
      if (url) {
        var link = el('a', '', source.name);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        foot.appendChild(link);
      } else {
        foot.appendChild(document.createTextNode(source.name));
      }
    });
    foot.appendChild(document.createTextNode('.'));
  }
}

/* ---------------- boot ---------------- */

function applyShotParams() {
  if (shotView === 'roadmap') setView('roadmap');
  else setView('checklist');
  if (shotView === 'trophy') {
    var id = params.get('id');
    if (id && findTrophy(id)) openDetail(id);
  }
}

function boot() {
  loadSavedState();
  if (forcedSpoilers) state.hideSpoilers = true;
  wireControls();

  fetchJson('data/trophies.json').then(function (data) {
    gameData = data;
    if (demoMode) seedDemo(gameData.trophies);
    document.getElementById('spoilerToggle').checked = state.hideSpoilers;
    return fetchJson('data/roadmap.json').then(function (roadmap) {
      roadmapData = roadmap;
    }).catch(function () {
      roadmapData = null; /* roadmap file may land after the app; checklist still works */
    });
  }).then(function () {
    renderChrome();
    refreshAll();
    applyShotParams();
    window.__shotReady = true;
  }).catch(function () {
    document.getElementById('resultLine').textContent =
      'The trophy data could not be loaded. Serve this folder over a local server and reload.';
    window.__shotReady = true;
  });
}

boot();
