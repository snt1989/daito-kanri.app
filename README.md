# 大東受注ナビ

株式会社三桜 — 大東建託パートナーズ案件(原状回復工事・緊急対応・建物維持管理)の管理アプリ。

- `index.html` … アプリ本体(単一ファイル)
- `shim.js` … Claude アーティファクト実行環境の代わりに `/api` を使う互換層(ログイン画面を含む)
- `api/` … Vercel サーバー関数(`auth` ログイン / `db` データ保存 / `ai` 書類読み取り / `google` Gmail 連携)
- `import.html` … アーティファクト版からのデータ移行用

## Vercel の設定(環境変数)

| 名前 | 内容 |
|---|---|
| `APP_PASSWORD` | アプリを開くときの共通パスワード(必須) |
| `SESSION_SECRET` | ランダムな長い文字列(任意・推奨) |
| `ANTHROPIC_API_KEY` | 書類の自動読み取り用(Anthropic Console で発行) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | データ保存。Vercel の Storage → Upstash Redis を追加すると自動で入る |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | FAX取込(Gmail)用。Google Cloud の OAuth クライアント |

Google Cloud 側: Gmail API を有効化 → OAuth クライアント(ウェブアプリ)を作成 →
承認済みリダイレクト URI に `https://<公開URL>/api/google?op=callback` を登録。
初回だけアプリの「FAX取込」から「Gmailを接続する」を押して許可します(読み取り専用)。

環境変数を追加・変更したら再デプロイしてください。

## 担当ごとのログイン
- 管理者: 従来の `APP_PASSWORD` で、担当名を空欄のままログイン。
- 担当: 設定 → 担当・作業員 →「パスワード」で発行(Redis の `daito:users` にハッシュで保存)。担当名+パスワードでログインし、自分の担当分を初期表示します。

## 書類ボックス・バックアップ
- FAX取込で読み取った書類(PDF・画像、約700KBまで。大きいPDFは1ページ目の画像)を Redis に保管 → 左メニュー「書類ボックス」。
- バックアップ: データ更新の初回(1日1回)に自動、設定 → バックアップ で手動保存・ダウンロード・復元(直近14世代)。ダウンロードしたJSONは `/import.html` で取り込み可能。
