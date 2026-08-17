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
//   5. Firestore → Rules, paste EXACTLY this (this must be pasted and
//      published in the Firebase console — nothing in this file can
//      apply it for you, and "Missing or insufficient permissions" on
//      any read/write/listener means these rules aren't live yet, or
//      don't match what's below). This version adds the "blocked/"
//      subcollection under each user, a block-aware check on who's
//      allowed to CREATE a message, and a narrow message UPDATE rule
//      for read receipts (see readAt below) — everything else is
//      unchanged from before:
//        rules_version = '2';
//        service cloud.firestore {
//          match /databases/{database}/documents {
//
//            function isSignedIn(){ return request.auth != null; }
//            function conversationDoc(convId){
//              return get(/databases/$(database)/documents/conversations/$(convId));
//            }
//            // Whichever of the two participants ISN'T `uid`.
//            function otherParticipant(convId, uid){
//              let parts = conversationDoc(convId).data.participants;
//              return parts[0] == uid ? parts[1] : parts[0];
//            }
//            // True if `a` has blocked `b`, OR `b` has blocked `a` — a
//            // block always stops messages moving in EITHER direction
//            // between that pair, which is what lets a block also shut
//            // down an already-open chat instead of just future ones.
//            function isBlockedPair(a, b){
//              return exists(/databases/$(database)/documents/users/$(a)/blocked/$(b))
//                || exists(/databases/$(database)/documents/users/$(b)/blocked/$(a));
//            }
//
//            match /users/{uid} {
//              allow read: if true;
//              allow create: if isSignedIn()
//                && request.auth.uid == uid
//                && request.auth.uid == request.resource.data.uid;
//              allow update: if isSignedIn()
//                && request.auth.uid == uid;
//              allow delete: if false;
//
//              // blocked/{blockedUid}: records that THIS account (uid)
//              // has blocked account `blockedUid`. Only the account
//              // itself may ever read, add to, or remove from its own
//              // block list — nobody can read who someone ELSE has
//              // blocked (so being blocked is never directly visible to
//              // the blocked person), and nobody can write into a block
//              // list that isn't their own.
//              match /blocked/{blockedUid} {
//                allow read: if isSignedIn() && request.auth.uid == uid;
//                allow create: if isSignedIn()
//                  && request.auth.uid == uid
//                  && request.auth.uid != blockedUid
//                  && request.resource.data.blockedUid == blockedUid;
//                allow update: if false;
//                allow delete: if isSignedIn() && request.auth.uid == uid;
//              }
//            }
//
//            match /conversations/{convId} {
//              // `participants` is an array of the two members' Firebase
//              // Auth UIDs (see conversationId/ensureConversation in
//              // app.js) — so request.auth.uid is checked directly
//              // against it, no indirection through any other document.
//              // The `|| !exists(...)` branch matters: ensureConversation()
//              // does a getDoc() to check whether a conversation already
//              // exists BEFORE creating it, and Firestore evaluates
//              // security rules even for a read of a document that
//              // doesn't exist yet — without this branch that check
//              // itself would fail as a permission error instead of
//              // just resolving to "not found".
//              allow read: if isSignedIn()
//                && (!exists(/databases/$(database)/documents/conversations/$(convId))
//                    || request.auth.uid in resource.data.participants);
//              allow create: if isSignedIn()
//                && request.auth.uid in request.resource.data.participants;
//              // Both participants can keep updating shared display
//              // fields (participantsInfo/lastMessage/updatedAt) same as
//              // before, AND their own per-user `hiddenFor` entry (used
//              // by "Remove" to hide a conversation from just one side
//              // without touching the other person's copy of it).
//              allow update: if isSignedIn()
//                && request.auth.uid in resource.data.participants;
//              allow delete: if false;
//
//              match /messages/{msgId} {
//                // Same direct check, just against the PARENT
//                // conversation's participants (individual message docs
//                // don't carry the participants list themselves).
//                allow read: if isSignedIn()
//                  && exists(/databases/$(database)/documents/conversations/$(convId))
//                  && request.auth.uid in conversationDoc(convId).data.participants;
//                // A message may only be created by one of the two
//                // participants, AS themselves (from == the caller —
//                // this stops anyone from forging a message as the
//                // other person), and only while neither side currently
//                // has the other blocked. This is the actual enforcement
//                // point for blocking — the frontend also disables
//                // sending, but THIS is what makes it impossible to
//                // bypass by calling Firestore directly from the browser.
//                allow create: if isSignedIn()
//                  && exists(/databases/$(database)/documents/conversations/$(convId))
//                  && request.auth.uid in conversationDoc(convId).data.participants
//                  && request.resource.data.from == request.auth.uid
//                  && !isBlockedPair(request.auth.uid, otherParticipant(convId, request.auth.uid));
//                // Read receipts: the ONLY update any message doc can
//                // ever receive, and only from the RECIPIENT (never
//                // the sender — this is what stops a sender from
//                // forging their own "read" state). `from`/`text`/`ts`
//                // must come through byte-for-byte unchanged, and
//                // .affectedKeys().hasOnly(['readAt']) means readAt is
//                // structurally the only field this request is even
//                // allowed to touch — there's no way to smuggle any
//                // other change in alongside it.
//                allow update: if isSignedIn()
//                  && exists(/databases/$(database)/documents/conversations/$(convId))
//                  && request.auth.uid in conversationDoc(convId).data.participants
//                  && request.auth.uid != resource.data.from
//                  && request.resource.data.from == resource.data.from
//                  && request.resource.data.text == resource.data.text
//                  && request.resource.data.ts == resource.data.ts
//                  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readAt'])
//                  && request.resource.data.readAt is string;
//                allow delete: if false;
//              }
//            }
//          }
//        }
//      (Every profile document's ID *is* the owning account's Firebase
//      Auth uid — allow create/update: if request.auth.uid == uid is a
//      direct, structural "only you can write your own profile" check.
//      Profiles are still readable by anyone signed in or not, which is
//      what lets People Search work. Conversations and messages are
//      readable/writable ONLY by their two participants, and — unlike an
//      earlier version of this schema — that's now checked by comparing
//      request.auth.uid straight against the `participants` array with
//      no cross-document lookup involved, because `participants` (and
//      each message's `from`) now store UIDs rather than usernames.
//      Username stays a profile/search field only, never the security
//      identity — see usernameLower on the users/{uid} doc, used solely
//      by findUserByUsername()/searchUsers() for People Search.
//
//      SCHEMA ADDITIONS for Remove/Block (see the BLOCKING and
//      RemoveConversation sections further down in this file):
//        - conversations/{convId}.hiddenFor: string[] — Firebase Auth
//          UIDs who have "removed" this conversation from their OWN
//          chat list. It never deletes the conversation or the other
//          person's copy of it — it's purely a per-viewer visibility
//          flag, cleared automatically the next time either side sends
//          a message (see addMessage()), which is what makes starting a
//          fresh conversation with that person "just work" again.
//        - users/{uid}/blocked/{blockedUid}: { blockedUid, blockedUsername,
//          blockedDisplayName, blockedAvatar, createdAt } — one doc per
//          person `uid` has blocked. Denormalized display fields exist
//          so Settings → Privacy → Blocked users can render the list
//          without extra profile reads, the same pattern conversations
//          already use for participantsInfo.
//        - conversations/{convId}/messages/{msgId}.readAt: string ISO
//          timestamp, absent until the RECIPIENT has actually opened
//          the conversation and seen that message (see markMessagesRead
//          in app.js) — never present on messages the signed-in user
//          sent themselves. Older messages written before this field
//          existed simply don't have it, which is indistinguishable
//          from "not read yet" and is treated exactly the same way —
//          nothing needs a one-time migration.)
//
//   6. Realtime Database → Rules, paste EXACTLY this (separate product
//      from Firestore, separate console tab, separate rules language —
//      see the PRESENCE section further down for why online/offline
//      status specifically needs Realtime Database's onDisconnect()
//      instead of anything Firestore offers; the TYPING section below
//      it reuses the exact same connection for a second, independent
//      purpose — typing/{conversationId}/{uid} — hence the second
//      top-level key here):
//        {
//          "rules": {
//            "presence": {
//              "$uid": {
//                ".read": "auth != null",
//                ".write": "auth != null && auth.uid === $uid",
//                ".validate": "newData.hasChildren(['state','lastChanged']) && (newData.child('state').val() === 'online' || newData.child('state').val() === 'offline')"
//              }
//            },
//            "typing": {
//              "$convId": {
//                "$uid": {
//                  ".read": "auth != null",
//                  ".write": "auth != null && auth.uid === $uid",
//                  ".validate": "newData.val() === true"
//                }
//              }
//            }
//          }
//        }
//      (Any authenticated HUM user can READ any presence/{uid} node —
//      that's what lets Chats/People Search/profiles/chat headers show
//      a green dot for someone ELSE. Nobody can WRITE anywhere except
//      their own presence/{their own uid} node — auth.uid === $uid is
//      a direct structural check, the same shape as the Firestore
//      users/{uid} rule above, just in Realtime Database's rules
//      language. .validate rejects anything that isn't exactly the
//      {state, lastChanged} shape this file writes — a value can't be
//      pointed anywhere in the tree except a well-formed presence
//      entry. The typing/ block is the identical read-any/write-own-
//      uid-only shape, just one level deeper (per conversation): any
//      authenticated user can read who's typing in any conversation —
//      the same posture presence already has, and typing never carries
//      more information than presence does (a boolean, not message
//      content) — but a write can only ever land at
//      typing/{convId}/{THEIR OWN uid}, never anyone else's, and
//      .validate only accepts the literal value `true` (this file
//      clears a typing flag by deleting the node entirely — writing
//      `null` — never by writing `false`, so nothing else needs to be
//      a valid write). Nothing here is public/world-writable, and
//      nothing outside presence/ and typing/ is reachable at all:
//      nothing else in this project uses Realtime Database, and paths
//      with no matching rule default to fully denied in Realtime
//      Database, same as Firestore.)
// ===================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile as fbUpdateAuthProfile,
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
  arrayUnion,
  arrayRemove,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import {
  getDatabase,
  ref as rtdbRef,
  set as rtdbSet,
  onValue,
  onDisconnect,
  serverTimestamp as rtdbServerTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// Replace with YOUR OWN Firebase project's config (see setup steps
// above). Every device that opens HUM with this same config is talking
// to the same shared project — that's what makes accounts and messages
// cross-device instead of stuck in one browser.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBv1B4Cuu3vXTr0pCQN9m1Z0URDr4zbpps",
  authDomain: "humuz-57e4d.firebaseapp.com",
  projectId: "humuz-57e4d",
  storageBucket: "humuz-57e4d.firebasestorage.app",
  messagingSenderId: "531135285257",
  appId: "1:531135285257:web:d6ff1c6bc799c5745fd0d8",
  measurementId: "G-5TVDTGLZND",
  // Online/offline presence (see the PRESENCE section further down)
  // lives in Firebase Realtime Database, a separate product from
  // Firestore that this project didn't previously use — it needs its
  // own URL. If the Firebase console's Realtime Database page hasn't
  // been opened for this project yet, open Build → Realtime Database →
  // "Create Database" once (any region is fine); the console will then
  // show you this project's real URL at the top of the Data tab. The
  // value below is the standard default for a database created in the
  // us-central1 region — if your database is in a different region,
  // replace this with the exact URL the console shows you (regional
  // databases end in ".firebasedatabase.app" instead of
  // ".firebaseio.com").
  databaseURL: "https://humuz-57e4d-default-rtdb.firebaseio.com",
};

