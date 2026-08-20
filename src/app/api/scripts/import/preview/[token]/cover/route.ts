import { readImportPreviewCover } from "../../../../../../../server/script-import";
import { errorResponse } from "../../../../../h";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await context.params;
    const cover = readImportPreviewCover(token);
    return new Response(Uint8Array.from(cover.data), {
      headers: {
        "cache-control": "private, no-store",
        "content-type": cover.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
