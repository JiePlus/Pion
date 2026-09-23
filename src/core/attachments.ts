import { host, native } from "./host.ts";
import { t } from "./i18n.ts";

export const imageLimits = { count: 5, each: 10 * 1024 * 1024, total: 25 * 1024 * 1024 };

export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  size: number;
  data: string;
}

const drafts = new Map<string, ImageAttachment[]>();

export function attachmentDraft(taskId: string): ImageAttachment[] {
  return drafts.get(taskId) ?? [];
}

export function setAttachmentDraft(taskId: string, attachments: ImageAttachment[]): void {
  if (attachments.length) drafts.set(taskId, attachments);
  else drafts.delete(taskId);
}

export function addAttachments(
  current: ImageAttachment[],
  incoming: ImageAttachment[],
): ImageAttachment[] {
  const next = [...current, ...incoming];
  if (next.length > imageLimits.count) throw new Error(`Maximum ${imageLimits.count} images`);
  if (next.some((image) => image.size > imageLimits.each))
    throw new Error("Each image must be 10 MB or smaller");
  if (next.reduce((total, image) => total + image.size, 0) > imageLimits.total)
    throw new Error("Images must be 25 MB or smaller in total");
  return next;
}

export function imageFailure(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : String(failure);
  const known = [
    "Maximum 5 images",
    "Each image must be 10 MB or smaller",
    "Images must be 25 MB or smaller in total",
  ] as const;
  const key = known.find((item) => message.endsWith(item));
  return key ? t(key) : message;
}

export async function importImageFiles(current: ImageAttachment[], files: File[]) {
  if (!native) throw new Error(t("Image attachments require the desktop app."));
  if (current.length + files.length > imageLimits.count) throw new Error(t("Maximum 5 images"));
  if (files.some((file) => file.size > imageLimits.each))
    throw new Error(t("Each image must be 10 MB or smaller"));
  if (
    current.reduce((total, image) => total + image.size, 0) +
      files.reduce((total, file) => total + file.size, 0) >
    imageLimits.total
  )
    throw new Error(t("Images must be 25 MB or smaller in total"));
  const allowed = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  if (files.some((file) => !allowed.has(file.type)))
    throw new Error(t("Choose PNG, JPEG, GIF, or WebP images."));
  const encoded = await new Promise<{ name: string; mimeType: string; data: string }[]>(
    (resolve, reject) => {
      const result: { name: string; mimeType: string; data: string }[] = [];
      function readNext(index: number) {
        if (index >= files.length) {
          resolve(result);
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error("Cannot read image"));
        reader.onload = () => {
          result.push({
            name: files[index].name,
            mimeType: files[index].type,
            data: String(reader.result).split(",", 2)[1] ?? "",
          });
          readNext(index + 1);
        };
        reader.readAsDataURL(files[index]);
      }
      readNext(0);
    },
  );
  const result = await host<{ images: ImageAttachment[] }>({ op: "image.import", images: encoded });
  return addAttachments(current, result.images);
}

export async function pickImages(current: ImageAttachment[]) {
  if (!native) throw new Error(t("Image attachments require the desktop app."));
  const result = await host<{ images: ImageAttachment[] }>({ op: "image.pick" });
  return addAttachments(current, result.images);
}
