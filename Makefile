## Copyright (C) 2018 David Pinto <david.pinto@bioch.ox.ac.uk>
##
## Copying and distribution of this file, with or without modification,
## are permitted in any medium without royalty provided the copyright
## notice and this notice are preserved.  This file is offered as-is,
## without any warranty.

PACKAGE := 'SPEKcheck'
VERSION := '0.1'

## Configuration
##
## This Makefile should probably be generated by a configure script
## from a Makefile.in.  We are not doing that so instead of configure,
## users can set this via environment variables.

BASE64 ?= base64
ICOTOOL ?= icotool
NPM ?= npm
PYTHON ?= python
RSVG_CONVERT ?= rsvg-convert
SED ?= sed
SHASUM ?= shasum
TAR ?= tar
XXD ?= xxd
ZIP ?= zip


help:
	@echo "Targets:"
	@echo "    serve        serve site at http://localhost:8000"
	@echo "    dist         create distribution tar file"
	@echo "    dist-zip     create distribution zip file"

distdir := $(PACKAGE)-$(VERSION)

DIST_ARCHIVES := $(distdir).tar.gz


npm_css_dependencies = \
  node_modules/bootstrap/dist/css/bootstrap.min.css \

npm_js_dependencies = \
  node_modules/bootstrap/dist/js/bootstrap.min.js \
  node_modules/chart.js/dist/Chart.min.js \
  node_modules/jquery/dist/jquery.min.js \
  node_modules/popper.js/dist/umd/popper.min.js


DISTFILES = \
  COPYING \
  Makefile \
  README.md \
  css/spekcheck.css \
  data/setups.json \
  help.html \
  images/README \
  images/favicon.ico \
  images/favicon.png \
  images/spekcheck-logo.png \
  images/spekcheck-logo.svg \
  images/visible-spectrum.png \
  index.html \
  js/spekcheck.js \
  src/create-spectrum.py \
  templates/spekcheck.html \
  $(npm_css_dependencies) \
  $(npm_js_dependencies)


images/visible-spectrum.png: src/create-spectrum.py
	$(PYTHON) $^ $@

## visible-spectrum.png is a prerequesite because it is linked from
## the svg file.
images/spekcheck-logo.png: images/spekcheck-logo.svg images/visible-spectrum.png
	$(RSVG_CONVERT) --format png $< > $@

images/favicon.png: images/spekcheck-logo.svg images/visible-spectrum.png
	$(RSVG_CONVERT) --format png --width 16 --height 16 $< > $@

## Not all browsers support png for their icons, so we need this
## conversion.  See https://caniuse.com/#feat=link-icon-png
images/favicon.ico: images/favicon.png
	$(ICOTOOL) --create --raw $< > $@


## We use npm to download all of our dependencies.  Because some of
## them are dependent on each other and npm will automatically get
## their dependencies, we have to prevent make from running in
## parallel.

.NOTPARALLEL:
define NPM_INSTALL_RULE
$1:
	$(NPM) install $(word 2, $(subst /, ,$1))
endef

$(foreach file, $(npm_css_dependencies) $(npm_js_dependencies), \
  $(eval $(call NPM_INSTALL_RULE, $(file))))


## We download the external dependencies via npm when preparing the
## package, and we check the integrity values of that.  This seems
## kinda pointless :/

templates/link-includes.in: $(npm_css_dependencies)
	$(RM) $@
	for FILE in $^ ; do \
	  INTEGRITY=`shasum -b -a 384 "$$FILE" | xxd -r -p | base64`; \
	  echo '  <link rel="stylesheet" type="text/css"' >>\
	  echo '        href="'"$$FILE"'"' >> $@; \
	  echo '        integrity="sha384-'"$$INTEGRITY"'"' >> $@; \
	  echo '        crossorigin="anonymous"/>' >> $@; \
	done

templates/script-includes.in: $(npm_js_dependencies)
	$(RM) $@
	for FILE in $^ ; do \
	  INTEGRITY=`shasum -b -a 384 "$$FILE" | xxd -r -p | base64`; \
	  echo '  <script src="'"$$FILE"'"' >> $@; \
	  echo '          integrity="sha384-'"$$INTEGRITY"'"' >> $@; \
	  echo '          crossorigin="anonymous"></script>' >> $@; \
	done

%.html: templates/%.html.in templates/script-includes.in templates/link-includes.in
	$(SED) -e '/@EXTERNAL_SCRIPT_INCLUDES@/ {' \
	       -e '  r templates/script-includes.in' \
	       -e '  d' \
	       -e '}' \
	       -e '/@EXTERNAL_LINK_INCLUDES@/ {' \
	       -e '  r templates/link-includes.in' \
	       -e '  d' \
	       -e '}' \
	        $< > $@

serve: index.html
	$(PYTHON) -m SimpleHTTPServer

check:
	@echo "We should have but we don't have any tests yet."

## The 'clean' target removes files normally created by building the
## program.  The 'distclean' target would also remove files by
## configure so that only the files originally in the release are
## left.  The SPEKcheck releases, there's none, but keep the target
## for consistency.
clean:

distclean: clean

## Delete almost everything that can be reconstructed with this
## Makefile.
maintainer-clean: distclean
	@echo "This command is intended for maintainers to use"
	@echo "it deletes files that may require special tools to rebuild."


.PHONY: \
  all \
  check \
  clean \
  dist \
  dist-gzip \
  dist-zip \
  distclean \
  distdir \
  help \
  maintainer-clean \
  serve