// A placeholder or malformed value anywhere in FIREBASE_CONFIG is
// exactly what produces the classic symptom of running this file
// unmodified: repeated "identitytoolkit.googleapis.com ... 400"
// errors in the console — the SDK dutifully sending real network
// requests built from credentials that were never real to begin with
// — often alongside a secondary "heartbeats undefined" error. That
// second one isn't an independent bug; it's the SDK's own internal
// usage-ping mechanism riding along on the same doomed request. Both
// stop appearing once real project values are here.
//
// This check exists so that instead of a wall of confusing repeated
// network errors, misconfiguration produces ONE clear, loud, on-screen
// message (see the #firebaseConfigError screen in index.html) and every
// Firebase call is skipped until it's fixed — nothing here is silently
// swallowed, it's surfaced once, clearly, at the source.
function validateFirebaseConfig(config){
  const required = ["apiKey","authDomain","projectId","storageBucket","messagingSenderId","appId"];
  for(const key of required){
    const value = config[key];
    if(!value || typeof value !== "string" || !value.trim()){
      return `FIREBASE_CONFIG.${key} is missing.`;
    }
    if(/YOUR_[A-Z0-9_]+/.test(value)){
      return `FIREBASE_CONFIG.${key} is still the placeholder value ("${value}") — replace it with your real Firebase project's value.`;
    }
  }
  if(!/^AIza[0-9A-Za-z_-]{20,}$/.test(config.apiKey)){
    return `FIREBASE_CONFIG.apiKey ("${config.apiKey}") doesn't look like a real Firebase Web API key — they normally start with "AIza". Double-check you copied it from Project settings → General → "Your apps" in the Firebase console (not a server/admin key from somewhere else).`;
  }
  if(!config.authDomain.includes(".")){
    return `FIREBASE_CONFIG.authDomain ("${config.authDomain}") doesn't look like a valid domain — expected something like "your-project.firebaseapp.com".`;
  }
  if(!/^\d+$/.test(config.messagingSenderId)){
    return `FIREBASE_CONFIG.messagingSenderId ("${config.messagingSenderId}") should be all digits — double-check you copied the right value from the Firebase console.`;
  }
  return null;
}

const FIREBASE_CONFIG_ERROR = validateFirebaseConfig(FIREBASE_CONFIG);
if(FIREBASE_CONFIG_ERROR){
  // Deliberately not suppressed: this is the one clear diagnostic that
  // replaces what would otherwise be a wall of repeated 400s.
  console.error("[HUM] Firebase is not configured:", FIREBASE_CONFIG_ERROR);
}

// Called first thing inside every function that actually talks to
// Firebase (Auth or Firestore). The UI already can't reach any of
// these while FIREBASE_CONFIG_ERROR is set — init() shows the
// dedicated setup screen instead of the auth/app screens — this is a
// second layer of defense so a bad config can never result in a real
// network call, from any code path, now or after future changes.
function requireFirebaseConfig(){
  if(FIREBASE_CONFIG_ERROR){
    throw new Error("Firebase is not configured: " + FIREBASE_CONFIG_ERROR);
  }
}

// initializeApp/getAuth/getFirestore only set up local SDK state — they
// don't touch the network by themselves, so it's safe to call them even
// while FIREBASE_CONFIG_ERROR is set (the rest of the app needs `auth`
// and `db` to exist either way). What's gated below is everything that
// actually reaches Firebase's servers.
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
// Realtime Database, used ONLY for online/offline presence (see the
// PRESENCE section below) — Firestore remains the database of record
// for users/conversations/messages/profiles, completely unchanged.
// Wrapped in try/catch, unlike db/auth above: unlike Firestore/Auth,
// getDatabase() DOES throw synchronously if databaseURL is missing or
// not a well-formed URL — and since this whole file is one module,
// letting that throw escape here would take the ENTIRE app down
// (Firestore accounts/chat included) over a presence-only config
// problem. `rtdb` stays null in that case; every presence function
// below already checks for that and simply skips presence — the rest
// of HUM keeps working exactly as it did before this feature existed.
let rtdb = null;
try {
  rtdb = getDatabase(firebaseApp);
} catch (e) {
  console.error("[HUM] Realtime Database is not configured (online/offline status will be unavailable, everything else is unaffected):", e);
}

if(!FIREBASE_CONFIG_ERROR){
  // Keeps the signed-in session across page reloads/tabs on this device
  // (Firebase's own equivalent of the old hum_session localStorage key —
  // see the onAuthStateChanged listener further down, which is what now
  // decides whether to show the auth screen or go straight into the app
  // on load).
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

// HUM's UI is username/password, but Firebase Authentication is built
// around email/password. Rather than adding a whole second identity
// system, each username deterministically maps to a synthetic email
// that's never shown anywhere in the UI — the person never sees or
// types an "email" at any point.
function emailForUsername(username) {
  return usernameDocId(username) + "@hum.local";
}

/* ===================================================================
   SECTION: PRESENCE (Realtime Database)
   Real online/offline status, backed by Firebase Realtime Database
   instead of Firestore — Firestore has no server-side "this client
   just disconnected" hook, but Realtime Database's onDisconnect() does,
   which is what makes this actually reliable instead of a polling/
   timer guess (closing a tab, losing network, or the process being
   killed all still flip the status to offline once the socket drops
   server-side, with no client-side code needing to run at that moment
   at all).

   Two halves:
     - PUBLISHING: startPresence(uid) — called once someone is signed
       in (see onAuthSuccess / the onAuthStateChanged restore path
       below) — marks presence/{uid} "online" and arms onDisconnect()
       to flip it to "offline" the moment this client's connection to
       Realtime Database's servers drops, for ANY reason. Re-armed
       automatically every time .info/connected flips back to true
       (reconnect after a network blip), so the disconnect handler is
       never stale.
     - SUBSCRIBING: watchPresence(uid, onChange) / watchPresenceForScope
       — used anywhere HUM shows another person's avatar (profile, chat
       header, chat list, People Search) to live-toggle the green dot,
       via a real Realtime Database listener — never a setInterval or
       any other timer-based guess.
=================================================================== */

function presenceRef(uid){
  return rtdbRef(rtdb, 'presence/' + uid);
}

// Set while startPresence() has a live .info/connected listener
// registered, so a second call (e.g. a second onAuthStateChanged
// firing for the same session) can't stack up duplicate listeners.
let presenceConnectedUnsub = null;

// Marks the signed-in user online for as long as this tab/device stays
// connected to Realtime Database, and arms Realtime Database's own
// onDisconnect() so the SERVER (not this client) flips them back to
// offline the instant the connection drops — tab closed, reload,
// navigating away, network loss, the process being killed, anything.
// Safe to call more than once (a stale listener is always torn down
// first via stopPresenceListener()).
function startPresence(uid){
  // rtdb is null when Realtime Database couldn't be initialized (see
  // where it's created above) — presence just stays off in that case
  // rather than throwing, so the rest of HUM (which doesn't depend on
  // it) is completely unaffected.
  if(!rtdb || !uid) return;
  requireFirebaseConfig();
  stopPresenceListener();
  const myPresenceRef = presenceRef(uid);
  const connectedRef = rtdbRef(rtdb, '.info/connected');
  // .info/connected is Realtime Database's own "am I actually connected
  // to the server right now" flag — distinct from "is someone
  // authenticated in this tab" (that's `uid` even being passed in at
  // all, decided by the auth listener below, never by this function).
  // It fires again after every reconnect, which is exactly why
  // onDisconnect() gets re-armed inside this callback instead of once
  // outside it — a disconnect handler only covers the CURRENT
  // connection; a fresh one is needed for each new one.
  presenceConnectedUnsub = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return; // not connected (yet, or anymore) — nothing to arm or set
    // Register onDisconnect() BEFORE writing "online" — arming it
    // first closes the race where the connection could drop in the
    // gap between the two writes, which would otherwise leave this
    // user stuck showing online with no disconnect handler ever having
    // been registered to correct it.
    onDisconnect(myPresenceRef)
      .set({ state: 'offline', lastChanged: rtdbServerTimestamp() })
      .then(() => {
        rtdbSet(myPresenceRef, { state: 'online', lastChanged: rtdbServerTimestamp() });
      })
      .catch((e) => {
        console.error('HUM: failed to arm presence onDisconnect', e);
      });
  }, (e) => {
    console.error('HUM: presence .info/connected listener failed', e);
  });
}

// Detaches this device's own .info/connected listener (does NOT write
// "offline" — that's goOfflineNow()). Used when tearing down the
// signed-in session's own state, e.g. inside stopAllConversationWatchers.
function stopPresenceListener(){
  if(presenceConnectedUnsub){
    presenceConnectedUnsub();
    presenceConnectedUnsub = null;
  }
}

// Explicit, immediate "I'm signing out" — used by logoutUser() below,
// BEFORE calling Firebase Auth's signOut(), while the ID token this
// account is still valid so the Realtime Database rules (which check
// auth.uid === $uid) still allow the write. onDisconnect() would
// eventually reach the same result on its own once the socket drops,
// but that can lag by a little; writing it directly on an intentional
// logout makes the other person's screen update immediately instead of
// waiting on it.
async function goOfflineNow(uid){
  stopPresenceListener();
  if(!rtdb || !uid) return;
  try {
    await rtdbSet(presenceRef(uid), { state: 'offline', lastChanged: rtdbServerTimestamp() });
  } catch(e){
    console.error('HUM: failed to set presence offline on logout', e);
  }
}

