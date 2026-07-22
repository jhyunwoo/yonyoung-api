import { describe, expect, it } from "vitest";
import { createR2PresignService } from "../lib/storage/presign";

describe("multipart presigned URL checksum policy", () => {
  it("자동 CRC 파라미터 없이 Content-Length를 서명한다", async () => {
    const service = createR2PresignService({
      R2_S3_ENDPOINT: "https://example-account.r2.cloudflarestorage.com",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "yonyoung-storage",
      R2_PUBLIC_URL_SIGNING_SECRET:
        "test-public-url-signing-secret-at-least-32-chars",
      BETTER_AUTH_URL: "https://app.example.com",
      BETTER_AUTH_SECRET: "test-better-auth-secret-with-at-least-32-chars",
    } as never);

    const contentLength = 8 * 1024 * 1024;
    const result = await service.issueMultipartUploadPartUrl({
      uploadId: "upload-1",
      objectKey: "activities/user-1/detail/example.png",
      partNumber: 1,
      contentLength,
    });
    const uploadUrl = new URL(result.uploadUrl);

    expect(uploadUrl.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(uploadUrl.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(
      false,
    );
    expect(uploadUrl.searchParams.get("X-Amz-SignedHeaders"))
      .toBe("content-length;host");
    expect(result.requiredHeaders).toEqual({
      "Content-Length": String(contentLength),
    });
  });
});
