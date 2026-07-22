import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverFiles } from '../lib/file-discovery';
import { loadManifest } from '../lib/manifest';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cli-discovery-'));
}

describe('discoverFiles', () => {
  it('ignores manifest.example.json (never becomes a file result)', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'manifest.example.json'), '{}');
    fs.writeFileSync(path.join(dir, 'passport.pdf'), 'fake pdf bytes');

    const files = discoverFiles(dir);
    expect(files.map((f) => f.filename)).toEqual(['passport.pdf']);
  });

  it('ignores manifest.json during discovery (it is read separately as config, never as a document)', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ defaults: { sourceLanguage: 'ru' } }));
    fs.writeFileSync(path.join(dir, 'diploma.docx'), 'fake docx bytes');

    const files = discoverFiles(dir);
    expect(files.map((f) => f.filename)).toEqual(['diploma.docx']);

    // manifest.json is still readable as configuration via loadManifest — just not as a document.
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = loadManifest(manifestPath);
    expect(manifest.defaults.sourceLanguage).toBe('ru');
  });

  it('ignores .gitkeep, dotfiles, and any other non-document file (e.g. .txt, .md)', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
    fs.writeFileSync(path.join(dir, '.DS_Store'), '');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'irrelevant');
    fs.writeFileSync(path.join(dir, 'README.md'), '# notes');
    fs.writeFileSync(path.join(dir, 'certificate.jpg'), 'fake jpg bytes');

    const files = discoverFiles(dir);
    expect(files.map((f) => f.filename)).toEqual(['certificate.jpg']);
  });

  it('discovers a PDF whose filename has spaces and parentheses (real-world case: "source (1).pdf")', () => {
    const dir = tmpDir();
    const tricky = 'source (1).pdf';
    fs.writeFileSync(path.join(dir, tricky), 'fake pdf bytes');

    const files = discoverFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe(tricky);
    expect(files[0].extension).toBe('.pdf');
    // The absolute path must be directly readable — no escaping/mangling of the special characters.
    expect(fs.readFileSync(files[0].absolutePath, 'utf-8')).toBe('fake pdf bytes');
  });

  it('only ever returns .docx/.pdf/.jpg/.jpeg/.png, sorted by filename', () => {
    const dir = tmpDir();
    for (const name of ['b.docx', 'a.pdf', 'c.jpeg', 'd.png', 'e.jpg', 'ignored.json', 'ignored.csv']) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    const files = discoverFiles(dir);
    expect(files.map((f) => f.filename)).toEqual(['a.pdf', 'b.docx', 'c.jpeg', 'd.png', 'e.jpg']);
  });
});
