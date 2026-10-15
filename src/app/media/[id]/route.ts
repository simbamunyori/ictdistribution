import { serveMedia } from "./serve";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveMedia((await params).id, false);
}
