.DEFAULT_GOAL := help
.PHONY: help bootstrap dev test typecheck build clean

help: ## このヘルプを表示
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

bootstrap: ## 依存をインストールし、server/.env を用意する
	@command -v pnpm >/dev/null 2>&1 || { echo "pnpm が見つかりません。'corepack enable' か 'npm i -g pnpm' を実行してください。"; exit 1; }
	pnpm install
	@if [ ! -f server/.env ]; then \
		cp server/.env.example server/.env; \
		echo ""; \
		echo "→ server/.env を作成しました。API キーを記入してください（記入したモデルだけ GUI に出ます）。"; \
	else \
		echo ""; \
		echo "→ server/.env は既に存在します（上書きしません）。"; \
	fi

dev: ## client (5173) と server (3001) を同時起動
	pnpm dev

test: ## 全パッケージのテスト
	pnpm -r test

typecheck: ## 全パッケージの型チェック
	pnpm -r typecheck

build: ## client を本番ビルド
	pnpm --filter client build

clean: ## 依存とビルド生成物を削除
	rm -rf node_modules */node_modules client/dist server/out
