const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const catalog = require('./textbooks/class10-science-bn.json');

const booksById = new Map(catalog.books.map(book => [book.id, book]));
const indexPromises = new Map();
const cachedPages = new Map();
let pdfjsPromise;
let ocrWorkerPromise;
const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_RETURN_CHARS = 28_000;

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('bn')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'when', 'where', 'how', 'কী', 'কি', 'এবং', 'ও', 'এর', 'একটি', 'কেন']);
  return normalizeText(value).split(' ').filter(token => token.length > 1 && !stop.has(token));
}

function cacheDirectory(userDataPath) {
  return path.join(userDataPath, 'textbooks', `class-${catalog.edition}-${catalog.group}-${catalog.language}`);
}

async function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function loadOcrWorker(userDataPath) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const cachePath = path.join(userDataPath, 'textbooks', 'ocr-language-data');
      fs.mkdirSync(cachePath, { recursive: true });
      return createWorker('ben+eng', 1, {
        cachePath,
        cacheMethod: 'write',
        logger: () => {},
      });
    })().catch(error => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
}

async function fetchPdfBytes(book, onProgress) {
  const url = `https://drive.egovcloud.gov.bd/index.php/s/${encodeURIComponent(book.shareId)}/download`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`NCTB download failed (HTTP ${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PDF_BYTES) throw new Error('The textbook PDF is larger than the 200 MB safety limit.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let lastPercent = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PDF_BYTES) throw new Error('The textbook PDF is larger than the 200 MB safety limit.');
      chunks.push(Buffer.from(value));
      const percent = declaredLength ? Math.floor(length / declaredLength * 100) : 0;
      if (percent >= lastPercent + 5) {
        lastPercent = percent;
        onProgress?.({ stage: 'download', percent, bookId: book.id, title: book.title });
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, length);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('The official download did not return a readable PDF.');
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

async function writeLine(stream, row) {
  if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain');
}

async function renderPage(page) {
  const { createCanvas } = require('@napi-rs/canvas');
  const viewport = page.getViewport({ scale: 1.8 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toBuffer('image/png');
}

function usablePdfText(items) {
  const text = items.map(item => item.str || '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return letters >= 45 ? text : '';
}

async function buildIndex(book, userDataPath, onProgress) {
  const directory = cacheDirectory(userDataPath);
  fs.mkdirSync(directory, { recursive: true });
  const indexPath = path.join(directory, `${book.id}.pages.jsonl`);
  const partialPath = path.join(directory, `${book.id}.partial.jsonl`);
  const metadataPath = path.join(directory, `${book.id}.meta.json`);
  const currentMetadata = {
    edition: catalog.edition,
    catalogSource: catalog.catalogSource,
    shareId: book.shareId,
    bookId: book.id,
  };

  if (fs.existsSync(indexPath) && fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (metadata.edition === currentMetadata.edition && metadata.shareId === book.shareId && metadata.bookId === book.id) {
        const pages = readJsonl(indexPath);
        cachedPages.set(book.id, pages);
        return { pages, metadata };
      }
    } catch { /* Rebuild an invalid or stale local cache. */ }
    fs.rmSync(indexPath, { force: true });
    fs.rmSync(metadataPath, { force: true });
  }

  onProgress?.({ stage: 'download-start', bookId: book.id, title: book.title });
  const bytes = await fetchPdfBytes(book, onProgress);
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true, verbosity: 0 });
  let pdf;
  try {
    pdf = await loadingTask.promise;
    const prior = readJsonl(partialPath);
    const indexedPages = new Set(prior.map(row => Number(row.page)).filter(Number.isInteger));
    const rowsByPage = new Map(prior.map(row => [Number(row.page), row]));
    const stream = fs.createWriteStream(partialPath, { flags: prior.length ? 'a' : 'w', encoding: 'utf8' });
    let worker;
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        if (indexedPages.has(pageNumber)) continue;
        const page = await pdf.getPage(pageNumber);
        let text = usablePdfText((await page.getTextContent()).items || []);
        let extraction = 'pdf-text';
        if (!text) {
          if (!worker) {
            onProgress?.({ stage: 'ocr-start', page: pageNumber, pages: pdf.numPages, bookId: book.id, title: book.title });
            worker = await loadOcrWorker(userDataPath);
          }
          const image = await renderPage(page);
          const result = await worker.recognize(image);
          text = String(result?.data?.text || '').replace(/\n{3,}/g, '\n\n').trim();
          extraction = 'ocr-ben-eng';
        }
        const row = { page: pageNumber, text, extraction };
        await writeLine(stream, row);
        rowsByPage.set(pageNumber, row);
        if (pageNumber === 1 || pageNumber % 4 === 0 || pageNumber === pdf.numPages) {
          onProgress?.({ stage: 'index', page: pageNumber, pages: pdf.numPages, bookId: book.id, title: book.title });
        }
        page.cleanup();
      }
      stream.end();
      await once(stream, 'finish');
    } catch (error) {
      stream.destroy();
      throw error;
    }
    fs.renameSync(partialPath, indexPath);
    const pages = [...rowsByPage.values()].sort((a, b) => a.page - b.page);
    const metadata = { ...currentMetadata, pages: pdf.numPages, indexedAt: new Date().toISOString(), source: `https://drive.egovcloud.gov.bd/index.php/s/${book.shareId}` };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    cachedPages.set(book.id, pages);
    return { pages, metadata };
  } finally {
    await pdf?.destroy().catch(() => {});
    await loadingTask.destroy().catch(() => {});
  }
}

