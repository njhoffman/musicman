# musicman: install publishes a build, runs its notification daemon, and sets up the background
# analyze timer. The command itself is ~/.shell's scripts/musicman, which runs
# ~/.local/share/musicman/current.

home := env_var_or_default("MUSICMAN_HOME", env_var("HOME") / ".local/share/musicman")
units := env_var_or_default("XDG_CONFIG_HOME", env_var("HOME") / ".config") / "systemd/user"
unit := units / "musicman-notify.service"

# list recipes
default:
    @just --list

# workspace dependencies (pnpm, frozen lock), a build of HEAD as `current` (scripts/publish-local.sh), the musicman-notify unit, enabled and restarted, and the musicman-analyze timer (analyze --idle every 15 minutes), enabled
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
    # analyze --idle starts only when the computer is idle and on AC power (analyze.idle), at idle CPU and
    # IO priority for the whole process tree (node, uv, the Essentia workers); uv's directory is on PATH
    # since user units do not get the login shell's
    uv=$(command -v uv || true)
    [[ -n "$uv" ]] || echo "install: uv not found, musicman-analyze will fail until it is on PATH" >&2
    printf '%s\n' \
      '[Unit]' \
      'Description=musicman analyze in the background while the computer is idle' \
      '' \
      '[Service]' \
      'Type=oneshot' \
      "ExecStart=$node {{ home }}/current/cli/lib/cli.js analyze --idle" \
      "Environment=PATH=${uv:+$(dirname "$uv"):}$(dirname "$node"):/usr/local/bin:/usr/bin:/bin" \
      'Nice=19' \
      'CPUSchedulingPolicy=idle' \
      'IOSchedulingClass=idle' \
      'TimeoutStartSec=infinity' \
      '# stopped (systemctl stop) it is archived as interrupted, exit 130' \
      'SuccessExitStatus=130' >"{{ units }}/musicman-analyze.service"
    printf '%s\n' \
      '[Unit]' \
      'Description=musicman analyze --idle every 15 minutes' \
      '' \
      '[Timer]' \
      'OnCalendar=*:0/15' \
      'AccuracySec=1min' \
      '' \
      '[Install]' \
      'WantedBy=timers.target' >"{{ units }}/musicman-analyze.timer"
    systemctl --user daemon-reload
    systemctl --user enable musicman-notify.service
    systemctl --user restart musicman-notify.service
    systemctl --user enable --now musicman-analyze.timer
    echo "current -> $(readlink "{{ home }}/current"); musicman-notify enabled and restarted, musicman-analyze.timer enabled"

# exit 1 when the current build, a unit or its enablement is missing (deploy reinstalls then)
install-check:
    #!/usr/bin/env bash
    set -euo pipefail
    [[ -f "{{ home }}/current/BUILD.json" ]]
    [[ -f "{{ unit }}" ]]
    [[ -f "{{ units }}/musicman-analyze.service" && -f "{{ units }}/musicman-analyze.timer" ]]
    systemctl --user is-enabled --quiet musicman-notify.service
    systemctl --user is-enabled --quiet musicman-analyze.timer

# ~/.shell's test-progress, when installed, runs each step, keeps the run and shows it live
tp := if path_exists(home_directory() / ".shell/scripts/test-progress") == "true" { home_directory() / ".shell/scripts/test-progress run --" } else { "" }

# the test suite: the cli's mocha tests, then the scripts' node --test tests
test:
    cd cli && {{ tp }} NODE_ENV=test node_modules/.bin/mocha
    {{ tp }} node --test 'scripts/*.test.js'
