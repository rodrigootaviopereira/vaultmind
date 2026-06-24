/**
 * VaultMind Wiki Client Application
 * Multi-root wiki with authentication, local full-text search, tag filtering, backlinks, and UI theme.
 */

// Authentication & Credentials
const USERS = {
  admin: { password: 'admin123', role: 'admin', roots: null },
  user:  { password: 'user123',  role: 'user',  roots: ['andresa_molina'] }
};

// State Management
let wikiData = {};
let currentRootId = 'andresa_molina';
let currentRootLabel = 'Andresa Molina';
let availableRoots = [];
let allRootsGraph = []; // Full list with metadata
let selectedRootIds = []; // For admin filter
let session = null;
let currentSearchQuery = '';
let activeTagFilter = '';
let activeCategoryFilter = 'all';
let accordionStates = {
  principle: true,
  conceito: true,
  tecnica: true,
  other: false
};
let graphAnimationFrameId = null;
let searchDebounceTimer = null;

// DOM Elements - Login & Auth
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginUserInput = document.getElementById('login-user');
const loginPassInput = document.getElementById('login-pass');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const appContainer = document.getElementById('app-container');

// DOM Elements - Root Selector
const rootSelectorContainer = document.getElementById('root-selector-container');
const rootSelect = document.getElementById('root-select');
const rootFilterContainer = document.getElementById('root-filter-container');
const rootFilterList = document.getElementById('root-filter-list');
const rootFilterHeader = document.querySelector('.root-filter-header');
const rootFilterCollapseBtn = document.getElementById('root-filter-collapse');
const sidebarSubtitle = document.getElementById('sidebar-subtitle');

// DOM Elements - Navigation
const navMenu = document.getElementById('nav-menu');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeToggleMobileBtn = document.getElementById('theme-toggle-mobile');
const mobileMenuToggleBtn = document.getElementById('mobile-menu-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
const sidebarTagsList = document.getElementById('sidebar-tags-list');
const connectionsIndicator = document.getElementById('connections-indicator');
const connectionsCount = document.getElementById('connections-count');

// DOM Elements - Content
const homeView = document.getElementById('home-view');
const homeWelcome = document.getElementById('home-welcome');
const homeDescription = document.getElementById('home-description');
const searchResultsView = document.getElementById('search-results-view');
const searchResultsTitle = document.getElementById('search-results-title');
const searchResultsCount = document.getElementById('search-results-count');
const searchResultsList = document.getElementById('search-results-list');
const noteView = document.getElementById('note-view');
const noteTitle = document.getElementById('note-title');
const noteTypeBadge = document.getElementById('note-type-badge');
const noteTagsContainer = document.getElementById('note-tags-container');
const noteBody = document.getElementById('note-body');
const openObsidianBtn = document.getElementById('open-obsidian-btn');

// DOM Elements - Relations
const relationsContainer = document.getElementById('relations-container');
const backlinksList = document.getElementById('backlinks-list');
const graphCanvas = document.getElementById('local-graph-canvas');

// Quick Stats Elements
const statTotal = document.getElementById('stat-total-notes');
const statPrinciples = document.getElementById('stat-total-principles');
const statConcepts = document.getElementById('stat-total-concepts');
const statTechniques = document.getElementById('stat-total-techniques');

// Authentication Functions
function checkAuth() {
  const sessionStr = localStorage.getItem('vm_session');
  if (sessionStr) {
    try {
      session = JSON.parse(sessionStr);
      return true;
    } catch (e) {
      localStorage.removeItem('vm_session');
      return false;
    }
  }
  return false;
}

function showLoginOverlay() {
  loginOverlay.classList.remove('hidden');
  appContainer.classList.add('hidden');
  loginUserInput.focus();
}

function hideLoginOverlay() {
  loginOverlay.classList.add('hidden');
  appContainer.classList.remove('hidden');
}

function handleLogin(e) {
  e.preventDefault();
  const username = loginUserInput.value.trim();
  const password = loginPassInput.value;

  const user = USERS[username];
  if (user && user.password === password) {
    session = {
      username,
      role: user.role,
      roots: user.roots
    };
    localStorage.setItem('vm_session', JSON.stringify(session));
    loginForm.reset();
    loginError.classList.add('hidden');
    hideLoginOverlay();
    loadWiki();
  } else {
    loginError.classList.remove('hidden');
    loginPassInput.value = '';
  }
}

function handleLogout() {
  localStorage.removeItem('vm_session');
  session = null;
  wikiData = {};
  loginForm.reset();
  loginError.classList.add('hidden');
  showLoginOverlay();
}

// Initialize App
async function init() {
  setupTheme();
  setupEventListeners();

  if (!checkAuth()) {
    showLoginOverlay();
    return;
  }

  hideLoginOverlay();
  loadWiki();
}

async function loadWiki() {
  try {
    // Load both roots.json and roots-graph.json
    const rootsResponse = await fetch('roots.json');
    if (!rootsResponse.ok) throw new Error('Falha ao carregar manifesto de raízes.');
    availableRoots = await rootsResponse.json();

    const graphResponse = await fetch('roots-graph.json');
    if (graphResponse.ok) {
      allRootsGraph = await graphResponse.json();
    }

    // Filtrar raízes baseado na sessão do usuário
    const userRoots = session.role === 'admin' ? availableRoots : availableRoots.filter(r => session.roots.includes(r.id));

    if (userRoots.length === 0) {
      navMenu.innerHTML = `<div class="nav-loading" style="color: var(--color-principle)">
        <i class="fa-solid fa-triangle-exclamation"></i> Nenhuma wiki disponível.
      </div>`;
      return;
    }

    // Show admin filter or user selector
    if (session.role === 'admin') {
      rootSelectorContainer.classList.add('hidden');
      renderAdminRootFilter(userRoots);
      // Load all selected roots (or all by default on first load)
      if (selectedRootIds.length === 0) {
        selectedRootIds = userRoots.map(r => r.id);
      }
    } else {
      rootFilterContainer.classList.add('hidden');
      if (userRoots.length > 1) {
        rootSelectorContainer.classList.remove('hidden');
        rootSelect.innerHTML = userRoots.map(r => `<option value="${r.id}">${r.label}</option>`).join('');
        currentRootId = userRoots[0].id;
      } else {
        rootSelectorContainer.classList.add('hidden');
        currentRootId = userRoots[0].id;
      }
    }

    // Carregar dados das raízes selecionadas
    await loadRootData(currentRootId);
    router();
  } catch (error) {
    console.error(error);
    navMenu.innerHTML = `<div class="nav-loading" style="color: var(--color-principle)">
      <i class="fa-solid fa-triangle-exclamation"></i> Erro ao carregar dados.
    </div>`;
  }
}

function renderAdminRootFilter(userRoots) {
  rootFilterContainer.classList.remove('hidden');
  rootFilterList.innerHTML = '';

  userRoots.forEach(root => {
    const rootGraph = allRootsGraph.find(r => r.id === root.id);
    const noteCount = root.noteCount || 0;
    const isSelected = selectedRootIds.includes(root.id);

    const item = document.createElement('div');
    item.className = 'root-filter-item';
    item.innerHTML = `
      <input type="checkbox" id="root-check-${root.id}" data-root-id="${root.id}" ${isSelected ? 'checked' : ''}>
      <label for="root-check-${root.id}">
        <span>${root.label}</span>
        <span class="root-note-count">${noteCount} notas</span>
      </label>
    `;
    rootFilterList.appendChild(item);
  });

  // Add event listeners to checkboxes
  document.querySelectorAll('.root-filter-item input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', handleRootFilterChange);
  });
}

