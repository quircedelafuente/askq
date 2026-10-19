#!/usr/bin/env node
// Claude Code PreToolUse hook: applies the "yes" rule (src/guard-core.mjs) before each tool call.
// Interactive sessions (someone typing in `claude` inside the workspace) pass: Claude Code's own permission prompt asks.
import { check } from './guard-core.mjs';

if (process.env.ASKQ !== '1') process.exit(0);

let input = '';
for await (const c of process.stdin) input += c;
let j; try { j = JSON.parse(input); } catch { process.exit(0); }
const r = await check({ tool: j.tool_name || '', args: j.tool_input || {}, callId: j.tool_use_id || '' });
if (r.decision !== 'pass') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: r.decision, permissionDecisionReason: r.reason } }));
process.exit(0);
