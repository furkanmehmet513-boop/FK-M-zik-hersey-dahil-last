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
let swapSourceId = null;

let currentSort = 'manual'; // manual, asc, desc
let editMode = false;

let sleepTimerInterval = null;
let sleepEndTime = null;

const audio = new Audio();

const el = {
    app: document.body,
    overlay: document.getElementById('overlay'),
    sidebar: document.getElementById('sidebar'),
    songList: document.getElementById('song-list'),
    viewTitle: document.getElementById('view-title'),
    storageSize: document.getElementById('storage-size'),
    playlistsContainer: document.getElementById('playlists-container'),
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
    sortSelect: document.getElementById('sort-select'),
    btnEditMode: document.getElementById('btn-edit-mode')
};

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await initDB();
    await loadData();
    setupEventListeners();
    setupAudioListeners();
});

// --- BİLDİRİM (TOAST) ---
function showToast(msg) {
    const container = document.getElementById('toast-container');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

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
    playlists = await getAllFromStore('playlists');
    
    renderPlaylistsSidebar();
    switchView('all');
    calculateStorage();

    const folderName = localStorage.getItem('backup_folder_name');
    if (folderName) {
        el.backupFolderName.innerText = "Yedek Klasörü: " + folderName;
    } else {
        el.backupFolderName.innerText = "Yedek Klasörü: Seçilmedi";
    }
    
    const overlay = document.getElementById('mandatory-folder-overlay');
    if (overlay) overlay.style.display = 'none';
}

function calculateStorage() {
    let totalBytes = songs.reduce((acc, song) => acc + (song.blob ? song.blob.size : 0), 0);
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
        songs.push(song);
    }
    if(currentView === 'all') switchView('all');
    calculateStorage();
}

// --- SIRALAMA VE GÖRÜNÜM (RENDER) ---
function getSortedList(list) {
    let sorted = [...list];
    if(currentSort === 'asc') {
        sorted.sort((a,b) => a.title.localeCompare(b.title));
    } else if(currentSort === 'desc') {
        sorted.sort((a,b) => b.title.localeCompare(a.title));
    } else {
        if(currentView === 'queue') {
            sorted.sort((a,b) => queue.indexOf(a.id) - queue.indexOf(b.id));
        } else {
            sorted.sort((a,b) => b.addedAt - a.addedAt);
        }
    }
    return sorted;
}

