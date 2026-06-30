import fs from 'fs';
import path from 'path';

const projectRoot = '/media/DiskE/Code/9router-new';
const extractPath = path.join(projectRoot, '.understand-anything/tmp/ua-file-extract-results-2.json');
const inputPath = path.join(projectRoot, '.understand-anything/tmp/ua-file-analyzer-input-2.json');
const outDir = path.join(projectRoot, '.understand-anything/intermediate');

const extract = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const batchImportData = input.batchImportData;
const neighborMap = input.neighborMap || {};

const batchIndex = 2;

function fileName(p) {
  return p.split('/').pop();
}

function complexityFor(nonEmptyLines, functionCount, classCount) {
  if (nonEmptyLines > 250 || functionCount > 15 || classCount > 2) return 'complex';
  if (nonEmptyLines >= 50 || functionCount >= 3 || classCount >= 1) return 'moderate';
  return 'simple';
}

function isTestFile(p) {
  return p.includes('.test.') || p.includes('.spec.') || p.startsWith('tests/');
}

function functionSummary(name, filePath) {
  const verbs = [
    { prefix: 'handle', text: 'Handles' },
    { prefix: 'build', text: 'Builds' },
    { prefix: 'extract', text: 'Extracts' },
    { prefix: 'convert', text: 'Converts' },
    { prefix: 'translate', text: 'Translates' },
    { prefix: 'parse', text: 'Parses' },
    { prefix: 'normalize', text: 'Normalizes' },
    { prefix: 'create', text: 'Creates' },
    { prefix: 'get', text: 'Retrieves' },
    { prefix: 'is', text: 'Checks whether' },
    { prefix: 'filter', text: 'Filters' },
    { prefix: 'format', text: 'Formats' },
    { prefix: 'estimate', text: 'Estimates' },
    { prefix: 'save', text: 'Persists' },
    { prefix: 'apply', text: 'Applies' },
    { prefix: 'detect', text: 'Detects' },
    { prefix: 'record', text: 'Records' },
    { prefix: 'resolve', text: 'Resolves' },
    { prefix: 'transcribe', text: 'Transcribes' },
    { prefix: 'process', text: 'Processes' },
    { prefix: 'generate', text: 'Generates' },
    { prefix: 'ensure', text: 'Ensures' },
    { prefix: 'reset', text: 'Resets' },
    { prefix: 'clear', text: 'Clears' },
    { prefix: 'mark', text: 'Marks' },
    { prefix: 'acquire', text: 'Acquires' },
    { prefix: 'drain', text: 'Drains' },
    { prefix: 'rotate', text: 'Rotates' },
    { prefix: 'reorder', text: 'Reorders' },
    { prefix: 'pick', text: 'Picks' },
    { prefix: 'pick', text: 'Selects' },
    { prefix: 'textFrom', text: 'Extracts text from' },
    { prefix: 'retryAfter', text: 'Calculates retry-after' },
    { prefix: 'bodyTo', text: 'Converts body to' },
    { prefix: 'looksLike', text: 'Checks whether input looks like' },
    { prefix: 'classify', text: 'Classifies' },
    { prefix: 'retryAfter', text: 'Extracts retry-after' },
    { prefix: 'unavailable', text: 'Builds unavailable' },
    { prefix: 'withSelected', text: 'Decorates with selected' },
    { prefix: 'has', text: 'Checks whether' },
    { prefix: 'split', text: 'Splits' },
    { prefix: 'emit', text: 'Emits' },
    { prefix: 'fix', text: 'Fixes' },
    { prefix: 'clean', text: 'Cleans' },
    { prefix: 'log', text: 'Logs' },
    { prefix: 'add', text: 'Adds' },
  ];
  const base = name.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  for (const v of verbs) {
    if (name.startsWith(v.prefix)) {
      let rest = base.slice(v.prefix.length).trim();
      if (!rest) rest = 'data';
      return `${v.text} ${rest} in ${fileName(filePath)}.`;
    }
  }
  return `${base} in ${fileName(filePath)}.`;
}

