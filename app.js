// --- STATE & DEĞİŞKENLER ---
let db;
let songs = [];
let playlists = [];
let queue = [];
let currentSongIndex = -1;
let currentSongsList = [];
let currentView = 'all';
let isPlaying = false;
let repeatMode = 0; 
let shuffleMode = false;
let sleepTimer = null;
let swapSourceId = null;

const audio = new Audio();

const el = {
    app: document.body,
    overlay: document.getElementById('overlay'),
    sidebar: document.getElementById('sidebar'),
    queuePanel: document.getElementById('queue-panel'),
    songList: document.getElementById('song-list'),
    viewTitle: document.getElementById('view-title'),
    storageSize: document.getElementById('storage-size'),
    playlistsContainer: document.getElementById('playlists-container'),
    queueList: document.getElementById('queue-list'),
    backupFolderName: document.getElementById('backup-folder-name'),
    
    playBtn: document.getElementById('btn-play'),
    prevBtn: document.getElementById('btn-prev'),
    nextBtn: document.getElementById('btn-next'),
    shuffleBtn: document.getElementById('btn-shuffle'),
    repeatBtn: document.getElementById('btn-repeat'),
    muteBtn: document.getElementById('btn-mute'),
    volumeSlider: document.getElementById('volume-slider'),
    progressBar: document.getElementById('progress-bar'),
    progressContainer: document.getElementById('progress-container'),
    timeCurrent: document.getElementById('time-current'),
    timeTotal: document.getElementById('time-total'),
    playerTitle: document.getElementById('player-title'),
    playerArtist: document.getElementById('player-artist'),
    playerCover: document.getElementById('player-cover'),
    
    searchInput: document.getElementById('search-input'),
    fileUpload: document.getElementById('file-upload'),
    folderUpload: document.getElementById('folder-upload'),
    coverUpload: document.getElementById('cover-upload'),
    importFile: document.getElementById('import-file')
};

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await initDB();
    await loadData();
    setupEventListeners();
    setupAudioListeners();
});

// --- INDEXEDDB KURULUMU ---
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('FKMusicDB', 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if(!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
            if(!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'songId' });
            if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
        request.onerror = (e) => { console.error("DB Hatası", e); reject(); };
    });
}

function getStore(storeName, mode = 'readonly') {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
}

function getAllFromStore(storeName) {
    return new Promise((resolve) => {
        const req = getStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
    });
}

function putToStore(storeName, data) {
    return new Promise((resolve) => {
        const req = getStore(storeName, 'readwrite').put(data);
        req.onsuccess = () => resolve();
    });
}

function deleteFromStore(storeName, id) {
    return new Promise((resolve) => {
        const req = getStore(storeName, 'readwrite').delete(id);
        req.onsuccess = () => resolve();
    });
}

// --- VERİ YÜKLEME ---
async function loadData() {
    songs = await getAllFromStore('songs');
    songs.sort((a, b) => b.addedAt - a.addedAt);
    playlists = await getAllFromStore('playlists');
    
    renderPlaylistsSidebar();
    renderSongList(songs);
    calculateStorage();

    // 1. Klasör Seçimi: LocalStorage'dan kontrol et ve göster
    const folderName = localStorage.getItem('backup_folder_name');
    if (folderName) {
        el.backupFolderName.innerText = "Yedek Klasörü: " + folderName;
    } else {
        el.backupFolderName.innerText = "Yedek Klasörü: Seçilmedi";
    }
    
    // 4. Uygulama açılışında zorunlu bloklama ekranını tamamen gizle (isteğe bağlı kullanım)
    const overlay = document.getElementById('mandatory-folder-overlay');
    if (overlay) overlay.style.display = 'none';
}

function calculateStorage() {
    let totalBytes = songs.reduce((acc, song) => acc + song.blob.size, 0);
    el.storageSize.innerText = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
}

