// Writes the agent's system prompt and tool definitions to voice/ so the same
// agent can also be configured in a hosted voice provider if needed.
//   npm run export:voice
import { writeFileSync, mkdirSync } from 'node:fs';
import { SYSTEM_PROMPT } from '../src/prompt.js';
import { TOOLS } from '../src/tools.js';

mkdirSync('voice', { recursive: true });
writeFileSync('voice/system-prompt.md', SYSTEM_PROMPT + '\n');
writeFileSync('voice/tools.json', JSON.stringify(TOOLS, null, 2) + '\n');
console.log('Wrote voice/system-prompt.md and voice/tools.json');
