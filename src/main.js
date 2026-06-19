import './style.css';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from './firebase';
import locationData from './data/locations.json';

const locations = locationData.locations;
const ensureProfile = httpsCallable(functions, 'ensureProfile');
const resolveLocation = httpsCallable(functions, 'resolveLocation');
const searchPlaces = httpsCallable(functions, 'searchPlaces', { timeout: 45000 });
const googleProvider = new GoogleAuthProvider();

const state = {
  user: null,
  profile: null,
  city: '',
  district: '',
  locationLabel: '',
  allCity: false,
  results: [],
  totalFound: 0,
  smartSort: false,
  history: [],
  historyOpen: false,
  profileError: false,
  unsubscribeProfile: null,
  unsubscribeHistory: null
};

document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';
document.querySelector('#app').innerHTML = `
  <header class="site-header">
    <a class="brand" href="#" aria-label="Mekân Bul ana sayfa">
      <span class="brand-mark">⌖</span><span>mekân bul</span>
    </a>
    <div class="header-actions">
      <button class="text-button hidden" id="historyButton">Geçmiş aramalar</button>
      <button class="profile-button hidden" id="profileButton" aria-expanded="false">
        <span id="avatar" class="avatar"></span>
        <span class="profile-label">Profilim</span>
      </button>
      <button class="primary small" id="authButton">Üye ol / Giriş yap</button>
      <div class="profile-menu hidden" id="profileMenu">
        <div class="profile-summary">
          <strong id="profileName"></strong><span id="profileEmail"></span>
        </div>
        <button class="user-id-row" id="copyUserId" title="Kullanıcı ID'sini kopyala">
          <span>Kullanıcı ID</span><code id="profileUid"></code><b>Kopyala</b>
        </button>
        <div class="credit-row"><span>Kalan kullanım</span><strong id="menuCredits">—</strong></div>
        <button class="menu-button" id="themeButton">Gündüz moduna geç</button>
        <button class="menu-button danger" id="logoutButton">Çıkış yap</button>
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="eyebrow">Google Maps verileriyle</div>
      <h1>İyi mekânı,<br><span>kalabalığın içinden bul.</span></h1>
      <p>En az 3,9 puanlı ve 100 yorumlu işletmeleri saniyeler içinde listeleyin.</p>
    </section>

    <section class="auth-gate card" id="authGate">
      <div><span class="card-kicker">Aramaya başlamak için</span><h2>Ücretsiz hesabınızı oluşturun</h2><p>Yeni hesaplara 10 arama kredisi tanımlanır.</p></div>
      <button class="primary" id="gateAuthButton">Üye ol / Giriş yap</button>
    </section>

    <section class="search-shell hidden" id="searchShell">
      <div class="location-status" id="locationStatus">
        <div class="status-copy"><span class="pulse"></span><div><strong>Konum belirleniyor</strong><small>Tarayıcınız konum izni isteyebilir.</small></div></div>
        <button class="text-button" id="retryLocation">Konumumu kullan</button>
      </div>

      <div class="location-fallback card hidden" id="locationFallback">
        <div class="warning-icon">!</div>
        <div class="fallback-copy">
          <h2 id="locationFallbackTitle">Konum izni verilmediği için</h2>
          <p>Arama bölgesini il ve ilçe olarak seçmeniz gerekiyor.</p>
        </div>
      </div>

      <form class="search-card card" id="searchForm">
        <div class="field search-field">
          <label for="searchInput">Ne arıyorsunuz?</label>
          <input id="searchInput" maxlength="80" autocomplete="off" placeholder="restoran, pizza, berber, kebapçı..." required />
        </div>
        <div class="location-grid">
          <div class="field"><label for="citySelect">İl</label><select id="citySelect" required><option value="">İl seçin</option></select></div>
          <div class="field"><label for="districtSelect">İlçe</label><select id="districtSelect" required disabled><option value="">Önce il seçin</option></select></div>
        </div>
        <label class="all-city"><input type="checkbox" id="allCityCheck"><span><b>Tüm şehirde ara</b><small id="allCityCost">Seçilen şehre göre 2–5 kredi</small></span></label>
        <div class="search-footer">
          <span class="cost-note" id="costNote">Bu arama 1 kredi kullanır</span>
          <button class="primary search-submit" id="searchButton" type="submit"><span>Aramayı başlat</span><i>→</i></button>
        </div>
      </form>
      <p class="outside-note">Türkiye dışından kullanım için konum erişimi verin.</p>

      <section class="results hidden" id="resultsSection">
        <div class="results-heading">
          <div><span class="card-kicker">Sonuçlar</span><h2 id="resultsTitle">Mekânlar</h2></div>
          <button class="secondary" id="newSearchButton">Yeni arama yap</button>
        </div>
        <div class="stats" id="stats"></div>
        <div class="toolbar">
          <button class="sort-button" id="sortButton"><span class="switch"></span><span>Akıllı sıralama</span></button>
          <button class="secondary" id="excelButton">Excel indir</button>
        </div>
        <div class="result-list" id="resultList"></div>
        <div class="empty hidden" id="emptyResults"><span>⌕</span><h3>Eşleşen işletme bulunamadı</h3><p>Google ilk 20 sonuç içinde 3,9 puan ve 100 yorum eşiğini geçen bir işletme döndürmedi.</p></div>
      </section>
    </section>
  </main>

  <aside class="history-drawer" id="historyDrawer" aria-hidden="true">
    <div class="drawer-header"><div><span class="card-kicker">Hesabınız</span><h2>Geçmiş aramalar</h2></div><button class="icon-button" id="closeHistory" aria-label="Kapat">×</button></div>
    <div id="historyList" class="history-list"></div>
  </aside>
  <div class="backdrop hidden" id="backdrop"></div>

  <dialog id="authDialog" class="modal auth-modal">
    <button class="dialog-close" data-close-dialog aria-label="Kapat">×</button>
    <span class="card-kicker">Mekân Bul</span><h2 id="authTitle">Hesabınıza giriş yapın</h2>
    <button class="google-button" id="googleButton"><span>G</span> Google ile devam et</button>
    <div class="divider"><span>veya e-posta ile</span></div>
    <form id="authForm">
      <div class="field"><label for="emailInput">E-posta</label><input type="email" id="emailInput" autocomplete="email" required></div>
      <div class="field"><label for="passwordInput">Şifre</label><input type="password" id="passwordInput" minlength="6" autocomplete="current-password" required></div>
      <p class="form-error hidden" id="authError"></p>
      <button class="primary full" id="emailAuthButton" type="submit">Giriş yap</button>
    </form>
    <button class="auth-switch" id="authSwitch">Hesabınız yok mu? <b>Üye olun</b></button>
  </dialog>

  <dialog id="discrepancyDialog" class="modal discrepancy-modal">
    <span class="warning-icon">!</span><h2>Konumlar uyuşmuyor</h2><p id="discrepancyText"></p>
    <div class="dialog-actions">
      <button class="primary" id="useTypedButton">Yazdığım konumda ara</button>
      <button class="secondary" id="useSelectedButton">Seçtiğim konumda ara</button>
      <button class="text-button" id="cancelDiscrepancy">Vazgeç</button>
    </div>
  </dialog>

  <div class="toast hidden" id="toast" role="status"></div>
`;