// Live-subscribes to one user's presence/{uid} node. onChange receives
// a plain boolean (true = online) — nothing about lastSeen, page-load
// time, or whether the person has ever logged in before factors into
// it; a missing node (nobody has ever published presence for that uid,
// e.g. right after their very first ever login before startPresence()
// finishes its first write) is treated as offline, never online.
// Returns an unsubscribe function (a no-op one if Realtime Database
// isn't available, so callers never need to null-check the return).
function watchPresence(uid, onChange){
  if(!rtdb || !uid){
    onChange(false);
    return () => {};
  }
  return onValue(presenceRef(uid), (snap) => {
    const val = snap.val();
    onChange(!!val && val.state === 'online');
  }, (err) => {
    console.error('HUM: presence listener failed', err);
    onChange(false);
  });
}

// Every screen that lists OTHER people (Chats, People Search, a
// profile, a chat header) re-renders by replacing innerHTML wholesale
// (see renderChatsList/renderPeopleResults/renderProfileHero/
// renderChatHeader) rather than diffing the DOM — so presence
// listeners for whoever was on screen before a re-render have to be
// torn down explicitly, or they'd silently pile up forever. This is
// the shared bookkeeping for that: one bucket of {uid, unsub} per
// named "scope" (one per screen), so each render can cleanly clear its
// own scope's old listeners before attaching new ones.
const presenceWatchersByScope = new Map();

function clearPresenceWatchers(scope){
  const list = presenceWatchersByScope.get(scope);
  if(list) list.forEach(({ unsub }) => unsub());
  presenceWatchersByScope.set(scope, []);
}

// Subscribes to `uid`'s presence and toggles the "avatar--online"
// modifier class (the CSS class that already draws HUM's existing
// green-dot indicator — see .avatar--online::after in style.css) on
// every element inside `container` marked data-presence-uid="uid",
// live, for as long as `scope`'s listeners haven't since been cleared.
function watchPresenceForScope(scope, uid, container){
  const unsub = watchPresence(uid, (isOnline) => {
    if(!container || !container.isConnected) return;
    let selector;
    try {
      selector = `[data-presence-uid="${CSS.escape(uid)}"]`;
    } catch(e){
      return; // uid somehow isn't valid to select on — skip rather than throw
    }
    container.querySelectorAll(selector).forEach((el) => {
      el.classList.toggle('avatar--online', isOnline);
    });
  });
  const list = presenceWatchersByScope.get(scope) || [];
  list.push({ uid, unsub });
  presenceWatchersByScope.set(scope, list);
}

/* ===================================================================
   SECTION: TYPING INDICATOR (Realtime Database)
   A second, independent use of Realtime Database alongside presence
   (same `rtdb` connection, no second Firebase app/database) — typing
   state lives at typing/{conversationId}/{uid}: true, using the exact
   same conversationId(uidA, uidB) pairing already used for Firestore
   conversations/messages, so it needs no new ID scheme. Nothing here
   touches presence/{uid} or any Firestore data; the two systems don't
   share state, only the same underlying connection.

   Two halves, mirroring the presence section above:
     - PUBLISHING: the signed-in user's own "I'm typing" flag —
       driven by the composer's input event (see the chatInput
       listener further down) and a short inactivity timeout, always
       written through setTypingState()/stopMyTyping() so the
       inactivity timer is only ever what decides WHEN to clear it,
       never a substitute for the real Realtime Database write.
     - SUBSCRIBING: startTypingWatcher(convId, otherUid) — watches
       ONLY the other participant's node (never the signed-in user's
       own) and live-swaps the existing chatHeaderHandle text between
       "@username" and the translated "typing…" string.
=================================================================== */

function typingRef(convId, uid){
  return rtdbRef(rtdb, `typing/${convId}/${uid}`);
}

// Writes (or clears, via null) the signed-in user's own typing flag for
// one conversation. Never used to write anyone else's node — every
// call site below passes currentUser().uid, and the Realtime Database
// rules enforce that server-side regardless.
async function setTypingState(convId, uid, isTyping){
  if(!rtdb || !convId || !uid) return;
  try {
    await rtdbSet(typingRef(convId, uid), isTyping ? true : null);
  } catch(e){
    console.error('HUM: failed to update typing state', e);
  }
}

// Live-subscribes to whether `otherUid` is typing in `convId`. Treats
// anything other than an explicit `true` (missing node, null, stale
// data) as "not typing" — same not-a-guess posture as watchPresence().
// Returns an unsubscribe function (a no-op one if Realtime Database
// isn't available).
function watchTyping(convId, otherUid, onChange){
  if(!rtdb || !convId || !otherUid){
    onChange(false);
    return () => {};
  }
  return onValue(typingRef(convId, otherUid), (snap) => {
    onChange(snap.val() === true);
  }, (err) => {
    console.error('HUM: typing listener failed', err);
    onChange(false);
  });
}

// Debounce timer that auto-clears the signed-in user's own typing flag
// after a short pause (see handleComposerTypingInput below) — this
// timer only ever decides WHEN to call setTypingState(false); the
// actual "not typing" fact is still a real Realtime Database write,
// same as everywhere else in this section.
let typingHideTimer = null;
// Which conversation the signed-in user's own typing flag is currently
// set "true" in, if any — lets stopMyTyping() clear exactly that node
// (e.g. the PREVIOUS conversation, right as openChat() switches to a
// new one) without needing to already know which chat is closing.
let typingConvId = null;
// The live listener on the OTHER participant's typing node for
// whichever conversation is currently open (see startTypingWatcher/
// stopTypingWatcher, wired into openChat/leaveActiveChat/logout below).
let typingWatchUnsub = null;

const TYPING_INACTIVITY_MS = 1500;

// Reflects `isTyping` in the existing chat header — swaps
// chatHeaderHandle between the normal "@username" and the translated
// "typing…" string. Reuses that element instead of adding new markup,
// per "without redesigning the UI"; a subtle style hook
// (.chat-header__handle--typing) exists purely for a color/italic
// treatment, no layout change.
function applyTypingIndicatorUI(isTyping){
  if(!els.chatHeaderHandle || !state.activeChatUser) return;
  els.chatHeaderHandle.classList.toggle('chat-header__handle--typing', isTyping);
  els.chatHeaderHandle.textContent = isTyping
    ? t('chat.typingIndicator')
    : '@' + state.activeChatUser.username;
}

// Starts watching `otherUid`'s typing state for `convId` — called from
// openChat() once the conversation being opened is known. Always tears
// down whatever watcher was previously running first (see
// stopTypingWatcher), so switching chats can never leave two watchers
// (old + new) live at once.
function startTypingWatcher(convId, otherUid){
  stopTypingWatcher();
  typingWatchUnsub = watchTyping(convId, otherUid, applyTypingIndicatorUI);
}

// Detaches the "watching the other participant" listener (does NOT
// touch the signed-in user's OWN typing flag — that's stopMyTyping()).
// Also resets the header back to normal so a stale "typing…" can never
// linger once nobody is watching anything to correct it.
function stopTypingWatcher(){
  if(typingWatchUnsub){
    typingWatchUnsub();
    typingWatchUnsub = null;
  }
  applyTypingIndicatorUI(false);
}

// Clears the signed-in user's own "I'm typing" flag, if any is
// currently set — cancels the inactivity timeout and writes
// typing/{convId}/{uid} back to absent. Returns the underlying
// Realtime Database write's promise so a caller that needs the clear
// to actually land before something else happens (logging out, which
// invalidates the write's permission once signOut() completes) can
// await it; every other call site just fires it and moves on.
function stopMyTyping(){
  if(typingHideTimer){
    clearTimeout(typingHideTimer);
    typingHideTimer = null;
  }
  if(!typingConvId) return Promise.resolve();
  const convId = typingConvId;
  typingConvId = null;
  const me = currentUser();
  if(!me) return Promise.resolve();
  return setTypingState(convId, me.uid, false);
}

// Wired to the composer's `input` event (see the chatInput listener
// further down, alongside the existing autoSizeChatInput one). Turns
// raw keystrokes into the typing/{convId}/{uid} writes described in
// the section comment above: typing something sets the flag true and
// (re)arms a short inactivity timeout that clears it; clearing the box
// entirely clears the flag immediately, no timeout needed.
function handleComposerTypingInput(){
  const me = currentUser();
  if(!me || !state.activeChatUser || !els.chatInput) return;
  const convId = conversationId(me.uid, state.activeChatUser.uid);
  const hasText = els.chatInput.value.trim().length > 0;

  if(typingHideTimer){
    clearTimeout(typingHideTimer);
    typingHideTimer = null;
  }

  if(hasText){
    typingConvId = convId;
    setTypingState(convId, me.uid, true);
    typingHideTimer = setTimeout(() => {
      typingHideTimer = null;
      typingConvId = null;
      setTypingState(convId, me.uid, false);
    }, TYPING_INACTIVITY_MS);
  } else {
    typingConvId = null;
    setTypingState(convId, me.uid, false);
  }
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
   Each user's document lives at users/{uid} — the Firebase Auth UID
   is the permanent account identity, since (unlike username) it never
   changes and is never reused. Username is still unique — enforced via
   Firebase Auth's synthetic per-username email at registration (see
   emailForUsername) and via a direct Firestore lookup on username
   *changes* (see updateProfile below; changing username never touches
   Auth or its email) — and still how people search for and look up
   other users, but it's
   just a field on the document now, not the document's address. This
   is what makes a username change a plain field update instead of a
   delete-and-recreate of the whole document — and what makes "the Auth
   account exists but its profile can't be found" structurally
   impossible for a normal signed-in session, since loading your own
   profile never has to guess your current username at all.
=================================================================== */

function usernameDocId(username){
  return String(username || '').trim().toLowerCase();
}