function functionTags(name, filePath, isExported) {
  const tags = [];
  if (isTestFile(filePath)) tags.push('test-helper', 'unit-test');
  else if (filePath.includes('/handlers/') || name.startsWith('handle')) tags.push('api-handler', 'sse');
  else if (filePath.includes('/services/')) tags.push('service');
  else if (filePath.includes('/utils/') || filePath.includes('/transformer/') || filePath.includes('/config/')) tags.push('utility');
  else tags.push('utility');
  if (name.startsWith('handle')) tags.push('request-handler');
  if (name.startsWith('build') || name.startsWith('create')) tags.push('factory');
  if (name.startsWith('is') || name.startsWith('has') || name.startsWith('looksLike')) tags.push('validation');
  if (name.startsWith('parse') || name.startsWith('extract')) tags.push('parser');
  if (isExported && !tags.includes('exported')) tags.push('exported');
  // Ensure 3-5 tags
  const unique = [...new Set(tags)];
  if (unique.length < 3) {
    if (!unique.includes('javascript')) unique.push('javascript');
    if (unique.length < 3) unique.push('function');
  }
  return unique.slice(0, 5);
}

function isSignificantFunction(fn, isExported) {
  const lines = fn.endLine - fn.startLine + 1;
  if (isExported) return true;
  return lines >= 10;
}

function isSignificantClass(cls) {
  const lines = cls.endLine - cls.startLine + 1;
  return (cls.methods && cls.methods.length >= 2) || lines >= 20;
}

const fileNodes = [];
const functionNodes = [];
const classNodes = [];
const edges = [];
const edgeKeys = new Set();
const nodeIds = new Set();

function addNode(node) {
  if (nodeIds.has(node.id)) return;
  nodeIds.add(node.id);
  if (node.type === 'function') functionNodes.push(node);
  else if (node.type === 'class') classNodes.push(node);
  else fileNodes.push(node);
}

