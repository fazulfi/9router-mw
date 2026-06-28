#!/usr/bin/env node
// Default VansRoute app port to 20128 when PORT env is not set.
// The standalone Next.js server otherwise falls back to 3000.
process.env.PORT ||= '20128';
require('./.next/standalone/server.js');
