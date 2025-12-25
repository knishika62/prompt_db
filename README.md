# Prompt DB Server

サーバー版の画像プロンプトデータベース管理ツールです。**サーバー側のSQLiteに画像メタデータを保存**し、LAN上の複数のPCから同じデータベースにアクセスできます。

## プロジェクトについて

このプロジェクトは、[Prompt SQL DB](https://github.com/revisionhiep-create/Prompt_SQL_DB) を参考に開発されたサーバーベース版です。

**オリジナル版の特徴:**
- 単一HTMLファイルで完結
- ブラウザのIndexedDBを使用したローカルストレージ
- インターネット接続不要で動作

**サーバー版を作った理由:**

オリジナル版は単独HTMLファイルで動作する点が非常に便利ですが、以下の制限がありました：

1. **サーバー側の画像を扱えない** - ブラウザからローカルファイルシステムに直接アクセスできないため、サーバー上にある大量の画像（例: ComfyUIの出力フォルダ）を管理できない
2. **ブラウザのストレージ制限** - IndexedDBには容量制限があり、大量の画像メタデータを保存できない
3. **複数デバイスからのアクセス不可** - ブラウザごとに独立したデータベースとなり、共有できない

そこで、サーバー側のファイルシステムにアクセスでき、LAN上の複数のPCから同じデータベースを共有できるサーバー版を開発しました。

## 機能

### サーバー側機能
- 📁 サーバー上の指定フォルダから画像を自動スキャン
- 🗄️ **サーバー側SQLiteDB** - 画像はファイルパスのみ保存（軽量・高速）
- 📊 **ComfyUI & Automatic1111 & SwarmUIのメタデータ自動抽出**（サーバー側で処理）
- 🖼️ 大量の画像対応（72,000+枚テスト済み）
- 🔄 最新の画像が先頭に表示（更新日時順）
- 🌐 **複数のクライアントから同じDBにアクセス可能**
- 💾 サブフォルダも再帰的にスキャン
- ⚡ ページネーション対応（100枚ずつ表示）

### クライアント側機能
- 🔍 プロンプト、モデル名、ファイル名で高速検索
- 🎨 **モデルフィルター** - インクリメンタルサーチ対応
- 🖼️ グリッド表示で画像を閲覧
- 📱 レスポンシブデザイン
- 🌙 ダークテーマ
- 📋 プロンプトコピー機能（HTTP/HTTPS両対応）
- 📝 **JSON/XML自動整形** - プロンプトがJSON/XML形式の場合、見やすく整形表示
- 🗑️ **画像削除機能** - チェックボックスで選択した画像を一括削除（DB + ファイル）
- 💡 軽量・シンプル（サーバーAPIのみ使用）

### MCP (Model Context Protocol) 対応
- 🤖 **Claude Desktop等のAIアシスタントから直接アクセス可能**
- 🌐 **LAN上のリモートサーバーにも対応**（プロキシ方式）
- 🔎 自然言語でデータベース検索
- 📊 統計情報の取得
- 🎯 モデル別の画像検索
- 🔧 6つのMCPツールを提供

## セットアップ

### 1. 依存パッケージのインストール

```bash
cd /Users/knishika/Desktop/works/prompt_db
npm install
```

### 2. サーバーの起動

```bash
npm start
```

または

```bash
node server.js
```

起動すると、以下のような情報が表示されます:

```
=================================
Prompt DB Server Started!
=================================

Local: http://localhost:3003
LAN:   http://192.168.1.100:3003

Image Folder: /Users/knishika/Desktop/works/prompt_db/images

Access from other devices on the same network using the LAN URL
=================================
```

## 使い方

### 1. サーバーにアクセス

- **ローカル**: `http://localhost:3003`
- **LAN**: `http://192.168.x.x:3003` (起動時に表示されるIPアドレス)

### 2. 画像をスキャン

1. 「🔄 Scan Folder」ボタンをクリック
2. サーバー上の画像フォルダパスを入力（例: `/home/knishika/AI/ComfyUI/output`）
3. 「Start Scan」をクリック
4. サーバー側で自動的に：
   - 画像ファイルをスキャン（サブフォルダ含む）
   - ComfyUI/A1111/SwarmUIのメタデータを抽出
   - プロンプト、モデル、パラメータをDBに保存
5. 重複チェック機能により、既存の画像はスキップされます

### 3. 画像の閲覧・検索・削除

- **閲覧**: 自動的に最新100枚が表示されます（ページネーション対応）
- **検索**: 検索ボックスでプロンプト、モデル名、ファイル名を検索
- **詳細表示**: 画像をクリックしてメタデータ全体を表示
- **JSON/XML整形**: プロンプトがJSON/XML形式の場合、自動的に整形表示されます
  - ComfyUIのワークフロー（`prompt{...}` や `{...}` 形式）
  - SwarmUIのパラメータ（`<parameters>...</parameters>` 形式）
  - 末尾のカンマなど、軽微な構文エラーは自動修正されます
- **画像削除**: 不要な画像を削除できます
  - 各サムネイルのチェックボックスで個別選択
  - ヘッダーの "Delete" ボタンで確認後に削除実行（選択時のみ表示、誤操作防止のため固定位置）
  - ヘッダーの "Select All" ボタンで現在のページの全画像を一括選択
  - データベースと実際の画像ファイルの両方が削除されます

### 4. 他のPCからアクセス

- 同じLAN上の別のPCから `http://192.168.x.x:3003` にアクセス
- **同じ画像とメタデータが表示されます**（サーバー側DB共有）

## MCP (Model Context Protocol) 対応

このサーバーはMCP経由でAIアシスタント（Claude Desktop等）から直接アクセス可能です。

**重要**: MCP機能はメインサーバー（port 3003）に統合されています。`npm start` でサーバーを起動するだけで、Web UIとMCP機能の両方が利用できます。

### HTTP経由でのMCPアクセス

メインサーバー起動後、以下のMCPエンドポイントが利用可能になります:

```bash
# サーバーを起動
npm start
```

起動すると、MCPエンドポイントも含めて以下のように表示されます:

```
=================================
Prompt DB Server Started!
=================================

Local: http://localhost:3003
LAN:   http://192.168.1.100:3003

Database: /Users/knishika/Desktop/works/prompt_db/prompt_db.sqlite
Image Folder: /home/knishika/AI/ComfyUI/output

MCP Endpoints:
- GET  /mcp/health       - Health check
- GET  /mcp/tools        - List available tools
- POST /mcp/call-tool    - Call a tool

=================================
```

### Claude Desktop での設定

**重要**: Claude Desktop はstdio経由のMCP接続のみサポートしています。そのため、HTTPベースのMCPエンドポイントに接続するには**ブリッジサーバー**を使用します。

#### ステップ1: メインサーバーを起動

```bash
npm start
```

#### ステップ2: ブリッジサーバーをClaude Desktopに設定

Claude Desktop の設定ファイルを編集:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "prompt-db": {
      "command": "node",
      "args": ["/Users/knishika/Desktop/works/prompt_db/mcp-bridge.js"],
      "env": {
        "PROMPT_DB_URL": "http://localhost:3003"
      }
    }
  }
}
```

**LAN上の別のマシンのサーバーに接続する場合**:

macOSのセキュリティ制限により、Claude Desktopから起動されたプロセスが直接LAN上の他のマシンにアクセスできない場合があります。その場合は、**ローカルプロキシ**を使用します。

##### ステップ1: プロキシサーバーを起動

```bash
# 別のターミナルウィンドウで実行（バックグラウンド起動）
cd /Users/knishika/Desktop/works/prompt_db
PROMPT_DB_URL=http://192.168.11.225:3003 nohup npm run mcp-proxy > /tmp/mcp-proxy.log 2>&1 &
```

または、フォアグラウンドで起動する場合：

```bash
cd /Users/knishika/Desktop/works/prompt_db
PROMPT_DB_URL=http://192.168.11.225:3003 npm run mcp-proxy
```

これにより、`localhost:3004` → `192.168.11.225:3003` への転送が開始されます。

**プロキシの動作確認:**

```bash
curl http://localhost:3004/mcp/health
# 応答: {"status":"ok","service":"prompt-db-mcp","version":"1.0.0"}
```

##### ステップ2: Claude Desktop設定

```json
{
  "mcpServers": {
    "prompt-db": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/your-username/Desktop/works/prompt_db/mcp-bridge.js"],
      "env": {
        "PROMPT_DB_URL": "http://localhost:3004"
      }
    }
  }
}
```

**注意**:
- `args`のパスは実際のmcp-bridge.jsの絶対パスに変更してください
  - macOSの場合、パスは小文字の `desktop` かもしれません（例: `/Users/knishika/desktop/works/prompt_db/mcp-bridge.js`）
- プロキシサーバーは常時起動しておく必要があります
- リモートサーバー（192.168.11.225:3003）が起動していることを確認してください
- ポート3003がファイアウォールで開放されていることを確認してください（LAN接続の場合）
- Claude Desktopを再起動すると、MCPサーバーリストに `prompt-db` が表示されます

**プロキシサーバーの停止:**

```bash
# プロキシのプロセスIDを確認
lsof -i :3004 -P

