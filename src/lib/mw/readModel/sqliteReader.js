const PROVIDER_SUMMARY_SQL = `
  SELECT provider,
         COUNT(*) AS connection_count,
         SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) AS enabled_count,
         MAX(strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt)) AS last_used_at
  FROM providerConnections
  GROUP BY provider
  ORDER BY provider ASC
  LIMIT 50
`;

export async function readProviderSummary(adapter) {
  if (adapter?.readOnly !== true) {
    throw new Error("SQLite adapter must be read-only");
  }

  const rows = adapter.prepare(PROVIDER_SUMMARY_SQL).all();
  return rows.map(({ provider, connection_count, enabled_count, last_used_at }) => ({
    provider,
    connectionCount: connection_count,
    enabledCount: enabled_count,
    lastUsedAt: last_used_at,
  }));
}
