/* ==========================================================================
   Upload API - Playground (gambar + video + audio)
   Vanilla JS, no framework, no build step.
   API: POST /upload, GET|DELETE /upload/:category/:filename, GET /health
   ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------------------------------------- konfigurasi */

  // API base: default ke origin yang sama. Bisa dioverride saat dev:
  //   http://localhost:3000/app?api=http://localhost:3000
  var params = new URLSearchParams(window.location.search);
  var API = (params.get('api') || window.location.origin).replace(/\/+$/, '');

  /**
   * Tipe yang diizinkan per kategori.
   * group = kategori, dipakai untuk folder server, validasi, dan tampilan.
   */
  var TYPES = {
    // image
    'image/jpeg': { group: 'image', label: 'JPG', icon: '\u{1F5BC}' },
    'image/png': { group: 'image', label: 'PNG', icon: '\u{1F5BC}' },
    'image/webp': { group: 'image', label: 'WEBP', icon: '\u{1F5BC}' },
    'image/gif': { group: 'image', label: 'GIF', icon: '\u{1F5BC}' },
    // video
    'video/mp4': { group: 'video', label: 'MP4', icon: '\u{1F3AC}' },
    'video/webm': { group: 'video', label: 'WEBM', icon: '\u{1F3AC}' },
    'video/quicktime': { group: 'video', label: 'MOV', icon: '\u{1F3AC}' },
    'video/x-msvideo': { group: 'video', label: 'AVI', icon: '\u{1F3AC}' },
    'video/x-matroska': { group: 'video', label: 'MKV', icon: '\u{1F3AC}' },
    'video/ogg': { group: 'video', label: 'OGV', icon: '\u{1F3AC}' },
    'video/3gpp': { group: 'video', label: '3GP', icon: '\u{1F3AC}' },
    // audio
    'audio/mpeg': { group: 'audio', label: 'MP3', icon: '\u{1F3B5}' },
    'audio/wav': { group: 'audio', label: 'WAV', icon: '\u{1F3B5}' },
    'audio/ogg': { group: 'audio', label: 'OGG', icon: '\u{1F3B5}' },
    'audio/mp4': { group: 'audio', label: 'M4A', icon: '\u{1F3B5}' },
    'audio/aac': { group: 'audio', label: 'AAC', icon: '\u{1F3B5}' },
    'audio/flac': { group: 'audio', label: 'FLAC', icon: '\u{1F3B5}' },
  };

  /** MIME fallback ketika browser/OS mengirim tipe generik atau kosong. */
  var EXTENSION_TYPES = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska', ogv: 'video/ogg', '3gp': 'video/3gpp', '3g2': 'video/3gpp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
    m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  };

  /** Batas ukuran per kategori (di-overwrite dari GET /). */
  var LIMITS = { image: 20 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 50 * 1024 * 1024 };

  var GROUP_LABEL = { image: 'Gambar', video: 'Video', audio: 'Audio' };
  var items = []; // antrean upload
  var filter = 'all'; // filter galeri aktif

  /* ------------------------------------------------------------------ DOM */

  var $ = function (sel) { return document.querySelector(sel); };
  var dropzone = $('#dropzone');
  var fileInput = $('#fileInput');
  var queueEl = $('#queue');
  var queueStats = $('#queueStats');
  var galleryEl = $('#gallery');
  var galleryStats = $('#galleryStats');
  var categoryInfo = $('#categoryInfo');
  var refreshStatsBtn = $('#refreshStatsBtn');
  var storageTotal = $('#storageTotal');
  var storageFiles = $('#storageFiles');
  var storageBar = $('#storageBar');
  var storageLegend = $('#storageLegend');
  var storageDisk = $('#storageDisk');
  var rawJsonEl = $('#rawJson');
  var toastsEl = $('#toasts');
  var healthBadge = $('#healthBadge');
  var healthText = $('#healthText');
  var maxSizeLabel = $('#maxSizeLabel');
  var maxMediaLabel = $('#maxMediaLabel');
  var compressLabel = $('#compressLabel');
  var baseUrlLabel = $('#baseUrlLabel');
  var apiInfoBtn = $('#apiInfoBtn');
  var clearAllBtn = $('#clearAllBtn');
  var copyRawBtn = $('#copyRawBtn');
  var filtersEl = $('#filters');
  var lightbox = $('#lightbox');
  var lightboxImg = $('#lightboxImg');
  var lightboxCaption = $('#lightboxCaption');
  var lightboxClose = $('#lightboxClose');

  baseUrlLabel.textContent = 'API: ' + API;

  /* -------------------------------------------------------------- helper */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    var kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    var mb = kb / 1024;
    if (mb < 1024) return mb.toFixed(mb < 10 ? 2 : 1) + ' MB';
    return (mb / 1024).toFixed(2) + ' GB';
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });
    } catch (e) {
      return iso;
    }
  }

  function toast(kind, title, message) {
    var node = el('div', 'toast is-' + kind);
    var box = el('div');
    box.appendChild(el('strong', null, title));
    if (message) box.appendChild(el('span', null, message));
    node.appendChild(box);
    toastsEl.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transform = 'translateY(8px)';
      node.style.transition = 'all .25s ease';
      setTimeout(function () { node.remove(); }, 260);
    }, kind === 'err' ? 6500 : 4000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      var ta = el('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  /** Tebak kategori file dari MIME, fallback ke ekstensi. */
  function detectGroup(file) {
    var mime = String(file.type || '').toLowerCase().split(';')[0].trim();
    if (TYPES[mime]) return TYPES[mime].group;

    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var guess = EXTENSION_TYPES[ext];
    return guess ? TYPES[guess].group : null;
  }

  /** Label format untuk badge (pakai tipe server kalau ada). */
  function formatLabel(data, file) {
    if (data && data.file_type && TYPES[data.file_type]) return TYPES[data.file_type].label;
    var ext = data && data.extension ? data.extension.slice(1).toUpperCase() : '';
    if (ext) return ext;
    return (file ? file.name.split('.').pop() || 'FILE' : 'FILE').toUpperCase();
  }

  /* ------------------------------------------------------ health & limits */

  async function checkHealth() {
    try {
      var res = await fetch(API + '/health', { cache: 'no-store' });
      var body = await res.json();
      healthBadge.className = 'badge badge-ok';
      healthText.textContent = body.status + ' \u00b7 ' + formatTime(body.timestamp);
    } catch (e) {
      healthBadge.className = 'badge badge-err';
      healthText.textContent = 'tidak terhubung';
    }
  }

  async function loadApiInfo() {
    try {
      var res = await fetch(API + '/', { cache: 'no-store' });
      var body = await res.json();
      var data = body.data || {};

      if (data.max_file_size_mb) {
        LIMITS.image = data.max_file_size_mb * 1024 * 1024;
        maxSizeLabel.textContent = data.max_file_size_mb + ' MB';
      }
      if (data.max_media_file_size_mb) {
        LIMITS.video = data.max_media_file_size_mb * 1024 * 1024;
        LIMITS.audio = data.max_media_file_size_mb * 1024 * 1024;
        maxMediaLabel.textContent = data.max_media_file_size_mb + ' MB';
      }
      if (data.compression) {
        compressLabel.textContent = data.compression.trigger_above_mb + ' MB';
      }

      // Ringkasan kategori: folder tujuan + limit + status kompresi.
      if (Array.isArray(data.categories)) {
        categoryInfo.textContent = '';
        data.categories.forEach(function (category) {
          var row = el('div', 'ci-row');
          row.appendChild(el('span', 'ci-tag ci-' + category.name, GROUP_LABEL[category.name] || category.name));
          row.appendChild(el('span', 'ci-folder', category.folder + '/'));
          row.appendChild(el('span', 'ci-limit', 'max ' + category.max_size_mb + ' MB'));
          row.appendChild(el('span', 'ci-compress' + (category.compression === 'disabled' ? ' is-off' : ''),
            category.compression === 'disabled' ? 'tanpa kompresi' : category.compression));
          categoryInfo.appendChild(row);
        });
      }

      apiInfoBtn.href = API + '/';
    } catch (e) {
      /* biarkan nilai default */
    }
  }

  /* ------------------------------------------------ statistik penyimpanan */

  var STORAGE_COLOR = { image: '#6366f1', video: '#ec4899', audio: '#10b981', other: '#94a3b8' };

  async function loadStorageStats() {
    try {
      var res = await fetch(API + '/upload/stats', { cache: 'no-store' });
      var body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || 'HTTP ' + res.status);

      var data = body.data;
      storageTotal.textContent = data.total_size;
      storageFiles.textContent = data.total_files + ' file';

      // Bar proporsi per kategori.
      storageBar.textContent = '';
      var maxBytes = data.total_size_bytes || 1;
      data.categories.forEach(function (category) {
        if (!category.size_bytes) return;
        var part = el('span', 'sb-part sb-' + category.name);
        part.style.width = (category.size_bytes / maxBytes) * 100 + '%';
        part.title = GROUP_LABEL[category.name] + ': ' + category.size;
        storageBar.appendChild(part);
      });

      // Legenda: jumlah file + ukuran per kategori.
      storageLegend.textContent = '';
      data.categories.forEach(function (category) {
        var li = el('li');
        li.appendChild(el('span', 'lg-dot', ''));
        li.style.setProperty('--dot', STORAGE_COLOR[category.name]);
        li.appendChild(el('span', 'lg-name', GROUP_LABEL[category.name] || category.name));
        li.appendChild(el('span', 'lg-count', category.files + ' file'));
        li.appendChild(el('span', 'lg-size', category.size));
        storageLegend.appendChild(li);
      });

      storageDisk.textContent = data.disk
        ? 'Disk: ' + data.disk.free + ' bebas dari ' + data.disk.total + ' (' + data.disk.used_percent + '% terpakai)'
        : '';
    } catch (e) {
      storageTotal.textContent = 'Gagal memuat';
      storageFiles.textContent = e.message || '';
      storageDisk.textContent = '';
    }
  }

  refreshStatsBtn.addEventListener('click', function () {
    refreshStatsBtn.disabled = true;
    loadStorageStats().then(function () { refreshStatsBtn.disabled = false; });
  });

  /* ------------------------------------------------------- intake file(s) */

  function addFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList || []);
    if (!incoming.length) return;

    var accepted = 0;
    incoming.forEach(function (file) {
      var group = detectGroup(file);

      if (!group) {
        toast('err', 'Format ditolak', file.name + ' \u2014 hanya JPG, PNG, WEBP, GIF, MP4, WEBM, MOV, AVI, MKV, MP3, WAV, OGG, M4A, FLAC');
        return;
      }

      var limit = LIMITS[group] || LIMITS.image;
      if (file.size > limit) {
        toast('err', 'Terlalu besar', file.name + ' \u00b7 ' + GROUP_LABEL[group] + ' maks ' + formatBytes(limit));
        return;
      }

      accepted += 1;
      var item = {
        id: Math.random().toString(36).slice(2),
        file: file,
        group: group,
        name: file.name,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
        status: 'queued',
        progress: 0,
        data: null,
        error: null,
      };
      items.push(item);
    });

    if (accepted) {
      renderQueue();
      processQueue();
    }
  }

  /* ------------------------------------------------------------- uploading */

  var processing = false;

  async function processQueue() {
    if (processing) return;
    processing = true;

    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (item.status !== 'queued') continue;
      // eslint-disable-next-line no-await-in-loop
      await uploadItem(item);
    }

    processing = false;
    renderQueue();
  }

  function uploadItem(item) {
    return new Promise(function (resolve) {
      item.status = 'uploading';
      item.progress = 0;
      renderQueue();

      var xhr = new XMLHttpRequest();
      xhr.open('POST', API + '/upload', true);

      xhr.upload.addEventListener('progress', function (e) {
        if (!e.lengthComputable) return;
        item.progress = Math.min(99, Math.round((e.loaded / e.total) * 100));
        renderQueue();
      });

      xhr.addEventListener('load', function () {
        var body = null;
        try { body = JSON.parse(xhr.responseText); } catch (e) { body = null; }

        if (xhr.status >= 200 && xhr.status < 300 && body && body.success) {
          item.status = 'done';
          item.progress = 100;
          item.data = body.data;
          rawJsonEl.textContent = JSON.stringify(body, null, 2);
          toast('ok', 'Upload berhasil',
            item.data.filename + (item.data.compressed
              ? ' \u00b7 ' + item.data.original_size_mb + ' MB \u2192 ' + item.data.final_size_mb + ' MB'
              : ' \u00b7 ' + item.data.final_size_mb + ' MB'));
          addToGallery(item);
      loadStorageStats();
        } else {
          item.status = 'error';
          item.error = (body && body.message) || 'HTTP ' + xhr.status;
          rawJsonEl.textContent = JSON.stringify(body || { status: xhr.status }, null, 2);
          toast('err', 'Upload gagal', item.error);
        }
        renderQueue();
        resolve();
      });

      xhr.addEventListener('error', function () {
        item.status = 'error';
        item.error = 'Koneksi ke server gagal';
        renderQueue();
        toast('err', 'Upload gagal', item.error);
        resolve();
      });

      xhr.addEventListener('abort', function () {
        item.status = 'queued';
        renderQueue();
        resolve();
      });

      var form = new FormData();
      form.append('file', item.file, item.file.name);
      xhr.send(form);
    });
  }

  /* --------------------------------------------------------------- render */

  /** Thumbnail kecil sesuai jenis file. */
  function buildThumb(item) {
    if (item.group === 'image') {
      var img = el('img');
      img.src = item.previewUrl;
      img.alt = item.name;
      return img;
    }
    if (item.group === 'video') {
      var video = document.createElement('video');
      video.src = item.previewUrl;
      video.muted = true;
      video.preload = 'metadata';
      return video;
    }
    var box = el('div', 'qi-thumb', '\u{1F3B5}');
    return box;
  }

  /** Hanya 12 item terakhir yang dirender agar DOM tidak tumbuh terus. */
  var QUEUE_RENDER_LIMIT = 12;

  function renderQueue() {
    queueEl.textContent = '';
    var pending = 0;
    var ok = 0;
    var failed = 0;

    items.forEach(function (item) {
      if (item.status === 'queued' || item.status === 'uploading') pending += 1;
      if (item.status === 'done') ok += 1;
      if (item.status === 'error') failed += 1;
    });

    items.slice(-QUEUE_RENDER_LIMIT).forEach(function (item) {
      var row = el('div', 'queue-item');
      row.appendChild(buildThumb(item));

      var main = el('div', 'qi-main');
      var name = el('div', 'qi-name');
      name.appendChild(el('span', 'qi-dot qi-' + item.group, ''));
      name.appendChild(document.createTextNode(item.name));
      main.appendChild(name);

      var meta = item.size.toLocaleString('id-ID') + ' B \u00b7 ' + formatBytes(item.size) +
        ' \u00b7 ' + GROUP_LABEL[item.group];
      if (item.data) meta += ' \u2192 ' + item.data.filename;
      main.appendChild(el('div', 'qi-meta', meta));

      var bar = el('div', 'bar');
      var fill = el('span');
      bar.appendChild(fill);
      if (item.status === 'done') bar.classList.add('is-ok');
      if (item.status === 'error') bar.classList.add('is-err');
      fill.style.width = (item.status === 'done' ? 100 : item.progress) + '%';
      main.appendChild(bar);

      if (item.error) main.appendChild(el('div', 'qi-meta', item.error));
      row.appendChild(main);

      var right = el('div');
      if (item.status === 'uploading') right.appendChild(el('span', 'qi-status s-uploading', item.progress + '%'));
      else if (item.status === 'queued') right.appendChild(el('span', 'qi-status s-warn', 'antre'));
      else if (item.status === 'done') right.appendChild(el('span', 'qi-status s-ok', 'selesai'));
      else right.appendChild(el('span', 'qi-status s-err', 'gagal'));
      row.appendChild(right);

      queueEl.appendChild(row);
    });

    if (!items.length) {
      queueEl.appendChild(el('p', 'empty', 'Belum ada upload. Pilih beberapa file sekaligus.'));
      queueStats.textContent = '\u2014';
    } else {
      queueStats.textContent = ok + ' berhasil \u00b7 ' + pending + ' diproses \u00b7 ' + failed + ' gagal';
    }
  }

  /* -------------------------------------------------------------- gallery */

  function matchesFilter(data) {
    return filter === 'all' || data.category === filter;
  }

  /** Kartu galeri: gambar (preview + lightbox), video (player), audio (player). */
  function buildMedia(data, file) {
    var category = data.category || detectGroup(file) || 'image';

    if (category === 'video') {
      var video = document.createElement('video');
      video.src = data.url;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      return video;
    }

    if (category === 'audio') {
      var audio = document.createElement('audio');
      audio.src = data.url;
      audio.controls = true;
      audio.preload = 'metadata';
      return audio;
    }

    var img = el('img');
    img.src = data.url;
    img.alt = data.original_filename || data.filename;
    img.loading = 'lazy';
    return img;
  }

  function addToGallery(item) {
    var data = item.data;
    var file = item.file;
    if (galleryEl.querySelector('.empty')) galleryEl.textContent = '';

    var category = data.category || detectGroup(file) || 'image';
    var saved = data.final_size;
    var original = data.original_size;
    var savedPct = original ? Math.max(0, Math.round((1 - saved / original) * 100)) : 0;

    var card = el('article', 'card is-' + category);
    card.dataset.filename = data.filename;
    card.dataset.category = category;
    card.dataset.url = data.url;

    var figure = el('div', 'card-figure');
    figure.appendChild(buildMedia(data, file));

    if (data.compressed) {
      figure.appendChild(el('span', 'tag-compressed', 'COMPRESSED \u2212' + savedPct + '%'));
    } else {
      figure.appendChild(el('span', 'tag-plain', formatLabel(data, file)));
    }
    figure.appendChild(el('span', 'tag-category tag-' + category, GROUP_LABEL[category] || category));

    if (category === 'image') {
      figure.classList.add('is-zoomable');
      figure.addEventListener('click', function () {
        lightboxImg.src = data.url;
        lightboxCaption.textContent = data.filename + ' \u00b7 ' + data.original_filename;
        lightbox.hidden = false;
      });
    }
    card.appendChild(figure);

    var body = el('div', 'card-body');
    body.appendChild(el('div', 'card-filename', data.filename));
    body.appendChild(el('div', 'card-original', data.original_filename));

    var kv = el('dl', 'kv');
    [
      ['ukuran', formatBytes(original)],
      data.compressed ? ['hasil', formatBytes(saved)] : null,
      ['waktu', formatTime(data.upload_time)],
    ].forEach(function (pair) {
      if (!pair) return;
      kv.appendChild(el('dt', null, pair[0]));
      kv.appendChild(el('dd', null, pair[1]));
    });
    body.appendChild(kv);

    if (data.compressed) {
      body.appendChild(el('div', 'savings', '\u2193 ' + savedPct + '% hemat ruang'));
    }

    var actions = el('div', 'card-actions');

    if (category === 'audio') {
      var play = el('a', 'btn btn-sm', 'Unduh');
      play.href = data.url;
      play.target = '_blank';
      play.rel = 'noopener';
      actions.appendChild(play);
    } else {
      var openBtn = el('a', 'btn btn-sm', 'Buka');
      openBtn.href = data.url;
      openBtn.target = '_blank';
      openBtn.rel = 'noopener';
      actions.appendChild(openBtn);
    }

    var copyBtn = el('button', 'btn btn-sm', 'Salin URL');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async function () {
      var okCopy = await copyText(data.url);
      toast(okCopy ? 'ok' : 'err', okCopy ? 'URL disalin' : 'Gagal menyalin', data.url);
    });
    actions.appendChild(copyBtn);

    var delBtn = el('button', 'btn btn-sm btn-danger', 'Hapus');
    delBtn.type = 'button';
    delBtn.addEventListener('click', function () { deleteItem(data, card, delBtn); });
    actions.appendChild(delBtn);

    body.appendChild(actions);
    card.appendChild(body);

    // Disimpan di item supaya filter galeri bisa menyembunyikan/menampilkan lagi.
    item.card = card;
    if (matchesFilter(data)) galleryEl.appendChild(card);
    updateGalleryStats();
  }

  function updateGalleryStats() {
    var cards = galleryEl.querySelectorAll('.card');
    if (!cards.length) {
      if (!galleryEl.querySelector('.empty')) {
        galleryEl.appendChild(el('p', 'empty', filter === 'all'
          ? 'File yang berhasil diunggah akan tampil di sini.'
          : 'Tidak ada file ' + GROUP_LABEL[filter].toLowerCase() + ' pada filter ini.'));
      }
      galleryStats.textContent = '0 file';
      return;
    }
    galleryStats.textContent = cards.length + ' file' + (filter === 'all' ? '' : ' \u00b7 ' + GROUP_LABEL[filter]);
  }

  function refreshEmptyState() {
    var empty = galleryEl.querySelector('.empty');
    if (empty) empty.remove();
    updateGalleryStats();
  }

  async function deleteItem(data, card, button) {
    button.disabled = true;
    button.textContent = 'Menghapus...';
    try {
      var url = API + '/upload/' + encodeURIComponent(data.category || card.dataset.category) + '/' +
        encodeURIComponent(data.filename);
      var res = await fetch(url, { method: 'DELETE' });
      var body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message || 'HTTP ' + res.status);

      card.remove();
      refreshEmptyState();
      loadStorageStats();
      toast('ok', 'File dihapus', data.filename);
    } catch (err) {
      button.disabled = false;
      button.textContent = 'Hapus';
      toast('err', 'Gagal menghapus', err.message);
    }
  }

  async function clearAll() {
    var cards = Array.prototype.slice.call(galleryEl.querySelectorAll('.card'));
    if (!cards.length) return;
    clearAllBtn.disabled = true;

    for (var i = 0; i < cards.length; i += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fetch(API + '/upload/' + encodeURIComponent(cards[i].dataset.category) + '/' +
          encodeURIComponent(cards[i].dataset.filename), { method: 'DELETE' });
      } catch (e) { /* abaikan, tetap hapus dari UI */ }
    }

    items = items.filter(function (i) { return i.status === 'error'; });
    galleryEl.textContent = '';
    refreshEmptyState();
    renderQueue();
    clearAllBtn.disabled = false;
    toast('info', 'Galeri dikosongkan', cards.length + ' file dihapus dari server');
  }

  /* ------------------------------------------------------------- filter UI */

  filtersEl.addEventListener('click', function (e) {
    var button = e.target.closest('.chip-filter');
    if (!button) return;
    filter = button.dataset.filter;

    filtersEl.querySelectorAll('.chip-filter').forEach(function (b) {
      b.classList.toggle('is-active', b === button);
    });

    // Tampilkan/sembunyikan kartu sesuai kategori.
    var empty = galleryEl.querySelector('.empty');
    if (empty) empty.remove();

    items.forEach(function (item) {
      if (!item.data || !item.card) return;
      var show = filter === 'all' || item.data.category === filter;
      if (show && !item.card.parentNode) galleryEl.appendChild(item.card);
      else if (!show && item.card.parentNode) item.card.remove();
    });

    updateGalleryStats();
  });

  /* ----------------------------------------------------------- interaksi */

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', function () {
    addFiles(fileInput.files);
    fileInput.value = ''; // izinkan memilih file yang sama lagi
  });

  var dragDepth = 0;
  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (evt === 'dragenter') dragDepth += 1;
      dropzone.classList.add('is-drag');
    });
  });
  dropzone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-drag');
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    dropzone.classList.remove('is-drag');
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  // Cegah browser membuka file bila di-drop di luar dropzone.
  ['dragover', 'drop'].forEach(function (evt) {
    window.addEventListener(evt, function (e) {
      if (!dropzone.contains(e.target)) e.preventDefault();
    });
  });

  document.addEventListener('paste', function (e) {
    var clipItems = e.clipboardData && e.clipboardData.items;
    if (!clipItems) return;
    var files = [];
    for (var i = 0; i < clipItems.length; i += 1) {
      if (clipItems[i].kind === 'file') {
        var file = clipItems[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) addFiles(files);
  });

  copyRawBtn.addEventListener('click', async function () {
    var text = rawJsonEl.textContent.trim();
    if (!text || text === '\u2014') {
      toast('info', 'Belum ada response', 'Upload sesuatu dulu untuk melihat JSON.');
      return;
    }
    var okCopy = await copyText(text);
    toast(okCopy ? 'ok' : 'err', okCopy ? 'JSON disalin' : 'Gagal menyalin');
  });

  clearAllBtn.addEventListener('click', function () { clearAll(); });

  function closeLightbox() { lightbox.hidden = true; lightboxImg.src = ''; }
  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });

  /* ------------------------------------------------------------------ init */

  renderQueue();
  updateGalleryStats();
  loadApiInfo();
  loadStorageStats();
  checkHealth();
  setInterval(checkHealth, 15000);
  setInterval(loadStorageStats, 30000);
})();