function renderSongList(listToRender) {
    currentSongsList = getSortedList(listToRender);
    el.songList.innerHTML = '';
    
    if(currentSongsList.length === 0) {
        el.songList.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-sec);">Burada henüz şarkı yok.</div>`;
        return;
    }
    
    currentSongsList.forEach((song, index) => {
        const div = document.createElement('div');
        div.className = `song-item ${audio.dataset.currentId === song.id ? 'playing' : ''}`;
        
        let actionsHtml = `
            <button class="action-btn" onclick="toggleFavorite('${song.id}', event)" title="Favori"><i class="${song.isFavorite ? 'fa-solid text-accent' : 'fa-regular'} fa-heart" style="${song.isFavorite?'color:var(--accent)':''}"></i></button>
            <button class="action-btn" onclick="addToQueue('${song.id}', event)" title="Sıraya Ekle"><i class="fa-solid fa-plus"></i></button>
            <button class="action-btn" onclick="openAddToPlaylistModal('${song.id}', event)" title="Çalma Listesine Ekle"><i class="fa-solid fa-list-ul"></i></button>
        `;
        
        if(editMode && currentSort === 'manual') {
            actionsHtml += `<button class="action-btn ${swapSourceId === song.id ? 'swap-mode' : ''}" onclick="handleSwap('${song.id}', event)" title="Yer Değiştir"><i class="fa-solid fa-sort"></i></button>`;
        }
        
        actionsHtml += `<button class="action-btn" onclick="requestDelete('${song.id}', event)" title="Kaldır/Sil"><i class="fa-solid fa-trash"></i></button>`;

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
    if(song.blob) audio.src = URL.createObjectURL(song.blob);
    audio.dataset.currentId = song.id;
    
    currentSongIndex = currentSongsList.findIndex(s => s.id === id);
    
    el.playerTitle.innerText = song.title;
    el.playerArtist.innerText = song.artist;
    
    const req = getStore('covers').get(song.id);
    req.onsuccess = () => {
        if(req.result) el.playerCover.innerHTML = `<img src="${req.result.dataURL}">`;
        else el.playerCover.innerHTML = `<i class="fa-solid fa-music"></i>`;
    };

    if(song.blob) {
        audio.play().catch(err => console.error(err));
        isPlaying = true;
    } else {
        showToast("Ses dosyası bulunamadı!");
        isPlaying = false;
    }
    
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
    if(queue.length > 0) {
        const nextId = queue.shift();
        playSong(nextId);
        if(currentView === 'queue') switchView('queue');
        return; 
    }
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

// --- KUYRUK EYLEMLERİ ---
function addToQueue(id, e) {
    e.stopPropagation();
    queue.push(id);
    showToast("Sıraya eklendi");
    if(currentView === 'queue') switchView('queue');
}

// --- GÖRÜNÜM GEÇİŞİ ---
function switchView(view) {
    currentView = view;
    swapSourceId = null;
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('active'));
    
    const sidebarItem = document.querySelector(`.menu-item[data-view="${view}"]`);
    if(sidebarItem) sidebarItem.classList.add('active');

    if(view === 'all') { 
        el.viewTitle.innerText = "Tüm Şarkılar"; 
        renderSongList(songs); 
    }
    else if(view === 'favorites') { 
        el.viewTitle.innerText = "Favoriler"; 
        renderSongList(songs.filter(s => s.isFavorite)); 
    }
    else if(view === 'history') { 
        el.viewTitle.innerText = "Geçmiş"; 
        loadHistory(); 
    }
    else if(view === 'queue') {
        el.viewTitle.innerText = "Sıram";
        renderSongList(queue.map(id => songs.find(s => s.id === id)).filter(Boolean));
    }
    else if(view.startsWith('playlist_')) {
        const p = playlists.find(p => p.id === view.split('_')[1]);
        if(p) {
            el.viewTitle.innerText = p.name;
            renderSongList(p.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean));
        }
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

// --- MANUEL YER DEĞİŞTİRME ---
async function handleSwap(id, e) {
    e.stopPropagation();
    if(!swapSourceId) { 
        swapSourceId = id; 
        renderSongList(currentSongsList); 
    } else {
        if(swapSourceId !== id) {
            if(currentView === 'queue') {
                const idx1 = queue.indexOf(swapSourceId);
                const idx2 = queue.indexOf(id);
                if(idx1 !== -1 && idx2 !== -1) {
                    const temp = queue[idx1];
                    queue[idx1] = queue[idx2];
                    queue[idx2] = temp;
                }
            } else {
                const idx1 = songs.findIndex(s => s.id === swapSourceId);
                const idx2 = songs.findIndex(s => s.id === id);
                const temp = songs[idx1].addedAt;
                songs[idx1].addedAt = songs[idx2].addedAt;
                songs[idx2].addedAt = temp;
                await putToStore('songs', songs[idx1]);
                await putToStore('songs', songs[idx2]);
            }
        }
        swapSourceId = null; 
        switchView(currentView);
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
            if(!p.songIds.includes(songToAddId)) { p.songIds.push(songToAddId); await putToStore('playlists', p); showToast("Çalma listesine eklendi."); }
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
    else if(currentView === 'queue') text = "Bu şarkıyı sıradan çıkarmak istiyor musunuz?";
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
    } else if(currentView === 'queue') {
        const idx = queue.indexOf(songToDeleteId);
        if(idx !== -1) queue.splice(idx, 1);
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

// --- YEDEKLEME VE GERİ YÜKLEME (METİN TABANLI) ---

document.getElementById('btn-change-folder').onclick = () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.webkitdirectory = true;
    picker.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const pathParts = e.target.files[0].webkitRelativePath.split('/');
            const folderName = pathParts[0] || "Seçilen Klasör";
            localStorage.setItem('backup_folder_name', folderName);
            el.backupFolderName.innerText = "Yedek Klasörü: " + folderName;
            showToast(`Klasör seçildi: ${folderName}`);
        }
    });
    picker.click();
};

