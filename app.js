// ===================================================================
// HUM — application entry point
// ===================================================================
// This file contains ALL application JavaScript in one place, on
// purpose: storage, i18n, auth, rendering, and UI wiring all live
// here as clearly-labeled sections instead of separate modules.
// There are no import/export statements anywhere in this file or in
// index.html — it's loaded as a single plain <script src="js/app.js">.
// ===================================================================

/* ===================================================================
   SECTION: LOCALSTORAGE LAYER
   All keys are namespaced under "hum_" so the app never collides with
   other data on the same origin. This is the single place that talks
   to localStorage; everything else goes through here, which makes it
   easy to later swap in a real backend/API.
=================================================================== */
const KEYS = {
  USERS:'hum_users',
  SESSION:'hum_session',
  LANG:'hum_lang',
  THEME:'hum_theme',
  MESSAGES:'hum_messages'
};

function getItem(key, fallback = null){
  try{
    const raw = localStorage.getItem(key);
    if(raw == null) return fallback;
    return JSON.parse(raw);
  }catch(e){
    return fallback;
  }
}

function setItem(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  }catch(e){
    console.error('HUM storage error:', e);
    return false;
  }
}

function removeItem(key){
  try{ localStorage.removeItem(key); }catch(e){ /* noop */ }
}

/* ---------------- Users ---------------- */

function getUsers(){
  return getItem(KEYS.USERS, []);
}

function saveUsers(users){
  return setItem(KEYS.USERS, users);
}

function findUserByUsername(username){
  if(!username) return null;
  const lower = username.toLowerCase();
  return getUsers().find(u => u.username.toLowerCase() === lower) || null;
}

function upsertUser(user){
  const users = getUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if(idx === -1) users.push(user);
  else users[idx] = user;
  saveUsers(users);
}

function hasStoredLang(){
  return localStorage.getItem(KEYS.LANG) !== null;
}

/* ---------------- Session ---------------- */

function getSession(){
  return getItem(KEYS.SESSION, null); // username string
}

function setSession(username){
  setItem(KEYS.SESSION, username);
}

function clearSession(){
  removeItem(KEYS.SESSION);
}

/* ---------------- Messages / Conversations ----------------
   Stored as: { [conversationId]: { participants:[usernameA,usernameB], messages:[{id,from,text,ts}] } }
   conversationId is a stable, order-independent key for a pair of users,
   so "A talks to B" and "B talks to A" always resolve to the same
   conversation, and a conversation between A and C never touches it. */

function conversationId(usernameA, usernameB){
  return [String(usernameA).toLowerCase(), String(usernameB).toLowerCase()].sort().join('::');
}

function getMessagesStore(){
  return getItem(KEYS.MESSAGES, {});
}

function saveMessagesStore(store){
  setItem(KEYS.MESSAGES, store);
}

function getConversationMessages(convId){
  const store = getMessagesStore();
  const conv = store[convId];
  return conv ? conv.messages : [];
}

function addMessage(usernameA, usernameB, fromUsername, text){
  const convId = conversationId(usernameA, usernameB);
  const store = getMessagesStore();
  if(!store[convId]){
    store[convId] = { participants:[usernameA, usernameB], messages:[] };
  }
  const message = { id: genId(), from: fromUsername, text, ts: new Date().toISOString() };
  store[convId].messages.push(message);
  saveMessagesStore(store);
  return message;
}

// Returns this user's conversations that have at least one message,
// each paired with its other participant and most recent message,
// sorted with the most recently active conversation first.
function getUserConversations(username){
  const lower = String(username).toLowerCase();
  const store = getMessagesStore();
  return Object.keys(store)
    .map(id => store[id])
    .filter(conv => conv.messages.length && conv.participants.some(p => p.toLowerCase() === lower))
    .map(conv => {
      const otherUsername = conv.participants.find(p => p.toLowerCase() !== lower) || conv.participants[0];
      return { otherUsername, lastMessage: conv.messages[conv.messages.length - 1] };
    })
    .sort((a, b) => new Date(b.lastMessage.ts) - new Date(a.lastMessage.ts));
}

/* ===================================================================
   SECTION: LOCALIZATION (i18n)
   Clean, expandable structure: translations[lang][section][key]
=================================================================== */

