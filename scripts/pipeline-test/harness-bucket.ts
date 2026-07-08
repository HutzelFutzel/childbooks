/* eslint-disable no-console */
import { ensureAdmin, downloadPublicBase64, storageBucketName } from "../../functions/src/storage";

const PATH = "public/artStyles/watercolor/example-2a954c05-e0aa-4554-a9cd-c4ea325b0c2b.png";

async function main() {
  ensureAdmin();
  console.log("resolved storageBucketName():", storageBucketName());
  console.log("blob was uploaded to bucket: childbook-60f89.appspot.com (per export metadata)");
  const t0 = Date.now();
  try {
    const d = await downloadPublicBase64(PATH);
    console.log(`[OK] downloadPublicBase64 succeeded: ${Buffer.from(d.base64, "base64").length} bytes in ${Date.now() - t0}ms`);
  } catch (err) {
    console.log(`[THROWS] downloadPublicBase64 failed in ${Date.now() - t0}ms: ${(err as Error).message}`);
    console.log("  => primary path broken; style only works via imageUrl fallback (fragile).");
  }
  process.exit(0);
}
main();
