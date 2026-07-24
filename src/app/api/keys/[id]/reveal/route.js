import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { revealApiKey } from "@/lib/localDb";

// POST /api/keys/[id]/reveal - Reveal plaintext key (dashboard auth required)
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    // Check dashboard auth session
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const key = await revealApiKey(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ key: key.key });
  } catch (error) {
    console.log("Error revealing key:", error);
    return NextResponse.json({ error: "Failed to reveal key" }, { status: 500 });
  }
}