const translations = {
  en: {
    common:{
      username:'Username', usernamePlaceholder:'yourname',
      password:'Password', passwordPlaceholder:'••••••••',
      confirmPassword:'Confirm password',
      displayName:'Display name', displayNamePlaceholder:'Aziza Karimova',
      bio:'About', bioPlaceholder:'Say something about yourself',
      show:'Show', hide:'Hide', cancel:'Cancel', saveChanges:'Save changes',
      close:'Close', back:'Back', avatarTooLarge:'Image is too large (max 1.5MB).'
    },
    langScreen:{
      title:'Choose your language', subtitle:'You can change this anytime in Settings.'
    },
    auth:{
      showcase:{
        title:'Every conversation has a frequency.',
        body:"Find people, build your profile, and get ready to talk — HUM keeps the signal clean and the noise out.",
        point1:'Search people by name or @username',
        point2:"A profile that's actually yours",
        point3:'Works in English, Русский and O‘zbek'
      },
      tabs:{login:'Log in', register:'Create account'},
      login:{
        title:'Welcome back', subtitle:'Log in to pick up where you left off.',
        submit:'Log in', switchPrompt:'No account yet?', switchAction:'Create one',
        errorInvalid:'Username or password is incorrect.'
      },
      register:{
        title:'Set your frequency', subtitle:"A few details and you're in.",
        usernameHint:'3–20 characters: letters, numbers, underscore.',
        passwordHint:'At least 6 characters.',
        submit:'Create account', switchPrompt:'Already have an account?', switchAction:'Log in'
      },
      validation:{
        required:'This field is required.',
        usernameFormat:'Use 3–20 letters, numbers or underscores.',
        usernameTaken:'This username is already taken.',
        passwordShort:'Password must be at least 6 characters.',
        passwordMismatch:"Passwords don't match.",
        displayNameShort:'Enter a display name.'
      }
    },
    nav:{chats:'Chats', people:'People', profile:'Profile', settings:'Settings', logout:'Log out'},
    chats:{
      title:'Chats', emptyTitle:"It's quiet in here",
      emptyBody:'Real-time messaging is on the way. For now, find people and get your profile ready.',
      emptyAction:'Find people'
    },
    people:{
      title:'Find people', searchPlaceholder:'Search by name or @username',
      empty:'No one matches that search.', hint:'Search by display name or @username.',
      view:'View', you:'You'
    },
    welcome:{title:'Welcome to HUM', body:'Search for someone on the left, or open your profile to make it your own.'},
    profile:{
      title:'Your profile', edit:'Edit profile', backToView:'Done',
      avatar:{upload:'Upload photo', remove:'Remove'},
      joined:'Joined', noBio:'No bio yet.',
      saved:'Profile updated.', message:'Message', comingSoon:'Real-time messaging is coming in a future version of HUM.'
    },
    chat:{
      emptyTitle:'Start the conversation', inputPlaceholder:'Message', send:'Send',
      youPrefix:'You: '
    },
    settings:{
      title:'Settings',
      language:'Language', languageHint:'Choose the language HUM speaks to you in.',
      appearance:'Appearance', appearanceHint:'Switch between a dark or light signal.',
      dark:'Dark', light:'Light',
      account:'Account', accountHint:'Signed in as {username}.'
    },
    toast:{
      loggedIn:'Welcome back, {name}.', accountCreated:'Account created. Welcome, {name}!',
      loggedOut:'Logged out.', profileSaved:'Profile updated.', langChanged:'Language switched.'
    }
  },

  ru: {
    common:{
      username:'Имя пользователя', usernamePlaceholder:'yourname',
      password:'Пароль', passwordPlaceholder:'••••••••',
      confirmPassword:'Подтвердите пароль',
      displayName:'Отображаемое имя', displayNamePlaceholder:'Азиза Каримова',
      bio:'О себе', bioPlaceholder:'Расскажите немного о себе',
      show:'Показать', hide:'Скрыть', cancel:'Отмена', saveChanges:'Сохранить',
      close:'Закрыть', back:'Назад', avatarTooLarge:'Изображение слишком большое (макс. 1.5МБ).'
    },
    langScreen:{
      title:'Выберите язык', subtitle:'Вы всегда сможете изменить его в настройках.'
    },
    auth:{
      showcase:{
        title:'У каждого разговора своя частота.',
        body:'Находите людей, создавайте профиль и будьте готовы к общению — HUM убирает лишний шум.',
        point1:'Поиск людей по имени или @username',
        point2:'Профиль, который действительно ваш',
        point3:'Работает на English, Русском и O‘zbek'
      },
      tabs:{login:'Войти', register:'Создать аккаунт'},
      login:{
        title:'С возвращением', subtitle:'Войдите, чтобы продолжить с того же места.',
        submit:'Войти', switchPrompt:'Ещё нет аккаунта?', switchAction:'Создать',
        errorInvalid:'Неверное имя пользователя или пароль.'
      },
      register:{
        title:'Настройте свою частоту', subtitle:'Ещё пара деталей — и вы внутри.',
        usernameHint:'3–20 символов: буквы, цифры, подчёркивание.',
        passwordHint:'Минимум 6 символов.',
        submit:'Создать аккаунт', switchPrompt:'Уже есть аккаунт?', switchAction:'Войти'
      },
      validation:{
        required:'Это поле обязательно.',
        usernameFormat:'Используйте 3–20 букв, цифр или подчёркиваний.',
        usernameTaken:'Это имя пользователя уже занято.',
        passwordShort:'Пароль должен содержать минимум 6 символов.',
        passwordMismatch:'Пароли не совпадают.',
        displayNameShort:'Введите отображаемое имя.'
      }
    },
    nav:{chats:'Чаты', people:'Люди', profile:'Профиль', settings:'Настройки', logout:'Выйти'},
    chats:{
      title:'Чаты', emptyTitle:'Здесь пока тихо',
      emptyBody:'Обмен сообщениями в реальном времени скоро появится. А пока — найдите людей и настройте профиль.',
      emptyAction:'Найти людей'
    },
    people:{
      title:'Найти людей', searchPlaceholder:'Поиск по имени или @username',
      empty:'Никого не найдено.', hint:'Ищите по имени или @username.',
      view:'Открыть', you:'Вы'
    },
    welcome:{title:'Добро пожаловать в HUM', body:'Найдите кого-нибудь слева или откройте свой профиль, чтобы настроить его.'},
    profile:{
      title:'Ваш профиль', edit:'Редактировать', backToView:'Готово',
      avatar:{upload:'Загрузить фото', remove:'Удалить'},
      joined:'Регистрация', noBio:'Пока нет описания.',
      saved:'Профиль обновлён.', message:'Написать', comingSoon:'Обмен сообщениями появится в будущей версии HUM.'
    },
    chat:{
      emptyTitle:'Начните разговор', inputPlaceholder:'Сообщение', send:'Отправить',
      youPrefix:'Вы: '
    },
    settings:{
      title:'Настройки',
      language:'Язык', languageHint:'Выберите язык интерфейса HUM.',
      appearance:'Внешний вид', appearanceHint:'Переключение между тёмным и светлым режимом.',
      dark:'Тёмная', light:'Светлая',
      account:'Аккаунт', accountHint:'Вы вошли как {username}.'
    },
    toast:{
      loggedIn:'С возвращением, {name}.', accountCreated:'Аккаунт создан. Добро пожаловать, {name}!',
      loggedOut:'Вы вышли из аккаунта.', profileSaved:'Профиль обновлён.', langChanged:'Язык изменён.'
    }
  },

  uz: {
    common:{
      username:'Foydalanuvchi nomi', usernamePlaceholder:'yourname',
      password:'Parol', passwordPlaceholder:'••••••••',
      confirmPassword:'Parolni tasdiqlang',
      displayName:'Ko‘rinadigan ism', displayNamePlaceholder:'Aziza Karimova',
      bio:'Men haqimda', bioPlaceholder:'O‘zingiz haqingizda yozing',
      show:'Ko‘rsatish', hide:'Yashirish', cancel:'Bekor qilish', saveChanges:'Saqlash',
      close:'Yopish', back:'Orqaga', avatarTooLarge:'Rasm hajmi juda katta (maks. 1.5MB).'
    },
    langScreen:{
      title:'Tilni tanlang', subtitle:'Buni istalgan vaqtda Sozlamalarda o‘zgartirishingiz mumkin.'
    },
    auth:{
      showcase:{
        title:'Har bir suhbatning o‘z chastotasi bor.',
        body:'Odamlarni toping, profilingizni yarating va muloqotga tayyor bo‘ling — HUM ortiqcha shovqinni olib tashlaydi.',
        point1:'Odamlarni ism yoki @username orqali qidiring',
        point2:'Chindan ham sizga tegishli profil',
        point3:'English, Русский va O‘zbek tilida ishlaydi'
      },
      tabs:{login:'Kirish', register:'Ro‘yxatdan o‘tish'},
      login:{
        title:'Xush kelibsiz', subtitle:'Qolgan joydan davom eting.',
        submit:'Kirish', switchPrompt:'Hali akkountingiz yo‘qmi?', switchAction:'Yaratish',
        errorInvalid:'Foydalanuvchi nomi yoki parol noto‘g‘ri.'
      },
      register:{
        title:'Chastotangizni sozlang', subtitle:'Bir necha ma’lumot — va tayyor.',
        usernameHint:'3–20 ta belgi: harflar, raqamlar, pastki chiziq.',
        passwordHint:'Kamida 6 ta belgi.',
        submit:'Akkount yaratish', switchPrompt:'Akkountingiz bormi?', switchAction:'Kirish'
      },
      validation:{
        required:'Ushbu maydon majburiy.',
        usernameFormat:'3–20 ta harf, raqam yoki pastki chiziqdan foydalaning.',
        usernameTaken:'Bu foydalanuvchi nomi allaqachon band.',
        passwordShort:'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.',
        passwordMismatch:'Parollar mos kelmadi.',
        displayNameShort:'Ko‘rinadigan ism kiriting.'
      }
    },
    nav:{chats:'Suhbatlar', people:'Odamlar', profile:'Profil', settings:'Sozlamalar', logout:'Chiqish'},
    chats:{
      title:'Suhbatlar', emptyTitle:'Bu yerda hozircha jim',
      emptyBody:'Real vaqtda xabar almashish tez orada qo‘shiladi. Hozircha odamlarni toping va profilingizni tayyorlang.',
      emptyAction:'Odamlarni topish'
    },
    people:{
      title:'Odamlarni topish', searchPlaceholder:'Ism yoki @username orqali qidiring',
      empty:'Hech kim topilmadi.', hint:'Ism yoki @username orqali qidiring.',
      view:'Ko‘rish', you:'Siz'
    },
    welcome:{title:'HUM ga xush kelibsiz', body:'Chapdan birovni qidiring yoki profilingizni o‘zingizga moslashtiring.'},
    profile:{
      title:'Sizning profilingiz', edit:'Tahrirlash', backToView:'Tayyor',
      avatar:{upload:'Rasm yuklash', remove:'O‘chirish'},
      joined:'Ro‘yxatdan o‘tgan', noBio:'Hozircha tavsif yo‘q.',
      saved:'Profil yangilandi.', message:'Xabar yozish', comingSoon:'Real vaqtda xabar almashish HUM ning keyingi versiyasida qo‘shiladi.'
    },
    chat:{
      emptyTitle:'Suhbatni boshlang', inputPlaceholder:'Xabar', send:'Yuborish',
      youPrefix:'Siz: '
    },
    settings:{
      title:'Sozlamalar',
      language:'Til', languageHint:'HUM siz bilan gaplashadigan tilni tanlang.',
      appearance:'Ko‘rinish', appearanceHint:'Tungi yoki kunduzgi rejim orasida almashing.',
      dark:'Tungi', light:'Kunduzgi',
      account:'Akkount', accountHint:'Siz {username} sifatida kirdingiz.'
    },
    toast:{
      loggedIn:'Xush kelibsiz, {name}.', accountCreated:'Akkount yaratildi. Xush kelibsiz, {name}!',
      loggedOut:'Tizimdan chiqdingiz.', profileSaved:'Profil yangilandi.', langChanged:'Til o‘zgartirildi.'
    }
  }
};