// --- DOSYA YÜKLEME VE İŞLEME ---
async function handleFiles(files) {
    if(!files || files.length === 0) return;
    for(let file of files) {
        if(!file.type.startsWith('audio/')) continue;
        let cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/official audio|official video|lyrics|hq|hd/ig, '').trim();
        let artist = "Bilinmeyen Sanatçı", title = cleanName;
        if(cleanName.includes('-')) {
            const parts = cleanName.split('-');
            artist = parts[0].trim(); title = parts.slice(1).join('-').trim();
        }
        const song = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            title, artist, blob: file, addedAt: Date.now(), isFavorite: false
        };
        await putToStore('songs', song);
        songs.unshift(song);
    }
    if(currentView === 'all') renderSongList(songs);
    calculateStorage();
}

// --- GÖRÜNÜM (RENDER) ---
function renderSongList(listToRender) {
    currentSongsList = listToRender;
    el.songList.innerHTML = '';
    if(listToRender.length === 0) {
        el.songList.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-sec);">Burada henüz şarkı yok.</div>`;
        return;
    }
    listToRender.forEach((song, index) => {
        const div = document.createElement('div');
        div.className = `song-item ${audio.dataset.currentId === song.id ? 'playing' : ''}`;
        
        let actionsHtml = `
            <button class="action-btn" onclick="toggleFavorite('${song.id}', event)"><i class="${song.isFavorite ? 'fa-solid text-accent' : 'fa-regular'} fa-heart" style="${song.isFavorite?'color:var(--accent)':''}"></i></button>
            <button class="action-btn" onclick="addToQueue('${song.id}', event)"><i class="fa-solid fa-plus"></i></button>
            <button class="action-btn" onclick="openAddToPlaylistModal('${song.id}', event)"><i class="fa-solid fa-list-ul"></i></button>
        `;
        if(currentView === 'all') actionsHtml += `<button class="action-btn ${swapSourceId === song.id ? 'swap-mode' : ''}" onclick="handleSwap('${song.id}', event)"><i class="fa-solid fa-sort"></i></button>`;
        actionsHtml += `<button class="action-btn" onclick="requestDelete('${song.id}', event)"><i class="fa-solid fa-trash"></i></button>`;

        div.innerHTML = `
            <div style="cursor:pointer;" onclick="playSong('${song.id}')">${index + 1}</div>
            <div class="song-cover"><i class="fa-solid fa-music"></i></div>
            <div class="song-title" style="cursor:pointer;" onclick="playSong('${song.id}')">${song.title}</div>
            <div class="song-artist">${song.artist}</div>
            <div class="song-actions">${actionsHtml}</div>
        `;
        loadCoverForElement(song.id, div.querySelector('.song-cover'));
        el.songList.appendChild(div);
    });
}

function renderPlaylistsSidebar() {
    el.playlistsContainer.innerHTML = '';
    playlists.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'menu-item';
        btn.innerHTML = `<i class="fa-solid fa-list"></i> ${p.name}`;
        btn.onclick = () => switchView(`playlist_${p.id}`);
        el.playlistsContainer.appendChild(btn);
    });
}

