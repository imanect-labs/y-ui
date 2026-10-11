=== TASK flow-001 ===
経費精算の流れは次のとおりです。

```mermaid
flowchart TD
  A[申請者が経費精算書を提出] --> B[上長が内容を承認]
  B -->|承認| C[経理部が内容を確認]
  B -->|差戻し| D[申請者が修正]
  D --> A
  C -->|問題なし| E[経理部が支払を実施]
```

資料には、経理部の確認で問題があった場合の扱いは書かれていません。
=== TASK flow-007 ===
デプロイの流れは次のとおりです。

```mermaid
flowchart TD
  A[コードをプッシュ] --> B[ビルド]
  B --> C[自動テスト]
  C -->|失敗| D[開発者に通知]
  C -->|成功| E[ステージング環境へデプロイ]
  E --> F[責任者の承認]
  F --> G[本番環境へデプロイ]
```

資料には、責任者が承認しなかった場合の扱いは書かれていません。
=== TASK flow-014 ===
出張の手続きの流れは次のとおりです。

```mermaid
flowchart TD
  A[出張申請] --> B[上長の承認]
  B --> C[交通機関と宿泊を手配]
  C --> D[出張]
  D --> E[帰着後に出張旅費を精算]
```

資料には、上長が承認しなかった場合の扱いは書かれていません。
=== TASK stack-001 ===
Web アプリの構成は次のとおりです。

```mermaid
flowchart TB
  web[画面<br>React / ブラウザ]
  subgraph api[API サーバ<br>Node.js]
    auth[認証]
    logic[業務ロジック]
    batch[バッチジョブ]
  end
  subgraph store[データ保存先]
    pg[PostgreSQL<br>業務データ]
    redis[Redis<br>セッション]
    s3[S3<br>添付ファイル]
  end
  web --> api
  api --> pg
  api --> redis
  api --> s3
```

資料には、API サーバ内の各機能がどの保存先を使うかまでは書かれていないため、API サーバ全体から各保存先へつないでいます。
=== TASK stack-006 ===
OSI 参照モデルの7階層を上から順に示します。

```mermaid
flowchart TB
  L7[第7層 アプリケーション層]
  L6[第6層 プレゼンテーション層]
  L5[第5層 セッション層]
  L4[第4層 トランスポート層]
  L3[第3層 ネットワーク層]
  L2[第2層 データリンク層]
  L1[第1層 物理層]
  L7 --> L6 --> L5 --> L4 --> L3 --> L2 --> L1
```
=== TASK stack-011 ===
EC サイトのシステム構成は次のとおりです。

```mermaid
flowchart TB
  front[フロントエンド<br>商品選択]
  api[カート・決済 API]
  subgraph ext[外部・連携先]
    pay[決済代行サービス]
    stock[在庫システム]
    ship[配送システム]
  end
  front --> api
  api --> pay
  api --> stock
  api --> ship
```
