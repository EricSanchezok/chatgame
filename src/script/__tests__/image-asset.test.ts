import { describe, expect, it } from "vitest";
import { inspectImageAsset } from "../image-asset";

function chunk(kind: string, data: Buffer): Buffer {
  const value = Buffer.alloc(12 + data.length);
  value.writeUInt32BE(data.length, 0);
  value.write(kind, 4, "ascii");
  data.copy(value, 8);
  return value;
}

function png(width: number, height: number, animated = false): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...(animated ? [chunk("acTL", Buffer.alloc(8))] : []),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("world image assets", () => {
  it("accepts a bounded static PNG identity", () => {
    expect(inspectImageAsset(png(640, 360))).toMatchObject({
      mime: "image/png",
      width: 640,
      height: 360,
      hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  });

  it("rejects animated PNG and oversized dimensions", () => {
    expect(() => inspectImageAsset(png(640, 360, true))).toThrow("animated PNG");
    expect(() => inspectImageAsset(png(4097, 360))).toThrow("image dimensions");
  });
});
