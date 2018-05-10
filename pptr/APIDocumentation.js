class APIDocumentation {
  /**
   * @param {string} version
   * @param {string} markdownText
   */
  static create(version, markdownText) {
    // Parse markdown into HTML
    const reader = new commonmark.Parser();
    const ast = reader.parse(markdownText);
    const writer = new commonmark.HtmlRenderer();
    const result = writer.render(ast);
    const domParser = new DOMParser();
    const doc = document.importNode(domParser.parseFromString(result, 'text/html').body, true);

    // Translate all relative links to ppdoc links.
    for (const anchor of doc.querySelectorAll('a')) {
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#')) {
        // Link referencing other part of documentation.
        const githubAnchor = href.substring(1);
        const entryId = APIDocumentation._idFromGHAnchor(githubAnchor);
        anchor.setAttribute('href', app.linkURL(version, entryId));
      } else if (href.startsWith('/') || href.startsWith('../') || href.startsWith('./')) {
        // Link pointing somewhere to PPTR repository.
        const isRelease = /^\d+\.\d+\.\d+$/.test(version);
        const branch = isRelease ? 'v' + version : 'master';
        anchor.setAttribute('href', `https://github.com/GoogleChrome/puppeteer/blob/${branch}/docs/${href}`);
      }
      // Mark link as external if necessary
      if (anchor.hostname !== location.hostname && anchor.hostname.length)
        anchor.appendChild(document.createElement('external-link-icon'));
    }

    // Highlight all code blocks.
    for (const code of doc.querySelectorAll('code.language-js'))
      CodeMirror.runMode(code.textContent, 'text/javascript', code);

    const classes = [];
    const sections = [];

    // All class headers are rendered as H3 tags
    const headers = doc.querySelectorAll('h3');
    for (let i = 0; i < headers.length; ++i) {
      const header = headers[i];
      const nextHeader = i + 1 < headers.length ? headers[i + 1] : null;
      const title = header.textContent;
      // Import all HTML from section until we hit next top-level header.
      const content = extractSiblingsIntoFragment(header.nextSibling, nextHeader);
      if (title.toLowerCase().startsWith('class:'))
        classes.push(APIClass.create(title, content));
      else
        sections.push(APISection.create(title, content));
    }
    return new APIDocumentation(version, classes, sections);
  }

  static _idFromGHAnchor(githubAnchor) {
    return 'api-' + githubAnchor;
  }

  constructor(version, classes, sections) {
    this.version = version;
    this.classes = classes;
    this.sections = sections;

    this._entryToId = new Map();
    this._idToEntry = new Map();

    const generateGithubAnchor = (title) => {
      const id = title.trim().toLowerCase().replace(/\s/g, '-').replace(/[^-0-9a-zа-яё]/ig, '');
      let dedupId = id;
      let counter = 0;
      while (this._idToEntry.has(dedupId))
        dedupId = id + '-' + (++counter);
      return dedupId;
    }

    const assignId = (entry, title) => {
      const id = APIDocumentation._idFromGHAnchor(generateGithubAnchor(title));
      this._entryToId.set(entry, id);
      this._idToEntry.set(id, entry);
    };

    for (const apiClass of classes) {
      assignId(apiClass, `class: '${apiClass.name}'`);
      for (const apiEvent of apiClass.events)
        assignId(apiEvent, `event: '${apiEvent.name}'`);
      for (const apiMethod of apiClass.methods)
        assignId(apiMethod, `${apiClass.loweredName}.${apiMethod.name}(${apiMethod.args})`);
      for (const ns of apiClass.namespaces)
        assignId(ns, `${apiClass.loweredName}.${ns.name}`);
    }
    for (const section of sections) {
      assignId(section, section.title);
    }
  }

  entryToId(entry) {
    return this._entryToId.get(entry) || null;
  }

  idToEntry(id) {
    return this._idToEntry.get(id) || null;
  }
}

class APISection {
  static create(title, fragment) {
    const element = document.createElement('api-section');
    element.classList.add('api-entry');
    element.innerHTML = `<h1>${title}</h1>`;
    element.appendChild(fragment);
    return new APISection(title, element);
  }

  constructor(title, element) {
    this.title = title;
    this.element = element;
  }
}