const $ = (selector) => document.querySelector(selector);
const elements = {
  authGate: $('#authGate'), searchShell: $('#searchShell'), authButton: $('#authButton'), gateAuthButton: $('#gateAuthButton'),
  profileButton: $('#profileButton'), profileMenu: $('#profileMenu'), avatar: $('#avatar'), historyButton: $('#historyButton'),
  city: $('#citySelect'), district: $('#districtSelect'), allCity: $('#allCityCheck'), searchInput: $('#searchInput'),
  searchForm: $('#searchForm'), searchButton: $('#searchButton'), locationStatus: $('#locationStatus'), locationFallback: $('#locationFallback'),
  resultsSection: $('#resultsSection'), resultList: $('#resultList'), emptyResults: $('#emptyResults'), stats: $('#stats'),
  historyDrawer: $('#historyDrawer'), historyList: $('#historyList'), backdrop: $('#backdrop'), authDialog: $('#authDialog'),
  discrepancyDialog: $('#discrepancyDialog'), toast: $('#toast')
};

let authMode = 'login';
let toastTimer;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function normalize(value = '') {
  return String(value).trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.remove('hidden');
  toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 4200);
}

function selectedCost() {
  if (!state.allCity) return 1;
  const city = normalize(state.city);
  if (city === 'istanbul') return 5;
  if (['ankara', 'izmir', 'bursa'].includes(city)) return 3;
  return 2;
}