function handleRootFilterChange(e) {
  const rootId = e.target.dataset.rootId;
  if (e.target.checked) {
    if (!selectedRootIds.includes(rootId)) {
      selectedRootIds.push(rootId);
    }
  } else {
    selectedRootIds = selectedRootIds.filter(r => r !== rootId);
  }

  // Ensure at least one root is selected
  if (selectedRootIds.length === 0) {
    selectedRootIds.push(rootId);
    e.target.checked = true;
    return;
  }

  // Reload UI with new selection
  currentRootId = selectedRootIds[0];
  buildStats();
  buildHomeSections();
  renderSidebarMenu();
  renderSidebarTags();
  if (window.location.hash === '' || window.location.hash === '#') {
    showHome();
  }
}

async function loadRootData(rootId) {
  try {
    // Determine which roots to load
    const rootsToLoad = session.role === 'admin' && selectedRootIds.length > 0
      ? selectedRootIds
      : [rootId];

    // Load and merge data from selected roots
    wikiData = {};
    for (const rid of rootsToLoad) {
      const response = await fetch(`data-${rid}.json`);
      if (response.ok) {
        const rootNotes = await response.json();
        wikiData = { ...wikiData, ...rootNotes };
      }
    }

    // Update UI
    currentRootId = rootId;
    const root = availableRoots.find(r => r.id === rootId);
    currentRootLabel = root ? root.label : 'VaultMind';

    if (rootsToLoad.length === 1) {
      document.title = `VaultMind — Wiki de ${currentRootLabel}`;
      sidebarSubtitle.textContent = `Wiki de ${currentRootLabel}`;
      homeDescription.textContent = `Explorando a wiki de ${currentRootLabel}. Selecione uma nota na barra lateral ou utilize o campo de busca.`;
    } else {
      document.title = `VaultMind — ${rootsToLoad.length} wikis`;
      sidebarSubtitle.textContent = `${rootsToLoad.length} wikis selecionadas`;
      homeDescription.textContent = `Explorando ${rootsToLoad.length} wikis. Selecione uma nota na barra lateral ou utilize o campo de busca.`;
    }
    homeWelcome.textContent = `Bem-vindo ao VaultMind`;

    buildStats();
    buildHomeSections();
    renderSidebarMenu();
    renderSidebarTags();
  } catch (error) {
    console.error(error);
    navMenu.innerHTML = `<div class="nav-loading" style="color: var(--color-principle)">
      <i class="fa-solid fa-triangle-exclamation"></i> Erro ao carregar dados.
    </div>`;
  }
}

// Router for SPA navigation using Hashes
function router() {
  const hash = window.location.hash;
  closeMobileSidebar();
  
  document.querySelectorAll('.menu-link').forEach(link => link.classList.remove('active'));
  
  if (hash.startsWith('#/note/')) {
    activeTagFilter = '';
    const noteId = decodeURIComponent(hash.substring(7));
    const note = wikiData[noteId];
    if (note) {
      showNote(note);
    } else {
      showHome();
    }
  } else if (hash.startsWith('#/tag/')) {
    const tagName = decodeURIComponent(hash.substring(6)).toLowerCase();
    activeTagFilter = tagName;
    searchInput.value = `#${tagName}`;
    clearSearchBtn.classList.remove('hidden');
    
    filterNotesByTag(tagName);
    showHome();
    
    const homeTitle = homeView.querySelector('h2');
    homeTitle.innerHTML = `Notas com a tag <span style="color: var(--accent)">#${tagName}</span>`;
    
    highlightActiveTagInSidebar(tagName);
  } else {
    activeTagFilter = '';
    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    renderSidebarMenu();
    showHome();
    
    const homeTitle = homeView.querySelector('h2');
    if (homeTitle) homeTitle.innerText = 'Bem-vindo à Wiki HumanoSense';
    
    highlightActiveTagInSidebar(null);
  }
}

