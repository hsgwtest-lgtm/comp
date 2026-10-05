# nazca — 8-Bit GPS Art & Free Doodle

歩いた軌跡で街に絵を描く、ドット絵（レトロゲーム風）の GPS アート PWA です。
社内の健康向上プログラム向けに、毎日 16:00 更新の **DAILY CHALLENGE（お題チャレンジ）** と、
自由に描ける **FREE DOODLE（フリーお絵描き）** の 2 モードを備えています。

- フロントエンド: GitHub Pages（ビルド不要の素の JavaScript / ES Modules）
- バックエンド: Firebase（匿名認証 + Cloud Firestore）
- Firebase 未設定のままでも **ローカルモード**（この端末だけに保存）で全機能を試せます

公開 URL（GitHub Pages を有効にした後）: `https://hsgwtest-lgtm.github.io/comp/`

---

## 機能（仕様書との対応）

| 仕様 | 実装 |
| --- | --- |
| ピクセルアートの世界観 | 2 種類のドットフォント（同梱）、角の欠けたウィンドウ枠、限定パレットに減色したドット絵地図、8bit 効果音 |
| MODE A: DAILY CHALLENGE | 日本時間 16:00 に切り替わる日替わりお題（ドット絵線画 20 種のローテーション）。歩行軌跡との類似度を 0.0〜100.0% で自動採点し、HIGH SCORE 風ランキングを表示 |
| MODE B: FREE DOODLE | お題なしで歩いて描き、タイトルを付けてフリーギャラリーに投稿 |
| MAP MODE / SKETCH-ONLY | 投稿時に選択。SKETCH-ONLY は緯度経度を破棄し、0〜1000 の相対座標の形だけを保存 |
| 1. MODE SELECT | タイトルロゴ、本日のお題（地上絵風アニメーション）、次の 16:00 までのカウントダウン |
| 2. TRACKING | お題ガイド表示、地図/スケッチ切替、START / PAUSE / RESUME / FINISH、GPS 精度表示 |
| 3. RESULT & POST | スコア（DAILY のみ）、歩行距離、公開モードの選択とプレビュー、POST |
| 4. GALLERY & RANKING | 日別ハイスコアランキング（前日以前も閲覧可）、フリーギャラリー、LIKE / STAR / 1UP / GG スタンプ |

そのほか:

- **GUIDE**: お題を地図の中心に重ねて表示（200m / 400m / 800m）。ルートを考えやすくします
- **PAUSE 中の移動は線にならない**ので、目や窓など一筆書きできない線も描けます
- 計測中は画面の自動ロックを防止（Screen Wake Lock）。途中で閉じても端末内に保存され、CONTINUE で再開できます
- GPS の精度が悪い測位・静止時のブレ・瞬間移動（飛び）は自動で除外します
- 投稿の送信に失敗しても作品は端末に残り、同じ作品が二重に投稿されることはありません
- オフラインでもアプリ本体は起動します（Service Worker）

## 採点ロジック（`js/score.js`）

1. お題と軌跡を弧長で等間隔に再サンプリング
2. お題を外接矩形で正規化し、軌跡は **回転（±45°）・拡大縮小・平行移動** を最適化して重ねる
   （歩く場所・大きさ・街路の向きは自由。鏡像は不可）
3. 双方向の平均距離 D =（お題→軌跡：描き残し ＋ 軌跡→お題：はみ出し）÷ 2
4. `score = 100 / (1 + (D / 0.04)^3)`

`node tests/score.test.mjs` で検証できます（お題どおりの歩行 ≈ 99%、碁盤目の街路で近似 ≈ 93%、
半分だけ ≈ 21%、別のお題 ≈ 22%、でたらめ ≈ 13%）。
ランク表示は S ≥ 90 / A ≥ 75 / B ≥ 60 / C ≥ 40 / D。

## プライバシー設計

- 計測中の生データ（緯度経度）は端末の中（localStorage）だけに保存され、投稿または破棄した時点で削除されます
- **SKETCH-ONLY** は投稿前に端末内で緯度経度を捨て、形を 0〜1000 の格子に正規化したデータだけを送信します。
  Firestore ルールでも、SKETCH-ONLY の投稿に位置情報（`geo`）を含めることを禁止しています
- **MAP MODE** を選んだときだけ、地図表示用の緯度経度（約 1m 単位に丸めて簡略化）を保存します。
  結果画面では「歩いた場所が地図ごと公開される」ことを明示しています

