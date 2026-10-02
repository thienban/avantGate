import assert from "node:assert";
import {
  withServerIdempotency,
  createMemoryIdempotencyStore,
  createAdapterIdempotencyStore,
} from "../../src/agent/idempotency-guard";
import { MemoryStorageAdapter } from "../../src/agent/adapters/memory-adapter";

console.log("🛡️ Testing avantgate/agent withServerIdempotency (FEAT-028)...");

async function testFirstRequestExecutesAndCaches(): Promise<void> {
  const store = createMemoryIdempotencyStore();
  let executionCount = 0;

  const result = await withServerIdempotency("order_req_42", store, async () => {
    executionCount++;
    return { orderId: "ord_101", status: "CREATED" };
  });

  // Criteria 2.1: First run executes, is not cached, and stores result
  assert.strictEqual(executionCount, 1);
  assert.strictEqual(result.isCached, false);
  assert.deepStrictEqual(result.result, { orderId: "ord_101", status: "CREATED" });

  console.log("  ✅ Criteria 2.1: First server request executed and cached successfully.");
}

async function testDuplicateRequestShortCircuits(): Promise<void> {
  const store = createMemoryIdempotencyStore();
  let executionCount = 0;

  const handler = async () => {
    executionCount++;
    return { summary: "AI generation complete", costUSD: 0.04 };
  };

  // Run 1
  const firstCall = await withServerIdempotency("req_gen_999", store, handler);
  assert.strictEqual(firstCall.isCached, false);
  assert.strictEqual(executionCount, 1);

  // Run 2: Duplicate key
  const secondCall = await withServerIdempotency("req_gen_999", store, handler);

  // Criteria 2.2: Duplicate request short-circuits handler execution
  assert.strictEqual(secondCall.isCached, true);
  assert.strictEqual(executionCount, 1, "Handler must NOT be executed a second time");
  assert.deepStrictEqual(secondCall.result, firstCall.result);

  console.log("  ✅ Criteria 2.2: Duplicate request short-circuited without re-running handler.");
}

async function testRequestWithoutKeyPassesThrough(): Promise<void> {
  const store = createMemoryIdempotencyStore();
  let executionCount = 0;

  const handler = async () => {
    executionCount++;
    return { timestamp: Date.now() };
  };

  // Request with undefined key
  const res1 = await withServerIdempotency(undefined, store, handler);
  assert.strictEqual(res1.isCached, false);
  assert.strictEqual(executionCount, 1);

  // Request with null key
  const res2 = await withServerIdempotency(null, store, handler);
  assert.strictEqual(res2.isCached, false);
  assert.strictEqual(executionCount, 2);

  // Request with empty string key
  const res3 = await withServerIdempotency("", store, handler);
  assert.strictEqual(res3.isCached, false);
  assert.strictEqual(executionCount, 3);

  console.log("  ✅ Criteria 2.3: Requests without idempotency key execute without caching.");
}

async function testMemoryStoreTtlExpiration(): Promise<void> {
  const store = createMemoryIdempotencyStore();

  // Store with short TTL (0 second = immediate expiration on next check)
  store.set("temp_key", "temporary_value", -1);
  const expired = await store.get("temp_key");
  assert.strictEqual(expired, undefined);

  store.set("valid_key", "persistent_value", 60);
  const valid = await store.get("valid_key");
  assert.strictEqual(valid, "persistent_value");

  console.log("  ✅ MemoryIdempotencyStore TTL expiration validated.");
}

async function testAdapterIdempotencyStoreIntegration(): Promise<void> {
  const memoryAdapter = new MemoryStorageAdapter();
  const store = createAdapterIdempotencyStore(memoryAdapter, "test_idem");
  let executionCount = 0;

  const runTask = (key: string) =>
    withServerIdempotency(key, store, async () => {
      executionCount++;
      return { output: "result_from_db" };
    });

  const call1 = await runTask("db_task_1");
  assert.strictEqual(call1.isCached, false);
  assert.strictEqual(executionCount, 1);

  const call2 = await runTask("db_task_1");
  assert.strictEqual(call2.isCached, true);
  assert.strictEqual(executionCount, 1);
  assert.deepStrictEqual(call2.result, { output: "result_from_db" });

  console.log("  ✅ StepStorageAdapter integration (createAdapterIdempotencyStore) validated.");
}

async function runAllTests(): Promise<void> {
  await testFirstRequestExecutesAndCaches();
  await testDuplicateRequestShortCircuits();
  await testRequestWithoutKeyPassesThrough();
  await testMemoryStoreTtlExpiration();
  await testAdapterIdempotencyStoreIntegration();
  console.log("🎉 All withServerIdempotency tests passed successfully!\n");
}

runAllTests().catch((err) => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
