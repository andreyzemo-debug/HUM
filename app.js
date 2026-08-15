// ===================================================================
// HUM — application entry point
// ===================================================================
// This file contains ALL application JavaScript in one place, on
// purpose: storage, i18n, auth, rendering, and UI wiring all live
// here as clearly-labeled sections instead of separate modules.
// It's loaded as a single <script type="module" src="app.js">. It
// needs to be a module (not a plain classic script) for exactly one
// reason: the Firebase SDK is distributed as ES modules, and importing
// it is what turns HUM's user accounts and messages from "only exist
// in this one browser's localStorage" into a real, shared, cross-device
// backend. Everything else about the file's structure — one big file,
// clearly labeled sections, no other imports/exports — is unchanged.
//
// IMPORTANT — SERVING THIS FILE:
// Because app.js is now an ES module, browsers will refuse to load it
// over a bare file:// URL (that's a browser security restriction on
// modules, not something in this code). Serve the HUM folder over
// http/https — e.g. `npx serve .`, `python3 -m http.server`, or any
// static host — the same way you'd serve any other static site.
//
// WHY A BACKEND IS NEEDED AT ALL:
// localStorage is sandboxed per browser origin *and* per device — data
// written on one phone/laptop is physically never visible to another
// device or browser. There is no way to make People Search (or
// messaging) work across devices without some shared, network-reachable
// store that every device talks to. This file uses Firebase
// (Authentication + Firestore) for that: it's a real hosted database
// with a client SDK that needs zero custom server code, which fits a
// static, backend-less project like HUM better than standing up a
// custom API. Firebase Authentication stores and verifies passwords
// (real, salted, server-side — not the old local prototype hash), and
// Firestore stores user profiles and messages so any device can read
// and write them.
//
// SETUP YOU NEED TO DO ONCE (I can't create a live cloud project for
// you — this requires your own Firebase account):
//   1. Go to https://console.firebase.google.com, create a project.
//   2. Build → Authentication → get started → enable "Email/Password".
//   3. Build → Firestore Database → create database (start in
//      "production mode" — the security rules below assume that).
//   4. Project settings → General → "Your apps" → add a Web app →
//      copy the firebaseConfig object it gives you into
//      FIREBASE_CONFIG right below this comment.
//   5. Firestore → Rules, paste:
//        rules_version = '2';
//        service cloud.firestore {
//          match /databases/{database}/documents {
//            match /users/{userId} {
//              allow read: if true;
//              allow create: if request.auth != null
//                && request.auth.uid == request.resource.data.uid;
//              allow update: if request.auth != null
//                && request.auth.uid == resource.data.uid;
//              allow delete: if false;
//            }
//            match /conversations/{convId} {
//              allow read, write: if request.auth != null;
//              match /messages/{msgId} {
//                allow read, create: if request.auth != null;
//                allow update, delete: if false;
//              }
//            }
//          }
//        }
//      (Profiles are readable by anyone signed in or not, which is
//      what lets People Search work — but only the profile's own
//      owner, proven by their Firebase Auth uid, can create/edit it.
//      Conversations/messages require being signed in. Locking
//      conversation access down to only its two participants needs
//      mapping each request.auth.uid to a username inside the rules,
//      which Firestore rules can do via get() — a reasonable next
//      hardening step once you're past the prototype stage.)
// ===================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateEmail,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query as fbQuery,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Replace with YOUR OWN Firebase project's config (see setup steps
// above). Every device that opens HUM with this same config is talking
// to the same shared project — that's what makes accounts and messages
// cross-device instead of stuck in one browser.
const FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
// Keeps the signed-in session across page reloads/tabs on this device
// (Firebase's own equivalent of the old hum_session localStorage key —
// see onAuthReady() further down, which is what now decides whether to
// show the auth screen or go straight into the app on load).
setPersistence(auth, browserLocalPersistence).catch(() => {});

// HUM's UI is username/password, but Firebase Authentication is built
// around email/password. Rather than adding a whole second identity
// system, each username deterministically maps to a synthetic email
// that's never shown anywhere in the UI — the person never sees or
// types an "email" at any point.
function emailForUsername(username) {
  return usernameDocId(username) + "@hum.local";
}

