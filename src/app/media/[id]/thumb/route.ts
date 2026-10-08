import { serveMedia } from "../serve";

/** The small copy of an image, for product cards. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveMedia((await params).id, true);
}
