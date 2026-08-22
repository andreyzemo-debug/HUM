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
//            // The six reactions HUM supports — must stay in sync with
//            // REACTION_EMOJIS in app.js.
//            function REACTION_EMOJIS(){ return ['❤️','👍','😂','😮','😢','🔥']; }
//            function reactionUids(m, emoji){ return (emoji in m) ? m[emoji] : []; }
//            // True only if `before` -> `after` is EXACTLY: one uid
//            // (== request.auth.uid) added to, or removed from, ONE
//            // emoji's array — nothing else in `reactions` changed.
//            function isValidReactionsChange(before, after, uid){
//              let b = ('reactions' in before) ? before.reactions : {};
//              let a = ('reactions' in after) ? after.reactions : {};
//              let changed = a.diff(b).affectedKeys();
//              return changed.size() == 1
//                && a.keys().hasOnly(REACTION_EMOJIS())
//                && b.keys().hasOnly(REACTION_EMOJIS())
//                && (
//                  ('❤️' in changed && isSelfToggle(reactionUids(b,'❤️'), reactionUids(a,'❤️'), uid)) ||
//                  ('👍' in changed && isSelfToggle(reactionUids(b,'👍'), reactionUids(a,'👍'), uid)) ||
//                  ('😂' in changed && isSelfToggle(reactionUids(b,'😂'), reactionUids(a,'😂'), uid)) ||
//                  ('😮' in changed && isSelfToggle(reactionUids(b,'😮'), reactionUids(a,'😮'), uid)) ||
//                  ('😢' in changed && isSelfToggle(reactionUids(b,'😢'), reactionUids(a,'😢'), uid)) ||
//                  ('🔥' in changed && isSelfToggle(reactionUids(b,'🔥'), reactionUids(a,'🔥'), uid))
//                );
//            }
//            // True if `after` is `before` with exactly `uid` added
//            // (nothing removed), OR exactly `uid` removed (nothing
//            // added) — i.e. one person toggling their own reaction.
//            function isSelfToggle(before, after, uid){
//              return (after.size() == before.size() + 1 && after.removeAll(before).hasOnly([uid]))
//                || (before.size() == after.size() + 1 && before.removeAll(after).hasOnly([uid]));
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
//                // Three, and ONLY three, shapes of update are ever
//                // allowed on a message doc — every other field
//                // (from/text/ts/type/voicePath/…) is permanently
//                // immutable once created, in every one of them:
//                //   (A) Read receipts — RECIPIENT only (never the
//                //       sender, which is what stops a sender forging
//                //       their own "read" state), touching readAt and
//                //       nothing else. Unchanged from before.
//                //   (B) "Delete for me" — EITHER participant, on ANY
//                //       message in the conversation (their own sent
//                //       messages included — it's a personal
//                //       visibility flag, not a content change),
//                //       touching ONLY deletedFor, and only ever
//                //       adding their OWN uid to it (arrayUnion — see
//                //       deleteMessageForMe in app.js — already
//                //       guarantees the resulting array only differs
//                //       by that one uid). This mirrors
//                //       conversations.hiddenFor's existing "Remove"
//                //       pattern above, just one level deeper.
//                //   (C) "Delete for everyone" — the message's own
//                //       SENDER only, touching ONLY deletedForEveryone,
//                //       and only ever setting it to literal `true`
//                //       (never back to false, never alongside any
//                //       other change) — a one-way tombstone flag, not
//                //       an actual content rewrite. Rendering (see
//                //       renderChatMessages in app.js) is what actually
//                //       hides the original text/voicePath/etc. once
//                //       this is set; they still physically exist in
//                //       the doc, exactly like readAt's approach.
//                allow update: if isSignedIn()
//                  && exists(/databases/$(database)/documents/conversations/$(convId))
//                  && request.auth.uid in conversationDoc(convId).data.participants
//                  && (
//                    (request.auth.uid != resource.data.from
//                      && request.resource.data.from == resource.data.from
//                      && request.resource.data.text == resource.data.text
//                      && request.resource.data.ts == resource.data.ts
//                      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readAt'])
//                      && request.resource.data.readAt is string)
//                    ||
//                    (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['deletedFor'])
//                      && request.auth.uid in request.resource.data.deletedFor)
//                    ||
//                    (request.auth.uid == resource.data.from
//                      && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['deletedForEveryone'])
//                      && request.resource.data.deletedForEveryone == true)
//                    ||
//                    // (D) Reactions — EITHER participant, touching ONLY
//                    //     the `reactions` map, and only ever adding/
//                    //     removing THEIR OWN uid from exactly one
//                    //     emoji's array (see isValidReactionsChange
//                    //     below) — never another participant's uid,
//                    //     never more than one emoji at a time, never a
//                    //     key outside the six supported emoji.
//                    (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions'])
//                      && isValidReactionsChange(resource.data, request.resource.data, request.auth.uid))
//                  );
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
//          nothing needs a one-time migration.
//        - conversations/{convId}/messages/{msgId} may also carry
//          { type: 'voice', voicePath, voiceMimeType, voiceDuration }
//          instead of ordinary text (text stays '' on these — see
//          sendVoiceMessage in app.js). No rule change was needed for
//          this: the create rule above already allows a message to
//          carry whatever fields request.resource.data has as long as
//          `from` and the block check pass, and the update rule (read
//          receipts) only constrains from/text/ts staying identical —
//          text on a voice message is '' both before and after a
//          read-receipt update, so that already holds. The actual
//          audio bytes never touch Firestore at all — they live in
//          Supabase Storage; voicePath is only ever a pointer to them.
//        - conversations/{convId}/messages/{msgId}.deletedFor: string[]
//          — same per-viewer "hidden from just this account's own
//          view" pattern as conversations.hiddenFor, just on a single
//          message instead of a whole conversation (see
//          deleteMessageForMe/renderChatMessages in app.js). Either
//          participant can add their own uid, to ANY message
//          (including one they sent themselves); nobody else's
//          messages ever change, and the other participant's copy of
//          this exact message is completely unaffected.
//        - conversations/{convId}/messages/{msgId}.deletedForEveryone:
//          true — a one-way tombstone flag the message's own SENDER
//          (and only the sender) can set (see
//          deleteMessageForEveryone in app.js). Once set,
//          renderChatMessages() shows "This message was deleted" for
//          BOTH participants instead of the original content — the
//          original text/voicePath/etc. are left alone in Firestore,
//          exactly like readAt's approach above, they're simply never
//          displayed once tombstoned. (A tombstoned voice message's
//          underlying Supabase audio file is intentionally left alone
//          too — out of scope for this pass.))
//        - conversations/{convId}/messages/{msgId}.reactions: map of
//          emoji -> string[] of reactor UIDs, e.g.
//          { "❤️": ["uid1","uid2"], "😂": ["uid3"] } — see the
//          MESSAGE REACTIONS section in app.js
//          (toggleMessageReaction/reactionsBarMarkup). Any participant
//          may add/remove ONLY their own uid, from ONE emoji at a
//          time, via arrayUnion/arrayRemove nested one level inside a
//          setDoc({merge:true}) — see isValidReactionsChange above for
//          the exact server-side shape this is restricted to. Works
//          identically for every message type (text/voice/image/file)
//          since it's just another field on the same doc; a tombstoned
//          ("delete for everyone") message keeps its `reactions` data
//          in Firestore untouched, renderChatMessages() simply stops
//          displaying it once deletedForEveryone is set, same as it
//          already does for the original bubble content.
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

// Supabase — used ONLY for voice-message audio file storage (see the
// SUPABASE VOICE STORAGE section further down). Firestore/Realtime
// Database above remain HUM's actual backend for everything else;
// nothing here reads or writes anything except blobs in the
// `voice-messages` bucket. esm.sh serves a real ESM build, so this
// works the same "just an <script type=module> import, no bundler" way
// every Firebase import above does — no new <script> tag, no build
// step, no second app architecture.
import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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
function validateFirebaseConfig(config) {
  const required = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ];
  for (const key of required) {
    const value = config[key];
    if (!value || typeof value !== "string" || !value.trim()) {
      return `FIREBASE_CONFIG.${key} is missing.`;
    }
    if (/YOUR_[A-Z0-9_]+/.test(value)) {
      return `FIREBASE_CONFIG.${key} is still the placeholder value ("${value}") — replace it with your real Firebase project's value.`;
    }
  }
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(config.apiKey)) {
    return `FIREBASE_CONFIG.apiKey ("${config.apiKey}") doesn't look like a real Firebase Web API key — they normally start with "AIza". Double-check you copied it from Project settings → General → "Your apps" in the Firebase console (not a server/admin key from somewhere else).`;
  }
  if (!config.authDomain.includes(".")) {
    return `FIREBASE_CONFIG.authDomain ("${config.authDomain}") doesn't look like a valid domain — expected something like "your-project.firebaseapp.com".`;
  }
  if (!/^\d+$/.test(config.messagingSenderId)) {
    return `FIREBASE_CONFIG.messagingSenderId ("${config.messagingSenderId}") should be all digits — double-check you copied the right value from the Firebase console.`;
  }
  return null;
}

const FIREBASE_CONFIG_ERROR = validateFirebaseConfig(FIREBASE_CONFIG);
if (FIREBASE_CONFIG_ERROR) {
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
function requireFirebaseConfig() {
  if (FIREBASE_CONFIG_ERROR) {
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
  console.error(
    "[HUM] Realtime Database is not configured (online/offline status will be unavailable, everything else is unaffected):",
    e,
  );
}

if (!FIREBASE_CONFIG_ERROR) {
  // Keeps the signed-in session across page reloads/tabs on this device
  // (Firebase's own equivalent of the old hum_session localStorage key —
  // see the onAuthStateChanged listener further down, which is what now
  // decides whether to show the auth screen or go straight into the app
  // on load).
  setPersistence(auth, browserLocalPersistence).catch(() => {});
}

/* ===================================================================
   SUPABASE VOICE STORAGE (config + client)
   Firebase Auth/Firestore/Realtime Database remain HUM's actual
   backend for everything — accounts, conversations, messages,
   presence, typing, read receipts, all of it. Supabase is added here
   for exactly ONE thing: storing the audio file behind a voice
   message (see the VOICE MESSAGES section further down). Firestore
   still stores the message document itself (from/ts/type/voicePath/…,
   see addMessage), same as every other message — only the audio bytes
   live in Supabase Storage.

   Fill these in from your Supabase project → Settings → API. Only the
   public anon key belongs here — NEVER the service-role key, which
   bypasses Row Level Security entirely and must never reach the
   browser.
=================================================================== */
const SUPABASE_URL = "https://hhszykwqoihrmhezaflf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oK6aucnFxyzHUb38rrAsJw_y6cEBhhU";
const VOICE_BUCKET = "voice-messages";
// File & Photo Attachments (see the ATTACHMENTS section further down)
// use a SEPARATE bucket from voice messages — deliberately not mixed
// into voice-messages — same Supabase project, same anon-key client,
// same anonymous-auth mechanism (ensureSupabaseAuth below), just a
// different bucket name and a different Storage policy scope. Requires
// its own one-time bucket + policy setup in the Supabase console,
// mirroring voice-messages' (see the setup notes near
// uploadChatFileBlob further down for the exact policies).
const CHAT_FILES_BUCKET = "chat-files";
// Maximum size, per file, accepted for a File/Photo attachment — change
// this single constant to raise or lower the limit; it's enforced
// client-side in validateAttachmentFile() before any upload is even
// attempted (see the ATTACHMENTS section further down).
const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

const SUPABASE_CONFIGURED =
  !!SUPABASE_URL &&
  !!SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes("YOUR_SUPABASE") &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

// Wrapped in try/catch for the same reason `rtdb`'s init is above: this
// whole file is one module, so letting a Supabase init error escape
// here would take down HUM entirely over a voice-message-only config
// problem. `supabase` stays null in that case; every voice-message
// function below already checks for that and fails toward "voice
// messages are unavailable" rather than crashing anything else.
let supabase = null;
if (SUPABASE_CONFIGURED) {
  try {
    supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error(
      "[HUM] Supabase failed to initialize (voice messages will be unavailable):",
      e,
    );
  }
} else {
  console.warn(
    "[HUM] Supabase is not configured — voice messages are disabled until SUPABASE_URL/SUPABASE_ANON_KEY are filled in above.",
  );
}

// Your `voice-messages` bucket's policies ("authenticated users" for
// INSERT/SELECT) check SUPABASE's own auth state — a Supabase-issued
// JWT with role "authenticated" — not Firebase's. HUM's actual sign-in
// stays 100% Firebase (this never touches a Firebase credential and
// doesn't add a second user-facing auth system); it just means a
// browser that's only ever signed into Firebase still looks like the
// anonymous `anon` role to Supabase, which your policies don't grant
// storage access to. The standard, secure way to satisfy "Supabase
// sees this request as authenticated" using ONLY the public anon key —
// no service-role key, no separate signup/login flow, nothing visible
// to the HUM user — is one silent anonymous Supabase sign-in per
// browser session, done here before the first storage call.
// REQUIRES a one-time setting in Supabase: Authentication → Sign In /
// Providers → enable "Allow anonymous sign-ins". Without that toggled
// on, every upload/playback below will fail even with a correct URL
// and anon key, since there'd be nothing for this to sign in AS.
let supabaseAuthReady = null;
function ensureSupabaseAuth() {
  if (!supabase) return Promise.resolve(false);
  if (supabaseAuthReady) return supabaseAuthReady;
  supabaseAuthReady = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (data && data.session) return true;
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      return true;
    } catch (e) {
      console.error(
        "[HUM] Supabase anonymous sign-in failed (voice messages will be unavailable):",
        e,
      );
      supabaseAuthReady = null; // let the next attempt retry instead of staying stuck on one failure
      return false;
    }
  })();
  return supabaseAuthReady;
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