# プロセスを停止
kill <PID>
```

#### 動作原理

**ローカルサーバーの場合:**

```
Claude Desktop (stdio) → mcp-bridge.js → HTTP → server.js (port 3003) → SQLite DB
```

**リモートサーバー（LAN経由）の場合:**

```
Claude Desktop (stdio) → mcp-bridge.js → localhost:3004 → mcp-proxy.js → 192.168.11.225:3003 → server.js → SQLite DB
```

各コンポーネントの役割:
1. **mcp-bridge.js**: Claude DesktopからstdioでMCPリクエストを受信し、HTTPリクエストに変換
2. **mcp-proxy.js**: ローカルホストのリクエストをリモートサーバーに転送（macOSのセキュリティ制限回避）
3. **server.js**: HTTPリクエストを処理し、SQLiteデータベースにアクセス

### 利用可能なMCPツール

MCPサーバーは以下のツールを提供します:

1. **search_images** - プロンプト、モデル、ファイル名で画像を検索
   - AND検索: スペース区切り（例: `cat dog`）
   - OR検索: カンマ区切り（例: `cat, dog`）

2. **get_image_details** - 画像IDから詳細メタデータを取得

3. **list_recent_images** - 最近追加/更新された画像をリスト表示

4. **list_models** - データベース内の全AIモデルをリスト表示

5. **search_by_model** - 特定のモデルで生成された画像を検索

6. **get_database_stats** - データベース統計情報を取得

### 使用例

Claude Desktopで以下のようなリクエストが可能になります:

- "最近生成された画像を10枚見せて"
- "猫の画像を検索して"
- "Stable Diffusion XLで生成された画像を探して"
- "データベースの統計を教えて"

## 環境変数

サーバー起動時に環境変数で設定を変更できます:

```bash
# HTTPサーバーのポート番号を変更（Web UI + MCP両方）
PORT=8080 node server.js

