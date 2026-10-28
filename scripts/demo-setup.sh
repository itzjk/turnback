export TURNBACK_DEMO_SOURCE="$PWD"
test -f "$TURNBACK_DEMO_SOURCE/scripts/demo-project.mjs" || return 1
TURNBACK_DEMO_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/turnback-vhs.XXXXXX")" || return 1
export TURNBACK_DEMO_ROOT
mkdir "$TURNBACK_DEMO_ROOT/bin" "$TURNBACK_DEMO_ROOT/project" || return 1
ln -s "$TURNBACK_DEMO_SOURCE/bin/turnback.mjs" "$TURNBACK_DEMO_ROOT/bin/turnback" || return 1
export PATH="$TURNBACK_DEMO_ROOT/bin:$PATH"
cd "$TURNBACK_DEMO_ROOT/project" || return 1
node "$TURNBACK_DEMO_SOURCE/scripts/demo-project.mjs" setup || return 1
turnback_demo_check() {
  node "$TURNBACK_DEMO_SOURCE/scripts/demo-project.mjs" "$1"
}
turnback_demo_clean() {
  cd "$TURNBACK_DEMO_SOURCE" && rm -rf "$TURNBACK_DEMO_ROOT"
}
printf 'demo project ready\n'
