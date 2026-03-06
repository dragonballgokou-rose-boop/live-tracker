# live-tracker

🎸 ライブ参戦集計表 - チームでライブの参戦状況を管理・集計するWebアプリ

## 機能
- ライブイベント管理（複数日対応）
- メンバー管理
- 参戦集計表（マトリクス形式）
- **Supabaseによるクラウド同期**（複数デバイス・メンバー間でデータを共有）
- エクスポート/インポート
- PWA対応（スマホアプリ風に使用可能）

## Supabase セットアップ

クラウド同期を使用するには、[Supabase](https://supabase.com) のプロジェクトが必要です。

### 1. Supabase プロジェクトを作成

1. [supabase.com](https://supabase.com) でアカウントを作成
2. 新しいプロジェクトを作成

### 2. データベーススキーマを適用

Supabase ダッシュボードの **SQL Editor** を開き、[`supabase/schema.sql`](supabase/schema.sql) の内容を貼り付けて実行してください。

### 3. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を編集し、Supabase ダッシュボードの **Settings > API** から値をコピーしてください。

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

> Supabase を設定しない場合、アプリはローカルの localStorage のみで動作します。

## 開発

```bash
npm install
npm run dev
```

## デプロイ

GitHub Pagesで自動デプロイ（pushで自動更新）

デプロイ先では、リポジトリの **Settings > Secrets and variables > Actions** に以下の環境変数を登録してください。

| 変数名 | 値 |
|--------|-----|
| `VITE_SUPABASE_URL` | Supabase プロジェクト URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public キー |
