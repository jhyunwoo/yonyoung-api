import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createMaxBodySizeMiddleware } from "../app/middleware/body-size";
import { errorHandler } from "../app/middleware/errorHandler";
import type HonoAppType from "../types/honoAppType";

const MAX_BYTES = 8;

const createStreamingRequest = (
  path: string,
  body: string,
  contentLength?: string,
): Request => {
  const bytes = new TextEncoder().encode(body);
  const midpoint = Math.max(1, Math.floor(bytes.byteLength / 2));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, midpoint));
      controller.enqueue(bytes.subarray(midpoint));
      controller.close();
    },
  });
  const headers = new Headers({ "content-type": "text/plain" });
  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }

  return new Request(`https://api.example.com${path}`, {
    method: "POST",
    body: stream,
    headers,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
};

const createBodyTestApp = () => {
  const app = new Hono<HonoAppType>();
  app.use("*", createMaxBodySizeMiddleware(MAX_BYTES));
  app.post("/hono", async (c) => c.text(await c.req.text()));
  app.post("/raw", async (c) => c.text(await c.req.raw.text()));
  app.onError(errorHandler);
  return app;
};

const expectPayloadTooLarge = async (response: Response) => {
  expect(response.status).toBe(413);
  const body = (await response.json()) as { error: { code: string } };
  expect(body.error.code).toBe("BAD_REQUEST");
};

describe("max body size middleware", () => {
  it("Content-Length가 없어도 실제 스트림이 한도를 넘으면 413을 반환한다", async () => {
    const app = createBodyTestApp();
    const request = createStreamingRequest("/hono", "123456789");

    expect(request.headers.has("content-length")).toBe(false);
    await expectPayloadTooLarge(await app.request(request));
  });

  it("Content-Length가 축소 신고되어도 실제 스트림이 한도를 넘으면 413을 반환한다", async () => {
    const app = createBodyTestApp();
    const request = createStreamingRequest("/hono", "123456789", "1");

    expect(request.headers.get("content-length")).toBe("1");
    await expectPayloadTooLarge(await app.request(request));
  });

  it("허용된 스트림은 Hono 본문 helper에서 그대로 소비할 수 있다", async () => {
    const app = createBodyTestApp();
    const request = createStreamingRequest("/hono", "12345678");

    const response = await app.request(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345678");
  });

  it("허용된 스트림은 원본 Request에서도 그대로 소비할 수 있다", async () => {
    const app = createBodyTestApp();
    const request = createStreamingRequest("/raw", "12345678", "1");

    const response = await app.request(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("12345678");
  });
});
