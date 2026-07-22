// This API route is called automatically to initialize app
import "@/shared/services/bootstrap";

export async function GET() {
  return new Response("Initialized", { status: 200 });
}