function updateCost() {
  const cost = selectedCost();
  if (!state.profile) {
    $('#costNote').textContent = state.profileError ? 'Kredi bilgisi yüklenemedi · sayfayı yenileyin' : 'Kredi bilgisi yükleniyor…';
  } else {
    $('#costNote').textContent = `Bu arama ${cost} kredi kullanır`;
  }
  $('#allCityCost').textContent = state.city ? `${state.city} genelinde ${cost} kredi` : 'Seçilen şehre göre 2–5 kredi';
  elements.searchButton.disabled = !state.profile || state.profile.creditsRemaining < cost;
}

function fillCities() {
  elements.city.insertAdjacentHTML('beforeend', locations.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join(''));
}

function fillDistricts(city, preferred = '') {
  const province = locations.find((item) => item.name === city);
  elements.district.innerHTML = '<option value="">İlçe seçin</option>' + (province?.districts ?? [])
    .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
  elements.district.disabled = !province || state.allCity;
  if (preferred && province?.districts.some((item) => item.name === preferred)) elements.district.value = preferred;
  state.district = elements.district.value;
}

function findMentionedLocation(queryText) {
  const haystack = ` ${normalize(queryText)} `;
  const candidates = locations.flatMap((province) => [
    { name: province.name, city: province.name, district: null },
    ...province.districts.map((district) => ({ name: district.name, city: province.name, district: district.name }))
  ]);
  const matches = candidates.filter((item) => haystack.includes(` ${normalize(item.name)} `)).sort((a, b) => b.name.length - a.name.length);
  if (!matches.length) return null;
  const sameName = matches.filter((item) => normalize(item.name) === normalize(matches[0].name));
  return sameName.find((item) => !item.district) || (sameName.length === 1 ? sameName[0] : sameName.find((item) => normalize(item.city) === normalize(state.city))) || null;
}

function locationConflicts(mentioned) {
  if (!mentioned) return false;
  if (normalize(mentioned.city) !== normalize(state.city)) return true;
  return !state.allCity && mentioned.district && normalize(mentioned.district) !== normalize(state.district);
}

function askDiscrepancy(mentioned) {
  const selected = state.allCity ? state.city : (state.locationLabel || state.district);
  $('#discrepancyText').textContent = `“${mentioned.name}” yazdınız ama arama konumu olarak “${selected}” seçtiniz. Nerede arayalım?`;
  elements.discrepancyDialog.showModal();
  return new Promise((resolve) => {
    const finish = (choice) => { elements.discrepancyDialog.close(); resolve(choice); };
    $('#useTypedButton').onclick = () => finish(true);
    $('#useSelectedButton').onclick = () => finish(false);
    $('#cancelDiscrepancy').onclick = () => finish(null);
    elements.discrepancyDialog.oncancel = (event) => { event.preventDefault(); finish(null); };
  });
}

function setLoading(loading) {
  elements.searchButton.disabled = loading;
  elements.searchButton.classList.toggle('loading', loading);
  elements.searchButton.querySelector('span').textContent = loading ? 'Mekânlar aranıyor' : 'Aramayı başlat';
}

function sortedResults() {
  return [...state.results].sort(state.smartSort
    ? (a, b) => (b.reviews * b.rating) - (a.reviews * a.rating)
    : (a, b) => b.rating - a.rating || b.reviews - a.reviews);
}

