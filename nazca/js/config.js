// ============================================================
//  nazca — 設定ファイル
//  Firebase を使う場合は FIREBASE_CONFIG に Firebase コンソールの
//  「ウェブアプリの設定」の値をそのまま貼り付けてください。
//  null のままだと「ローカルモード」（この端末だけに保存）で動きます。
// ============================================================

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA-Ck2id3uxYaJ1B-9Z7pFtZUYFDEYEaqE",
  authDomain: "nazca-23d94.firebaseapp.com",
  projectId: "nazca-23d94",
  storageBucket: "nazca-23d94.firebasestorage.app",
  messagingSenderId: "717517293376",
  appId: "1:717517293376:web:9c65d132079b98f62ddca5",
  measurementId: "G-W1DHF06L5T"
};



/* 例:
export const FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxx",
};
*/

// gstatic CDN から読み込む Firebase JS SDK のバージョン
export const FIREBASE_SDK_VERSION = '12.19.0';

export const APP_VERSION = '2.3.2';

// デイリーチャレンジの切替時刻（日本時間）
export const TZ_OFFSET_MIN = 9 * 60;   // JST = UTC+9
export const CHALLENGE_SWITCH_HOUR = 16;

// 地図タイル（OpenStreetMap）。社内で利用者が多い場合は
// 商用タイル配信サービスの URL に差し替えてください。
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';
export const TILE_ATTRIBUTION_URL = 'https://www.openstreetmap.org/copyright';
export const DEFAULT_CENTER = { lat: 35.6812, lng: 139.7671 }; // 位置が取れるまでの初期表示

// GPS フィルタ
export const GPS = {
  maxAccuracy: 35,   // m: これより精度が悪い測位は捨てる
  minStep: 4,        // m: これ未満の移動は記録しない（静止時のブレ対策）
  maxSpeed: 9,       // m/s: これを超える瞬間移動は GPS の飛びとして捨てる
};

// デイリーランキングに参加できる最低歩行距離 (m)
export const DAILY_MIN_DISTANCE = 100;

// 名前・タイトルの最大文字数
export const NAME_MAX = 10;
export const TITLE_MAX = 20;