---

## セットアップ

### 1. GitHub Pages を有効にする

リポジトリの **Settings → Pages → Build and deployment** で
Source: `Deploy from a branch`、Branch: `main` / `/ (root)` を選んで保存します。

### 2. Firebase をつなぐ（社内で共有する場合）

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication → Sign-in method** で「匿名」を有効化
3. **Authentication → Settings → 承認済みドメイン** に `hsgwtest-lgtm.github.io` を追加
4. **Firestore Database** を作成（ロケーションは `asia-northeast1` など）
5. **Firestore → ルール** に `firestore.rules` の内容を貼り付けて公開
   （Firebase CLI を使う場合は `firebase deploy --only firestore:rules`）
6. **プロジェクトの設定 → マイアプリ** でウェブアプリを追加し、表示された `firebaseConfig` を
   `js/config.js` の `FIREBASE_CONFIG` に貼り付け
7. `sw.js` の `VERSION` を上げてからコミット・プッシュ

複合インデックスは不要です（日別ランキングは `dayKey` の等価検索、ギャラリーは `createdAt` の並べ替えのみ）。

### コレクション

| パス | 内容 |
| --- | --- |
| `daily_posts/{id}` | デイリー投稿（`dayKey`, `challengeId`, `score`, `shape`, `geo`※MAP のみ, `reactions` …） |
| `free_posts/{id}` | フリー投稿（`title`, `shape`, `geo`※MAP のみ, `reactions` …） |
| `challenges/{YYYY-MM-DD}` | お題の上書き（任意） |
| `users/{uid}` | 表示名 |

### お題を差し替える（任意）

組み込みの 20 種は `js/challenges.js` の `TEMPLATES` と `ORDER` で管理しています。
特定の日だけ別のお題にしたい場合は、Firestore に `challenges/2026-10-10`（その日 16:00 から翌 15:59 まで）
というドキュメントを作ります。

```json
{
  "name": "ROBOT",
  "ja": "ロボット",
  "strokes": [ { "p": [0, 0, 8, 0, 8, 8, 0, 8, 0, 0] }, { "p": [2, 3, 2, 4] } ]
}
```

`p` は x, y を交互に並べた折れ線です（画面座標・単位は任意。PAUSE でつなぐ線は別ストロークに）。

### 更新するとき

アプリのファイルを変更したら、`sw.js` の `VERSION` を必ず上げてください。
利用者のタイトル画面に **UPDATE** ボタンが表示され、押すと新しいバージョンに切り替わります
（計測中に勝手に再読み込みされることはありません）。

---

## 開発メモ

- ローカル確認: `python3 -m http.server 8080` → `http://localhost:8080/`
- **デバッグモード**: URL に `?debug=1` を付けると計測画面に `AUTO WALK`（お題をなぞる擬似歩行）と
  `TAP`（地図をタップした地点へ移動）が出ます。机の上で一連の流れを試せます
- 採点テスト: `node tests/score.test.mjs`
- 地図は外部ライブラリを使わない自前のタイルマップ（`js/pixelmap.js`）です。OpenStreetMap のタイルを
  読み込み、レトロパレットに減色して 1 ドット = 2px で表示します

## 制約・注意

- iPhone は画面が消えると GPS の記録が止まります（アプリは画面の自動ロックを防ぎますが、手動で消すと止まります）
- スコアは端末側で計算しています。不正対策を厳密にする場合は Cloud Functions での再採点を追加してください
- 匿名認証のため、端末やブラウザを変えると別プレイヤーになります
- 地図タイルは OpenStreetMap の公開タイルサーバーを使っています。利用者が多くなる場合は
  [タイル利用規約](https://operations.osmfoundation.org/policies/tiles/) に従い、
  商用のタイル配信サービスに `js/config.js` の `TILE_URL` を切り替えてください

## ライセンス・クレジット

- 地図データ: © OpenStreetMap contributors（ODbL）
- フォント: DotGothic16（© The DotGothic16 Project Authors）、Press Start 2P（© The Press Start 2P Project Authors）
  ともに SIL Open Font License 1.1。アプリ用に文字を絞り込んだサブセットを `Nazca Dot` / `Nazca Arcade` の名前で同梱しています
  （ライセンス全文は `fonts/` を参照）