// Text-node processing utilities
// ---------------------------------------------------------------------------
// We never run regex over the rendered HTML string (it corrupts tags, linkifies
// hex colors, and breaks on escaping). Instead we walk the DOM's text nodes and
// rewrite them, skipping elements where a transform would be wrong or redundant.
const TEXT_SKIP_TAGS = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE', 'MARK']);

// Walk every eligible text node under `root` and replace it with whatever
// `transform(text)` returns (a Node/DocumentFragment), or leave it if null.
function walkTextNodes(root, transform) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      let p = node.parentNode;
      while (p && p !== root) {
        if (TEXT_SKIP_TAGS.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  // Collect first, then mutate (mutating during traversal invalidates the walker)
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    const replacement = transform(node.nodeValue);
    if (replacement) node.parentNode.replaceChild(replacement, node);
  });
}

const HASHTAG_RE = /(^|[^\p{L}\p{N}_#])#([\p{L}\p{N}_-]+)/gu;

// Turn #hashtags inside a text node into clickable tag links
function linkifyHashtagsInElement(root) {
  walkTextNodes(root, text => {
    HASHTAG_RE.lastIndex = 0;
    if (!HASHTAG_RE.test(text)) return null;

    HASHTAG_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = HASHTAG_RE.exec(text)) !== null) {
      const lead = m[1];
      const tag = m[2];
      frag.appendChild(document.createTextNode(text.slice(last, m.index) + lead));

      const a = document.createElement('a');
      a.className = 'tag-link';
      a.href = `#/tag/${encodeURIComponent(tag.toLowerCase())}`;
      a.textContent = `#${tag}`;
      frag.appendChild(a);

      last = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  });
}

// Show Single Note
function showNote(note) {
  // Cancel previous graph animation if running
  if (graphAnimationFrameId) {
    cancelAnimationFrame(graphAnimationFrameId);
    graphAnimationFrameId = null;
  }

  homeView.classList.add('hidden');
  searchResultsView.classList.add('hidden');
  noteView.classList.remove('hidden');

  noteTitle.innerText = note.title;
  
  noteBody.innerHTML = note.html;
  linkifyHashtagsInElement(noteBody);
  if (currentSearchQuery.trim() && !currentSearchQuery.startsWith('#')) {
    highlightInElement(noteBody, currentSearchQuery);
  }
  
  // Note Type Badge
  const type = determineNoteType(note);
  noteTypeBadge.className = `note-type ${type}`;
  noteTypeBadge.innerText = type === 'principle' ? 'Princípio' : 
                            type === 'conceito' ? 'Conceito' : 
                            type === 'tecnica' ? 'Técnica' : 
                            type === 'modulo' ? 'Módulo' : 'Geral';
  
  // Open in Obsidian link
  openObsidianBtn.onclick = () => {
    const fileUrl = `wiki/${currentRootId}/${note.relativePath}`;
    window.location.href = `obsidian://open?vault=base_conhecimento&file=${encodeURIComponent(fileUrl)}`;
  };
  
  // Load Tags as Clickable Links
  noteTagsContainer.innerHTML = '';
  const tags = note.frontmatter.tags || [];
  if (tags.length > 0) {
    tags.forEach(tag => {
      const a = document.createElement('a');
      a.className = 'tag-badge';
      a.href = `#/tag/${encodeURIComponent(tag.toLowerCase())}`;
      a.innerText = `#${tag}`;
      noteTagsContainer.appendChild(a);
    });
  }
  
  // Render Relations: Backlinks List & Interactive Graph
  renderRelations(note.id);
  
  // Active state in sidebar
  document.querySelectorAll('.menu-link').forEach(link => {
    if (link.getAttribute('href') === `#/note/${encodeURIComponent(note.id)}`) {
      link.classList.add('active');
      
      const accordionItem = link.closest('.accordion-item');
      if (accordionItem && !accordionItem.classList.contains('open')) {
        accordionItem.classList.add('open');
        const groupKey = accordionItem.dataset.group;
        accordionStates[groupKey] = true;
      }
    }
  });

  document.querySelector('.content-area').scrollTop = 0;
}

// Show Dashboard Home
function showHome() {
  if (graphAnimationFrameId) {
    cancelAnimationFrame(graphAnimationFrameId);
    graphAnimationFrameId = null;
  }
  noteView.classList.add('hidden');
  searchResultsView.classList.add('hidden');
  homeView.classList.remove('hidden');
}

// Determine Note Type
function determineNoteType(note) {
  if (note.frontmatter.type) {
    const type = note.frontmatter.type.toLowerCase();
    if (type.includes('princ') || type.includes('prínc')) return 'principle';
    if (type.includes('conc')) return 'conceito';
    if (type.includes('tecn') || type.includes('técn')) return 'tecnica';
    if (type.includes('mod') || type.includes('mód')) return 'modulo';
  }
  
  const idLower = note.id.toLowerCase();
  if (idLower.startsWith('principio') || idLower.startsWith('princípio')) return 'principle';
  if (idLower.startsWith('conceito')) return 'conceito';
  if (idLower.startsWith('tecnica') || idLower.startsWith('técnica')) return 'tecnica';
  if (idLower.startsWith('modulo') || idLower.startsWith('módulo')) return 'modulo';
  
  return 'other';
}

// Render Sidebar Menu with Accordions
function renderSidebarMenu(searchResults = null, titleOverride = null) {
  navMenu.innerHTML = '';
  
  if (searchResults) {
    if (searchResults.length === 0) {
      navMenu.innerHTML = `<div class="nav-loading">Nenhum resultado encontrado.</div>`;
      return;
    }
    
    const div = document.createElement('div');
    div.className = 'menu-section';
    div.innerHTML = `<div class="menu-section-title">${titleOverride || 'Resultados da Busca'}</div>`;
    
    const list = document.createElement('ul');
    list.className = 'menu-list';
    
    searchResults.forEach(note => {
      list.appendChild(createMenuItemElement(note));
    });
    
    div.appendChild(list);
    navMenu.appendChild(div);
    return;
  }
  
  const categories = {
    principle: { title: 'Princípios', items: [], icon: 'fa-scale-balanced' },
    conceito: { title: 'Conceitos', items: [], icon: 'fa-brain' },
    tecnica: { title: 'Técnicas', items: [], icon: 'fa-screwdriver-wrench' },
    other: { title: 'Outros', items: [], icon: 'fa-layer-group' }
  };

  const sortedNotes = Object.values(wikiData).sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
  );

  sortedNotes.forEach(note => {
    const type = determineNoteType(note);
    if (type === 'modulo') {
      categories.other.items.push(note);
    } else {
      categories[type].items.push(note);
    }
  });

  const visibleKeys = activeCategoryFilter === 'all'
    ? ['principle', 'conceito', 'tecnica', 'other']
    : [activeCategoryFilter];

  visibleKeys.forEach(catKey => {
    const cat = categories[catKey];
    if (cat.items.length === 0) return;
    
    const accordionItem = document.createElement('div');
    accordionItem.className = 'accordion-item';
    accordionItem.dataset.group = catKey;
    if (accordionStates[catKey]) {
      accordionItem.classList.add('open');
    }
    
    const contentId = `accordion-content-${catKey}`;
    const isOpen = accordionStates[catKey];

    const header = document.createElement('button');
    header.className = 'accordion-header';
    header.setAttribute('aria-expanded', String(isOpen));
    header.setAttribute('aria-controls', contentId);
    header.innerHTML = `
      <span class="accordion-title-wrapper">
        <i class="fa-solid ${cat.icon} accordion-title-icon bullet-${catKey}"></i>
        <span class="accordion-title-text">${cat.title}</span>
        <span class="accordion-count">${cat.items.length}</span>
      </span>
      <i class="fa-solid fa-chevron-right accordion-arrow-icon"></i>
    `;

    header.onclick = () => {
      accordionItem.classList.toggle('open');
      const nowOpen = accordionItem.classList.contains('open');
      accordionStates[catKey] = nowOpen;
      header.setAttribute('aria-expanded', String(nowOpen));
    };

    const content = document.createElement('div');
    content.className = 'accordion-content';
    content.id = contentId;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-labelledby', contentId + '-btn');
    
    const list = document.createElement('ul');
    list.className = 'menu-list';
    
    cat.items.forEach(note => {
      list.appendChild(createMenuItemElement(note, catKey));
    });
    
    content.appendChild(list);
    accordionItem.appendChild(header);
    accordionItem.appendChild(content);
    navMenu.appendChild(accordionItem);
  });
}

