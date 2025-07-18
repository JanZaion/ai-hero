import {
  checkRateLimit,
  recordRateLimit,
  type RateLimitConfig,
} from "./src/server/rate-limit";

async function testRateLimit() {
  console.log("Testing rate limiting functionality...\n");

  // Test configuration: 1 request per 5 seconds
  const config: RateLimitConfig = {
    maxRequests: 1,
    maxRetries: 3,
    windowMs: 5_000, // 5 seconds
    keyPrefix: "test",
  };

  console.log("Rate limit config:", config);
  console.log("Testing with 1 request per 5 seconds window\n");

  // Test 1: First request should be allowed
  console.log("=== Test 1: First request ===");
  const result1 = await checkRateLimit(config);
  console.log("Allowed:", result1.allowed);
  console.log("Remaining:", result1.remaining);
  console.log("Total hits:", result1.totalHits);
  console.log("Reset time:", new Date(result1.resetTime).toLocaleString());

  if (result1.allowed) {
    await recordRateLimit(config);
    console.log("✅ First request recorded successfully\n");
  } else {
    console.log("❌ First request should have been allowed\n");
    return;
  }

  // Test 2: Second request should be blocked
  console.log("=== Test 2: Second request (should be blocked) ===");
  const result2 = await checkRateLimit(config);
  console.log("Allowed:", result2.allowed);
  console.log("Remaining:", result2.remaining);
  console.log("Total hits:", result2.totalHits);

  if (!result2.allowed) {
    console.log("✅ Second request correctly blocked");
    console.log("Waiting for rate limit to reset...\n");

    // Test 3: Wait for reset and retry
    console.log("=== Test 3: Retry after waiting ===");
    const retryResult = await result2.retry();
    console.log("Retry successful:", retryResult);

    if (retryResult) {
      await recordRateLimit(config);
      console.log("✅ Retry request recorded successfully");
    } else {
      console.log("❌ Retry failed");
    }
  } else {
    console.log("❌ Second request should have been blocked\n");
  }

  console.log("\n=== Rate limit test completed ===");
}

// Run the test
testRateLimit().catch(console.error);
