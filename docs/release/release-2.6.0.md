# 🚀 AvantGate v2.6.0 — Release Notes

> **Release Date**: October 14, 2026  
> **NPM Package**: [`avantgate@2.6.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Core Security & Compliance Release — PCI-DSS Luhn Credit Cards, IPv4 Network Addresses & CIDR, International E.164 Telephones, US Social Security Numbers (SSN), Zero-Regression SSE Streaming & High-Throughput Benchmarks.

---

## 📌 Executive Summary

Building upon the bidirectional, in-flight DLP architecture introduced in `avantgate@2.5.0`, version **`2.6.0`** expands native detection and de-anonymization to achieve full **PCI-DSS** compliance and international enterprise readiness.

AvantGate v2.6.0 natively intercepts, sanitizes, and seamlessly restores:
1. **Credit & Debit Cards (PCI-DSS PAN)**: Visa, Mastercard, American Express, Discover, and Carte Bleue with deterministic arithmetical **Luhn checksum validation** ($O(n)$) to eliminate false positives on generic sequences of digits.
2. **Network IPv4 Addresses & CIDR Subnets**: Detects RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`) and public IPs with strict lookaround guards preventing false positives on software versions (`v2.4.1.0`).
3. **International Phone Numbers (E.164 Standard)**: Broadened support for global country codes (+1 US/CA, +44 UK, +49 DE, etc.) alongside full backward compatibility for French territorial numbers (`01-09`, `+33`, `0033`).
4. **US Social Security Numbers (SSN)**: SSA-compliant 9-digit format detection (`\b\d{3}-\d{2}-\d{4}\b`) with deterministic rejection of invalid/reserved prefixes (`000`, `666`, `9xx`).

All entities integrate with the zero-leak ephemeral salt token format (`⟪AG:TYPE:INDEX:SALT⟫`), memory purge upon disposal, and SSE sliding buffer stream reconstruction.

---

## 🌟 What's New in v2.6.0

### 1. 💳 PCI-DSS Credit Card Redaction & Luhn Checksum Algorithm

Credit and debit cards are replaced with `⟪AG:CARD:INDEX:SALT⟫`. To eliminate false positives, every candidate PAN undergoes the arithmetical Luhn algorithm (Modulo 10):

```typescript
import { InFlightRedactionSession, validateLuhnChecksum } from "avantgate";

// Exported standalone arithmetic validator
const isValid = validateLuhnChecksum("4532 0151 1283 0366"); // true
const isFake = validateLuhnChecksum("4532 0151 1283 0367");  // false

const session = new InFlightRedactionSession();
const masked = session.mask("Paiement par Visa 4532 0151 1283 0366");
// => "Paiement par Visa ⟪AG:CARD:1:a8f2⟫"

// Numbers failing the Luhn test are NOT masked:
const untampered = session.mask("Commande #4532 0151 1283 0367");
// => "Commande #4532 0151 1283 0367"
```

### 2. 🌐 IPv4 & CIDR Subnet Protection with Anti-Versioning Guards

Network topology leaks are prevented while ensuring that developer prompts discussing software releases and semantic versions are never corrupted:

```typescript
const prompt = "Serveur 192.168.1.1/24 configuré pour la version v2.4.1.0";
const masked = session.mask(prompt);
// => "Serveur ⟪AG:IP:1:a8f2⟫ configuré pour la version v2.4.1.0"
```

### 3. 📞 International Telephones (E.164) & US SSN

Global customer support prompts and multinational employee records are safeguarded seamlessly:

```typescript
const prompt = "Contact US: +1 (555) 234-5678, Londres: +44 20 7946 0958, SSN: 123-45-6789";
const masked = session.mask(prompt);
// => "Contact US: ⟪AG:PHONE:1:a8f2⟫, Londres: ⟪AG:PHONE:2:a8f2⟫, SSN: ⟪AG:SSN:1:a8f2⟫"

const restored = session.restore(masked);
// => 100% exact restitution of the original values!
```

---

## ⚡ Performance & Benchmarks

Validated on multi-thousand-word prompts containing dense financial, network, and personal PII:
- **Ingress Masking Latency**: **~0.74 ms** on 2,700 words (Budget: < 2.0 ms)
- **Egress Restoration Latency**: **~0.10 ms** on 2,700 words (Budget: < 1.0 ms)
- **Zero-Dependency Guarantee**: Pure TypeScript, zero external npm packages, Node 18+ / Bun / Deno / Cloudflare Workers compatible.

---

## 🧪 Verification & Test Suite

- `npm run test:redactor`: 100% pass across 8 comprehensive suites (Luhn arithmetic, Ingress masking, Egress JSON, Streaming SSE, Zero-Retention, Multi-PII, Extended PCI/IP/Phone/SSN, Performance benchmark).
- `npm test`: 100% pass across all avantGate modules (agent, workflow, finops, client, ui, middleware).
- `npm run lint`: 0 TypeScript errors.
- `npm run build`: ESM, CJS, and TypeScript `.d.ts` bundles built cleanly.