/* ===================================================================
   SECTION: LOCAL (DEVICE-ONLY) STORAGE LAYER
   Only things that are genuinely per-device — language and theme
   preference — still live in localStorage. Accounts and messages are
   shared data now, so they live in Firestore (see the next section);
   localStorage is no longer the source of truth for either.
=================================================================== */
const KEYS = {
  LANG:'hum_lang',
  THEME:'hum_theme'
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

function hasStoredLang(){
  return localStorage.getItem(KEYS.LANG) !== null;
}

/* ===================================================================
   SECTION: USERS (Firestore)
   Each user's document lives at users/{usernameLower} — using the
   lowercased username as the document ID is what makes usernames
   unique and lookups a single direct read instead of a search query.
=================================================================== */

function usernameDocId(username){
  return String(username || '').trim().toLowerCase();
}

async function findUserByUsername(username){
  if(!username) return null;
  const snap = await getDoc(doc(db, 'users', usernameDocId(username)));
  return snap.exists() ? snap.data() : null;
}

// The signed-in user's own profile, kept resolved in memory the whole
// session (see onAuthReady/registerUser/loginUser/updateProfile) so
// the many places in the UI that just need "who am I right now" can
// read it synchronously instead of re-awaiting Firestore on every
// render. Firestore is still the source of truth — this is a cache of
// it, refreshed whenever it changes.
function currentUser(){
  return state.me || null;
}

/* ---------------- Messages / Conversations (Firestore) ----------------
   conversations/{conversationId} holds the two participants (as
   lowercased usernames) plus a denormalized copy of their display
   info and the last message, so the Chats list can render without an
   extra lookup per row. conversationId is a stable, order-independent
   key for a pair of users, so "A messages B" and "B messages A" always
   resolve to the same conversation, and a conversation between A and C
   never touches it. Actual messages live in the
   conversations/{id}/messages subcollection. */

function conversationId(usernameA, usernameB){
  return [usernameDocId(usernameA), usernameDocId(usernameB)].sort().join('__');
}

function conversationInfo(user){
  return { username: user.username, displayName: user.displayName, avatar: user.avatar || { type:'generated' } };
}

async function ensureConversation(meUser, otherUser){
  const convId = conversationId(meUser.username, otherUser.username);
  const ref = doc(db, 'conversations', convId);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, {
      participants: [usernameDocId(meUser.username), usernameDocId(otherUser.username)],
      participantsInfo: {
        [usernameDocId(meUser.username)]: conversationInfo(meUser),
        [usernameDocId(otherUser.username)]: conversationInfo(otherUser),
      },
      lastMessage: null,
      updatedAt: new Date().toISOString(),
    });
  }
  return convId;
}

// Sends a message and returns it. meUser/otherUser are full user
// objects (not just usernames) because the conversation doc keeps a
// denormalized copy of each participant's display info for the Chats
// list — that copy refreshes on every message either of them sends, so
// it can go a little stale between messages (e.g. right after someone
// changes their display name) but never for long.
async function addMessage(meUser, otherUser, text){
  const convId = await ensureConversation(meUser, otherUser);
  const message = { from: usernameDocId(meUser.username), text, ts: new Date().toISOString() };
  await addDoc(collection(db, 'conversations', convId, 'messages'), message);
  await setDoc(doc(db, 'conversations', convId), {
    participantsInfo: {
      [usernameDocId(meUser.username)]: conversationInfo(meUser),
    },
    lastMessage: message,
    updatedAt: message.ts,
  }, { merge:true });
  return message;
}

// Live-subscribes to one conversation's messages, oldest first. Calls
// onChange(messages) every time the subcollection changes (including
// the very first load) so the open chat updates the moment the other
// person replies, on any device. Returns an unsubscribe function.
function watchConversationMessages(usernameA, usernameB, onChange){
  const convId = conversationId(usernameA, usernameB);
  const q = fbQuery(collection(db, 'conversations', convId, 'messages'), orderBy('ts', 'asc'));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map(d => d.data()));
  }, (err) => {
    console.error('HUM: message listener failed', err);
    onChange(null, err);
  });
}