let currentLang = getItem(KEYS.LANG, 'en');
if(!translations[currentLang]) currentLang = 'en';

function getLang(){ return currentLang; }

function setLang(lang){
  if(!translations[lang]) return;
  currentLang = lang;
  setItem(KEYS.LANG, lang);
  applyTranslations();
}

function resolve(path, lang){
  const parts = path.split('.');
  let node = translations[lang];
  for(const p of parts){
    if(node == null) return null;
    node = node[p];
  }
  return typeof node === 'string' ? node : null;
}

function t(path, vars){
  let str = resolve(path, currentLang);
  if(str == null) str = resolve(path, 'en');
  if(str == null) return path;
  if(vars){
    Object.keys(vars).forEach(k=>{
      str = str.replace(new RegExp(`{${k}}`,'g'), vars[k]);
    });
  }
  return str;
}

function applyTranslations(root = document){
  root.querySelectorAll('[data-i18n]').forEach(el=>{
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el=>{
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  document.documentElement.lang = currentLang;
  document.querySelectorAll('.lang-pill, .lang-option').forEach(el=>{
    el.classList.toggle('is-active', el.getAttribute('data-lang') === currentLang);
  });
}
/* ===================================================================
   SECTION: UTILITIES
=================================================================== */
function genId(){
  return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

// Simple non-cryptographic hash used ONLY for this local prototype.
// There is no real backend yet, so passwords never leave the browser.
// Swap this for real server-side hashing (bcrypt/argon2) once HUM
// gets an actual authentication API.
function hashPassword(password){
  let hash = 5381;
  for(let i=0;i<password.length;i++){
    hash = ((hash << 5) + hash) + password.charCodeAt(i);
    hash |= 0;
  }
  return 'h' + Math.abs(hash).toString(36) + password.length;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const AVATAR_PALETTE = ['#7c9eff','#f5b942','#4ade80','#ff8b7c','#c792ea','#5ee7d4','#ffa4d8','#8fb8ff'];

function colorForUsername(username){
  let sum = 0;
  for(let i=0;i<username.length;i++) sum += username.charCodeAt(i);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

function initialsFor(displayName){
  if(!displayName) return '?';
  const parts = displayName.trim().split(/\s+/).slice(0,2);
  return parts.map(p=>p[0]).join('').toUpperCase();
}

// avatar: { type:'upload', data:<dataURL> } | { type:'generated' }
// Builds/updates an <img> + <span> pair inside `el` so uploaded photos are
// always clipped with object-fit:cover and initials never overflow the circle.
function applyAvatar(el, user){
  let img = el.querySelector('.avatar__img');
  let span = el.querySelector('.avatar__initials');
  if(!img){
    img = document.createElement('img');
    img.className = 'avatar__img';
    img.alt = '';
    img.hidden = true;
    el.appendChild(img);
  }
  if(!span){
    span = document.createElement('span');
    span.className = 'avatar__initials';
    el.appendChild(span);
  }
  if(user.avatar && user.avatar.type === 'upload' && user.avatar.data){
    img.src = user.avatar.data;
    img.hidden = false;
    span.hidden = true;
    el.style.background = 'transparent';
  }else{
    img.hidden = true;
    img.removeAttribute('src');
    span.hidden = false;
    span.textContent = initialsFor(user.displayName);
    el.style.background = colorForUsername(user.username);
  }
}

function debounce(fn, wait = 200){
  let t;
  return (...args)=>{
    clearTimeout(t);
    t = setTimeout(()=>fn(...args), wait);
  };
}

function escapeHtml(str){
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(message, type = 'default'){
  const host = document.getElementById('toastHost');
  if(!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type !== 'default' ? ` toast--${type}` : '');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(()=>{
    el.style.transition = 'opacity .25s ease, transform .25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(()=>el.remove(), 260);
  }, 2600);
}

function readFileAsDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = ()=>reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

function formatDate(iso, lang){
  try{
    const locale = lang === 'ru' ? 'ru-RU' : lang === 'uz' ? 'uz-UZ' : 'en-US';
    return new Date(iso).toLocaleDateString(locale, { year:'numeric', month:'long' });
  }catch(e){
    return iso;
  }
}

// Compact timestamp for chat bubbles and the chats list: just the time
// for messages sent today, otherwise a short date (plus year if it
// wasn't this year), so it never wraps or crowds the layout.
function formatCompactTime(iso, lang){
  try{
    const locale = lang === 'ru' ? 'ru-RU' : lang === 'uz' ? 'uz-UZ' : 'en-US';
    const date = new Date(iso);
    const now = new Date();
    if(date.toDateString() === now.toDateString()){
      return date.toLocaleTimeString(locale, { hour:'2-digit', minute:'2-digit' });
    }
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString(locale, sameYear
      ? { day:'numeric', month:'short' }
      : { day:'numeric', month:'short', year:'numeric' });
  }catch(e){
    return '';
  }
}
/* ===================================================================
   SECTION: AUTHENTICATION (local prototype)
   Structured so the storage calls here are the only thing that need
   to change when this becomes a real backend-backed auth system.
=================================================================== */

function validateRegistration({ displayName, username, password, confirmPassword }){
  const errors = {};

  if(!displayName || !displayName.trim()){
    errors.displayName = t('auth.validation.displayNameShort');
  }

  if(!username || !username.trim()){
    errors.username = t('auth.validation.required');
  }else if(!USERNAME_RE.test(username.trim())){
    errors.username = t('auth.validation.usernameFormat');
  }else if(findUserByUsername(username.trim())){
    errors.username = t('auth.validation.usernameTaken');
  }

  if(!password){
    errors.password = t('auth.validation.required');
  }else if(password.length < 6){
    errors.password = t('auth.validation.passwordShort');
  }

  if(!confirmPassword){
    errors.confirmPassword = t('auth.validation.required');
  }else if(password !== confirmPassword){
    errors.confirmPassword = t('auth.validation.passwordMismatch');
  }

  return errors;
}

function registerUser({ displayName, username, password, bio, avatar }){
  const errors = validateRegistration({ displayName, username, password, confirmPassword: password });
  if(Object.keys(errors).length){
    return { ok:false, errors };
  }

  const user = {
    id: genId(),
    username: username.trim(),
    displayName: displayName.trim(),
    passwordHash: hashPassword(password),
    bio: (bio || '').trim(),
    avatar: avatar || { type:'generated' },
    createdAt: new Date().toISOString()
  };

  upsertUser(user);
  setSession(user.username);
  return { ok:true, user };
}

function loginUser({ username, password }){
  if(!username || !password){
    return { ok:false, error: t('auth.validation.required') };
  }
  const user = findUserByUsername(username.trim());
  if(!user || user.passwordHash !== hashPassword(password)){
    return { ok:false, error: t('auth.login.errorInvalid') };
  }
  setSession(user.username);
  return { ok:true, user };
}

function logoutUser(){
  clearSession();
}

function currentUser(sessionUsername){
  if(!sessionUsername) return null;
  return findUserByUsername(sessionUsername);
}

function updateProfile(currentUsername, updates){
  const user = findUserByUsername(currentUsername);
  if(!user) return { ok:false, errors:{ form: t('auth.login.errorInvalid') } };

  const errors = {};
  const nextDisplayName = (updates.displayName || '').trim();
  const nextUsername = (updates.username || '').trim();

  if(!nextDisplayName){
    errors.displayName = t('auth.validation.displayNameShort');
  }

  if(!nextUsername){
    errors.username = t('auth.validation.required');
  }else if(!USERNAME_RE.test(nextUsername)){
    errors.username = t('auth.validation.usernameFormat');
  }else if(nextUsername.toLowerCase() !== user.username.toLowerCase()){
    const existing = findUserByUsername(nextUsername);
    if(existing) errors.username = t('auth.validation.usernameTaken');
  }

  if(Object.keys(errors).length){
    return { ok:false, errors };
  }

  const usernameChanged = nextUsername.toLowerCase() !== user.username.toLowerCase();

  const updatedUser = {
    ...user,
    displayName: nextDisplayName,
    username: nextUsername,
    bio: (updates.bio || '').trim(),
    avatar: updates.avatar !== undefined ? updates.avatar : user.avatar
  };

  upsertUser(updatedUser);
  if(usernameChanged) setSession(updatedUser.username);

  return { ok:true, user: updatedUser, usernameChanged };
}

function searchUsers(query, excludeUsername){
  const q = (query || '').trim().toLowerCase();
  const users = getUsers();
  return users
    .filter(u => u.username.toLowerCase() !== (excludeUsername || '').toLowerCase())
    .filter(u => !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
    .sort((a,b)=> a.displayName.localeCompare(b.displayName));
}

/* ===================================================================
   SECTION: RENDERING HELPERS (DOM building for dynamic content)
=================================================================== */

function avatarMarkup(user){
  if(user.avatar && user.avatar.type === 'upload' && user.avatar.data){
    return `<img class="avatar__img" src="${user.avatar.data}" alt="">`;
  }
  return `<span class="avatar__initials">${escapeHtml(initialsFor(user.displayName))}</span>`;
}
function avatarBg(user){
  if(user.avatar && user.avatar.type === 'upload' && user.avatar.data) return 'transparent';
  return colorForUsername(user.username);
}

function renderPeopleResults(container, users, { query, selectedUsername }){
  if(!users.length){
    container.innerHTML = `
      <div class="people-results__empty">${query ? escapeHtml(t('people.empty')) : escapeHtml(t('people.hint'))}</div>
    `;
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="result-row${selectedUsername === u.username ? ' is-active' : ''}" data-username="${escapeHtml(u.username)}" role="button" tabindex="0">
      <div class="avatar avatar--online" style="background:${avatarBg(u)}">${avatarMarkup(u)}</div>
      <div class="result-row__info">
        <div class="result-row__name">${escapeHtml(u.displayName)}</div>
        <div class="result-row__handle">@${escapeHtml(u.username)}</div>
      </div>
      <button type="button" class="btn btn--ghost btn--small" data-username="${escapeHtml(u.username)}" data-action="view">${escapeHtml(t('people.view'))}</button>
    </div>
  `).join('');
}

function renderProfileHero(container, user, isSelf){
  const joined = formatDate(user.createdAt, getLang());
  container.innerHTML = `
    <div class="profile-hero">
      <div class="avatar avatar--online" style="width:100px;height:100px;font-size:34px;background:${avatarBg(user)}">${avatarMarkup(user)}</div>
      <h2 class="profile-hero__name">${escapeHtml(user.displayName)}${isSelf ? ` <span style="color:var(--text-faint);font-weight:500;font-size:15px;">(${escapeHtml(t('people.you'))})</span>` : ''}</h2>
      <div class="profile-hero__handle">@${escapeHtml(user.username)}</div>
      <p class="profile-hero__bio">${user.bio ? escapeHtml(user.bio) : `<em style="color:var(--text-faint)">${escapeHtml(t('profile.noBio'))}</em>`}</p>
      ${!isSelf ? `<div class="profile-hero__actions"><button type="button" class="btn btn--primary btn--small" id="btnMessageUser">${escapeHtml(t('profile.message'))}</button></div>` : ''}
    </div>
    <div class="profile-meta">
      <div class="profile-meta__row"><span>${escapeHtml(t('common.username'))}</span><span>@${escapeHtml(user.username)}</span></div>
      <div class="profile-meta__row"><span>${escapeHtml(t('profile.joined'))}</span><span>${escapeHtml(joined)}</span></div>
    </div>
  `;
}

function renderProfileSummary(container, user){
  container.innerHTML = `
    <div class="profile-hero" style="padding:0 0 26px;text-align:left;align-items:flex-start;border-bottom:1px solid var(--border);margin-bottom:22px;">
      <div class="avatar" style="width:84px;height:84px;font-size:28px;margin-bottom:14px;background:${avatarBg(user)}">${avatarMarkup(user)}</div>
      <h2 class="profile-hero__name" style="font-size:21px;">${escapeHtml(user.displayName)}</h2>
      <div class="profile-hero__handle">@${escapeHtml(user.username)}</div>
      <p class="profile-hero__bio" style="margin-top:12px;">${user.bio ? escapeHtml(user.bio) : `<em style="color:var(--text-faint)">${escapeHtml(t('profile.noBio'))}</em>`}</p>
    </div>
  `;
}
function renderChatsListRow(user, lastMessage, meUsername){
  const isOwn = lastMessage.from.toLowerCase() === meUsername.toLowerCase();
  const prefix = isOwn ? t('chat.youPrefix') : '';
  const previewText = (prefix + lastMessage.text).replace(/\s+/g, ' ').trim();
  return `
    <div class="result-row" data-username="${escapeHtml(user.username)}" role="button" tabindex="0">
      <div class="avatar avatar--online" style="background:${avatarBg(user)}">${avatarMarkup(user)}</div>
      <div class="result-row__info">
        <div class="result-row__name">${escapeHtml(user.displayName)}</div>
        <div class="result-row__preview">${escapeHtml(previewText)}</div>
      </div>
      <div class="result-row__time">${escapeHtml(formatCompactTime(lastMessage.ts, getLang()))}</div>
    </div>
  `;
}

// Same empty-state markup that used to be static in index.html for the
// Chats panel, now rendered on demand so the panel can switch between
// this and the real conversation list as messages come and go.
function chatsEmptyStateMarkup(){
  return `
    <div class="empty-state">
      <svg viewBox="0 0 120 90" class="empty-state__art">
        <path d="M10 60c6-30 12 30 20 0s12-45 20 0 12 45 20 0 12-30 20 0 12 30 18 0"/>
      </svg>
      <h3>${escapeHtml(t('chats.emptyTitle'))}</h3>
      <p>${escapeHtml(t('chats.emptyBody'))}</p>
      <button type="button" class="btn btn--primary btn--small" id="emptyToPeople">${escapeHtml(t('chats.emptyAction'))}</button>
    </div>
  `;
}

function renderChatsList(){
  if(!els.chatsListContainer) return;
  const me = currentUser(state.session);
  if(!me){
    els.chatsListContainer.innerHTML = '';
    return;
  }
  const conversations = getUserConversations(me.username);
  if(!conversations.length){
    els.chatsListContainer.innerHTML = chatsEmptyStateMarkup();
    return;
  }
  els.chatsListContainer.innerHTML = conversations
    .map(({ otherUsername, lastMessage }) => {
      const user = findUserByUsername(otherUsername);
      if(!user) return '';
      return renderChatsListRow(user, lastMessage, me.username);
    })
    .join('');
}

function renderChatHeader(user){
  if(!els.chatHeaderAvatar) return;
  els.chatHeaderAvatar.style.background = avatarBg(user);
  els.chatHeaderAvatar.innerHTML = avatarMarkup(user);
  els.chatHeaderName.textContent = user.displayName;
  els.chatHeaderHandle.textContent = '@' + user.username;
}

function renderChatMessages(){
  if(!els.chatMessages) return;
  const me = currentUser(state.session);
  if(!me || !state.activeChatUsername){
    els.chatMessages.innerHTML = '';
    return;
  }
  const messages = getConversationMessages(conversationId(me.username, state.activeChatUsername));
  if(!messages.length){
    els.chatMessages.innerHTML = `<div class="chat-empty">${escapeHtml(t('chat.emptyTitle'))}</div>`;
    return;
  }
  els.chatMessages.innerHTML = messages
    .map((m) => {
      const isOwn = m.from.toLowerCase() === me.username.toLowerCase();
      return `
        <div class="chat-msg ${isOwn ? 'chat-msg--own' : 'chat-msg--theirs'}">
          <div class="chat-msg__bubble">${escapeHtml(m.text)}</div>
          <div class="chat-msg__time">${escapeHtml(formatCompactTime(m.ts, getLang()))}</div>
        </div>
      `;
    })
    .join('');
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

/* ===================================================================
   SECTION: APPLICATION UI — state, elements, event wiring, init
=================================================================== */
const els = {
  langScreen: document.getElementById("langScreen"),
  authScreen: document.getElementById("authScreen"),
  appShell: document.getElementById("appShell"),

  tabLogin: document.getElementById("tabLogin"),
  tabRegister: document.getElementById("tabRegister"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  goRegister: document.getElementById("goRegister"),
  goLogin: document.getElementById("goLogin"),

  navChats: document.getElementById("navChats"),
  navPeople: document.getElementById("navPeople"),
  navProfile: document.getElementById("navProfile"),
  navSettings: document.getElementById("navSettings"),
  navLogout: document.getElementById("navLogout"),

  panelList: document.getElementById("panelList"),
  viewChats: document.getElementById("viewChats"),
  viewPeople: document.getElementById("viewPeople"),
  chatsListContainer: document.getElementById("chatsListContainer"),
  peopleSearchInput: document.getElementById("peopleSearchInput"),
  peopleResults: document.getElementById("peopleResults"),

  panelMain: document.getElementById("panelMain"),
  mainWelcome: document.getElementById("mainWelcome"),
  mainProfileView: document.getElementById("mainProfileView"),
  mainProfileEdit: document.getElementById("mainProfileEdit"),
  mainSettings: document.getElementById("mainSettings"),
  mainChat: document.getElementById("mainChat"),
  chatHeaderInfo: document.getElementById("chatHeaderInfo"),
  chatHeaderAvatar: document.getElementById("chatHeaderAvatar"),
  chatHeaderName: document.getElementById("chatHeaderName"),
  chatHeaderHandle: document.getElementById("chatHeaderHandle"),
  chatMessages: document.getElementById("chatMessages"),
  chatComposerForm: document.getElementById("chatComposerForm"),
  chatInput: document.getElementById("chatInput"),
  chatSendBtn: document.getElementById("chatSendBtn"),

  profileEditToggle: document.getElementById("profileEditToggle"),
  profileSummary: document.getElementById("profileSummary"),
  profileForm: document.getElementById("profileForm"),
  profileCancelEdit: document.getElementById("profileCancelEdit"),
  profileAvatarPreview: document.getElementById("profileAvatarPreview"),
  profileAvatarInput: document.getElementById("profileAvatarInput"),
  profileAvatarClear: document.getElementById("profileAvatarClear"),

  settingsAccountHint: document.getElementById("settingsAccountHint"),
  settingsUsername: document.getElementById("settingsUsername"),
  settingsLogout: document.getElementById("settingsLogout"),
  themeToggle: document.getElementById("themeToggle"),

  appShellRoot: document.getElementById("appShell"),
};

let state = {
  session: getSession(),
  activePanelView: "chats",
  mainView: "welcome",
  viewingUsername: null,
  activeChatUsername: null,
  registerAvatar: { type: "generated" },
  profileEditAvatar: { type: "generated" },
};

/* ================= THEME ================= */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll(".theme-toggle__btn").forEach((b) => {
    b.classList.toggle("is-active", b.getAttribute("data-theme") === theme);
  });
}
function initTheme() {
  const theme = getItem(KEYS.THEME, "dark");
  applyTheme(theme);
}
els.themeToggle &&
  els.themeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (!btn) return;
    const theme = btn.getAttribute("data-theme");
    setItem(KEYS.THEME, theme);
    applyTheme(theme);
  });

/* ================= LANGUAGE ================= */
function wireLangControls() {
  document
    .querySelectorAll(".lang-pill, .lang-option, .lang-choice")
    .forEach((el) => {
      el.addEventListener("click", () => {
        const lang = el.getAttribute("data-lang");
        const isFirstLaunch = el.classList.contains("lang-choice");
        setLang(lang);
        if (isFirstLaunch) {
          els.langScreen.hidden = true;
          els.authScreen.hidden = false;
          showAuthTab("register");
        } else {
          showToast(t("toast.langChanged"));
        }
        refreshDynamicText();
      });
    });
}

function refreshDynamicText() {
  // Re-render any dynamically built content so it reflects the new language.
  if (state.session) {
    const me = currentUser(state.session);
    if (me && state.mainView === "settings")
      updateSettingsAccountHint(me.username);
    if (state.mainView === "profileView" && state.viewingUsername) {
      openProfileView(state.viewingUsername, false);
    }
    if (state.mainView === "chat" && state.activeChatUsername) {
      openChat(state.activeChatUsername, false);
    }
    if (state.activePanelView === "people") {
      runPeopleSearch();
    }
    if (state.activePanelView === "chats") {
      renderChatsList();
    }
  }
}

/* ================= TOGGLE PASSWORD VISIBILITY ================= */
document.querySelectorAll(".field__toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.getAttribute("data-toggle-for"));
    if (!input) return;
    const isPw = input.type === "password";
    input.type = isPw ? "text" : "password";
    btn.textContent = isPw ? t("common.hide") : t("common.show");
  });
});

/* ================= AUTH TABS ================= */
function showAuthTab(tab) {
  const isLogin = tab === "login";
  els.tabLogin.classList.toggle("is-active", isLogin);
  els.tabRegister.classList.toggle("is-active", !isLogin);
  els.tabLogin.setAttribute("aria-selected", String(isLogin));
  els.tabRegister.setAttribute("aria-selected", String(!isLogin));
  els.loginForm.hidden = !isLogin;
  els.registerForm.hidden = isLogin;
}
els.tabLogin.addEventListener("click", () => showAuthTab("login"));
els.tabRegister.addEventListener("click", () => showAuthTab("register"));
els.goRegister.addEventListener("click", () => showAuthTab("register"));
els.goLogin.addEventListener("click", () => showAuthTab("login"));

/* ================= FIELD ERROR HELPERS ================= */
function setFieldError(inputId, message) {
  const errEl = document.getElementById("err-" + inputId);
  const input = document.getElementById(inputId);
  if (errEl) errEl.textContent = message || "";
  if (input) {
    const field = input.closest(".field");
    if (field) field.classList.toggle("field--invalid", !!message);
  }
}
function clearErrors(ids) {
  ids.forEach((id) => setFieldError(id, ""));
}

/* ================= REGISTER AVATAR ================= */
const registerAvatarPreview = document.getElementById("registerAvatarPreview");
const registerAvatarInput = document.getElementById("registerAvatarInput");
const registerAvatarClear = document.getElementById("registerAvatarClear");

function paintAvatarPreview(el, avatarState, displayName, username) {
  applyAvatar(el, {
    avatar: avatarState,
    displayName: displayName || username || "?",
    username: username || "hum",
  });
}

registerAvatarInput.addEventListener("change", async () => {
  const file = registerAvatarInput.files[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    showToast(t("common.avatarTooLarge"), "error");
    registerAvatarInput.value = "";
    return;
  }
  const dataUrl = await readFileAsDataURL(file);
  state.registerAvatar = { type: "upload", data: dataUrl };
  paintAvatarPreview(
    registerAvatarPreview,
    state.registerAvatar,
    document.getElementById("registerDisplayName").value,
    document.getElementById("registerUsername").value,
  );
});
registerAvatarClear.addEventListener("click", () => {
  state.registerAvatar = { type: "generated" };
  registerAvatarInput.value = "";
  paintAvatarPreview(
    registerAvatarPreview,
    state.registerAvatar,
    document.getElementById("registerDisplayName").value,
    document.getElementById("registerUsername").value,
  );
});
["registerDisplayName", "registerUsername"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    if (state.registerAvatar.type === "generated") {
      paintAvatarPreview(
        registerAvatarPreview,
        state.registerAvatar,
        document.getElementById("registerDisplayName").value,
        document.getElementById("registerUsername").value,
      );
    }
  });
});

/* ================= LOGIN SUBMIT ================= */
els.loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  clearErrors(["loginUsername", "loginPassword", "loginForm"]);
  const username = document.getElementById("loginUsername").value;
  const password = document.getElementById("loginPassword").value;

  if (!username.trim()) {
    setFieldError("loginUsername", t("auth.validation.required"));
  }
  if (!password) {
    setFieldError("loginPassword", t("auth.validation.required"));
  }
  if (!username.trim() || !password) return;

  const result = loginUser({ username, password });
  if (!result.ok) {
    setFieldError("loginForm", result.error);
    return;
  }
  onAuthSuccess(
    result.user,
    t("toast.loggedIn", { name: result.user.displayName }),
  );
  els.loginForm.reset();
});

/* ================= REGISTER SUBMIT ================= */
els.registerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const ids = [
    "registerDisplayName",
    "registerUsername",
    "registerPassword",
    "registerConfirmPassword",
    "registerForm",
  ];
  clearErrors(ids);

  const data = {
    displayName: document.getElementById("registerDisplayName").value,
    username: document.getElementById("registerUsername").value,
    password: document.getElementById("registerPassword").value,
    confirmPassword: document.getElementById("registerConfirmPassword").value,
    bio: document.getElementById("registerBio").value,
    avatar: state.registerAvatar,
  };

  const result = registerUser(data);
  if (!result.ok) {
    Object.keys(result.errors).forEach((field) =>
      setFieldError("register" + capitalize(field), result.errors[field]),
    );
    return;
  }
  onAuthSuccess(
    result.user,
    t("toast.accountCreated", { name: result.user.displayName }),
  );
  els.registerForm.reset();
  state.registerAvatar = { type: "generated" };
  paintAvatarPreview(registerAvatarPreview, state.registerAvatar, "", "");
});

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ================= AUTH SUCCESS / LOGOUT ================= */
function onAuthSuccess(user, toastMsg) {
  state.session = user.username;
  showToast(toastMsg, "success");
  enterApp();
}

function doLogout() {
  logoutUser();
  state.session = null;
  state.mainView = "welcome";
  state.activePanelView = "chats";
  state.viewingUsername = null;
  state.activeChatUsername = null;
  els.appShell.hidden = true;
  els.authScreen.hidden = false;
  showAuthTab("login");
  showToast(t("toast.loggedOut"));
}
els.navLogout.addEventListener("click", doLogout);
els.settingsLogout.addEventListener("click", doLogout);

/* ================= APP SHELL: PANEL VIEW (chats/people) ================= */
function setPanelView(view) {
  state.activePanelView = view;
  els.viewChats.hidden = view !== "chats";
  els.viewPeople.hidden = view !== "people";
  [els.navChats, els.navPeople].forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-view") === view);
  });
  document.querySelectorAll(".mobile-nav__item[data-view]").forEach((btn) => {
    if (
      btn.getAttribute("data-view") === view ||
      (view === "chats" && btn.getAttribute("data-view") === "chats")
    ) {
      btn.classList.toggle("is-active", btn.getAttribute("data-view") === view);
    }
  });
  if (view === "people") runPeopleSearch();
  if (view === "chats") renderChatsList();
}

els.navChats.addEventListener("click", () => {
  setPanelView("chats");
  setMainView("welcome");
  closeMobileDetail();
});
els.navPeople.addEventListener("click", () => {
  setPanelView("people");
  setMainView("welcome");
  closeMobileDetail();
});

// The Chats panel content is rendered dynamically (renderChatsList) —
// it's either the conversation list or the "Find people" empty state —
// so its click handling is delegated to the container instead of being
// wired to one static button.
els.chatsListContainer.addEventListener("click", (e) => {
  const emptyBtn = e.target.closest("#emptyToPeople");
  if (emptyBtn) {
    setPanelView("people");
    document.getElementById("peopleSearchInput").focus();
    syncMobileNav("people");
    return;
  }
  const row = e.target.closest("[data-username]");
  if (!row) return;
  openChat(row.getAttribute("data-username"), true);
});

function syncMobileNav(view) {
  document.querySelectorAll(".mobile-nav__item[data-view]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-view") === view);
  });
}

document.querySelectorAll(".mobile-nav__item[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.getAttribute("data-view");
    syncMobileNav(view);
    if (view === "chats") {
      setPanelView("chats");
      setMainView("welcome");
      closeMobileDetail();
    } else if (view === "people") {
      setPanelView("people");
      setMainView("welcome");
      closeMobileDetail();
    } else if (view === "profile") {
      openOwnProfile();
      openMobileDetail();
    } else if (view === "settings") {
      openSettings();
      openMobileDetail();
    }
  });
});

/* ================= MAIN VIEW SWITCHING ================= */
function setMainView(view) {
  state.mainView = view;
  [
    els.mainWelcome,
    els.mainProfileView,
    els.mainProfileEdit,
    els.mainSettings,
    els.mainChat,
  ].forEach((el) => {
    el.hidden = el.getAttribute("data-main-view") !== view;
  });
  [els.navProfile, els.navSettings].forEach((btn) =>
    btn.classList.remove("is-active"),
  );
  if (view === "profile") els.navProfile.classList.add("is-active");
  if (view === "settings") els.navSettings.classList.add("is-active");
}

function openMobileDetail() {
  els.appShellRoot.classList.add("is-detail-open");
}
function closeMobileDetail() {
  els.appShellRoot.classList.remove("is-detail-open");
}

let backBtn = document.createElement("button");
backBtn.className = "back-btn";
backBtn.type = "button";
backBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 6l-6 6 6 6"/></svg><span data-i18n="common.back">Back</span>`;
els.panelMain.prepend(backBtn);
backBtn.addEventListener("click", closeMobileDetail);

/* ================= PEOPLE SEARCH ================= */
function runPeopleSearch() {
  const query = els.peopleSearchInput.value;
  const me = currentUser(state.session);
  const results = searchUsers(query, me ? me.username : null);
  renderPeopleResults(els.peopleResults, results, {
    query,
    selectedUsername: state.viewingUsername,
  });
}
els.peopleSearchInput.addEventListener("input", debounce(runPeopleSearch, 150));

els.peopleResults.addEventListener("click", (e) => {
  const row = e.target.closest("[data-username]");
  if (!row) return;
  const username = row.getAttribute("data-username");
  openProfileView(username, true);
});

function openProfileView(username, navigate) {
  const me = currentUser(state.session);
  if (me && username.toLowerCase() === me.username.toLowerCase()) {
    openOwnProfile();
    if (navigate) openMobileDetail();
    return;
  }
  const user = findUserByUsername(username);
  if (!user) return;
  state.viewingUsername = user.username;
  renderProfileHero(els.mainProfileView, user, false);
  setMainView("profileView");
  runPeopleSearch();
  if (navigate) openMobileDetail();
}

/* ================= CHAT ================= */
// The "Message" button lives inside profile-hero markup that gets
// rebuilt on every render, so its click is handled here via delegation
// on the stable container instead of being rebound each time.
els.mainProfileView.addEventListener("click", (e) => {
  const btn = e.target.closest("#btnMessageUser");
  if (!btn || !state.viewingUsername) return;
  openChat(state.viewingUsername, true);
});

function openChat(username, navigate) {
  const me = currentUser(state.session);
  if (!me) return;
  const other = findUserByUsername(username);
  if (!other) return;
  state.activeChatUsername = other.username;
  renderChatHeader(other);
  renderChatMessages();
  setMainView("chat");
  if (navigate) openMobileDetail();
  autoSizeChatInput();
}

// Clicking the chat header jumps back to that person's profile — a
// normal messenger pattern, and it reuses the existing profile view
// instead of adding a new screen.
els.chatHeaderInfo.addEventListener("click", () => {
  if (state.activeChatUsername) openProfileView(state.activeChatUsername, true);
});

function autoSizeChatInput() {
  if (!els.chatInput) return;
  els.chatInput.style.height = "auto";
  els.chatInput.style.height = Math.min(els.chatInput.scrollHeight, 120) + "px";
}

function sendChatMessage() {
  const me = currentUser(state.session);
  if (!me || !state.activeChatUsername) return;
  const text = els.chatInput.value.trim();
  if (!text) return;
  addMessage(me.username, state.activeChatUsername, me.username, text);
  els.chatInput.value = "";
  autoSizeChatInput();
  renderChatMessages();
  if (state.activePanelView === "chats") renderChatsList();
}

els.chatComposerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChatMessage();
});
els.chatInput.addEventListener("input", autoSizeChatInput);
els.chatInput.addEventListener("keydown", (e) => {
  // Enter sends the message; Shift+Enter inserts a newline as normal.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

/* ================= OWN PROFILE ================= */
function openOwnProfile() {
  const me = currentUser(state.session);
  if (!me) return;
  state.viewingUsername = me.username;
  els.profileForm.hidden = true;
  els.profileSummary.hidden = false;
  els.profileEditToggle.hidden = false;
  els.profileEditToggle.textContent = t("profile.edit");
  renderProfileSummary(els.profileSummary, me);
  setMainView("profile");
}

els.navProfile.addEventListener("click", () => {
  openOwnProfile();
  closeMobileDetail();
});

els.profileEditToggle.addEventListener("click", () => {
  const me = currentUser(state.session);
  if (!me) return;
  const isEditing = !els.profileForm.hidden;
  if (isEditing) {
    els.profileForm.hidden = true;
    els.profileSummary.hidden = false;
    els.profileEditToggle.textContent = t("profile.edit");
  } else {
    populateProfileForm(me);
    els.profileForm.hidden = false;
    els.profileSummary.hidden = true;
    els.profileEditToggle.hidden = true;
  }
});

els.profileCancelEdit.addEventListener("click", () => {
  els.profileForm.hidden = true;
  els.profileSummary.hidden = false;
  els.profileEditToggle.hidden = false;
});

function populateProfileForm(user) {
  document.getElementById("profileDisplayName").value = user.displayName;
  document.getElementById("profileUsername").value = user.username;
  document.getElementById("profileBio").value = user.bio || "";
  state.profileEditAvatar = user.avatar || { type: "generated" };
  paintAvatarPreview(
    els.profileAvatarPreview,
    state.profileEditAvatar,
    user.displayName,
    user.username,
  );
  clearErrors(["profileDisplayName", "profileUsername", "profileForm"]);
}

els.profileAvatarInput.addEventListener("change", async () => {
  const file = els.profileAvatarInput.files[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    showToast(t("common.avatarTooLarge"), "error");
    els.profileAvatarInput.value = "";
    return;
  }
  const dataUrl = await readFileAsDataURL(file);
  state.profileEditAvatar = { type: "upload", data: dataUrl };
  paintAvatarPreview(
    els.profileAvatarPreview,
    state.profileEditAvatar,
    document.getElementById("profileDisplayName").value,
    document.getElementById("profileUsername").value,
  );
});
els.profileAvatarClear.addEventListener("click", () => {
  state.profileEditAvatar = { type: "generated" };
  els.profileAvatarInput.value = "";
  paintAvatarPreview(
    els.profileAvatarPreview,
    state.profileEditAvatar,
    document.getElementById("profileDisplayName").value,
    document.getElementById("profileUsername").value,
  );
});

els.profileForm.addEventListener("submit", (e) => {
  e.preventDefault();
  clearErrors(["profileDisplayName", "profileUsername", "profileForm"]);
  const me = currentUser(state.session);
  if (!me) return;

  const updates = {
    displayName: document.getElementById("profileDisplayName").value,
    username: document.getElementById("profileUsername").value,
    bio: document.getElementById("profileBio").value,
    avatar: state.profileEditAvatar,
  };

  const result = updateProfile(me.username, updates);
  if (!result.ok) {
    Object.keys(result.errors).forEach((field) => {
      if (field === "form") setFieldError("profileForm", result.errors.form);
      else setFieldError("profile" + capitalize(field), result.errors[field]);
    });
    return;
  }

  state.session = result.user.username;
  updateSettingsAccountHint(result.user.username);
  els.profileForm.hidden = true;
  els.profileSummary.hidden = false;
  els.profileEditToggle.hidden = false;
  renderProfileSummary(els.profileSummary, result.user);
  showToast(t("toast.profileSaved"), "success");
});

/* ================= SETTINGS ================= */
function updateSettingsAccountHint(username) {
  if (!els.settingsAccountHint) return;
  const raw = t("settings.accountHint");
  const [before, after] = raw.split("{username}");
  els.settingsAccountHint.innerHTML = `${before}<span id="settingsUsername">@${username || "—"}</span>${after || ""}`;
  els.settingsUsername = document.getElementById("settingsUsername");
}

function openSettings() {
  const me = currentUser(state.session);
  if (me) updateSettingsAccountHint(me.username);
  setMainView("settings");
}
els.navSettings.addEventListener("click", () => {
  openSettings();
  closeMobileDetail();
});

/* ================= ENTER APP / INIT ================= */
function enterApp() {
  els.authScreen.hidden = true;
  els.appShell.hidden = false;
  setPanelView("chats");
  setMainView("welcome");
  closeMobileDetail();
  const me = currentUser(state.session);
  if (me) updateSettingsAccountHint(me.username);
}

function init() {
  initTheme();
  applyTranslations();
  wireLangControls();
  showAuthTab("login");
  paintAvatarPreview(registerAvatarPreview, state.registerAvatar, "", "");

  if (!hasStoredLang()) {
    els.langScreen.hidden = false;
    els.authScreen.hidden = true;
    els.appShell.hidden = true;
    return;
  }
  els.langScreen.hidden = true;

  if (state.session && currentUser(state.session)) {
    enterApp();
  } else {
    state.session = null;
    els.authScreen.hidden = false;
    els.appShell.hidden = true;
  }
}

// This <script> tag sits at the very end of <body>, so by the time this
// file runs, every element above it is already parsed into the DOM.
// There's no need to wait for a "DOMContentLoaded" listener here — that
// pattern is redundant at best when the script is already at the bottom
// of the page, and it can be actively broken in some page-load paths (for
// example if the HTML is injected via document.write/innerHTML after the
// event has already fired): the listener callback would then silently
// never run, leaving every button on the page dead with no console error.
// Calling init() directly avoids that failure mode entirely.
init();