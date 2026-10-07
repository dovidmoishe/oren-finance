import assert from 'node:assert/strict';
import test from 'node:test';
import { pageContext, promptSuggestions, toolLabel } from '../components/agent/agent-utils.ts';
import { parseAgentSseChunk } from '../services/agent-sse.ts';

test('prediction context retains selected event without triggering research', () => {
  assert.deepEqual(pageContext('/app/predictions', 'marketId=event-1'), { page: 'predictions', marketId: 'event-1' });
  assert.ok(promptSuggestions({ page: 'predictions' }).every(s => !s.startsWith('Research')));
  assert.ok(toolLabel('researchPredictionMarket').length > 0);
});

test('streamed prediction research preserves source URLs, dates and warnings', () => {
  const artifact = { type: 'prediction_research', data: { generatedAt: '2026-10-07T10:00:00Z', warnings: ['Incomplete coverage'], sources: [{ id: 's1', url: 'https://www.sec.gov/report', publishedAt: null }] } };
  const event = { type: 'tool_completed', toolName: 'researchPredictionMarket', artifact, sequence: 1, turnId: 'turn', timestamp: '2026-10-07T10:00:00Z' };
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  const first = parseAgentSseChunk('', frame.slice(0, 24));
  const last = parseAgentSseChunk(first.buffer, frame.slice(24), true);
  assert.deepEqual(last.events, [event]);
});