// Render Tags list at the bottom of the sidebar
function renderSidebarTags() {
  sidebarTagsList.innerHTML = '';
  
  const tagCounts = {};
  Object.values(wikiData).forEach(note => {
    const tags = note.frontmatter.tags || [];
    tags.forEach(tag => {
      const t = String(tag).toLowerCase().trim();
      if (t) {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    });
  });
  
  const sortedTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
    
  if (sortedTags.length === 0) {
    sidebarTagsList.innerHTML = '<span style="color: var(--text-muted); font-size:12px; padding: 0 8px;">Nenhuma tag encontrada</span>';
    return;
  }
  
  sortedTags.forEach(([tag, count]) => {
    const a = document.createElement('a');
    a.className = 'sidebar-tag-pill';
    a.href = `#/tag/${encodeURIComponent(tag)}`;
    a.dataset.tag = tag;
    a.innerHTML = `#${tag} <span class="tag-count">${count}</span>`;
    sidebarTagsList.appendChild(a);
  });
}

// Highlight active tag
function highlightActiveTagInSidebar(tagName) {
  document.querySelectorAll('.sidebar-tag-pill').forEach(pill => {
    if (pill.dataset.tag === tagName) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

// Filter Notes By Tag
function filterNotesByTag(tagName) {
  const filtered = Object.values(wikiData).filter(note => {
    const tags = note.frontmatter.tags || [];
    return tags.some(t => String(t).toLowerCase() === tagName);
  });
  
  renderSidebarMenu(filtered, `Notas com #${tagName}`);
}

// Create menu item element
function createMenuItemElement(note, category = null) {
  const type = category || determineNoteType(note);
  const li = document.createElement('li');
  li.className = 'menu-item';
  
  const a = document.createElement('a');
  a.className = 'menu-link';
  a.href = `#/note/${encodeURIComponent(note.id)}`;
  a.title = note.title;
  
  const bullet = document.createElement('span');
  bullet.className = `menu-link-bullet bullet-${type}`;
  
  const textNode = document.createTextNode(note.title);
  
  a.appendChild(bullet);
  a.appendChild(textNode);
  li.appendChild(a);
  return li;
}

// Clean note titles for cleaner layout (stripping author names and category prefixes)
function cleanTitle(title) {
  return title
    .replace(/\s*-\s*Andresa Molina/gi, '')
    .replace(/\s*Andresa Molina/gi, '')
    // Strip categories with dash (e.g. HT - Tecnica - Humanometria)
    .replace(/^(HT\s*-\s*)?(Princ[íi]pio|Conceito|T[ée]cnica|M[óo]dulo|Modulo)\s*-\s*/gi, '')
    // Strip categories with preposition (e.g. Principio da Memoria Celular)
    .replace(/^(HT\s*-\s*)?(Princ[íi]pio|Conceito|T[ée]cnica|M[óo]dulo|Modulo)\s+(da|de|do|d[oas])\s+/gi, '')
    // Strip general HT prefixes
    .replace(/^HT\s*-\s*/gi, '')
    .replace(/:\s*$/, '')
    .trim();
}

// Calculate Connections and Render Backlinks + Local Graph
function renderRelations(targetNoteId) {
  backlinksList.innerHTML = '';

  // Backlinks are precomputed at build time (note.backlinks)
  const targetNote = wikiData[targetNoteId];
  const backlinks = ((targetNote && targetNote.backlinks) || [])
    .map(id => wikiData[id])
    .filter(Boolean);
  
  // Render backlinks text list
  if (backlinks.length > 0) {
    backlinks.forEach(note => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'backlink-card';
      a.href = `#/note/${encodeURIComponent(note.id)}`;
      
      const type = determineNoteType(note);
      a.innerHTML = `<span class="menu-link-bullet bullet-${type}" style="display:inline-block; margin-right:8px;"></span>${cleanTitle(note.title)}`;
      
      li.appendChild(a);
      backlinksList.appendChild(li);
    });
  } else {
    backlinksList.innerHTML = '<li style="color: var(--text-muted); font-size: 13px; font-style: italic; list-style:none; padding: 12px 16px;">Nenhuma nota aponta para esta.</li>';
  }

  
  // Compile network and render Local Graph View
  const connections = getNoteConnections(targetNoteId);

  // Update connections indicator in header
  const totalConnections = connections.nodes.length - 1;
  if (totalConnections > 0) {
    connectionsIndicator.classList.remove('hidden');
    connectionsCount.textContent = totalConnections;
  } else {
    connectionsIndicator.classList.add('hidden');
  }

  if (connections.nodes.length > 1) {
    relationsContainer.classList.remove('hidden');
    initLocalGraph(connections);
  } else {
    // If it's a completely isolated note with no backlinks and no internal links,
    // we can still display it or hide the card. Let's keep it visible so they see the backlinks column message
    relationsContainer.classList.remove('hidden');
    initLocalGraph({ nodes: [{ id: targetNoteId, title: wikiData[targetNoteId].title, isCentral: true, type: determineNoteType(wikiData[targetNoteId]) }], edges: [] });
  }
}

// Scan database and compile nodes/edges surrounding target note
function getNoteConnections(noteId) {
  const note = wikiData[noteId];
  if (!note) return { nodes: [], edges: [] };
  
  const connectedIds = new Set();
  const edges = [];

  // 1. Outgoing links (target -> neighbors), precomputed in build
  (note.links || []).forEach(targetId => {
    if (wikiData[targetId] && targetId !== noteId) {
      connectedIds.add(targetId);
      edges.push({ source: noteId, target: targetId });
    }
  });

  // 2. Incoming links (backlinks: neighbors -> target), precomputed in build
  (note.backlinks || []).forEach(otherId => {
    if (wikiData[otherId] && otherId !== noteId && !connectedIds.has(otherId)) {
      connectedIds.add(otherId);
      edges.push({ source: otherId, target: noteId });
    }
  });

  // Compile unique nodes array
  const nodes = [
    { id: noteId, title: cleanTitle(note.title), isCentral: true, type: determineNoteType(note) }
  ];
  
  connectedIds.forEach(id => {
    const neighbor = wikiData[id];
    if (neighbor) {
      nodes.push({ id: id, title: cleanTitle(neighbor.title), isCentral: false, type: determineNoteType(neighbor) });
    }
  });
  
  // 3. Find secondary connections (cross-links between neighbors themselves)
  const neighborArray = Array.from(connectedIds);
  for (let i = 0; i < neighborArray.length; i++) {
    for (let j = i + 1; j < neighborArray.length; j++) {
      const idA = neighborArray[i];
      const idB = neighborArray[j];
      const noteA = wikiData[idA];
      const noteB = wikiData[idB];

      if (noteA && (noteA.links || []).includes(idB)) {
        edges.push({ source: idA, target: idB });
      } else if (noteB && (noteB.links || []).includes(idA)) {
        edges.push({ source: idB, target: idA });
      }
    }
  }
  
  return { nodes, edges };
}

// Render local network on Canvas with spring-physics simulation
function initLocalGraph({ nodes, edges }) {
  const canvas = graphCanvas;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  // Set scale for high DPI screens
  const rect = canvas.parentNode.getBoundingClientRect();
  const width = rect.width || 380;
  const height = 360;
  
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Node type colors mapped to css styling theme
  const colors = {
    principle: '#ef4444',
    conceito: '#3b82f6',
    tecnica: '#10b981',
    modulo: '#f59e0b',
    other: '#8b5cf6'
  };
  
  // Initialize Node Positions (Central node at center, others in a surrounding circle)
  nodes.forEach((node, index) => {
    node.radius = node.isCentral ? 14 : 9;
    node.vx = 0;
    node.vy = 0;
    
    if (node.isCentral) {
      node.x = centerX;
      node.y = centerY;
    } else {
      const angle = (index / (nodes.length - 1)) * Math.PI * 2;
      const radius = 120 + Math.random() * 20;
      node.x = centerX + Math.cos(angle) * radius;
      node.y = centerY + Math.sin(angle) * radius;
    }
  });
  
  // Drag and hover state trackers
  let draggedNode = null;
  let hoveredNode = null;
  let mouseX = 0;
  let mouseY = 0;
  let dragStartPos = { x: 0, y: 0 };
  let isMovingMouse = false;
  
  // Run loop flag
  let activeFrames = 200; // Let physics run and settle down (prevents constant CPU use)
  
  function updatePhysics() {
    if (activeFrames <= 0 && !draggedNode) return;
    
    // 1. Repulsion between nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.hypot(dx, dy) || 1;
        const minDist = nodes[i].radius + nodes[j].radius + 90;
        
        if (dist < minDist) {
          const force = (minDist - dist) * 0.08;
          const ax = (dx / dist) * force;
          const ay = (dy / dist) * force;
          
          if (!nodes[i].isCentral || nodes.length > 2) {
            nodes[i].vx -= ax;
            nodes[i].vy -= ay;
          }
          nodes[j].vx += ax;
          nodes[j].vy += ay;
        }
      }
    }
    
    // 2. Attraction along links (spring physics)
    edges.forEach(edge => {
      const n1 = nodes.find(n => n.id === edge.source);
      const n2 = nodes.find(n => n.id === edge.target);
      
      if (n1 && n2) {
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.hypot(dx, dy) || 1;
        const desiredDist = 130;
        const force = (dist - desiredDist) * 0.025;
        
        const ax = (dx / dist) * force;
        const ay = (dy / dist) * force;
        
        n1.vx += ax;
        n1.vy += ay;
        n2.vx -= ax;
        n2.vy -= ay;
      }
    });
    
    // 3. Gravity pulling towards center and damping motion
    nodes.forEach(node => {
      if (node === draggedNode) return;
      
      const dx = centerX - node.x;
      const dy = centerY - node.y;
      const dist = Math.hypot(dx, dy) || 1;
      
      // Stronger gravity for central node to anchor the cluster
      const gravity = node.isCentral ? 0.08 : 0.012;
      node.vx += (dx / dist) * gravity * dist;
      node.vy += (dy / dist) * gravity * dist;
      
      node.x += node.vx;
      node.y += node.vy;
      
      // Friction damping
      node.vx *= 0.72;
      node.vy *= 0.72;
    });
    
    if (draggedNode) {
      draggedNode.x = mouseX;
      draggedNode.y = mouseY;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
    }
    
    activeFrames--;
  }
  
  function draw() {
    ctx.clearRect(0, 0, width, height);
    
    // Determine theme for lines and text labels
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const lineStrokeColor = isDark ? 'rgba(99, 102, 241, 0.25)' : 'rgba(79, 70, 229, 0.18)';
    const textShadowColor = isDark ? '#090d16' : '#ffffff';
    
    // Draw edges first (underneath nodes)
    ctx.lineWidth = 1.8;
    edges.forEach(edge => {
      const n1 = nodes.find(n => n.id === edge.source);
      const n2 = nodes.find(n => n.id === edge.target);
      
      if (n1 && n2) {
        ctx.beginPath();
        ctx.moveTo(n1.x, n1.y);
        ctx.lineTo(n2.x, n2.y);
        ctx.strokeStyle = lineStrokeColor;
        ctx.stroke();
      }
    });
    
    // Draw nodes and labels
    nodes.forEach(node => {
      const nodeColor = colors[node.type] || colors.other;
      const isHovered = (node === hoveredNode);
      
      ctx.save();
      
      // Draw glow ring around central node or hovered nodes
      if (node.isCentral || isHovered) {
        ctx.shadowBlur = isHovered ? 14 : 8;
        ctx.shadowColor = node.isCentral ? '#6366f1' : nodeColor;
      }
      
      // Draw Solid node core
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = node.isCentral ? '#6366f1' : nodeColor;
      ctx.fill();
      
      // Extra white core ring for central node
      if (node.isCentral) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius - 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      ctx.restore();
      
      // Draw first letter inside node core
      ctx.save();
      ctx.font = `bold ${node.isCentral ? '10px' : '8px'} Inter, var(--font-sans)`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letter = node.type === 'principle' ? 'P' :
                     node.type === 'conceito' ? 'C' :
                     node.type === 'tecnica' ? 'T' :
                     node.type === 'modulo' ? 'H' : 'G';
      ctx.fillText(letter, node.x, node.y);
      ctx.restore();
      
      // Draw label
      ctx.font = node.isCentral ? 'bold 11px Inter, var(--font-sans)' : '500 10px Inter, var(--font-sans)';
      ctx.textAlign = 'center';
      
      // Text Shadow for readability
      ctx.fillStyle = textShadowColor;
      for (let ox = -2; ox <= 2; ox++) {
        for (let oy = -2; oy <= 2; oy++) {
          if (Math.abs(ox) + Math.abs(oy) > 0) {
            ctx.fillText(node.title, node.x + ox, node.y + node.radius + 13 + oy);
          }
        }
      }
      
      // Colored/White label text
      ctx.fillStyle = node.isCentral ? '#6366f1' : textColor;
      ctx.fillText(node.title, node.x, node.y + node.radius + 13);
    });
  }
  
  function tick() {
    updatePhysics();
    draw();
    graphAnimationFrameId = requestAnimationFrame(tick);
  }
  
  // Interactive events helpers
  function getMouseCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }
  
  function getNodeAtPosition(pos) {
    return nodes.find(node => {
      const dist = Math.hypot(node.x - pos.x, node.y - pos.y);
      return dist <= node.radius + 12; // Extra click buffer
    });
  }
  
  // Event Listeners registration for mouse interactions
  canvas.onmousedown = (e) => {
    const pos = getMouseCoordinates(e);
    const node = getNodeAtPosition(pos);
    
    if (node) {
      draggedNode = node;
      dragStartPos = { x: pos.x, y: pos.y };
      isMovingMouse = false;
      activeFrames = 300; // Extend simulation active frames
    }
  };
  
  canvas.onmousemove = (e) => {
    const pos = getMouseCoordinates(e);
    mouseX = pos.x;
    mouseY = pos.y;
    
    if (draggedNode) {
      isMovingMouse = true;
      activeFrames = 100;
    } else {
      // Handle pointer cursor and hover outline
      const node = getNodeAtPosition(pos);
      if (node !== hoveredNode) {
        hoveredNode = node;
        canvas.style.cursor = node ? 'pointer' : 'default';
        activeFrames = 50; // Wake up physics slightly to draw glow
      }
    }
  };
  
  canvas.onmouseup = (e) => {
    if (draggedNode) {
      // If we didn't drag the node far, treat as a navigation CLICK!
      const pos = getMouseCoordinates(e);
      const moveDistance = Math.hypot(pos.x - dragStartPos.x, pos.y - dragStartPos.y);
      
      if (moveDistance < 6) {
        // Navigate route to clicked note
        window.location.hash = `#/note/${encodeURIComponent(draggedNode.id)}`;
      }
      
      draggedNode = null;
      activeFrames = 150;
    }
  };
  
  canvas.onmouseleave = () => {
    draggedNode = null;
    hoveredNode = null;
    canvas.style.cursor = 'default';
  };
  
  // Start loop
  tick();
}

