# Euros

日本語の説明からキャラクターシート(正面・横・背面の立ち姿、表情一覧、衣装と小物の詳細)を作るデスクトップアプリです。
作ったキャラクターは Notos などほかのアプリから読み込めます。

## 必要なもの

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)(`http://127.0.0.1:8188` で起動)と、MOSS-Image または MiniMax-H3-Image のモデル
- [Ollama](https://ollama.com/)(`http://127.0.0.1:11434` で起動)と、日本語を扱えるモデル

## 開発

```
npm install
npm run tauri dev
```

## 保存先

既定は `%APPDATA%\Euros\library\characters\<id>\` です(設定で変えられます)。
形式は `docs/character-format.md` に書きます。

## リリース

- GitHub の Actions で **Bump version** を実行すると、バージョンを上げてタグを付け、インストーラーと自動アップデート用の `latest.json` を Releases に公開します。
- `v*` のタグを手で push しても同じようにリリースされます。
- 更新の署名鍵は `~/.tauri/euros.key`(パスワードは `~/.tauri/euros.key.password`)にあります。公開鍵は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に入っています。
  - 秘密鍵とパスワードは、リポジトリの Secrets の `TAURI_SIGNING_PRIVATE_KEY` と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` に登録します。
  - 鍵をなくすと、インストール済みのアプリに更新を届けられなくなります。バックアップしてください。
