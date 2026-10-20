#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const serviceName = 'musicman-notify.service';
const unitDir = path.join(os.homedir(), '.config/systemd/user');
const unitPath = path.join(unitDir, serviceName);
const daemonPath = path.resolve(__dirname, '../lib/notify-daemon.js');



// use the node binary running this script, systemd user services do not inherit shell PATH
const unit = `[Unit]
Description=musicman song change notifications
After=mpd.service

[Service]
ExecStart=${process.execPath} ${daemonPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

fs.mkdirSync(unitDir, { recursive: true });
fs.writeFileSync(unitPath, unit);
execFileSync('systemctl', ['--user', 'daemon-reload']);
console.log(`Installed ${unitPath}`);
console.log(`Start with: systemctl --user enable --now ${serviceName}`);
