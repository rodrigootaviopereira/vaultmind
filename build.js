const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

marked.setOptions({
  gfm: true,
  breaks: true
});

const wikiBaseDir = path.join(__dirname, '..', '..', 'wiki');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Helper to convert snake_case to Title Case
function toTitleCase(str) {
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Helper to recursively get all files in a directory
function getFilesRecursively(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else if (file.endsWith('.md')) {
      results.push(fullPath);
    }
  });
  return results;
}

function getRootsToProcess() {
  if (!fs.existsSync(wikiBaseDir)) {
    console.error(`Diretório wiki não encontrado: ${wikiBaseDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(wikiBaseDir);
  const roots = entries.filter(name => {
    const fullPath = path.join(wikiBaseDir, name);
    const stat = fs.statSync(fullPath);
    return stat.isDirectory() && name !== 'sistema';
  });

  return roots.sort();
}

function buildWiki(rootId) {
  console.log(`\nCompilando wiki: ${rootId}`);

  const wikiDir = path.join(wikiBaseDir, rootId);
  const dataFile = path.join(publicDir, `data-${rootId}.json`);

  const EXCLUDED_PREFIXES = ['HT - ', 'HT -', 'apostila_', 'index_apostila'];
  function isExcluded(filePath) {
    const name = path.basename(filePath, '.md');
    return EXCLUDED_PREFIXES.some(p => name.startsWith(p));
  }

  const allFilePaths = getFilesRecursively(wikiDir).filter(fp => !isExcluded(fp));
  const notes = {};

  // First Pass: Collect all valid note keys (basenames without .md)
  const validNoteKeys = new Set();
  allFilePaths.forEach(filePath => {
    validNoteKeys.add(path.basename(filePath, '.md').trim());
  });

  // Helper to convert Obsidian [[Link]] to Markdown links.
  // When an `outgoing` Set is passed, valid target note keys are collected into it.
  function convertObsidianLinks(markdown, outgoing) {
    return markdown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, label) => {
      let cleanTarget = target.trim();
      if (cleanTarget.endsWith('.md')) {
        cleanTarget = cleanTarget.slice(0, -3);
      }

      const noteName = cleanTarget.split('/').pop().trim();
      const displayLabel = label ? label.trim() : noteName;

      if (validNoteKeys.has(noteName)) {
        if (outgoing) outgoing.add(noteName);
        return `[${displayLabel}](#/note/${encodeURIComponent(noteName)})`;
      } else {
        return `<span class="external-note-ref" title="Nota externa ou transcrição: ${target}">${displayLabel}</span>`;
      }
    });
  }

  // Second Pass: Process each note
  allFilePaths.forEach(filePath => {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');

      // Parse Frontmatter
      const { data: frontmatter, content: rawMarkdown } = matter(fileContent);

    // Extract hashtags from body (e.g., #ancestralidade, #feminino)
    const bodyTags = [];
    const hashtagRegex = /(?:^|[^#\w])#([a-zA-Z0-9À-ÿ_-]+)/g;
    let match;
    while ((match = hashtagRegex.exec(rawMarkdown)) !== null) {
      const tag = match[1].toLowerCase().trim();
      if (tag && !bodyTags.includes(tag) && isNaN(tag)) {
        bodyTags.push(tag);
      }
    }

    const frontmatterTags = Array.isArray(frontmatter.tags) 
      ? frontmatter.tags.map(t => String(t).toLowerCase().trim()) 
      : [];
    
    const allTags = Array.from(new Set([...frontmatterTags, ...bodyTags]));

    // Convert Obsidian links in markdown, collecting outgoing note references
    const outgoing = new Set();
    const processedMarkdown = convertObsidianLinks(rawMarkdown, outgoing);

    // Convert to HTML
    const html = marked.parse(processedMarkdown);

    // Get note key (filename without .md)
    const noteKey = path.basename(filePath, '.md');
    
    // Calculate relative path for Obsidian deep links
    const relativePath = path.relative(wikiDir, filePath).replace(/\\/g, '/');

    // Extract title
    let title = noteKey;
    const h1Match = rawMarkdown.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    }

    notes[noteKey] = {
      id: noteKey,
      title: title,
      relativePath: relativePath,
      rootId: rootId,
      frontmatter: {
        ...frontmatter,
        tags: allTags
      },
      html: html,
      rawText: rawMarkdown.replace(/[#*`_[\]()]/g, ' '),
      links: Array.from(outgoing).filter(id => id !== noteKey),
      backlinks: []
    };
    } catch (error) {
      console.warn(`⚠ Erro ao processar ${path.basename(filePath)}: ${error.message}`);
    }
  });

  // Third Pass: compute backlinks from the outgoing adjacency (reverse index)
  Object.values(notes).forEach(note => {
    note.links.forEach(targetId => {
      const target = notes[targetId];
      if (target && !target.backlinks.includes(note.id)) {
        target.backlinks.push(note.id);
      }
    });
  });

  fs.writeFileSync(dataFile, JSON.stringify(notes, null, 2), 'utf8');
  console.log(`✓ ${Object.keys(notes).length} notas em data-${rootId}.json`);

  renderStaticPages(notes, rootId);

  return { rootId, noteCount: Object.keys(notes).length };
}

// Escape text for safe insertion into HTML attributes/body
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build a short plain-text description from a note's rawText,
// dropping a leading duplicate of the title (rawText usually starts with the H1).
function buildDescription(rawText, title) {
  let clean = String(rawText).replace(/\s+/g, ' ').trim();
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (t && clean.toLowerCase().startsWith(t.toLowerCase())) {
    clean = clean.slice(t.length).trim();
  }
  if (clean.length <= 160) return clean;
  return clean.slice(0, 157).trimEnd() + '…';
}

function renderStaticPages(notes, rootId) {
  const pagesDir = path.join(publicDir, 'n');
  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }

  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const rootLabel = toTitleCase(rootId);

  Object.values(notes).forEach(note => {
    const fileName = encodeURIComponent(note.id) + '.html';
    const spaUrl = `../index.html#/note/${encodeURIComponent(note.id)}`;
    const description = buildDescription(note.rawText, note.title);
    const title = `${note.title} — VaultMind`;
    const canonical = siteUrl ? `${siteUrl}/n/${fileName}` : `n/${fileName}`;

    const tags = (note.frontmatter.tags || [])
      .map(t => `<a href="../index.html#/tag/${encodeURIComponent(String(t).toLowerCase())}">#${escapeHtml(t)}</a>`)
      .join(' ');

    const page = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(note.title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:site_name" content="VaultMind — Wiki de ${escapeHtml(rootLabel)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(note.title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script>window.location.replace(${JSON.stringify(spaUrl)});</script>
</head>
<body>
<main>
<h1>${escapeHtml(note.title)}</h1>
<nav>${tags}</nav>
<article>${note.html}</article>
<p><a href="${escapeHtml(spaUrl)}">Abrir versão interativa da Wiki HumanoSense</a></p>
</main>
</body>
</html>`;

    fs.writeFileSync(path.join(pagesDir, fileName), page, 'utf8');
  });
}

function build() {
  console.log('Iniciando compilação multi-root...\n');

  const roots = getRootsToProcess();
  const rootsManifest = [];

  roots.forEach(rootId => {
    const result = buildWiki(rootId);
    rootsManifest.push({
      id: result.rootId,
      label: toTitleCase(result.rootId),
      noteCount: result.noteCount
    });
  });

  const manifestFile = path.join(publicDir, 'roots.json');
  fs.writeFileSync(manifestFile, JSON.stringify(rootsManifest, null, 2), 'utf8');
  console.log(`\n✓ Manifesto de raízes criado: ${manifestFile}`);
  console.log(`✓ Total de ${roots.length} raízes compiladas com sucesso!\n`);
}

build();
