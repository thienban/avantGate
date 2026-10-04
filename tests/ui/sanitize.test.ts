import assert from "node:assert";
import { isValidSafeUrl } from "../../src/ui/react";

console.log("🧪 Testing avantgate/ui/react: URL Sanitizer & Anti-XSS Guard...");

const testLegitimateUrls = (): void => {
  assert.strictEqual(isValidSafeUrl("https://prospectai.io"), true);
  assert.strictEqual(isValidSafeUrl("http://localhost:3000/dashboard"), true);
  assert.strictEqual(isValidSafeUrl("https://api.domain.com/v1/resource?id=12#step"), true);
  assert.strictEqual(isValidSafeUrl("/crm/prospects/42"), true);
  assert.strictEqual(isValidSafeUrl("#details"), true);
  assert.strictEqual(isValidSafeUrl("/#top"), true);

  console.log("  ✅ Legitimate URLs and anchors accepted.");
};

const testDangerousProtocols = (): void => {
  assert.strictEqual(isValidSafeUrl("javascript:alert('pwned')"), false);
  assert.strictEqual(isValidSafeUrl("JAVASCRIPT:void(0)"), false);
  assert.strictEqual(isValidSafeUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="), false);
  assert.strictEqual(isValidSafeUrl("vbscript:msgbox(1)"), false);
  assert.strictEqual(isValidSafeUrl("file:///etc/passwd"), false);
  assert.strictEqual(isValidSafeUrl("ftp://files.example.com"), false);

  console.log("  ✅ Hostile URI schemes strictly blocked.");
};

const testProtocolRelativeBypass = (): void => {
  // Protocol-relative URLs (//evil.com) would inherit https:// and redirect externally
  assert.strictEqual(isValidSafeUrl("//phishing.attacker.com/login"), false);
  assert.strictEqual(isValidSafeUrl("//google.com"), false);
  assert.strictEqual(isValidSafeUrl("///malware.org"), false);

  console.log("  ✅ Protocol-relative URL bypass (//evil.com) neutralized.");
};

const testInvalidAndMalformedInputs = (): void => {
  assert.strictEqual(isValidSafeUrl(null), false);
  assert.strictEqual(isValidSafeUrl(undefined), false);
  assert.strictEqual(isValidSafeUrl(""), false);
  assert.strictEqual(isValidSafeUrl("   "), false);
  assert.strictEqual(isValidSafeUrl("not a url at all ://"), false);
  assert.strictEqual(isValidSafeUrl(123 as any), false);

  console.log("  ✅ Malformed and falsy inputs rejected safely.");
};

const runAll = (): void => {
  testLegitimateUrls();
  testDangerousProtocols();
  testProtocolRelativeBypass();
  testInvalidAndMalformedInputs();
  console.log("🎉 All Sanitizer tests passed successfully!\n");
};

runAll();
