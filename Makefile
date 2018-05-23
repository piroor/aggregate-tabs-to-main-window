NPM_MOD_DIR := $(CURDIR)/node_modules
NPM_BIN_DIR := $(NPM_MOD_DIR)/.bin

.PHONY: xpi install_dependency lint format

all: xpi

install_dependency:
	npm install

lint:
	$(NPM_BIN_DIR)/eslint . --ext=.js --report-unused-disable-directives

format:
	$(NPM_BIN_DIR)/eslint . --ext=.js --report-unused-disable-directives --fix

xpi: lint ../extlib/webextensions-lib-rich-confirm/RichConfirm.js
	git submodule update
	cp extlib/webextensions-lib-configs/Configs.js common/
	rm -f ./*.xpi
	zip -r -0 aggregate-tabs-to-main-window.xpi manifest.json common background >/dev/null 2>/dev/null

extlib/webextensions-lib-configs/Configs.js:
	git submodule update --init

