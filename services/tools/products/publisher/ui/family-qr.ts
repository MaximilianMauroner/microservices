export const FAMILY_QR_PROJECT = "Family QR";
export const FAMILY_QR_FILENAME = "family-qr.html";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function familyQrFile(image: File): Promise<File> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP screenshot.");
  }
  if (!image.size || image.size > MAX_IMAGE_BYTES) {
    throw new Error("Choose a screenshot smaller than 4 MB.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result) : reject(new Error("The screenshot could not be read."));
    reader.onerror = () => reject(new Error("The screenshot could not be read."));
    reader.readAsDataURL(image);
  });
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new Error("The screenshot could not be read.");
  }
  const uploadedAt = new Date().toISOString();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="3">
<title>Family QR</title><style>
body{font:16px system-ui,sans-serif;margin:0;padding:24px;background:#fafafa;color:#181818;text-align:center}
main{max-width:640px;margin:auto}img{display:block;max-width:100%;height:auto;margin:24px auto;background:white}
p{line-height:1.5}time{font-variant-numeric:tabular-nums}
</style></head><body><main><h1>Family QR</h1>
<p>Scan this code with your phone. Open this page on a second screen.</p>
<p>Screenshot uploaded <time datetime="${uploadedAt}">${uploadedAt}</time>.</p>
<p>This is a screenshot. Spotify may have already expired this code. Ask the plan admin for a fresh upload if it fails.</p>
<img src="${dataUrl}" alt="Family verification QR screenshot">
<p>This page checks for a new upload every 3 seconds.</p>
</main></body></html>`;
  return new File([html], FAMILY_QR_FILENAME, { type: "text/html" });
}
