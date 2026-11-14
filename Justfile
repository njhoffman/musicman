# musicman: install publishes a build and runs its notification daemon. The command itself is
# ~/.shell's scripts/musicman, which runs ~/.local/share/musicman/current.

home := env_var_or_default("MUSICMAN_HOME", env_var("HOME") / ".local/share/musicman")
unit := env_var_or_default("XDG_CONFIG_HOME", env_var("HOME") / ".config") / "systemd/user/musicman-notify.service"

# list recipes
default:
    @just --list

# workspace dependencies (pnpm, frozen lock), a build of HEAD as `current` (scripts/publish-local.sh), and the musicman-notify unit, enabled and restarted
install:
    #!/usr/bin/env bash
    set -euo pipefail
    command -v pnpm >/dev/null || { echo "install: pnpm not found (~/.shell's deploy installs it)" >&2; exit 1; }
    pnpm install --frozen-lockfile
    MUSICMAN_RESTART_DAEMON=0 scripts/publish-local.sh
    node=$(command -v node)
    mkdir -p "$(dirname "{{ unit }}")"
    printf '%s\n' \
      '[Unit]' \
      'Description=musicman song change notifications' \
      'After=mpd.service' \
      '' \
      '[Service]' \
      "ExecStart=$node {{ home }}/current/cli/lib/notify-daemon.js" \
      "EnvironmentFile=-${XDG_CONFIG_HOME:-$HOME/.config}/musicman/spotify.env" \
      'Restart=on-failure' \
      'RestartSec=5' \
      '' \
      '[Install]' \
      'WantedBy=default.target' >"{{ unit }}"
    systemctl --user daemon-reload
    systemctl --user enable musicman-notify.service
    systemctl --user restart musicman-notify.service
    echo "current -> $(readlink "{{ home }}/current"); musicman-notify enabled and restarted"

# exit 1 when the current build, the unit or its enablement is missing (deploy reinstalls then)
install-check:
    #!/usr/bin/env bash
    set -euo pipefail
    [[ -f "{{ home }}/current/BUILD.json" ]]
    [[ -f "{{ unit }}" ]]
    systemctl --user is-enabled --quiet musicman-notify.service

# the test suite
test:
    pnpm test
