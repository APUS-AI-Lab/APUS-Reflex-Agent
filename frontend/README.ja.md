# APUS Reflex Harness デスクトップ

![APUS Reflex Harness](../apps/web/public/brand-source.webp)

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

**瞬策 · 瞬时执行，深度思考 · Model-as-a-Harness**

APUS Reflex Harness は、ローカルプロジェクトでモデルと作業する Personal Agent デスクトップアプリです。作業ディレクトリとモデルを選び、保存される会話でタスクを実行します。任意の Reflex/Jev 判断サービスは Settings → Reflex configuration で設定します。サービスに接続しても、ルーティング、監督、記憶は自動では有効になりません。デスクトップと Harness ランタイムはこのリポジトリから一緒に配布されます。アーキテクチャと現在の制限は[製品 README](../README.md)を参照してください。

今回の統合では、既存の Harness リポジトリを主とし、デスクトップクライアントを `frontend/` に取り込み、フロントエンドとバックエンドの設定・ビルド・パッケージ化を一元化します。インストーラーにバックエンドが含まれるため、別途インストールや起動は不要です。統合リリースは準備中です。

公開済みインストーラーと対応環境は Releases を参照してください。統合プレビューは準備中です。ソースコードのアーカイブはインストーラーではありません。 [Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases).

[インストール](../docs/feat-integrated-product/installation.md) · [モデル設定](../docs/feat-integrated-product/configuration.md) · [開発](../docs/feat-integrated-product/development.md) · [リリース手順](../docs/feat-integrated-product/releases.md)

元の MIT ライセンスと第三者のライセンス通知は保持されています。 [LICENSE](LICENSE) · [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
