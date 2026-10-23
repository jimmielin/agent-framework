/**
 * Operator-surface turns with no channel locus (src/mcpl/operator-surface.ts).
 *
 * A TUI / web-console / IPC wake (`external-message`) in a deployment with no
 * chat channels used to push every plain-prose segment through routeSpeech,
 * which failed on "no locus" and added a `[send-undeliverable]` notice,
 * although the surface that woke the agent displayed it. Such turns keep
 * their prose in the chronicle without a routing attempt. Channel-less turns
 * woken by anything else keep the failure notice and trace.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Module, ModuleContext, ProcessState, ProcessEvent, EventResponse, ToolDefinition, ToolCall, ToolResult,
} from '../src/index.js';
import { AgentFramework, proseStaysOnOperatorSurface } from '../src/index.js';
import { MockMembrane, createMockResponse } from './helpers/mock-membrane.js';
import type { ContentBlock } from '@animalabs/membrane';

/** Minimal host-like module: console input adds a user message and wakes the
 *  agent (as connectome-host's TuiModule does); a synthetic timer event wakes
 *  it with no message, standing in for a heartbeat. */
class SurfaceModule implements Module {
  readonly name = 'surface';
  async start(_ctx: ModuleContext): Promise<void> {}
  async stop(): Promise<void> {}
  getTools(): ToolDefinition[] {
    return [{ name: 'probe', description: 'Run a probe', inputSchema: { type: 'object', properties: {} } }];
  }
  async handleToolCall(_call: ToolCall): Promise<ToolResult> { return { success: true, data: 'ok' }; }
  async onProcess(event: ProcessEvent, _state: ProcessState): Promise<EventResponse> {
    if (event.type === 'external-message') {
      const text = String((event as { content?: unknown }).content);
      return { addMessages: [{ participant: 'user', content: [{ type: 'text', text }] }], requestInference: true };
    }
    if ((event as { type: string }).type === 'test:timer') return { requestInference: true };
    return {};
  }
}

const UNDELIVERABLE = '[send-undeliverable]';

/** A stdio MCP server with no tools and no channels. The channel registry
 *  (and so speech routing) only exists when an MCPL server is configured —
 *  the trial deployment's shape: servers for memory and recall, nothing
 *  that is a chat channel. */
const NOOP_STDIO_SERVER = `
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
  if (m.method === 'initialize') reply({ protocolVersion: '2024-11-05', serverInfo: { name: 'noop', version: '0' }, capabilities: { tools: {} } });
  else if (m.method === 'tools/list') reply({ tools: [] });
  else reply({});
});
`;

describe('operator-surface turns with no channel locus', () => {
  let tempDir: string;
  let membrane: MockMembrane;
  let framework: AgentFramework;
  let traces: string[];

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'operator-surface-'));
    membrane = new MockMembrane();
    framework = await AgentFramework.create({
      storePath: join(tempDir, 'test.chronicle'),
      membrane: membrane.asMembrane(),
      agents: [{ name: 'resident', model: 'test-model', systemPrompt: 'You are a test agent.' }],
      modules: [new SurfaceModule()],
      mcplServers: [{ id: 'noop', command: process.execPath, args: ['-e', NOOP_STDIO_SERVER] }],
    });
    traces = [];
    framework.onTrace((e) => { traces.push((e as { type: string }).type); });
  });

  afterEach(async () => {
    await framework.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function windowTexts(): string[] {
    return framework.getAgent('resident')!.getContextManager().getAllMessages()
      .flatMap((m) => m.content)
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text);
  }

  /** Run another turn so any notice deferred while the first turn was alive
   *  has a chance to reach the agent's window. */
  async function secondTurn(event: Record<string, unknown>): Promise<void> {
    membrane.pushResponse(createMockResponse([{ type: 'text', text: 'Second turn.' }] as ContentBlock[]));
    framework.pushEvent(event as unknown as ProcessEvent);
    await framework.runUntilIdle();
  }

  it('a console wake with no channels keeps its reply unmarked and unrouted', async () => {
    membrane.pushResponse(createMockResponse([{ type: 'text', text: 'Hello from the console side.' }] as ContentBlock[]));
    framework.pushEvent({ type: 'external-message', source: 'tui', content: 'hello', metadata: {} } as unknown as ProcessEvent);
    await framework.runUntilIdle();
    await secondTurn({ type: 'external-message', source: 'tui', content: 'again', metadata: {} });

    const texts = windowTexts();
    assert.ok(texts.includes('Hello from the console side.'), 'the reply is in the chronicle');
    assert.ok(!texts.some((t) => t.includes(UNDELIVERABLE)), `no undeliverable notice: ${JSON.stringify(texts)}`);
    assert.ok(!traces.includes('mcpl:speech-route-failed'), 'no route-failed trace');
  });

  it('a console tool turn keeps both live and trailing prose unmarked and unrouted', async () => {
    membrane.pushResponse(createMockResponse([
      { type: 'text', text: 'Before the probe.' },
      { type: 'tool_use', id: 'probe-1', name: 'surface--probe', input: {} },
    ] as ContentBlock[], 'tool_use'));
    membrane.pushResponse(createMockResponse([{ type: 'text', text: 'After the probe.' }] as ContentBlock[]));
    framework.pushEvent({ type: 'external-message', source: 'tui', content: 'probe', metadata: {} } as unknown as ProcessEvent);
    await framework.runUntilIdle();
    assert.equal(membrane.lastStream!.receivedToolResults.length, 1, 'the tool round completed');
    await secondTurn({ type: 'external-message', source: 'tui', content: 'again', metadata: {} });

    const texts = windowTexts();
    assert.ok(texts.includes('Before the probe.'), 'live prose is in the chronicle');
    assert.ok(texts.includes('After the probe.'), 'trailing prose is in the chronicle');
    assert.ok(!texts.some((t) => t.includes(UNDELIVERABLE)), `no undeliverable notice: ${JSON.stringify(texts)}`);
    assert.ok(!traces.includes('mcpl:speech-route-failed'), 'no route-failed trace');
  });

  it('a non-surface wake with no channels still gets the loud failure', async () => {
    membrane.pushResponse(createMockResponse([{ type: 'text', text: 'Spoken into the void.' }] as ContentBlock[]));
    framework.pushEvent({ type: 'test:timer', source: 'test' } as unknown as ProcessEvent);
    await framework.runUntilIdle();
    await secondTurn({ type: 'test:timer', source: 'test' });

    const texts = windowTexts();
    assert.ok(texts.includes('Spoken into the void.'));
    assert.ok(texts.some((t) => t.includes(UNDELIVERABLE)), `notice expected: ${JSON.stringify(texts)}`);
    assert.ok(traces.includes('mcpl:speech-route-failed'));
  });
});

describe('proseStaysOnOperatorSurface', () => {
  it('is true only for an external-message trigger with no locus', () => {
    assert.equal(proseStaysOnOperatorSurface({ reason: 'external-message' }, null), true);
    assert.equal(proseStaysOnOperatorSurface({ reason: 'external-message' }, 'discord:g:c'), false);
    assert.equal(proseStaysOnOperatorSurface({ reason: 'api:message' }, null), false);
    assert.equal(proseStaysOnOperatorSurface({ reason: 'mcpl:push-event' }, null), false);
    assert.equal(proseStaysOnOperatorSurface({ reason: 'context_budget_restart' }, null), false);
    assert.equal(proseStaysOnOperatorSurface(undefined, null), false);
  });
});