// Live-subscribes to this user's conversation list, most recently
// active first, using the denormalized participantsInfo/lastMessage so
// the Chats panel can render straight from this snapshot with no
// further reads. Returns an unsubscribe function.
function watchUserConversations(username, onChange){
  const lower = usernameDocId(username);
  const q = fbQuery(
    collection(db, 'conversations'),
    where('participants', 'array-contains', lower),
    orderBy('updatedAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs
      .map(d => d.data())
      .filter(conv => conv.lastMessage)
      .map(conv => {
        const otherLower = conv.participants.find(p => p !== lower) || conv.participants[0];
        const otherInfo = conv.participantsInfo && conv.participantsInfo[otherLower];
        return otherInfo ? { other: otherInfo, lastMessage: conv.lastMessage } : null;
      })
      .filter(Boolean);
    onChange(rows);
  }, (err) => {
    console.error('HUM: conversations listener failed', err);
    onChange(null, err);
  });
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
      close:'Close', back:'Back', avatarTooLarge:'Image is too large (max 700KB).',
      loading:'Loading…'
    },
    errors:{
      network:'Something went wrong connecting to HUM. Check your connection and try again.',
      userNotFound:'That account could not be found.',
      requiresRecentLogin:'Please log out and log back in, then try again.'
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
      close:'Закрыть', back:'Назад', avatarTooLarge:'Изображение слишком большое (макс. 700КБ).',
      loading:'Загрузка…'
    },
    errors:{
      network:'Не удалось подключиться к HUM. Проверьте соединение и попробуйте снова.',
      userNotFound:'Такой аккаунт не найден.',
      requiresRecentLogin:'Выйдите из аккаунта и войдите снова, затем повторите попытку.'
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
      close:'Yopish', back:'Orqaga', avatarTooLarge:'Rasm hajmi juda katta (maks. 700KB).',
      loading:'Yuklanmoqda…'
    },
    errors:{
      network:'HUM bilan bog‘lanishda xatolik yuz berdi. Aloqani tekshirib, qayta urinib ko‘ring.',
      userNotFound:'Bunday akkaunt topilmadi.',
      requiresRecentLogin:'Hisobdan chiqib, qayta kiring va yana urinib ko‘ring.'
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
  }
  // Uniqueness is enforced by Firebase Auth itself (each username maps
  // to a unique synthetic email) — see registerUser()'s catch below —
  // rather than a separate pre-check here, so there's no race between
  // "check it's free" and "claim it" on two devices registering the
  // same name at once.

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

async function registerUser({ displayName, username, password, bio, avatar }){
  const errors = validateRegistration({ displayName, username, password, confirmPassword: password });
  if(Object.keys(errors).length){
    return { ok:false, errors };
  }

  const uname = username.trim();
  const lower = usernameDocId(uname);

  let credential;
  try{
    credential = await createUserWithEmailAndPassword(auth, emailForUsername(lower), password);
  }catch(e){
    if(e.code === 'auth/email-already-in-use'){
      return { ok:false, errors:{ username: t('auth.validation.usernameTaken') } };
    }
    return { ok:false, errors:{ form: t('errors.network') } };
  }

  const user = {
    uid: credential.user.uid,
    username: uname,
    usernameLower: lower,
    displayName: displayName.trim(),
    displayNameLower: displayName.trim().toLowerCase(),
    bio: (bio || '').trim(),
    avatar: avatar || { type:'generated' },
    createdAt: new Date().toISOString()
  };

  try{
    await setDoc(doc(db, 'users', lower), user);
  }catch(e){
    return { ok:false, errors:{ form: t('errors.network') } };
  }

  state.me = user;
  return { ok:true, user };
}

async function loginUser({ username, password }){
  if(!username || !password){
    return { ok:false, error: t('auth.validation.required') };
  }
  let credential;
  try{
    credential = await signInWithEmailAndPassword(auth, emailForUsername(username), password);
  }catch(e){
    if(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' || e.code === 'auth/invalid-email'){
      return { ok:false, error: t('auth.login.errorInvalid') };
    }
    return { ok:false, error: t('errors.network') };
  }
  const user = await findUserByUsername(username);
  if(!user){
    // Auth account exists but its Firestore profile doc doesn't (e.g.
    // it was deleted separately) — treat it the same as invalid login
    // rather than letting the person into a broken, profile-less app.
    await signOut(auth).catch(() => {});
    return { ok:false, error: t('auth.login.errorInvalid') };
  }
  state.me = user;
  return { ok:true, user };
}

