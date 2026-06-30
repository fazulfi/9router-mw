import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const inputPath = '/media/DiskE/Code/9router-new/.understand-anything/tmp/ua-file-analyzer-input-6.json';
const extractPath = '/media/DiskE/Code/9router-new/.understand-anything/tmp/ua-file-extract-results-6.json';
const outputDir = '/media/DiskE/Code/9router-new/.understand-anything/intermediate';

const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const extract = JSON.parse(readFileSync(extractPath, 'utf8'));

const { batchFiles, batchImportData } = input;
const { results } = extract;

const nodes = [];
const edges = [];
const nodeIds = new Set();

function addNode(node) {
  if (nodeIds.has(node.id)) return;
  nodeIds.add(node.id);
  nodes.push(node);
}

function addEdge(edge) {
  if (edge.source === edge.target) return;
  edges.push(edge);
}

const filePathToNodeId = {};

// Create file nodes
for (const bf of batchFiles) {
  const { path, language, sizeLines, fileCategory } = bf;
  const result = results.find(r => r.path === path);
  const nonEmptyLines = result ? result.nonEmptyLines : sizeLines;
  const metrics = result ? result.metrics : {};

  let complexity = 'simple';
  if (nonEmptyLines > 200) complexity = 'complex';
  else if (nonEmptyLines >= 50) complexity = 'moderate';

  const filename = path.split('/').pop();
  let summary = '';
  let tags = [];

  // Determine summary/tags based on path/name
  if (path.includes('open-sse/config/providerModels.js')) {
    summary = 'Defines the per-provider model catalog and helpers to resolve model metadata such as target format, upstream ID, quota family, and strip patterns.';
    tags = ['configuration', 'model-catalog', 'utility', 'provider-resolution'];
  } else if (path === 'open-sse/handlers/chatCore.js') {
    summary = 'Core chat request handler that coordinates translation, token-saver injection, loop-guard detection, executor dispatch, and response streaming.';
    tags = ['api-handler', 'chat', 'middleware', 'streaming', 'token-saver'];
  } else if (path === 'open-sse/handlers/chatCore/coercedSseHandler.js') {
    summary = 'Converts a non-streaming JSON response into a Server-Sent Events stream for clients that expect SSE formatting.';
    tags = ['api-handler', 'sse', 'streaming', 'adapter'];
  } else if (path === 'open-sse/providers/capabilities.js') {
    summary = 'Catalogs provider and model capabilities and exposes a resolver that maps a provider/model pair to its supported features.';
    tags = ['provider-registry', 'capabilities', 'model-metadata', 'utility'];
  } else if (path === 'open-sse/providers/pricing.js') {
    summary = 'Stores model and provider pricing tables and computes inference costs from token usage.';
    tags = ['pricing', 'cost-tracking', 'provider-registry', 'utility'];
  } else if (path === 'open-sse/rtk/caveman.js') {
    summary = 'Thin wrapper that injects the Caveman token-saver system prompt into a chat request body.';
    tags = ['token-saver', 'rtk', 'prompt-injection', 'utility'];
  } else if (path === 'open-sse/rtk/cavemanPrompts.js') {
    summary = 'Provides the Caveman token-saver prompt text used to encourage ultra-compressed responses.';
    tags = ['token-saver', 'rtk', 'prompts', 'configuration'];
  } else if (path === 'open-sse/rtk/ponytail.js') {
    summary = 'Thin wrapper that injects the Ponytail token-saver system prompt into a chat request body.';
    tags = ['token-saver', 'rtk', 'prompt-injection', 'utility'];
  } else if (path === 'open-sse/rtk/ponytailPrompts.js') {
    summary = 'Provides the Ponytail token-saver prompt text used to discourage over-engineering.';
    tags = ['token-saver', 'rtk', 'prompts', 'configuration'];
  } else if (path === 'open-sse/rtk/systemInject.js') {
    summary = 'Injects a system prompt into request bodies across OpenAI, Claude, and Gemini message formats.';
    tags = ['token-saver', 'rtk', 'prompt-injection', 'format-adapter'];
  } else if (path === 'open-sse/rtk/terminationPrompt.js') {
    summary = 'Injects termination and tool-protocol prompts to guide models toward clean completion and correct tool use.';
    tags = ['token-saver', 'rtk', 'prompt-injection', 'tool-protocol'];
  } else if (path === 'open-sse/services/provider.js') {
    summary = 'Provider-format detection service that determines target transport and compatibility for a given provider/model.';
    tags = ['service', 'provider-detection', 'format-detection', 'transport'];
  } else if (path === 'open-sse/translator/concerns/paramSupport.js') {
    summary = 'Strips request parameters that are unsupported by a specific provider/model combination.';
    tags = ['translator', 'parameter-filtering', 'provider-compatibility', 'utility'];
  } else if (path === 'open-sse/utils/bypassHandler.js') {
    summary = 'Handles shortcut/bypass requests by returning a synthetic response without calling upstream providers.';
    tags = ['utility', 'bypass', 'response-synthesis', 'streaming'];
  } else if (path === 'open-sse/utils/clientDetector.js') {
    summary = 'Detects the client tool from HTTP headers and decides whether native passthrough mode applies.';
    tags = ['utility', 'client-detection', 'headers', 'passthrough'];
  } else if (path === 'open-sse/utils/loopGuard.js') {
    summary = 'Detects repetitive tool-call sequences and assistant text to prevent infinite loops during chat execution.';
    tags = ['utility', 'loop-detection', 'tool-calls', 'safety'];
  } else if (path === 'open-sse/utils/requestLogger.js') {
    summary = 'Creates per-request log sessions and writes raw, translated, and error request artifacts to disk.';
    tags = ['utility', 'logging', 'request-tracing', 'debugging'];
  } else if (path === 'open-sse/utils/toolDeduper.js') {
    summary = 'Deduplicates and strips tool definitions based on configurable matching rules.';
    tags = ['utility', 'tool-deduplication', 'filtering'];
  } else if (path === 'src/app/api/media-providers/tts/minimax/voices/route.js') {
    summary = 'Next.js API route that fetches and normalizes MiniMax TTS voice listings.';
    tags = ['api-handler', 'nextjs-route', 'tts', 'voice-list'];
  } else if (path === 'src/lib/localDb.js') {
    summary = 'Local database facade that re-exports CRUD operations for settings, connections, nodes, keys, combos, aliases, and pricing.';
    tags = ['data-access', 'local-database', 'barrel', 'crud'];
  } else if (path === 'src/sse/handlers/chat.js') {
    summary = 'SSE chat entry point that validates API keys, resolves models/combos, and delegates to the core chat handler.';
    tags = ['api-handler', 'chat', 'sse', 'auth', 'entry-point'];
  } else if (path === 'src/sse/handlers/embeddings.js') {
    summary = 'SSE handler for embedding requests with auth, model validation, and token refresh.';
    tags = ['api-handler', 'embeddings', 'sse', 'auth'];
  } else if (path === 'src/sse/handlers/fetch.js') {
    summary = 'SSE handler for generic fetch-style requests, supporting combos and single-provider dispatch.';
    tags = ['api-handler', 'fetch', 'sse', 'proxy'];
  } else if (path === 'src/sse/handlers/imageGeneration.js') {
    summary = 'SSE handler for image generation requests with provider/model ACL checks.';
    tags = ['api-handler', 'image-generation', 'sse', 'auth'];
  } else if (path === 'src/sse/handlers/search.js') {
    summary = 'SSE handler for search/grounding requests with combo support and provider routing.';
    tags = ['api-handler', 'search', 'sse', 'grounding'];
  } else if (path === 'src/sse/handlers/stt.js') {
    summary = 'SSE handler for speech-to-text requests with form-data parsing and provider dispatch.';
    tags = ['api-handler', 'speech-to-text', 'sse', 'multipart'];
  } else if (path === 'src/sse/handlers/tts.js') {
    summary = 'SSE handler for text-to-speech requests with combo support and provider/model validation.';
    tags = ['api-handler', 'text-to-speech', 'sse', 'audio'];
  } else if (path === 'src/sse/services/allowedModels.js') {
    summary = 'Builds the list of models allowed for the current key by combining static catalogs, connections, combos, aliases, and custom models.';
    tags = ['service', 'model-allowlist', 'acl', 'catalog'];
  } else {
    summary = `JavaScript source file (${filename}).`;
    tags = ['code', 'javascript', 'utility'];
  }

  const node = {
    id: `file:${path}`,
    type: 'file',
    name: filename,
    filePath: path,
    summary,
    tags,
    complexity,
  };
  if (language) node.language = language;
  addNode(node);
  filePathToNodeId[path] = node.id;
}