class APIClass {
  static create(title, fragment) {
    const name = title.replace(/^class:/i, '').trim();
    const headers = fragment.querySelectorAll('h4');
    const element = document.createElement('api-class');
    element.classList.add('api-entry');
    element.innerHTML = `<h3><api-class-name>class: ${name}</api-class-name></h3>`;
    element.appendChild(extractSiblingsIntoFragment(fragment.firstChild, headers[0]));
    const apiClass = new APIClass(name, element);

    for (let i = 0; i < headers.length; ++i) {
      const header = headers[i];
      const nextHeader = i + 1 < headers.length ? headers[i + 1] : null;
      const title = header.textContent;
      const fragment = extractSiblingsIntoFragment(header.nextSibling, nextHeader);
      if (title.toLowerCase().startsWith('event:'))
        apiClass.events.push(APIEvent.create(apiClass, title, fragment));
      else if (title.includes('('))
        apiClass.methods.push(APIMethod.create(apiClass, title, fragment));
      else
        apiClass.namespaces.push(APINamespace.create(apiClass, title, fragment));
    }
    return apiClass;
  }

  constructor(name, element) {
    this.name = name;
    this.loweredName = name.substring(0, 1).toLowerCase() + name.substring(1);
    this.element = element;
    this.methods = [];
    this.events = [];
    this.namespaces = [];
  }
}

class APINamespace {
  static create(apiClass, title, fragment) {
    const name = title.split('.').pop();
    const element = document.createElement('api-ns');
    element.classList.add('api-entry');
    element.innerHTML = [
      `<h4>`,
        `<api-ns-classname>${apiClass.loweredName}</api-ns-classname>`,
        `<api-ns-name>.${name}</api-ns-name>`,
      `</h4>`
    ].join('');
    return new APINamespace(apiClass, name, element);
  }

  constructor(apiClass, name, element) {
    this.apiClass = apiClass;
    this.name = name;
    this.element = element;
  }
}

class APIMethod {
  static create(apiClass, title, descFragment) {
    const name = title.match(/\.([^(]*)/)[1];
    const args = title.match(/\((.*)\)/)[1];
    const element = document.createElement('api-method');
    element.classList.add('api-entry');
    element.innerHTML = [
      `<h4>
        <api-method-classname>${apiClass.loweredName}</api-method-classname>`,
        `<api-method-name>.${name}</api-method-name>`,
        `<api-method-args>(${args})</api-method-args>`,
      `</h4>`
    ].join('');
    element.appendChild(descFragment);
    return new APIMethod(apiClass, name, args, element);
  }

  constructor(apiClass, name, args, element) {
    this.apiClass = apiClass;
    this.name = name;
    this.args = args;
    this.element = element;
  }
}

class APIEvent {
  static create(apiClass, title, descFragment) {
    const name = title.match(/'(.*)'/)[1];
    const element = document.createElement('api-event');
    element.classList.add('api-entry');
    element.innerHTML = `<h4>event: <api-event-name>'${name}'</api-event-name></h4>`;
    element.appendChild(descFragment);
    return new APIEvent(apiClass, name, element);
  }

  constructor(apiClass, name, element) {
    this.apiClass = apiClass;
    this.name = name;
    this.element = element;
  }
}

/**
 * @param {!Node} fromInclusive
 * @param {!Node} toExclusive
 * @return {!DocumentFragment}
 */
function extractSiblingsIntoFragment(fromInclusive, toExclusive) {
  const fragment = document.createDocumentFragment();
  let node = fromInclusive;
  while (node && node !== toExclusive) {
    const next = node.nextSibling;
    fragment.appendChild(node);
    node = next;
  }
  return fragment;
}

/**
 * @param {string} text
 * @param {!Array<number>} matches
 * @param {number} fromIndex
 * @param {number} fromIndex
 * @return {!Element}
 */
function renderTextWithMatches(text, matches, fromIndex, toIndex) {
  if (!matches.length)
    return document.createTextNode(text.substring(fromIndex, toIndex));
  let result = document.createDocumentFragment();
  let insideMatch = false;
  let currentIndex = fromIndex;
  let matchIndex = new Set(matches);
  for (let i = fromIndex; i < toIndex; ++i) {
    if (insideMatch !== matchIndex.has(i)) {
      add(currentIndex, i, insideMatch);
      insideMatch = matchIndex.has(i);
      currentIndex = i;
    }
  }
  add(currentIndex, toIndex, insideMatch);
  return result;

  /**
   * @param {number} from
   * @param {number} to
   * @param {boolean} isHighlight
   */
  function add(from, to, isHighlight) {
    if (to === from)
      return;
    let node = null;
    if (isHighlight) {
      node = document.createElement('search-highlight');
      node.textContent = text.substring(from, to);
    } else {
      node = document.createTextNode(text.substring(from, to));
    }
    result.appendChild(node);
  }
}