async function ensureIndex(book, userDataPath, onProgress) {
  if (cachedPages.has(book.id)) return { pages: cachedPages.get(book.id) };
  if (!indexPromises.has(book.id)) {
    const promise = buildIndex(book, userDataPath, onProgress).finally(() => indexPromises.delete(book.id));
    indexPromises.set(book.id, promise);
  }
  return indexPromises.get(book.id);
}

function resultExcerpt(text, queryTokens, max = 900) {
  if (text.length <= max) return text;
  const normalized = normalizeText(text);
  const position = queryTokens.map(token => normalized.indexOf(token)).find(index => index >= 0) ?? 0;
  const start = Math.max(0, Math.min(text.length - max, position - Math.floor(max / 4)));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + max)}${start + max < text.length ? '…' : ''}`;
}

function rankedPages(pages, query) {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length) return [];
  const phrase = normalizeText(query);
  const scored = pages.map(row => {
    const content = normalizeText(row.text);
    if (!content) return { row, score: 0 };
    let score = 0;
    for (const token of queryTokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = content.match(new RegExp(escaped, 'gu')) || [];
      if (matches.length) score += Math.min(matches.length, 5) * (token.length > 4 ? 2 : 1);
    }
    if (phrase.length > 6 && content.includes(phrase)) score += 16;
    return { row, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.row.page - b.row.page);
  const selected = [];
  for (const hit of scored) {
    const range = [hit.row.page - 1, hit.row.page, hit.row.page + 1];
    for (const number of range) {
      const row = pages[number - 1];
      if (row && !selected.some(existing => existing.page === row.page)) selected.push(row);
      if (selected.length >= 6) break;
    }
    if (selected.length >= 6) break;
  }
  selected.sort((a, b) => a.page - b.page);
  return selected.map(row => ({ page: row.page, excerpt: resultExcerpt(row.text, queryTokens), extraction: row.extraction }));
}

function createClass10Textbooks({ userDataPath }) {
  if (typeof userDataPath !== 'function') throw new TypeError('userDataPath must be a function.');

  async function search(input = {}, onProgress) {
    const bookId = String(input.bookId || '').trim();
    const query = String(input.query || '').trim();
    const book = booksById.get(bookId);
    if (!book) return { status: 'unknown_book', availableBooks: catalog.books.map(item => ({ id: item.id, title: item.title })) };
    if (!query) return { status: 'missing_query', bookId, title: book.title };
    const { pages, metadata } = await ensureIndex(book, userDataPath(), onProgress);
    const results = rankedPages(pages, query);
    return {
      status: results.length ? 'ok' : 'no_match',
      edition: catalog.edition,
      bookId,
      title: book.title,
      query,
      indexedPages: metadata?.pages ?? pages.length,
      firstUse: Boolean(metadata?.indexedAt && Date.now() - Date.parse(metadata.indexedAt) < 30_000),
      source: metadata?.source || `https://drive.egovcloud.gov.bd/index.php/s/${book.shareId}`,
      results,
      hint: results.length ? 'Use read_class10_textbook_pages with these page numbers for full page text.' : 'No page text matched; try the exact lesson title or a shorter phrase.',
    };
  }

  async function readPages(input = {}, onProgress) {
    const bookId = String(input.bookId || '').trim();
    const book = booksById.get(bookId);
    if (!book) return { status: 'unknown_book', availableBooks: catalog.books.map(item => ({ id: item.id, title: item.title })) };
    const requested = Array.isArray(input.pages) ? [...new Set(input.pages.map(Number))] : [];
    if (!requested.length || requested.length > 8 || requested.some(page => !Number.isInteger(page) || page < 1)) {
      return { status: 'invalid_pages', message: 'Request between 1 and 8 positive PDF page numbers.' };
    }
    const { pages, metadata } = await ensureIndex(book, userDataPath(), onProgress);
    const available = new Map(pages.map(row => [row.page, row]));
    const selected = requested.sort((a, b) => a - b).map(number => available.get(number)).filter(Boolean);
    if (selected.length !== requested.length) return { status: 'page_out_of_range', pageCount: metadata?.pages ?? pages.length };
    const text = selected.map(row => `--- ${book.title} · PDF page ${row.page} ---\n${row.text || '[No readable text detected on this page.]'}`).join('\n\n');
    return {
      status: 'ok',
      edition: catalog.edition,
      bookId,
      title: book.title,
      source: metadata?.source || `https://drive.egovcloud.gov.bd/index.php/s/${book.shareId}`,
      pages: selected.map(row => row.page),
      truncated: text.length > MAX_RETURN_CHARS,
      content: text.slice(0, MAX_RETURN_CHARS),
      note: selected.some(row => row.extraction === 'ocr-ben-eng') ? 'Text is OCR from scanned pages; verify formulas and diagram labels against the cited page.' : undefined,
    };
  }

  function list() {
    return catalog.books.map(({ id, title, category, aliases }) => ({ id, title, category, aliases: aliases || [] }));
  }

  return { list, search, readPages };
}

module.exports = { createClass10Textbooks, class10ScienceBanglaCatalog: catalog };