// Full Text Search with debounce
function performSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(performSearchImmediate, 150);
}

function performSearchImmediate() {
  const query = searchInput.value.toLowerCase().trim();
  currentSearchQuery = query;

  if (query === '') {
    clearSearchBtn.classList.add('hidden');
    window.location.hash = '';
    hideSearchResults();
    renderSidebarMenu();
    return;
  }

  clearSearchBtn.classList.remove('hidden');

  if (query.startsWith('#')) {
    const tagName = query.substring(1).trim();
    if (tagName) {
      hideSearchResults();
      filterNotesByTag(tagName);
      highlightActiveTagInSidebar(tagName);
      return;
    }
  }

  const results = Object.values(wikiData).filter(note => {
    const titleMatch = note.title.toLowerCase().includes(query);
    const contentMatch = note.rawText.toLowerCase().includes(query);
    const tagMatch = (note.frontmatter.tags || []).some(tag => tag.toLowerCase().includes(query));
    return titleMatch || contentMatch || tagMatch;
  });

  // Sort: title matches first, then content matches
  results.sort((a, b) => {
    const aTitle = a.title.toLowerCase().includes(query) ? 0 : 1;
    const bTitle = b.title.toLowerCase().includes(query) ? 0 : 1;
    return aTitle - bTitle;
  });

  renderSidebarMenu(results);
  showSearchResults(results, query);
  highlightActiveTagInSidebar(null);
}