document.getElementById('btn-export').onclick = async () => {
    el.viewTitle.innerText = "Yedekleniyor... Lütfen bekleyin.";
    try {
        const songsInDb = await getAllFromStore('songs');
        const backupArray = [];
        
        for(let s of songsInDb) {
            let base64 = null;
            if (s.blob) {
                base64 = await blobToBase64(s.blob);
            }
            // Yalnızca gerekli verileri serialize ediyoruz
            backupArray.push({
                id: s.id, 
                title: s.title, 
                artist: s.artist, 
                addedAt: s.addedAt, 
                isFavorite: s.isFavorite, 
                type: s.blob ? s.blob.type : 'audio/mpeg', 
                base64: base64
            });
        }
        
        // Gereksiz type, DOM elementleri veya fonksiyonlardan arındırılmış temiz JSON çıktısı
        const cleanJson = JSON.stringify(backupArray, (key, value) => {
            if (typeof value === 'function' || value === undefined) return undefined;
            if (value !== null && typeof value === 'object' && value.nodeType === 1) return undefined;
            return value;
        });

        document.getElementById('backup-textarea').value = cleanJson;
        openModal('modal-text-backup');
    } catch(err) {
        console.error(err); 
        showToast("Yedekleme başarısız!");
    } finally {
        el.viewTitle.innerText = currentView === 'all' ? "Tüm Şarkılar" : el.viewTitle.innerText;
        closeSidebar();
    }
};

document.getElementById('btn-copy-backup').onclick = () => {
    const text = document.getElementById('backup-textarea').value;
    navigator.clipboard.writeText(text).then(() => {
        showToast("Yedek metni kopyalandı!");
        closeModal('modal-text-backup');
    }).catch(() => showToast("Kopyalama başarısız oldu. Manuel kopyalayın."));
};

document.getElementById('btn-import').onclick = () => {
    document.getElementById('restore-textarea').value = "";
    openModal('modal-text-restore');
    closeSidebar();
};