# デフォルトの画像フォルダを設定
IMAGE_FOLDER=/path/to/images node server.js
```

## 対応画像形式

- `.jpg` / `.jpeg`
- `.png`
- `.gif`
- `.webp`
- `.bmp`

## サポートされているメタデータ

以下のAI画像生成ツールのメタデータを自動抽出します:

### 対応フォーマット

1. **ComfyUI**
   - ファイル形式: PNG
   - 保存場所: PNG tEXtチャンク
   - フォーマット: JSON (class_type, inputs, nodes構造)

2. **Automatic1111 (Stable Diffusion WebUI)**
   - ファイル形式: PNG
   - 保存場所: PNG tEXtチャンク
   - フォーマット: テキスト ("Negative prompt:", "Steps:"形式)

3. **SwarmUI**
   - ファイル形式: PNG, JPEG
   - 保存場所:
     - PNG: tEXtチャンク
     - JPEG: EXIF (UTF-16LE Unicode field)
   - フォーマット: JSON (sui_image_params構造)

### 抽出される情報

- Prompt (プロンプト)
- Negative Prompt (ネガティブプロンプト)
- Model (モデル名)
- Steps (ステップ数)
- Sampler (サンプラー)
- CFG Scale
- Seed (シード値)
- Size (画像サイズ)

## トラブルシューティング

### 他のPCからアクセスできない

1. ファイアウォールでポート3003が開いているか確認
2. 同じネットワーク(Wi-Fi)に接続しているか確認
3. サーバーのIPアドレスが正しいか確認

### 画像が読み込めない

1. 画像フォルダのパスが正しいか確認
2. サーバーに画像フォルダへのアクセス権限があるか確認
3. 対応している画像形式か確認

### メタデータが表示されない

- 画像にメタデータが埋め込まれていない可能性があります
- ComfyUI、Automatic1111、SwarmUIのフォーマットに対応しています
- それ以外の形式で保存されたメタデータは抽出できません

### MCPサーバーがClaude Desktopに表示されない

1. Claude Desktopの設定ファイルを確認
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - パスが正しいか確認（`desktop` vs `Desktop`）
2. メインサーバー（port 3003）が起動しているか確認
3. プロキシサーバー（LAN接続の場合）が起動しているか確認
   ```bash
   lsof -i :3004 -P
   ```
4. Claude Desktopのログを確認
   ```bash
   tail -f ~/Library/Logs/Claude/mcp-server-prompt-db.log
   ```

### LAN上のサーバーに接続できない（EHOSTUNREACH エラー）

macOSのセキュリティ制限により、Claude Desktopから起動されたプロセスが直接LAN上の他のマシンにアクセスできない場合があります。

**解決策**: ローカルプロキシを使用

1. プロキシサーバーを起動
   ```bash
   PROMPT_DB_URL=http://192.168.11.225:3003 npm run mcp-proxy
   ```

2. Claude Desktop設定で `localhost:3004` を使用
   ```json
   {
     "mcpServers": {
       "prompt-db": {
         "command": "/opt/homebrew/bin/node",
         "args": ["/Users/username/desktop/works/prompt_db/mcp-bridge.js"],
         "env": {
           "PROMPT_DB_URL": "http://localhost:3004"
         }
       }
     }
   }
   ```

3. Claude Desktopを再起動

## 技術スタック

### サーバーサイド
- Node.js + Express (HTTPサーバー)
- SQLite3 (データベース)
- Model Context Protocol SDK (MCP対応)
- http-proxy (ローカルプロキシ)
- exif-parser (メタデータ抽出)

### フロントエンド
- Vanilla JavaScript (フレームワークレス)
- HTML5 datalist (インクリメンタルサーチ)
- CSS Variables (ダークテーマ)
- Fetch API (サーバー通信)

## セキュリティ

- パスト ラバーサル攻撃を防ぐため、画像フォルダ外へのアクセスは制限されています
- LAN内でのみアクセス可能です(インターネットには公開されません)

## ライセンス

MIT
