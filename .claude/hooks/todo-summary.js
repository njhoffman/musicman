#!/usr/bin/env node

// SessionStart hook: summarize open TODO.md items for the user and for Claude's context

const fs = require('fs');
const path = require('path');

const todoPath = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'TODO.md');

const summarize = content => {
  const sections = [];
  let current = null;
  content.split('\n').forEach(line => {
    const heading = line.match(/^## (.+)/);
    if (heading) {
      current = { name: heading[1].trim(), items: [] };
      sections.push(current);
      return;
    }
    const item = line.match(/^- \[ \] (.+)/);
    if (item && current) {
      // use the bold title when the item has one, otherwise the first line of the item
      const title = item[1].match(/^\*\*(.+?)\*\*/);
      current.items.push((title ? title[1] : item[1]).replace(/[.:,]+$/, ''));
    }
  });
  return sections.filter(({ items }) => items.length > 0);
};

const sections = fs.existsSync(todoPath) ? summarize(fs.readFileSync(todoPath, 'utf8')) : [];
const total = sections.reduce((count, { items }) => count + items.length, 0);

if (total > 0) {
  const lines = [`Open TODO.md items (${total}):`];
  sections.forEach(({ name, items }) => {
    lines.push(`${name}:`);
    items.forEach(item => lines.push(`  - ${item}`));
  });
  const summary = lines.join('\n');
  process.stdout.write(
    JSON.stringify({
      systemMessage: summary,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: summary }
    })
  );
}