async function logoutUser(){
  stopAllConversationWatchers();
  await signOut(auth).catch(() => {});
  state.me = null;
}

async function updateProfile(updates){
  const user = state.me;
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
  }

  if(Object.keys(errors).length){
    return { ok:false, errors };
  }

  const usernameChanged = usernameDocId(nextUsername) !== usernameDocId(user.username);
  const nextLower = usernameDocId(nextUsername);

  // Changing the username means changing the Firebase Auth email it
  // maps to, which Firebase itself rejects with auth/email-already-in-use
  // if another account already has it — the same uniqueness check the
  // rest of the app relies on, so there's nothing extra to pre-check
  // here. It can also ask for a fresh login (auth/requires-recent-login)
  // if the session is old, which is surfaced as a plain form error
  // rather than a crash.
  if(usernameChanged){
    try{
      await updateEmail(auth.currentUser, emailForUsername(nextLower));
    }catch(e){
      if(e.code === 'auth/email-already-in-use'){
        return { ok:false, errors:{ username: t('auth.validation.usernameTaken') } };
      }
      if(e.code === 'auth/requires-recent-login'){
        return { ok:false, errors:{ form: t('errors.requiresRecentLogin') } };
      }
      return { ok:false, errors:{ form: t('errors.network') } };
    }
  }

  const updatedUser = {
    ...user,
    displayName: nextDisplayName,
    displayNameLower: nextDisplayName.toLowerCase(),
    username: nextUsername,
    usernameLower: nextLower,
    bio: (updates.bio || '').trim(),
    avatar: updates.avatar !== undefined ? updates.avatar : user.avatar
  };

  try{
    if(usernameChanged){
      // Firestore document IDs can't be renamed in place — write the
      // new doc, then remove the old one. Existing conversations keep
      // referencing the old username (a known, acceptable trade-off
      // for a prototype-simple schema): they won't disappear, but
      // their "from"/participant records won't retroactively update to
      // the new name.
      await setDoc(doc(db, 'users', nextLower), updatedUser);
      await deleteDoc(doc(db, 'users', usernameDocId(user.username)));
    }else{
      await setDoc(doc(db, 'users', nextLower), updatedUser);
    }
  }catch(e){
    return { ok:false, errors:{ form: t('errors.network') } };
  }

  state.me = updatedUser;
  return { ok:true, user: updatedUser, usernameChanged };
}