// --- OYNATICI MOTORU ---
async function playSong(id) {
    const song = songs.find(s => s.id === id);
    if(!song) return;
    if(audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(song.blob);
    audio.dataset.currentId = song.id;
    currentSongIndex = currentSongsList.findIndex(s => s.id === id);
    el.playerTitle.innerText = song.title;
    el.playerArtist.innerText = song.artist;
    
    const req = getStore('covers').get(song.id);
    req.onsuccess = () => {
        if(req.result) el.playerCover.innerHTML = `<img src="${req.result.dataURL}">`;
        else el.playerCover.innerHTML = `<i class="fa-solid fa-music"></i>`;
    };

    audio.play();
    isPlaying = true;
    updatePlayPauseUI();
    renderSongList(currentSongsList);
    updateMediaSession(song);
}

function togglePlay() {
    if(!audio.src) { if(currentSongsList.length > 0) playSong(currentSongsList[0].id); return; }
    if(isPlaying) { audio.pause(); isPlaying = false; }
    else { audio.play(); isPlaying = true; }
    updatePlayPauseUI();
}

function playNext() {
    if(queue.length > 0) { playSong(queue.shift()); renderQueue(); return; }
    if(currentSongsList.length === 0) return;
    if(shuffleMode) {
        playSong(currentSongsList[Math.floor(Math.random() * currentSongsList.length)].id);
        return;
    }
    let nextIndex = currentSongIndex + 1;
    if(nextIndex >= currentSongsList.length) {
        if(repeatMode === 1) nextIndex = 0;
        else return;
    }
    playSong(currentSongsList[nextIndex].id);
}

function playPrev() {
    if(audio.currentTime > 3) { audio.currentTime = 0; return; }
    if(currentSongsList.length === 0) return;
    let prevIndex = currentSongIndex - 1;
    if(prevIndex < 0) prevIndex = currentSongsList.length - 1;
    playSong(currentSongsList[prevIndex].id);
}

function updatePlayPauseUI() {
    el.playBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function setupAudioListeners() {
    audio.addEventListener('timeupdate', () => {
        if(!audio.duration) return;
        el.progressBar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
        el.timeCurrent.innerText = formatTime(audio.currentTime);
        el.timeTotal.innerText = formatTime(audio.duration);
        if(audio.currentTime >= 10 && !audio.dataset.historySaved) {
            audio.dataset.historySaved = "true";
            saveToHistory(audio.dataset.currentId);
        }
    });
    audio.addEventListener('ended', () => {
        if(repeatMode === 2) { audio.currentTime = 0; audio.play(); }
        else playNext();
    });
    audio.addEventListener('loadstart', () => audio.dataset.historySaved = "");
    el.progressContainer.addEventListener('click', (e) => {
        if(!audio.duration) return;
        const rect = el.progressContainer.getBoundingClientRect();
        audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
    });
}

function formatTime(seconds) {
    if(isNaN(seconds)) return "0:00";
    const min = Math.floor(seconds / 60), sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
}

function updateMediaSession(song) {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: 'FK Müzik' });
        navigator.mediaSession.setActionHandler('play', togglePlay);
        navigator.mediaSession.setActionHandler('pause', togglePlay);
        navigator.mediaSession.setActionHandler('previoustrack', playPrev);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
}