function renderResults() {
  const results = sortedResults();
  elements.resultsSection.classList.remove('hidden');
  $('#resultsTitle').textContent = state.allCity ? `${state.city} genelindeki mekânlar` : `${state.district || state.city} çevresindeki mekânlar`;
  elements.stats.innerHTML = `
    <div><span>API sonucu</span><strong>${state.totalFound}</strong></div>
    <div><span>Eşiği geçen</span><strong>${results.length}</strong></div>
    <div><span>Ortalama puan</span><strong>${results.length ? (results.reduce((sum, item) => sum + item.rating, 0) / results.length).toFixed(1) : '—'}</strong></div>
    <div><span>Ortalama yorum</span><strong>${results.length ? Math.round(results.reduce((sum, item) => sum + item.reviews, 0) / results.length).toLocaleString('tr-TR') : '—'}</strong></div>`;
  elements.emptyResults.classList.toggle('hidden', results.length > 0);
  elements.resultList.classList.toggle('hidden', results.length === 0);
  elements.resultList.innerHTML = results.map((place, index) => `
    <article class="place-card">
      <span class="rank">${String(index + 1).padStart(2, '0')}</span>
      <div class="place-copy"><h3>${escapeHtml(place.name)}</h3><p>${escapeHtml(place.address)}</p>
        <a class="maps-link" href="${escapeHtml(place.mapsUrl)}" target="_blank" rel="noopener noreferrer">Haritalarda aç <span>↗</span></a>
      </div>
      <div class="place-score"><strong>★ ${Number(place.rating).toFixed(1)}</strong><span>${Number(place.reviews).toLocaleString('tr-TR')} yorum</span></div>
    </article>`).join('');
  elements.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function performSearch(useTypedLocation = false) {
  const requestId = crypto.randomUUID();
  setLoading(true);
  try {
    const response = await searchPlaces({
      requestId,
      query: elements.searchInput.value.trim(),
      city: state.city,
      district: state.district,
      allCity: state.allCity,
      useTypedLocation
    });
    state.results = response.data.results;
    state.totalFound = response.data.totalFound;
    renderResults();
    showToast(`${response.data.cost} kredi kullanıldı.`, 'success');
  } catch (error) {
    const message = error.code?.includes('resource-exhausted') ? 'Bu arama için yeterli krediniz yok.' : (error.message || 'Arama tamamlanamadı.');
    showToast(message, 'error');
  } finally {
    setLoading(false);
    updateCost();
  }
}

async function requestDeviceLocation() {
  if (!navigator.geolocation) {
    showLocationFallback('Tarayıcınız konum erişimini desteklemiyor.');
    return;
  }
  elements.locationStatus.classList.remove('hidden');
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    try {
      const response = await resolveLocation({ latitude: coords.latitude, longitude: coords.longitude });
      const location = response.data;
      if (location.outsideTurkey || !location.city) {
        showLocationFallback('Türkiye dışındaki aramalar için il ve ilçe seçin.');
        return;
      }
      state.city = location.city;
      state.locationLabel = location.label || location.district || location.city;
      elements.city.value = state.city;
      fillDistricts(state.city, location.district || '');
      state.district = elements.district.value;
      elements.locationStatus.innerHTML = `<div class="status-copy"><span class="pulse ok"></span><div><strong>${escapeHtml(state.locationLabel)}</strong><small>Konumunuz kullanılıyor · ${escapeHtml(state.city)}</small></div></div><button class="text-button" id="changeLocation">Değiştir</button>`;
      $('#changeLocation').onclick = () => { elements.locationFallback.classList.remove('hidden'); elements.city.focus(); };
      if (!state.district) elements.locationFallback.classList.remove('hidden');
      updateCost();
    } catch (error) {
      showLocationFallback(error.message || 'Konumunuz adres olarak çözümlenemedi.');
    }
  }, (error) => showLocationFallback(
    error.code === error.PERMISSION_DENIED ? 'Konum izni verilmedi.' : 'Cihaz konumu alınamadı.',
    error.code === error.PERMISSION_DENIED
  ), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

function showLocationFallback(detail, permissionDenied = false) {
  elements.locationStatus.classList.add('hidden');
  elements.locationFallback.classList.remove('hidden');
  $('#locationFallbackTitle').textContent = permissionDenied ? 'Konum izni verilmediği için' : 'Konum otomatik belirlenemedi';
  elements.locationFallback.querySelector('p').textContent = `${detail} Arama bölgesini il ve ilçe olarak seçin.`;
}

function avatarMarkup(user) {
  if (user.photoURL) return `<img src="${escapeHtml(user.photoURL)}" alt="">`;
  return escapeHtml((user.email || '?').charAt(0).toLocaleUpperCase('tr-TR'));
}

function renderProfile() {
  const user = state.user;
  elements.avatar.innerHTML = avatarMarkup(user);
  $('#profileName').textContent = user.displayName || 'Hesabım';
  $('#profileEmail').textContent = user.email || '';
  $('#profileUid').textContent = user.uid;
  const credits = state.profile?.creditsRemaining;
  $('#menuCredits').textContent = Number.isFinite(credits) ? `${credits} kredi` : '—';
  updateCost();
}

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.innerHTML = '<div class="drawer-empty">Henüz tamamlanmış bir aramanız yok.</div>';
    return;
  }
  elements.historyList.innerHTML = state.history.map((item) => {
    const date = item.createdAt?.toDate?.();
    return `<button class="history-item" data-id="${escapeHtml(item.id)}"><span><b>${escapeHtml(item.query)}</b><small>${escapeHtml(item.allCity ? `${item.city} · tüm şehir` : `${item.district}, ${item.city}`)}</small></span><span><b>${item.cost} kredi</b><small>${date ? date.toLocaleDateString('tr-TR') : ''}</small></span></button>`;
  }).join('');
  elements.historyList.querySelectorAll('[data-id]').forEach((button) => button.addEventListener('click', () => {
    const item = state.history.find((entry) => entry.id === button.dataset.id);
    if (!item?.results) return;
    state.city = item.city; state.district = item.district || ''; state.allCity = item.allCity;
    state.results = item.results; state.totalFound = item.totalFound || item.results.length;
    elements.searchInput.value = item.query; elements.city.value = state.city; fillDistricts(state.city, state.district);
    elements.allCity.checked = state.allCity; elements.district.disabled = state.allCity; renderResults(); closeHistory();
  }));
}