// Extract a snippet around the first match of query in text
function extractSnippet(rawText, query, contextChars) {
  contextChars = contextChars || 80;
  const lower = rawText.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return rawText.slice(0, 160).trim() + (rawText.length > 160 ? '…' : '');

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(rawText.length, idx + query.length + contextChars);

  let snippet = '';
  if (start > 0) snippet += '…';
  snippet += rawText.slice(start, end);
  if (end < rawText.length) snippet += '…';
  return snippet;
}

// Render a snippet with the query highlighted via <mark>
function renderSnippetWithHighlight(snippet, query) {
  const lower = snippet.toLowerCase();
  const needle = query.toLowerCase();
  const parts = [];
  let last = 0;
  let i = lower.indexOf(needle, 0);
  while (i !== -1) {
    if (i > last) parts.push(escapeForHtml(snippet.slice(last, i)));
    parts.push('<mark>' + escapeForHtml(snippet.slice(i, i + needle.length)) + '</mark>');
    last = i + needle.length;
    i = lower.indexOf(needle, last);
  }
  if (last < snippet.length) parts.push(escapeForHtml(snippet.slice(last)));
  return parts.join('');
}

function escapeForHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Show the central search results panel
function showSearchResults(results, query) {
  noteView.classList.add('hidden');
  homeView.classList.add('hidden');
  searchResultsView.classList.remove('hidden');

  searchResultsTitle.textContent = 'Resultados da Busca';
  searchResultsCount.textContent = results.length === 1
    ? '1 nota encontrada'
    : results.length + ' notas encontradas';

  searchResultsList.innerHTML = '';

  if (results.length === 0) {
    searchResultsList.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px 0;">Nenhum resultado encontrado.</p>';
    return;
  }

  results.forEach(note => {
    const card = document.createElement('a');
    card.className = 'search-result-card';
    card.href = '#/note/' + encodeURIComponent(note.id);

    const type = determineNoteType(note);
    const snippet = extractSnippet(note.rawText, query);
    const highlightedSnippet = renderSnippetWithHighlight(snippet, query);

    const tags = (note.frontmatter.tags || []).slice(0, 5);
    const tagsHtml = tags.map(function(t) {
      return '<span class="result-tag">#' + escapeForHtml(String(t)) + '</span>';
    }).join('');

    card.innerHTML =
      '<div class="result-title">' +
        '<span class="menu-link-bullet bullet-' + type + '"></span>' +
        escapeForHtml(note.title) +
      '</div>' +
      '<div class="result-snippet">' + highlightedSnippet + '</div>' +
      (tagsHtml ? '<div class="result-tags">' + tagsHtml + '</div>' : '');

    searchResultsList.appendChild(card);
  });
}