// --- KUYRUK, YER DEĞİŞTİRME, FAVORİLER ---
function addToQueue(id, e) { e.stopPropagation(); queue.push(id); renderQueue(); }
function renderQueue() {
    el.queueList.innerHTML = '';
    queue.forEach((id, index) => {
        const song = songs.find(s => s.id === id);
        if(!song) return;
        const div = document.createElement('div');
        div.className = 'queue-item';
        div.innerHTML = `
            <div class="queue-info"><div class="title">${song.title}</div><div class="artist">${song.artist}</div></div>
            <div>
                <button class="action-btn" onclick="moveQueue(${index}, -1)"><i class="fa-solid fa-chevron-up"></i></button>
                <button class="action-btn" onclick="moveQueue(${index}, 1)"><i class="fa-solid fa-chevron-down"></i></button>
                <button class="action-btn" onclick="removeFromQueue(${index})"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
        el.queueList.appendChild(div);
    });
}
function moveQueue(index, dir) {
    if(index + dir < 0 || index + dir >= queue.length) return;
    const temp = queue[index]; queue[index] = queue[index + dir]; queue[index + dir] = temp; renderQueue();
}
function removeFromQueue(index) { queue.splice(index, 1); renderQueue(); }

function switchView(view) {
    currentView = view; swapSourceId = null;
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
    if(view === 'all') { el.viewTitle.innerText = "Tüm Şarkılar"; renderSongList(songs); }
    else if(view === 'favorites') { el.viewTitle.innerText = "Favoriler"; renderSongList(songs.filter(s => s.isFavorite)); }
    else if(view === 'history') { el.viewTitle.innerText = "Geçmiş"; loadHistory(); }
    else if(view.startsWith('playlist_')) {
        const p = playlists.find(p => p.id === view.split('_')[1]);
        el.viewTitle.innerText = p.name;
        renderSongList(p.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean));
    }
    closeSidebar();
}

async function loadHistory() {
    const hist = await getAllFromStore('history');
    hist.sort((a, b) => b.timestamp - a.timestamp);
    renderSongList(hist.map(h => songs.find(s => s.id === h.id)).filter(Boolean));
}
function saveToHistory(id) { putToStore('history', { id, timestamp: Date.now() }); }

async function toggleFavorite(id, e) {
    e.stopPropagation();
    const song = songs.find(s => s.id === id);
    song.isFavorite = !song.isFavorite;
    await putToStore('songs', song);
    renderSongList(currentSongsList);
}

async function handleSwap(id, e) {
    e.stopPropagation();
    if(!swapSourceId) { swapSourceId = id; renderSongList(currentSongsList); } 
    else {
        if(swapSourceId !== id) {
            const idx1 = songs.findIndex(s => s.id === swapSourceId);
            const idx2 = songs.findIndex(s => s.id === id);
            const temp = songs[idx1].addedAt;
            songs[idx1].addedAt = songs[idx2].addedAt;
            songs[idx2].addedAt = temp;
            await putToStore('songs', songs[idx1]);
            await putToStore('songs', songs[idx2]);
            songs.sort((a, b) => b.addedAt - a.addedAt);
        }
        swapSourceId = null; renderSongList(songs);
    }
}

// --- ÇALMA LİSTESİ VE SİLME ---
document.getElementById('btn-create-playlist').onclick = () => { document.getElementById('playlist-name-input').value = ''; openModal('modal-create-playlist'); };
document.getElementById('btn-confirm-create-playlist').onclick = async () => {
    const name = document.getElementById('playlist-name-input').value.trim();
    if(!name) return;
    const p = { id: Date.now().toString(), name, songIds: [] };
    await putToStore('playlists', p); playlists.push(p);
    renderPlaylistsSidebar(); closeModal('modal-create-playlist');
};

let songToAddId = null;
function openAddToPlaylistModal(id, e) {
    e.stopPropagation(); songToAddId = id;
    const listEl = document.getElementById('modal-playlist-list');
    listEl.innerHTML = '';
    playlists.forEach(p => {
        const btn = document.createElement('button'); btn.innerText = p.name;
        btn.onclick = async () => {
            if(!p.songIds.includes(songToAddId)) { p.songIds.push(songToAddId); await putToStore('playlists', p); }
            closeModal('modal-add-to-playlist');
        };
        listEl.appendChild(btn);
    });
    openModal('modal-add-to-playlist');
}

let songToDeleteId = null;
function requestDelete(id, e) {
    e.stopPropagation(); songToDeleteId = id;
    let text = "Bu şarkıyı tamamen silmek istediğinize emin misiniz?";
    if(currentView === 'favorites') text = "Bu şarkıyı favorilerden çıkarmak istiyor musunuz?";
    else if(currentView.startsWith('playlist_')) text = "Bu şarkıyı çalma listesinden çıkarmak istiyor musunuz?";
    document.getElementById('delete-warning-text').innerText = text;
    openModal('modal-confirm-delete');
}

document.getElementById('btn-confirm-delete').onclick = async () => {
    if(!songToDeleteId) return;
    if(currentView === 'all' || currentView === 'history') {
        await deleteFromStore('songs', songToDeleteId);
        songs = songs.filter(s => s.id !== songToDeleteId);
    } else if(currentView === 'favorites') {
        const song = songs.find(s => s.id === songToDeleteId);
        song.isFavorite = false; await putToStore('songs', song);
    } else if(currentView.startsWith('playlist_')) {
        const p = playlists.find(p => p.id === currentView.split('_')[1]);
        p.songIds = p.songIds.filter(id => id !== songToDeleteId); await putToStore('playlists', p);
    }
    closeModal('modal-confirm-delete'); switchView(currentView); calculateStorage();
};

// --- KAPAK FOTOĞRAFLARI ---
el.playerCover.addEventListener('click', () => { if(audio.dataset.currentId) el.coverUpload.click(); });
el.coverUpload.addEventListener('change', (e) => {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        await putToStore('covers', { songId: audio.dataset.currentId, dataURL: ev.target.result });
        el.playerCover.innerHTML = `<img src="${ev.target.result}">`;
        renderSongList(currentSongsList);
    };
    reader.readAsDataURL(file);
});
function loadCoverForElement(songId, element) {
    const req = getStore('covers').get(songId);
    req.onsuccess = () => { if(req.result) element.innerHTML = `<img src="${req.result.dataURL}">`; };
}

// --- YEDEKLEME VE GERİ YÜKLEME (WebView Uyumlu) ---
function getFormattedDate() {
    const d = new Date(); const pad = n => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// 1. Klasörü Değiştir Butonu (WebView Uyumlu - File Input WebkitDirectory)
document.getElementById('btn-change-folder').onclick = () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.webkitdirectory = true; // WebView ve Modern Tarayıcılarda Klasör Seçimini Sağlar
    picker.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            // Dosyanın yolundan klasör adını al
            const pathParts = e.target.files[0].webkitRelativePath.split('/');
            const folderName = pathParts[0] || "Seçilen Klasör";
            
            // Klasör adını LocalStorage'a kaydet (Handle kullanmadan)
            localStorage.setItem('backup_folder_name', folderName);
            el.backupFolderName.innerText = "Yedek Klasörü: " + folderName;
            alert(`Klasör seçildi: ${folderName}\n\nNot: Android sistem kısıtlamaları nedeniyle yedek dosyaları cihazınızın varsayılan İndirilenler (Downloads) klasörüne indirilecektir.`);
        }
    });
    picker.click();
};

// 2. Yedekle (Dışa Aktar)
document.getElementById('btn-export').onclick = async () => {
    el.viewTitle.innerText = "Yedekleniyor... Lütfen bekleyin.";
    try {
        const backup = {
            songs: await Promise.all((await getAllFromStore('songs')).map(async s => ({
                id: s.id, 
                title: s.title, 
                artist: s.artist, 
                addedAt: s.addedAt, 
                isFavorite: s.isFavorite, 
                type: s.blob.type, 
                base64: await blobToBase64(s.blob)
            }))),
            playlists: await getAllFromStore('playlists'),
            covers: await getAllFromStore('covers')
        };
        
        const jsonStr = JSON.stringify(backup);
        const filename = `FK_Muzik_Yedek_${getFormattedDate()}.json`;

        // Büyük veri setleri için güvenli Blob indirme (WebView destekler)
        const blob = new Blob([jsonStr], { type: "application/json" });
        const reader = new FileReader();
        reader.onload = function(e) {
            const dataUrl = e.target.result;
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataUrl);
            dlAnchorElem.setAttribute("download", filename);
            document.body.appendChild(dlAnchorElem);
            dlAnchorElem.click();
            document.body.removeChild(dlAnchorElem);
            alert("Yedekleme başarıyla indiriliyor:\n" + filename);
        };
        reader.readAsDataURL(blob);
        
    } catch(err) {
        console.error(err); alert("Yedekleme başarısız!");
    }
    el.viewTitle.innerText = currentView === 'all' ? "Tüm Şarkılar" : el.viewTitle.innerText;
};

// 3. Geri Yükle (İçe Aktar)
document.getElementById('btn-import').onclick = () => {
    // Tüm şarkıların silineceğine dair uyarı mesajı
    if (confirm("Mevcut tüm şarkılar silinecek, devam etmek istiyor musunuz?")) {
        el.importFile.click(); // Standart dosya seçiciyi aç
    }
};

el.importFile.addEventListener('change', (e) => {
    if(e.target.files[0]) {
        processImportFile(e.target.files[0]);
    }
    el.importFile.value = ""; // Aynı dosyanın tekrar seçilebilmesi için sıfırla
});

function processImportFile(file) {
    el.viewTitle.innerText = "Geri Yükleniyor... Kapatmayın!";
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const backup = JSON.parse(ev.target.result);
            
            // IndexedDB temizleniyor
            await new Promise(res => { getStore('songs', 'readwrite').clear().onsuccess = res; });
            await new Promise(res => { getStore('playlists', 'readwrite').clear().onsuccess = res; });
            await new Promise(res => { getStore('covers', 'readwrite').clear().onsuccess = res; });
            
            // Tüm veriler base64'ten Blob'a çevrilerek yeniden yükleniyor
            for(let s of backup.songs) {
                const blob = await (await fetch(s.base64)).blob();
                await putToStore('songs', { id: s.id, title: s.title, artist: s.artist, addedAt: s.addedAt, isFavorite: s.isFavorite, blob });
            }
            for(let p of backup.playlists) await putToStore('playlists', p);
            for(let c of backup.covers) await putToStore('covers', c);
            
            alert("Geri yükleme başarılı! Uygulama yeniden başlatılıyor."); 
            location.reload(); // Başarılı olunca reload at
        } catch(err) {
            console.error(err); 
            alert("Yedek dosyası okunurken hata oluştu. Dosyanın bozuk olmadığından emin olun.");
            el.viewTitle.innerText = currentView === 'all' ? "Tüm Şarkılar" : el.viewTitle.innerText;
        }
    };
    reader.readAsText(file);
}

function blobToBase64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

// --- TEMA VE ARAYÜZ (THEME & UI) ---
function initTheme() {
    const saved = localStorage.getItem('fk_theme') || 'dark';
    document.body.setAttribute('data-theme', saved);
}

document.getElementById('btn-theme-toggle').onclick = () => {
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next); localStorage.setItem('fk_theme', next);
};

function setupEventListeners() {
    document.getElementById('btn-menu').onclick = () => { el.sidebar.classList.add('open'); el.overlay.classList.add('show'); };
    document.getElementById('close-sidebar').onclick = closeSidebar;
    document.getElementById('btn-queue').onclick = () => { el.queuePanel.classList.add('open'); el.overlay.classList.add('show'); renderQueue(); };
    document.getElementById('close-queue').onclick = closeQueue;
    el.overlay.onclick = () => { closeSidebar(); closeQueue(); };
    
    document.getElementById('btn-upload-menu').onclick = (e) => { e.stopPropagation(); document.getElementById('upload-options').classList.toggle('show'); };
    document.onclick = (e) => { if(!e.target.closest('.upload-dropdown')) document.getElementById('upload-options').classList.remove('show'); };
    
    document.getElementById('btn-add-files').onclick = () => el.fileUpload.click();
    document.getElementById('btn-add-folder').onclick = () => el.folderUpload.click();
    el.fileUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    el.folderUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    
    document.querySelectorAll('.menu-item[data-view]').forEach(btn => {
        btn.onclick = () => { document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active')); btn.classList.add('active'); switchView(btn.dataset.view); };
    });
    
    el.playBtn.onclick = togglePlay; el.nextBtn.onclick = playNext; el.prevBtn.onclick = playPrev;
    el.shuffleBtn.onclick = () => { shuffleMode = !shuffleMode; el.shuffleBtn.classList.toggle('active', shuffleMode); };
    el.repeatBtn.onclick = () => {
        repeatMode = (repeatMode + 1) % 3;
        if(repeatMode === 0) el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>', el.repeatBtn.classList.remove('active');
        else if(repeatMode === 1) el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat"></i>', el.repeatBtn.classList.add('active');
        else el.repeatBtn.innerHTML = '<i class="fa-solid fa-repeat-1"></i>', el.repeatBtn.classList.add('active');
    };
    
    el.volumeSlider.addEventListener('input', (e) => {
        audio.volume = e.target.value;
        el.muteBtn.innerHTML = audio.volume == 0 ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>';
    });
    el.muteBtn.onclick = () => { audio.muted = !audio.muted; el.muteBtn.innerHTML = audio.muted ? '<i class="fa-solid fa-volume-xmark"></i>' : '<i class="fa-solid fa-volume-high"></i>'; };
    
    el.searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        let list = currentView === 'all' ? songs : currentView === 'favorites' ? songs.filter(s => s.isFavorite) : currentSongsList;
        renderSongList(!query ? list : list.filter(s => s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query)));
    });

    document.getElementById('btn-sleep-timer').onclick = () => openModal('modal-sleep-timer');
    document.querySelectorAll('.timer-btn').forEach(btn => {
        btn.onclick = () => {
            const time = parseInt(btn.dataset.time);
            document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if(sleepTimer) clearTimeout(sleepTimer);
            if(time > 0) {
                document.getElementById('btn-sleep-timer').classList.add('active');
                sleepTimer = setTimeout(() => {
                    audio.pause(); isPlaying = false; updatePlayPauseUI();
                    document.getElementById('btn-sleep-timer').classList.remove('active');
                    alert("Uyku zamanlayıcısı süresi doldu. Müzik durduruldu.");
                }, time * 60 * 1000);
            } else document.getElementById('btn-sleep-timer').classList.remove('active');
        };
    });
}

function closeSidebar() { el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); }
function closeQueue() { el.queuePanel.classList.remove('open'); el.overlay.classList.remove('show'); }
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }