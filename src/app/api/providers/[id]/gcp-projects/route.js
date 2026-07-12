import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { refreshOAuthToken } from "../test/testUtils.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection.provider !== "gemini-cli" && connection.provider !== "antigravity") {
      return NextResponse.json({ error: "Provider not supported for GCP projects" }, { status: 400 });
    }

    // Refresh token if expired
    let accessToken = connection.accessToken;
    const isExpired = connection.expiresAt ? new Date(connection.expiresAt).getTime() < Date.now() : true;
    
    if (isExpired && connection.refreshToken) {
      const refreshed = await refreshOAuthToken(connection);
      if (refreshed?.accessToken) {
        accessToken = refreshed.accessToken;
      }
    }

    if (!accessToken) {
      return NextResponse.json({ error: "No valid access token available" }, { status: 401 });
    }

    const effectiveProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    const res = await proxyAwareFetch("https://cloudresourcemanager.googleapis.com/v1/projects", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }, effectiveProxy);

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return NextResponse.json({ error: `Google API error: ${res.status} - ${bodyText}` }, { status: res.status });
    }

    const data = await res.json();
    const projects = (data.projects || []).map((p) => ({
      id: p.projectId,
      name: p.name,
    }));

    return NextResponse.json({ projects });
  } catch (error) {
    console.error("Error fetching GCP projects:", error);
    return NextResponse.json({ error: "Failed to fetch GCP projects" }, { status: 500 });
  }
}
