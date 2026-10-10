# 🚀 AvantGate v2.5.0 — Release Notes

> **Release Date**: October 10, 2026  
> **NPM Package**: [`avantgate@2.5.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Core Feature & Security Release — In-Flight Bidirectional DLP, Reversible Masking with Ephemeral Salts, Arithmetic ISO 7064 Modulo 97 & NIR Checksums, Streaming SSE Sliding Window & Zero-Retention Memory Purge.

---

## 📌 Executive Summary

Modern AI applications handling European financial and personal data encounter a fundamental compliance dilemma:
1. **Destructive Redaction Breaks User Experience**: Traditional PII sanitizers irreversibly replace sensitive values with generic markers like `[REDACTED_EMAIL]` or `[REDACTED_IBAN]`. When the LLM generates a customer confirmation or invoice summary, it cannot refer back to the user's actual email or bank account, breaking generative workflows.
2. **Raw Egress Leaks PII to Third Parties**: Passing raw data directly to cloud LLM providers (OpenAI, Mistral, Anthropic, DeepSeek) violates GDPR and financial data sovereignty regulations.
3. **Chunk Splitting Breaks SSE Streaming**: In streaming architectures (Server-Sent Events), tokenized redactions are fragmented across arbitrary delta boundaries (e.g., chunk 1: `⟪AG:EM`, chunk 2: `AIL:1:a8f2⟫`), rendering naive string replacement useless without a sliding buffer.

**AvantGate v2.5.0 resolves this dilemma with an in-flight, bidirectional DLP engine that is 100% reversible for authorized end-users, 100% confidential for upstream LLM providers, and strictly zero-dependency.**

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AVANTGATE v2.5.0 ARCHITECTURE                             │
│                                                                                        │
│  1. Ingress Masking with Ephemeral Salt                                                │
│     • Customer Prompt: "Virement pierre@corp.fr vers FR7630006000011234567890189"      │
│     • In-Process Redactor: Generates signed tokens: ⟪AG:EMAIL:1:a8f2⟫, ⟪AG:IBAN:1:a8f2⟫  │
│     • Entity Referent Reuse: Identical PII maps to identical token across turns        │
│                                                                                        │
│  2. Upstream Cloud LLM Zero-Egress Boundary                                           │
│     • Cloud LLM receives ONLY sanitized tokens (Zero raw PII egress)                   │
│     • LLM Response: "Ordre validé pour ⟪AG:EMAIL:1:a8f2⟫ vers ⟪AG:IBAN:1:a8f2⟫"        │
│                                                                                        │
│  3. Egress Restoration (JSON & SSE Web Streams)                                        │
│     • JSON Responses: Instant O(N) token replacement restores original values          │
│     • Streaming SSE: 32-character sliding window reconstructs split tokens on-the-fly  │
│     • Final Output to Client: "Ordre validé pour pierre@corp.fr vers FR763..."        │
│                                                                                        │
│  4. Arithmetic O(1) Checksums (Eliminating False Positives)                            │
│     • ISO 7064 Modulo 97-10 for international IBAN via native BigInt                   │
│     • INSEE Modulo 97 for French NIR / SSN (including Corsica 2A/2B handling)         │
│                                                                                        │
│  5. Zero-Retention & Memory Purge                                                      │
│     • session.dispose() & [Symbol.dispose]() immediately flushes RAM (Map.clear())     │
│     • Zero external database, zero Redis, zero supply-chain npm dependencies           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Highlights of v2.5.0

### 1. 🔒 In-Flight Bidirectional DLP Session (`InFlightRedactionSession`)

AvantGate v2.5.0 introduces `InFlightRedactionSession` (also exported as `BidirectionalSanitizer`), allowing ephemeral, reversible redaction scoped to a single request or agent lifecycle:

```typescript
import { InFlightRedactionSession } from "avantgate";

// 1. Initialize an ephemeral session
const session = new InFlightRedactionSession();

// 2. Ingress Masking: Redact before dispatching to external LLM
const prompt = "Transférer 500€ à pierre@corp.fr sur l'IBAN FR7630006000011234567890189";
const maskedPrompt = session.mask(prompt);
// Result: "Transférer 500€ à ⟪AG:EMAIL:1:a8f2⟫ sur l'IBAN ⟪AG:IBAN:1:a8f2⟫"

// 3. LLM Generation: External model processes only signed tokens
const llmCompletion = "Virement programmé pour ⟪AG:EMAIL:1:a8f2⟫ vers ⟪AG:IBAN:1:a8f2⟫.";

// 4. Egress Restoration: Restore original values for the client response
const clientResponse = session.restore(llmCompletion);
// Result: "Virement programmé pour pierre@corp.fr vers FR7630006000011234567890189."

// 5. Zero-Retention: Purge memory immediately
session.dispose();
```

---

### 2. 🔏 Cryptographic Ephemeral Salt & Collision-Proof Tokens

- **Unicode Delimiters**: Tokens use `⟪` (`\u27E8`) and `⟫` (`\u27E9`), which never collide with standard JSON syntax, Markdown links, HTML tags, or code blocks.
- **Session Ephemeral Salt**: Every session generates a unique 4-character cryptographic hex salt (`a8f2`) via `crypto.getRandomValues`. This prevents prompt injection attacks where a hostile user attempts to pre-populate fake tokens.
- **Entity Referent Reuse**: When the same sensitive value appears multiple times within a prompt or across conversational turns, `InFlightRedactionSession` returns the exact same token index, enabling the LLM to understand entity identity and co-reference.

---

### 3. ⚡ Streaming SSE De-Anonymization via Sliding Buffer

For real-time streaming LLM endpoints (`text/event-stream`), tokens can be split across arbitrary TCP deltas (e.g. chunk 1: `⟪AG:EM`, chunk 2: `AIL:1:a8f2⟫`).

AvantGate v2.5.0 implements a W3C-standard `TransformStream<string, string>` with a bounded 32-character sliding window:

```typescript
import { InFlightRedactionSession } from "avantgate";

const session = new InFlightRedactionSession();
session.mask(clientPrompt);

// Pipe upstream LLM stream through AvantGate's restore transform
const restoredStream = llmStream.pipeThrough(
  session.createRestoreTransformStream()
);

// All tokens are reconstituted and de-anonymized on-the-fly without stalling SSE!
```

- **Zero-Latency Passthrough**: Non-token content is emitted immediately.
- **Chunk Reconstitution**: Unclosed `⟪` sequences are held in the buffer until closed by `⟫` or until exceeding the 32-character maximum token length.
- **Stream Flush Guarantee**: Residual buffers are automatically flushed upon receiving `[DONE]` or when the stream closes.

---

### 4. 🧮 Arithmetic $O(1)$ ISO 7064 & NIR Checksums

To eliminate false positives on random alphanumeric strings:
- **ISO 7064 Modulo 97-10**: Full mathematical verification of international IBANs using native JavaScript `BigInt` (transposition and modulo 97 check).
- **INSEE NIR Checksum**: Arithmetic verification of French Social Security numbers ($97 - (NIR_{13} \pmod{97})$), including department normalization for Corsica (`2A` $\to 19$, `2B` $\to 18$).

---

### 5. 🧹 Zero-Retention Memory Purge & Explicit Resource Management

- **Explicit Dispose**: Calling `session.dispose()` immediately clears all internal lookup tables (`Map.clear()`), allowing Node.js / V8 Garbage Collection to reclaim sensitive strings.
- **TypeScript 5.2+ `using` Support**: Native implementation of `[Symbol.dispose]()` enables automatic deterministic scoping:

```typescript
{
  using session = new InFlightRedactionSession();
  const masked = session.mask(prompt);
  // ... perform LLM inference ...
  const restored = session.restore(response);
} // Automatic zero-retention memory purge here!
```

---

## ⏱️ Performance & Latency Benchmarks

Evaluated on a 2,282-word text containing multiple mixed PII entities:

| Operation | Latency | Performance Target |
|---|---|---|
| **Ingress Masking** | **0.506 ms** | < 2.0 ms |
| **Egress Restoration** | **0.087 ms** | < 2.0 ms |
| **SSE Streaming Chunk Overhead** | **< 0.01 ms / chunk** | Near zero |
| **External Dependencies** | **0 dependencies** | Zero npm bloat |

---

## 📦 Migration Guide from v2.4.0

AvantGate v2.5.0 is **100% backward-compatible**. Existing static `sanitizePII(text)` and `sanitizeCustomTerms(text)` methods continue to function unchanged.

To adopt bidirectional DLP:

```diff
- import { sanitizePII } from "avantgate";
- const { text } = sanitizePII(userPrompt); // Irreversible: [REDACTED_EMAIL]
+ import { InFlightRedactionSession } from "avantgate";
+ const session = new InFlightRedactionSession();
+ const maskedPrompt = session.mask(userPrompt); // Reversible: ⟪AG:EMAIL:1:xxxx⟫
+ const finalResponse = session.restore(llmResponse);
+ session.dispose();
```
