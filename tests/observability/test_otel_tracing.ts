import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initOpenTelemetry, getTracer, withSpan, CTRL_SPANS } from '../../src/observability/otel.js';

test('CTRL V11 OpenTelemetry Distributed Tracing', async (t) => {
  await t.test('1. Initializes OpenTelemetry tracer correctly', () => {
    initOpenTelemetry();
    const tracer = getTracer('test-tracer');
    assert.ok(tracer, 'Tracer must be defined');
  });

  await t.test('2. withSpan executes action and returns result with attributes', async () => {
    const result = await withSpan(
      CTRL_SPANS.AGENT_ITERATION,
      { opportunity_id: 'opp_test_otel_001', iteration: 1, run_id: 'run_test_001' },
      async (span) => {
        assert.ok(span, 'Span must be defined inside withSpan');
        return { success: true, processed: 1 };
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.processed, 1);
  });

  await t.test('3. withSpan records exception and propagates error correctly', async () => {
    await assert.rejects(
      async () => {
        await withSpan(
          CTRL_SPANS.AUTHORITY_CHECK,
          { opportunity_id: 'opp_test_otel_err' },
          async () => {
            throw new Error('Simulated span failure');
          }
        );
      },
      { message: 'Simulated span failure' }
    );
  });
});