// Loads a profile directly by its document ID (the Auth UID) — this is
// how the signed-in user's OWN profile is loaded (see loadOrRecoverProfile
// and the onAuthStateChanged handler at the bottom of this file), since
// their UID is already known the moment Firebase confirms they're
// signed in, with no need to go via username at all.
async function findUserByUid(uid){
  if(!uid) return null;
  requireFirebaseConfig();
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

// Looks up someone else's profile by username — used for People
// Search results, viewing a profile, and opening a chat. Since the
// document ID is the UID (not the username), this runs as an indexed
// equality query on the usernameLower field rather than a direct
// document read; still a single, cheap, auto-indexed lookup.
async function findUserByUsername(username){
  if(!username) return null;
  requireFirebaseConfig();
  const lower = usernameDocId(username);
  const snap = await getDocs(fbQuery(collection(db, 'users'), where('usernameLower', '==', lower), limit(1)));
  return snap.empty ? null : snap.docs[0].data();
}

// Resolves the signed-in Firebase user's Firestore profile by UID, and
// recovers gracefully if it can't find one — this is the fix for "Auth
// account exists but its Firestore profile is missing":
//   1. Normal case: users/{uid} exists — just return it.
//   2. Migration case: an older profile exists under the *username* as
//      its document ID (from before profiles were keyed by UID). It
//      gets copied onto users/{uid} (tagged with the UID) and the old
//      doc is removed, so this only ever has to happen once per
//      account.
//   3. Last resort: no profile exists anywhere — e.g. a registration
//      that created the Auth account but failed to write its Firestore
//      document (a network blip, rejected security rule, etc). Rather
//      than leaving that account permanently locked out, a minimal
//      profile is reconstructed from what the Auth account itself
//      knows (its username-shaped email) and saved as the real profile
//      going forward.
async function loadOrRecoverProfile(firebaseUser){
  requireFirebaseConfig();

  const byUid = await findUserByUid(firebaseUser.uid);
  if(byUid) return byUid;

  const usernameLower = firebaseUser.email.split('@')[0];

  const legacyRef = doc(db, 'users', usernameLower);
  const legacySnap = await getDoc(legacyRef);
  if(legacySnap.exists()){
    const migrated = { ...legacySnap.data(), uid: firebaseUser.uid };
    await setDoc(doc(db, 'users', firebaseUser.uid), migrated);
    if(usernameLower !== firebaseUser.uid){
      await deleteDoc(legacyRef).catch(() => {});
    }
    return migrated;
  }

  const recovered = {
    uid: firebaseUser.uid,
    username: usernameLower,
    usernameLower,
    displayName: usernameLower,
    displayNameLower: usernameLower,
    bio: '',
    avatar: { type: 'generated' },
    createdAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'users', firebaseUser.uid), recovered);
  return recovered;
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
   conversations/{conversationId} holds the two participants as their
   Firebase Auth UIDs — not usernames — plus a denormalized copy of
   their display info and the last message, so the Chats list can
   render without an extra lookup per row. Using UID here (instead of
   the earlier username-based scheme) is what makes the security rule
   for "am I allowed to read this" a direct, zero-indirection check —
   request.auth.uid in resource.data.participants — with no need to
   bridge through a separate lookup of "whose account is this" inside
   the rule itself. conversationId is a stable, order-independent key
   for a pair of accounts, so "A messages B" and "B messages A" always
   resolve to the same conversation, and a conversation between A and C
   never touches it. Actual messages live in the
   conversations/{id}/messages subcollection, and each message's `from`
   is likewise a UID, not a username.
   participantsInfo/conversationInfo still carry username/displayName/
   avatar — that's just display data for rendering the Chats list and
   chat header, not a security identity. */

function conversationId(uidA, uidB){
  return [uidA, uidB].sort().join('__');
}

function conversationInfo(user){
  return { username: user.username, displayName: user.displayName, avatar: user.avatar || { type:'generated' } };
}

async function ensureConversation(meUser, otherUser){
  requireFirebaseConfig();
  const convId = conversationId(meUser.uid, otherUser.uid);
  const ref = doc(db, 'conversations', convId);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, {
      participants: [meUser.uid, otherUser.uid],
      participantsInfo: {
        [meUser.uid]: conversationInfo(meUser),
        [otherUser.uid]: conversationInfo(otherUser),
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
  const message = { from: meUser.uid, text, ts: new Date().toISOString() };
  await addDoc(collection(db, 'conversations', convId, 'messages'), message);
  await setDoc(doc(db, 'conversations', convId), {
    participantsInfo: {
      [meUser.uid]: conversationInfo(meUser),
    },
    lastMessage: message,
    updatedAt: message.ts,
    // A real message is the clearest possible signal that this
    // conversation is active again — clear BOTH sides' "removed from my
    // chat list" flag (see the BLOCKING/REMOVE section below) so a
    // fresh message always makes the thread reappear for sender and
    // recipient alike, exactly like starting a new conversation should.
    hiddenFor: arrayRemove(meUser.uid, otherUser.uid),
  }, { merge:true });
  return message;
}

// Live-subscribes to one conversation's messages, oldest first. Calls
// onChange(messages) every time the subcollection changes (including
// the very first load) so the open chat updates the moment the other
// person replies, on any device. Returns an unsubscribe function.
// uidA/uidB are Firebase Auth UIDs (see conversationId above). Each
// message object includes `id` (the Firestore doc ID, not part of the
// stored data itself) — read receipts need it to write readAt back to
// the exact right doc; nothing about existing rendering breaks by its
// presence, since renderChatMessages() only ever reads the fields it
// already knew about.
function watchConversationMessages(uidA, uidB, onChange){
  requireFirebaseConfig();
  const convId = conversationId(uidA, uidB);
  const q = fbQuery(collection(db, 'conversations', convId, 'messages'), orderBy('ts', 'asc'));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map(d => ({ ...d.data(), id: d.id })));
  }, (err) => {
    console.error('HUM: message listener failed', err);
    onChange(null, err);
  });
}

// Marks any of `messages` that were sent BY otherUid (i.e., incoming to
// meUid) and don't already have readAt as read — a single batched
// write covers however many unread messages just loaded/arrived at
// once, rather than one round trip per message. Deliberately narrow:
// - Only ever touches messages `from` the OTHER participant — a
//   message meUid sent themselves is never modified here, matching
//   "messages sent by User B themselves should not be modified."
// - Skips anything that already has readAt, so re-running this against
//   messages that haven't actually changed (e.g. the live listener
//   firing again after ITS OWN read-receipt write lands) is always a
//   safe no-op — no repeat writes, and no infinite update loop, since
//   the next snapshot simply won't contain any newly-unread messages.
// - Every write goes through the Firestore rule above, which already
//   independently enforces "only the recipient may set readAt" — this
//   function just avoids attempting writes that rule would reject
//   anyway (e.g. it never tries to mark meUid's own messages read).
async function markMessagesRead(meUid, otherUid, convId, messages){
  requireFirebaseConfig();
  const unread = (messages || []).filter((m) => m.from === otherUid && !m.readAt && m.id);
  if(!unread.length) return;
  const readAt = new Date().toISOString();
  const batch = writeBatch(db);
  unread.forEach((m) => {
    batch.update(doc(db, 'conversations', convId, 'messages', m.id), { readAt });
  });
  try {
    await batch.commit();
  } catch(e){
    console.error('HUM: failed to mark messages as read', e);
  }
}

// Live-subscribes to this user's conversation list, most recently
// active first, using the denormalized participantsInfo/lastMessage so
// the Chats panel can render straight from this snapshot with no
// further reads. Returns an unsubscribe function. uid is the signed-in
// user's Firebase Auth UID — this is the EXACT field the security rule
// checks request.auth.uid against, so it has to be a UID here, not a
// username, or the rule can never match what the query is actually
// filtering on.
function watchUserConversations(uid, onChange){
  requireFirebaseConfig();
  const q = fbQuery(
    collection(db, 'conversations'),
    where('participants', 'array-contains', uid),
    orderBy('updatedAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    const rows = snap.docs
      .map(d => d.data())
      .filter(conv => conv.lastMessage)
      // "Remove" (see removeConversationForMe) hides a conversation from
      // just the person who removed it, by adding their own uid to
      // hiddenFor — the other participant's copy of the same doc, and
      // their own chat list, are completely untouched.
      .filter(conv => !(Array.isArray(conv.hiddenFor) && conv.hiddenFor.includes(uid)))
      .map(conv => {
        const otherUid = conv.participants.find(p => p !== uid) || conv.participants[0];
        const otherInfo = conv.participantsInfo && conv.participantsInfo[otherUid];
        return otherInfo ? { other: otherInfo, otherUid, lastMessage: conv.lastMessage } : null;
      })
      .filter(Boolean);
    onChange(rows);
  }, (err) => {
    console.error('HUM: conversations listener failed', err);
    onChange(null, err);
  });
}

/* ===================================================================
   SECTION: REMOVE / BLOCK (Firestore)
   Two independent, cooperating pieces of per-user state:
     - "Remove" only ever touches conversations/{convId}.hiddenFor — a
       plain per-viewer visibility flag. It never deletes anything and
       never affects the other participant.
     - "Block" is recorded at users/{uid}/blocked/{blockedUid}. It's
       enforced server-side by the Firestore rules pasted at the top of
       this file (a blocked pairing can't create a message in EITHER
       direction), and ALSO immediately hides the conversation from the
       blocker the same way Remove does, since a block implies removal.
   Both directions of "already-open chat" are covered: blocking someone
   disables sending in the chat UI immediately (see applyChatBlockState
   in the UI section), and the security rule rejects the write even if
   something tried to call Firestore directly.
=================================================================== */