function hideSearchResults() {
  searchResultsView.classList.add('hidden');
}

// Highlight query matches by wrapping them in <mark>, operating on text nodes
// only (plain substring matching — no regex, so no escaping concerns).
function highlightInElement(root, query) {
  const needle = String(query || '').toLowerCase();
  if (!needle) return;

  walkTextNodes(root, text => {
    const lower = text.toLowerCase();
    if (lower.indexOf(needle) === -1) return null;

    const frag = document.createDocumentFragment();
    let last = 0;
    let i = lower.indexOf(needle, 0);
    while (i !== -1) {
      frag.appendChild(document.createTextNode(text.slice(last, i)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(i, i + needle.length);
      frag.appendChild(mark);
      last = i + needle.length;
      i = lower.indexOf(needle, last);
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  });
}

// Stats Generation
function buildStats() {
  const notes = Object.values(wikiData);
  let principles = 0;
  let concepts = 0;
  let techniques = 0;
  
  notes.forEach(note => {
    const type = determineNoteType(note);
    if (type === 'principle') principles++;
    else if (type === 'conceito') concepts++;
    else if (type === 'tecnica') techniques++;
  });
  
  statTotal.innerText = notes.length;
  statPrinciples.innerText = principles;
  statConcepts.innerText = concepts;
  statTechniques.innerText = techniques;
}

function buildHomeSections() {
  const notes = Object.values(wikiData);

  // Starter notes: pick the most-connected notes as entry points
  const starterContainer = document.getElementById('starter-notes');
  if (starterContainer) {
    const ranked = notes
      .map(n => ({ note: n, count: (n.links || []).length + (n.backlinks || []).length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    starterContainer.innerHTML = ranked.map(({ note, count }) => {
      const type = determineNoteType(note);
      const typeLabel = type === 'principle' ? 'Princípio' : type === 'conceito' ? 'Conceito' : type === 'tecnica' ? 'Técnica' : 'Nota';
      return `<a href="#/note/${encodeURIComponent(note.id)}" class="starter-card">
        <span class="starter-type">${typeLabel}</span>
        <span class="starter-title">${note.title}</span>
        <span class="starter-meta"><i class="fa-solid fa-circle-nodes"></i> ${count} conexões</span>
      </a>`;
    }).join('');
  }

  // Tag cloud on home page
  const cloudContainer = document.getElementById('home-tagcloud');
  if (cloudContainer) {
    const tagCounts = {};
    notes.forEach(n => {
      (n.frontmatter.tags || []).forEach(t => {
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });
    });
    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const maxCount = sorted[0]?.[1] || 1;
    cloudContainer.innerHTML = sorted.map(([tag, count]) => {
      const size = 0.75 + (count / maxCount) * 0.75;
      return `<a href="#/tag/${encodeURIComponent(tag)}" class="home-tag" style="font-size:${size.toFixed(2)}rem">#${tag} <sup>${count}</sup></a>`;
    }).join(' ');
  }
}

// Setup Theme Switcher
function setupTheme() {
  const savedTheme = localStorage.getItem('theme')
    || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const iconClass = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  themeToggleBtn.innerHTML = `<i class="${iconClass}"></i>`;
  themeToggleMobileBtn.innerHTML = `<i class="${iconClass}"></i>`;
}

// Mobile sidebar control
function toggleMobileSidebar() {
  sidebar.classList.toggle('active');
  sidebarOverlay.classList.toggle('active');
}

function closeMobileSidebar() {
  sidebar.classList.remove('active');
  sidebarOverlay.classList.remove('active');
}

function toggleSidebarCollapse() {
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
}

// Event Listeners Registration
function setupEventListeners() {
  // Auth listeners
  loginForm.addEventListener('submit', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);

  // Root selector/filter listeners
  rootSelect.addEventListener('change', (e) => {
    currentRootId = e.target.value;
    window.location.hash = '';
    router();
  });

  rootFilterHeader.addEventListener('click', () => {
    rootFilterList.classList.toggle('hidden');
    const icon = rootFilterCollapseBtn.querySelector('i');
    if (rootFilterList.classList.contains('hidden')) {
      icon.className = 'fa-solid fa-chevron-down';
    } else {
      icon.className = 'fa-solid fa-chevron-up';
    }
  });

  window.addEventListener('hashchange', router);
  searchInput.addEventListener('input', performSearch);
  
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentSearchQuery = '';
    clearSearchBtn.classList.add('hidden');
    hideSearchResults();
    window.location.hash = '';
    renderSidebarMenu();
  });
  
  themeToggleBtn.addEventListener('click', toggleTheme);
  themeToggleMobileBtn.addEventListener('click', toggleTheme);
  
  mobileMenuToggleBtn.addEventListener('click', toggleMobileSidebar);
  sidebarOverlay.addEventListener('click', closeMobileSidebar);

  // Category filter chips
  document.getElementById('filter-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeCategoryFilter = chip.dataset.filter;
    renderSidebarMenu();
  });

  // Desktop sidebar collapse
  sidebarCollapseBtn.addEventListener('click', toggleSidebarCollapse);

  // Restore sidebar state from localStorage
  if (localStorage.getItem('sidebar-collapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      toggleSidebarCollapse();
    }
  });
}

// Fire application initialization
document.addEventListener('DOMContentLoaded', init);