function presenceRef(uid) {
  return rtdbRef(rtdb, "presence/" + uid);
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
function startPresence(uid) {
  // rtdb is null when Realtime Database couldn't be initialized (see
  // where it's created above) — presence just stays off in that case
  // rather than throwing, so the rest of HUM (which doesn't depend on
  // it) is completely unaffected.
  if (!rtdb || !uid) return;
  requireFirebaseConfig();
  stopPresenceListener();
  const myPresenceRef = presenceRef(uid);
  const connectedRef = rtdbRef(rtdb, ".info/connected");
  // .info/connected is Realtime Database's own "am I actually connected
  // to the server right now" flag — distinct from "is someone
  // authenticated in this tab" (that's `uid` even being passed in at
  // all, decided by the auth listener below, never by this function).
  // It fires again after every reconnect, which is exactly why
  // onDisconnect() gets re-armed inside this callback instead of once
  // outside it — a disconnect handler only covers the CURRENT
  // connection; a fresh one is needed for each new one.
  presenceConnectedUnsub = onValue(
    connectedRef,
    (snap) => {
      if (snap.val() !== true) return; // not connected (yet, or anymore) — nothing to arm or set
      // Register onDisconnect() BEFORE writing "online" — arming it
      // first closes the race where the connection could drop in the
      // gap between the two writes, which would otherwise leave this
      // user stuck showing online with no disconnect handler ever having
      // been registered to correct it.
      onDisconnect(myPresenceRef)
        .set({ state: "offline", lastChanged: rtdbServerTimestamp() })
        .then(() => {
          rtdbSet(myPresenceRef, {
            state: "online",
            lastChanged: rtdbServerTimestamp(),
          });
        })
        .catch((e) => {
          console.error("HUM: failed to arm presence onDisconnect", e);
        });
    },
    (e) => {
      console.error("HUM: presence .info/connected listener failed", e);
    },
  );
}

// Detaches this device's own .info/connected listener (does NOT write
// "offline" — that's goOfflineNow()). Used when tearing down the
// signed-in session's own state, e.g. inside stopAllConversationWatchers.
function stopPresenceListener() {
  if (presenceConnectedUnsub) {
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
async function goOfflineNow(uid) {
  stopPresenceListener();
  if (!rtdb || !uid) return;
  try {
    await rtdbSet(presenceRef(uid), {
      state: "offline",
      lastChanged: rtdbServerTimestamp(),
    });
  } catch (e) {
    console.error("HUM: failed to set presence offline on logout", e);
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
function watchPresence(uid, onChange) {
  if (!rtdb || !uid) {
    onChange(false);
    return () => {};
  }
  return onValue(
    presenceRef(uid),
    (snap) => {
      const val = snap.val();
      onChange(!!val && val.state === "online");
    },
    (err) => {
      console.error("HUM: presence listener failed", err);
      onChange(false);
    },
  );
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

function clearPresenceWatchers(scope) {
  const list = presenceWatchersByScope.get(scope);
  if (list) list.forEach(({ unsub }) => unsub());
  presenceWatchersByScope.set(scope, []);
}

// Subscribes to `uid`'s presence and toggles the "avatar--online"
// modifier class (the CSS class that already draws HUM's existing
// green-dot indicator — see .avatar--online::after in style.css) on
// every element inside `container` marked data-presence-uid="uid",
// live, for as long as `scope`'s listeners haven't since been cleared.
function watchPresenceForScope(scope, uid, container) {
  const unsub = watchPresence(uid, (isOnline) => {
    if (!container || !container.isConnected) return;
    let selector;
    try {
      selector = `[data-presence-uid="${CSS.escape(uid)}"]`;
    } catch (e) {
      return; // uid somehow isn't valid to select on — skip rather than throw
    }
    container.querySelectorAll(selector).forEach((el) => {
      el.classList.toggle("avatar--online", isOnline);
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

function typingRef(convId, uid) {
  return rtdbRef(rtdb, `typing/${convId}/${uid}`);
}

// Writes (or clears, via null) the signed-in user's own typing flag for
// one conversation. Never used to write anyone else's node — every
// call site below passes currentUser().uid, and the Realtime Database
// rules enforce that server-side regardless.
async function setTypingState(convId, uid, isTyping) {
  if (!rtdb || !convId || !uid) return;
  try {
    await rtdbSet(typingRef(convId, uid), isTyping ? true : null);
  } catch (e) {
    console.error("HUM: failed to update typing state", e);
  }
}

// Live-subscribes to whether `otherUid` is typing in `convId`. Treats
// anything other than an explicit `true` (missing node, null, stale
// data) as "not typing" — same not-a-guess posture as watchPresence().
// Returns an unsubscribe function (a no-op one if Realtime Database
// isn't available).
function watchTyping(convId, otherUid, onChange) {
  if (!rtdb || !convId || !otherUid) {
    onChange(false);
    return () => {};
  }
  return onValue(
    typingRef(convId, otherUid),
    (snap) => {
      onChange(snap.val() === true);
    },
    (err) => {
      console.error("HUM: typing listener failed", err);
      onChange(false);
    },
  );
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
function applyTypingIndicatorUI(isTyping) {
  if (!els.chatHeaderHandle || !state.activeChatUser) return;
  els.chatHeaderHandle.classList.toggle(
    "chat-header__handle--typing",
    isTyping,
  );
  els.chatHeaderHandle.textContent = isTyping
    ? t("chat.typingIndicator")
    : "@" + state.activeChatUser.username;
}

// Starts watching `otherUid`'s typing state for `convId` — called from
// openChat() once the conversation being opened is known. Always tears
// down whatever watcher was previously running first (see
// stopTypingWatcher), so switching chats can never leave two watchers
// (old + new) live at once.
function startTypingWatcher(convId, otherUid) {
  stopTypingWatcher();
  typingWatchUnsub = watchTyping(convId, otherUid, applyTypingIndicatorUI);
}

// Detaches the "watching the other participant" listener (does NOT
// touch the signed-in user's OWN typing flag — that's stopMyTyping()).
// Also resets the header back to normal so a stale "typing…" can never
// linger once nobody is watching anything to correct it.
function stopTypingWatcher() {
  if (typingWatchUnsub) {
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
function stopMyTyping() {
  if (typingHideTimer) {
    clearTimeout(typingHideTimer);
    typingHideTimer = null;
  }
  if (!typingConvId) return Promise.resolve();
  const convId = typingConvId;
  typingConvId = null;
  const me = currentUser();
  if (!me) return Promise.resolve();
  return setTypingState(convId, me.uid, false);
}

// Wired to the composer's `input` event (see the chatInput listener
// further down, alongside the existing autoSizeChatInput one). Turns
// raw keystrokes into the typing/{convId}/{uid} writes described in
// the section comment above: typing something sets the flag true and
// (re)arms a short inactivity timeout that clears it; clearing the box
// entirely clears the flag immediately, no timeout needed.
function handleComposerTypingInput() {
  const me = currentUser();
  if (!me || !state.activeChatUser || !els.chatInput) return;
  const convId = conversationId(me.uid, state.activeChatUser.uid);
  const hasText = els.chatInput.value.trim().length > 0;

  if (typingHideTimer) {
    clearTimeout(typingHideTimer);
    typingHideTimer = null;
  }

  if (hasText) {
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
   SECTION: VOICE MESSAGES (recording + Supabase Storage)
   Three parts:
     - RECORDING: startVoiceRecording()/stopVoiceRecordingAndCollect()/
       cancelVoiceRecording() — a real browser MediaRecorder capturing a
       real microphone stream. The only timer involved
       (voiceRecordTimerInterval) is purely cosmetic — it repaints an
       elapsed-time label from Date.now(), it is never the thing that
       decides what audio data exists; that's 100% MediaRecorder's own
       'dataavailable'/'stop' events.
     - UPLOAD: uploadVoiceBlob()/sendVoiceMessage() — pushes the
       recorded Blob to Supabase Storage (see the SUPABASE VOICE
       STORAGE section above for `supabase`/ensureSupabaseAuth), then
       creates a normal Firestore message via the existing addMessage()
       with `extra` metadata pointing at the uploaded file. If the
       upload fails, no Firestore message is ever created; if the
       Firestore write fails AFTER a successful upload, the now-orphaned
       Supabase file is best-effort deleted (deleteVoiceBlobSafely).
     - PLAYBACK: one shared <audio> element for the whole app (not one
       per message bubble, which would fight with renderChatMessages()
       rebuilding the message list's innerHTML on every update) — see
       toggleVoicePlayback/syncVoicePlayersUI. Because there's only ever
       one <audio> element, only one voice message can ever be playing
       at a time by construction.
=================================================================== */

// In rough preference order — MediaRecorder.isTypeSupported varies a
// lot across browsers, so this is checked at record time rather than
// ever assumed. audio/webm;codecs=opus is what Chrome/Firefox/Edge all
// support; Safari (desktop 14.1+/iOS 14.3+) supports MediaRecorder but
// not webm at all, hence the mp4/ogg fallbacks.
const VOICE_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];
function pickVoiceMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported)
    return "";
  return (
    VOICE_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ||
    ""
  );
}

function isVoiceRecordingSupported() {
  return (
    typeof MediaRecorder !== "undefined" &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  );
}

// --- Recording state (module-level, mirroring the typing section's
// pattern above rather than living on the shared `state` object — this
// is transient device/tab-local recording state, not app data). ---
let voiceRecorder = null; // active MediaRecorder, or null when not recording
let voiceRecorderStream = null; // the getUserMedia MediaStream backing it, so its tracks can be released
let voiceChunks = []; // Blob chunks collected via 'dataavailable' for the CURRENT recording
let voiceRecordStartedAt = 0; // Date.now() when recording began — elapsed-time display only
let voiceRecordTimerInterval = null; // repaints the elapsed-time label; see the section comment above re: this NOT being the recording itself

function isRecordingVoice() {
  return !!(voiceRecorder && voiceRecorder.state === "recording");
}

function formatVoiceDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function updateVoiceRecordElapsedUI() {
  if (!els.chatVoiceRecordTime) return;
  els.chatVoiceRecordTime.textContent = formatVoiceDuration(
    (Date.now() - voiceRecordStartedAt) / 1000,
  );
}

// Swaps the composer between its normal (text input + mic + send) and
// recording (elapsed time + cancel + stop) layouts. Every element here
// already exists in index.html; this only ever toggles the `hidden`
// attribute HUM's global [hidden]{display:none!important;} rule (see
// style.css) already relies on everywhere else — no new CSS mechanism.
function setComposerRecordingMode(isRecording) {
  if (els.chatInput) els.chatInput.hidden = isRecording;
  if (els.chatMicBtn) els.chatMicBtn.hidden = isRecording;
  if (els.chatAttachBtn) els.chatAttachBtn.hidden = isRecording;
  if (els.chatSendBtn) els.chatSendBtn.hidden = isRecording;
  if (els.chatVoiceRecordingBar)
    els.chatVoiceRecordingBar.hidden = !isRecording;
  if (!isRecording && els.chatVoiceRecordTime)
    els.chatVoiceRecordTime.textContent = "0:00";
}

// Stops the elapsed-time repaint timer and releases the microphone
// (stops every track on the active getUserMedia stream) — called on
// stop, cancel, chat switch, block, and logout, so HUM never holds the
// microphone open longer than an actual in-progress recording needs.
function releaseVoiceMic() {
  if (voiceRecordTimerInterval) {
    clearInterval(voiceRecordTimerInterval);
    voiceRecordTimerInterval = null;
  }
  if (voiceRecorderStream) {
    voiceRecorderStream.getTracks().forEach((tr) => tr.stop());
    voiceRecorderStream = null;
  }
  voiceRecorder = null;
  voiceChunks = [];
}

// Requests the microphone and starts recording into the currently open
// chat. Bound to the mic button (see the event wiring near
// els.chatMicBtn further down).
async function startVoiceRecording() {
  const me = currentUser();
  if (!me || !state.activeChatUser) return;
  if (state.myBlockedUids.has(state.activeChatUser.uid)) return; // composer/mic are already disabled in this case; this is just a second guard
  if (isRecordingVoice()) return; // already recording — a second press of the mic button is a no-op, not a second recording

  if (!isVoiceRecordingSupported()) {
    showToast(t("chat.voice.unsupported"), "error");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.error("HUM: microphone access failed", e);
    showToast(t("chat.voice.micDenied"), "error");
    return;
  }

  // Typing and recording are mutually exclusive in the composer — clear
  // any in-progress typing flag the moment recording actually starts,
  // so it can never get stuck "true" while the text input sits empty
  // and hidden underneath the recording bar (see setComposerRecordingMode).
  stopMyTyping();

  const mimeType = pickVoiceMimeType();
  voiceRecorderStream = stream;
  voiceChunks = [];
  try {
    voiceRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch (e) {
    console.error("HUM: MediaRecorder could not start", e);
    showToast(t("chat.voice.unsupported"), "error");
    releaseVoiceMic();
    return;
  }

  voiceRecorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) voiceChunks.push(e.data);
  });
  voiceRecorder.addEventListener("error", (e) => {
    console.error("HUM: recording error", (e && e.error) || e);
    showToast(t("chat.voice.recordFailed"), "error");
    cancelVoiceRecording();
  });

  voiceRecorder.start();
  voiceRecordStartedAt = Date.now();
  setComposerRecordingMode(true);
  updateVoiceRecordElapsedUI();
  voiceRecordTimerInterval = setInterval(updateVoiceRecordElapsedUI, 250);
}

// Stops the active recording and resolves with { blob, mimeType,
// durationSeconds }, or null if there's nothing usable (never actually
// recording, or an empty clip — e.g. stop pressed within a few
// milliseconds of start, before any 'dataavailable' event fired).
// Always releases the microphone and resets the composer UI before
// resolving, success or not.
function stopVoiceRecordingAndCollect() {
  return new Promise((resolve) => {
    if (!voiceRecorder || voiceRecorder.state !== "recording") {
      resolve(null);
      return;
    }
    const mimeType = voiceRecorder.mimeType || "audio/webm";
    const startedAt = voiceRecordStartedAt;
    voiceRecorder.addEventListener(
      "stop",
      () => {
        const chunks = voiceChunks;
        releaseVoiceMic();
        setComposerRecordingMode(false);
        if (!chunks.length) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - startedAt) / 1000),
        );
        resolve({ blob, mimeType, durationSeconds });
      },
      { once: true },
    );
    voiceRecorder.stop();
  });
}

// Discards whatever's been recorded so far without uploading anything —
// bound to the composer's Cancel button, and used by every place a
// recording needs to be silently abandoned instead of sent: switching
// chats, the chat becoming blocked, and logging out.
function cancelVoiceRecording() {
  if (voiceRecorder && voiceRecorder.state === "recording") {
    // No 'stop' listener attached here on purpose — releaseVoiceMic()
    // below discards voiceChunks unconditionally, so nothing depends on
    // 'stop' actually firing; MediaRecorder.stop() is safe to call
    // without one.
    try {
      voiceRecorder.stop();
    } catch (e) {
      /* already inactive/stopped */
    }
  }
  releaseVoiceMic();
  setComposerRecordingMode(false);
}

// voice-messages/{conversationId}/{uid}/{uniqueFileName} — matches the
// bucket layout already set up in Supabase. The extension is inferred
// from the actual recorded MIME type (see pickVoiceMimeType) rather
// than hardcoded, since which one MediaRecorder actually used varies
// by browser.
function uniqueVoiceFileName(mimeType) {
  const ext = mimeType.includes("mp4")
    ? "m4a"
    : mimeType.includes("ogg")
      ? "ogg"
      : "webm";
  const rand =
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${rand}.${ext}`;
}

// Uploads `blob` to Supabase Storage and returns the storage path on
// success, or throws on failure — sendVoiceMessage() below decides what
// "failure" means for the rest of the send flow. `upsert: false` is
// deliberate and matches "do not overwrite an existing voice message":
// every recording already gets a fresh random filename, so a collision
// should never legitimately happen, and if it somehow did, failing
// loudly is safer than silently overwriting someone's audio.
async function uploadVoiceBlob(convId, uid, blob, mimeType) {
  if (!supabase) throw new Error("Supabase is not configured");
  const ok = await ensureSupabaseAuth();
  if (!ok) throw new Error("Supabase authentication failed");
  const path = `${convId}/${uid}/${uniqueVoiceFileName(mimeType)}`;
  const { error } = await supabase.storage
    .from(VOICE_BUCKET)
    .upload(path, blob, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw error;
  return path;
}

// Best-effort cleanup for an orphaned upload — used only when the
// Supabase upload already succeeded but the follow-up Firestore write
// then failed. Never allowed to throw: this already runs inside a
// catch block for a worse problem (see sendVoiceMessage), and a
// cleanup failure here must never mask or replace that original error.
async function deleteVoiceBlobSafely(path) {
  if (!supabase || !path) return;
  try {
    await supabase.storage.from(VOICE_BUCKET).remove([path]);
  } catch (e) {
    console.error("HUM: failed to clean up orphaned voice file", path, e);
  }
}

// Full voice-message send flow — record → blob → upload → Firestore
// message — mirroring sendChatMessage()'s error-toast posture but for
// audio instead of text. Bound to the composer's Stop button (stopping
// the recording IS "send" here, matching the recording-bar UI: Cancel
// discards, Stop sends).
async function sendVoiceMessage() {
  const me = currentUser();
  if (!me || !state.activeChatUser) return;
  const other = state.activeChatUser;

  if (state.myBlockedUids.has(other.uid)) {
    // The composer/mic are already disabled while blocked, but this
    // covers the small window between pressing Stop and this function
    // actually running if a block landed in that instant — "do not
    // upload the voice message; do not create a Firestore message."
    cancelVoiceRecording();
    return;
  }

  const recording = await stopVoiceRecordingAndCollect();
  if (!recording) {
    showToast(t("chat.voice.emptyRecording"), "error");
    return;
  }

  const convId = conversationId(me.uid, other.uid);
  showToast(t("chat.voice.uploading"));

  let path;
  try {
    path = await uploadVoiceBlob(
      convId,
      me.uid,
      recording.blob,
      recording.mimeType,
    );
  } catch (e) {
    console.error("HUM: voice upload failed", e);
    showToast(t("chat.voice.uploadFailed"), "error");
    return; // nothing uploaded successfully → no Firestore message, per spec
  }

  try {
    await addMessage(me, other, "", {
      type: "voice",
      voicePath: path,
      voiceMimeType: recording.mimeType,
      voiceDuration: recording.durationSeconds,
    });
    showToast(t("chat.voice.sent"), "success");
  } catch (e) {
    console.error("HUM: failed to create voice message after upload", e);
    showToast(t("errors.sendFailed"), "error");
    // Upload succeeded but the message never got created — clean up the
    // now-orphaned file rather than leaving it in Storage forever.
    await deleteVoiceBlobSafely(path);
  }
}

// --- Playback: one shared <audio> element for the whole app. ---
const sharedVoiceAudio = new Audio();
let activeVoiceMessageId = null; // Firestore message id currently loaded in sharedVoiceAudio, or null

// Reflects sharedVoiceAudio's current state onto every voice-message
// bubble currently in the DOM (there's normally at most one that's
// "active", but this is written to just re-derive the whole visible
// set from scratch every time rather than track per-bubble diffs — the
// message list is short enough per conversation that this is cheap,
// and it's the same "re-render is the source of truth" posture
// renderChatMessages() itself already uses). Called on every
// play/pause/timeupdate/ended from the audio element, AND once at the
// end of renderChatMessages() so a list re-render (e.g. a read receipt
// ticking in) can't visually reset a bubble that's actually mid-playback.
function syncVoicePlayersUI() {
  if (!els.chatMessages) return;
  els.chatMessages
    .querySelectorAll(".chat-msg__bubble--voice")
    .forEach((bubble) => {
      const msgId = bubble.getAttribute("data-voice-id");
      const isActive = !!msgId && msgId === activeVoiceMessageId;
      const isPlaying = isActive && !sharedVoiceAudio.paused;
      const playBtn = bubble.querySelector("[data-voice-play]");
      const fill = bubble.querySelector(".chat-voice-progress__fill");
      const timeEl = bubble.querySelector(".chat-voice-time");
      const baseDuration =
        Number(bubble.getAttribute("data-voice-duration")) || 0;

      if (playBtn) {
        playBtn.classList.toggle("is-playing", isPlaying);
        playBtn.setAttribute(
          "aria-label",
          t(isPlaying ? "chat.voice.pause" : "chat.voice.play"),
        );
      }

      let pct = 0;
      let displaySeconds = baseDuration;
      if (
        isActive &&
        sharedVoiceAudio.duration &&
        isFinite(sharedVoiceAudio.duration)
      ) {
        pct = Math.min(
          100,
          (sharedVoiceAudio.currentTime / sharedVoiceAudio.duration) * 100,
        );
        displaySeconds =
          sharedVoiceAudio.currentTime > 0 || isPlaying
            ? sharedVoiceAudio.currentTime
            : sharedVoiceAudio.duration;
      }
      if (fill) fill.style.width = pct + "%";
      if (timeEl) timeEl.textContent = formatVoiceDuration(displaySeconds);
    });
}
sharedVoiceAudio.addEventListener("play", syncVoicePlayersUI);
sharedVoiceAudio.addEventListener("pause", syncVoicePlayersUI);
sharedVoiceAudio.addEventListener("timeupdate", syncVoicePlayersUI);
sharedVoiceAudio.addEventListener("ended", () => {
  activeVoiceMessageId = null;
  syncVoicePlayersUI();
});
sharedVoiceAudio.addEventListener("error", () => {
  if (activeVoiceMessageId) {
    console.error("HUM: voice audio element error", sharedVoiceAudio.error);
    showToast(t("chat.voice.playbackError"), "error");
    activeVoiceMessageId = null;
    syncVoicePlayersUI();
  }
});

// Immediately silences and detaches the shared player — used when
// leaving/switching chats (see openChat/leaveActiveChat) and on
// logout, so audio from a conversation that's no longer open never
// keeps playing in the background.
function stopVoicePlayback() {
  if (activeVoiceMessageId !== null || !sharedVoiceAudio.paused) {
    sharedVoiceAudio.pause();
    sharedVoiceAudio.removeAttribute("src");
    try {
      sharedVoiceAudio.load();
    } catch (e) {
      /* no-op */
    }
  }
  activeVoiceMessageId = null;
}

// Play/pause for one voice message bubble — bound via delegation on
// els.chatMessages (see the event wiring near renderChatMessages
// further down), since bubbles are recreated on every render and can't
// hold their own listeners. Because there's only ever ONE <audio>
// element for the whole app, starting a different message's playback
// here always pauses whatever was playing before it — "only one voice
// message should normally play at a time" holds by construction, not
// by extra bookkeeping.
async function toggleVoicePlayback(messageId, voicePath) {
  if (!supabase) {
    showToast(t("chat.voice.playbackError"), "error");
    return;
  }
  if (activeVoiceMessageId === messageId && !sharedVoiceAudio.paused) {
    sharedVoiceAudio.pause();
    return;
  }
  if (activeVoiceMessageId === messageId && sharedVoiceAudio.src) {
    sharedVoiceAudio.play().catch((e) => {
      console.error("HUM: voice playback failed", e);
      showToast(t("chat.voice.playbackError"), "error");
    });
    return;
  }

  sharedVoiceAudio.pause();
  activeVoiceMessageId = messageId;
  syncVoicePlayersUI(); // clears the previous bubble, and gives immediate feedback on the one just tapped

  try {
    const ok = await ensureSupabaseAuth();
    if (!ok) throw new Error("Supabase authentication failed");
    const { data, error } = await supabase.storage
      .from(VOICE_BUCKET)
      .createSignedUrl(voicePath, 3600);
    if (error || !data || !data.signedUrl)
      throw error || new Error("Supabase did not return a signed URL");
    if (activeVoiceMessageId !== messageId) return; // the person tapped a different message while this was loading
    sharedVoiceAudio.src = data.signedUrl;
    await sharedVoiceAudio.play();
  } catch (e) {
    console.error("HUM: voice playback failed", e);
    showToast(t("chat.voice.playbackError"), "error");
    if (activeVoiceMessageId === messageId) activeVoiceMessageId = null;
    syncVoicePlayersUI();
  }
}

/* ===================================================================
   SECTION: ATTACHMENTS (File & Photo — Supabase Storage)
   A second, independent Supabase bucket alongside voice-messages (see
   CHAT_FILES_BUCKET above) — same Supabase project, same anon-key
   client, same anonymous-auth mechanism (ensureSupabaseAuth), never
   mixed into the voice-messages bucket. Firestore messages carry
   { type:'image'|'file', filePath, fileName, fileMimeType, fileSize },
   text stays '' on these — exactly the same "metadata in Firestore,
   bytes in Supabase" split voice messages already use, just a second
   bucket/path prefix and a couple more metadata fields.

   Flow mirrors sendVoiceMessage(): validate → upload → Firestore
   message → (on Firestore failure) best-effort orphan cleanup. The one
   real difference is MULTIPLE files can be selected at once — each
   file is validated/uploaded/messaged independently (see
   sendAttachmentFiles/sendOneAttachment below), so one oversized or
   failed file in a batch never blocks the others from sending.
=================================================================== */

// Any image/* is always accepted; this list covers the "common
// documents/files" the spec asks for. A file whose MIME type the
// browser couldn't determine at all (file.type === '') is let through
// rather than blocked — many legitimate files (some .heic photos,
// certain document variants) report an empty type depending on OS/
// browser, and the real safety net here is CHAT_FILE_MAX_BYTES plus
// the fact Supabase only ever stores bytes, never executes anything.
const CHAT_FILE_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/json",
];
function isAcceptedChatFileType(file) {
  if (!file || !file.type) return true;
  if (file.type.startsWith("image/")) return true;
  return CHAT_FILE_ACCEPTED_MIME_TYPES.includes(file.type);
}

// voice-messages/{conversationId}/{uid}/{uniqueFileName}'s exact
// sibling for chat-files — same structured-path reasoning, just a
// different bucket and the extension comes from the ORIGINAL filename
// (falling back to a generic one if the file somehow has none) rather
// than a MediaRecorder MIME type.
function uniqueChatFileName(originalName) {
  const dot = (originalName || "").lastIndexOf(".");
  const ext =
    dot > 0 && dot < originalName.length - 1
      ? originalName
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "";
  const rand =
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return ext ? `${rand}.${ext}` : rand;
}

// Uploads one File/Blob to Supabase Storage's chat-files bucket and
// returns the storage path on success, or throws on failure — same
// upsert:false reasoning as uploadVoiceBlob (every upload gets a fresh
// random filename, so a collision should never legitimately happen).
async function uploadChatFileBlob(convId, uid, file) {
  if (!supabase) throw new Error("Supabase is not configured");
  const ok = await ensureSupabaseAuth();
  if (!ok) throw new Error("Supabase authentication failed");
  const path = `${convId}/${uid}/${uniqueChatFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(CHAT_FILES_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;
  return path;
}

// Best-effort cleanup for an orphaned chat-file upload — mirrors
// deleteVoiceBlobSafely exactly (never throws; used both when a
// Firestore write fails right after a successful upload, and when
// "delete for everyone" tombstones an image/file message — see
// deleteMessageForEveryone above).
async function deleteChatFileBlobSafely(path) {
  if (!supabase || !path) return;
  try {
    await supabase.storage.from(CHAT_FILES_BUCKET).remove([path]);
  } catch (e) {
    console.error("HUM: failed to clean up orphaned chat file", path, e);
  }
}

// Short-lived signed URL for viewing/downloading a private chat-files
// object — the bucket is never made public (see the Storage policy
// notes alongside CHAT_FILES_BUCKET above); this is the "correct
// client-side access mechanism" the private-bucket requirement calls
// for, identical in shape to voice playback's createSignedUrl usage.
async function getChatFileSignedUrl(path) {
  if (!supabase) throw new Error("Supabase is not configured");
  const ok = await ensureSupabaseAuth();
  if (!ok) throw new Error("Supabase authentication failed");
  const { data, error } = await supabase.storage
    .from(CHAT_FILES_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data || !data.signedUrl)
    throw error || new Error("Supabase did not return a signed URL");
  return data.signedUrl;
}

// Validates one File against size/type limits and reports a specific
// toast for whichever check fails — called once per file before any
// upload is attempted (see sendAttachmentFiles below), so a bad file
// never even reaches the network.
function validateAttachmentFile(file) {
  if (file.size > CHAT_FILE_MAX_BYTES) {
    showToast(t("chat.attach.tooLarge", { name: file.name }), "error");
    return false;
  }
  if (!isAcceptedChatFileType(file)) {
    showToast(t("chat.attach.unsupportedType", { name: file.name }), "error");
    return false;
  }
  return true;
}

// Full attachment send flow for ONE already-validated file — record →
// upload → Firestore message, mirroring sendVoiceMessage()'s shape and
// error-toast posture exactly. Used by sendAttachmentFiles() below, one
// call per selected file, independently of the others.
async function sendOneAttachment(me, other, convId, file) {
  const isImage = file.type && file.type.startsWith("image/");
  showToast(t("chat.attach.uploading", { name: file.name }));

  let path;
  try {
    path = await uploadChatFileBlob(convId, me.uid, file);
  } catch (e) {
    console.error("HUM: attachment upload failed", file.name, e);
    showToast(t("chat.attach.uploadFailed", { name: file.name }), "error");
    return; // nothing uploaded successfully → no Firestore message, per spec
  }

  try {
    await addMessage(me, other, "", {
      type: isImage ? "image" : "file",
      filePath: path,
      fileName: file.name,
      fileMimeType: file.type || "application/octet-stream",
      fileSize: file.size,
    });
    showToast(t("chat.attach.sent", { name: file.name }), "success");
  } catch (e) {
    console.error("HUM: failed to create attachment message after upload", file.name, e);
    showToast(t("errors.sendFailed"), "error");
    // Upload succeeded but the message never got created — clean up the
    // now-orphaned file rather than leaving it in Storage forever.
    await deleteChatFileBlobSafely(path);
  }
}

// Entry point for the attachment file picker (see the els.chatFileInput
// 'change' listener further down). Multiple files are handled
// independently — one bad or failed file reports its own error and
// simply doesn't block the rest of the selection from sending, per
// "if one upload fails, clean up any successfully uploaded orphan
// files that were not successfully turned into Firestore messages"
// (each file's own try/catch in sendOneAttachment already guarantees
// that per-file, there's nothing additional to coordinate across the
// batch). An empty FileList (the person opened the picker and
// cancelled it) is a silent no-op — "graceful cancellation".
async function sendAttachmentFiles(fileList) {
  const me = currentUser();
  if (!me || !state.activeChatUser) return;
  const other = state.activeChatUser;
  if (state.myBlockedUids.has(other.uid)) return;

  const files = Array.from(fileList || []);
  if (!files.length) return;

  const convId = conversationId(me.uid, other.uid);
  for (const file of files) {
    if (!validateAttachmentFile(file)) continue;
    await sendOneAttachment(me, other, convId, file);
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
  LANG: "hum_lang",
  THEME: "hum_theme",
};

function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function setItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("HUM storage error:", e);
    return false;
  }
}

function hasStoredLang() {
  return localStorage.getItem(KEYS.LANG) !== null;
}

/* ===================================================================
   SECTION: USERS (Firestore)
   Each user's document lives at users/{uid} — the Firebase Auth UID
   is the permanent account identity, since (unlike username) it never
   changes and is never reused. Username is still unique (enforced via
   Firebase Auth's synthetic per-username email — see emailForUsername)
   and still how people search for and look up other users, but it's
   just a field on the document now, not the document's address. This
   is what makes a username change a plain field update instead of a
   delete-and-recreate of the whole document — and what makes "the Auth
   account exists but its profile can't be found" structurally
   impossible for a normal signed-in session, since loading your own
   profile never has to guess your current username at all.
=================================================================== */

function usernameDocId(username) {
  return String(username || "")
    .trim()
    .toLowerCase();
}

// Loads a profile directly by its document ID (the Auth UID) — this is
// how the signed-in user's OWN profile is loaded (see loadOrRecoverProfile
// and the onAuthStateChanged handler at the bottom of this file), since
// their UID is already known the moment Firebase confirms they're
// signed in, with no need to go via username at all.
async function findUserByUid(uid) {
  if (!uid) return null;
  requireFirebaseConfig();
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Looks up someone else's profile by username — used for People
// Search results, viewing a profile, and opening a chat. Since the
// document ID is the UID (not the username), this runs as an indexed
// equality query on the usernameLower field rather than a direct
// document read; still a single, cheap, auto-indexed lookup.
async function findUserByUsername(username) {
  if (!username) return null;
  requireFirebaseConfig();
  const lower = usernameDocId(username);
  const snap = await getDocs(
    fbQuery(
      collection(db, "users"),
      where("usernameLower", "==", lower),
      limit(1),
    ),
  );
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
async function loadOrRecoverProfile(firebaseUser) {
  requireFirebaseConfig();

  const byUid = await findUserByUid(firebaseUser.uid);
  if (byUid) return byUid;

  const usernameLower = firebaseUser.email.split("@")[0];

  const legacyRef = doc(db, "users", usernameLower);
  const legacySnap = await getDoc(legacyRef);
  if (legacySnap.exists()) {
    const migrated = { ...legacySnap.data(), uid: firebaseUser.uid };
    await setDoc(doc(db, "users", firebaseUser.uid), migrated);
    if (usernameLower !== firebaseUser.uid) {
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
    bio: "",
    avatar: { type: "generated" },
    createdAt: new Date().toISOString(),
  };
  await setDoc(doc(db, "users", firebaseUser.uid), recovered);
  return recovered;
}

// The signed-in user's own profile, kept resolved in memory the whole
// session (see onAuthReady/registerUser/loginUser/updateProfile) so
// the many places in the UI that just need "who am I right now" can
// read it synchronously instead of re-awaiting Firestore on every
// render. Firestore is still the source of truth — this is a cache of
// it, refreshed whenever it changes.
function currentUser() {
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

function conversationId(uidA, uidB) {
  return [uidA, uidB].sort().join("__");
}

function conversationInfo(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || { type: "generated" },
  };
}

async function ensureConversation(meUser, otherUser) {
  requireFirebaseConfig();
  const convId = conversationId(meUser.uid, otherUser.uid);
  const ref = doc(db, "conversations", convId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
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
// Sends a message and returns it. meUser/otherUser are full user
// objects (not just usernames) because the conversation doc keeps a
// denormalized copy of each participant's display info for the Chats
// list — that copy refreshes on every message either of them sends, so
// it can go a little stale between messages (e.g. right after someone
// changes their display name) but never for long. `extra` is an
// optional plain object merged onto the message doc after the base
// fields — used by sendVoiceMessage() to add { type:'voice', voicePath,
// voiceMimeType, voiceDuration } without this function needing to know
// anything about voice messages specifically; an ordinary text message
// (the vast majority of calls) just omits it.
async function addMessage(meUser, otherUser, text, extra) {
  const convId = await ensureConversation(meUser, otherUser);
  const message = {
    from: meUser.uid,
    text,
    ts: new Date().toISOString(),
    ...(extra || {}),
  };
  await addDoc(collection(db, "conversations", convId, "messages"), message);
  await setDoc(
    doc(db, "conversations", convId),
    {
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
    },
    { merge: true },
  );
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
function watchConversationMessages(uidA, uidB, onChange) {
  requireFirebaseConfig();
  const convId = conversationId(uidA, uidB);
  const q = fbQuery(
    collection(db, "conversations", convId, "messages"),
    orderBy("ts", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
    },
    (err) => {
      console.error("HUM: message listener failed", err);
      onChange(null, err);
    },
  );
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
async function markMessagesRead(meUid, otherUid, convId, messages) {
  requireFirebaseConfig();
  const unread = (messages || []).filter(
    (m) => m.from === otherUid && !m.readAt && m.id,
  );
  if (!unread.length) return;
  const readAt = new Date().toISOString();
  const batch = writeBatch(db);
  unread.forEach((m) => {
    batch.update(doc(db, "conversations", convId, "messages", m.id), {
      readAt,
    });
  });
  try {
    await batch.commit();
  } catch (e) {
    console.error("HUM: failed to mark messages as read", e);
  }
}

/* ===================================================================
   SECTION: DELETE MESSAGE ("delete for me" / "delete for everyone")
   Mirrors the shape of the conversation-level Remove/Block section
   further down: no message document is ever actually deleted from
   Firestore (allow delete: if false — unchanged) — instead:
     - "Delete for me" adds the caller's own uid to that message's
       `deletedFor` array, the exact same per-viewer-visibility pattern
       conversations.hiddenFor already uses for "Remove". Any
       participant can do this to ANY message in the conversation,
       including their own — it only ever affects their own view.
     - "Delete for everyone" flips `deletedForEveryone: true` on the
       message — a tombstone flag, never an actual content rewrite —
       and ONLY the message's own sender may ever set it (see the
       Firestore rules comment at the top of this file). Rendering (see
       renderChatMessages) shows "This message was deleted" in place of
       the original bubble content once this is set; the original
       text/voicePath/etc. are left alone in Firestore, they're simply
       never displayed once tombstoned. Note this does NOT delete the
       underlying Supabase audio file for a tombstoned voice message —
       out of scope for this pass, same "smallest safe change" posture
       as everywhere else in this file.
   Because both are plain field writes on the exact same message doc
   the open chat's live listener (watchConversationMessages) is already
   subscribed to, neither needs a new listener — the existing real-time
   stream picks up the change and re-renders automatically.
=================================================================== */

// "Delete for me" — hides one message from just the caller's own view.
// Uses setDoc+merge (not a fresh `updateDoc` import) to match every
// other single-field message/conversation write already in this file.
async function deleteMessageForMe(convId, msgId, uid) {
  requireFirebaseConfig();
  await setDoc(
    doc(db, "conversations", convId, "messages", msgId),
    {
      deletedFor: arrayUnion(uid),
    },
    { merge: true },
  );
}

// "Delete for everyone" — tombstones the message for both participants.
// Only ever called after confirmAndDeleteMessage() has already verified
// the caller is the message's own sender (see the UI section below);
// the Firestore rule enforces the same restriction server-side
// regardless, so this can never succeed for someone else's message even
// if that client-side check were somehow bypassed. Takes the full
// message object (not just its id) so it can also best-effort clean up
// the underlying Supabase file for a voice/image/file message — that
// cleanup only ever runs AFTER the tombstone write has already
// succeeded, and can never fail the deletion itself (see
// deleteVoiceBlobSafely/deleteChatFileBlobSafely, both already
// try/catch-wrapped to never throw).
async function deleteMessageForEveryone(convId, message) {
  requireFirebaseConfig();
  await setDoc(
    doc(db, "conversations", convId, "messages", message.id),
    {
      deletedForEveryone: true,
    },
    { merge: true },
  );
  if (message.type === "voice" && message.voicePath) {
    await deleteVoiceBlobSafely(message.voicePath);
  } else if (
    (message.type === "image" || message.type === "file") &&
    message.filePath
  ) {
    await deleteChatFileBlobSafely(message.filePath);
  }
  // "Delete for me" never touches Storage at all — the shared file may
  // still be needed by the other participant, who hasn't deleted
  // anything (see deleteMessageForMe above and confirmAndDeleteMessage
  // in the UI section, neither of which calls into Storage).
}

/* ===================================================================
   SECTION: MESSAGE REACTIONS
   Reactions live directly on the existing message document as a
   `reactions` map — no new collection, no new document, no new
   listener: { "❤️": ["uid1","uid2"], "😂": ["uid3"] }. Every reaction
   type works on every message type (text/voice/image/file) because
   this is a field on the message doc itself, not something tied to
   `type` or to the bubble markup — see reactionsBarMarkup/
   renderChatMessages below, which render this the same way regardless
   of what kind of bubble the message is.
=================================================================== */

// The only six reactions HUM supports, in the exact order the picker
// and the aggregated counters both display them. Centralized here so
// the UI (openReactionPicker/reactionsBarMarkup) and the Firestore
// write path (toggleMessageReaction/handleToggleReaction) can never
// drift out of sync with each other.
const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];

// Adds or removes ONE user's reaction on ONE message, for ONE emoji —
// mirrors deleteMessageForMe's setDoc+merge pattern exactly, just one
// level deeper into the doc (reactions.<emoji> instead of a top-level
// field). Nesting the arrayUnion/arrayRemove sentinel inside the
// `reactions` object (rather than a dotted "reactions.❤️" string key)
// is what makes setDoc's merge:true touch ONLY that one emoji's array
// — every other emoji already on the message, and every other field on
// the doc, is left completely untouched. arrayUnion/arrayRemove are
// themselves atomic add/remove-from-array operations, so two different
// users reacting to the same message at the same moment can never
// clobber each other the way a plain read-modify-write would.
// `hasReacted` is decided by the caller (see handleToggleReaction)
// from the live message data already in state.chatMessagesData — no
// extra read is needed here, matching how deleteMessageForMe/
// deleteMessageForEveryone never re-fetch the doc before writing.
async function toggleMessageReaction(convId, msgId, emoji, uid, hasReacted) {
  requireFirebaseConfig();
  await setDoc(
    doc(db, "conversations", convId, "messages", msgId),
    {
      reactions: {
        [emoji]: hasReacted ? arrayRemove(uid) : arrayUnion(uid),
      },
    },
    { merge: true },
  );
}

// Live-subscribes to this user's conversation list, most recently
// active first, using the denormalized participantsInfo/lastMessage so
// the Chats panel can render straight from this snapshot with no
// further reads. Returns an unsubscribe function. uid is the signed-in
// user's Firebase Auth UID — this is the EXACT field the security rule
// checks request.auth.uid against, so it has to be a UID here, not a
// username, or the rule can never match what the query is actually
// filtering on.
function watchUserConversations(uid, onChange) {
  requireFirebaseConfig();
  const q = fbQuery(
    collection(db, "conversations"),
    where("participants", "array-contains", uid),
    orderBy("updatedAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => d.data())
        .filter((conv) => conv.lastMessage)
        // "Remove" (see removeConversationForMe) hides a conversation from
        // just the person who removed it, by adding their own uid to
        // hiddenFor — the other participant's copy of the same doc, and
        // their own chat list, are completely untouched.
        .filter(
          (conv) =>
            !(Array.isArray(conv.hiddenFor) && conv.hiddenFor.includes(uid)),
        )
        .map((conv) => {
          const otherUid =
            conv.participants.find((p) => p !== uid) || conv.participants[0];
          const otherInfo =
            conv.participantsInfo && conv.participantsInfo[otherUid];
          return otherInfo
            ? { other: otherInfo, otherUid, lastMessage: conv.lastMessage }
            : null;
        })
        .filter(Boolean);
      onChange(rows);
    },
    (err) => {
      console.error("HUM: conversations listener failed", err);
      onChange(null, err);
    },
  );
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
async function hideConversationFor(uid, otherUid) {
  requireFirebaseConfig();
  const convId = conversationId(uid, otherUid);
  const ref = doc(db, "conversations", convId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await setDoc(ref, { hiddenFor: arrayUnion(uid) }, { merge: true });
}

// "Remove a person" — hides the conversation from the signed-in user's
// own chat list only. Does not touch the other participant's account,
// profile, or their copy of the conversation in any way.
async function removeConversationForMe(meUid, otherUid) {
  await hideConversationFor(meUid, otherUid);
}

function blockedDocRef(meUid, otherUid) {
  return doc(db, "users", meUid, "blocked", otherUid);
}

// Blocks otherUser for meUser: writes the block record (this is what
// the Firestore rules check to reject future messages in either
// direction — see the rules comment above) and, since a block implies
// "I don't want to see this conversation anymore", also hides the
// conversation the same way Remove does.
async function blockUser(meUid, otherUser) {
  requireFirebaseConfig();
  await setDoc(blockedDocRef(meUid, otherUser.uid), {
    blockedUid: otherUser.uid,
    blockedUsername: otherUser.username,
    blockedDisplayName: otherUser.displayName,
    blockedAvatar: otherUser.avatar || { type: "generated" },
    createdAt: new Date().toISOString(),
  });
  await hideConversationFor(meUid, otherUser.uid).catch((e) => {
    // The block itself already succeeded and is what actually matters
    // for safety (enforced server-side); failing to also hide the
    // now-stale conversation row is a cosmetic follow-up, not a reason
    // to report the whole action as failed.
    console.error("HUM: blocked user but failed to hide conversation", e);
  });
}

// Restores normal messaging with otherUid. Does not un-hide any
// conversation on its own — same as an ordinary Remove, it reappears
// the moment either side sends a new message (see addMessage()).
async function unblockUser(meUid, otherUid) {
  requireFirebaseConfig();
  await deleteDoc(blockedDocRef(meUid, otherUid));
}

// Live-subscribes to the signed-in user's own block list. Only ever
// reads users/{uid}/blocked for `uid === the signed-in user` — the
// security rules don't allow reading anyone else's.
function watchBlockedUsers(uid, onChange) {
  requireFirebaseConfig();
  const q = fbQuery(
    collection(db, "users", uid, "blocked"),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => d.data()));
    },
    (err) => {
      console.error("HUM: blocked-users listener failed", err);
      onChange(null, err);
    },
  );
}

/* ===================================================================
   SECTION: LOCALIZATION (i18n)
   Clean, expandable structure: translations[lang][section][key]
=================================================================== */

const translations = {
  en: {
    common: {
      username: "Username",
      usernamePlaceholder: "yourname",
      password: "Password",
      passwordPlaceholder: "••••••••",
      confirmPassword: "Confirm password",
      displayName: "Display name",
      displayNamePlaceholder: "Aziza Karimova",
      bio: "About",
      bioPlaceholder: "Say something about yourself",
      show: "Show",
      hide: "Hide",
      cancel: "Cancel",
      saveChanges: "Save changes",
      close: "Close",
      back: "Back",
      avatarTooLarge: "Image is too large (max 700KB).",
      loading: "Loading…",
      moreOptions: "More options",
      remove: "Remove",
      block: "Block",
      unblock: "Unblock",
      confirm: "Confirm",
      delete: "Delete",
    },
    errors: {
      network:
        "Something went wrong connecting to HUM. Check your connection and try again.",
      userNotFound: "That account could not be found.",
      requiresRecentLogin: "Please log out and log back in, then try again.",
      sendFailed: "This message could not be delivered.",
    },
    langScreen: {
      title: "Choose your language",
      subtitle: "You can change this anytime in Settings.",
    },
    auth: {
      showcase: {
        title: "Every conversation has a frequency.",
        body: "Find people, build your profile, and get ready to talk — HUM keeps the signal clean and the noise out.",
        point1: "Search people by name or @username",
        point2: "A profile that's actually yours",
        point3: "Works in English, Русский and O‘zbek",
      },
      tabs: { login: "Log in", register: "Create account" },
      login: {
        title: "Welcome back",
        subtitle: "Log in to pick up where you left off.",
        submit: "Log in",
        switchPrompt: "No account yet?",
        switchAction: "Create one",
        errorInvalid: "Username or password is incorrect.",
      },
      register: {
        title: "Set your frequency",
        subtitle: "A few details and you're in.",
        usernameHint: "3–20 characters: letters, numbers, underscore.",
        passwordHint: "At least 6 characters.",
        submit: "Create account",
        switchPrompt: "Already have an account?",
        switchAction: "Log in",
      },
      validation: {
        required: "This field is required.",
        usernameFormat: "Use 3–20 letters, numbers or underscores.",
        usernameTaken: "This username is already taken.",
        passwordShort: "Password must be at least 6 characters.",
        passwordMismatch: "Passwords don't match.",
        displayNameShort: "Enter a display name.",
      },
    },
    nav: {
      chats: "Chats",
      people: "People",
      profile: "Profile",
      settings: "Settings",
      logout: "Log out",
    },
    chats: {
      title: "Chats",
      emptyTitle: "It's quiet in here",
      emptyBody:
        "Real-time messaging is on the way. For now, find people and get your profile ready.",
      emptyAction: "Find people",
    },
    people: {
      title: "Find people",
      searchPlaceholder: "Search by name or @username",
      empty: "No one matches that search.",
      hint: "Search by display name or @username.",
      view: "View",
      you: "You",
    },
    welcome: {
      title: "Welcome to HUM",
      body: "Search for someone on the left, or open your profile to make it your own.",
    },
    profile: {
      title: "Your profile",
      edit: "Edit profile",
      backToView: "Done",
      avatar: { upload: "Upload photo", remove: "Remove" },
      joined: "Joined",
      noBio: "No bio yet.",
      saved: "Profile updated.",
      message: "Message",
      comingSoon: "Real-time messaging is coming in a future version of HUM.",
    },
    chat: {
      emptyTitle: "Start the conversation",
      inputPlaceholder: "Message",
      send: "Send",
      youPrefix: "You: ",
      blockedNotice: "You've blocked this person.",
      typingIndicator: "Typing...",
      receiptSent: "Sent",
      receiptRead: "Read",
      messageDeleted: "This message was deleted",
      voice: {
        record: "Record voice message",
        stop: "Stop",
        cancel: "Cancel",
        recording: "Recording",
        uploading: "Uploading voice message…",
        sent: "Voice message sent",
        micDenied: "Failed to access microphone",
        unsupported: "Voice messages are not supported in this browser",
        recordFailed: "Recording failed",
        emptyRecording: "Recording was too short",
        uploadFailed: "Upload failed",
        playbackError: "Playback error",
        play: "Play voice message",
        pause: "Pause voice message",
        listPreview: "🎤 Voice message",
      },
      attach: {
        button: "Attach file",
        uploading: "Uploading {name}…",
        sent: "Sent {name}",
        uploadFailed: "Failed to upload {name}",
        tooLarge: 'File "{name}" is too large (max 20 MB).',
        unsupportedType: 'File "{name}" isn\'t a supported type.',
        image: "Photo",
        fileFallbackName: "File",
        download: "Download",
        downloadFailed: "Failed to open file",
        imageLoadFailed: "Failed to load image",
        listPreviewPhoto: "📷 Photo",
        listPreviewFile: "📎 File: {name}",
      },
      reactions: {
        add: "Add reaction",
        picker: "Choose a reaction",
        emojiLabel: "React with {emoji}",
        chipLabel: "{emoji} reactions: {count}",
      },
    },
    menu: {
      remove: "Remove",
      block: "Block",
      unblock: "Unblock",
      deleteForMe: "Delete for me",
      deleteForEveryone: "Delete for everyone",
    },
    confirm: {
      removeTitle: "Remove this chat?",
      removeBody:
        "This removes the conversation from your chat list. {name} will keep their copy of it, and you can start a new conversation with them anytime.",
      blockTitle: "Block {name}?",
      blockBody:
        "{name} won't be able to message you, and you won't see them in search or your chat list. You can unblock them anytime in Settings.",
      unblockTitle: "Unblock {name}?",
      unblockBody:
        "{name} will be able to message you again, and will reappear in search.",
      deleteMeTitle: "Delete this message for you?",
      deleteMeBody:
        "This removes the message from your own view only — the other person will still see it.",
      deleteEveryoneTitle: "Delete this message for everyone?",
      deleteEveryoneBody:
        'This replaces the message with "This message was deleted" for both you and {name}. This can\'t be undone.',
    },
    settings: {
      title: "Settings",
      language: "Language",
      languageHint: "Choose the language HUM speaks to you in.",
      appearance: "Appearance",
      appearanceHint: "Switch between a dark or light signal.",
      dark: "Dark",
      light: "Light",
      privacy: "Privacy",
      privacyHint:
        "People you've blocked can't message you, and you won't see them in search.",
      blockedUsersEmpty: "You haven't blocked anyone.",
      account: "Account",
      accountHint: "Signed in as {username}.",
    },
    toast: {
      loggedIn: "Welcome back, {name}.",
      accountCreated: "Account created. Welcome, {name}!",
      loggedOut: "Logged out.",
      profileSaved: "Profile updated.",
      langChanged: "Language switched.",
      chatRemoved: "Chat removed.",
      userBlocked: "{name} has been blocked.",
      userUnblocked: "{name} has been unblocked.",
      messageDeletedForMe: "Message deleted for you.",
      messageDeletedEveryone: "Message deleted.",
    },
  },

  ru: {
    common: {
      username: "Имя пользователя",
      usernamePlaceholder: "yourname",
      password: "Пароль",
      passwordPlaceholder: "••••••••",
      confirmPassword: "Подтвердите пароль",
      displayName: "Отображаемое имя",
      displayNamePlaceholder: "Азиза Каримова",
      bio: "О себе",
      bioPlaceholder: "Расскажите немного о себе",
      show: "Показать",
      hide: "Скрыть",
      cancel: "Отмена",
      saveChanges: "Сохранить",
      close: "Закрыть",
      back: "Назад",
      avatarTooLarge: "Изображение слишком большое (макс. 700КБ).",
      loading: "Загрузка…",
      moreOptions: "Ещё",
      remove: "Удалить",
      block: "Заблокировать",
      unblock: "Разблокировать",
      confirm: "Подтвердить",
      delete: "Удалить",
    },
    errors: {
      network:
        "Не удалось подключиться к HUM. Проверьте соединение и попробуйте снова.",
      userNotFound: "Такой аккаунт не найден.",
      requiresRecentLogin:
        "Выйдите из аккаунта и войдите снова, затем повторите попытку.",
      sendFailed: "Это сообщение не удалось доставить.",
    },
    langScreen: {
      title: "Выберите язык",
      subtitle: "Вы всегда сможете изменить его в настройках.",
    },
    auth: {
      showcase: {
        title: "У каждого разговора своя частота.",
        body: "Находите людей, создавайте профиль и будьте готовы к общению — HUM убирает лишний шум.",
        point1: "Поиск людей по имени или @username",
        point2: "Профиль, который действительно ваш",
        point3: "Работает на English, Русском и O‘zbek",
      },
      tabs: { login: "Войти", register: "Создать аккаунт" },
      login: {
        title: "С возвращением",
        subtitle: "Войдите, чтобы продолжить с того же места.",
        submit: "Войти",
        switchPrompt: "Ещё нет аккаунта?",
        switchAction: "Создать",
        errorInvalid: "Неверное имя пользователя или пароль.",
      },
      register: {
        title: "Настройте свою частоту",
        subtitle: "Ещё пара деталей — и вы внутри.",
        usernameHint: "3–20 символов: буквы, цифры, подчёркивание.",
        passwordHint: "Минимум 6 символов.",
        submit: "Создать аккаунт",
        switchPrompt: "Уже есть аккаунт?",
        switchAction: "Войти",
      },
      validation: {
        required: "Это поле обязательно.",
        usernameFormat: "Используйте 3–20 букв, цифр или подчёркиваний.",
        usernameTaken: "Это имя пользователя уже занято.",
        passwordShort: "Пароль должен содержать минимум 6 символов.",
        passwordMismatch: "Пароли не совпадают.",
        displayNameShort: "Введите отображаемое имя.",
      },
    },
    nav: {
      chats: "Чаты",
      people: "Люди",
      profile: "Профиль",
      settings: "Настройки",
      logout: "Выйти",
    },
    chats: {
      title: "Чаты",
      emptyTitle: "Здесь пока тихо",
      emptyBody:
        "Обмен сообщениями в реальном времени скоро появится. А пока — найдите людей и настройте профиль.",
      emptyAction: "Найти людей",
    },
    people: {
      title: "Найти людей",
      searchPlaceholder: "Поиск по имени или @username",
      empty: "Никого не найдено.",
      hint: "Ищите по имени или @username.",
      view: "Открыть",
      you: "Вы",
    },
    welcome: {
      title: "Добро пожаловать в HUM",
      body: "Найдите кого-нибудь слева или откройте свой профиль, чтобы настроить его.",
    },
    profile: {
      title: "Ваш профиль",
      edit: "Редактировать",
      backToView: "Готово",
      avatar: { upload: "Загрузить фото", remove: "Удалить" },
      joined: "Регистрация",
      noBio: "Пока нет описания.",
      saved: "Профиль обновлён.",
      message: "Написать",
      comingSoon: "Обмен сообщениями появится в будущей версии HUM.",
    },
    chat: {
      emptyTitle: "Начните разговор",
      inputPlaceholder: "Сообщение",
      send: "Отправить",
      youPrefix: "Вы: ",
      blockedNotice: "Вы заблокировали этого человека.",
      typingIndicator: "Печатает...",
      receiptSent: "Отправлено",
      receiptRead: "Прочитано",
      messageDeleted: "Это сообщение удалено",
      voice: {
        record: "Записать голосовое сообщение",
        stop: "Стоп",
        cancel: "Отмена",
        recording: "Запись",
        uploading: "Загрузка голосового сообщения…",
        sent: "Голосовое сообщение отправлено",
        micDenied: "Не удалось получить доступ к микрофону",
        unsupported: "Голосовые сообщения не поддерживаются в этом браузере",
        recordFailed: "Ошибка записи",
        emptyRecording: "Запись слишком короткая",
        uploadFailed: "Ошибка загрузки",
        playbackError: "Ошибка воспроизведения",
        play: "Воспроизвести голосовое сообщение",
        pause: "Приостановить голосовое сообщение",
        listPreview: "🎤 Голосовое сообщение",
      },
      attach: {
        button: "Прикрепить файл",
        uploading: "Загрузка {name}…",
        sent: "{name} отправлен(о)",
        uploadFailed: "Не удалось загрузить {name}",
        tooLarge: "Файл «{name}» слишком большой (макс. 20 МБ).",
        unsupportedType: "Файл «{name}» неподдерживаемого типа.",
        image: "Фото",
        fileFallbackName: "Файл",
        download: "Скачать",
        downloadFailed: "Не удалось открыть файл",
        imageLoadFailed: "Не удалось загрузить изображение",
        listPreviewPhoto: "📷 Фото",
        listPreviewFile: "📎 Файл: {name}",
      },
      reactions: {
        add: "Добавить реакцию",
        picker: "Выберите реакцию",
        emojiLabel: "Отреагировать {emoji}",
        chipLabel: "{emoji} реакций: {count}",
      },
    },
    menu: {
      remove: "Удалить",
      block: "Заблокировать",
      unblock: "Разблокировать",
      deleteForMe: "Удалить у меня",
      deleteForEveryone: "Удалить у всех",
    },
    confirm: {
      removeTitle: "Удалить этот чат?",
      removeBody:
        "Разговор будет удалён из вашего списка чатов. У {name} останется своя копия, и вы всегда сможете начать переписку заново.",
      blockTitle: "Заблокировать {name}?",
      blockBody:
        "{name} не сможет писать вам, и вы не увидите этого пользователя в поиске или списке чатов. Разблокировать можно в любой момент в Настройках.",
      unblockTitle: "Разблокировать {name}?",
      unblockBody: "{name} снова сможет писать вам и появится в поиске.",
      deleteMeTitle: "Удалить это сообщение только у вас?",
      deleteMeBody:
        "Сообщение исчезнет только из вашей переписки — у {name} оно останется.",
      deleteEveryoneTitle: "Удалить это сообщение у всех?",
      deleteEveryoneBody:
        "Сообщение будет заменено на «Сообщение удалено» и у вас, и у {name}. Это действие нельзя отменить.",
    },
    settings: {
      title: "Настройки",
      language: "Язык",
      languageHint: "Выберите язык интерфейса HUM.",
      appearance: "Внешний вид",
      appearanceHint: "Переключение между тёмным и светлым режимом.",
      dark: "Тёмная",
      light: "Светлая",
      privacy: "Приватность",
      privacyHint:
        "Заблокированные пользователи не смогут писать вам и не будут видны в поиске.",
      blockedUsersEmpty: "Вы никого не заблокировали.",
      account: "Аккаунт",
      accountHint: "Вы вошли как {username}.",
    },
    toast: {
      loggedIn: "С возвращением, {name}.",
      accountCreated: "Аккаунт создан. Добро пожаловать, {name}!",
      loggedOut: "Вы вышли из аккаунта.",
      profileSaved: "Профиль обновлён.",
      langChanged: "Язык изменён.",
      chatRemoved: "Чат удалён.",
      userBlocked: "{name} заблокирован(а).",
      userUnblocked: "{name} разблокирован(а).",
      messageDeletedForMe: "Сообщение удалено у вас.",
      messageDeletedEveryone: "Сообщение удалено.",
    },
  },

  uz: {
    common: {
      username: "Foydalanuvchi nomi",
      usernamePlaceholder: "yourname",
      password: "Parol",
      passwordPlaceholder: "••••••••",
      confirmPassword: "Parolni tasdiqlang",
      displayName: "Ko‘rinadigan ism",
      displayNamePlaceholder: "Aziza Karimova",
      bio: "Men haqimda",
      bioPlaceholder: "O‘zingiz haqingizda yozing",
      show: "Ko‘rsatish",
      hide: "Yashirish",
      cancel: "Bekor qilish",
      saveChanges: "Saqlash",
      close: "Yopish",
      back: "Orqaga",
      avatarTooLarge: "Rasm hajmi juda katta (maks. 700KB).",
      loading: "Yuklanmoqda…",
      moreOptions: "Yana",
      remove: "Olib tashlash",
      block: "Bloklash",
      unblock: "Blokdan chiqarish",
      confirm: "Tasdiqlash",
      delete: "Oʻchirish",
    },
    errors: {
      network:
        "HUM bilan bog‘lanishda xatolik yuz berdi. Aloqani tekshirib, qayta urinib ko‘ring.",
      userNotFound: "Bunday akkaunt topilmadi.",
      requiresRecentLogin:
        "Hisobdan chiqib, qayta kiring va yana urinib ko‘ring.",
      sendFailed: "Bu xabarni yetkazib bo‘lmadi.",
    },
    langScreen: {
      title: "Tilni tanlang",
      subtitle: "Buni istalgan vaqtda Sozlamalarda o‘zgartirishingiz mumkin.",
    },
    auth: {
      showcase: {
        title: "Har bir suhbatning o‘z chastotasi bor.",
        body: "Odamlarni toping, profilingizni yarating va muloqotga tayyor bo‘ling — HUM ortiqcha shovqinni olib tashlaydi.",
        point1: "Odamlarni ism yoki @username orqali qidiring",
        point2: "Chindan ham sizga tegishli profil",
        point3: "English, Русский va O‘zbek tilida ishlaydi",
      },
      tabs: { login: "Kirish", register: "Ro‘yxatdan o‘tish" },
      login: {
        title: "Xush kelibsiz",
        subtitle: "Qolgan joydan davom eting.",
        submit: "Kirish",
        switchPrompt: "Hali akkountingiz yo‘qmi?",
        switchAction: "Yaratish",
        errorInvalid: "Foydalanuvchi nomi yoki parol noto‘g‘ri.",
      },
      register: {
        title: "Chastotangizni sozlang",
        subtitle: "Bir necha ma’lumot — va tayyor.",
        usernameHint: "3–20 ta belgi: harflar, raqamlar, pastki chiziq.",
        passwordHint: "Kamida 6 ta belgi.",
        submit: "Akkount yaratish",
        switchPrompt: "Akkountingiz bormi?",
        switchAction: "Kirish",
      },
      validation: {
        required: "Ushbu maydon majburiy.",
        usernameFormat:
          "3–20 ta harf, raqam yoki pastki chiziqdan foydalaning.",
        usernameTaken: "Bu foydalanuvchi nomi allaqachon band.",
        passwordShort: "Parol kamida 6 ta belgidan iborat bo‘lishi kerak.",
        passwordMismatch: "Parollar mos kelmadi.",
        displayNameShort: "Ko‘rinadigan ism kiriting.",
      },
    },
    nav: {
      chats: "Suhbatlar",
      people: "Odamlar",
      profile: "Profil",
      settings: "Sozlamalar",
      logout: "Chiqish",
    },
    chats: {
      title: "Suhbatlar",
      emptyTitle: "Bu yerda hozircha jim",
      emptyBody:
        "Real vaqtda xabar almashish tez orada qo‘shiladi. Hozircha odamlarni toping va profilingizni tayyorlang.",
      emptyAction: "Odamlarni topish",
    },
    people: {
      title: "Odamlarni topish",
      searchPlaceholder: "Ism yoki @username orqali qidiring",
      empty: "Hech kim topilmadi.",
      hint: "Ism yoki @username orqali qidiring.",
      view: "Ko‘rish",
      you: "Siz",
    },
    welcome: {
      title: "HUM ga xush kelibsiz",
      body: "Chapdan birovni qidiring yoki profilingizni o‘zingizga moslashtiring.",
    },
    profile: {
      title: "Sizning profilingiz",
      edit: "Tahrirlash",
      backToView: "Tayyor",
      avatar: { upload: "Rasm yuklash", remove: "O‘chirish" },
      joined: "Ro‘yxatdan o‘tgan",
      noBio: "Hozircha tavsif yo‘q.",
      saved: "Profil yangilandi.",
      message: "Xabar yozish",
      comingSoon:
        "Real vaqtda xabar almashish HUM ning keyingi versiyasida qo‘shiladi.",
    },
    chat: {
      emptyTitle: "Suhbatni boshlang",
      inputPlaceholder: "Xabar",
      send: "Yuborish",
      youPrefix: "Siz: ",
      blockedNotice: "Siz bu odamni bloklagansiz.",
      typingIndicator: "Yozmoqda...",
      receiptSent: "Yuborildi",
      receiptRead: "Oʻqildi",
      messageDeleted: "Bu xabar oʻchirildi",
      voice: {
        record: "Ovozli xabar yozish",
        stop: "Toʻxtatish",
        cancel: "Bekor qilish",
        recording: "Yozib olinmoqda",
        uploading: "Ovozli xabar yuklanmoqda…",
        sent: "Ovozli xabar yuborildi",
        micDenied: "Mikrofonga ruxsat berilmadi",
        unsupported: "Bu brauzerda ovozli xabarlar qoʻllab-quvvatlanmaydi",
        recordFailed: "Yozib olishda xatolik",
        emptyRecording: "Yozuv juda qisqa",
        uploadFailed: "Yuklashda xatolik",
        playbackError: "Ijro etishda xatolik",
        play: "Ovozli xabarni ijro etish",
        pause: "Ovozli xabarni pauza qilish",
        listPreview: "🎤 Ovozli xabar",
      },
      attach: {
        button: "Fayl biriktirish",
        uploading: "{name} yuklanmoqda…",
        sent: "{name} yuborildi",
        uploadFailed: "{name} yuklanmadi",
        tooLarge: "«{name}» fayli juda katta (maks. 20 MB).",
        unsupportedType: "«{name}» fayli qoʻllab-quvvatlanmaydigan turda.",
        image: "Rasm",
        fileFallbackName: "Fayl",
        download: "Yuklab olish",
        downloadFailed: "Faylni ochib boʻlmadi",
        imageLoadFailed: "Rasmni yuklab boʻlmadi",
        listPreviewPhoto: "📷 Rasm",
        listPreviewFile: "📎 Fayl: {name}",
      },
      reactions: {
        add: "Reaksiya qoʻshish",
        picker: "Reaksiyani tanlang",
        emojiLabel: "{emoji} bilan reaksiya bildirish",
        chipLabel: "{emoji} reaksiyalar: {count}",
      },
    },
    menu: {
      remove: "Olib tashlash",
      block: "Bloklash",
      unblock: "Blokdan chiqarish",
      deleteForMe: "Men uchun o‘chirish",
      deleteForEveryone: "Hamma uchun o‘chirish",
    },
    confirm: {
      removeTitle: "Bu suhbat olib tashlansinmi?",
      removeBody:
        "Suhbat sizning ro‘yxatingizdan olib tashlanadi. {name} da o‘z nusxasi qoladi, va istalgan vaqtda u bilan yangi suhbat boshlashingiz mumkin.",
      blockTitle: "{name} bloklansinmi?",
      blockBody:
        "{name} sizga xabar yoza olmaydi va u qidiruv yoki suhbatlar ro‘yxatida ko‘rinmaydi. Istalgan vaqtda Sozlamalarda blokdan chiqarishingiz mumkin.",
      unblockTitle: "{name} blokdan chiqarilsinmi?",
      unblockBody:
        "{name} sizga yana xabar yoza oladi va qidiruvda qayta ko‘rinadi.",
      deleteMeTitle: "Bu xabar faqat siz uchun o‘chirilsinmi?",
      deleteMeBody:
        "Xabar faqat sizning yozishmangizdan yo‘qoladi — {name} da u qoladi.",
      deleteEveryoneTitle: "Bu xabar hamma uchun o‘chirilsinmi?",
      deleteEveryoneBody:
        "Xabar sizda ham, {name} da ham «Xabar o‘chirildi» matniga almashtiriladi. Buni bekor qilib bo‘lmaydi.",
    },
    settings: {
      title: "Sozlamalar",
      language: "Til",
      languageHint: "HUM siz bilan gaplashadigan tilni tanlang.",
      appearance: "Ko‘rinish",
      appearanceHint: "Tungi yoki kunduzgi rejim orasida almashing.",
      dark: "Tungi",
      light: "Kunduzgi",
      privacy: "Maxfiylik",
      privacyHint:
        "Siz bloklagan foydalanuvchilar sizga yoza olmaydi va qidiruvda ko‘rinmaydi.",
      blockedUsersEmpty: "Siz hech kimni bloklamagansiz.",
      account: "Akkount",
      accountHint: "Siz {username} sifatida kirdingiz.",
    },
    toast: {
      loggedIn: "Xush kelibsiz, {name}.",
      accountCreated: "Akkount yaratildi. Xush kelibsiz, {name}!",
      loggedOut: "Tizimdan chiqdingiz.",
      profileSaved: "Profil yangilandi.",
      langChanged: "Til o‘zgartirildi.",
      chatRemoved: "Suhbat olib tashlandi.",
      userBlocked: "{name} bloklandi.",
      userUnblocked: "{name} blokdan chiqarildi.",
      messageDeletedForMe: "Xabar siz uchun oʻchirildi.",
      messageDeletedEveryone: "Xabar oʻchirildi.",
    },
  },
};

let currentLang = getItem(KEYS.LANG, "en");
if (!translations[currentLang]) currentLang = "en";

function getLang() {
  return currentLang;
}

function setLang(lang) {
  if (!translations[lang]) return;
  currentLang = lang;
  setItem(KEYS.LANG, lang);
  applyTranslations();
}

function resolve(path, lang) {
  const parts = path.split(".");
  let node = translations[lang];
  for (const p of parts) {
    if (node == null) return null;
    node = node[p];
  }
  return typeof node === "string" ? node : null;
}

function t(path, vars) {
  let str = resolve(path, currentLang);
  if (str == null) str = resolve(path, "en");
  if (str == null) return path;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(new RegExp(`{${k}}`, "g"), vars[k]);
    });
  }
  return str;
}

function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
  document.documentElement.lang = currentLang;
  document.querySelectorAll(".lang-pill, .lang-option").forEach((el) => {
    el.classList.toggle(
      "is-active",
      el.getAttribute("data-lang") === currentLang,
    );
  });
}
/* ===================================================================
   SECTION: UTILITIES
=================================================================== */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const AVATAR_PALETTE = [
  "#7c9eff",
  "#f5b942",
  "#4ade80",
  "#ff8b7c",
  "#c792ea",
  "#5ee7d4",
  "#ffa4d8",
  "#8fb8ff",
];

function colorForUsername(username) {
  let sum = 0;
  for (let i = 0; i < username.length; i++) sum += username.charCodeAt(i);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}

function initialsFor(displayName) {
  if (!displayName) return "?";
  const parts = displayName.trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

// avatar: { type:'upload', data:<dataURL> } | { type:'generated' }
// Builds/updates an <img> + <span> pair inside `el` so uploaded photos are
// always clipped with object-fit:cover and initials never overflow the circle.
function applyAvatar(el, user) {
  let img = el.querySelector(".avatar__img");
  let span = el.querySelector(".avatar__initials");
  if (!img) {
    img = document.createElement("img");
    img.className = "avatar__img";
    img.alt = "";
    img.hidden = true;
    el.appendChild(img);
  }
  if (!span) {
    span = document.createElement("span");
    span.className = "avatar__initials";
    el.appendChild(span);
  }
  if (user.avatar && user.avatar.type === "upload" && user.avatar.data) {
    img.src = user.avatar.data;
    img.hidden = false;
    span.hidden = true;
    el.style.background = "transparent";
  } else {
    img.hidden = true;
    img.removeAttribute("src");
    span.hidden = false;
    span.textContent = initialsFor(user.displayName);
    el.style.background = colorForUsername(user.username);
  }
}

function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message, type = "default") {
  const host = document.getElementById("toastHost");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast" + (type !== "default" ? ` toast--${type}` : "");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s ease, transform .25s ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}

function formatDate(iso, lang) {
  try {
    const locale = lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-US";
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
    });
  } catch (e) {
    return iso;
  }
}

// Compact timestamp for chat bubbles and the chats list: just the time
// for messages sent today, otherwise a short date (plus year if it
// wasn't this year), so it never wraps or crowds the layout.
function formatCompactTime(iso, lang) {
  try {
    const locale = lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-US";
    const date = new Date(iso);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString(
      locale,
      sameYear
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "short", year: "numeric" },
    );
  } catch (e) {
    return "";
  }
}
/* ===================================================================
   SECTION: AUTHENTICATION (local prototype)
   Structured so the storage calls here are the only thing that need
   to change when this becomes a real backend-backed auth system.
=================================================================== */

function validateRegistration({
  displayName,
  username,
  password,
  confirmPassword,
}) {
  const errors = {};

  if (!displayName || !displayName.trim()) {
    errors.displayName = t("auth.validation.displayNameShort");
  }

  if (!username || !username.trim()) {
    errors.username = t("auth.validation.required");
  } else if (!USERNAME_RE.test(username.trim())) {
    errors.username = t("auth.validation.usernameFormat");
  }
  // Uniqueness is enforced by Firebase Auth itself (each username maps
  // to a unique synthetic email) — see registerUser()'s catch below —
  // rather than a separate pre-check here, so there's no race between
  // "check it's free" and "claim it" on two devices registering the
  // same name at once.

  if (!password) {
    errors.password = t("auth.validation.required");
  } else if (password.length < 6) {
    errors.password = t("auth.validation.passwordShort");
  }

  if (!confirmPassword) {
    errors.confirmPassword = t("auth.validation.required");
  } else if (password !== confirmPassword) {
    errors.confirmPassword = t("auth.validation.passwordMismatch");
  }

  return errors;
}

async function registerUser({ displayName, username, password, bio, avatar }) {
  requireFirebaseConfig();
  const errors = validateRegistration({
    displayName,
    username,
    password,
    confirmPassword: password,
  });
  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  const uname = username.trim();
  const lower = usernameDocId(uname);

  let credential;
  try {
    credential = await createUserWithEmailAndPassword(
      auth,
      emailForUsername(lower),
      password,
    );
  } catch (e) {
    if (e.code === "auth/email-already-in-use") {
      return {
        ok: false,
        errors: { username: t("auth.validation.usernameTaken") },
      };
    }
    return { ok: false, errors: { form: t("errors.network") } };
  }

  const user = {
    uid: credential.user.uid,
    username: uname,
    usernameLower: lower,
    displayName: displayName.trim(),
    displayNameLower: displayName.trim().toLowerCase(),
    bio: (bio || "").trim(),
    avatar: avatar || { type: "generated" },
    createdAt: new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, "users", credential.user.uid), user);
  } catch (e) {
    return { ok: false, errors: { form: t("errors.network") } };
  }

  state.me = user;
  return { ok: true, user };
}

async function loginUser({ username, password }) {
  requireFirebaseConfig();
  if (!username || !password) {
    return { ok: false, error: t("auth.validation.required") };
  }
  let credential;
  try {
    credential = await signInWithEmailAndPassword(
      auth,
      emailForUsername(username),
      password,
    );
  } catch (e) {
    if (
      e.code === "auth/invalid-credential" ||
      e.code === "auth/wrong-password" ||
      e.code === "auth/user-not-found" ||
      e.code === "auth/invalid-email"
    ) {
      return { ok: false, error: t("auth.login.errorInvalid") };
    }
    return { ok: false, error: t("errors.network") };
  }
  let user;
  try {
    // Loads by UID (with automatic migration/recovery if needed) rather
    // than trusting the username just typed into the form — that's what
    // makes this resilient to the exact "Auth exists, profile doesn't"
    // failure mode instead of just failing the same way again.
    user = await loadOrRecoverProfile(credential.user);
  } catch (e) {
    console.error("HUM: failed to load/recover profile after login", e);
    await signOut(auth).catch(() => {});
    return { ok: false, error: t("errors.network") };
  }
  state.me = user;
  return { ok: true, user };
}

async function logoutUser() {
  requireFirebaseConfig();
  // Mark presence offline, and clear any "I'm typing" flag, BEFORE
  // signing out (and before stopAllConversationWatchers, which is what
  // actually tears down the .info/connected and "watching the other
  // participant's typing" listeners) — signOut() invalidates the ID
  // token, and the Realtime Database rules require a still-valid
  // auth.uid to allow writing presence/{uid} or typing/{convId}/{uid},
  // so both have to happen while still signed in.
  if (state.me) {
    await goOfflineNow(state.me.uid);
    await stopMyTyping();
  }
  // Voice messages: "if the user logs out while recording, stop the
  // MediaRecorder, release microphone tracks, cancel the recording, do
  // not send/upload the audio" — cancelVoiceRecording() does all of
  // that locally (no network write involved, so ordering relative to
  // signOut() doesn't matter the way presence/typing's does above; this
  // just needs to run before the mic is left with no owner). Also stop
  // any active playback so audio from the just-ended session doesn't
  // keep playing after logout.
  cancelVoiceRecording();
  stopVoicePlayback();
  stopAllConversationWatchers();
  await signOut(auth).catch(() => {});
  state.me = null;
}

async function updateProfile(updates) {
  requireFirebaseConfig();
  const user = state.me;
  if (!user)
    return { ok: false, errors: { form: t("auth.login.errorInvalid") } };

  const errors = {};
  const nextDisplayName = (updates.displayName || "").trim();
  const nextUsername = (updates.username || "").trim();

  if (!nextDisplayName) {
    errors.displayName = t("auth.validation.displayNameShort");
  }

  if (!nextUsername) {
    errors.username = t("auth.validation.required");
  } else if (!USERNAME_RE.test(nextUsername)) {
    errors.username = t("auth.validation.usernameFormat");
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  const usernameChanged =
    usernameDocId(nextUsername) !== usernameDocId(user.username);
  const nextLower = usernameDocId(nextUsername);

  // Changing the username means changing the Firebase Auth email it
  // maps to, which Firebase itself rejects with auth/email-already-in-use
  // if another account already has it — the same uniqueness check the
  // rest of the app relies on, so there's nothing extra to pre-check
  // here. It can also ask for a fresh login (auth/requires-recent-login)
  // if the session is old, which is surfaced as a plain form error
  // rather than a crash.
  if (usernameChanged) {
    try {
      await updateEmail(auth.currentUser, emailForUsername(nextLower));
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        return {
          ok: false,
          errors: { username: t("auth.validation.usernameTaken") },
        };
      }
      if (e.code === "auth/requires-recent-login") {
        return { ok: false, errors: { form: t("errors.requiresRecentLogin") } };
      }
      return { ok: false, errors: { form: t("errors.network") } };
    }
  }

  const updatedUser = {
    ...user,
    displayName: nextDisplayName,
    displayNameLower: nextDisplayName.toLowerCase(),
    username: nextUsername,
    usernameLower: nextLower,
    bio: (updates.bio || "").trim(),
    avatar: updates.avatar !== undefined ? updates.avatar : user.avatar,
  };

  try {
    // The profile document lives at users/{uid}, and uid never changes,
    // so a username change is now just an ordinary field update on the
    // same document — no more deleting one document and creating
    // another under a different ID, which used to be the exact kind of
    // operation that could leave an account's profile missing if it
    // failed partway through.
    await setDoc(doc(db, "users", user.uid), updatedUser);
  } catch (e) {
    return { ok: false, errors: { form: t("errors.network") } };
  }

  state.me = updatedUser;
  return { ok: true, user: updatedUser, usernameChanged };
}

// Firestore has no built-in "contains" text search, so this does two
// prefix ("starts with") queries — one on the lowercased username,
// one on the lowercased display name — and merges the results. That
// covers the common case (typing the start of someone's name or
// @handle) without needing a separate search service. Throws on
// network failure so callers can show a real error state instead of
// silently showing zero results.
async function searchUsers(searchQuery, excludeUsernameLower) {
  requireFirebaseConfig();
  const q = (searchQuery || "").trim().toLowerCase();
  const usersCol = collection(db, "users");
  let rows = [];

  if (!q) {
    // Blank query: browse everyone, like the old "list all local
    // users" default did, capped to a reasonable page size.
    const snap = await getDocs(
      fbQuery(usersCol, orderBy("displayNameLower"), limit(40)),
    );
    rows = snap.docs.map((d) => d.data());
  } else {
    const upperBound = q + "\uf8ff";
    const [byUsername, byDisplayName] = await Promise.all([
      getDocs(
        fbQuery(
          usersCol,
          orderBy("usernameLower"),
          where("usernameLower", ">=", q),
          where("usernameLower", "<=", upperBound),
          limit(20),
        ),
      ),
      getDocs(
        fbQuery(
          usersCol,
          orderBy("displayNameLower"),
          where("displayNameLower", ">=", q),
          where("displayNameLower", "<=", upperBound),
          limit(20),
        ),
      ),
    ]);
    const seen = new Map();
    [...byUsername.docs, ...byDisplayName.docs].forEach((d) =>
      seen.set(d.id, d.data()),
    );
    rows = Array.from(seen.values());
  }

  return rows
    .filter((u) => u.usernameLower !== (excludeUsernameLower || ""))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, 30);
}

/* ===================================================================
   SECTION: RENDERING HELPERS (DOM building for dynamic content)
=================================================================== */

function avatarMarkup(user) {
  if (user.avatar && user.avatar.type === "upload" && user.avatar.data) {
    return `<img class="avatar__img" src="${user.avatar.data}" alt="">`;
  }
  return `<span class="avatar__initials">${escapeHtml(initialsFor(user.displayName))}</span>`;
}
function avatarBg(user) {
  if (user.avatar && user.avatar.type === "upload" && user.avatar.data)
    return "transparent";
  return colorForUsername(user.username);
}

/* ================= SKELETON LOADING SYSTEM =================
   Reusable shimmer placeholders shown only at real loading boundaries
   — chats list (state.chatsListLoading), open-chat messages
   (state.chatMessagesLoading), people search (the `loading` flag
   renderPeopleResults already receives from runPeopleSearch), and a
   viewed profile (openProfileView, while findUserByUsername is in
   flight). No setTimeout anywhere here — every skeleton is swapped
   for real content (or an existing error/empty state) the moment the
   underlying Firestore/Supabase call actually resolves. Everything is
   aria-hidden/non-focusable since it carries no real content; the
   surrounding container carries role="status"/aria-busy instead so
   screen readers get a single, sane "loading" announcement rather
   than reading out placeholder rows. */
function skeletonAvatarMarkup(size) {
  return `<div class="skeleton skeleton-avatar" style="width:${size}px;height:${size}px" aria-hidden="true"></div>`;
}

function skeletonLineMarkup(widthPct, extraStyle) {
  return `<div class="skeleton skeleton-line" style="width:${widthPct}%;${extraStyle || ""}" aria-hidden="true"></div>`;
}

// Slightly different line widths per row so a run of skeleton rows
// doesn't look like a single repeated tile.
const CHAT_ROW_SKELETON_WIDTHS = [
  [46, 72],
  [58, 54],
  [38, 66],
  [64, 40],
  [50, 60],
  [42, 50],
];

function chatsListSkeletonMarkup(count = 6) {
  const rows = Array.from({ length: count }, (_, i) => {
    const [nameW, previewW] = CHAT_ROW_SKELETON_WIDTHS[i % CHAT_ROW_SKELETON_WIDTHS.length];
    return `
      <div class="skeleton-chat-row" aria-hidden="true">
        ${skeletonAvatarMarkup(44)}
        <div class="result-row__info">
          ${skeletonLineMarkup(nameW, "height:13px;")}
          ${skeletonLineMarkup(previewW, "height:11px;")}
        </div>
        <div class="skeleton skeleton-line skeleton-line--time" aria-hidden="true"></div>
      </div>
    `;
  }).join("");
  return `<div class="skeleton-group skeleton-group--rows" role="status" aria-busy="true" aria-label="${escapeHtml(t("common.loading"))}">${rows}</div>`;
}

function peopleResultsSkeletonMarkup(count = 6) {
  const rows = Array.from({ length: count }, (_, i) => {
    const [nameW, previewW] = CHAT_ROW_SKELETON_WIDTHS[i % CHAT_ROW_SKELETON_WIDTHS.length];
    return `
      <div class="skeleton-search-row" aria-hidden="true">
        ${skeletonAvatarMarkup(44)}
        <div class="result-row__info">
          ${skeletonLineMarkup(nameW, "height:13px;")}
          ${skeletonLineMarkup(previewW, "height:11px;")}
        </div>
        <div class="skeleton skeleton-btn" aria-hidden="true"></div>
      </div>
    `;
  }).join("");
  return `<div class="skeleton-group skeleton-group--rows" role="status" aria-busy="true" aria-label="${escapeHtml(t("common.loading"))}">${rows}</div>`;
}

// Fixed own/theirs + width/height layout that reads like a real short
// exchange (mix of short and long incoming/outgoing bubbles), matching
// what section 2 of the loading-states brief asked for.
const MESSAGE_SKELETON_LAYOUT = [
  { own: false, width: 140, height: 20 },
  { own: false, width: 210, height: 44 },
  { own: true, width: 120, height: 20 },
  { own: false, width: 170, height: 20 },
  { own: true, width: 230, height: 44 },
  { own: true, width: 100, height: 20 },
  { own: false, width: 190, height: 44 },
];

function skeletonMessageMarkup({ own, width, height }) {
  return `
    <div class="chat-msg ${own ? "chat-msg--own" : "chat-msg--theirs"} skeleton-message" aria-hidden="true">
      <div class="skeleton skeleton-message__bubble" style="width:${width}px;height:${height}px"></div>
    </div>
  `;
}

function messagesSkeletonMarkup() {
  const bubbles = MESSAGE_SKELETON_LAYOUT.map(skeletonMessageMarkup).join("");
  return `<div class="skeleton-group" role="status" aria-busy="true" aria-label="${escapeHtml(t("common.loading"))}">${bubbles}</div>`;
}

// Sits inside the exact same .profile-hero/.profile-meta shells
// renderProfileHero() renders into, so the swap to real content never
// jumps in height (see openProfileView).
function profileHeroSkeletonMarkup() {
  return `
    <div class="profile-hero" role="status" aria-busy="true" aria-label="${escapeHtml(t("common.loading"))}">
      ${skeletonAvatarMarkup(100)}
      ${skeletonLineMarkup(46, "height:20px;margin:16px 0 10px;")}
      ${skeletonLineMarkup(30, "height:13px;margin-bottom:18px;")}
      ${skeletonLineMarkup(64, "height:13px;")}
    </div>
    <div class="profile-meta" aria-hidden="true">
      <div class="skeleton-profile-meta-row">${skeletonLineMarkup(22, "height:12px;")}${skeletonLineMarkup(28, "height:12px;")}</div>
      <div class="skeleton-profile-meta-row">${skeletonLineMarkup(22, "height:12px;")}${skeletonLineMarkup(28, "height:12px;")}</div>
    </div>
  `;
}

// Reuses the existing "network error" empty-state look (same class
// people-results__empty already uses) so a failed/empty profile load
// falls back to a familiar state rather than a permanently-stuck
// skeleton — see section 12 requirement that skeletons must never
// linger after a failed load.
function profileViewErrorMarkup(message) {
  return `<div class="people-results__empty" style="padding:60px 24px;">${escapeHtml(message)}</div>`;
}

function renderPeopleResults(
  container,
  users,
  { query, selectedUsername, loading, error },
) {
  if (loading) {
    container.innerHTML = peopleResultsSkeletonMarkup();
    clearPresenceWatchers("peopleResults");
    return;
  }
  if (error) {
    container.innerHTML = `<div class="people-results__empty">${escapeHtml(t("errors.network"))}</div>`;
    clearPresenceWatchers("peopleResults");
    return;
  }
  if (!users.length) {
    container.innerHTML = `
      <div class="people-results__empty">${query ? escapeHtml(t("people.empty")) : escapeHtml(t("people.hint"))}</div>
    `;
    clearPresenceWatchers("peopleResults");
    return;
  }

  container.innerHTML = users
    .map(
      (u) => `
    <div class="result-row${selectedUsername === u.username ? " is-active" : ""}" data-username="${escapeHtml(u.username)}" role="button" tabindex="0">
      <div class="avatar" data-presence-uid="${escapeHtml(u.uid)}" style="background:${avatarBg(u)}">${avatarMarkup(u)}</div>
      <div class="result-row__info">
        <div class="result-row__name">${escapeHtml(u.displayName)}</div>
        <div class="result-row__handle">@${escapeHtml(u.username)}</div>
      </div>
      <button type="button" class="btn btn--ghost btn--small" data-username="${escapeHtml(u.username)}" data-action="view">${escapeHtml(t("people.view"))}</button>
    </div>
  `,
    )
    .join("");
  clearPresenceWatchers("peopleResults");
  users.forEach((u) =>
    watchPresenceForScope("peopleResults", u.uid, container),
  );
}

function renderProfileHero(container, user, isSelf) {
  const joined = formatDate(user.createdAt, getLang());
  container.innerHTML = `
    <div class="profile-hero">
      <div class="avatar" data-presence-uid="${escapeHtml(user.uid)}" style="width:100px;height:100px;font-size:34px;background:${avatarBg(user)}">${avatarMarkup(user)}</div>
      <h2 class="profile-hero__name">${escapeHtml(user.displayName)}${isSelf ? ` <span style="color:var(--text-faint);font-weight:500;font-size:15px;">(${escapeHtml(t("people.you"))})</span>` : ""}</h2>
      <div class="profile-hero__handle">@${escapeHtml(user.username)}</div>
      <p class="profile-hero__bio">${user.bio ? escapeHtml(user.bio) : `<em style="color:var(--text-faint)">${escapeHtml(t("profile.noBio"))}</em>`}</p>
      ${
        !isSelf
          ? `
        <div class="profile-hero__actions">
          <button type="button" class="btn btn--primary btn--small" id="btnMessageUser">${escapeHtml(t("profile.message"))}</button>
          <button type="button" class="icon-btn" id="btnProfileMenu" data-i18n-title="common.moreOptions" title="${escapeHtml(t("common.moreOptions"))}" aria-haspopup="true" aria-expanded="false">
            <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>
          </button>
        </div>
      `
          : ""
      }
    </div>
    <div class="profile-meta">
      <div class="profile-meta__row"><span>${escapeHtml(t("common.username"))}</span><span>@${escapeHtml(user.username)}</span></div>
      <div class="profile-meta__row"><span>${escapeHtml(t("profile.joined"))}</span><span>${escapeHtml(joined)}</span></div>
    </div>
  `;
  // Own profile never shows a presence dot (there's nothing informative
  // about telling yourself you're online) — only subscribe for others.
  clearPresenceWatchers("profileView");
  if (!isSelf && user.uid) {
    watchPresenceForScope("profileView", user.uid, container);
  }
}

function renderProfileSummary(container, user) {
  container.innerHTML = `
    <div class="profile-hero" style="padding:0 0 26px;text-align:left;align-items:flex-start;border-bottom:1px solid var(--border);margin-bottom:22px;">
      <div class="avatar" style="width:84px;height:84px;font-size:28px;margin-bottom:14px;background:${avatarBg(user)}">${avatarMarkup(user)}</div>
      <h2 class="profile-hero__name" style="font-size:21px;">${escapeHtml(user.displayName)}</h2>
      <div class="profile-hero__handle">@${escapeHtml(user.username)}</div>
      <p class="profile-hero__bio" style="margin-top:12px;">${user.bio ? escapeHtml(user.bio) : `<em style="color:var(--text-faint)">${escapeHtml(t("profile.noBio"))}</em>`}</p>
    </div>
  `;
}
function renderChatsListRow(user, otherUid, lastMessage, meUid) {
  const isOwn = lastMessage.from === meUid;
  const prefix = isOwn ? t("chat.youPrefix") : "";
  // A voice/image/file message's `text` is always '' (see addMessage/
  // sendVoiceMessage/sendOneAttachment) — show a translated label
  // instead of a blank preview rather than teaching this row about
  // every message type's own fields.
  const bodyText =
    lastMessage.type === "voice"
      ? t("chat.voice.listPreview")
      : lastMessage.type === "image"
        ? t("chat.attach.listPreviewPhoto")
        : lastMessage.type === "file"
          ? t("chat.attach.listPreviewFile", {
              name: lastMessage.fileName || "",
            })
          : lastMessage.text;
  const previewText = (prefix + bodyText).replace(/\s+/g, " ").trim();
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
function chatsEmptyStateMarkup() {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 120 90" class="empty-state__art">
        <path d="M10 60c6-30 12 30 20 0s12-45 20 0 12 45 20 0 12-30 20 0 12 30 18 0"/>
      </svg>
      <h3>${escapeHtml(t("chats.emptyTitle"))}</h3>
      <p>${escapeHtml(t("chats.emptyBody"))}</p>
      <button type="button" class="btn btn--primary btn--small" id="emptyToPeople">${escapeHtml(t("chats.emptyAction"))}</button>
    </div>
  `;
}

// The Chats panel doesn't fetch on demand — it just renders whatever
// watchUserConversations() last delivered (state.chatsListRows /
// state.chatsListError / state.chatsListLoading), which that live
// listener keeps current for as long as the person is logged in. That
// listener is what makes a message someone just received on another
// device show up here without needing to refresh or reopen the tab.
function renderChatsList() {
  if (!els.chatsListContainer) return;
  const me = currentUser();
  if (!me) {
    els.chatsListContainer.innerHTML = "";
    clearPresenceWatchers("chatsList");
    return;
  }
  if (state.chatsListError) {
    els.chatsListContainer.innerHTML = `
      <div class="people-results__empty">
        ${escapeHtml(t("errors.network"))}
      </div>
    `;
    clearPresenceWatchers("chatsList");
    return;
  }
  if (state.chatsListLoading) {
    els.chatsListContainer.innerHTML = chatsListSkeletonMarkup();
    clearPresenceWatchers("chatsList");
    return;
  }
  const rows = (state.chatsListRows || []).filter(
    (row) => !state.myBlockedUids.has(row.otherUid),
  );
  if (!rows.length) {
    els.chatsListContainer.innerHTML = chatsEmptyStateMarkup();
    clearPresenceWatchers("chatsList");
    return;
  }
  els.chatsListContainer.innerHTML = rows
    .map(({ other, otherUid, lastMessage }) =>
      renderChatsListRow(other, otherUid, lastMessage, me.uid),
    )
    .join("");
  clearPresenceWatchers("chatsList");
  rows.forEach(({ otherUid }) =>
    watchPresenceForScope("chatsList", otherUid, els.chatsListContainer),
  );
}

function renderChatHeader(user) {
  if (!els.chatHeaderAvatar) return;
  els.chatHeaderAvatar.style.background = avatarBg(user);
  els.chatHeaderAvatar.innerHTML = avatarMarkup(user);
  els.chatHeaderAvatar.classList.remove("avatar--online"); // reset; watchPresenceForScope below sets it live
  els.chatHeaderAvatar.setAttribute("data-presence-uid", user.uid || "");
  els.chatHeaderName.textContent = user.displayName;
  els.chatHeaderHandle.textContent = "@" + user.username;
  clearPresenceWatchers("chatHeader");
  if (user.uid) {
    watchPresenceForScope(
      "chatHeader",
      user.uid,
      els.chatHeaderInfo || document,
    );
  }
}

// Like renderChatsList(), this renders from whatever the currently
// open chat's live listener (watchConversationMessages, wired in
// openChat()) last delivered — state.chatMessagesData /
// state.chatMessagesError / state.chatMessagesLoading — rather than
// fetching on its own, so a reply that arrives from the other person's
// device appears immediately.
function renderChatMessages() {
  if (!els.chatMessages) return;
  const me = currentUser();
  if (!me || !state.activeChatUsername) {
    els.chatMessages.innerHTML = "";
    return;
  }
  if (state.chatMessagesError) {
    els.chatMessages.innerHTML = `<div class="chat-empty">${escapeHtml(t("errors.network"))}</div>`;
    return;
  }
  if (state.chatMessagesLoading) {
    els.chatMessages.innerHTML = messagesSkeletonMarkup();
    return;
  }
  // "Delete for me" (see deleteMessageForMe/confirmAndDeleteMessage)
  // hides a message from just the caller's own view — filtered out
  // here, at render time, exactly as asked, rather than in the data
  // layer (watchConversationMessages/markMessagesRead still see the
  // full unfiltered list, so read receipts stay accurate regardless of
  // what the signed-in user has personally hidden from their own view).
  const messages = (state.chatMessagesData || []).filter(
    (m) => !(Array.isArray(m.deletedFor) && m.deletedFor.includes(me.uid)),
  );
  if (!messages.length) {
    els.chatMessages.innerHTML = `<div class="chat-empty">${escapeHtml(t("chat.emptyTitle"))}</div>`;
    return;
  }
  els.chatMessages.innerHTML = messages
    .map((m) => {
      const isOwn = m.from === me.uid;
      const isDeletedForEveryone = m.deletedForEveryone === true;
      // Read receipts only ever apply to messages the signed-in user
      // sent themselves — an incoming message never shows a
      // ✓/✓✓ mark. `m.readAt` being missing (older messages written
      // before this field existed, or simply "not read yet") is
      // treated the same as explicitly unread — see markMessagesRead
      // and the readAt schema note at the top of this file.
      const receiptMarkup = isOwn
        ? `<span class="chat-msg__receipt${m.readAt ? " chat-msg__receipt--read" : ""}" title="${escapeHtml(t(m.readAt ? "chat.receiptRead" : "chat.receiptSent"))}">${m.readAt ? "✓✓" : "✓"}</span>`
        : "";
      // A tombstoned message shows "This message was deleted" in place
      // of its original content (text OR voice player OR attachment)
      // for BOTH participants — see deleteMessageForEveryone. The
      // original fields are left alone in Firestore; only rendering
      // hides them.
      const bubbleMarkup = isDeletedForEveryone
        ? `<div class="chat-msg__bubble chat-msg__bubble--deleted">${escapeHtml(t("chat.messageDeleted"))}</div>`
        : m.type === "voice" && m.voicePath
          ? voiceMessageBubbleMarkup(m)
          : m.type === "image" && m.filePath
            ? imageMessageBubbleMarkup(m)
            : m.type === "file" && m.filePath
              ? fileMessageBubbleMarkup(m)
              : `<div class="chat-msg__bubble">${escapeHtml(m.text)}</div>`;
      // The delete-action trigger itself — nothing left to delete on an
      // already-tombstoned message, so it's simply omitted there rather
      // than offered redundantly. data-msg-id/data-msg-own live on the
      // outer .chat-msg container (see the click delegation on
      // els.chatMessages further down, which reuses this same pattern
      // as voice playback's data-voice-id/data-voice-path).
      const menuMarkup = isDeletedForEveryone
        ? ""
        : `<button type="button" class="chat-msg__menu-btn" data-msg-menu aria-label="${escapeHtml(t("common.moreOptions"))}">
             <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/></svg>
           </button>`;
      // Reaction trigger + the aggregated counters underneath the
      // bubble — both omitted for a tombstoned message, same as
      // menuMarkup above, so "deleted messages must not show
      // reactions" holds even if the doc still carries a `reactions`
      // field underneath (see reactionsBarMarkup: rendering is what
      // hides it, the data itself is never touched by deletion).
      const reactBtnMarkup = isDeletedForEveryone
        ? ""
        : `<button type="button" class="chat-msg__react-btn" data-msg-react-btn aria-label="${escapeHtml(t("chat.reactions.add"))}" title="${escapeHtml(t("chat.reactions.add"))}">
             <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.5 14c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>
           </button>`;
      const reactionsMarkup = isDeletedForEveryone
        ? ""
        : reactionsBarMarkup(m, me.uid);
      return `
        <div class="chat-msg ${isOwn ? "chat-msg--own" : "chat-msg--theirs"}" data-msg-id="${escapeHtml(m.id || "")}" data-msg-own="${isOwn}">
          ${bubbleMarkup}
          ${reactionsMarkup}
          <div class="chat-msg__time">${escapeHtml(formatCompactTime(m.ts, getLang()))}${receiptMarkup}${reactBtnMarkup}${menuMarkup}</div>
        </div>
      `;
    })
    .join("");
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  // Re-derive playback UI for whatever's now in the DOM — if a voice
  // message was mid-playback when this render fired (e.g. triggered by
  // an unrelated read-receipt update), this restores its progress
  // instead of it flashing back to "not playing" until the next
  // 'timeupdate' tick.
  syncVoicePlayersUI();
  // Same "sync render, then hydrate async details" idea for image
  // attachments — fills in signed URLs for any still-loading placeholder.
  hydrateChatFileImages();
}

// Compact HUM-style voice-message player, used in place of the normal
// text bubble for `type === 'voice'` messages (see renderChatMessages
// above). data-voice-id is the Firestore message id (see
// toggleVoicePlayback/syncVoicePlayersUI); playback itself is wired via
// delegation, not per-node listeners, since this markup is torn down
// and rebuilt on every renderChatMessages() call.
function voiceMessageBubbleMarkup(m) {
  const duration = Number(m.voiceDuration) || 0;
  const isActivePlaying =
    m.id && m.id === activeVoiceMessageId && !sharedVoiceAudio.paused;
  return `
    <div class="chat-msg__bubble chat-msg__bubble--voice" data-voice-id="${escapeHtml(m.id || "")}" data-voice-path="${escapeHtml(m.voicePath)}" data-voice-duration="${duration}">
      <button type="button" class="chat-voice-play${isActivePlaying ? " is-playing" : ""}" data-voice-play aria-label="${escapeHtml(t(isActivePlaying ? "chat.voice.pause" : "chat.voice.play"))}">
        <svg class="chat-voice-play__icon-play" viewBox="0 0 24 24" width="14" height="14"><path d="M6 4l14 8-14 8V4Z"/></svg>
        <svg class="chat-voice-play__icon-pause" viewBox="0 0 24 24" width="14" height="14"><path d="M6 4h4v16H6V4Zm8 0h4v16h-4V4Z"/></svg>
      </button>
      <div class="chat-voice-track">
        <div class="chat-voice-progress"><div class="chat-voice-progress__fill"></div></div>
        <div class="chat-voice-time">${escapeHtml(formatVoiceDuration(duration))}</div>
      </div>
    </div>
  `;
}

// Delegated click handling for voice-message play/pause buttons is
// wired near the rest of the composer/chat event listeners further
// down (after `els` is defined) — see the els.chatMessages listener
// alongside els.chatComposerForm/els.chatInput below.

// Renders the compact "❤️ 3  😂 1  🔥 2" row under a message's bubble
// (see renderChatMessages above). Only emoji with at least one
// reactor are shown, always in REACTION_EMOJIS order regardless of the
// order reactions were added in, so the row never visually reshuffles
// as people react. Works identically for every message type — this
// only ever reads m.reactions, never m.type — which is what makes
// reactions "just work" on text/voice/image/file bubbles alike without
// each bubble-markup function needing its own copy of this logic.
// Each chip IS the toggle control: clicking a chip you're already part
// of removes your reaction, clicking one you're not part of adds it
// (see the data-reaction-chip handling in the click delegation below)
// — the reaction picker (openReactionPicker) is only needed to ADD a
// reaction that has no chip yet.
function reactionsBarMarkup(m, meUid) {
  const reactions = m && m.reactions;
  if (!reactions || typeof reactions !== "object") return "";
  const chips = REACTION_EMOJIS.map((emoji) => {
    const uids = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
    if (!uids.length) return "";
    const mine = !!meUid && uids.includes(meUid);
    return `
      <button type="button" class="chat-msg__reaction-chip${mine ? " is-mine" : ""}" data-reaction-chip data-reaction-emoji="${escapeHtml(emoji)}" aria-pressed="${mine}" aria-label="${escapeHtml(t("chat.reactions.chipLabel", { emoji, count: uids.length }))}">
        <span class="chat-msg__reaction-emoji">${emoji}</span><span class="chat-msg__reaction-count">${uids.length}</span>
      </button>
    `;
  }).join("");
  return chips ? `<div class="chat-msg__reactions">${chips}</div>` : "";
}

// Signed URLs for private chat-files objects are short-lived (see
// getChatFileSignedUrl's 3600s) but a chat can easily stay open longer
// than that and re-renders (new messages, read receipts) happen
// constantly — caching per messageId avoids re-fetching a URL on every
// single re-render, while still refreshing well before Supabase's own
// URL would actually expire.
const chatFileSignedUrlCache = new Map(); // messageId -> { url, expiresAt }
const CHAT_FILE_SIGNED_URL_TTL_MS = 55 * 60 * 1000;

function getCachedChatFileUrl(messageId) {
  const entry = chatFileSignedUrlCache.get(messageId);
  return entry && entry.expiresAt > Date.now() ? entry.url : null;
}

function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fileExtensionLabel(fileName) {
  const dot = (fileName || "").lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1
    ? fileName.slice(dot + 1).toUpperCase()
    : "";
}

// Image-attachment bubble. If a still-fresh signed URL is already
// cached (see chatFileSignedUrlCache above), it's used immediately so
// a re-render (e.g. a read receipt ticking in elsewhere in the chat)
// never re-flashes a loading placeholder for an image that was already
// showing fine — otherwise renders a placeholder that
// hydrateChatFileImages() (called at the end of renderChatMessages)
// fills in asynchronously. Clicking the image opens the lightbox (see
// the els.chatMessages click delegation further down).
function imageMessageBubbleMarkup(m) {
  const cachedUrl = getCachedChatFileUrl(m.id);
  const inner = cachedUrl
    ? `<img class="chat-img" src="${escapeHtml(cachedUrl)}" alt="${escapeHtml(t("chat.attach.image"))}" data-file-img loading="lazy" />`
    : `<div class="chat-img chat-img--loading" data-file-img-placeholder></div>`;
  return `
    <div class="chat-msg__bubble chat-msg__bubble--image" data-file-id="${escapeHtml(m.id || "")}" data-file-path="${escapeHtml(m.filePath)}">
      ${inner}
    </div>
  `;
}

// Non-image attachment bubble — filename/extension/size plus a
// download button. Unlike images, the signed URL here is fetched only
// on demand (see the data-file-download click handling further down),
// not eagerly on render, since a file bubble doesn't need to display
// its own content inline the way an image does.
function fileMessageBubbleMarkup(m) {
  const ext = fileExtensionLabel(m.fileName) || "?";
  return `
    <div class="chat-msg__bubble chat-msg__bubble--file" data-file-id="${escapeHtml(m.id || "")}" data-file-path="${escapeHtml(m.filePath)}" data-file-name="${escapeHtml(m.fileName || "")}">
      <div class="chat-file__icon" aria-hidden="true">${escapeHtml(ext)}</div>
      <div class="chat-file__info">
        <div class="chat-file__name">${escapeHtml(m.fileName || t("chat.attach.fileFallbackName"))}</div>
        <div class="chat-file__meta">${escapeHtml(formatFileSize(m.fileSize))}</div>
      </div>
      <button type="button" class="chat-file__download" data-file-download aria-label="${escapeHtml(t("chat.attach.download"))}" title="${escapeHtml(t("chat.attach.download"))}">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `;
}

// Fills in every still-loading image-attachment placeholder currently
// in the DOM with a real signed URL, one Supabase call per not-yet-
// cached image. Called at the end of renderChatMessages() (same "sync
// render, then hydrate async details" pattern voice playback's
// syncVoicePlayersUI already uses). data-loading guards against
// double-fetching the same node if another render fires while a
// request is still in flight.
function hydrateChatFileImages() {
  if (!els.chatMessages) return;
  els.chatMessages
    .querySelectorAll("[data-file-img-placeholder]")
    .forEach((placeholder) => {
      if (placeholder.getAttribute("data-loading") === "true") return;
      const bubble = placeholder.closest(".chat-msg__bubble--image");
      if (!bubble) return;
      const messageId = bubble.getAttribute("data-file-id");
      const filePath = bubble.getAttribute("data-file-path");
      if (!messageId || !filePath) return;
      placeholder.setAttribute("data-loading", "true");
      getChatFileSignedUrl(filePath)
        .then((url) => {
          chatFileSignedUrlCache.set(messageId, {
            url,
            expiresAt: Date.now() + CHAT_FILE_SIGNED_URL_TTL_MS,
          });
          if (!els.chatMessages) return;
          let selector;
          try {
            selector = `.chat-msg__bubble--image[data-file-id="${CSS.escape(messageId)}"]`;
          } catch (e) {
            return;
          }
          // Re-query fresh rather than trusting the captured `bubble`
          // node is still attached — another render may have already
          // rebuilt the message list while this fetch was in flight.
          const freshBubble = els.chatMessages.querySelector(selector);
          if (!freshBubble) return;
          freshBubble.innerHTML = `<img class="chat-img" src="${escapeHtml(url)}" alt="${escapeHtml(t("chat.attach.image"))}" data-file-img loading="lazy" />`;
        })
        .catch((e) => {
          console.error("HUM: failed to load image attachment", filePath, e);
          placeholder.removeAttribute("data-loading");
          placeholder.classList.add("chat-img--error");
          placeholder.setAttribute(
            "aria-label",
            t("chat.attach.imageLoadFailed"),
          );
        });
    });
}

// Image lightbox — a larger preview shown when an image attachment
// bubble is tapped (see the els.chatMessages click delegation further
// down). Reuses the exact same .modal-backdrop shell the confirm modal
// already uses (see #imageLightboxBackdrop in index.html), just with
// image-specific inner content instead of a text dialog.
function openImageLightbox(url) {
  if (!els.imageLightboxBackdrop || !els.imageLightboxImg) return;
  els.imageLightboxImg.src = url;
  els.imageLightboxBackdrop.hidden = false;
}
function closeImageLightbox() {
  if (!els.imageLightboxBackdrop) return;
  els.imageLightboxBackdrop.hidden = true;
  if (els.imageLightboxImg) els.imageLightboxImg.src = "";
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
  chatMicBtn: document.getElementById("chatMicBtn"),
  chatVoiceRecordingBar: document.getElementById("chatVoiceRecordingBar"),
  chatVoiceRecordTime: document.getElementById("chatVoiceRecordTime"),
  chatVoiceCancelBtn: document.getElementById("chatVoiceCancelBtn"),
  chatVoiceStopBtn: document.getElementById("chatVoiceStopBtn"),
  chatAttachBtn: document.getElementById("chatAttachBtn"),
  chatFileInput: document.getElementById("chatFileInput"),

  imageLightboxBackdrop: document.getElementById("imageLightboxBackdrop"),
  imageLightboxImg: document.getElementById("imageLightboxImg"),
  imageLightboxCloseBtn: document.getElementById("imageLightboxCloseBtn"),

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
  reactionPicker: document.getElementById("reactionPicker"),
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

  // Same tracking role as actionMenuTrigger, just for the reaction-emoji
  // popover (see openReactionPicker/closeReactionPicker).
  reactionPickerTrigger: null,
};

// Stops any live Firestore listeners this device has open — called on
// logout and when otherwise tearing down the signed-in session, so a
// listener never keeps delivering updates (or errors) for an account
// that's no longer signed in.
function stopAllConversationWatchers() {
  if (state.unsubChatsList) {
    state.unsubChatsList();
    state.unsubChatsList = null;
  }
  if (state.unsubChatMessages) {
    state.unsubChatMessages();
    state.unsubChatMessages = null;
  }
  if (state.unsubBlockedUsers) {
    state.unsubBlockedUsers();
    state.unsubBlockedUsers = null;
  }
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
  ["chatsList", "peopleResults", "profileView", "chatHeader"].forEach(
    clearPresenceWatchers,
  );
  // Same idea for the typing indicator: stop watching whoever's typing
  // state was being shown in the (now closing) chat header. Clearing
  // the signed-in user's OWN typing flag is handled separately by
  // logoutUser() (it needs to be awaited before signOut()), not here.
  stopTypingWatcher();
  // And again for voice messages: this is the same central "tear
  // everything down" chokepoint presence/typing already use, so a
  // stray in-progress recording or active playback gets cleaned up here
  // too regardless of which caller reached this point (logoutUser
  // already calls cancelVoiceRecording()/stopVoicePlayback() directly
  // for the ordering reasons noted there; these are harmless no-ops in
  // that case, and the real safety net for any OTHER path that ends up
  // calling this function).
  cancelVoiceRecording();
  stopVoicePlayback();
}

// Starts (or restarts) the live "who am I talking to, and what did
// they last say" listener for the signed-in user. Safe to call more
// than once — it always tears down any previous listener first.
function startConversationsWatcher() {
  if (state.unsubChatsList) state.unsubChatsList();
  const me = currentUser();
  if (!me) return;
  state.chatsListLoading = true;
  state.chatsListError = false;
  if (state.activePanelView === "chats") renderChatsList();
  state.unsubChatsList = watchUserConversations(me.uid, (rows, err) => {
    state.chatsListLoading = false;
    if (err) {
      state.chatsListError = true;
    } else {
      state.chatsListError = false;
      state.chatsListRows = rows;
    }
    if (state.activePanelView === "chats") renderChatsList();
  });
}

// Starts (or restarts) the live block-list listener for the signed-in
// user, the same shape as startConversationsWatcher() above. Keeps
// state.myBlockedUids/blockedUsersRows current across devices — e.g.
// blocking someone on one phone hides them from search/chat on a
// laptop signed into the same account within moments, without a
// refresh.
function startBlockedUsersWatcher() {
  if (state.unsubBlockedUsers) state.unsubBlockedUsers();
  const me = currentUser();
  if (!me) return;
  state.blockedUsersLoading = true;
  state.unsubBlockedUsers = watchBlockedUsers(me.uid, (rows, err) => {
    state.blockedUsersLoading = false;
    if (err) {
      console.error("HUM: failed to load blocked users", err);
    } else {
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
  left = Math.max(
    margin,
    Math.min(left, window.innerWidth - menu.offsetWidth - margin),
  );
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

// Renders the six-emoji reaction picker (see REACTION_EMOJIS) into the
// shared #reactionPicker popover and positions it near `triggerEl` —
// same positioning/clamping logic as openActionMenu above, just a
// second, differently-shaped popover rather than a second copy of
// this one. Any emoji the signed-in user has already reacted with is
// highlighted (`is-active`) so the picker itself also communicates
// "your current reactions", not just the chips under the bubble.
// Clicking an emoji here always calls handleToggleReaction — for an
// emoji the user hasn't used yet that adds it; for one they're already
// part of (shown active) it removes it, exactly like clicking that
// same emoji's chip under the bubble would.
function openReactionPicker(triggerEl, convId, message, meUid) {
  const picker = els.reactionPicker;
  if (!picker || !triggerEl || !message || !message.id) return;
  const reactions = message.reactions || {};
  picker.setAttribute("aria-label", t("chat.reactions.picker"));
  picker.innerHTML = REACTION_EMOJIS.map((emoji) => {
    const uids = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
    const mine = !!meUid && uids.includes(meUid);
    return `
      <button type="button" class="reaction-picker__emoji${mine ? " is-active" : ""}" data-picker-emoji="${escapeHtml(emoji)}" role="menuitemradio" aria-checked="${mine}" aria-label="${escapeHtml(t("chat.reactions.emojiLabel", { emoji }))}">${emoji}</button>
    `;
  }).join("");
  picker.hidden = false;
  picker.querySelectorAll("[data-picker-emoji]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const emoji = btn.getAttribute("data-picker-emoji");
      closeReactionPicker();
      handleToggleReaction(convId, message, emoji, meUid);
    });
  });

  // Position after render so picker.offsetWidth/offsetHeight are real.
  const rect = triggerEl.getBoundingClientRect();
  const margin = 8;
  let left = rect.left;
  let top = rect.bottom + margin;
  left = Math.max(
    margin,
    Math.min(left, window.innerWidth - picker.offsetWidth - margin),
  );
  if (top + picker.offsetHeight > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - picker.offsetHeight - margin);
  }
  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
  triggerEl.setAttribute("aria-expanded", "true");
  state.reactionPickerTrigger = triggerEl;
}

function closeReactionPicker() {
  const picker = els.reactionPicker;
  if (!picker) return;
  picker.hidden = true;
  picker.innerHTML = "";
  if (state.reactionPickerTrigger) {
    state.reactionPickerTrigger.setAttribute("aria-expanded", "false");
    state.reactionPickerTrigger = null;
  }
}

// Adds or removes the signed-in user's own reaction, called both from
// a reaction-picker emoji pick and from clicking an existing chip
// under a bubble (see the click delegation on els.chatMessages
// further down). Decides add-vs-remove purely from the message object
// already in state.chatMessagesData — the same live data the open
// chat's Firestore listener keeps current — so this never needs an
// extra read before writing. A network failure here is reported the
// same way every other message-level write in this file reports one
// (see confirmAndDeleteMessage): a toast, no local optimistic state to
// roll back, since renderChatMessages() only ever reflects what the
// live listener has actually confirmed.
async function handleToggleReaction(convId, message, emoji, uid) {
  if (!convId || !message || !message.id || !emoji || !uid) return;
  if (!REACTION_EMOJIS.includes(emoji)) return;
  const existing = (message.reactions && message.reactions[emoji]) || [];
  const hasReacted = Array.isArray(existing) && existing.includes(uid);
  try {
    await toggleMessageReaction(convId, message.id, emoji, uid, hasReacted);
  } catch (e) {
    console.error("HUM: failed to update reaction", e);
    showToast(t("errors.network"), "error");
  }
}

// Any click outside the open menu, any Escape press, or the page
// scrolling/resizing closes it — a popover left open and stale is
// worse than one that closes a little eagerly. Handles BOTH the
// action menu and the reaction picker in the same three listeners
// (rather than a second near-identical set) since they're mutually
// exclusive, page-level popovers with identical dismissal rules.
document.addEventListener("click", (e) => {
  if (els.actionMenu && !els.actionMenu.hidden) {
    const insideMenu = els.actionMenu.contains(e.target);
    const onTrigger =
      state.actionMenuTrigger && state.actionMenuTrigger.contains(e.target);
    if (!insideMenu && !onTrigger) closeActionMenu();
  }
  if (els.reactionPicker && !els.reactionPicker.hidden) {
    const insidePicker = els.reactionPicker.contains(e.target);
    const onTrigger =
      state.reactionPickerTrigger &&
      state.reactionPickerTrigger.contains(e.target);
    if (!insidePicker && !onTrigger) closeReactionPicker();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeActionMenu();
    closeReactionPicker();
  }
});
window.addEventListener("resize", () => {
  closeActionMenu();
  closeReactionPicker();
});
window.addEventListener(
  "scroll",
  () => {
    closeActionMenu();
    closeReactionPicker();
  },
  true,
);

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
    els.confirmModalConfirm.className =
      "btn " + (danger ? "btn--danger" : "btn--primary");
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

// Builds the "Delete for me" / "Delete for everyone" action list for
// one message, shared by however this menu gets triggered (see the
// data-msg-menu click handling further down). "Delete for everyone"
// only ever appears for the message's own sender — the Firestore rule
// enforces the same restriction independently, so this is purely a UI
// convenience, not the actual security boundary.
function buildMessageActions(convId, message, isOwn) {
  const actions = [
    {
      label: t("menu.deleteForMe"),
      danger: true,
      onSelect: () => confirmAndDeleteMessage(convId, message, "me"),
    },
  ];
  if (isOwn) {
    actions.push({
      label: t("menu.deleteForEveryone"),
      danger: true,
      onSelect: () => confirmAndDeleteMessage(convId, message, "everyone"),
    });
  }
  return actions;
}

async function confirmAndDeleteMessage(convId, message, mode) {
  const me = currentUser();
  if (!me || !message || !message.id) return;
  const other = state.activeChatUser;
  const isEveryone = mode === "everyone";

  const confirmed = await openConfirmModal({
    title: t(
      isEveryone ? "confirm.deleteEveryoneTitle" : "confirm.deleteMeTitle",
    ),
    body: t(
      isEveryone ? "confirm.deleteEveryoneBody" : "confirm.deleteMeBody",
      {
        name: other ? other.displayName : "",
      },
    ),
    confirmLabel: t("common.delete"),
    danger: true,
  });
  if (!confirmed) return;

  try {
    if (isEveryone) {
      await deleteMessageForEveryone(convId, message);
    } else {
      await deleteMessageForMe(convId, message.id, me.uid);
    }
  } catch (e) {
    console.error("HUM: failed to delete message", e);
    showToast(t("errors.network"), "error");
    return;
  }
  // No manual re-render needed here: this write lands on the exact same
  // message doc the open chat's live listener (watchConversationMessages,
  // wired in openChat) is already subscribed to, so renderChatMessages()
  // picks up the change and re-renders on its own, same as any other
  // real-time message update.
  showToast(
    t(
      isEveryone ? "toast.messageDeletedEveryone" : "toast.messageDeletedForMe",
    ),
    "success",
  );
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
  if (
    state.activeChatUsername &&
    usernameDocId(state.activeChatUsername) ===
      usernameDocId(otherUser.username)
  ) {
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
  if (
    state.activeChatUsername &&
    usernameDocId(state.activeChatUsername) ===
      usernameDocId(otherUser.username)
  ) {
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
  showToast(
    t("toast.userUnblocked", { name: otherUser.displayName }),
    "success",
  );
  if (
    state.mainView === "chat" &&
    state.activeChatUser &&
    state.activeChatUser.uid === otherUser.uid
  ) {
    applyChatBlockState();
  }
  if (
    state.mainView === "profileView" &&
    state.viewingUser &&
    state.viewingUser.uid === otherUser.uid
  ) {
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
  // Voice messages: same idea — abandon any in-progress recording and
  // stop any active playback, there's no chat left for either to
  // belong to once this returns.
  cancelVoiceRecording();
  stopVoicePlayback();
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
  if (els.chatMicBtn) els.chatMicBtn.disabled = blocked;
  if (els.chatAttachBtn) els.chatAttachBtn.disabled = blocked;
  if (blocked && els.chatInput) els.chatInput.value = "";
  // A disabled composer can no longer fire "input" events, so nothing
  // would otherwise clear a typing flag left over from just before the
  // block took effect — clear it explicitly here too.
  if (blocked) stopMyTyping();
  // Voice messages: "if the chat becomes blocked while recording, stop/
  // cancel the recording; do not upload; do not create a Firestore
  // message" — cancelVoiceRecording() does exactly that (discards
  // without ever calling uploadVoiceBlob/addMessage). Safe to call even
  // when nothing is actually recording.
  if (blocked) cancelVoiceRecording();
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

function setFormBusy(form, busy) {
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = busy;
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
    const results = await searchUsers(
      query,
      me ? usernameDocId(me.username) : null,
    );
    if (myToken !== state.peopleSearchToken) return;
    // Blocked people are excluded from search entirely — they're not
    // just hidden with a note, they simply don't come up, same as the
    // signed-in user's own account already doesn't.
    const visibleResults = results.filter(
      (u) => !state.myBlockedUids.has(u.uid),
    );
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
  // Switch to the profile panel immediately with a skeleton rather
  // than waiting on findUserByUsername first — otherwise the panel
  // stays on whatever was showing before with no loading feedback at
  // all until the fetch resolves. Cleared to null so nothing (e.g.
  // the "Message" button wiring, which checks state.viewingUsername)
  // acts on stale data while this load is in flight.
  state.viewingUsername = null;
  state.viewingUser = null;
  els.mainProfileView.innerHTML = profileHeroSkeletonMarkup();
  clearPresenceWatchers("profileView");
  setMainView("profileView");
  if (navigate) openMobileDetail();

  let user;
  try {
    user = await findUserByUsername(username);
  } catch (e) {
    console.error("HUM: failed to load profile", e);
    showToast(t("errors.network"), "error");
    if (state.mainView === "profileView" && !state.viewingUser) {
      els.mainProfileView.innerHTML = profileViewErrorMarkup(t("errors.network"));
    }
    return;
  }
  if (!user) {
    showToast(t("errors.userNotFound"), "error");
    if (state.mainView === "profileView" && !state.viewingUser) {
      els.mainProfileView.innerHTML = profileViewErrorMarkup(t("errors.userNotFound"));
    }
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
    if (state.viewingUser)
      openActionMenu(menuBtn, buildPersonActions(state.viewingUser));
    return;
  }
  const btn = e.target.closest("#btnMessageUser");
  if (!btn || !state.viewingUsername) return;
  openChat(state.viewingUsername, true);
});

async function openChat(username, navigate) {
  const me = currentUser();
  if (!me) return;
  // Voice messages: abandon any in-progress recording from whatever
  // chat was open before this one, and stop any active playback — both
  // are tied to "the currently open chat" and neither should survive a
  // switch (see cancelVoiceRecording/stopVoicePlayback in the VOICE
  // MESSAGES section). Safe to call even if neither is actually active.
  cancelVoiceRecording();
  stopVoicePlayback();
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
  state.unsubChatMessages = watchConversationMessages(
    me.uid,
    other.uid,
    (messages, err) => {
      state.chatMessagesLoading = false;
      if (err) {
        state.chatMessagesError = true;
      } else {
        state.chatMessagesError = false;
        state.chatMessagesData = messages;
      }
      // Guards against a listener callback for a chat the person has
      // since navigated away from landing on the wrong screen.
      if (
        state.activeChatUsername &&
        usernameDocId(state.activeChatUsername) ===
          usernameDocId(watchedUsername)
      ) {
        renderChatMessages();
        // Read receipts: this fires for BOTH the initial load and every
        // subsequent live update (a new incoming message arriving while
        // the chat stays open included) — exactly the two moments the
        // feature needs to mark things read. Fire-and-forget: nothing in
        // the UI needs to wait on this write, and markMessagesRead()
        // itself is a safe no-op if there's nothing new to mark.
        if (!err) markMessagesRead(me.uid, other.uid, convId, messages);
      }
    },
  );
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
    if (state.activeChatUser)
      openActionMenu(
        els.chatHeaderMenuBtn,
        buildPersonActions(state.activeChatUser),
      );
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
  if (state.activeChatUser && state.myBlockedUids.has(state.activeChatUser.uid))
    return;
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
    const isPermissionError =
      e &&
      (e.code === "permission-denied" || /permission/i.test(e.message || ""));
    showToast(
      isPermissionError ? t("errors.sendFailed") : t("errors.network"),
      "error",
    );
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

// Voice messages: mic button starts recording; Stop/Cancel in the
// recording bar either send or discard it (see the VOICE MESSAGES
// section above for startVoiceRecording/sendVoiceMessage/
// cancelVoiceRecording).
els.chatMicBtn &&
  els.chatMicBtn.addEventListener("click", () => {
    startVoiceRecording();
  });
els.chatVoiceStopBtn &&
  els.chatVoiceStopBtn.addEventListener("click", () => {
    sendVoiceMessage();
  });
els.chatVoiceCancelBtn &&
  els.chatVoiceCancelBtn.addEventListener("click", () => {
    cancelVoiceRecording();
  });

// File & Photo Attachments: the attach button just opens the native
// file picker (a hidden <input type="file" multiple>, see index.html);
// the actual upload flow starts from its 'change' event, mirroring how
// the mic button starts recording. Resetting .value after reading
// files lets the SAME file be picked again in a row (browsers don't
// fire 'change' a second time for an unchanged selection otherwise).
if (els.chatAttachBtn) {
  els.chatAttachBtn.addEventListener("click", () => {
    if (els.chatFileInput) els.chatFileInput.click();
  });
}
if (els.chatFileInput) {
  els.chatFileInput.addEventListener("change", (event) => {
    // Make a stable copy BEFORE clearing the input. FileList belongs to
    // the input element and can become empty after .value is reset.
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    sendAttachmentFiles(files);
  });
}

// Image lightbox: backdrop click (outside the image) or the close
// button dismiss it, same interaction pattern as the confirm modal.
els.imageLightboxBackdrop &&
  els.imageLightboxBackdrop.addEventListener("click", (e) => {
    if (e.target === els.imageLightboxBackdrop) closeImageLightbox();
  });
els.imageLightboxCloseBtn &&
  els.imageLightboxCloseBtn.addEventListener("click", () => {
    closeImageLightbox();
  });
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    els.imageLightboxBackdrop &&
    !els.imageLightboxBackdrop.hidden
  ) {
    closeImageLightbox();
  }
});

// Delegated click handling for BOTH voice-message play/pause buttons
// AND the per-message "⋮" delete-menu trigger, in one listener — has to
// be delegation either way, since bubbles/messages are torn down and
// rebuilt on every renderChatMessages() call (see voiceMessageBubbleMarkup/
// renderChatMessages above), and a second listener on the same
// element+event would be a duplicate rather than an extension.
els.chatMessages.addEventListener("click", (e) => {
  const menuBtn = e.target.closest("[data-msg-menu]");
  if (menuBtn) {
    e.stopPropagation();
    const me = currentUser();
    const other = state.activeChatUser;
    const msgRow = menuBtn.closest(".chat-msg");
    if (!me || !other || !msgRow) return;
    const messageId = msgRow.getAttribute("data-msg-id");
    const isOwn = msgRow.getAttribute("data-msg-own") === "true";
    const message = (state.chatMessagesData || []).find(
      (m) => m.id === messageId,
    );
    if (!message) return;
    const convId = conversationId(me.uid, other.uid);
    openActionMenu(menuBtn, buildMessageActions(convId, message, isOwn));
    return;
  }

  // "+ react" trigger — opens the six-emoji picker for this message
  // (see openReactionPicker). Present on every non-deleted message
  // regardless of type (text/voice/image/file), same as the "⋮" menu
  // button just above.
  const reactBtn = e.target.closest("[data-msg-react-btn]");
  if (reactBtn) {
    e.stopPropagation();
    const me = currentUser();
    const other = state.activeChatUser;
    const msgRow = reactBtn.closest(".chat-msg");
    if (!me || !other || !msgRow) return;
    const messageId = msgRow.getAttribute("data-msg-id");
    const message = (state.chatMessagesData || []).find(
      (m) => m.id === messageId,
    );
    if (!message) return;
    const convId = conversationId(me.uid, other.uid);
    openReactionPicker(reactBtn, convId, message, me.uid);
    return;
  }

  // An existing reaction chip under a bubble — clicking it toggles
  // the signed-in user's OWN reaction for that exact emoji (see
  // reactionsBarMarkup/handleToggleReaction): adds it if they're not
  // already part of that chip's count, removes it if they are. Never
  // affects any other user's reaction on the same emoji.
  const reactionChip = e.target.closest("[data-reaction-chip]");
  if (reactionChip) {
    e.stopPropagation();
    const me = currentUser();
    const other = state.activeChatUser;
    const msgRow = reactionChip.closest(".chat-msg");
    if (!me || !other || !msgRow) return;
    const messageId = msgRow.getAttribute("data-msg-id");
    const message = (state.chatMessagesData || []).find(
      (m) => m.id === messageId,
    );
    if (!message) return;
    const convId = conversationId(me.uid, other.uid);
    const emoji = reactionChip.getAttribute("data-reaction-emoji");
    handleToggleReaction(convId, message, emoji, me.uid);
    return;
  }

  // Tapping an image attachment opens the lightbox — reuses whatever
  // signed URL is already showing (the <img>'s own src), so this never
  // needs a fresh Supabase call of its own.
  const img = e.target.closest("[data-file-img]");
  if (img) {
    openImageLightbox(img.src);
    return;
  }

  // A file attachment's download button fetches a signed URL on demand
  // (see getChatFileSignedUrl) and opens it in a new tab — the browser
  // handles the actual save/open from there, same as any normal
  // download link.
  const downloadBtn = e.target.closest("[data-file-download]");
  if (downloadBtn) {
    const bubble = downloadBtn.closest(".chat-msg__bubble--file");
    const filePath = bubble && bubble.getAttribute("data-file-path");
    if (!filePath) return;
    downloadBtn.disabled = true;
    getChatFileSignedUrl(filePath)
      .then((url) => {
        window.open(url, "_blank", "noopener");
      })
      .catch((e2) => {
        console.error("HUM: failed to open attachment", filePath, e2);
        showToast(t("chat.attach.downloadFailed"), "error");
      })
      .finally(() => {
        downloadBtn.disabled = false;
      });
    return;
  }

  const btn = e.target.closest("[data-voice-play]");
  if (!btn) return;
  const bubble = btn.closest(".chat-msg__bubble--voice");
  if (!bubble) return;
  const messageId = bubble.getAttribute("data-voice-id");
  const voicePath = bubble.getAttribute("data-voice-path");
  if (!messageId || !voicePath) return;
  toggleVoicePlayback(messageId, voicePath);
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
      const displayUser = {
        username: row.blockedUsername,
        displayName: row.blockedDisplayName,
        avatar: row.blockedAvatar,
      };
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
      console.error(
        "HUM: failed to load or recover profile for existing session",
        e,
      );
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