function subscribeToAccount(user) {
  state.unsubscribeProfile?.(); state.unsubscribeHistory?.();
  state.unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
    state.profileError = false; state.profile = snapshot.exists() ? snapshot.data() : null; renderProfile();
  }, () => { state.profileError = true; state.profile = null; updateCost(); });
  const historyQuery = query(collection(db, 'users', user.uid, 'searches'), orderBy('createdAt', 'desc'), limit(30));
  state.unsubscribeHistory = onSnapshot(historyQuery, (snapshot) => {
    state.history = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).filter((item) => item.status === 'completed');
    renderHistory();
  }, () => { elements.historyList.innerHTML = '<div class="drawer-empty">Geçmiş şu anda yüklenemiyor.</div>'; });
}

function openHistory() {
  state.historyOpen = true; elements.historyDrawer.classList.add('open'); elements.historyDrawer.setAttribute('aria-hidden', 'false'); elements.backdrop.classList.remove('hidden');
}
function closeHistory() {
  state.historyOpen = false; elements.historyDrawer.classList.remove('open'); elements.historyDrawer.setAttribute('aria-hidden', 'true'); elements.backdrop.classList.add('hidden');
}

function openAuth() { elements.authDialog.showModal(); }
function authMessage(code) {
  const messages = {
    'auth/invalid-credential': 'E-posta veya şifre hatalı.', 'auth/email-already-in-use': 'Bu e-posta zaten kullanılıyor.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.', 'auth/invalid-email': 'Geçerli bir e-posta girin.',
    'auth/popup-closed-by-user': 'Google giriş penceresi kapatıldı.'
  };
  return messages[code] || 'Giriş işlemi tamamlanamadı.';
}

fillCities();
elements.authButton.onclick = openAuth; elements.gateAuthButton.onclick = openAuth;
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.onclick = () => elements.authDialog.close());
$('#authSwitch').onclick = () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  $('#authTitle').textContent = authMode === 'login' ? 'Hesabınıza giriş yapın' : 'Ücretsiz hesabınızı oluşturun';
  $('#emailAuthButton').textContent = authMode === 'login' ? 'Giriş yap' : 'Üye ol';
  $('#authSwitch').innerHTML = authMode === 'login' ? 'Hesabınız yok mu? <b>Üye olun</b>' : 'Zaten hesabınız var mı? <b>Giriş yapın</b>';
};
$('#googleButton').onclick = async () => {
  try { await signInWithPopup(auth, googleProvider); elements.authDialog.close(); } catch (error) { $('#authError').textContent = authMessage(error.code); $('#authError').classList.remove('hidden'); }
};
$('#authForm').onsubmit = async (event) => {
  event.preventDefault(); $('#authError').classList.add('hidden');
  try {
    const email = $('#emailInput').value.trim(); const password = $('#passwordInput').value;
    if (authMode === 'login') await signInWithEmailAndPassword(auth, email, password);
    else await createUserWithEmailAndPassword(auth, email, password);
    elements.authDialog.close();
  } catch (error) { $('#authError').textContent = authMessage(error.code); $('#authError').classList.remove('hidden'); }
};