function addEdge(edge) {
  if (edge.source === edge.target) return;
  const key = `${edge.source}|${edge.target}|${edge.type}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push(edge);
}

const filePathToNodeId = {};

// Build file nodes
for (const f of input.batchFiles) {
  const res = extract.results.find(r => r.path === f.path);
  const nonEmpty = res ? res.nonEmptyLines : f.sizeLines;
  const fnCount = res && res.metrics ? res.metrics.functionCount : 0;
  const clsCount = res && res.metrics ? res.metrics.classCount : 0;
  const comp = complexityFor(nonEmpty, fnCount, clsCount);

  let type = 'file';
  const cat = f.fileCategory;
  if (cat === 'config') type = 'config';
  else if (cat === 'docs') type = 'document';
  else if (cat === 'data') type = 'schema';
  else if (cat === 'infra') type = 'service';
  else if (cat === 'script' || cat === 'markup' || cat === 'code') type = 'file';

  const id = `${type}:${f.path}`;
  filePathToNodeId[f.path] = id;

  let summary, tags;
  if (f.path === 'open-sse/config/errorConfig.js') {
    summary = 'Central error configuration defining error types, default messages, backoff rules, and cooldown constants used across the SSE engine.';
    tags = ['configuration', 'error-handling', 'constants'];
  } else if (f.path === 'open-sse/handlers/chatCore/nonStreamingHandler.js') {
    summary = 'Handles non-streaming chat responses by translating provider responses into OpenAI-compatible format and logging request details.';
    tags = ['api-handler', 'response-translation', 'request-logging'];
  } else if (f.path === 'open-sse/handlers/chatCore/requestDetail.js') {
    summary = 'Extracts request configuration and usage statistics from chat requests and saves them for analytics.';
    tags = ['utility', 'analytics', 'request-logging'];
  } else if (f.path === 'open-sse/handlers/chatCore/sseToJsonHandler.js') {
    summary = 'Parses Server-Sent Event streams into JSON responses and handles forced SSE-to-JSON conversion for providers that emit streaming data.';
    tags = ['api-handler', 'sse-parser', 'streaming'];
  } else if (f.path === 'open-sse/handlers/chatCore/streamingHandler.js') {
    summary = 'Manages streaming chat responses including stream readiness checks, transform stream construction, and completion callbacks.';
    tags = ['api-handler', 'streaming', 'transform-stream'];
  } else if (f.path === 'open-sse/handlers/responsesHandler.js') {
    summary = 'Adapts OpenAI Responses API requests into the core chat handler and converts streaming or non-streaming output back to responses format.';
    tags = ['api-handler', 'responses-api', 'adapter'];
  } else if (f.path === 'open-sse/handlers/sttCore.js') {
    summary = 'Core handler for speech-to-text requests, dispatching audio files to Deepgram, AssemblyAI, Nvidia, Gemini, HuggingFace, or OpenAI-compatible providers.';
    tags = ['api-handler', 'speech-to-text', 'provider-dispatch'];
  } else if (f.path === 'open-sse/services/accountFallback.js') {
    summary = 'Implements account fallback logic including quota exhaustion detection, provider cooldown management, and circuit-breaker integration.';
    tags = ['service', 'resilience', 'fallback'];
  } else if (f.path === 'open-sse/services/accountSemaphore.js') {
    summary = 'Provides account-level concurrency semaphore with capacity errors, queue draining, and runtime statistics.';
    tags = ['service', 'concurrency', 'semaphore'];
  } else if (f.path === 'open-sse/services/combo.js') {
    summary = 'Implements combo model strategies including fallback, round-robin rotation, and fusion with judge-based answer synthesis.';
    tags = ['service', 'combo-strategy', 'model-fusion'];
  } else if (f.path === 'open-sse/transformer/streamToJsonConverter.js') {
    summary = 'Converts OpenAI Responses API event streams into JSON output objects by processing SSE messages.';
    tags = ['utility', 'stream-converter', 'responses-api'];
  } else if (f.path === 'open-sse/utils/circuitBreaker.js') {
    summary = 'Circuit breaker implementation with per-provider registry, exponential backoff, and status reporting.';
    tags = ['utility', 'circuit-breaker', 'resilience'];
  } else if (f.path === 'open-sse/utils/classify429.js') {
    summary = 'Classifies HTTP 429 responses to distinguish daily quota, quota exhausted, and retry-after conditions.';
    tags = ['utility', 'rate-limit', 'error-classification'];
  } else if (f.path === 'open-sse/utils/error.js') {
    summary = 'Error formatting utilities building OpenAI-style error bodies, stream error writes, and provider-specific error messages.';
    tags = ['utility', 'error-handling', 'serialization'];
  } else if (f.path === 'open-sse/utils/kimiToolParser.js') {
    summary = 'Parses and normalizes Kimi-style tool-call markup embedded in assistant message content.';
    tags = ['utility', 'tool-call', 'parser'];
  } else if (f.path === 'open-sse/utils/responsesStreamHelpers.js') {
    summary = 'Helpers for OpenAI Responses API streaming events including terminal event detection and abort formatting.';
    tags = ['utility', 'responses-api', 'streaming'];
  } else if (f.path === 'open-sse/utils/stream.js') {
    summary = 'Core SSE stream creation and transformation utilities handling tool calls, usage estimation, and format translation.';
    tags = ['utility', 'sse', 'streaming'];
  } else if (f.path === 'open-sse/utils/streamHandler.js') {
    summary = 'Provides stream controllers, disconnect-aware streams, and piping with stall detection for provider responses.';
    tags = ['utility', 'stream-controller', 'disconnect-handling'];
  } else if (f.path === 'open-sse/utils/streamHelpers.js') {
    summary = 'Low-level SSE helpers for parsing lines, validating content, fixing IDs, and formatting SSE payloads.';
    tags = ['utility', 'sse', 'formatting'];
  } else if (f.path === 'open-sse/utils/usageTracking.js') {
    summary = 'Tracks token usage across formats by normalizing, estimating, filtering, and logging usage payloads.';
    tags = ['utility', 'usage-tracking', 'token-estimation'];
  } else if (f.path === 'src/lib/network/connectionProxy.js') {
    summary = 'Resolves proxy configuration for network connections and computes a deterministic proxy hash.';
    tags = ['utility', 'proxy', 'networking'];
  } else if (isTestFile(f.path)) {
    summary = `Unit tests for ${fileName(f.path).replace(/\.(test|spec)\.[a-z]+$/, '')} functionality.`;
    tags = ['test', 'unit-test', 'vitest'];
  } else {
    summary = `JavaScript module ${fileName(f.path)} in the 9router SSE engine.`;
    tags = ['utility'];
  }

  addNode({
    id,
    type,
    name: fileName(f.path),
    filePath: f.path,
    summary,
    tags: tags.length >= 3 ? tags : [...tags, 'javascript'],
    complexity: comp
  });
}

// Build function and class nodes, and contains/exports edges
for (const f of input.batchFiles) {
  const res = extract.results.find(r => r.path === f.path);
  if (!res) continue;
  const fileNodeId = filePathToNodeId[f.path];
  const exportedNames = new Set((res.exports || []).map(e => e.name));

  for (const fn of res.functions || []) {
    const isExported = exportedNames.has(fn.name);
    if (!isSignificantFunction(fn, isExported)) continue;
    const nodeId = `function:${f.path}:${fn.name}`;
    addNode({
      id: nodeId,
      type: 'function',
      name: fn.name,
      filePath: f.path,
      lineRange: [fn.startLine, fn.endLine],
      summary: functionSummary(fn.name, f.path),
      tags: functionTags(fn.name, f.path, isExported),
      complexity: (fn.endLine - fn.startLine + 1) > 80 ? 'complex' : ((fn.endLine - fn.startLine + 1) >= 30 ? 'moderate' : 'simple')
    });
    addEdge({ source: fileNodeId, target: nodeId, type: 'contains', direction: 'forward', weight: 1.0 });
    if (isExported) {
      addEdge({ source: fileNodeId, target: nodeId, type: 'exports', direction: 'forward', weight: 0.8 });
    }
  }

  for (const cls of res.classes || []) {
    if (!isSignificantClass(cls)) continue;
    const nodeId = `class:${f.path}:${cls.name}`;
    addNode({
      id: nodeId,
      type: 'class',
      name: cls.name,
      filePath: f.path,
      lineRange: [cls.startLine, cls.endLine],
      summary: `Class ${cls.name} with ${cls.methods ? cls.methods.length : 0} methods in ${fileName(f.path)}.`,
      tags: ['class', 'data-structure'],
      complexity: (cls.endLine - cls.startLine + 1) > 80 ? 'complex' : ((cls.endLine - cls.startLine + 1) >= 30 ? 'moderate' : 'simple')
    });
    addEdge({ source: fileNodeId, target: nodeId, type: 'contains', direction: 'forward', weight: 1.0 });
    if (exportedNames.has(cls.name)) {
      addEdge({ source: fileNodeId, target: nodeId, type: 'exports', direction: 'forward', weight: 0.8 });
    }
  }
}

// Import edges (1:1 from batchImportData)
for (const [filePath, imports] of Object.entries(batchImportData)) {
  const sourceId = filePathToNodeId[filePath];
  if (!sourceId) continue;
  for (const imp of imports) {
    const targetId = filePathToNodeId[imp] || `file:${imp}`;
    addEdge({ source: sourceId, target: targetId, type: 'imports', direction: 'forward', weight: 0.7 });
  }
}

// tested_by edges: test files test their imports
for (const f of input.batchFiles) {
  if (!isTestFile(f.path)) continue;
  const testNodeId = filePathToNodeId[f.path];
  const imports = batchImportData[f.path] || [];
  for (const imp of imports) {
    if (isTestFile(imp)) continue;
    const targetId = filePathToNodeId[imp] || `file:${imp}`;
    addEdge({ source: targetId, target: testNodeId, type: 'tested_by', direction: 'forward', weight: 0.5 });
  }
}

// calls edges based on callGraph and neighborMap
const nodeIdSet = new Set([...fileNodes, ...functionNodes, ...classNodes].map(n => n.id));

function resolveCalleeNode(calleeName, callerFile) {
  // Prefer same-file function node
  const sameFile = `function:${callerFile}:${calleeName}`;
  if (nodeIdSet.has(sameFile)) return sameFile;

  // Search neighborMap for symbol
  const neighbors = neighborMap[callerFile] || [];
  for (const nb of neighbors) {
    if (nb.symbols && nb.symbols.includes(calleeName)) {
      return `function:${nb.path}:${calleeName}`;
    }
  }

  // Search imports for matching function names
  const imports = batchImportData[callerFile] || [];
  for (const imp of imports) {
    const candidate = `function:${imp}:${calleeName}`;
    if (nodeIdSet.has(candidate)) return candidate;
  }

  return null;
}

for (const res of extract.results) {
  const callerFile = res.path;
  const callerFunctions = new Map();
  for (const fn of res.functions || []) {
    callerFunctions.set(fn.name, `function:${callerFile}:${fn.name}`);
  }

  for (const cg of res.callGraph || []) {
    const callerId = callerFunctions.get(cg.caller);
    if (!callerId || !nodeIdSet.has(callerId)) continue;
    const targetId = resolveCalleeNode(cg.callee, callerFile);
    if (targetId) {
      addEdge({ source: callerId, target: targetId, type: 'calls', direction: 'forward', weight: 0.8 });
    }
  }
}

const nodes = [...fileNodes, ...functionNodes, ...classNodes];

// Validate: all import targets that are in this batch must exist
for (const e of edges) {
  if (e.type === 'imports') {
    const targetPath = e.target.replace(/^file:/, '');
    if (filePathToNodeId[targetPath] && !nodeIdSet.has(e.target)) {
      // This shouldn't happen because we set targetId to filePathToNodeId when available
    }
  }
}

// Split into parts if needed
const nodeCount = nodes.length;
const edgeCount = edges.length;

const parts = Math.max(1, Math.ceil(Math.max(nodeCount / 60, edgeCount / 120)));

if (parts === 1) {
  const outPath = path.join(outDir, `batch-${batchIndex}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ nodes, edges }, null, 2));
  console.log(`Wrote 1 part: ${outPath} (${nodeCount} nodes, ${edgeCount} edges)`);
} else {
  // Sort files alphabetically
  const sortedFiles = input.batchFiles.map(f => f.path).sort();
  const chunkSize = Math.ceil(sortedFiles.length / parts);
  const fileGroups = [];
  for (let i = 0; i < sortedFiles.length; i += chunkSize) {
    fileGroups.push(new Set(sortedFiles.slice(i, i + chunkSize)));
  }

  for (let k = 0; k < fileGroups.length; k++) {
    const group = fileGroups[k];
    const partNodes = nodes.filter(n => group.has(n.filePath));
    const partNodeIds = new Set(partNodes.map(n => n.id));
    const partEdges = edges.filter(e => partNodeIds.has(e.source));
    const outPath = path.join(outDir, `batch-${batchIndex}-part-${k + 1}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ nodes: partNodes, edges: partEdges }, null, 2));
    console.log(`Wrote part ${k + 1}: ${outPath} (${partNodes.length} nodes, ${partEdges.length} edges)`);
  }
}

console.log(`TOTAL nodes=${nodeCount} edges=${edgeCount}`);
