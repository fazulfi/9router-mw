import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys (no plaintext key returned)
export async function GET() {
  try {
    const keys = await getApiKeys();
    const sanitized = keys.map(k => ({
      id: k.id,
      key: null,
      keyPrefix: k.keyPrefix,
      name: k.name,
      machineId: k.machineId,
      isActive: k.isActive,
      scope: k.scope,
      createdAt: k.createdAt,
      keyVersion: k.keyVersion,
    }));
    return NextResponse.json({ keys: sanitized });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key (returns plaintext key once)
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, scope } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, scope);

    return NextResponse.json({
      key: apiKey.key,
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      name: apiKey.name,
      machineId: apiKey.machineId,
      isActive: apiKey.isActive,
      scope: apiKey.scope,
      keyVersion: apiKey.keyVersion,
      createdAt: apiKey.createdAt,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