elements.city.onchange = () => { state.city = elements.city.value; state.locationLabel = ''; fillDistricts(state.city); updateCost(); };
elements.district.onchange = () => { state.district = elements.district.value; state.locationLabel = ''; };
elements.allCity.onchange = () => {
  state.allCity = elements.allCity.checked; elements.district.disabled = state.allCity || !state.city;
  elements.district.required = !state.allCity; updateCost();
};
elements.searchForm.onsubmit = async (event) => {
  event.preventDefault();
  if (!state.city || (!state.allCity && !state.district)) { showToast('Lütfen il ve ilçe seçin.', 'error'); return; }
  if (!state.profile) { showToast('Kredi bilgisi henüz yüklenmedi. Sayfayı yenileyip tekrar deneyin.', 'error'); return; }
  const mentioned = findMentionedLocation(elements.searchInput.value);
  let useTypedLocation = false;
  if (locationConflicts(mentioned)) {
    const choice = await askDiscrepancy(mentioned);
    if (choice === null) return;
    useTypedLocation = choice;
  }
  await performSearch(useTypedLocation);
};

$('#sortButton').onclick = () => { state.smartSort = !state.smartSort; $('#sortButton').classList.toggle('active', state.smartSort); renderResults(); };
$('#newSearchButton').onclick = () => { elements.searchInput.value = ''; elements.searchInput.focus(); elements.searchForm.scrollIntoView({ behavior: 'smooth' }); };
$('#excelButton').onclick = async () => {
  if (!state.results.length) return;
  const XLSX = await import('xlsx');
  const rows = sortedResults().map((item, index) => ({ '#': index + 1, 'İşletme Adı': item.name, Puan: item.rating, 'Yorum Sayısı': item.reviews, Adres: item.address, 'Google Maps': item.mapsUrl }));
  const sheet = XLSX.utils.json_to_sheet(rows); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'İşletmeler'); XLSX.writeFile(book, 'mekanlar.xlsx');
};
elements.historyButton.onclick = openHistory; $('#closeHistory').onclick = closeHistory; elements.backdrop.onclick = closeHistory;
elements.profileButton.onclick = () => elements.profileMenu.classList.toggle('hidden');
$('#logoutButton').onclick = () => signOut(auth);
$('#copyUserId').onclick = async () => {
  if (!state.user?.uid) return;
  await navigator.clipboard.writeText(state.user.uid);
  showToast('Kullanıcı ID kopyalandı.', 'success');
};
$('#retryLocation').onclick = requestDeviceLocation;
$('#themeButton').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme; localStorage.setItem('theme', theme);
  $('#themeButton').textContent = theme === 'dark' ? 'Gündüz moduna geç' : 'Gece moduna geç';
};

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (!user) {
    state.unsubscribeProfile?.(); state.unsubscribeHistory?.(); state.profile = null;
    elements.authGate.classList.remove('hidden'); elements.searchShell.classList.add('hidden'); elements.authButton.classList.remove('hidden');
    elements.profileButton.classList.add('hidden'); elements.historyButton.classList.add('hidden'); closeHistory(); return;
  }
  elements.authGate.classList.add('hidden'); elements.searchShell.classList.remove('hidden'); elements.authButton.classList.add('hidden');
  elements.profileButton.classList.remove('hidden'); elements.historyButton.classList.remove('hidden'); renderProfile();
  state.profileError = false; updateCost();
  try { await ensureProfile(); subscribeToAccount(user); } catch {
    state.profileError = true; updateCost(); showToast('Profil ve kredi bilgisi hazırlanamadı. Sayfayı yenileyin.', 'error');
  }
  if (!sessionStorage.getItem('location-requested')) { sessionStorage.setItem('location-requested', '1'); requestDeviceLocation(); }
});