// Hides conversation convId from just `uid`'s own chat list — used by
// both removeConversationForMe() and blockUser() below. No-ops quietly
// if the conversation doesn't exist yet (nothing to hide).
async function hideConversationFor(uid, otherUid){
  requireFirebaseConfig();
  const convId = conversationId(uid, otherUid);
  const ref = doc(db, 'conversations', convId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return;
  await setDoc(ref, { hiddenFor: arrayUnion(uid) }, { merge:true });
}

// "Remove a person" — hides the conversation from the signed-in user's
// own chat list only. Does not touch the other participant's account,
// profile, or their copy of the conversation in any way.
async function removeConversationForMe(meUid, otherUid){
  await hideConversationFor(meUid, otherUid);
}

function blockedDocRef(meUid, otherUid){
  return doc(db, 'users', meUid, 'blocked', otherUid);
}

// Blocks otherUser for meUser: writes the block record (this is what
// the Firestore rules check to reject future messages in either
// direction — see the rules comment above) and, since a block implies
// "I don't want to see this conversation anymore", also hides the
// conversation the same way Remove does.
async function blockUser(meUid, otherUser){
  requireFirebaseConfig();
  await setDoc(blockedDocRef(meUid, otherUser.uid), {
    blockedUid: otherUser.uid,
    blockedUsername: otherUser.username,
    blockedDisplayName: otherUser.displayName,
    blockedAvatar: otherUser.avatar || { type:'generated' },
    createdAt: new Date().toISOString(),
  });
  await hideConversationFor(meUid, otherUser.uid).catch((e) => {
    // The block itself already succeeded and is what actually matters
    // for safety (enforced server-side); failing to also hide the
    // now-stale conversation row is a cosmetic follow-up, not a reason
    // to report the whole action as failed.
    console.error('HUM: blocked user but failed to hide conversation', e);
  });
}

// Restores normal messaging with otherUid. Does not un-hide any
// conversation on its own — same as an ordinary Remove, it reappears
// the moment either side sends a new message (see addMessage()).
async function unblockUser(meUid, otherUid){
  requireFirebaseConfig();
  await deleteDoc(blockedDocRef(meUid, otherUid));
}

// Live-subscribes to the signed-in user's own block list. Only ever
// reads users/{uid}/blocked for `uid === the signed-in user` — the
// security rules don't allow reading anyone else's.
function watchBlockedUsers(uid, onChange){
  requireFirebaseConfig();
  const q = fbQuery(collection(db, 'users', uid, 'blocked'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map(d => d.data()));
  }, (err) => {
    console.error('HUM: blocked-users listener failed', err);
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
      loading:'Loading…', moreOptions:'More options',
      remove:'Remove', block:'Block', unblock:'Unblock', confirm:'Confirm'
    },
    errors:{
      network:'Something went wrong connecting to HUM. Check your connection and try again.',
      userNotFound:'That account could not be found.',
      requiresRecentLogin:'Please log out and log back in, then try again.',
      sendFailed:'This message could not be delivered.'
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
      youPrefix:'You: ', blockedNotice:"You've blocked this person.",
      typingIndicator:'Typing...',
      receiptSent:'Sent', receiptRead:'Read'
    },
    menu:{
      remove:'Remove', block:'Block', unblock:'Unblock'
    },
    confirm:{
      removeTitle:'Remove this chat?',
      removeBody:'This removes the conversation from your chat list. {name} will keep their copy of it, and you can start a new conversation with them anytime.',
      blockTitle:'Block {name}?',
      blockBody:"{name} won't be able to message you, and you won't see them in search or your chat list. You can unblock them anytime in Settings.",
      unblockTitle:'Unblock {name}?',
      unblockBody:"{name} will be able to message you again, and will reappear in search."
    },
    settings:{
      title:'Settings',
      language:'Language', languageHint:'Choose the language HUM speaks to you in.',
      appearance:'Appearance', appearanceHint:'Switch between a dark or light signal.',
      dark:'Dark', light:'Light',
      privacy:'Privacy', privacyHint:"People you've blocked can't message you, and you won't see them in search.",
      blockedUsersEmpty:"You haven't blocked anyone.",
      account:'Account', accountHint:'Signed in as {username}.'
    },
    toast:{
      loggedIn:'Welcome back, {name}.', accountCreated:'Account created. Welcome, {name}!',
      loggedOut:'Logged out.', profileSaved:'Profile updated.', langChanged:'Language switched.',
      chatRemoved:'Chat removed.', userBlocked:'{name} has been blocked.', userUnblocked:'{name} has been unblocked.'
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
      loading:'Загрузка…', moreOptions:'Ещё',
      remove:'Удалить', block:'Заблокировать', unblock:'Разблокировать', confirm:'Подтвердить'
    },
    errors:{
      network:'Не удалось подключиться к HUM. Проверьте соединение и попробуйте снова.',
      userNotFound:'Такой аккаунт не найден.',
      requiresRecentLogin:'Выйдите из аккаунта и войдите снова, затем повторите попытку.',
      sendFailed:'Это сообщение не удалось доставить.'
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
      youPrefix:'Вы: ', blockedNotice:'Вы заблокировали этого человека.',
      typingIndicator:'Печатает...',
      receiptSent:'Отправлено', receiptRead:'Прочитано'
    },
    menu:{
      remove:'Удалить', block:'Заблокировать', unblock:'Разблокировать'
    },
    confirm:{
      removeTitle:'Удалить этот чат?',
      removeBody:'Разговор будет удалён из вашего списка чатов. У {name} останется своя копия, и вы всегда сможете начать переписку заново.',
      blockTitle:'Заблокировать {name}?',
      blockBody:'{name} не сможет писать вам, и вы не увидите этого пользователя в поиске или списке чатов. Разблокировать можно в любой момент в Настройках.',
      unblockTitle:'Разблокировать {name}?',
      unblockBody:'{name} снова сможет писать вам и появится в поиске.'
    },
    settings:{
      title:'Настройки',
      language:'Язык', languageHint:'Выберите язык интерфейса HUM.',
      appearance:'Внешний вид', appearanceHint:'Переключение между тёмным и светлым режимом.',
      dark:'Тёмная', light:'Светлая',
      privacy:'Приватность', privacyHint:'Заблокированные пользователи не смогут писать вам и не будут видны в поиске.',
      blockedUsersEmpty:'Вы никого не заблокировали.',
      account:'Аккаунт', accountHint:'Вы вошли как {username}.'
    },
    toast:{
      loggedIn:'С возвращением, {name}.', accountCreated:'Аккаунт создан. Добро пожаловать, {name}!',
      loggedOut:'Вы вышли из аккаунта.', profileSaved:'Профиль обновлён.', langChanged:'Язык изменён.',
      chatRemoved:'Чат удалён.', userBlocked:'{name} заблокирован(а).', userUnblocked:'{name} разблокирован(а).'
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
      loading:'Yuklanmoqda…', moreOptions:'Yana',
      remove:'Olib tashlash', block:'Bloklash', unblock:'Blokdan chiqarish', confirm:'Tasdiqlash'
    },
    errors:{
      network:'HUM bilan bog‘lanishda xatolik yuz berdi. Aloqani tekshirib, qayta urinib ko‘ring.',
      userNotFound:'Bunday akkaunt topilmadi.',
      requiresRecentLogin:'Hisobdan chiqib, qayta kiring va yana urinib ko‘ring.',
      sendFailed:'Bu xabarni yetkazib bo‘lmadi.'
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
      youPrefix:'Siz: ', blockedNotice:'Siz bu odamni bloklagansiz.',
      typingIndicator:'Yozmoqda...',
      receiptSent:'Yuborildi', receiptRead:'Oʻqildi'
    },
    menu:{
      remove:'Olib tashlash', block:'Bloklash', unblock:'Blokdan chiqarish'
    },
    confirm:{
      removeTitle:'Bu suhbat olib tashlansinmi?',
      removeBody:'Suhbat sizning ro‘yxatingizdan olib tashlanadi. {name} da o‘z nusxasi qoladi, va istalgan vaqtda u bilan yangi suhbat boshlashingiz mumkin.',
      blockTitle:'{name} bloklansinmi?',
      blockBody:'{name} sizga xabar yoza olmaydi va u qidiruv yoki suhbatlar ro‘yxatida ko‘rinmaydi. Istalgan vaqtda Sozlamalarda blokdan chiqarishingiz mumkin.',
      unblockTitle:'{name} blokdan chiqarilsinmi?',
      unblockBody:'{name} sizga yana xabar yoza oladi va qidiruvda qayta ko‘rinadi.'
    },
    settings:{
      title:'Sozlamalar',
      language:'Til', languageHint:'HUM siz bilan gaplashadigan tilni tanlang.',
      appearance:'Ko‘rinish', appearanceHint:'Tungi yoki kunduzgi rejim orasida almashing.',
      dark:'Tungi', light:'Kunduzgi',
      privacy:'Maxfiylik', privacyHint:'Siz bloklagan foydalanuvchilar sizga yoza olmaydi va qidiruvda ko‘rinmaydi.',
      blockedUsersEmpty:'Siz hech kimni bloklamagansiz.',
      account:'Akkount', accountHint:'Siz {username} sifatida kirdingiz.'
    },
    toast:{
      loggedIn:'Xush kelibsiz, {name}.', accountCreated:'Akkount yaratildi. Xush kelibsiz, {name}!',
      loggedOut:'Tizimdan chiqdingiz.', profileSaved:'Profil yangilandi.', langChanged:'Til o‘zgartirildi.',
      chatRemoved:'Suhbat olib tashlandi.', userBlocked:'{name} bloklandi.', userUnblocked:'{name} blokdan chiqarildi.'
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
  requireFirebaseConfig();
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
    await setDoc(doc(db, 'users', credential.user.uid), user);
  }catch(e){
    return { ok:false, errors:{ form: t('errors.network') } };
  }

  state.me = user;
  return { ok:true, user };
}

async function loginUser({ username, password }){
  requireFirebaseConfig();
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
  let user;
  try{
    // Loads by UID (with automatic migration/recovery if needed) rather
    // than trusting the username just typed into the form — that's what
    // makes this resilient to the exact "Auth exists, profile doesn't"
    // failure mode instead of just failing the same way again.
    user = await loadOrRecoverProfile(credential.user);
  }catch(e){
    console.error('HUM: failed to load/recover profile after login', e);
    await signOut(auth).catch(() => {});
    return { ok:false, error: t('errors.network') };
  }
  state.me = user;
  return { ok:true, user };
}

async function logoutUser(){
  requireFirebaseConfig();
  // Mark presence offline, and clear any "I'm typing" flag, BEFORE
  // signing out (and before stopAllConversationWatchers, which is what
  // actually tears down the .info/connected and "watching the other
  // participant's typing" listeners) — signOut() invalidates the ID
  // token, and the Realtime Database rules require a still-valid
  // auth.uid to allow writing presence/{uid} or typing/{convId}/{uid},
  // so both have to happen while still signed in.
  if(state.me){
    await goOfflineNow(state.me.uid);
    await stopMyTyping();
  }
  stopAllConversationWatchers();
  await signOut(auth).catch(() => {});
  state.me = null;
}

async function updateProfile(updates){
  requireFirebaseConfig();
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

  // Username uniqueness used to be enforced for free by Firebase Auth's
  // email-already-in-use check, back when a username change also
  // changed the synthetic Auth email it maps to. It no longer touches
  // Auth at all (see below), so uniqueness is now checked directly
  // against Firestore instead — the same lookup People Search uses.
  if(usernameChanged){
    try{
      const existing = await findUserByUsername(nextLower);
      if(existing && existing.uid !== user.uid){
        return { ok:false, errors:{ username: t('auth.validation.usernameTaken') } };
      }
    }catch(e){
      return { ok:false, errors:{ form: t('errors.network') } };
    }
  }

  // Display name is the one piece of this form Firebase Auth itself
  // tracks (auth.currentUser.displayName), so it's kept in sync via
  // Auth's own updateProfile() — never updateEmail(). Username/
  // usernameLower are a Firestore-only concept (see usernameDocId /
  // emailForUsername above) and must NEVER be sent to Firebase Auth as
  // an email change: that's the bug this replaces. The user's Auth
  // email is not read, referenced, or written anywhere in this
  // function, on purpose.
  if(nextDisplayName !== user.displayName){
    try{
      await fbUpdateAuthProfile(auth.currentUser, { displayName: nextDisplayName });
    }catch(e){
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
    // The profile document lives at users/{uid}, and uid never changes,
    // so a username change is now just an ordinary field update on the
    // same document — no more deleting one document and creating
    // another under a different ID, which used to be the exact kind of
    // operation that could leave an account's profile missing if it
    // failed partway through.
    await setDoc(doc(db, 'users', user.uid), updatedUser);
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
  requireFirebaseConfig();
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
    clearPresenceWatchers('peopleResults');
    return;
  }
  if(error){
    container.innerHTML = `<div class="people-results__empty">${escapeHtml(t('errors.network'))}</div>`;
    clearPresenceWatchers('peopleResults');
    return;
  }
  if(!users.length){
    container.innerHTML = `
      <div class="people-results__empty">${query ? escapeHtml(t('people.empty')) : escapeHtml(t('people.hint'))}</div>
    `;
    clearPresenceWatchers('peopleResults');
    return;
  }

  container.innerHTML = users.map(u => `
    <div class="result-row${selectedUsername === u.username ? ' is-active' : ''}" data-username="${escapeHtml(u.username)}" role="button" tabindex="0">
      <div class="avatar" data-presence-uid="${escapeHtml(u.uid)}" style="background:${avatarBg(u)}">${avatarMarkup(u)}</div>
      <div class="result-row__info">
        <div class="result-row__name">${escapeHtml(u.displayName)}</div>
        <div class="result-row__handle">@${escapeHtml(u.username)}</div>
      </div>
      <button type="button" class="btn btn--ghost btn--small" data-username="${escapeHtml(u.username)}" data-action="view">${escapeHtml(t('people.view'))}</button>
    </div>
  `).join('');
  clearPresenceWatchers('peopleResults');
  users.forEach(u => watchPresenceForScope('peopleResults', u.uid, container));
}

function renderProfileHero(container, user, isSelf){
  const joined = formatDate(user.createdAt, getLang());
  container.innerHTML = `
    <div class="profile-hero">
      <div class="avatar" data-presence-uid="${escapeHtml(user.uid)}" style="width:100px;height:100px;font-size:34px;background:${avatarBg(user)}">${avatarMarkup(user)}</div>
      <h2 class="profile-hero__name">${escapeHtml(user.displayName)}${isSelf ? ` <span style="color:var(--text-faint);font-weight:500;font-size:15px;">(${escapeHtml(t('people.you'))})</span>` : ''}</h2>
      <div class="profile-hero__handle">@${escapeHtml(user.username)}</div>
      <p class="profile-hero__bio">${user.bio ? escapeHtml(user.bio) : `<em style="color:var(--text-faint)">${escapeHtml(t('profile.noBio'))}</em>`}</p>
      ${!isSelf ? `
        <div class="profile-hero__actions">
          <button type="button" class="btn btn--primary btn--small" id="btnMessageUser">${escapeHtml(t('profile.message'))}</button>
          <button type="button" class="icon-btn" id="btnProfileMenu" data-i18n-title="common.moreOptions" title="${escapeHtml(t('common.moreOptions'))}" aria-haspopup="true" aria-expanded="false">
            <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>
          </button>
        </div>
      ` : ''}
    </div>
    <div class="profile-meta">
      <div class="profile-meta__row"><span>${escapeHtml(t('common.username'))}</span><span>@${escapeHtml(user.username)}</span></div>
      <div class="profile-meta__row"><span>${escapeHtml(t('profile.joined'))}</span><span>${escapeHtml(joined)}</span></div>
    </div>
  `;
  // Own profile never shows a presence dot (there's nothing informative
  // about telling yourself you're online) — only subscribe for others.
  clearPresenceWatchers('profileView');
  if(!isSelf && user.uid){
    watchPresenceForScope('profileView', user.uid, container);
  }
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
function renderChatsListRow(user, otherUid, lastMessage, meUid){
  const isOwn = lastMessage.from === meUid;
  const prefix = isOwn ? t('chat.youPrefix') : '';
  const previewText = (prefix + lastMessage.text).replace(/\s+/g, ' ').trim();
  return `
    <div class="result-row" data-username="${escapeHtml(user.username)}" role="button" tabindex="0">
      <div class="avatar" data-presence-uid="${escapeHtml(otherUid)}" style="background:${avatarBg(user)}">${avatarMarkup(user)}</div>
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
    clearPresenceWatchers('chatsList');
    return;
  }
  if(state.chatsListError){
    els.chatsListContainer.innerHTML = `
      <div class="people-results__empty">
        ${escapeHtml(t('errors.network'))}
      </div>
    `;
    clearPresenceWatchers('chatsList');
    return;
  }
  if(state.chatsListLoading){
    els.chatsListContainer.innerHTML = `<div class="people-results__hint">${escapeHtml(t('common.loading'))}</div>`;
    clearPresenceWatchers('chatsList');
    return;
  }
  const rows = (state.chatsListRows || []).filter((row) => !state.myBlockedUids.has(row.otherUid));
  if(!rows.length){
    els.chatsListContainer.innerHTML = chatsEmptyStateMarkup();
    clearPresenceWatchers('chatsList');
    return;
  }
  els.chatsListContainer.innerHTML = rows
    .map(({ other, otherUid, lastMessage }) => renderChatsListRow(other, otherUid, lastMessage, me.uid))
    .join('');
  clearPresenceWatchers('chatsList');
  rows.forEach(({ otherUid }) => watchPresenceForScope('chatsList', otherUid, els.chatsListContainer));
}

function renderChatHeader(user){
  if(!els.chatHeaderAvatar) return;
  els.chatHeaderAvatar.style.background = avatarBg(user);
  els.chatHeaderAvatar.innerHTML = avatarMarkup(user);
  els.chatHeaderAvatar.classList.remove('avatar--online'); // reset; watchPresenceForScope below sets it live
  els.chatHeaderAvatar.setAttribute('data-presence-uid', user.uid || '');
  els.chatHeaderName.textContent = user.displayName;
  els.chatHeaderHandle.textContent = '@' + user.username;
  clearPresenceWatchers('chatHeader');
  if(user.uid){
    watchPresenceForScope('chatHeader', user.uid, els.chatHeaderInfo || document);
  }
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
  els.chatMessages.innerHTML = messages
    .map((m) => {
      const isOwn = m.from === me.uid;
      // Read receipts only ever apply to messages the signed-in user
      // sent themselves — an incoming message never shows a
      // ✓/✓✓ mark. `m.readAt` being missing (older messages written
      // before this field existed, or simply "not read yet") is
      // treated the same as explicitly unread — see markMessagesRead
      // and the readAt schema note at the top of this file.
      const receiptMarkup = isOwn
        ? `<span class="chat-msg__receipt${m.readAt ? ' chat-msg__receipt--read' : ''}" title="${escapeHtml(t(m.readAt ? 'chat.receiptRead' : 'chat.receiptSent'))}">${m.readAt ? '✓✓' : '✓'}</span>`
        : '';
      return `
        <div class="chat-msg ${isOwn ? 'chat-msg--own' : 'chat-msg--theirs'}">
          <div class="chat-msg__bubble">${escapeHtml(m.text)}</div>
          <div class="chat-msg__time">${escapeHtml(formatCompactTime(m.ts, getLang()))}${receiptMarkup}</div>
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
  chatHeaderMenuBtn: document.getElementById("chatHeaderMenuBtn"),
  chatBlockedNotice: document.getElementById("chatBlockedNotice"),
  chatBlockedUnblockBtn: document.getElementById("chatBlockedUnblockBtn"),
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
  settingsBlockedList: document.getElementById("settingsBlockedList"),
  themeToggle: document.getElementById("themeToggle"),

  actionMenu: document.getElementById("actionMenu"),
  confirmModalBackdrop: document.getElementById("confirmModalBackdrop"),
  confirmModalTitle: document.getElementById("confirmModalTitle"),
  confirmModalBody: document.getElementById("confirmModalBody"),
  confirmModalCancel: document.getElementById("confirmModalCancel"),
  confirmModalConfirm: document.getElementById("confirmModalConfirm"),

  appShellRoot: document.getElementById("appShell"),
};

let state = {
  me: null, // resolved Firestore profile of the signed-in user (see onAuthReady)
  authReady: false,
  activePanelView: "chats",
  mainView: "welcome",
  viewingUsername: null,
  viewingUser: null, // full profile object for whoever mainProfileView is showing (see openProfileView)
  activeChatUsername: null,
  activeChatUser: null, // full profile object for the open chat's other participant (see openChat)
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

  // The signed-in user's own block list — kept live by
  // watchBlockedUsers() for as long as someone is logged in, the same
  // way chatsListRows is. myBlockedUids is what People Search, the
  // Chats list, and the open-chat composer all check against; the
  // denormalized rows (with display info) back the Settings → Privacy
  // → Blocked users list.
  myBlockedUids: new Set(),
  blockedUsersRows: [],
  blockedUsersLoading: true,
  unsubBlockedUsers: null,

  // Tracks which "⋮" button currently has the shared action-menu
  // popover open, so a click elsewhere (or Escape) can close it and
  // restore aria-expanded on the right element (see openActionMenu/
  // closeActionMenu).
  actionMenuTrigger: null,
};

// Stops any live Firestore listeners this device has open — called on
// logout and when otherwise tearing down the signed-in session, so a
// listener never keeps delivering updates (or errors) for an account
// that's no longer signed in.
function stopAllConversationWatchers(){
  if(state.unsubChatsList){ state.unsubChatsList(); state.unsubChatsList = null; }
  if(state.unsubChatMessages){ state.unsubChatMessages(); state.unsubChatMessages = null; }
  if(state.unsubBlockedUsers){ state.unsubBlockedUsers(); state.unsubBlockedUsers = null; }
  state.chatsListRows = [];
  state.chatsListLoading = true;
  state.chatsListError = false;
  state.chatMessagesData = [];
  state.chatMessagesLoading = true;
  state.chatMessagesError = false;
  state.myBlockedUids = new Set();
  state.blockedUsersRows = [];
  state.blockedUsersLoading = true;
  // Detach this device's own presence .info/connected listener, and
  // every "watching someone else's presence" listener currently open
  // on any screen — nothing about anyone's online status should keep
  // updating once nobody is signed in on this device.
  stopPresenceListener();
  ['chatsList', 'peopleResults', 'profileView', 'chatHeader'].forEach(clearPresenceWatchers);
  // Same idea for the typing indicator: stop watching whoever's typing
  // state was being shown in the (now closing) chat header. Clearing
  // the signed-in user's OWN typing flag is handled separately by
  // logoutUser() (it needs to be awaited before signOut()), not here.
  stopTypingWatcher();
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
  state.unsubChatsList = watchUserConversations(me.uid, (rows, err) => {
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

// Starts (or restarts) the live block-list listener for the signed-in
// user, the same shape as startConversationsWatcher() above. Keeps
// state.myBlockedUids/blockedUsersRows current across devices — e.g.
// blocking someone on one phone hides them from search/chat on a
// laptop signed into the same account within moments, without a
// refresh.
function startBlockedUsersWatcher(){
  if(state.unsubBlockedUsers) state.unsubBlockedUsers();
  const me = currentUser();
  if(!me) return;
  state.blockedUsersLoading = true;
  state.unsubBlockedUsers = watchBlockedUsers(me.uid, (rows, err) => {
    state.blockedUsersLoading = false;
    if(err){
      console.error("HUM: failed to load blocked users", err);
    }else{
      state.blockedUsersRows = rows;
      state.myBlockedUids = new Set(rows.map((r) => r.blockedUid));
    }
    renderBlockedUsersList();
    // The currently open chat (if any) needs to reflect a block that
    // was just added/removed — e.g. on another device — without the
    // person having to navigate away and back.
    if (state.mainView === "chat" && state.activeChatUser) {
      applyChatBlockState();
    }
    // Blocked people should disappear from Chats/People immediately too.
    if (state.activePanelView === "chats") renderChatsList();
    if (state.activePanelView === "people") runPeopleSearch();
  });
}

/* ===================================================================
   SECTION: ACTION MENU + CONFIRM MODAL (reusable UI)
   One popover (#actionMenu) and one modal (#confirmModalBackdrop) in
   index.html, reused everywhere a "⋮ more options" menu or a Remove/
   Block/Unblock confirmation is needed (profile view, chat header,
   Settings → Privacy) instead of building bespoke markup per screen.
=================================================================== */

// Renders `actions` (an array of {label, danger, onSelect}) into the
// shared popover and positions it near `triggerEl`, clamped to the
// viewport so it can never render partly off-screen on a small phone.
function openActionMenu(triggerEl, actions) {
  const menu = els.actionMenu;
  if (!menu || !triggerEl) return;
  menu.innerHTML = actions
    .map(
      (a, i) => `
      <button type="button" class="action-menu__item${a.danger ? " action-menu__item--danger" : ""}" data-index="${i}" role="menuitem">
        ${escapeHtml(a.label)}
      </button>
    `,
    )
    .join("");
  menu.hidden = false;
  menu.querySelectorAll("[data-index]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = actions[Number(btn.getAttribute("data-index"))];
      closeActionMenu();
      if (action && action.onSelect) action.onSelect();
    });
  });

  // Position after render so menu.offsetWidth/offsetHeight are real.
  const rect = triggerEl.getBoundingClientRect();
  const margin = 8;
  let left = rect.right - menu.offsetWidth;
  let top = rect.bottom + margin;
  left = Math.max(margin, Math.min(left, window.innerWidth - menu.offsetWidth - margin));
  if (top + menu.offsetHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - menu.offsetHeight - margin);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  triggerEl.setAttribute("aria-expanded", "true");
  state.actionMenuTrigger = triggerEl;
}

function closeActionMenu() {
  const menu = els.actionMenu;
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = "";
  if (state.actionMenuTrigger) {
    state.actionMenuTrigger.setAttribute("aria-expanded", "false");
    state.actionMenuTrigger = null;
  }
}

// Any click outside the open menu, any Escape press, or the page
// scrolling/resizing closes it — a popover left open and stale is
// worse than one that closes a little eagerly.
document.addEventListener("click", (e) => {
  if (!els.actionMenu || els.actionMenu.hidden) return;
  if (els.actionMenu.contains(e.target)) return;
  if (state.actionMenuTrigger && state.actionMenuTrigger.contains(e.target)) return;
  closeActionMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeActionMenu();
});
window.addEventListener("resize", closeActionMenu);
window.addEventListener("scroll", closeActionMenu, true);

// Shows the shared confirm modal and resolves `true`/`false` depending
// on which button (or backdrop/Escape, treated as cancel) the person
// picks. Every Remove/Block/Unblock action goes through this so none
// of them can fire without an explicit confirmation, per spec.
function openConfirmModal({ title, body, confirmLabel, danger = true }) {
  return new Promise((resolve) => {
    els.confirmModalTitle.textContent = title;
    els.confirmModalBody.textContent = body;
    els.confirmModalCancel.textContent = t("common.cancel");
    els.confirmModalConfirm.textContent = confirmLabel;
    els.confirmModalConfirm.className = "btn " + (danger ? "btn--danger" : "btn--primary");
    els.confirmModalBackdrop.hidden = false;

    const cleanup = (result) => {
      els.confirmModalBackdrop.hidden = true;
      els.confirmModalConfirm.removeEventListener("click", onConfirm);
      els.confirmModalCancel.removeEventListener("click", onCancel);
      els.confirmModalBackdrop.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === els.confirmModalBackdrop) cleanup(false);
    };
    const onKeydown = (e) => {
      if (e.key === "Escape") cleanup(false);
    };
    els.confirmModalConfirm.addEventListener("click", onConfirm);
    els.confirmModalCancel.addEventListener("click", onCancel);
    els.confirmModalBackdrop.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
  });
}

/* ===================================================================
   SECTION: REMOVE / BLOCK — UI actions
   These wrap the Firestore calls from the BLOCKING/REMOVE data-layer
   section above with confirmation, loading/error handling, and
   keeping whatever's currently on screen in sync.
=================================================================== */

// Builds the Remove/Block(-or-Unblock) action list for `otherUser`,
// shared by both the profile-view kebab and the chat-header kebab so
// the two menus can never drift out of sync with each other.
function buildPersonActions(otherUser) {
  const isBlocked = state.myBlockedUids.has(otherUser.uid);
  const actions = [
    {
      label: t("menu.remove"),
      onSelect: () => confirmAndRemoveConversation(otherUser),
    },
  ];
  if (isBlocked) {
    actions.push({
      label: t("menu.unblock"),
      onSelect: () => confirmAndUnblockUser(otherUser),
    });
  } else {
    actions.push({
      label: t("menu.block"),
      danger: true,
      onSelect: () => confirmAndBlockUser(otherUser),
    });
  }
  return actions;
}

async function confirmAndRemoveConversation(otherUser) {
  const me = currentUser();
  if (!me) return;
  const confirmed = await openConfirmModal({
    title: t("confirm.removeTitle"),
    body: t("confirm.removeBody", { name: otherUser.displayName }),
    confirmLabel: t("common.remove"),
    danger: true,
  });
  if (!confirmed) return;

  try {
    await removeConversationForMe(me.uid, otherUser.uid);
  } catch (e) {
    console.error("HUM: failed to remove conversation", e);
    showToast(t("errors.network"), "error");
    return;
  }

  showToast(t("toast.chatRemoved"), "success");
  // If the removed chat is the one currently open, leave it — there's
  // nothing left to show there for this account.
  if (state.activeChatUsername && usernameDocId(state.activeChatUsername) === usernameDocId(otherUser.username)) {
    leaveActiveChat();
  }
}

async function confirmAndBlockUser(otherUser) {
  const me = currentUser();
  if (!me) return;
  const confirmed = await openConfirmModal({
    title: t("confirm.blockTitle", { name: otherUser.displayName }),
    body: t("confirm.blockBody", { name: otherUser.displayName }),
    confirmLabel: t("common.block"),
    danger: true,
  });
  if (!confirmed) return;

  try {
    await blockUser(me.uid, otherUser);
  } catch (e) {
    console.error("HUM: failed to block user", e);
    showToast(t("errors.network"), "error");
    return;
  }

  // watchBlockedUsers() will also deliver this shortly, but updating
  // myBlockedUids immediately means the UI (composer, search, chat
  // list) reflects the block without waiting on the round trip.
  state.myBlockedUids.add(otherUser.uid);
  showToast(t("toast.userBlocked", { name: otherUser.displayName }), "success");
  if (state.activeChatUsername && usernameDocId(state.activeChatUsername) === usernameDocId(otherUser.username)) {
    leaveActiveChat();
  } else if (state.activePanelView === "chats") {
    renderChatsList();
  } else if (state.activePanelView === "people") {
    runPeopleSearch();
  }
}

async function confirmAndUnblockUser(otherUser) {
  const me = currentUser();
  if (!me) return;
  const confirmed = await openConfirmModal({
    title: t("confirm.unblockTitle", { name: otherUser.displayName }),
    body: t("confirm.unblockBody", { name: otherUser.displayName }),
    confirmLabel: t("common.unblock"),
    danger: false,
  });
  if (!confirmed) return;

  try {
    await unblockUser(me.uid, otherUser.uid);
  } catch (e) {
    console.error("HUM: failed to unblock user", e);
    showToast(t("errors.network"), "error");
    return;
  }

  state.myBlockedUids.delete(otherUser.uid);
  showToast(t("toast.userUnblocked", { name: otherUser.displayName }), "success");
  if (state.mainView === "chat" && state.activeChatUser && state.activeChatUser.uid === otherUser.uid) {
    applyChatBlockState();
  }
  if (state.mainView === "profileView" && state.viewingUser && state.viewingUser.uid === otherUser.uid) {
    renderProfileHero(els.mainProfileView, state.viewingUser, false);
  }
}

// Leaves whatever chat is currently open and returns to the Chats
// list — used after Remove/Block make the open conversation no longer
// something this account should keep looking at.
function leaveActiveChat() {
  if (state.unsubChatMessages) {
    state.unsubChatMessages();
    state.unsubChatMessages = null;
  }
  // Typing indicator: leaving the chat entirely is the same "stop
  // watching / stop publishing" cleanup as switching chats (see
  // openChat), there's just no new conversation to start watching
  // afterwards.
  stopMyTyping();
  stopTypingWatcher();
  state.activeChatUsername = null;
  state.activeChatUser = null;
  state.chatMessagesData = [];
  setPanelView("chats");
  setMainView("welcome");
  closeMobileDetail();
}

// Shows/hides the "you've blocked this person" notice and disables the
// composer for the currently open chat, based on state.myBlockedUids.
// Called right after openChat() loads a conversation, and again any
// time the block list itself changes (see startBlockedUsersWatcher)
// so it can never go stale while a chat stays open.
function applyChatBlockState() {
  const other = state.activeChatUser;
  const blocked = !!(other && state.myBlockedUids.has(other.uid));
  if (els.chatBlockedNotice) els.chatBlockedNotice.hidden = !blocked;
  if (els.chatInput) els.chatInput.disabled = blocked;
  if (els.chatSendBtn) els.chatSendBtn.disabled = blocked;
  if (blocked && els.chatInput) els.chatInput.value = "";
  // A disabled composer can no longer fire "input" events, so nothing
  // would otherwise clear a typing flag left over from just before the
  // block took effect — clear it explicitly here too.
  if (blocked) stopMyTyping();
}

els.chatBlockedUnblockBtn &&
  els.chatBlockedUnblockBtn.addEventListener("click", () => {
    if (state.activeChatUser) confirmAndUnblockUser(state.activeChatUser);
  });

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
  startBlockedUsersWatcher();
  startPresence(user.uid);
}

async function doLogout() {
  await logoutUser();
  state.mainView = "welcome";
  state.activePanelView = "chats";
  state.viewingUsername = null;
  state.viewingUser = null;
  state.activeChatUsername = null;
  state.activeChatUser = null;
  closeActionMenu();
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
    // Blocked people are excluded from search entirely — they're not
    // just hidden with a note, they simply don't come up, same as the
    // signed-in user's own account already doesn't.
    const visibleResults = results.filter((u) => !state.myBlockedUids.has(u.uid));
    renderPeopleResults(els.peopleResults, visibleResults, {
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
  state.viewingUser = user;
  renderProfileHero(els.mainProfileView, user, false);
  setMainView("profileView");
  runPeopleSearch();
  if (navigate) openMobileDetail();
}

/* ================= CHAT ================= */
// The "Message" button and "⋮" menu both live inside profile-hero
// markup that gets rebuilt on every render, so their clicks are
// handled here via delegation on the stable container instead of
// being rebound each time.
els.mainProfileView.addEventListener("click", (e) => {
  const menuBtn = e.target.closest("#btnProfileMenu");
  if (menuBtn) {
    e.stopPropagation();
    if (state.viewingUser) openActionMenu(menuBtn, buildPersonActions(state.viewingUser));
    return;
  }
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
  state.activeChatUser = other;
  renderChatHeader(other);
  applyChatBlockState();
  setMainView("chat");
  if (navigate) openMobileDetail();
  // Clear any leftover draft from a previously open conversation so text
  // typed for one person never leaks into a different person's chat.
  if (els.chatInput) els.chatInput.value = "";
  autoSizeChatInput();

  // Deterministic from the pair of UIDs (see conversationId above) —
  // computed once here and reused below for both the typing watcher and
  // read receipts, instead of each recomputing it separately.
  const convId = conversationId(me.uid, other.uid);

  // Typing indicator: clear the signed-in user's own "typing" flag in
  // whichever conversation was open before this one (stopMyTyping()
  // already knows which, via typingConvId — see the TYPING section),
  // then swap the "watching the other participant" listener over to
  // this new conversation instead of the old one. renderChatHeader()
  // above already set the header to the plain "@username" for the
  // person being opened; this may immediately override it with
  // "typing…" if they happen to already be mid-message.
  stopMyTyping();
  startTypingWatcher(convId, other.uid);

  // Make sure the conversation document itself exists BEFORE watching
  // its messages subcollection. This matters for the very first time
  // two people open a chat with each other (no messages sent yet): the
  // Firestore security rules for the messages subcollection have to
  // verify membership by reading the parent conversation doc's
  // participants — and Firestore evaluates security rules even for a
  // read of a document that doesn't exist yet, which fails as
  // "Missing or insufficient permissions" rather than quietly
  // returning "not found". Ensuring the parent exists first removes
  // that edge case entirely, for both people, every time.
  try {
    await ensureConversation(me, other);
  } catch (e) {
    console.error("HUM: failed to prepare conversation", e);
    state.chatMessagesError = true;
    state.chatMessagesLoading = false;
    renderChatMessages();
    return;
  }

  // Swap in a live listener for this conversation's messages — this is
  // what makes a message the other person sends from their own device
  // appear here without needing to reopen the chat or refresh.
  if (state.unsubChatMessages) state.unsubChatMessages();
  state.chatMessagesData = [];
  state.chatMessagesLoading = true;
  state.chatMessagesError = false;
  renderChatMessages();
  const watchedUsername = other.username;
  state.unsubChatMessages = watchConversationMessages(me.uid, other.uid, (messages, err) => {
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
      // Read receipts: this fires for BOTH the initial load and every
      // subsequent live update (a new incoming message arriving while
      // the chat stays open included) — exactly the two moments the
      // feature needs to mark things read. Fire-and-forget: nothing in
      // the UI needs to wait on this write, and markMessagesRead()
      // itself is a safe no-op if there's nothing new to mark.
      if (!err) markMessagesRead(me.uid, other.uid, convId, messages);
    }
  });
}

// Clicking the chat header jumps back to that person's profile — a
// normal messenger pattern, and it reuses the existing profile view
// instead of adding a new screen.
els.chatHeaderInfo.addEventListener("click", () => {
  if (state.activeChatUsername) openProfileView(state.activeChatUsername, true);
});

// The "⋮" button lives inside the same clickable header, so its click
// must not also trigger the "jump to profile" handler above.
els.chatHeaderMenuBtn &&
  els.chatHeaderMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.activeChatUser) openActionMenu(els.chatHeaderMenuBtn, buildPersonActions(state.activeChatUser));
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
  // Extra client-side guard on top of the security rule: the composer
  // is already disabled while blocked (see applyChatBlockState), this
  // just makes sure a queued Enter keypress can't slip a send through.
  if (state.activeChatUser && state.myBlockedUids.has(state.activeChatUser.uid)) return;
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
  // Setting .value directly (as opposed to the person deleting text
  // themselves) doesn't fire an "input" event, so the typing flag has
  // to be cleared explicitly here too — otherwise it would just sit
  // "true" until the inactivity timeout eventually caught up.
  stopMyTyping();

  let other;
  try {
    other = await findUserByUsername(otherUsername);
    if (!other) throw new Error("recipient not found");
    await addMessage(me, other, text);
  } catch (e) {
    console.error("HUM: failed to send message", e);
    // permission-denied here almost always means the Firestore rules
    // rejected the write — most commonly because the other person has
    // blocked this account (or this account has blocked them). Shown
    // as a generic "couldn't be delivered" message rather than "you've
    // been blocked", since whether someone blocked you isn't something
    // HUM reveals to the blocked person.
    const isPermissionError = e && (e.code === "permission-denied" || /permission/i.test(e.message || ""));
    showToast(isPermissionError ? t("errors.sendFailed") : t("errors.network"), "error");
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
els.chatInput.addEventListener("input", handleComposerTypingInput);
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

// Renders Settings → Privacy → Blocked users from state.blockedUsersRows
// (kept live by startBlockedUsersWatcher/watchBlockedUsers). Each row's
// display info is denormalized onto the block doc itself (see
// blockUser()), so this never needs an extra profile fetch per row.
function renderBlockedUsersList() {
  if (!els.settingsBlockedList) return;
  if (state.blockedUsersLoading) {
    els.settingsBlockedList.innerHTML = `<div class="blocked-list__empty">${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  const rows = state.blockedUsersRows || [];
  if (!rows.length) {
    els.settingsBlockedList.innerHTML = `<div class="blocked-list__empty">${escapeHtml(t("settings.blockedUsersEmpty"))}</div>`;
    return;
  }
  els.settingsBlockedList.innerHTML = rows
    .map((row) => {
      const displayUser = { username: row.blockedUsername, displayName: row.blockedDisplayName, avatar: row.blockedAvatar };
      return `
        <div class="result-row" data-blocked-uid="${escapeHtml(row.blockedUid)}">
          <div class="avatar" style="background:${avatarBg(displayUser)}">${avatarMarkup(displayUser)}</div>
          <div class="result-row__info">
            <div class="result-row__name">${escapeHtml(row.blockedDisplayName)}</div>
            <div class="result-row__handle">@${escapeHtml(row.blockedUsername)}</div>
          </div>
          <button type="button" class="btn btn--ghost btn--small" data-action="unblock" data-uid="${escapeHtml(row.blockedUid)}" data-username="${escapeHtml(row.blockedUsername)}" data-name="${escapeHtml(row.blockedDisplayName)}">
            ${escapeHtml(t("common.unblock"))}
          </button>
        </div>
      `;
    })
    .join("");
}
els.settingsBlockedList &&
  els.settingsBlockedList.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="unblock"]');
    if (!btn) return;
    confirmAndUnblockUser({
      uid: btn.getAttribute("data-uid"),
      username: btn.getAttribute("data-username"),
      displayName: btn.getAttribute("data-name"),
    });
  });

function openSettings() {
  const me = currentUser();
  if (me) updateSettingsAccountHint(me.username);
  renderBlockedUsersList();
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
  if (FIREBASE_CONFIG_ERROR) {
    // Nothing below this can work without real Firebase config — show
    // one clear, unmissable screen instead of a broken lang/auth flow
    // that would just be quietly failing on every interaction.
    els.langScreen.hidden = true;
    els.authScreen.hidden = true;
    els.appShell.hidden = true;
    const detailEl = document.getElementById("firebaseConfigErrorDetail");
    if (detailEl) detailEl.textContent = FIREBASE_CONFIG_ERROR;
    document.getElementById("firebaseConfigError").hidden = false;
    return;
  }

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
//
// Only registered when the config is valid — with a placeholder/bad
// config this call is itself one of the things that can reach the
// network, so it's skipped entirely rather than firing and failing.
if (!FIREBASE_CONFIG_ERROR) {
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

    // onAuthSuccess() (called right after a successful login/register)
    // already set state.me and entered the app immediately for instant
    // feedback — this listener firing right afterwards for the same
    // account is expected and harmless, just skip redoing the same
    // work twice. Compared by UID (not username) since UID is the
    // stable identity — it stays correct even mid-session right after
    // a username change, which comparing usernames would not.
    if (state.authReady && state.me && state.me.uid === firebaseUser.uid) {
      return;
    }

    try {
      // loadOrRecoverProfile resolves by UID and self-heals if the
      // profile is missing (migrating an older username-keyed profile,
      // or reconstructing a minimal one) instead of just failing —
      // this is what fixes "Auth account exists, Firestore profile
      // doesn't" instead of merely reporting it.
      const user = await loadOrRecoverProfile(firebaseUser);
      state.me = user;
      state.authReady = true;
      enterApp();
      startConversationsWatcher();
      startBlockedUsersWatcher();
      startPresence(user.uid);
    } catch (e) {
      console.error("HUM: failed to load or recover profile for existing session", e);
      state.authReady = true;
      state.me = null;
      els.appShell.hidden = true;
      els.authScreen.hidden = false;
      showAuthTab("login");
      setFieldError("loginForm", t("errors.network"));
    }
  });
}

// This <script> tag is an ES module, so it's deferred automatically —
// the DOM is already fully parsed by the time this runs, same
// guarantee the old plain <script> at the end of <body> had. Calling
// init() directly (no DOMContentLoaded listener needed) avoids the
// failure mode where that event has already fired before a listener
// for it gets attached.
init();