export const MAX_PROBLEM_IMAGE_BYTES = 12 * 1024 * 1024;

export const SUPPORTED_PROBLEM_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const;

type ProblemImageFileMetadata = Pick<Blob, "size" | "type">;
type DataUrlReader = (file: File) => Promise<string>;

export function problemImageFileError(file: ProblemImageFileMetadata): string | null {
  if (!(SUPPORTED_PROBLEM_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "仅支持 PNG、JPEG 或 WebP 格式的题目图片。";
  }
  if (file.size > MAX_PROBLEM_IMAGE_BYTES) {
    return "图片太大，请压缩到 12MB 以内。";
  }
  return null;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function readProblemImageAsDataUrl(
  file: File,
  reader: DataUrlReader = readFileAsDataUrl
) {
  const validationError = problemImageFileError(file);
  if (validationError) throw new Error(validationError);
  return reader(file);
}
