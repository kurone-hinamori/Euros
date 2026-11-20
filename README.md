# Euros

日本語の説明からキャラクターシート(正面・横・背面の立ち姿、表情一覧、衣装と小物の詳細)を作るデスクトップアプリです。
作ったキャラクターは Notos などほかのアプリから読み込めます。

## 必要なもの

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)(`http://127.0.0.1:8188` で起動)と、MOSS-Image または MiniMax-H3-Image のモデル
- [Ollama](https://ollama.com/)(`http://127.0.0.1:11434` で起動)と、日本語を扱えるモデル

## 使い方

1. **設定**:ComfyUI と Ollama の接続を確かめ、画像生成のモデルを選びます(ファイルは自動で選びます)。
2. **新規作成**:日本語でキャラクターを説明し、「外見を整理する」で外見とプロフィールの項目に分けます。直してから「シートを生成」で候補を作り、1枚を選んで保存します。顔・衣装・画風の参考にする画像も読み込めます。
3. **詳細**:シート、外見、プロフィール、使ったプロンプト、版の履歴を見られます。前の版との比較や、前の版に戻すこともできます。
4. **編集**:「前髪をもう少し長く」のような修正指示で外見を直し、シートを描き直します。描き直し方は次の4つです。
   - いまのシートを参照して直す(MiniMax-H3-Image の方がきれいに直せます)
   - 範囲だけ描き直す(選んだ範囲の外は元のまま)
   - 同じ seed で描き直す
   - 新しく描く
5. **受け渡し**:詳細の画面の「書き出す」で `.euros` ファイルにし、一覧の画面の「読み込む」で取り込みます。

## 開発

```
npm install
npm run tauri dev
```

確かめるとき:

```
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## 保存先

既定は `%APPDATA%\Euros\library\characters\<id>\` です(設定で変えられます)。
形式は [docs/character-format.md](docs/character-format.md) にあります。ほかのアプリはこの文書に従って読み込みます。

## リリース

- GitHub の Actions で **Bump version** を実行すると、バージョンを上げてタグを付け、インストーラーと自動アップデート用の `latest.json` を Releases に公開します。
- `v*` のタグを手で push しても同じようにリリースされます。
- 更新の署名鍵は `~/.tauri/euros.key`(パスワードは `~/.tauri/euros.key.password`)にあります。公開鍵は `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に入っています。
  - 秘密鍵とパスワードは、リポジトリの Secrets の `TAURI_SIGNING_PRIVATE_KEY` と `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` に登録します。
  - 鍵をなくすと、インストール済みのアプリに更新を届けられなくなります。バックアップしてください。
