const fs = require('fs');
const path = require('path');

const scan = JSON.parse(fs.readFileSync('/media/DiskE/Code/9router-new/.understand-anything/intermediate/scan-result.json', 'utf8'));
const graph = JSON.parse(fs.readFileSync('/media/DiskE/Code/9router-new/.understand-anything/knowledge-graph.json', 'utf8'));

const fileNodeIds = new Set(graph.nodes.filter(n => ['file','config','document','service','pipeline','table','schema','resource','endpoint'].includes(n.type)).map(n => n.id));
const existingIds = new Set(graph.nodes.map(n => n.id));

function nodeTypeFor(f) {
  switch (f.fileCategory) {
    case 'code': return 'file';
    case 'config': return 'config';
    case 'docs': return 'document';
    case 'data': return 'schema';
    case 'script': return 'file';
    case 'markup': return 'file';
    case 'infra':
      if (f.path.includes('workflows') || f.path.includes('.github') && f.path.endsWith('.yml')) return 'pipeline';
      if (f.path.startsWith('Dockerfile') || f.path.includes('docker-compose')) return 'service';
      return 'service';
    default: return 'file';
  }
}

function tagsFor(f, type) {
  const tags = [];
  if (type === 'document') tags.push('documentation');
  if (type === 'config') tags.push('configuration');
  if (type === 'service') tags.push('infrastructure');
  if (type === 'pipeline') tags.push('ci-cd', 'deployment');
  if (type === 'schema') tags.push('schema-definition');
  if (type === 'file') tags.push('code');
  if (f.path.includes('test')) tags.push('test');
  if (f.path.includes('.docs/audit')) tags.push('audit');
  if (f.path.includes('i18n')) tags.push('i18n');
  if (f.path.includes('gitbook')) tags.push('gitbook');
  if (tags.length === 0) tags.push('untagged');
  return tags.slice(0, 5);
}

function summaryFor(f, type) {
  const name = path.basename(f.path);
  switch (type) {
    case 'document': return `Documentation file ${name}.`;
    case 'config': return `Configuration file ${name}.`;
    case 'service': return `Infrastructure/deployment file ${name}.`;
    case 'pipeline': return `CI/CD pipeline configuration ${name}.`;
    case 'schema': return `Schema/data definition file ${name}.`;
    default: return `Source file ${name}.`;
  }
}

let added = 0;
for (const f of scan.files) {
  const type = nodeTypeFor(f);
  const id = `${type}:${f.path}`;
  if (fileNodeIds.has(id)) continue;
  // avoid duplicate ids
  if (existingIds.has(id)) continue;
  const node = {
    id,
    type,
    name: path.basename(f.path),
    filePath: f.path,
    summary: summaryFor(f, type),
    tags: tagsFor(f, type),
    complexity: f.sizeLines > 200 ? 'complex' : (f.sizeLines > 50 ? 'moderate' : 'simple')
  };
  graph.nodes.push(node);
  existingIds.add(id);
  fileNodeIds.add(id);
  added++;
}

fs.writeFileSync('/media/DiskE/Code/9router-new/.understand-anything/knowledge-graph.json', JSON.stringify(graph, null, 2));
console.log(`Added ${added} missing file nodes. Total nodes: ${graph.nodes.length}`);