// Firestore has no built-in "contains" text search, so this does two
// prefix ("starts with") queries — one on the lowercased username,
// one on the lowercased display name — and merges the results. That
// covers the common case (typing the start of someone's name or
// @handle) without needing a separate search service. Throws on
// network failure so callers can show a real error state instead of
// silently showing zero results.
async function searchUsers(searchQuery, excludeUsernameLower){
  const q = (searchQuery || '').trim().toLowerCase();
  const usersCol = collection(db, 'users');
  let rows = [];

  if(!q){
    // Blank query: browse everyone, like the old "list all local
    // users" default did, capped to a reasonable page size.
    const snap = await getDocs(fbQuery(usersCol, orderBy('displayNameLower'), limit(40)));
    rows = snap.docs.map(d => d.data());
  }else{
    const upperBound = q + '\uf8ff';
    const [byUsername, byDisplayName] = await Promise.all([
      getDocs(fbQuery(usersCol, orderBy('usernameLower'), where('usernameLower','>=',q), where('usernameLower','<=',upperBound), limit(20))),
      getDocs(fbQuery(usersCol, orderBy('displayNameLower'), where('displayNameLower','>=',q), where('displayNameLower','<=',upperBound), limit(20))),
    ]);
    const seen = new Map();
    [...byUsername.docs, ...byDisplayName.docs].forEach(d => seen.set(d.id, d.data()));
    rows = Array.from(seen.values());
  }

  return rows
    .filter(u => u.usernameLower !== (excludeUsernameLower || ''))
    .sort((a,b)=> a.displayName.localeCompare(b.displayName))
    .slice(0, 30);
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

function renderPeopleResults(container, users, { query, selectedUsername, loading, error }){
  if(loading){
    container.innerHTML = `<div class="people-results__hint">${escapeHtml(t('common.loading'))}</div>`;
    return;
  }
  if(error){
    container.innerHTML = `<div class="people-results__empty">${escapeHtml(t('errors.network'))}</div>`;
    return;
  }
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
function renderChatsListRow(user, lastMessage, meUsernameLower){
  const isOwn = usernameDocId(lastMessage.from) === meUsernameLower;
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

// The Chats panel doesn't fetch on demand — it just renders whatever
// watchUserConversations() last delivered (state.chatsListRows /
// state.chatsListError / state.chatsListLoading), which that live
// listener keeps current for as long as the person is logged in. That
// listener is what makes a message someone just received on another
// device show up here without needing to refresh or reopen the tab.
function renderChatsList(){
  if(!els.chatsListContainer) return;
  const me = currentUser();
  if(!me){
    els.chatsListContainer.innerHTML = '';
    return;
  }
  if(state.chatsListError){
    els.chatsListContainer.innerHTML = `
      <div class="people-results__empty">
        ${escapeHtml(t('errors.network'))}
      </div>
    `;
    return;
  }
  if(state.chatsListLoading){
    els.chatsListContainer.innerHTML = `<div class="people-results__hint">${escapeHtml(t('common.loading'))}</div>`;
    return;
  }
  const rows = state.chatsListRows || [];
  if(!rows.length){
    els.chatsListContainer.innerHTML = chatsEmptyStateMarkup();
    return;
  }
  const meLower = usernameDocId(me.username);
  els.chatsListContainer.innerHTML = rows
    .map(({ other, lastMessage }) => renderChatsListRow(other, lastMessage, meLower))
    .join('');
}

function renderChatHeader(user){
  if(!els.chatHeaderAvatar) return;
  els.chatHeaderAvatar.style.background = avatarBg(user);
  els.chatHeaderAvatar.innerHTML = avatarMarkup(user);
  els.chatHeaderName.textContent = user.displayName;
  els.chatHeaderHandle.textContent = '@' + user.username;
}

// Like renderChatsList(), this renders from whatever the currently
// open chat's live listener (watchConversationMessages, wired in
// openChat()) last delivered — state.chatMessagesData /
// state.chatMessagesError / state.chatMessagesLoading — rather than
// fetching on its own, so a reply that arrives from the other person's
// device appears immediately.
function renderChatMessages(){
  if(!els.chatMessages) return;
  const me = currentUser();
  if(!me || !state.activeChatUsername){
    els.chatMessages.innerHTML = '';
    return;
  }
  if(state.chatMessagesError){
    els.chatMessages.innerHTML = `<div class="chat-empty">${escapeHtml(t('errors.network'))}</div>`;
    return;
  }
  if(state.chatMessagesLoading){
    els.chatMessages.innerHTML = `<div class="chat-empty">${escapeHtml(t('common.loading'))}</div>`;
    return;
  }
  const messages = state.chatMessagesData || [];
  if(!messages.length){
    els.chatMessages.innerHTML = `<div class="chat-empty">${escapeHtml(t('chat.emptyTitle'))}</div>`;
    return;
  }
  const meLower = usernameDocId(me.username);
  els.chatMessages.innerHTML = messages
    .map((m) => {
      const isOwn = usernameDocId(m.from) === meLower;
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
  me: null, // resolved Firestore profile of the signed-in user (see onAuthReady)
  authReady: false,
  activePanelView: "chats",
  mainView: "welcome",
  viewingUsername: null,
  activeChatUsername: null,
  registerAvatar: { type: "generated" },
  profileEditAvatar: { type: "generated" },

  // People Search: guards against an in-flight search's results
  // rendering after a newer one already started (typing fast, or a
  // slow network reply arriving late).
  peopleSearchToken: 0,
  peopleSearchLoading: false,
  peopleSearchError: false,

  // Chats list: kept in sync by watchUserConversations() for as long
  // as someone is logged in (see startConversationsWatcher/
  // stopAllConversationWatchers).
  chatsListRows: [],
  chatsListLoading: true,
  chatsListError: false,
  unsubChatsList: null,

  // Open chat's messages: kept in sync by watchConversationMessages()
  // for whichever conversation is currently open (see openChat).
  chatMessagesData: [],
  chatMessagesLoading: true,
  chatMessagesError: false,
  unsubChatMessages: null,
};

// Stops any live Firestore listeners this device has open — called on
// logout and when otherwise tearing down the signed-in session, so a
// listener never keeps delivering updates (or errors) for an account
// that's no longer signed in.
function stopAllConversationWatchers(){
  if(state.unsubChatsList){ state.unsubChatsList(); state.unsubChatsList = null; }
  if(state.unsubChatMessages){ state.unsubChatMessages(); state.unsubChatMessages = null; }
  state.chatsListRows = [];
  state.chatsListLoading = true;
  state.chatsListError = false;
  state.chatMessagesData = [];
  state.chatMessagesLoading = true;
  state.chatMessagesError = false;
}

// Starts (or restarts) the live "who am I talking to, and what did
// they last say" listener for the signed-in user. Safe to call more
// than once — it always tears down any previous listener first.
function startConversationsWatcher(){
  if(state.unsubChatsList) state.unsubChatsList();
  const me = currentUser();
  if(!me) return;
  state.chatsListLoading = true;
  state.chatsListError = false;
  if(state.activePanelView === "chats") renderChatsList();
  state.unsubChatsList = watchUserConversations(me.username, (rows, err) => {
    state.chatsListLoading = false;
    if(err){
      state.chatsListError = true;
    }else{
      state.chatsListError = false;
      state.chatsListRows = rows;
    }
    if(state.activePanelView === "chats") renderChatsList();
  });
}

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
  if (state.me) {
    const me = currentUser();
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

// Firestore caps a single document at 1MiB, and base64-encoding an
// image inflates its size by about a third — so a raw file has to stay
// well under that limit for the encoded avatar plus the rest of the
// user doc's fields to fit. 700KB raw leaves comfortable headroom.
const AVATAR_MAX_BYTES = 700 * 1024;

registerAvatarInput.addEventListener("change", async () => {
  const file = registerAvatarInput.files[0];
  if (!file) return;
  if (file.size > AVATAR_MAX_BYTES) {
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

function setFormBusy(form, busy){
  const btn = form.querySelector('button[type="submit"]');
  if(btn) btn.disabled = busy;
}

/* ================= LOGIN SUBMIT ================= */
els.loginForm.addEventListener("submit", async (e) => {
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

  setFormBusy(els.loginForm, true);
  const result = await loginUser({ username, password });
  setFormBusy(els.loginForm, false);
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
els.registerForm.addEventListener("submit", async (e) => {
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

  setFormBusy(els.registerForm, true);
  const result = await registerUser(data);
  setFormBusy(els.registerForm, false);
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
  state.me = user;
  showToast(toastMsg, "success");
  enterApp();
  startConversationsWatcher();
}

async function doLogout() {
  await logoutUser();
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
// Guarded with peopleSearchToken so that if the person types quickly
// (or a slow network reply arrives late), only the *latest* search's
// results ever get rendered — an older in-flight request finishing
// after a newer one can't clobber the screen with stale results.
async function runPeopleSearch() {
  const query = els.peopleSearchInput.value;
  const me = currentUser();
  const myToken = ++state.peopleSearchToken;

  renderPeopleResults(els.peopleResults, [], {
    query,
    selectedUsername: state.viewingUsername,
    loading: true,
  });

  try {
    const results = await searchUsers(query, me ? usernameDocId(me.username) : null);
    if (myToken !== state.peopleSearchToken) return;
    renderPeopleResults(els.peopleResults, results, {
      query,
      selectedUsername: state.viewingUsername,
    });
  } catch (e) {
    console.error("HUM: people search failed", e);
    if (myToken !== state.peopleSearchToken) return;
    renderPeopleResults(els.peopleResults, [], {
      query,
      selectedUsername: state.viewingUsername,
      error: true,
    });
  }
}
els.peopleSearchInput.addEventListener("input", debounce(runPeopleSearch, 150));

els.peopleResults.addEventListener("click", (e) => {
  const row = e.target.closest("[data-username]");
  if (!row) return;
  const username = row.getAttribute("data-username");
  openProfileView(username, true);
});

async function openProfileView(username, navigate) {
  const me = currentUser();
  if (me && usernameDocId(username) === usernameDocId(me.username)) {
    openOwnProfile();
    if (navigate) openMobileDetail();
    return;
  }
  let user;
  try {
    user = await findUserByUsername(username);
  } catch (e) {
    console.error("HUM: failed to load profile", e);
    showToast(t("errors.network"), "error");
    return;
  }
  if (!user) {
    showToast(t("errors.userNotFound"), "error");
    return;
  }
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

async function openChat(username, navigate) {
  const me = currentUser();
  if (!me) return;
  let other;
  try {
    other = await findUserByUsername(username);
  } catch (e) {
    console.error("HUM: failed to open chat", e);
    showToast(t("errors.network"), "error");
    return;
  }
  if (!other) {
    showToast(t("errors.userNotFound"), "error");
    return;
  }

  state.activeChatUsername = other.username;
  renderChatHeader(other);
  setMainView("chat");
  if (navigate) openMobileDetail();
  // Clear any leftover draft from a previously open conversation so text
  // typed for one person never leaks into a different person's chat.
  if (els.chatInput) els.chatInput.value = "";
  autoSizeChatInput();

  // Swap in a live listener for this conversation's messages — this is
  // what makes a message the other person sends from their own device
  // appear here without needing to reopen the chat or refresh.
  if (state.unsubChatMessages) state.unsubChatMessages();
  state.chatMessagesData = [];
  state.chatMessagesLoading = true;
  state.chatMessagesError = false;
  renderChatMessages();
  const watchedUsername = other.username;
  state.unsubChatMessages = watchConversationMessages(me.username, other.username, (messages, err) => {
    state.chatMessagesLoading = false;
    if (err) {
      state.chatMessagesError = true;
    } else {
      state.chatMessagesError = false;
      state.chatMessagesData = messages;
    }
    // Guards against a listener callback for a chat the person has
    // since navigated away from landing on the wrong screen.
    if (state.activeChatUsername && usernameDocId(state.activeChatUsername) === usernameDocId(watchedUsername)) {
      renderChatMessages();
    }
  });
}

// Clicking the chat header jumps back to that person's profile — a
// normal messenger pattern, and it reuses the existing profile view
// instead of adding a new screen.
els.chatHeaderInfo.addEventListener("click", () => {
  if (state.activeChatUsername) openProfileView(state.activeChatUsername, true);
});

// Keep in sync with the max-height set on .chat-composer__input in
// style.css. Resets to "auto" first so shrinking (e.g. after deleting
// text, or after a message is sent) is measured correctly too, not
// just growth.
const CHAT_INPUT_MAX_HEIGHT = 132;

function autoSizeChatInput() {
  if (!els.chatInput) return;
  const el = els.chatInput;
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, CHAT_INPUT_MAX_HEIGHT);
  el.style.height = next + "px";
  // Only let the textarea show its own scrollbar once content truly
  // exceeds the max height — otherwise it stays hidden so no scrollbar
  // ever flashes during normal typing.
  el.classList.toggle("is-scrollable", el.scrollHeight > CHAT_INPUT_MAX_HEIGHT);
}

async function sendChatMessage() {
  const me = currentUser();
  if (!me || !state.activeChatUsername) return;
  const text = els.chatInput.value.trim();
  if (!text) return;
  const otherUsername = state.activeChatUsername;

  // Optimistic clear: the composer empties immediately on submit (real
  // messenger feel) rather than waiting on the network round trip. The
  // live message listener from openChat() will render the sent message
  // once Firestore confirms it — including on the sender's own screen,
  // so there's no separate "add it locally too" step to keep in sync.
  els.chatInput.value = "";
  autoSizeChatInput();

  let other;
  try {
    other = await findUserByUsername(otherUsername);
    if (!other) throw new Error("recipient not found");
    await addMessage(me, other, text);
  } catch (e) {
    console.error("HUM: failed to send message", e);
    showToast(t("errors.network"), "error");
    // Restore the draft so the person doesn't lose what they typed.
    els.chatInput.value = text;
    autoSizeChatInput();
  }
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
  const me = currentUser();
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
  const me = currentUser();
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
  if (file.size > AVATAR_MAX_BYTES) {
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

els.profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors(["profileDisplayName", "profileUsername", "profileForm"]);
  const me = currentUser();
  if (!me) return;

  const updates = {
    displayName: document.getElementById("profileDisplayName").value,
    username: document.getElementById("profileUsername").value,
    bio: document.getElementById("profileBio").value,
    avatar: state.profileEditAvatar,
  };

  setFormBusy(els.profileForm, true);
  const result = await updateProfile(updates);
  setFormBusy(els.profileForm, false);
  if (!result.ok) {
    Object.keys(result.errors).forEach((field) => {
      if (field === "form") setFieldError("profileForm", result.errors.form);
      else setFieldError("profile" + capitalize(field), result.errors[field]);
    });
    return;
  }

  updateSettingsAccountHint(result.user.username);
  els.profileForm.hidden = true;
  els.profileSummary.hidden = false;
  els.profileEditToggle.hidden = false;
  renderProfileSummary(els.profileSummary, result.user);
  showToast(t("toast.profileSaved"), "success");
  if (result.usernameChanged) {
    // The username used to key both the Chats-list watcher and the
    // active conversation, so a rename means both need to restart
    // against the new username.
    startConversationsWatcher();
    if (state.mainView === "chat" && state.activeChatUsername) {
      state.viewingUsername = result.user.username;
    }
  }
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
  const me = currentUser();
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
  const me = currentUser();
  if (me) updateSettingsAccountHint(me.username);
}

// iOS Safari's fixed-position elements are sized against the *layout*
// viewport, which doesn't shrink when the on-screen keyboard opens —
// only the *visual* viewport does. Mirroring the real visible height
// onto a CSS variable (--app-vh) lets the fixed panel/composer layout
// in style.css shrink to match, so the chat input stays above the
// keyboard instead of being hidden behind it. Falls back to
// window.innerHeight on browsers without the Visual Viewport API,
// which is still strictly better than nothing.
function syncViewportHeight() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-vh", h + "px");
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewportHeight);
  window.visualViewport.addEventListener("scroll", syncViewportHeight);
}
window.addEventListener("resize", syncViewportHeight);
window.addEventListener("orientationchange", syncViewportHeight);
syncViewportHeight();

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

  // Both screens stay hidden for the brief moment until Firebase
  // resolves whether this device already has a signed-in session (see
  // the onAuthStateChanged listener below) — that check is inherently
  // asynchronous now that the session lives in Firebase Auth instead
  // of a plain localStorage flag that used to be readable synchronously.
  els.authScreen.hidden = true;
  els.appShell.hidden = true;
}

// Fires once Firebase resolves whether this device has a persisted
// signed-in session (shortly after page load), and again any time
// sign-in state actually changes. This is the async replacement for
// the old synchronous getSession() localStorage read: it's what
// decides, on every load, whether to show the auth screen or go
// straight into the app with the right profile already loaded.
onAuthStateChanged(auth, async (firebaseUser) => {
  if (!hasStoredLang()) return; // still on the language screen

  if (!firebaseUser) {
    stopAllConversationWatchers();
    state.me = null;
    els.appShell.hidden = true;
    els.authScreen.hidden = false;
    if (state.authReady) showAuthTab("login"); // a real sign-out, not just the first load
    state.authReady = true;
    return;
  }

  const usernameLower = firebaseUser.email.split("@")[0];
  // onAuthSuccess() (called right after a successful login/register)
  // already set state.me and entered the app immediately for instant
  // feedback — this listener firing right afterwards for the same user
  // is expected and harmless, just skip redoing the same work twice.
  if (state.authReady && state.me && usernameDocId(state.me.username) === usernameLower) {
    return;
  }

  try {
    const user = await findUserByUsername(usernameLower);
    if (!user) throw new Error("profile document missing for signed-in account");
    state.me = user;
    state.authReady = true;
    enterApp();
    startConversationsWatcher();
  } catch (e) {
    console.error("HUM: failed to load profile for existing session", e);
    state.authReady = true;
    state.me = null;
    els.appShell.hidden = true;
    els.authScreen.hidden = false;
    showAuthTab("login");
    setFieldError("loginForm", t("errors.network"));
  }
});

// This <script> tag is an ES module, so it's deferred automatically —
// the DOM is already fully parsed by the time this runs, same
// guarantee the old plain <script> at the end of <body> had. Calling
// init() directly (no DOMContentLoaded listener needed) avoids the
// failure mode where that event has already fired before a listener
// for it gets attached.
init();