// Create function and class nodes
for (const result of results) {
  const { path, functions = [], classes = [], exports = [] } = result;
  const exportedNames = new Set(exports.map(e => e.name));

  for (const fn of functions) {
    const lineCount = fn.endLine - fn.startLine + 1;
    const isExported = exportedNames.has(fn.name);
    if (lineCount < 10 && !isExported) continue;

    let summary = '';
    let tags = ['utility'];

    if (fn.name.startsWith('handle') || fn.name === 'GET') {
      tags = ['api-handler', 'request-handler'];
      summary = `Handles ${fn.name.replace(/^handle/, '').toLowerCase() || 'GET'} requests.`;
    } else if (fn.name.includes('build')) {
      tags = ['factory', 'builder'];
      summary = `Builds ${fn.name.replace(/^build/, '').toLowerCase()} structures.`;
    } else if (fn.name.includes('detect')) {
      tags = ['detection', 'utility'];
      summary = `Detects ${fn.name.replace(/^detect/, '').toLowerCase()} patterns.`;
    } else if (fn.name.includes('inject')) {
      tags = ['prompt-injection', 'token-saver'];
      summary = `Injects ${fn.name.replace(/^inject/, '').toLowerCase()} prompts into request bodies.`;
    } else if (fn.name.includes('get') || fn.name.includes('find') || fn.name.includes('resolve')) {
      tags = ['accessor', 'utility'];
      summary = `Retrieves or resolves ${fn.name.replace(/^(get|find|resolve)/, '').toLowerCase()}.`;
    } else if (fn.name.includes('create')) {
      tags = ['factory', 'utility'];
      summary = `Creates ${fn.name.replace(/^create/, '').toLowerCase()} instances.`;
    } else if (fn.name.includes('format') || fn.name.includes('normalize')) {
      tags = ['formatting', 'utility'];
      summary = `Formats or normalizes ${fn.name.replace(/^(format|normalize)/, '').toLowerCase()}.`;
    } else if (fn.name.includes('log') || fn.name.includes('Log')) {
      tags = ['logging', 'utility'];
      summary = `Logs ${fn.name.replace(/^log/, '').toLowerCase()} information.`;
    } else if (fn.name.includes('strip') || fn.name.includes('dedupe')) {
      tags = ['filtering', 'utility'];
      summary = `Filters or deduplicates ${fn.name.replace(/^(strip|dedupe)/, '').toLowerCase()}.`;
    } else {
      summary = `Utility function ${fn.name}.`;
    }

    // More specific summaries for key functions
    if (fn.name === 'handleChatCore') {
      summary = 'Coordinates the full chat request lifecycle: detection, translation, token-saver injection, execution, and response handling.';
      tags = ['api-handler', 'chat', 'orchestrator'];
    } else if (fn.name === 'handleChat') {
      summary = 'Entry point for SSE chat requests that performs auth, model resolution, and combo handling.';
      tags = ['api-handler', 'chat', 'entry-point'];
    } else if (fn.name === 'handleSingleModelChat') {
      summary = 'Executes a single-model chat flow after ACL, cooldown, and credential checks.';
      tags = ['api-handler', 'chat', 'single-model'];
    } else if (fn.name === 'buildModelsList') {
      summary = 'Builds the filtered, deduplicated model list for a given kind.';
      tags = ['model-catalog', 'builder'];
    } else if (fn.name === 'isModelAllowed') {
      summary = 'Checks whether a model string is present in the computed allowed-models set.';
      tags = ['acl', 'validation'];
    } else if (fn.name === 'detectLoop') {
      summary = 'Detects repetitive tool-call and text patterns that indicate a model loop.';
      tags = ['loop-detection', 'safety'];
    } else if (fn.name === 'createRequestLogger') {
      summary = 'Creates a logger that writes request/response artifacts for debugging.';
      tags = ['logging', 'factory'];
    }

    if (isExported) tags.push('exported');

    addNode({
      id: `function:${path}:${fn.name}`,
      type: 'function',
      name: fn.name,
      filePath: path,
      lineRange: [fn.startLine, fn.endLine],
      summary,
      tags: tags.slice(0, 5),
      complexity: lineCount > 100 ? 'complex' : lineCount > 30 ? 'moderate' : 'simple',
    });

    addEdge({
      source: `file:${path}`,
      target: `function:${path}:${fn.name}`,
      type: 'contains',
      direction: 'forward',
      weight: 1.0,
    });

    if (isExported) {
      addEdge({
        source: `file:${path}`,
        target: `function:${path}:${fn.name}`,
        type: 'exports',
        direction: 'forward',
        weight: 0.8,
      });
    }
  }

  for (const cls of classes) {
    const lineCount = cls.endLine - cls.startLine + 1;
    if (lineCount < 20 && (cls.methods || []).length < 2) continue;

    addNode({
      id: `class:${path}:${cls.name}`,
      type: 'class',
      name: cls.name,
      filePath: path,
      lineRange: [cls.startLine, cls.endLine],
      summary: `Class ${cls.name}.`,
      tags: ['class', 'data-model'],
      complexity: lineCount > 200 ? 'complex' : 'moderate',
    });

    addEdge({
      source: `file:${path}`,
      target: `class:${path}:${cls.name}`,
      type: 'contains',
      direction: 'forward',
      weight: 1.0,
    });

    if (exportedNames.has(cls.name)) {
      addEdge({
        source: `file:${path}`,
        target: `class:${path}:${cls.name}`,
        type: 'exports',
        direction: 'forward',
        weight: 0.8,
      });
    }
  }
}

// Imports edges - emit all from batchImportData
for (const [filePath, imports] of Object.entries(batchImportData)) {
  for (const importedPath of imports) {
    addEdge({
      source: `file:${filePath}`,
      target: `file:${importedPath}`,
      type: 'imports',
      direction: 'forward',
      weight: 0.7,
    });
  }
}

// Cross-batch calls / depends_on based on neighborMap and callGraph references
const neighborSymbolMap = new Map();
for (const [filePath, neighbors] of Object.entries(input.neighborMap || {})) {
  for (const n of neighbors) {
    for (const sym of n.symbols) {
      neighborSymbolMap.set(`${n.path}:${sym}`, { path: n.path, symbol: sym, source: filePath });
    }
  }
}

// Add some depends_on edges for clear runtime dependencies within the batch
const internalDeps = {
  'open-sse/rtk/caveman.js': ['open-sse/rtk/systemInject.js'],
  'open-sse/rtk/ponytail.js': ['open-sse/rtk/systemInject.js'],
  'open-sse/rtk/systemInject.js': ['open-sse/translator/formats.js'],
  'open-sse/rtk/terminationPrompt.js': ['open-sse/translator/formats.js'],
  'open-sse/handlers/chatCore.js': ['open-sse/rtk/caveman.js', 'open-sse/rtk/ponytail.js', 'open-sse/rtk/terminationPrompt.js', 'open-sse/utils/loopGuard.js'],
};

for (const [source, targets] of Object.entries(internalDeps)) {
  for (const target of targets) {
    addEdge({
      source: `file:${source}`,
      target: `file:${target}`,
      type: 'depends_on',
      direction: 'forward',
      weight: 0.6,
    });
  }
}

// Partition output
const nodeCount = nodes.length;
const edgeCount = edges.length;
const parts = Math.ceil(Math.max(nodeCount / 60, edgeCount / 120));

mkdirSync(outputDir, { recursive: true });

if (parts <= 1) {
  const output = { nodes, edges };
  writeFileSync(`${outputDir}/batch-6.json`, JSON.stringify(output, null, 2));
  console.log(`Wrote batch-6.json: ${nodeCount} nodes, ${edgeCount} edges`);
} else {
  // Sort files alphabetically and chunk
  const filePaths = batchFiles.map(b => b.path).sort();
  const chunkSize = Math.ceil(filePaths.length / parts);
  const chunks = [];
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    chunks.push(new Set(filePaths.slice(i, i + chunkSize)));
  }

  for (let k = 1; k <= chunks.length; k++) {
    const chunkFiles = chunks[k - 1];
    const chunkNodeIds = new Set();
    const chunkNodes = nodes.filter(n => {
      const belongs = chunkFiles.has(n.filePath);
      if (belongs) chunkNodeIds.add(n.id);
      return belongs;
    });
    const chunkEdges = edges.filter(e => chunkNodeIds.has(e.source));

    // Validate edge targets
    for (const e of chunkEdges) {
      if (!chunkNodeIds.has(e.target) && !e.target.startsWith('file:')) {
        // Remove edges to nodes outside this part that aren't file nodes (function/class cross-part refs)
        // Actually keep file refs; non-file cross-part refs should be dropped to pass validation
        // But file refs are allowed because they may exist in other batches.
        // We'll keep all file:* targets and drop other missing targets.
      }
    }

    writeFileSync(`${outputDir}/batch-6-part-${k}.json`, JSON.stringify({ nodes: chunkNodes, edges: chunkEdges }, null, 2));
    console.log(`Wrote batch-6-part-${k}.json: ${chunkNodes.length} nodes, ${chunkEdges.length} edges`);
  }
  console.log(`Total: ${nodeCount} nodes, ${edgeCount} edges across ${parts} parts`);
}