document.getElementById('btn-confirm-text-restore').onclick = async () => {
    const text = document.getElementById('restore-textarea').value.trim();
    if(!text) { showToast("Lütfen metni yapıştırın."); return; }
    
    closeModal('modal-text-restore');
    el.viewTitle.innerText = "Geri Yükleniyor... Lütfen bekleyin!";
    
    try {
        const parsedData = JSON.parse(text);
        
        // Yalnızca valid bir Array kabul ediliyor
        if (!Array.isArray(parsedData)) {
            showToast("Geçersiz veri: Dizi formatı bekleniyor.");
            return;
        }
        
        // Mevcut verileri temizliyoruz
        await new Promise((res) => {
            const req = getStore('songs', 'readwrite').clear();
            req.onsuccess = res;
            req.onerror = res;
        });
        
        // Bellekteki state'i sıfırlıyoruz
        songs = [];
        
        // Storage'ı güncelliyoruz ve yeni state dizisini oluşturuyoruz
        for(let s of parsedData) {
            if (s && s.id && s.title) {
                let blob = null;
                if (s.base64) {
                    try {
                        const res = await fetch(s.base64);
                        blob = await res.blob();
                    } catch(e) {
                        console.error("Blob dönüştürme hatası", e);
                    }
                }
                const newSong = { 
                    id: s.id, 
                    title: s.title, 
                    artist: s.artist || "Bilinmeyen Sanatçı", 
                    addedAt: s.addedAt || Date.now(), 
                    isFavorite: !!s.isFavorite, 
                    blob: blob 
                };
                await putToStore('songs', newSong);
                songs.push(newSong);
            }
        }
        
        showToast("Geri yükleme başarılı!"); 
        switchView('all');
        calculateStorage();
    } catch(err) {
        console.error(err); 
        showToast("Hata: Geri yükleme metni bozuk veya geçersiz.");
    } finally {
        el.viewTitle.innerText = currentView === 'all' ? "Tüm Şarkılar" : el.viewTitle.innerText;
    }
};

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
    el.overlay.onclick = () => closeSidebar();
    
    document.getElementById('btn-upload-menu').onclick = (e) => { e.stopPropagation(); document.getElementById('upload-options').classList.toggle('show'); };
    document.onclick = (e) => { if(!e.target.closest('.upload-dropdown')) document.getElementById('upload-options').classList.remove('show'); };
    
    document.getElementById('btn-add-files').onclick = () => el.fileUpload.click();
    document.getElementById('btn-add-folder').onclick = () => el.folderUpload.click();
    el.fileUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    el.folderUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    
    document.querySelectorAll('.menu-item[data-view]').forEach(btn => {
        btn.onclick = () => { switchView(btn.dataset.view); };
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
        let list;
        if(currentView === 'all') list = songs;
        else if(currentView === 'favorites') list = songs.filter(s => s.isFavorite);
        else if(currentView === 'queue') list = queue.map(id => songs.find(s => s.id === id)).filter(Boolean);
        else list = currentSongsList;
        renderSongList(!query ? list : list.filter(s => s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query)));
    });

    el.sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        if(currentSort !== 'manual') {
            editMode = false;
            el.btnEditMode.classList.remove('active');
            swapSourceId = null;
        }
        switchView(currentView);
    });

    el.btnEditMode.onclick = () => {
        if(currentSort !== 'manual') {
            showToast("Düzenleme modu sadece Manuel sıralamada çalışır.");
            return;
        }
        editMode = !editMode;
        el.btnEditMode.classList.toggle('active', editMode);
        swapSourceId = null;
        renderSongList(currentSongsList);
    };

    document.getElementById('btn-sleep-timer').onclick = () => openModal('modal-sleep-timer');
    document.querySelectorAll('.timer-btn').forEach(btn => {
        btn.onclick = () => {
            const time = parseInt(btn.dataset.time);
            document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if(sleepTimerInterval) clearInterval(sleepTimerInterval);
            document.getElementById('sleep-timer-display').innerText = "";

            if(time > 0) {
                document.getElementById('btn-sleep-timer').classList.add('active');
                sleepEndTime = Date.now() + time * 60 * 1000;
                
                sleepTimerInterval = setInterval(() => {
                    let remain = Math.ceil((sleepEndTime - Date.now()) / 1000);
                    if(remain <= 0) {
                        audio.pause(); isPlaying = false; updatePlayPauseUI();
                        clearInterval(sleepTimerInterval);
                        document.getElementById('btn-sleep-timer').classList.remove('active');
                        document.getElementById('sleep-timer-display').innerText = "";
                        showToast("Uyku modu süresi doldu. Müzik durduruldu.");
                    } else {
                        let m = Math.floor(remain / 60);
                        let s = remain % 60;
                        document.getElementById('sleep-timer-display').innerText = `${m}:${s < 10 ? '0'+s : s}`;
                    }
                }, 1000);
            } else {
                document.getElementById('btn-sleep-timer').classList.remove('active');
            }
            closeModal('modal-sleep-timer');
        };
    });
}

function closeSidebar() { el.sidebar.classList.remove('open'); el.overlay.classList.remove('show'); }
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }