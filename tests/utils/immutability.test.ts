"use strict";

import { deepFreeze } from "../../src/utils/immutability";

console.log("🧪 Testing avantgate/utils: Canonical deepFreeze...");

// 1. Primitives & null
const num = deepFreeze(42);
if (num !== 42) throw new Error("Primitive number failed");
const str = deepFreeze("hello");
if (str !== "hello") throw new Error("Primitive string failed");
const nil = deepFreeze(null);
if (nil !== null) throw new Error("Primitive null failed");
console.log("  ✅ Primitives and null pass through unaffected.");

// 2. Deep nested object freezing
const payload = {
  user: {
    name: "Alice",
    roles: ["admin", "editor"],
    config: {
      theme: { dark: true },
    },
  },
};
const frozen = deepFreeze(payload);
if (!Object.isFrozen(frozen)) throw new Error("Root object not frozen");
if (!Object.isFrozen(frozen.user)) throw new Error("Nested user not frozen");
if (!Object.isFrozen(frozen.user.roles)) throw new Error("Nested roles array not frozen");
if (!Object.isFrozen(frozen.user.config)) throw new Error("Nested config not frozen");
if (!Object.isFrozen(frozen.user.config.theme)) throw new Error("Nested theme not frozen");

let threwOnMutation = false;
try {
  // @ts-expect-error test strict mutation
  frozen.user.name = "Bob";
} catch {
  threwOnMutation = true;
}
if (!threwOnMutation) throw new Error("Direct mutation did not throw TypeError");
console.log("  ✅ Deep nested object and array immutability validated.");

// 3. Circular reference protection
interface CyclicNode {
  name: string;
  self?: CyclicNode;
}
const cyclic: CyclicNode = { name: "ouroboros" };
cyclic.self = cyclic;

let cyclicThrew = false;
try {
  deepFreeze(cyclic);
} catch {
  cyclicThrew = true;
}
if (cyclicThrew) throw new Error("Circular reference caused crash or stack overflow!");
if (!Object.isFrozen(cyclic)) throw new Error("Cyclic object was not frozen");
console.log("  ✅ Circular reference WeakSet guard validated (no Maximum call stack size exceeded).");

// 4. Bounded maxDepth
const deepTree = {
  l1: {
    l2: {
      l3: {
        leaf: "target",
      },
    },
  },
};
deepFreeze(deepTree, { maxDepth: 2 });
if (!Object.isFrozen(deepTree)) throw new Error("Root not frozen");
if (!Object.isFrozen(deepTree.l1)) throw new Error("Level 1 not frozen");
if (Object.isFrozen(deepTree.l1.l2.l3)) throw new Error("Level 3 should NOT be frozen when maxDepth is 2");
console.log("  ✅ Bounded maxDepth DoS protection validated.");

// 5. Special instances (Date, RegExp, Promise)
const specials = {
  date: new Date(),
  pattern: /^[a-z]+$/,
  promise: Promise.resolve(1),
};
deepFreeze(specials);
if (!Object.isFrozen(specials.date)) throw new Error("Date was not frozen");
if (!Object.isFrozen(specials.pattern)) throw new Error("RegExp was not frozen");
if (!Object.isFrozen(specials.promise)) throw new Error("Promise was not frozen");
console.log("  ✅ Special JavaScript objects (Date, RegExp, Promise) safely frozen.");

console.log("🎉 All immutability tests passed successfully!\n");
